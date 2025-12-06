class MasterOrchestratorAgent {
  constructor(config) {
    this.supabase = config.supabase;
    this.logger = config.logger || console;
  }

  async handleMessage(payload) {
    const { user_id, message, channel } = payload;
    
    try {
      // Step 1: Get or create conversation
      const conversation = await this.getOrCreateConversation(user_id, channel);
      
      // Step 2: Log the incoming message
      await this.logMessage(conversation.id, 'user', message);
      
      // Step 3: Route to appropriate agent based on current stage
      const response = await this.routeToAgent(conversation, message);
      
      // Step 4: Log the response
      await this.logMessage(conversation.id, 'assistant', response.message);
      
      return response;
      
    } catch (error) {
      this.logger.error('Master orchestrator error:', error);
      return {
        message: "I'm sorry, I encountered an error. Please try again.",
        error: true
      };
    }
  }

  async getOrCreateConversation(user_id, channel) {
    // Check if conversation exists
    const { data: existing } = await this.supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      return existing[0];
    }

    // Create new conversation
    const { data: newConv } = await this.supabase
      .from('conversations')
      .insert({
        user_id,
        channel,
        current_stage: 'initial',
        current_agent: 'sales',
        session_data: {}
      })
      .select()
      .single();

    return newConv;
  }

  async logMessage(conversation_id, role, content) {
    // Optional: Log to a messages table for audit trail
    await this.supabase
      .from('conversation_messages')
      .insert({
        conversation_id,
        role,
        content,
        timestamp: new Date().toISOString()
      });
  }

  async routeToAgent(conversation, message) {
    const { current_stage, current_agent } = conversation;

    // Route based on current stage
    switch (current_stage) {
      case 'initial':
      case 'sales':
        return await this.routeToSalesAgent(conversation, message);
      
      case 'verification':
        return await this.routeToVerificationAgent(conversation, message);
      
      case 'underwriting':
        return await this.routeToUnderwritingAgent(conversation, message);
      
      case 'sanction':
        return await this.routeToSanctionAgent(conversation, message);
      
      case 'completed':
        return {
          message: "Your loan application has been completed. If you'd like to start a new application, please type 'new loan'."
        };
      
      default:
        return {
          message: "I'm not sure what to do. Let me connect you with our sales team.",
          next_stage: 'sales'
        };
    }
  }

  async routeToSalesAgent(conversation, message) {
    const salesAgent = new SalesAgent({ 
      supabase: this.supabase,
      logger: this.logger 
    });
    return await salesAgent.process(conversation, message);
  }

  async routeToVerificationAgent(conversation, message) {
    const verificationAgent = new VerificationAgent({ 
      supabase: this.supabase,
      logger: this.logger 
    });
    return await verificationAgent.process(conversation, message);
  }

  async routeToUnderwritingAgent(conversation, message) {
    const underwritingAgent = new UnderwritingAgent({ 
      supabase: this.supabase,
      logger: this.logger 
    });
    return await underwritingAgent.process(conversation, message);
  }

  async routeToSanctionAgent(conversation, message) {
    const sanctionAgent = new SanctionAgent({ 
      supabase: this.supabase,
      logger: this.logger 
    });
    return await sanctionAgent.process(conversation, message);
  }
}
module.exports = {
  name: "Master Orchestrator",
  type: "agent",
  handler: MasterOrchestratorAgent
};