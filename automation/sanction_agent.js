class SanctionAgent {
  constructor(config) {
    this.supabase = config.supabase;
    this.logger = config.logger || console;
    this.pdfApiKey = config.pdfApiKey;
    this.emailService = config.emailService;
  }

  async process(conversation, message) {
    // Check if sanction already exists
    const existing = await this.getExistingSanction(conversation);
    
    if (existing) {
      return this.handleExistingSanction(existing, message);
    }

    // Generate new sanction
    return await this.generateSanction(conversation);
  }

  async getExistingSanction(conversation) {
    const { data } = await this.supabase
      .from('sanctions')
      .select(`
        *,
        applications (
          *,
          leads (*),
          underwriting (*)
        )
      `)
      .eq('applications.leads.conversation_id', conversation.id)
      .single();

    return data;
  }

  async generateSanction(conversation) {
    try {
      // Get approved application details
      const application = await this.getApprovedApplication(conversation);
      
      if (!application) {
        throw new Error('No approved application found');
      }

      const lead = application.leads;
      const underwriting = application.underwriting;

      // Calculate loan details
      const loanDetails = this.calculateLoanDetails(
        underwriting.approved_amount,
        underwriting.interest_rate,
        lead.loan_tenure
      );

      // Generate sanction number
      const sanctionNumber = this.generateSanctionNumber();

      // Create PDF sanction letter
      const pdfUrl = await this.generateSanctionPDF({
        sanctionNumber,
        application,
        lead,
        underwriting,
        loanDetails
      });

      // Save sanction record
      const { data: sanction } = await this.supabase
        .from('sanctions')
        .insert({
          application_id: application.id,
          sanction_number: sanctionNumber,
          sanction_amount: underwriting.approved_amount,
          interest_rate: underwriting.interest_rate,
          tenure_months: lead.loan_tenure,
          emi_amount: loanDetails.emi,
          sanction_letter_url: pdfUrl,
          disbursement_status: 'pending'
        })
        .select()
        .single();

      // Send email
      await this.sendSanctionEmail(lead, sanction, pdfUrl);

      // Update conversation to completed
      await this.supabase
        .from('conversations')
        .update({ 
          current_stage: 'completed',
          current_agent: 'none'
        })
        .eq('id', conversation.id);

      return this.formatSanctionMessage(sanction, lead, loanDetails);

    } catch (error) {
      this.logger.error('Sanction generation error:', error);
      return {
        message: '⚠️ We encountered an issue generating your sanction letter. Our team is working on it and will send it to your email shortly.',
        error: true
      };
    }
  }

  async getApprovedApplication(conversation) {
    const { data } = await this.supabase
      .from('applications')
      .select(`
        *,
        leads (*),
        underwriting (*)
      `)
      .eq('leads.conversation_id', conversation.id)
      .eq('status', 'approved')
      .eq('underwriting.decision', 'APPROVED')
      .single();

    return data;
  }

  calculateLoanDetails(principal, annualRate, tenureMonths) {
    const monthlyRate = annualRate / (12 * 100);
    
    // EMI Calculation
    const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) 
                / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
    
    const roundedEmi = Math.round(emi);
    const totalRepayment = roundedEmi * tenureMonths;
    const totalInterest = totalRepayment - principal;
    const processingFee = Math.round(principal * 0.01); // 1% processing fee

    return {
      emi: roundedEmi,
      totalRepayment,
      totalInterest,
      processingFee,
      effectiveRate: annualRate
    };
  }

  generateSanctionNumber() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `SN${timestamp}${random}`;
  }

  async generateSanctionPDF(data) {
    // Generate HTML content
    const html = this.generateSanctionHTML(data);

    try {
      // Call PDF generation service (PDFMonkey, DocRaptor, etc.)
      const response = await fetch('https://api.pdfmonkey.io/api/v1/documents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.pdfApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          document_template_id: process.env.PDF_TEMPLATE_ID,
          payload: data,
          status: 'pending'
        })
      });

      const result = await response.json();
      return result.download_url;

    } catch (error) {
      this.logger.error('PDF generation error:', error);
      
      // Fallback: Store HTML in Supabase Storage
      const fileName = `sanctions/${data.sanctionNumber}.html`;
      await this.supabase.storage
        .from('loan-documents')
        .upload(fileName, html, { contentType: 'text/html' });

      const { data: urlData } = this.supabase.storage
        .from('loan-documents')
        .getPublicUrl(fileName);

      return urlData.publicUrl;
    }
  }

  generateSanctionHTML(data) {
    const { sanctionNumber, lead, underwriting, loanDetails } = data;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 20px;
        }
        .company-name {
            font-size: 28px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 10px;
        }
        .document-title {
            font-size: 24px;
            font-weight: bold;
            margin: 30px 0;
            text-align: center;
            color: #1e40af;
        }
        .section {
            margin: 30px 0;
        }
        .section-title {
            font-size: 18px;
            font-weight: bold;
            color: #1e40af;
            margin-bottom: 15px;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        table td {
            padding: 12px;
            border: 1px solid #d1d5db;
        }
        table td:first-child {
            font-weight: bold;
            background-color: #f3f4f6;
            width: 45%;
        }
        .highlight-box {
            background-color: #dbeafe;
            border-left: 4px solid #2563eb;
            padding: 15px;
            margin: 20px 0;
        }
        ul {
            margin-left: 20px;
            margin-top: 10px;
        }
        ul li {
            margin: 8px 0;
        }
        .footer {
            margin-top: 50px;
            padding-top: 20px;
            border-top: 2px solid #e5e7eb;
            font-size: 12px;
            color: #6b7280;
        }
        .signature-section {
            margin-top: 60px;
            text-align: right;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-name">LOAN COMPANY NAME</div>
        <div>Registered Office: [Your Company Address]</div>
        <div>Email: loans@company.com | Phone: 1800-XXX-XXXX</div>
    </div>

    <div style="text-align: right; margin-bottom: 20px;">
        <strong>Date:</strong> ${new Date().toLocaleDateString('en-IN')}<br>
        <strong>Sanction Number:</strong> ${sanctionNumber}
    </div>

    <div class="document-title">LOAN SANCTION LETTER</div>

    <div class="section">
        <p>Dear ${lead.name},</p>
        <br>
        <p>We are pleased to inform you that your loan application has been <strong>approved</strong> by our underwriting team. This sanction letter outlines the terms and conditions of your loan.</p>
    </div>

    <div class="section">
        <div class="section-title">Applicant Details</div>
        <table>
            <tr>
                <td>Applicant Name</td>
                <td>${lead.name}</td>
            </tr>
            <tr>
                <td>Mobile Number</td>
                <td>${lead.mobile}</td>
            </tr>
            <tr>
                <td>Email Address</td>
                <td>${lead.email}</td>
            </tr>
            <tr>
                <td>Application Number</td>
                <td>${data.application.application_number}</td>
            </tr>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Loan Details</div>
        <table>
            <tr>
                <td>Loan Amount Sanctioned</td>
                <td>₹${underwriting.approved_amount.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
                <td>Loan Purpose</td>
                <td>${lead.loan_purpose}</td>
            </tr>
            <tr>
                <td>Rate of Interest</td>
                <td>${underwriting.interest_rate}% per annum</td>
            </tr>
            <tr>
                <td>Loan Tenure</td>
                <td>${lead.loan_tenure} months</td>
            </tr>
            <tr>
                <td>Monthly EMI</td>
                <td>₹${loanDetails.emi.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
                <td>Total Interest Payable</td>
                <td>₹${loanDetails.totalInterest.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
                <td>Total Amount Payable</td>
                <td>₹${loanDetails.totalRepayment.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
                <td>Processing Fee</td>
                <td>₹${loanDetails.processingFee.toLocaleString('en-IN')} (1% of loan amount)</td>
            </tr>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Terms & Conditions</div>
        <ul>
            <li><strong>Validity:</strong> This sanction is valid for 30 days from the date of issue.</li>
            <li><strong>Disbursement:</strong> Subject to completion of all documentation and verification formalities.</li>
            <li><strong>EMI Payment:</strong> First EMI to be paid on the 5th of the month following disbursement.</li>
            <li><strong>Prepayment:</strong> Allowed after 6 EMI payments with nil foreclosure charges.</li>
            <li><strong>Late Payment:</strong> Penalty of 2% per month on overdue EMI amount.</li>
            <li><strong>Default:</strong> In case of default, loan may be recalled and legal action initiated.</li>
            <li><strong>Insurance:</strong> Loan protection insurance is optional but recommended.</li>
            <li><strong>Documentation:</strong> All original documents to be submitted before disbursement.</li>
        </ul>
    </div>

    <div class="highlight-box">
        <strong>Important:</strong> Please accept this sanction by signing and returning a copy within 7 days. You can also accept digitally by replying "ACCEPT" to our message or email.
    </div>

    <div class="section">
        <div class="section-title">Disbursement Process</div>
        <ol style="margin-left: 20px;">
            <li>Accept this sanction letter (within 7 days)</li>
            <li>Submit any pending documentation</li>
            <li>Sign loan agreement</li>
            <li>Pay processing fee</li>
            <li>Loan disbursed to your account (within 24 hours)</li>
        </ol>
    </div>

    <div class="section">
        <p>For any queries or clarifications, please contact us:</p>
        <ul style="list-style-type: none;">
            <li>📧 Email: support@loancompany.com</li>
            <li>📞 Phone: 1800-XXX-XXXX</li>
            <li>💬 WhatsApp: Reply to our message</li>
        </ul>
    </div>

    <div class="signature-section">
        <p><strong>Authorized Signatory</strong></p>
        <p>Loan Company Name</p>
        <p style="margin-top: 10px; font-size: 12px; color: #6b7280;">
            (This is a digitally generated document)
        </p>
    </div>

    <div class="footer">
        <p><strong>Disclaimer:</strong> This sanction letter is subject to verification of all information and documents provided. The company reserves the right to modify or cancel this sanction if any information is found to be incorrect or misleading.</p>
    </div>
</body>
</html>`;
  }

  async sendSanctionEmail(lead, sanction, pdfUrl) {
    const emailContent = {
      to: lead.email,
      from: 'loans@yourcompany.com',
      subject: `Loan Sanctioned! - ${sanction.sanction_number}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0;">🎉 Congratulations!</h1>
            <p style="margin: 10px 0 0 0; font-size: 18px;">Your Loan has been Sanctioned</p>
          </div>
          
          <div style="padding: 30px; background-color: #f9fafb;">
            <p>Dear ${lead.name},</p>
            
            <p>We're delighted to inform you that your loan application has been <strong>approved</strong>!</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #2563eb; margin-top: 0;">📄 Loan Summary</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0;"><strong>Sanction Number:</strong></td>
                  <td style="text-align: right;">${sanction.sanction_number}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Sanctioned Amount:</strong></td>
                  <td style="text-align: right;">₹${sanction.sanction_amount.toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Interest Rate:</strong></td>
                  <td style="text-align: right;">${sanction.interest_rate}% p.a.</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Monthly EMI:</strong></td>
                  <td style="text-align: right;">₹${sanction.emi_amount.toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Tenure:</strong></td>
                  <td style="text-align: right;">${sanction.tenure_months} months</td>
                </tr>
              </table>
            </div>
            
            <div style="background: #dbeafe; padding: 15px; border-left: 4px solid #2563eb; margin: 20px 0;">
              <p style="margin: 0;"><strong>⏰ Action Required:</strong> Please accept this sanction within 7 days by clicking the button below or replying "ACCEPT" to our WhatsApp message.</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${pdfUrl}" style="background-color: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                📥 Download Sanction Letter
              </a>
            </div>
            
            <h3 style="color: #1e40af;">Next Steps:</h3>
            <ol style="line-height: 1.8;">
              <li>Review the attached sanction letter carefully</li>
              <li>Accept the sanction (within 7 days)</li>
              <li>Complete pending documentation (if any)</li>
              <li>Sign the loan agreement</li>
              <li>Receive disbursement in your account</li>
            </ol>
            
            <p>Your sanction letter is attached to this email. You can also download it from the button above.</p>
            
            <div style="background: #f3f4f6; padding: 15px; border-radius: 5px; margin-top: 30px;">
              <p style="margin: 0; font-size: 14px;">Need help? Contact us:</p>
              <p style="margin: 5px 0 0 0; font-size: 14px;">
                📧 support@loancompany.com<br>
                📞 1800-XXX-XXXX
              </p>
            </div>
          </div>
          
          <div style="background: #1f2937; color: #9ca3af; padding: 20px; text-align: center; font-size: 12px;">
            <p style="margin: 0;">© 2024 Loan Company. All rights reserved.</p>
            <p style="margin: 10px 0 0 0;">This is an automated email. Please do not reply to this address.</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `Sanction_Letter_${sanction.sanction_number}.pdf`,
          path: pdfUrl
        }
      ]
    };

    // Send via email service (SendGrid, AWS SES, etc.)
    await this.emailService.send(emailContent);
  }

  formatSanctionMessage(sanction, lead, loanDetails) {
    return {
      message: `📧 SANCTION LETTER GENERATED & SENT!

━━━━━━━━━━━━━━━━━━━━
✅ YOUR LOAN IS SANCTIONED
━━━━━━━━━━━━━━━━━━━━

📄 Sanction Number: ${sanction.sanction_number}
📅 Date: ${new Date().toLocaleDateString('en-IN')}

💰 LOAN SUMMARY
━━━━━━━━━━━━━━━━━━━━
Sanctioned Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
Interest Rate: ${sanction.interest_rate}% p.a.
Tenure: ${sanction.tenure_months} months
Monthly EMI: ₹${sanction.emi_amount.toLocaleString('en-IN')}
Total Interest: ₹${loanDetails.totalInterest.toLocaleString('en-IN')}
Total Repayment: ₹${loanDetails.totalRepayment.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
📬 SENT TO YOUR EMAIL
━━━━━━━━━━━━━━━━━━━━

✉️  ${lead.email}

Please check your inbox and spam folder.

━━━━━━━━━━━━━━━━━━━━
⚡ NEXT STEPS
━━━━━━━━━━━━━━━━━━━━

1️⃣ Review the sanction letter
2️⃣ Accept within 7 days
3️⃣ Complete documentation
4️⃣ Receive disbursement

⏰ Valid for 30 days

━━━━━━━━━━━━━━━━━━━━
💬 QUICK ACTIONS
━━━━━━━━━━━━━━━━━━━━

Reply "ACCEPT" - Accept this sanction
Reply "QUESTIONS" - Ask us anything
Reply "STATUS" - Check application status

Thank you for choosing us! 🙏`,
      sanction_number: sanction.sanction_number,
      status: 'completed'
    };
  }

  handleExistingSanction(sanction, message) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('accept')) {
      return this.handleAcceptance(sanction);
    } else if (lowerMessage.includes('reject') || lowerMessage.includes('decline')) {
      return this.handleRejection(sanction);
    } else if (lowerMessage.includes('status')) {
      return this.getStatus(sanction);
    } else {
      return {
        message: `Your loan has been sanctioned!

Sanction Number: ${sanction.sanction_number}
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}

Reply:
• "ACCEPT" to proceed with disbursement
• "STATUS" to check current status
• "QUESTIONS" if you have any queries`
      };
    }
  }

  async handleAcceptance(sanction) {
  await this.supabase
    .from('sanctions')
    .update({ 
      disbursement_status: 'accepted',
      accepted_at: new Date().toISOString()
    })
    .eq('id', sanction.id);

  // Create disbursement task
  await this.supabase
    .from('disbursements')
    .insert({
      sanction_id: sanction.id,
      status: 'pending',
      amount: sanction.sanction_amount,
      scheduled_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Tomorrow
    });

  return {
    message: `✅ SANCTION ACCEPTED!

Thank you for accepting the loan sanction.

━━━━━━━━━━━━━━━━━━━━
🚀 DISBURSEMENT PROCESS
━━━━━━━━━━━━━━━━━━━━

Your loan will be disbursed within 24-48 hours to your registered bank account.

⏳ Next Steps:
━━━━━━━━━━━━━━━━━━━━
1. 📑 Loan Agreement: Our team will send you the agreement for e-signature
2. 💰 Processing Fee: ₹${Math.round(sanction.sanction_amount * 0.01).toLocaleString('en-IN')} (1% of loan amount)
3. 🏦 Bank Transfer: Funds transferred directly to your account
4. 📲 Notification: You'll receive SMS and email confirmation

━━━━━━━━━━━━━━━━━━━━
📞 CONTACT SUPPORT
━━━━━━━━━━━━━━━━━━━━
For urgent queries:
📧 disbursement@loancompany.com
📞 1800-DISBURSE

━━━━━━━━━━━━━━━━━━━━
💳 FIRST EMI DUE
━━━━━━━━━━━━━━━━━━━━
Your first EMI of ₹${sanction.emi_amount.toLocaleString('en-IN')} will be due on the 5th of next month.

Thank you for choosing us! 🙏`,
    accepted: true,
    disbursement_scheduled: true
  };
}

async handleRejection(sanction) {
  await this.supabase
    .from('sanctions')
    .update({ 
      disbursement_status: 'rejected',
      rejected_at: new Date().toISOString()
    })
    .eq('id', sanction.id);

  // Also update application status
  await this.supabase
    .from('applications')
    .update({ status: 'sanction_rejected' })
    .eq('id', sanction.application_id);

  return {
    message: `❌ SANCTION DECLINED

You have declined the loan sanction.

━━━━━━━━━━━━━━━━━━━━
📋 DETAILS
━━━━━━━━━━━━━━━━━━━━
Sanction Number: ${sanction.sanction_number}
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
Declined Date: ${new Date().toLocaleDateString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
🔄 ALTERNATIVES
━━━━━━━━━━━━━━━━━━━━
If you'd like to reconsider:
1. The sanction remains valid for 30 days
2. You can still accept by replying "ACCEPT"
3. Contact us for modified terms

━━━━━━━━━━━━━━━━━━━━
📞 FEEDBACK
━━━━━━━━━━━━━━━━━━━━
We value your feedback. Please let us know:
• Why you declined the offer?
• Would you consider a different amount/tenure?

Reply "FEEDBACK" to share your thoughts.

Thank you for considering us!`,
    rejected: true
  };
}

async getStatus(sanction) {
  const { data: disbursement } = await this.supabase
    .from('disbursements')
    .select('*')
    .eq('sanction_id', sanction.id)
    .single();

  let statusMessage = '';
  let nextSteps = '';

  switch(sanction.disbursement_status) {
    case 'pending':
      statusMessage = `⏳ AWAITING ACCEPTANCE

Sanction Status: Pending your acceptance
Validity: ${this.getDaysRemaining(sanction.created_at)} days remaining`;
      nextSteps = 'Reply "ACCEPT" to proceed with disbursement';
      break;

    case 'accepted':
      if (disbursement) {
        statusMessage = `✅ SANCTION ACCEPTED

Status: Disbursement in progress
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
EMI: ₹${sanction.emi_amount.toLocaleString('en-IN')} monthly
Expected Disbursement: ${new Date(disbursement.scheduled_date).toLocaleDateString('en-IN')}`;
        nextSteps = 'Funds will be transferred within 24-48 hours';
      } else {
        statusMessage = `✅ SANCTION ACCEPTED

Status: Processing disbursement
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}`;
        nextSteps = 'Our team is preparing your disbursement';
      }
      break;

    case 'disbursed':
      statusMessage = `🎉 LOAN DISBURSED

Status: Funds transferred successfully
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
Disbursement Date: ${new Date(sanction.disbursed_at).toLocaleDateString('en-IN')}
First EMI Due: ${this.getNextEMIDate(sanction.disbursed_at)}`;
      nextSteps = 'Check your bank account for the funds';
      break;

    case 'rejected':
      statusMessage = `❌ SANCTION DECLINED

Status: Sanction rejected by you
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
Rejected Date: ${new Date(sanction.rejected_at).toLocaleDateString('en-IN')}`;
      nextSteps = 'The sanction can still be accepted within 30 days';
      break;

    default:
      statusMessage = `📄 SANCTION GENERATED

Status: Sanction letter sent
Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
Sanction Date: ${new Date(sanction.created_at).toLocaleDateString('en-IN')}`;
      nextSteps = 'Reply "ACCEPT" to proceed or "STATUS" for updates';
  }

  return {
    message: `📊 APPLICATION STATUS
━━━━━━━━━━━━━━━━━━━━

${statusMessage}

━━━━━━━━━━━━━━━━━━━━
📋 DETAILS
━━━━━━━━━━━━━━━━━━━━
Sanction Number: ${sanction.sanction_number}
Interest Rate: ${sanction.interest_rate}% p.a.
Tenure: ${sanction.tenure_months} months
Monthly EMI: ₹${sanction.emi_amount.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
🚀 NEXT STEP
━━━━━━━━━━━━━━━━━━━━
${nextSteps}

━━━━━━━━━━━━━━━━━━━━
📞 SUPPORT
━━━━━━━━━━━━━━━━━━━━
Need help? Reply "HELP" or contact:
📧 status@loancompany.com
📞 1800-STATUS`,
    status: sanction.disbursement_status,
    details: {
      amount: sanction.sanction_amount,
      emi: sanction.emi_amount,
      interest_rate: sanction.interest_rate
    }
  };
}

getDaysRemaining(createdAt) {
  const created = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now - created);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return 30 - diffDays;
}

getNextEMIDate(disbursedAt) {
  const disbursed = new Date(disbursedAt);
  // First EMI on 5th of next month
  const nextMonth = new Date(disbursed.getFullYear(), disbursed.getMonth() + 1, 5);
  return nextMonth.toLocaleDateString('en-IN');
}

// Additional helper method for handling questions
async handleQuestions(sanction, lead) {
  return {
    message: `❓ FREQUENTLY ASKED QUESTIONS

━━━━━━━━━━━━━━━━━━━━
💰 ABOUT YOUR LOAN
━━━━━━━━━━━━━━━━━━━━

Q: When will I receive the money?
A: Within 24-48 hours after acceptance

Q: How is EMI calculated?
A: ₹${sanction.emi_amount}/month for ${sanction.tenure_months} months at ${sanction.interest_rate}% interest

Q: Can I prepay the loan?
A: Yes, after 6 EMIs with no foreclosure charges

Q: What are the charges?
A: Only 1% processing fee (₹${Math.round(sanction.sanction_amount * 0.01).toLocaleString('en-IN')})

━━━━━━━━━━━━━━━━━━━━
📄 DOCUMENTS NEEDED
━━━━━━━━━━━━━━━━━━━━

1. Signed sanction letter
2. KYC documents (already submitted)
3. Bank account details (already verified)

━━━━━━━━━━━━━━━━━━━━
⏰ TIMELINE
━━━━━━━━━━━━━━━━━━━━

• Acceptance: Immediate
• Agreement: Within 24 hours
• Disbursement: Within 48 hours
• First EMI: 5th of next month

━━━━━━━━━━━━━━━━━━━━
📞 SPECIFIC QUESTIONS
━━━━━━━━━━━━━━━━━━━━

Reply with your question or choose:
• "CHARGES" - All fees and charges
• "EMI" - EMI schedule and calculation
• "DOCUMENTS" - Required documents
• "PREPAYMENT" - Early repayment options
• "CONTACT" - Talk to relationship manager`,
    show_faq: true
  };
}

// Method to handle feedback
async handleFeedback(sanction, feedback) {
  // Save feedback to database
  await this.supabase
    .from('sanction_feedback')
    .insert({
      sanction_id: sanction.id,
      feedback: feedback,
      created_at: new Date().toISOString()
    });

  return {
    message: `📝 THANK YOU FOR YOUR FEEDBACK!

We value your input and will use it to improve our services.

━━━━━━━━━━━━━━━━━━━━
🔁 RECONSIDERATION
━━━━━━━━━━━━━━━━━━━━

If you'd like to reconsider the loan offer:
1. The sanction is valid for ${this.getDaysRemaining(sanction.created_at)} more days
2. Reply "ACCEPT" anytime to proceed
3. Contact us for modified terms

━━━━━━━━━━━━━━━━━━━━
📊 ALTERNATIVE OFFERS
━━━━━━━━━━━━━━━━━━━━

Would you like us to check for:
• Different loan amount?
• Longer/shorter tenure?
• Lower interest rate?

Reply "ALTERNATIVES" to explore options.

Thank you for your time! 🙏`,
    feedback_received: true
  };
}

// Method to handle document requests
async handleDocumentRequest(sanction) {
  const { data: application } = await this.supabase
    .from('applications')
    .select('*')
    .eq('id', sanction.application_id)
    .single();

  const documentList = [
    '✓ Aadhaar Card (Verified)',
    '✓ PAN Card (Verified)',
    '✓ Bank Statement (Verified)',
    '✓ Income Proof (Verified)',
    '✓ Sanction Letter (Pending signature)',
    '✓ Loan Agreement (Will be sent after acceptance)'
  ];

  return {
    message: `📄 DOCUMENT STATUS

━━━━━━━━━━━━━━━━━━━━
✅ COMPLETED DOCUMENTS
━━━━━━━━━━━━━━━━━━━━

${documentList.join('\n')}

━━━━━━━━━━━━━━━━━━━━
📝 PENDING ACTION
━━━━━━━━━━━━━━━━━━━━

1. Sign and return sanction letter
2. Sign loan agreement (will be sent after acceptance)
3. Provide cancelled cheque (if not already submitted)

━━━━━━━━━━━━━━━━━━━━
📤 HOW TO SUBMIT
━━━━━━━━━━━━━━━━━━━━

• Sanction letter: Reply "ACCEPT" digitally
• Other documents: Email to docs@loancompany.com
• Or upload via WhatsApp

━━━━━━━━━━━━━━━━━━━━
📞 DOCUMENT HELP
━━━━━━━━━━━━━━━━━━━━

Need assistance with documents?
Reply "DOCHELP" or call 1800-DOC-LOAN`,
    documents: documentList,
    pending_count: 2
  };
}

// Main message handler
async handleMessage(conversation, message) {
  const lowerMessage = message.toLowerCase().trim();

  // Check for existing sanction first
  const existingSanction = await this.getExistingSanction(conversation);

  if (existingSanction) {
    // Route to appropriate handler based on message
    if (lowerMessage.includes('accept') || lowerMessage === 'yes') {
      return await this.handleAcceptance(existingSanction);
    } else if (lowerMessage.includes('reject') || lowerMessage.includes('no') || lowerMessage.includes('decline')) {
      return await this.handleRejection(existingSanction);
    } else if (lowerMessage.includes('status') || lowerMessage.includes('update')) {
      return await this.getStatus(existingSanction);
    } else if (lowerMessage.includes('question') || lowerMessage.includes('faq') || lowerMessage.includes('query')) {
      return await this.handleQuestions(existingSanction, conversation.lead);
    } else if (lowerMessage.includes('feedback')) {
      return await this.handleFeedback(existingSanction, message);
    } else if (lowerMessage.includes('doc') || lowerMessage.includes('paper') || lowerMessage.includes('kyc')) {
      return await this.handleDocumentRequest(existingSanction);
    } else if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
      return await this.getHelp(existingSanction);
    } else if (lowerMessage.includes('emi') || lowerMessage.includes('payment')) {
      return await this.getEMIDetails(existingSanction);
    } else if (lowerMessage.includes('charge') || lowerMessage.includes('fee')) {
      return await this.getChargeDetails(existingSanction);
    } else {
      // Default response for unrecognized messages
      return {
        message: `📨 We received your message about your sanctioned loan.

━━━━━━━━━━━━━━━━━━━━
💬 QUICK ACTIONS
━━━━━━━━━━━━━━━━━━━━

Reply with:
• "ACCEPT" - Accept and proceed with disbursement
• "STATUS" - Check current status
• "QUESTIONS" - See FAQs
• "DOCUMENTS" - View document status
• "FEEDBACK" - Share your thoughts
• "HELP" - Contact support

Or type your specific question.`,
        needs_clarification: true
      };
    }
  } else {
    // No existing sanction - generate one
    return await this.generateSanction(conversation);
  }
}

// Helper method for EMI details
async getEMIDetails(sanction) {
  // Calculate amortization schedule
  const schedule = this.calculateAmortizationSchedule(
    sanction.sanction_amount,
    sanction.interest_rate,
    sanction.tenure_months
  );

  const firstYearTotal = schedule.slice(0, 12).reduce((sum, month) => sum + month.emi, 0);
  const firstYearInterest = schedule.slice(0, 12).reduce((sum, month) => sum + month.interest, 0);
  const firstYearPrincipal = schedule.slice(0, 12).reduce((sum, month) => sum + month.principal, 0);

  return {
    message: `💳 EMI DETAILS

━━━━━━━━━━━━━━━━━━━━
📊 BREAKDOWN
━━━━━━━━━━━━━━━━━━━━

Monthly EMI: ₹${sanction.emi_amount.toLocaleString('en-IN')}
Total Tenure: ${sanction.tenure_months} months
Interest Rate: ${sanction.interest_rate}% p.a.

━━━━━━━━━━━━━━━━━━━━
📅 FIRST YEAR SUMMARY
━━━━━━━━━━━━━━━━━━━━

Total Payment: ₹${firstYearTotal.toLocaleString('en-IN')}
• Principal: ₹${firstYearPrincipal.toLocaleString('en-IN')}
• Interest: ₹${firstYearInterest.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
🗓️ PAYMENT SCHEDULE
━━━━━━━━━━━━━━━━━━━━

Due Date: 5th of every month
Mode: Auto-debit from your bank account
Late Fee: 2% per month if missed

━━━━━━━━━━━━━━━━━━━━
🔢 SAMPLE CALCULATION
━━━━━━━━━━━━━━━━━━━━

Month 1:
• EMI: ₹${sanction.emi_amount.toLocaleString('en-IN')}
• Interest: ₹${Math.round(sanction.sanction_amount * (sanction.interest_rate/1200)).toLocaleString('en-IN')}
• Principal: ₹${(sanction.emi_amount - Math.round(sanction.sanction_amount * (sanction.interest_rate/1200))).toLocaleString('en-IN')}

Reply "SCHEDULE" for full amortization table.`,
    emi_details: {
      monthly_emi: sanction.emi_amount,
      total_interest: schedule.reduce((sum, month) => sum + month.interest, 0),
      total_payment: schedule.reduce((sum, month) => sum + month.emi, 0)
    }
  };
}

// Helper method for amortization schedule
calculateAmortizationSchedule(principal, annualRate, tenureMonths) {
  const monthlyRate = annualRate / (12 * 100);
  const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) 
              / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  
  let balance = principal;
  const schedule = [];

  for (let month = 1; month <= tenureMonths; month++) {
    const interest = balance * monthlyRate;
    const principalPayment = emi - interest;
    balance -= principalPayment;

    schedule.push({
      month,
      emi: Math.round(emi),
      principal: Math.round(principalPayment),
      interest: Math.round(interest),
      balance: Math.round(balance)
    });
  }

  return schedule;
}

// Helper method for charge details
async getChargeDetails(sanction) {
  const processingFee = Math.round(sanction.sanction_amount * 0.01);
  const gst = Math.round(processingFee * 0.18);
  const totalCharges = processingFee + gst;

  return {
    message: `💰 CHARGES & FEES

━━━━━━━━━━━━━━━━━━━━
📋 ALL CHARGES
━━━━━━━━━━━━━━━━━━━━

1. Processing Fee: ₹${processingFee.toLocaleString('en-IN')}
   (1% of loan amount)

2. GST @18%: ₹${gst.toLocaleString('en-IN')}

3. Total Charges: ₹${totalCharges.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
💸 WHEN TO PAY
━━━━━━━━━━━━━━━━━━━━

Processing fee is deducted from the loan amount before disbursement.

Example:
• Loan Amount: ₹${sanction.sanction_amount.toLocaleString('en-IN')}
• Charges: ₹${totalCharges.toLocaleString('en-IN')}
• Amount Credited: ₹${(sanction.sanction_amount - totalCharges).toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
🚫 NO OTHER CHARGES
━━━━━━━━━━━━━━━━━━━━

No hidden charges for:
• Prepayment (after 6 months)
• Part payment
• Loan closure
• Statement generation
• Customer service

━━━━━━━━━━━━━━━━━━━━
⚠️ LATE PAYMENT
━━━━━━━━━━━━━━━━━━━━

Late EMI payment: 2% per month
Example: ₹${sanction.emi_amount.toLocaleString('en-IN')} EMI
Late fee: ₹${Math.round(sanction.emi_amount * 0.02).toLocaleString('en-IN')}/month`,
    charges: {
      processing_fee: processingFee,
      gst: gst,
      total: totalCharges
    }
  };
}

// Helper method for general help
async getHelp(sanction) {
  return {
    message: `🆘 HOW CAN WE HELP?

━━━━━━━━━━━━━━━━━━━━
📞 CONTACT OPTIONS
━━━━━━━━━━━━━━━━━━━━

Immediate Assistance:
📧 support@loancompany.com
📞 1800-HELP-LOAN
💬 WhatsApp: +91-XXXXXXXXXX

━━━━━━━━━━━━━━━━━━━━
👤 RELATIONSHIP MANAGER
━━━━━━━━━━━━━━━━━━━━

Assigned to you:
Name: Mr. Rahul Sharma
📞 +91-9876543210
📧 rahul.sharma@loancompany.com

━━━━━━━━━━━━━━━━━━━━
⏰ WORKING HOURS
━━━━━━━━━━━━━━━━━━━━

Monday-Saturday: 9 AM - 7 PM
Sunday: 10 AM - 4 PM
24/7 WhatsApp support

━━━━━━━━━━━━━━━━━━━━
🔧 QUICK RESOLUTION
━━━━━━━━━━━━━━━━━━━━

For faster help, mention:
• Sanction Number: ${sanction.sanction_number}
• Your Name: ${sanction.applications?.leads?.name || 'Customer'}
• Mobile Number: ${sanction.applications?.leads?.mobile || 'Registered mobile'}

We're here to help! 🙏`,
    contact_info: {
      email: 'support@loancompany.com',
      phone: '1800-HELP-LOAN',
      whatsapp: '+91-XXXXXXXXXX',
      rm_name: 'Mr. Rahul Sharma',
      rm_contact: '+91-9876543210'
    }
  };
}

}