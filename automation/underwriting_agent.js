class UnderwritingAgent {
  constructor(config) {
    this.supabase = config.supabase;
    this.logger = config.logger || console;
    this.cibilApiKey = config.cibilApiKey;
  }

  async process(conversation, message) {
    // Get application details
    const application = await this.getApplicationWithDetails(conversation);
    
    // Check if underwriting already done
    const existing = await this.getExistingUnderwriting(application.id);
    
    if (existing) {
      return this.formatUnderwritingResult(existing, application);
    }

    // Perform underwriting
    return await this.performUnderwriting(application);
  }

  async getApplicationWithDetails(conversation) {
    const { data } = await this.supabase
      .from('applications')
      .select(`
        *,
        leads (*),
        documents (*)
      `)
      .eq('leads.conversation_id', conversation.id)
      .single();

    return data;
  }

  async getExistingUnderwriting(applicationId) {
    const { data } = await this.supabase
      .from('underwriting')
      .select('*')
      .eq('application_id', applicationId)
      .single();

    return data;
  }

  async performUnderwriting(application) {
    try {
      const lead = application.leads;
      const documents = application.documents;

      // Step 1: Get PAN from documents
      const panDoc = documents.find(d => d.document_type === 'PAN');
      if (!panDoc || !panDoc.verified_data) {
        throw new Error('PAN document not verified');
      }

      const panNumber = panDoc.verified_data.pan_number;

      // Step 2: Fetch credit score
      const creditReport = await this.fetchCreditScore(panNumber, lead);

      // Step 3: Calculate DTI ratio
      const dtiRatio = this.calculateDTI(
        creditReport.monthly_obligations,
        creditReport.monthly_income,
        lead.loan_amount,
        lead.loan_tenure
      );

      // Step 4: Assess risk and make decision
      const decision = this.assessRisk(
        creditReport.credit_score,
        dtiRatio,
        lead.loan_amount,
        lead.loan_tenure
      );

      // Step 5: Save underwriting record
      const { data: underwriting } = await this.supabase
        .from('underwriting')
        .insert({
          application_id: application.id,
          credit_score: creditReport.credit_score,
          dti_ratio: dtiRatio,
          risk_assessment: decision.risk_level,
          approved_amount: decision.approved_amount,
          interest_rate: decision.interest_rate,
          decision: decision.status,
          decision_reason: decision.reason
        })
        .select()
        .single();

      // Step 6: Update application status
      await this.supabase
        .from('applications')
        .update({ status: decision.status.toLowerCase() })
        .eq('id', application.id);

      // Step 7: Update conversation stage if approved
      if (decision.status === 'APPROVED') {
        await this.supabase
          .from('conversations')
          .update({ 
            current_stage: 'sanction',
            current_agent: 'sanction'
          })
          .eq('id', application.conversation_id);
      }

      return this.formatUnderwritingResult(underwriting, application);

    } catch (error) {
      this.logger.error('Underwriting error:', error);
      return {
        message: '⚠️ We encountered an issue processing your application. Our team will review manually and get back to you within 24 hours.',
        error: true
      };
    }
  }

  async fetchCreditScore(panNumber, lead) {
    try {
      const response = await fetch('https://api.cibil.com/v2/credit-report', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.cibilApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pan: panNumber,
          name: lead.name,
          mobile: lead.mobile,
          consent: true
        })
      });

      const data = await response.json();

      return {
        credit_score: data.score || 650,
        monthly_obligations: data.total_monthly_obligations || 0,
        monthly_income: data.declared_income || 50000,
        credit_history_length: data.history_months || 24,
        enquiries_last_6_months: data.enquiries_count || 0,
        defaults: data.defaults_count || 0
      };

    } catch (error) {
      this.logger.error('Credit score fetch error:', error);
      
      // Return default values for testing
      return {
        credit_score: 680,
        monthly_obligations: 5000,
        monthly_income: 50000,
        credit_history_length: 36,
        enquiries_last_6_months: 2,
        defaults: 0
      };
    }
  }

  calculateDTI(existingObligations, monthlyIncome, loanAmount, tenure) {
    // Calculate EMI for requested loan
    const annualRate = 10; // Default rate for calculation
    const monthlyRate = annualRate / (12 * 100);
    
    const emi = (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, tenure)) 
                / (Math.pow(1 + monthlyRate, tenure) - 1);

    // DTI = (Existing + New EMI) / Income * 100
    const totalObligations = existingObligations + emi;
    const dti = (totalObligations / monthlyIncome) * 100;

    return parseFloat(dti.toFixed(2));
  }

  assessRisk(creditScore, dtiRatio, requestedAmount, tenure) {
    let decision = {
      status: 'REJECTED',
      risk_level: 'HIGH',
      approved_amount: 0,
      interest_rate: 0,
      reason: ''
    };

    // Excellent profile
    if (creditScore >= 750 && dtiRatio < 40) {
      decision = {
        status: 'APPROVED',
        risk_level: 'LOW',
        approved_amount: requestedAmount,
        interest_rate: 8.5,
        reason: 'Excellent credit profile with strong repayment capacity. Full amount approved at best rate.'
      };
    }
    // Very good profile
    else if (creditScore >= 700 && dtiRatio < 45) {
      decision = {
        status: 'APPROVED',
        risk_level: 'LOW',
        approved_amount: requestedAmount,
        interest_rate: 9.5,
        reason: 'Strong credit score with good debt management. Approved at competitive rate.'
      };
    }
    // Good profile
    else if (creditScore >= 680 && dtiRatio < 50) {
      decision = {
        status: 'APPROVED',
        risk_level: 'MEDIUM',
        approved_amount: Math.floor(requestedAmount * 0.9), // 90% of requested
        interest_rate: 10.5,
        reason: 'Good credit standing. Approved for 90% of requested amount.'
      };
    }
    // Moderate profile
    else if (creditScore >= 650 && dtiRatio < 50) {
      decision = {
        status: 'APPROVED',
        risk_level: 'MEDIUM',
        approved_amount: Math.floor(requestedAmount * 0.8), // 80% of requested
        interest_rate: 11.5,
        reason: 'Moderate risk profile. Approved for 80% of requested amount with adjusted rate.'
      };
    }
    // Acceptable profile
    else if (creditScore >= 620 && dtiRatio < 55) {
      decision = {
        status: 'APPROVED',
        risk_level: 'MEDIUM',
        approved_amount: Math.floor(requestedAmount * 0.6), // 60% of requested
        interest_rate: 13.0,
        reason: 'Higher risk profile. Approved for 60% of requested amount.'
      };
    }
    // High risk
    else if (creditScore < 600) {
      decision = {
        status: 'REJECTED',
        risk_level: 'HIGH',
        approved_amount: 0,
        interest_rate: 0,
        reason: 'Credit score below minimum threshold (600). We recommend improving your credit score and reapplying in 3-6 months.'
      };
    }
    // High DTI
    else if (dtiRatio >= 55) {
      decision = {
        status: 'REJECTED',
        risk_level: 'HIGH',
        approved_amount: 0,
        interest_rate: 0,
        reason: 'Debt-to-income ratio exceeds acceptable limit. Consider reducing existing obligations or applying for a lower amount.'
      };
    }

    return decision;
  }

  formatUnderwritingResult(underwriting, application) {
    const isApproved = underwriting.decision === 'APPROVED';

    if (isApproved) {
      const emi = this.calculateEMI(
        underwriting.approved_amount,
        underwriting.interest_rate,
        application.leads.loan_tenure
      );

      return {
        message: `🎉 CONGRATULATIONS! Your Loan is APPROVED!

━━━━━━━━━━━━━━━━━━━━
📊 CREDIT ASSESSMENT RESULTS
━━━━━━━━━━━━━━━━━━━━

✅ Decision: APPROVED
🎯 Risk Level: ${underwriting.risk_assessment}
📈 Credit Score: ${underwriting.credit_score}
📊 DTI Ratio: ${underwriting.dti_ratio}%

━━━━━━━━━━━━━━━━━━━━
💰 LOAN DETAILS
━━━━━━━━━━━━━━━━━━━━

Requested Amount: ₹${application.leads.loan_amount.toLocaleString('en-IN')}
Approved Amount: ₹${underwriting.approved_amount.toLocaleString('en-IN')}
Interest Rate: ${underwriting.interest_rate}% p.a.
Tenure: ${application.leads.loan_tenure} months
Monthly EMI: ₹${emi.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
📄 NEXT STEPS
━━━━━━━━━━━━━━━━━━━━

1️⃣ Sanction letter will be generated
2️⃣ You'll receive it via email
3️⃣ Review and accept the terms
4️⃣ Disbursement within 24 hours

${underwriting.decision_reason}

⏱️ Generating your sanction letter now...`,
        decision: 'APPROVED',
        next_stage: 'sanction'
      };
    } else {
      return {
        message: `❌ LOAN APPLICATION STATUS

━━━━━━━━━━━━━━━━━━━━
📊 ASSESSMENT RESULTS
━━━━━━━━━━━━━━━━━━━━

Decision: NOT APPROVED
Credit Score: ${underwriting.credit_score}
DTI Ratio: ${underwriting.dti_ratio}%
Risk Level: ${underwriting.risk_assessment}

━━━━━━━━━━━━━━━━━━━━
📝 REASON
━━━━━━━━━━━━━━━━━━━━

${underwriting.decision_reason}

━━━━━━━━━━━━━━━━━━━━
💡 RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━

To improve your chances:

1️⃣ Improve Credit Score
   • Pay all bills on time
   • Reduce credit card utilization
   • Clear any defaults

2️⃣ Reduce Debt Burden
   • Pay down existing loans
   • Avoid new credit enquiries
   • Consolidate high-interest debt

3️⃣ Increase Income
   • Document additional income sources
   • Consider a co-applicant

4️⃣ Apply for Lower Amount
   • Start with a smaller loan
   • Build credit history

━━━━━━━━━━━━━━━━━━━━

You can reapply after 3-6 months once you've improved your profile.

Need clarification? Reply "help" for assistance.`,
        decision: 'REJECTED'
      };
    }
  }

  calculateEMI(principal, annualRate, tenureMonths) {
    const monthlyRate = annualRate / (12 * 100);
    const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) 
                / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
    return Math.round(emi);
  }
}
module.exports = {
  name: "Underwriting Agent",
  type: "agent",
  handler: UnderwritingAgent
};
