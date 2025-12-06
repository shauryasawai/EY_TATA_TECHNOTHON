class VerificationAgent {
  constructor(config) {
    this.supabase = config.supabase;
    this.logger = config.logger || console;
    this.surepassApiKey = config.surepassApiKey;
  }

  async process(conversation, message) {
    // Get or create application
    const application = await this.getOrCreateApplication(conversation);
    
    // Check document status
    const documents = await this.getDocuments(application.id);
    
    // Parse user intent
    const intent = this.parseIntent(message);
    
    // Handle based on intent and current document status
    if (intent === 'ready' || intent === 'yes') {
      return await this.promptForDocuments(application, documents);
    } else if (intent === 'status') {
      return await this.getDocumentStatus(application, documents);
    } else {
      // Provide guidance
      return await this.provideGuidance(application, documents);
    }
  }

  async getOrCreateApplication(conversation) {
    // Get lead for this conversation
    const { data: lead } = await this.supabase
      .from('leads')
      .select('*')
      .eq('conversation_id', conversation.id)
      .single();

    if (!lead) {
      throw new Error('No lead found for this conversation');
    }

    // Check if application exists
    const { data: existingApp } = await this.supabase
      .from('applications')
      .select('*')
      .eq('lead_id', lead.id)
      .single();

    if (existingApp) {
      return existingApp;
    }

    // Create new application
    const appNumber = this.generateApplicationNumber();
    
    const { data: newApp } = await this.supabase
      .from('applications')
      .insert({
        lead_id: lead.id,
        application_number: appNumber,
        status: 'pending'
      })
      .select()
      .single();

    return newApp;
  }

  generateApplicationNumber() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `LN${timestamp}${random}`;
  }

  async getDocuments(applicationId) {
    const { data } = await this.supabase
      .from('documents')
      .select('*')
      .eq('application_id', applicationId);

    return data || [];
  }

  parseIntent(message) {
    const lower = message.toLowerCase();
    
    if (lower.includes('ready') || lower === 'yes' || lower.includes('proceed')) {
      return 'ready';
    }
    if (lower.includes('status') || lower.includes('check')) {
      return 'status';
    }
    return 'unknown';
  }

  async promptForDocuments(application, documents) {
    const panDoc = documents.find(d => d.document_type === 'PAN');
    const aadhaarDoc = documents.find(d => d.document_type === 'AADHAAR');

    let message = `📄 Document Upload - Application #${application.application_number}\n\n`;

    if (!panDoc) {
      message += `📌 Step 1: Upload PAN Card

Please send a clear photo of your PAN card.

Requirements:
✓ All details clearly visible
✓ No blur or glare
✓ Full card in frame

Just send the image, I'll automatically process it.`;
    } else if (panDoc.verification_status === 'pending') {
      message += `🔄 Your PAN card is being verified...\n\nPlease wait a moment.`;
    } else if (panDoc.verification_status === 'verified' && !aadhaarDoc) {
      message += `✅ PAN Card verified successfully!

📌 Step 2: Upload Aadhaar Card

Please send photos of BOTH sides of your Aadhaar card.

Requirements:
✓ Front and back clearly visible
✓ All 12 digits readable
✓ No masking or covering

Send the first side now.`;
    } else if (aadhaarDoc && aadhaarDoc.verification_status === 'pending') {
      message += `🔄 Your Aadhaar is being verified...\n\nPlease wait a moment.`;
    } else if (panDoc.verification_status === 'verified' && aadhaarDoc.verification_status === 'verified') {
      // Both verified - move to underwriting
      return await this.moveToUnderwriting(application);
    }

    return { message };
  }

  async getDocumentStatus(application, documents) {
    let status = `📊 Document Status - Application #${application.application_number}\n\n`;

    const panDoc = documents.find(d => d.document_type === 'PAN');
    const aadhaarDoc = documents.find(d => d.document_type === 'AADHAAR');

    status += `1️⃣ PAN Card: ${this.formatDocStatus(panDoc)}\n`;
    status += `2️⃣ Aadhaar Card: ${this.formatDocStatus(aadhaarDoc)}\n\n`;

    if (panDoc?.verification_status === 'verified' && aadhaarDoc?.verification_status === 'verified') {
      status += '✅ All documents verified! Moving to underwriting...';
    } else {
      status += '💡 Reply "upload" to continue with document submission.';
    }

    return { message: status };
  }

  formatDocStatus(doc) {
    if (!doc) return '⏳ Not uploaded';
    if (doc.verification_status === 'pending') return '🔄 Verifying...';
    if (doc.verification_status === 'verified') return '✅ Verified';
    if (doc.verification_status === 'failed') return '❌ Failed - Please re-upload';
    return '⏳ Unknown';
  }

  async provideGuidance(application, documents) {
    return {
      message: `📄 Document Verification Guide

Application #${application.application_number}

You need to upload:
1️⃣ PAN Card
2️⃣ Aadhaar Card (both sides)

📸 Photo Guidelines:
• Good lighting, no shadows
• All text clearly readable
• Full document in frame
• No blur or glare

Reply "ready" when you want to start uploading.
Reply "status" to check your progress.`
    };
  }

  async moveToUnderwriting(application) {
    // Update application status
    await this.supabase
      .from('applications')
      .update({ status: 'verified' })
      .eq('id', application.id);

    // Update conversation stage
    await this.supabase
      .from('conversations')
      .update({ 
        current_stage: 'underwriting',
        current_agent: 'underwriting'
      })
      .eq('id', application.conversation_id);

    return {
      message: `✅ All documents verified successfully!

━━━━━━━━━━━━━━━━━━━━
🔍 Moving to Credit Assessment

Our underwriting team will now:
• Check your credit score
• Assess your loan eligibility
• Calculate your loan terms

⏱️ This usually takes 2-5 minutes.

You'll be notified once the assessment is complete.`,
      next_stage: 'underwriting'
    };
  }

  // Called separately when documents are uploaded via webhook
  async handleDocumentUpload(applicationId, documentType, fileData) {
    try {
      // Step 1: Store document in Supabase Storage
      const fileName = `${applicationId}/${documentType}_${Date.now()}.jpg`;
      
      const { data: uploadData, error: uploadError } = await this.supabase
        .storage
        .from('loan-documents')
        .upload(fileName, fileData);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = this.supabase
        .storage
        .from('loan-documents')
        .getPublicUrl(fileName);

      // Step 2: Create document record
      const { data: docRecord } = await this.supabase
        .from('documents')
        .insert({
          application_id: applicationId,
          document_type: documentType,
          document_url: urlData.publicUrl,
          verification_status: 'pending'
        })
        .select()
        .single();

      // Step 3: Verify document
      const verificationResult = await this.verifyDocument(documentType, fileData);

      // Step 4: Update verification status
      await this.supabase
        .from('documents')
        .update({
          verification_status: verificationResult.success ? 'verified' : 'failed',
          verified_data: verificationResult.data,
          verified_at: new Date().toISOString()
        })
        .eq('id', docRecord.id);

      return {
        success: true,
        document_id: docRecord.id,
        verification: verificationResult
      };

    } catch (error) {
      this.logger.error('Document upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async verifyDocument(documentType, fileData) {
    // This would call actual verification API
    // For now, returning mock data
    
    if (documentType === 'PAN') {
      return await this.verifyPAN(fileData);
    } else if (documentType === 'AADHAAR') {
      return await this.verifyAadhaar(fileData);
    }
    
    return { success: false, error: 'Unknown document type' };
  }

  async verifyPAN(fileData) {
    try {
      // Call Surepass PAN verification API
      const response = await fetch('https://api.surepass.io/api/v1/pan/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.surepassApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id_number: 'extracted_from_ocr', // You'd use OCR first
          name: 'name_from_application'
        })
      });

      const result = await response.json();

      return {
        success: result.success,
        data: {
          pan_number: result.data.pan_number,
          name: result.data.name,
          dob: result.data.dob,
          verified_at: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error('PAN verification error:', error);
      return { success: false, error: error.message };
    }
  }

  async verifyAadhaar(fileData) {
    try {
      // Call Surepass Aadhaar verification API
      const response = await fetch('https://api.surepass.io/api/v1/aadhaar/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.surepassApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id_number: 'extracted_from_ocr',
          name: 'name_from_application'
        })
      });

      const result = await response.json();

      return {
        success: result.success,
        data: {
          aadhaar_number: result.data.aadhaar_number,
          name: result.data.name,
          address: result.data.address,
          verified_at: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error('Aadhaar verification error:', error);
      return { success: false, error: error.message };
    }
  }
}
module.exports = {
  name: "Verification Agent",
  type: "agent",
  handler: VerificationAgent
};
