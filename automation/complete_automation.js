// Complete Loan Automation Workflow for n8n
module.exports = {
  name: "Complete Loan Automation Workflow",
  nodes: [
    // ============================================
    // ENTRY POINT - WEBHOOK
    // ============================================
    {
      parameters: {
        httpMethod: "POST",
        path: "loan-webhook",
        responseMode: "responseNode",
        options: {}
      },
      name: "Webhook - Incoming Message",
      type: "n8n-nodes-base.webhook",
      typeVersion: 1,
      position: [250, 300],
      webhookId: "loan-webhook-entry"
    },

    // ============================================
    // MASTER ORCHESTRATOR
    // ============================================
    {
      parameters: {
        functionCode: `// Master Orchestrator - Entry Point
const payload = $input.item.json;
const { user_id, message, channel } = payload;

return {
  user_id,
  message,
  channel,
  timestamp: new Date().toISOString()
};`
      },
      name: "Parse Webhook Input",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [450, 300]
    },

    {
      parameters: {
        functionCode: `// Get or Create Conversation
const user_id = $input.item.json.user_id;
const channel = $input.item.json.channel;

return {
  query: {
    table: 'conversations',
    select: '*',
    filter: {
      user_id: user_id
    },
    order: {
      column: 'created_at',
      ascending: false
    },
    limit: 1
  },
  user_id,
  channel,
  message: $input.item.json.message
};`
      },
      name: "Get Existing Conversation",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [650, 300]
    },

    {
      parameters: {
        resource: "row",
        operation: "get",
        tableId: "={{$json.query.table}}",
        filters: {
          conditions: [
            {
              keyName: "user_id",
              keyValue: "={{$json.user_id}}"
            }
          ]
        }
      },
      name: "Supabase - Get Conversation",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [850, 300]
    },

    {
      parameters: {
        conditions: {
          boolean: [
            {
              value1: "={{$json.data}}",
              value2: "null",
              operation: "notEqual"
            }
          ]
        }
      },
      name: "Conversation Exists?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [1050, 300]
    },

    {
      parameters: {
        functionCode: `// Create New Conversation
const user_id = $input.item.json.user_id;
const channel = $input.item.json.channel;

return {
  insert: {
    table: 'conversations',
    data: {
      user_id: user_id,
      channel: channel,
      current_stage: 'initial',
      current_agent: 'sales',
      session_data: {},
      created_at: new Date().toISOString()
    }
  },
  user_id,
  channel,
  message: $input.item.json.message
};`
      },
      name: "Create New Conversation",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [1250, 400]
    },

    {
      parameters: {
        resource: "row",
        operation: "create",
        tableId: "conversations",
        fieldsUi: {
          fieldValues: [
            {
              fieldName: "user_id",
              fieldValue: "={{$json.user_id}}"
            },
            {
              fieldName: "channel",
              fieldValue: "={{$json.channel}}"
            },
            {
              fieldName: "current_stage",
              fieldValue: "initial"
            },
            {
              fieldName: "current_agent",
              fieldValue: "sales"
            },
            {
              fieldName: "session_data",
              fieldValue: "{}"
            }
          ]
        }
      },
      name: "Supabase - Create Conversation",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [1450, 400]
    },

    {
      parameters: {
        functionCode: `// Log Incoming Message
const conversation = $input.item.json.conversation || $input.item.json.data;
const message = $input.item.json.message;

return {
  insert: {
    table: 'conversation_messages',
    data: {
      conversation_id: conversation.id,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    }
  },
  conversation,
  message
};`
      },
      name: "Log User Message",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [1650, 300]
    },

    {
      parameters: {
        functionCode: `// Route to Agent Based on Stage
const conversation = $input.item.json.conversation;
const message = $input.item.json.message;
const stage = conversation.current_stage;

return {
  conversation,
  message,
  stage,
  route: stage || 'sales'
};`
      },
      name: "Route to Agent",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [1850, 300]
    },

    {
      parameters: {
        conditions: {
          string: [
            {
              value1: "={{$json.route}}",
              operation: "equals"
            }
          ]
        }
      },
      name: "Stage Router",
      type: "n8n-nodes-base.switch",
      typeVersion: 1,
      position: [2050, 300]
    },

    // ============================================
    // SALES AGENT
    // ============================================
    {
      parameters: {
        functionCode: `// Sales Agent - Extract Information with AI
const conversation = $input.item.json.conversation;
const message = $input.item.json.message;
const sessionData = conversation.session_data || {};

const prompt = \`You are a loan sales assistant. Extract loan information from the user's message.

Current session data: \${JSON.stringify(sessionData)}
User message: "\${message}"

Extract any of these fields that are mentioned:
- loan_amount: numeric value (convert lakhs to actual number, e.g., "5 lakhs" = 500000)
- loan_purpose: text description
- loan_tenure: number of months
- name: full name
- mobile: 10-digit phone number
- email: email address

Return ONLY valid JSON with extracted fields. Only include fields explicitly mentioned.
If nothing was extracted, return empty object {}.\`;

return {
  conversation,
  message,
  sessionData,
  prompt,
  aiRequest: {
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 500
  }
};`
      },
      name: "Sales - Prepare AI Extraction",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2250, 100]
    },

    {
      parameters: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "openAiApi",
        sendBody: true,
        bodyParameters: {
          parameters: [
            {
              name: "model",
              value: "={{$json.aiRequest.model}}"
            },
            {
              name: "messages",
              value: "={{$json.aiRequest.messages}}"
            },
            {
              name: "temperature",
              value: "={{$json.aiRequest.temperature}}"
            },
            {
              name: "max_tokens",
              value: "={{$json.aiRequest.max_tokens}}"
            }
          ]
        }
      },
      name: "OpenAI - Extract Info",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 3,
      position: [2450, 100]
    },

    {
      parameters: {
        functionCode: `// Sales - Validate and Merge Data
const conversation = $input.item.json.conversation;
const sessionData = $input.item.json.sessionData;
const aiResponse = $input.item.json.choices[0].message.content;

let extracted = {};
try {
  extracted = JSON.parse(aiResponse.trim());
} catch (e) {
  extracted = {};
}

// Validate extracted data
const validated = {};

if (extracted.loan_amount) {
  const amount = parseInt(extracted.loan_amount);
  if (amount >= 10000 && amount <= 10000000) {
    validated.loan_amount = amount;
  }
}

if (extracted.loan_tenure) {
  const tenure = parseInt(extracted.loan_tenure);
  if (tenure >= 6 && tenure <= 84) {
    validated.loan_tenure = tenure;
  }
}

if (extracted.mobile) {
  const mobile = extracted.mobile.replace(/\\D/g, '');
  if (mobile.length === 10 && mobile[0] >= '6') {
    validated.mobile = mobile;
  }
}

if (extracted.email) {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  if (emailRegex.test(extracted.email)) {
    validated.email = extracted.email.toLowerCase();
  }
}

if (extracted.loan_purpose) validated.loan_purpose = extracted.loan_purpose;
if (extracted.name) validated.name = extracted.name;

// Merge with existing session data
const updatedSession = { ...sessionData, ...validated };

// Check missing fields
const requiredFields = ['loan_amount', 'loan_purpose', 'loan_tenure', 'name', 'mobile', 'email'];
const missingFields = requiredFields.filter(field => !updatedSession[field]);

return {
  conversation,
  updatedSession,
  missingFields,
  allCollected: missingFields.length === 0
};`
      },
      name: "Sales - Validate & Merge",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2650, 100]
    },

    {
      parameters: {
        conditions: {
          boolean: [
            {
              value1: "={{$json.allCollected}}",
              value2: true,
              operation: "equal"
            }
          ]
        }
      },
      name: "Sales - All Fields Collected?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [2850, 100]
    },

    {
      parameters: {
        functionCode: `// Sales - Ask Next Question
const missingFields = $input.item.json.missingFields;
const updatedSession = $input.item.json.updatedSession;
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
    question = '📧 What\\'s your email address?';
    break;
  default:
    question = 'Could you provide more information?';
}

const requiredFields = ['loan_amount', 'loan_purpose', 'loan_tenure', 'name', 'mobile', 'email'];
const collected = requiredFields.filter(f => updatedSession[f]);

return {
  message: question + \`\\n\\n✓ Progress: \${collected.length}/\${requiredFields.length} fields collected\`,
  updateSession: updatedSession,
  conversationId: $input.item.json.conversation.id
};`
      },
      name: "Sales - Ask Question",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3050, 200]
    },

    {
      parameters: {
        functionCode: `// Sales - Complete Lead Capture
const conversation = $input.item.json.conversation;
const sessionData = $input.item.json.updatedSession;

return {
  lead: {
    conversation_id: conversation.id,
    name: sessionData.name,
    mobile: sessionData.mobile,
    email: sessionData.email,
    loan_amount: sessionData.loan_amount,
    loan_purpose: sessionData.loan_purpose,
    loan_tenure: sessionData.loan_tenure,
    status: 'initiated',
    created_at: new Date().toISOString()
  },
  sessionData,
  conversationId: conversation.id
};`
      },
      name: "Sales - Create Lead",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3050, 100]
    },

    {
      parameters: {
        resource: "row",
        operation: "create",
        tableId: "leads",
        fieldsUi: {
          fieldValues: [
            {
              fieldName: "conversation_id",
              fieldValue: "={{$json.lead.conversation_id}}"
            },
            {
              fieldName: "name",
              fieldValue: "={{$json.lead.name}}"
            },
            {
              fieldName: "mobile",
              fieldValue: "={{$json.lead.mobile}}"
            },
            {
              fieldName: "email",
              fieldValue: "={{$json.lead.email}}"
            },
            {
              fieldName: "loan_amount",
              fieldValue: "={{$json.lead.loan_amount}}"
            },
            {
              fieldName: "loan_purpose",
              fieldValue: "={{$json.lead.loan_purpose}}"
            },
            {
              fieldName: "loan_tenure",
              fieldValue: "={{$json.lead.loan_tenure}}"
            },
            {
              fieldName: "status",
              fieldValue: "initiated"
            }
          ]
        }
      },
      name: "Supabase - Create Lead",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [3250, 100]
    },

    {
      parameters: {
        functionCode: `// Sales - Format Success Message
const lead = $input.item.json;
const sessionData = $input.item.json.sessionData;

return {
  message: \`Perfect! I've captured all your details.

📋 Application Summary:
━━━━━━━━━━━━━━━━━━━━
👤 Name: \${sessionData.name}
📱 Mobile: \${sessionData.mobile}
📧 Email: \${sessionData.email}
💰 Loan Amount: ₹\${sessionData.loan_amount.toLocaleString('en-IN')}
🎯 Purpose: \${sessionData.loan_purpose}
📅 Tenure: \${sessionData.loan_tenure} months

✅ Lead ID: \${lead.id}

━━━━━━━━━━━━━━━━━━━━
📄 Next Step: Document Verification

I'll need you to upload:
1️⃣ PAN Card (clear photo)
2️⃣ Aadhaar Card (both sides)

Ready to proceed? Reply 'yes' to continue.\`,
  conversationUpdate: {
    current_stage: 'verification',
    current_agent: 'verification',
    session_data: sessionData
  },
  conversationId: $input.item.json.conversationId
};`
      },
      name: "Sales - Format Message",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3450, 100]
    },

    // ============================================
    // VERIFICATION AGENT
    // ============================================
    {
      parameters: {
        functionCode: `// Verification - Get Application
const conversation = $input.item.json.conversation;
const message = $input.item.json.message;

return {
  query: {
    table: 'leads',
    select: '*',
    filter: {
      conversation_id: conversation.id
    },
    single: true
  },
  conversation,
  message
};`
      },
      name: "Verification - Get Lead",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2250, 300]
    },

    {
      parameters: {
        functionCode: `// Verification - Get or Create Application
const lead = $input.item.json.lead;
const conversation = $input.item.json.conversation;

const appNumber = 'LN' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');

return {
  application: {
    lead_id: lead.id,
    application_number: appNumber,
    status: 'pending',
    created_at: new Date().toISOString()
  },
  conversation,
  message: $input.item.json.message
};`
      },
      name: "Verification - Create Application",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2450, 300]
    },

    {
      parameters: {
        functionCode: `// Verification - Parse Intent
const message = $input.item.json.message;
const lower = message.toLowerCase();

let intent = 'unknown';

if (lower.includes('ready') || lower === 'yes' || lower.includes('proceed')) {
  intent = 'ready';
} else if (lower.includes('status') || lower.includes('check')) {
  intent = 'status';
}

return {
  ...($input.item.json),
  intent
};`
      },
      name: "Verification - Parse Intent",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2650, 300]
    },

    {
      parameters: {
        functionCode: `// Verification - Prompt for Documents
const application = $input.item.json.application;

return {
  message: \`📄 Document Upload - Application #\${application.application_number}

📌 Step 1: Upload PAN Card

Please send a clear photo of your PAN card.

Requirements:
✓ All details clearly visible
✓ No blur or glare
✓ Full card in frame

Just send the image, I'll automatically process it.\`,
  application
};`
      },
      name: "Verification - Document Prompt",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2850, 300]
    },

    // ============================================
    // UNDERWRITING AGENT
    // ============================================
    {
      parameters: {
        functionCode: `// Underwriting - Get Application Details
const conversation = $input.item.json.conversation;

return {
  query: {
    table: 'applications',
    select: '*, leads(*), documents(*)',
    filter: {
      'leads.conversation_id': conversation.id
    },
    single: true
  },
  conversation
};`
      },
      name: "Underwriting - Get App",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2250, 500]
    },

    {
      parameters: {
        functionCode: `// Underwriting - Calculate DTI and Risk
const application = $input.item.json.application;
const lead = application.leads;
const documents = application.documents;

// Mock credit data (would come from API)
const creditScore = 680;
const monthlyIncome = 50000;
const existingObligations = 5000;

// Calculate EMI
const loanAmount = lead.loan_amount;
const tenure = lead.loan_tenure;
const annualRate = 10;
const monthlyRate = annualRate / (12 * 100);

const emi = (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, tenure)) 
            / (Math.pow(1 + monthlyRate, tenure) - 1);

// Calculate DTI
const totalObligations = existingObligations + emi;
const dtiRatio = (totalObligations / monthlyIncome) * 100;

// Assess Risk
let decision = {
  status: 'REJECTED',
  risk_level: 'HIGH',
  approved_amount: 0,
  interest_rate: 0,
  reason: ''
};

if (creditScore >= 750 && dtiRatio < 40) {
  decision = {
    status: 'APPROVED',
    risk_level: 'LOW',
    approved_amount: loanAmount,
    interest_rate: 8.5,
    reason: 'Excellent credit profile with strong repayment capacity.'
  };
} else if (creditScore >= 700 && dtiRatio < 45) {
  decision = {
    status: 'APPROVED',
    risk_level: 'LOW',
    approved_amount: loanAmount,
    interest_rate: 9.5,
    reason: 'Strong credit score with good debt management.'
  };
} else if (creditScore >= 680 && dtiRatio < 50) {
  decision = {
    status: 'APPROVED',
    risk_level: 'MEDIUM',
    approved_amount: Math.floor(loanAmount * 0.9),
    interest_rate: 10.5,
    reason: 'Good credit standing. Approved for 90% of requested amount.'
  };
} else if (creditScore >= 650 && dtiRatio < 50) {
  decision = {
    status: 'APPROVED',
    risk_level: 'MEDIUM',
    approved_amount: Math.floor(loanAmount * 0.8),
    interest_rate: 11.5,
    reason: 'Moderate risk profile. Approved for 80% of requested amount.'
  };
} else if (creditScore < 600) {
  decision.reason = 'Credit score below minimum threshold (600).';
} else if (dtiRatio >= 55) {
  decision.reason = 'Debt-to-income ratio exceeds acceptable limit.';
}

return {
  underwriting: {
    application_id: application.id,
    credit_score: creditScore,
    dti_ratio: parseFloat(dtiRatio.toFixed(2)),
    risk_assessment: decision.risk_level,
    approved_amount: decision.approved_amount,
    interest_rate: decision.interest_rate,
    decision: decision.status,
    decision_reason: decision.reason,
    created_at: new Date().toISOString()
  },
  application,
  lead
};`
      },
      name: "Underwriting - Assess Risk",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2450, 500]
    },

    {
      parameters: {
        resource: "row",
        operation: "create",
        tableId: "underwriting",
        fieldsUi: {
          fieldValues: [
            {
              fieldName: "application_id",
              fieldValue: "={{$json.underwriting.application_id}}"
            },
            {
              fieldName: "credit_score",
              fieldValue: "={{$json.underwriting.credit_score}}"
            },
            {
              fieldName: "dti_ratio",
              fieldValue: "={{$json.underwriting.dti_ratio}}"
            },
            {
              fieldName: "risk_assessment",
              fieldValue: "={{$json.underwriting.risk_assessment}}"
            },
            {
              fieldName: "approved_amount",
              fieldValue: "={{$json.underwriting.approved_amount}}"
            },
            {
              fieldName: "interest_rate",
              fieldValue: "={{$json.underwriting.interest_rate}}"
            },
            {
              fieldName: "decision",
              fieldValue: "={{$json.underwriting.decision}}"
            },
            {
              fieldName: "decision_reason",
              fieldValue: "={{$json.underwriting.decision_reason}}"
            }
          ]
        }
      },
      name: "Supabase - Save Underwriting",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [2650, 500]
    },

    {
      parameters: {
        conditions: {
          string: [
            {
              value1: "={{$json.underwriting.decision}}",
              value2: "APPROVED",
              operation: "equals"
            }
          ]
        }
      },
      name: "Underwriting - Approved?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [2850, 500]
    },

    {
      parameters: {
        functionCode: `// Underwriting - Format Approved Message
const underwriting = $input.item.json.underwriting;
const lead = $input.item.json.lead;

const monthlyRate = underwriting.interest_rate / (12 * 100);
const emi = (underwriting.approved_amount * monthlyRate * Math.pow(1 + monthlyRate, lead.loan_tenure)) 
            / (Math.pow(1 + monthlyRate, lead.loan_tenure) - 1);

return {
  message: \`🎉 CONGRATULATIONS! Your Loan is APPROVED!

━━━━━━━━━━━━━━━━━━━━
📊 CREDIT ASSESSMENT RESULTS
━━━━━━━━━━━━━━━━━━━━

✅ Decision: APPROVED
🎯 Risk Level: \${underwriting.risk_assessment}
📈 Credit Score: \${underwriting.credit_score}
📊 DTI Ratio: \${underwriting.dti_ratio}%

━━━━━━━━━━━━━━━━━━━━
💰 LOAN DETAILS
━━━━━━━━━━━━━━━━━━━━

Requested Amount: ₹\${lead.loan_amount.toLocaleString('en-IN')}
Approved Amount: ₹\${underwriting.approved_amount.toLocaleString('en-IN')}
Interest Rate: \${underwriting.interest_rate}% p.a.
Tenure: \${lead.loan_tenure} months
Monthly EMI: ₹\${Math.round(emi).toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
📄 NEXT STEPS
━━━━━━━━━━━━━━━━━━━━

1️⃣ Sanction letter will be generated
2️⃣ You'll receive it via email
3️⃣ Review and accept the terms
4️⃣ Disbursement within 24 hours

\${underwriting.decision_reason}

⏱️ Generating your sanction letter now...\`,
  conversationUpdate: {
    current_stage: 'sanction',
    current_agent: 'sanction'
  }
};`
      },
      name: "Underwriting - Approved Message",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3050, 450]
    },

    {
      parameters: {
        functionCode: `// Underwriting - Format Rejected Message
const underwriting = $input.item.json.underwriting;

return {
  message: \`❌ LOAN APPLICATION STATUS

━━━━━━━━━━━━━━━━━━━━
📊 ASSESSMENT RESULTS
━━━━━━━━━━━━━━━━━━━━

Decision: NOT APPROVED
Credit Score: \${underwriting.credit_score}
DTI Ratio: \${underwriting.dti_ratio}%
Risk Level: \${underwriting.risk_assessment}

━━━━━━━━━━━━━━━━━━━━
📝 REASON
━━━━━━━━━━━━━━━━━━━━

\${underwriting.decision_reason}

━━━━━━━━━━━━━━━━━━━━
💡 RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━

To improve your chances:
1️⃣ Improve Credit Score
2️⃣ Reduce Debt Burden
3️⃣ Increase Income
4️⃣ Apply for Lower Amount

You can reapply after 3-6 months.\`
};`
      },
      name: "Underwriting - Rejected Message",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3050, 550]
    },

    // ============================================
    // SANCTION AGENT
    // ============================================
    {
      parameters: {
        functionCode: `// Sanction - Get Approved Application
const conversation = $input.item.json.conversation;

return {
  query: {
    table: 'applications',
    select: '*, leads(*), underwriting(*)',
    filter: {
      'leads.conversation_id': conversation.id,
      'status': 'approved',
      'underwriting.decision': 'APPROVED'
    },
    single: true
  },
  conversation
};`
      },
      name: "Sanction - Get Approved App",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2250, 700]
    },

    {
      parameters: {
        functionCode: `// Sanction - Calculate Loan Details
const application = $input.item.json.application;
const lead = application.leads;
const underwriting = application.underwriting;

const principal = underwriting.approved_amount;
const annualRate = underwriting.interest_rate;
const tenureMonths = lead.loan_tenure;

const monthlyRate = annualRate / (12 * 100);
const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) 
            / (Math.pow(1 + monthlyRate, tenureMonths) - 1);

const roundedEmi = Math.round(emi);
const totalRepayment = roundedEmi * tenureMonths;
const totalInterest = totalRepayment - principal;
const processingFee = Math.round(principal * 0.01);

const sanctionNumber = 'SN' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');

return {
  application,
  lead,
  underwriting,
  loanDetails: {
    emi: roundedEmi,
    totalRepayment,
    totalInterest,
    processingFee
  },
  sanctionNumber
};`
      },
      name: "Sanction - Calculate Details",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2450, 700]
    },

    {
      parameters: {
        functionCode: `// Sanction - Generate HTML Letter
const data = $input.item.json;
const { sanctionNumber, lead, underwriting, loanDetails, application } = data;

const html = \`<!DOCTYPE html>
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
    </style>
</head>
<body>
    <div class="header">
        <div class="company-name">LOAN COMPANY NAME</div>
        <div>Email: loans@company.com | Phone: 1800-XXX-XXXX</div>
    </div>
    <div style="text-align: right;">
        <strong>Date:</strong> \${new Date().toLocaleDateString('en-IN')}<br>
        <strong>Sanction Number:</strong> \${sanctionNumber}
    </div>
    <h2 style="text-align: center; margin: 30px 0;">LOAN SANCTION LETTER</h2>
    <p>Dear \${lead.name},</p>
    <p>We are pleased to inform you that your loan application has been approved.</p>
    <h3>Loan Details</h3>
    <table>
        <tr><td>Loan Amount</td><td>₹\${underwriting.approved_amount.toLocaleString('en-IN')}</td></tr>
        <tr><td>Interest Rate</td><td>\${underwriting.interest_rate}% per annum</td></tr>
        <tr><td>Tenure</td><td>\${lead.loan_tenure} months</td></tr>
        <tr><td>Monthly EMI</td><td>₹\${loanDetails.emi.toLocaleString('en-IN')}</td></tr>
        <tr><td>Total Repayment</td><td>₹\${loanDetails.totalRepayment.toLocaleString('en-IN')}</td></tr>
        <tr><td>Processing Fee</td><td>₹\${loanDetails.processingFee.toLocaleString('en-IN')}</td></tr>
    </table>
</body>
</html>\`;

return {
  ...data,
  html,
  fileName: \`\${sanctionNumber}.html\`
};`
      },
      name: "Sanction - Generate HTML",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2650, 700]
    },

    {
      parameters: {
        resource: "file",
        operation: "upload",
        bucketName: "loan-documents",
        fileName: "={{$json.fileName}}",
        fileContent: "={{$json.html}}",
        options: {
          contentType: "text/html"
        }
      },
      name: "Supabase - Upload Sanction Letter",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [2850, 700]
    },

    {
      parameters: {
        functionCode: `// Sanction - Save Record
const data = $input.item.json;
const pdfUrl = data.publicUrl || data.path;

return {
  sanction: {
    application_id: data.application.id,
    sanction_number: data.sanctionNumber,
    sanction_amount: data.underwriting.approved_amount,
    interest_rate: data.underwriting.interest_rate,
    tenure_months: data.lead.loan_tenure,
    emi_amount: data.loanDetails.emi,
    sanction_letter_url: pdfUrl,
    disbursement_status: 'pending',
    created_at: new Date().toISOString()
  },
  lead: data.lead,
  loanDetails: data.loanDetails,
  sanctionNumber: data.sanctionNumber
};`
      },
      name: "Sanction - Prepare Record",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3050, 700]
    },

    {
      parameters: {
        resource: "row",
        operation: "create",
        tableId: "sanctions",
        fieldsUi: {
          fieldValues: [
            {
              fieldName: "application_id",
              fieldValue: "={{$json.sanction.application_id}}"
            },
            {
              fieldName: "sanction_number",
              fieldValue: "={{$json.sanction.sanction_number}}"
            },
            {
              fieldName: "sanction_amount",
              fieldValue: "={{$json.sanction.sanction_amount}}"
            },
            {
              fieldName: "interest_rate",
              fieldValue: "={{$json.sanction.interest_rate}}"
            },
            {
              fieldName: "tenure_months",
              fieldValue: "={{$json.sanction.tenure_months}}"
            },
            {
              fieldName: "emi_amount",
              fieldValue: "={{$json.sanction.emi_amount}}"
            },
            {
              fieldName: "sanction_letter_url",
              fieldValue: "={{$json.sanction.sanction_letter_url}}"
            },
            {
              fieldName: "disbursement_status",
              fieldValue: "pending"
            }
          ]
        }
      },
      name: "Supabase - Save Sanction",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [3250, 700]
    },

    {
      parameters: {
        functionCode: `// Sanction - Format Success Message
const sanction = $input.item.json;
const lead = sanction.lead;
const loanDetails = sanction.loanDetails;

return {
  message: \`📧 SANCTION LETTER GENERATED & SENT!

━━━━━━━━━━━━━━━━━━━━
✅ YOUR LOAN IS SANCTIONED
━━━━━━━━━━━━━━━━━━━━

📄 Sanction Number: \${sanction.sanction_number}
📅 Date: \${new Date().toLocaleDateString('en-IN')}

💰 LOAN SUMMARY
━━━━━━━━━━━━━━━━━━━━
Sanctioned Amount: ₹\${sanction.sanction_amount.toLocaleString('en-IN')}
Interest Rate: \${sanction.interest_rate}% p.a.
Tenure: \${sanction.tenure_months} months
Monthly EMI: ₹\${sanction.emi_amount.toLocaleString('en-IN')}
Total Interest: ₹\${loanDetails.totalInterest.toLocaleString('en-IN')}
Total Repayment: ₹\${loanDetails.totalRepayment.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
📬 SENT TO YOUR EMAIL
━━━━━━━━━━━━━━━━━━━━

✉️  \${lead.email}

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

Thank you for choosing us! 🙏\`,
  conversationUpdate: {
    current_stage: 'completed',
    current_agent: 'none'
  }
};`
      },
      name: "Sanction - Format Message",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3450, 700]
    },

    {
      parameters: {
        fromEmail: "loans@yourcompany.com",
        toEmail: "={{$json.lead.email}}",
        subject: "Loan Sanctioned! - {{$json.sanction_number}}",
        emailType: "html",
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #2563eb; color: white; padding: 30px; text-align: center;">
    <h1>🎉 Congratulations!</h1>
    <p>Your Loan has been Sanctioned</p>
  </div>
  <div style="padding: 30px;">
    <p>Dear {{$json.lead.name}},</p>
    <p>Your loan application has been approved!</p>
    <div style="background: white; padding: 20px; margin: 20px 0;">
      <h3>Loan Summary</h3>
      <p><strong>Amount:</strong> ₹{{$json.sanction_amount}}</p>
      <p><strong>EMI:</strong> ₹{{$json.emi_amount}}</p>
      <p><strong>Tenure:</strong> {{$json.tenure_months}} months</p>
    </div>
  </div>
</div>`,
        options: {}
      },
      name: "Send Sanction Email",
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2,
      position: [3650, 700]
    },

    // ============================================
    // SANCTION EXISTING HANDLERS
    // ============================================
    {
      parameters: {
        functionCode: `// Sanction - Check Existing
const conversation = $input.item.json.conversation;
const message = $input.item.json.message;

return {
  query: {
    table: 'sanctions',
    select: '*, applications(*, leads(*), underwriting(*))',
    filter: {
      'applications.leads.conversation_id': conversation.id
    },
    single: true
  },
  conversation,
  message
};`
      },
      name: "Sanction - Check Existing",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2250, 900]
    },

    {
      parameters: {
        conditions: {
          boolean: [
            {
              value1: "={{$json.data}}",
              value2: "null",
              operation: "notEqual"
            }
          ]
        }
      },
      name: "Sanction - Exists?",
      type: "n8n-nodes-base.if",
      typeVersion: 1,
      position: [2450, 900]
    },

    {
      parameters: {
        functionCode: `// Sanction - Route Existing Message
const sanction = $input.item.json.data;
const message = $input.item.json.message;
const lowerMessage = message.toLowerCase();

let action = 'default';

if (lowerMessage.includes('accept') || lowerMessage === 'yes') {
  action = 'accept';
} else if (lowerMessage.includes('reject') || lowerMessage.includes('decline')) {
  action = 'reject';
} else if (lowerMessage.includes('status')) {
  action = 'status';
} else if (lowerMessage.includes('question') || lowerMessage.includes('faq')) {
  action = 'questions';
} else if (lowerMessage.includes('emi')) {
  action = 'emi';
} else if (lowerMessage.includes('charge') || lowerMessage.includes('fee')) {
  action = 'charges';
}

return {
  sanction,
  action,
  message
};`
      },
      name: "Sanction - Route Action",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2650, 850]
    },

    {
      parameters: {
        functionCode: `// Sanction - Handle Accept
const sanction = $input.item.json.sanction;

return {
  update: {
    disbursement_status: 'accepted',
    accepted_at: new Date().toISOString()
  },
  sanctionId: sanction.id,
  sanction
};`
      },
      name: "Sanction - Accept Logic",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [2850, 750]
    },

    {
      parameters: {
        resource: "row",
        operation: "update",
        tableId: "sanctions",
        updateKey: "id",
        id: "={{$json.sanctionId}}",
        fieldsUi: {
          fieldValues: [
            {
              fieldName: "disbursement_status",
              fieldValue: "accepted"
            },
            {
              fieldName: "accepted_at",
              fieldValue: "={{$json.update.accepted_at}}"
            }
          ]
        }
      },
      name: "Supabase - Update Accept",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [3050, 750]
    },

    {
      parameters: {
        functionCode: `// Sanction - Accept Message
const sanction = $input.item.json.sanction;

return {
  message: \`✅ SANCTION ACCEPTED!

Thank you for accepting the loan sanction.

━━━━━━━━━━━━━━━━━━━━
🚀 DISBURSEMENT PROCESS
━━━━━━━━━━━━━━━━━━━━

Your loan will be disbursed within 24-48 hours.

⏳ Next Steps:
1. 📑 Loan Agreement: Will be sent for e-signature
2. 💰 Processing Fee: ₹\${Math.round(sanction.sanction_amount * 0.01).toLocaleString('en-IN')}
3. 🏦 Bank Transfer: Direct to your account
4. 📲 Notification: SMS and email confirmation

━━━━━━━━━━━━━━━━━━━━
💳 FIRST EMI DUE
━━━━━━━━━━━━━━━━━━━━
₹\${sanction.emi_amount.toLocaleString('en-IN')} on 5th of next month.

Thank you! 🙏\`
};`
      },
      name: "Sanction - Accept Response",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3250, 750]
    },

    {
      parameters: {
        functionCode: `// Sanction - Handle Reject
const sanction = $input.item.json.sanction;

return {
  message: \`❌ SANCTION DECLINED

━━━━━━━━━━━━━━━━━━━━
📋 DETAILS
━━━━━━━━━━━━━━━━━━━━
Sanction Number: \${sanction.sanction_number}
Amount: ₹\${sanction.sanction_amount.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
🔄 ALTERNATIVES
━━━━━━━━━━━━━━━━━━━━
The sanction remains valid for 30 days.
You can still accept by replying "ACCEPT"

Thank you for considering us!\`
};`
      },
      name: "Sanction - Reject Response",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3250, 850]
    },

    {
      parameters: {
        functionCode: `// Sanction - Status Response
const sanction = $input.item.json.sanction;

let statusMessage = '';
let nextSteps = '';

switch(sanction.disbursement_status) {
  case 'pending':
    statusMessage = \`⏳ AWAITING ACCEPTANCE
Sanction Status: Pending your acceptance\`;
    nextSteps = 'Reply "ACCEPT" to proceed';
    break;
  case 'accepted':
    statusMessage = \`✅ SANCTION ACCEPTED
Status: Disbursement in progress\`;
    nextSteps = 'Funds will be transferred within 24-48 hours';
    break;
  case 'rejected':
    statusMessage = \`❌ SANCTION DECLINED
Status: Rejected by you\`;
    nextSteps = 'Can still be accepted within 30 days';
    break;
}

return {
  message: \`📊 APPLICATION STATUS
━━━━━━━━━━━━━━━━━━━━

\${statusMessage}

━━━━━━━━━━━━━━━━━━━━
📋 DETAILS
━━━━━━━━━━━━━━━━━━━━
Sanction Number: \${sanction.sanction_number}
Amount: ₹\${sanction.sanction_amount.toLocaleString('en-IN')}
Monthly EMI: ₹\${sanction.emi_amount.toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━
🚀 NEXT STEP
━━━━━━━━━━━━━━━━━━━━
\${nextSteps}\`
};`
      },
      name: "Sanction - Status Response",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3250, 950]
    },

    {
      parameters: {
        functionCode: `// Sanction - Default Response
const sanction = $input.item.json.sanction;

return {
  message: \`📨 Your sanctioned loan details:

Sanction Number: \${sanction.sanction_number}
Amount: ₹\${sanction.sanction_amount.toLocaleString('en-IN')}

Reply:
• "ACCEPT" - Accept and proceed
• "STATUS" - Check status
• "QUESTIONS" - See FAQs
• "HELP" - Contact support\`
};`
      },
      name: "Sanction - Default Response",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3250, 1050]
    },

    // ============================================
    // UPDATE CONVERSATION & RESPONSE
    // ============================================
    {
      parameters: {
        functionCode: `// Merge All Responses
const items = $input.all();
const response = items[0].json;

return {
  message: response.message,
  conversationId: response.conversationId || items[0].json.conversation?.id,
  conversationUpdate: response.conversationUpdate || {},
  timestamp: new Date().toISOString()
};`
      },
      name: "Merge Response",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [3850, 300]
    },

    {
      parameters: {
        resource: "row",
        operation: "update",
        tableId: "conversations",
        updateKey: "id",
        id: "={{$json.conversationId}}",
        fieldsUi: {
          fieldValues: [
            {
              fieldName: "current_stage",
              fieldValue: "={{$json.conversationUpdate.current_stage}}"
            },
            {
              fieldName: "current_agent",
              fieldValue: "={{$json.conversationUpdate.current_agent}}"
            },
            {
              fieldName: "session_data",
              fieldValue: "={{$json.conversationUpdate.session_data}}"
            },
            {
              fieldName: "updated_at",
              fieldValue: "={{$json.timestamp}}"
            }
          ]
        }
      },
      name: "Update Conversation",
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [4050, 300]
    },

    {
      parameters: {
        functionCode: `// Log Assistant Response
const message = $input.item.json.message;
const conversationId = $input.item.json.conversationId;

return {
  insert: {
    conversation_id: conversationId,
    role: 'assistant',
    content: message,
    timestamp: new Date().toISOString()
  },
  message
};`
      },
      name: "Log Assistant Message",
      type: "n8n-nodes-base.code",
      typeVersion: 1,
      position: [4250, 300]
    },

    {
      parameters: {
        respondWith: "json",
        responseBody: "={{ { message: $json.message, success: true } }}"
      },
      name: "Send Response",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1,
      position: [4450, 300]
    }
  ],

  // ============================================
  // CONNECTIONS
  // ============================================
  connections: {
    "Webhook - Incoming Message": {
      main: [[{ node: "Parse Webhook Input", type: "main", index: 0 }]]
    },
    "Parse Webhook Input": {
      main: [[{ node: "Get Existing Conversation", type: "main", index: 0 }]]
    },
    "Get Existing Conversation": {
      main: [[{ node: "Supabase - Get Conversation", type: "main", index: 0 }]]
    },
    "Supabase - Get Conversation": {
      main: [[{ node: "Conversation Exists?", type: "main", index: 0 }]]
    },
    "Conversation Exists?": {
      main: [
        [{ node: "Log User Message", type: "main", index: 0 }],
        [{ node: "Create New Conversation", type: "main", index: 0 }]
      ]
    },
    "Create New Conversation": {
      main: [[{ node: "Supabase - Create Conversation", type: "main", index: 0 }]]
    },
    "Supabase - Create Conversation": {
      main: [[{ node: "Log User Message", type: "main", index: 0 }]]
    },
    "Log User Message": {
      main: [[{ node: "Route to Agent", type: "main", index: 0 }]]
    },
    "Route to Agent": {
      main: [[{ node: "Stage Router", type: "main", index: 0 }]]
    },
    "Stage Router": {
      main: [
        [{ node: "Sales - Prepare AI Extraction", type: "main", index: 0 }],
        [{ node: "Verification - Get Lead", type: "main", index: 0 }],
        [{ node: "Underwriting - Get App", type: "main", index: 0 }],
        [{ node: "Sanction - Check Existing", type: "main", index: 0 }]
      ]
    },
    
    // Sales Agent Flow
    "Sales - Prepare AI Extraction": {
      main: [[{ node: "OpenAI - Extract Info", type: "main", index: 0 }]]
    },
    "OpenAI - Extract Info": {
      main: [[{ node: "Sales - Validate & Merge", type: "main", index: 0 }]]
    },
    "Sales - Validate & Merge": {
      main: [[{ node: "Sales - All Fields Collected?", type: "main", index: 0 }]]
    },
    "Sales - All Fields Collected?": {
      main: [
        [{ node: "Sales - Create Lead", type: "main", index: 0 }],
        [{ node: "Sales - Ask Question", type: "main", index: 0 }]
      ]
    },
    "Sales - Create Lead": {
      main: [[{ node: "Supabase - Create Lead", type: "main", index: 0 }]]
    },
    "Supabase - Create Lead": {
      main: [[{ node: "Sales - Format Message", type: "main", index: 0 }]]
    },
    "Sales - Format Message": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },
    "Sales - Ask Question": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },

    // Verification Agent Flow
    "Verification - Get Lead": {
      main: [[{ node: "Verification - Create Application", type: "main", index: 0 }]]
    },
    "Verification - Create Application": {
      main: [[{ node: "Verification - Parse Intent", type: "main", index: 0 }]]
    },
    "Verification - Parse Intent": {
      main: [[{ node: "Verification - Document Prompt", type: "main", index: 0 }]]
    },
    "Verification - Document Prompt": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },

    // Underwriting Agent Flow
    "Underwriting - Get App": {
      main: [[{ node: "Underwriting - Assess Risk", type: "main", index: 0 }]]
    },
    "Underwriting - Assess Risk": {
      main: [[{ node: "Supabase - Save Underwriting", type: "main", index: 0 }]]
    },
    "Supabase - Save Underwriting": {
      main: [[{ node: "Underwriting - Approved?", type: "main", index: 0 }]]
    },
    "Underwriting - Approved?": {
      main: [
        [{ node: "Underwriting - Approved Message", type: "main", index: 0 }],
        [{ node: "Underwriting - Rejected Message", type: "main", index: 0 }]
      ]
    },
    "Underwriting - Approved Message": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },
    "Underwriting - Rejected Message": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },

    // Sanction Agent Flow - New
    "Sanction - Get Approved App": {
      main: [[{ node: "Sanction - Calculate Details", type: "main", index: 0 }]]
    },
    "Sanction - Calculate Details": {
      main: [[{ node: "Sanction - Generate HTML", type: "main", index: 0 }]]
    },
    "Sanction - Generate HTML": {
      main: [[{ node: "Supabase - Upload Sanction Letter", type: "main", index: 0 }]]
    },
    "Supabase - Upload Sanction Letter": {
      main: [[{ node: "Sanction - Prepare Record", type: "main", index: 0 }]]
    },
    "Sanction - Prepare Record": {
      main: [[{ node: "Supabase - Save Sanction", type: "main", index: 0 }]]
    },
    "Supabase - Save Sanction": {
      main: [[{ node: "Sanction - Format Message", type: "main", index: 0 }]]
    },
    "Sanction - Format Message": {
      main: [
        [{ node: "Send Sanction Email", type: "main", index: 0 }],
        [{ node: "Merge Response", type: "main", index: 0 }]
      ]
    },

    // Sanction Agent Flow - Existing
    "Sanction - Check Existing": {
      main: [[{ node: "Sanction - Exists?", type: "main", index: 0 }]]
    },
    "Sanction - Exists?": {
      main: [
        [{ node: "Sanction - Route Action", type: "main", index: 0 }],
        [{ node: "Sanction - Get Approved App", type: "main", index: 0 }]
      ]
    },
    "Sanction - Route Action": {
      main: [
      [{ node: "Sanction - Accept Logic", type: "main", index: 0 }],
        [{ node: "Sanction - Reject Response", type: "main", index: 0 }],
        [{ node: "Sanction - Status Response", type: "main", index: 0 }],
        [{ node: "Sanction - Default Response", type: "main", index: 0 }]
      ]
    },
    "Sanction - Accept Logic": {
      main: [[{ node: "Supabase - Update Accept", type: "main", index: 0 }]]
    },
    "Supabase - Update Accept": {
      main: [[{ node: "Sanction - Accept Response", type: "main", index: 0 }]]
    },
    "Sanction - Accept Response": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },
    "Sanction - Reject Response": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },
    "Sanction - Status Response": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },
    "Sanction - Default Response": {
      main: [[{ node: "Merge Response", type: "main", index: 0 }]]
    },

    // Final Response Flow
    "Merge Response": {
      main: [[{ node: "Update Conversation", type: "main", index: 0 }]]
    },
    "Update Conversation": {
      main: [[{ node: "Log Assistant Message", type: "main", index: 0 }]]
    },
    "Log Assistant Message": {
      main: [[{ node: "Send Response", type: "main", index: 0 }]]
    }
  },

  settings: {
    executionOrder: "v1",
    saveExecutionProgress: true,
    saveManualExecutions: true
  },
  staticData: null,
  tags: [],
  triggerCount: 1,
  updatedAt: new Date().toISOString(),
  versionId: "1.0.0"
};