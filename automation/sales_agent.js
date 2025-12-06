class SalesAgent {
  constructor(config) {
    this.supabase = config.supabase;
    this.openai = config.openai;
    this.logger = config.logger || console;
    
    this.requiredFields = [
      'loan_amount',
      'loan_purpose', 
      'loan_tenure',
      'name',
      'mobile',
      'email'
    ];
  }

  async process(conversation, message) {
    const sessionData = conversation.session_data || {};
    
    // Step 1: Extract information using AI
    const extracted = await this.extractInformation(message, sessionData);
    
    // Step 2: Merge with existing session data
    const updatedSession = { ...sessionData, ...extracted };
    
    // Step 3: Check if all required fields are collected
    const missingFields = this.getMissingFields(updatedSession);
    
    // Step 4: Update conversation
    await this.updateConversation(conversation.id, updatedSession);
    
    // Step 5: Decide next action
    if (missingFields.length === 0) {
      return await this.completeLeadCapture(conversation, updatedSession);
    } else {
      return await this.askNextQuestion(missingFields, updatedSession);
    }
  }

  async extractInformation(message, sessionData) {
    const prompt = `You are a loan sales assistant. Extract loan information from the user's message.

Current session data: ${JSON.stringify(sessionData)}
User message: "${message}"

Extract any of these fields that are mentioned:
- loan_amount: numeric value (convert lakhs to actual number, e.g., "5 lakhs" = 500000)
- loan_purpose: text description
- loan_tenure: number of months
- name: full name
- mobile: 10-digit phone number
- email: email address

Return ONLY valid JSON with extracted fields:
{
  "loan_amount": 500000,
  "loan_purpose": "home renovation",
  "loan_tenure": 24,
  "name": "John Doe",
  "mobile": "9876543210",
  "email": "john@example.com"
}

Only include fields that were explicitly mentioned. If nothing was extracted, return empty object {}.`;

    try {
      const response = await this.callOpenAI(prompt);
      const extracted = JSON.parse(response);
      
      // Validate and clean extracted data
      return this.validateExtractedData(extracted);
      
    } catch (error) {
      this.logger.error('AI extraction error:', error);
      return {};
    }
  }

  async callOpenAI(prompt) {
    // This would be replaced with actual OpenAI API call
    // For n8n, this would be an HTTP Request node
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  validateExtractedData(data) {
    const validated = {};

    // Validate loan_amount
    if (data.loan_amount) {
      const amount = parseInt(data.loan_amount);
      if (amount >= 10000 && amount <= 10000000) {
        validated.loan_amount = amount;
      }
    }

    // Validate loan_tenure
    if (data.loan_tenure) {
      const tenure = parseInt(data.loan_tenure);
      if (tenure >= 6 && tenure <= 84) {
        validated.loan_tenure = tenure;
      }
    }

    // Validate mobile
    if (data.mobile) {
      const mobile = data.mobile.replace(/\D/g, '');
      if (mobile.length === 10 && mobile[0] >= '6') {
        validated.mobile = mobile;
      }
    }

    // Validate email
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(data.email)) {
        validated.email = data.email.toLowerCase();
      }
    }

    // Copy other fields as-is if they exist
    if (data.loan_purpose) validated.loan_purpose = data.loan_purpose;
    if (data.name) validated.name = data.name;

    return validated;
  }

  getMissingFields(sessionData) {
    return this.requiredFields.filter(field => !sessionData[field]);
  }

  async updateConversation(conversationId, sessionData) {
    await this.supabase
      .from('conversations')
      .update({ 
        session_data: sessionData,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);
  }

  async completeLeadCapture(conversation, sessionData) {
    // Create lead record
    const { data: lead } = await this.supabase
      .from('leads')
      .insert({
        conversation_id: conversation.id,
        name: sessionData.name,
        mobile: sessionData.mobile,
        email: sessionData.email,
        loan_amount: sessionData.loan_amount,
        loan_purpose: sessionData.loan_purpose,
        loan_tenure: sessionData.loan_tenure,
        status: 'initiated'
      })
      .select()
      .single();

    // Move to verification stage
    await this.supabase
      .from('conversations')
      .update({ 
        current_stage: 'verification',
        current_agent: 'verification',
        updated_at: new Date().toISOString()
      })
      .eq('id', conversation.id);

    return {
      message: `Perfect! I've captured all your details.

📋 Application Summary:
━━━━━━━━━━━━━━━━━━━━
👤 Name: ${sessionData.name}
📱 Mobile: ${sessionData.mobile}
📧 Email: ${sessionData.email}
💰 Loan Amount: ₹${sessionData.loan_amount.toLocaleString('en-IN')}
🎯 Purpose: ${sessionData.loan_purpose}
📅 Tenure: ${sessionData.loan_tenure} months

✅ Lead ID: ${lead.id}

━━━━━━━━━━━━━━━━━━━━
📄 Next Step: Document Verification

I'll need you to upload:
1️⃣ PAN Card (clear photo)
2️⃣ Aadhaar Card (both sides)

Ready to proceed? Reply 'yes' to continue.`,
      lead_id: lead.id,
      next_stage: 'verification'
    };
  }

  async askNextQuestion(missingFields, sessionData) {
    const field = missingFields[0];
    let question = '';

    switch (field) {
      case 'loan_amount':
        question = '💰 How much loan amount do you need? (e.g., 5 lakhs, 10 lakhs)';
        break;
      case 'loan_purpose':
        question = '🎯 What is the purpose of this loan? (e.g., home renovation, education, business)';
        break;
      case 'loan_tenure':
        question = '📅 For how many months would you like the loan? (e.g., 12, 24, 36 months)';
        break;
      case 'name':
        question = '👤 May I have your full name please?';
        break;
      case 'mobile':
        question = '📱 Please share your 10-digit mobile number.';
        break;
      case 'email':
        question = '📧 What\'s your email address?';
        break;
      default:
        question = 'Could you provide more information?';
    }

    // Add context if some fields are already collected
    const collected = this.requiredFields.filter(f => sessionData[f]);
    let context = '';
    
    if (collected.length > 0) {
      context = `\n\n✓ Already collected: ${collected.length}/${this.requiredFields.length} fields`;
    }

    return {
      message: question + context,
      missing_fields: missingFields,
      progress: `${collected.length}/${this.requiredFields.length}`
    };
  }
}
module.exports = {
  name: "Sales Agent",
  type: "agent",
  handler: SalesAgent
};
