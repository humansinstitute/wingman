class TriggerHandler {
  constructor(multiSessionManager, recipeManager) {
    this.multiSessionManager = multiSessionManager;
    this.recipeManager = recipeManager;
    this.triggerLogs = [];
  }

  validateToken(providedToken) {
    const configuredToken = process.env.TRIGGER_TOKEN;
    
    if (!configuredToken) {
      throw new Error('TRIGGER_TOKEN not configured in environment');
    }
    
    if (!providedToken) {
      throw new Error('Missing authentication token');
    }
    
    if (providedToken !== configuredToken) {
      throw new Error('Invalid authentication token');
    }
    
    return true;
  }

  async validateRecipe(recipeId) {
    const recipe = await this.recipeManager.getRecipe(recipeId);
    
    if (!recipe) {
      throw new Error(`Recipe with ID ${recipeId} not found`);
    }
    
    return recipe;
  }


  async createTriggeredSession(recipe, prompt, customSessionName) {
    const sessionId = `trigger_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionName = customSessionName || `${recipe.name}_triggered_${new Date().toISOString()}`;
    
    const sessionOptions = {
      sessionName,
      recipeConfig: recipe,  // Pass the entire recipe instead of individual extensions
      workingDirectory: process.cwd(),
      recipeId: recipe.id,
      isTriggered: true
    };
    
    const sessionResult = await this.multiSessionManager.createSession(sessionOptions);
    
    await this.multiSessionManager.startSession(sessionResult.sessionId);
    
    // Switch to the new session and send the prompt
    await this.multiSessionManager.switchSession(sessionResult.sessionId);
    
    // Send the prompt immediately
    const finalPrompt = prompt || recipe.prompt || 'Execute recipe instructions';
    setImmediate(async () => {
      try {
        await this.multiSessionManager.sendMessageToActiveSession(finalPrompt, {
          provider: recipe.provider,
          model: recipe.model
        });
      } catch (error) {
        console.error('Error sending message to triggered session:', error);
      }
    });
    
    return {
      sessionId: sessionResult.sessionId,
      sessionName: sessionResult.sessionName,
      recipe
    };
  }


  logTriggerActivity(activity) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...activity
    };
    
    this.triggerLogs.push(logEntry);
    
    console.log('[TRIGGER]', JSON.stringify(logEntry, null, 2));
    
    if (this.triggerLogs.length > 1000) {
      this.triggerLogs = this.triggerLogs.slice(-500);
    }
  }

  async processTrigger(requestData, token) {
    const startTime = Date.now();
    
    try {
      this.validateToken(token);
      
      const { recipe_id, prompt, session_name } = requestData;
      
      if (!recipe_id) {
        throw new Error('recipe_id is required');
      }
      
      const recipe = await this.validateRecipe(recipe_id);
      
      const sessionInfo = await this.createTriggeredSession(recipe, prompt, session_name);
      
      this.logTriggerActivity({
        type: 'trigger_success',
        sessionId: sessionInfo.sessionId,
        recipeId: recipe_id,
        recipeName: recipe.name,
        duration: Date.now() - startTime
      });
      
      return {
        success: true,
        session_id: sessionInfo.sessionId,
        session_name: sessionInfo.sessionName,
        recipe_name: recipe.name,
        message: 'Recipe triggered successfully'
      };
      
    } catch (error) {
      this.logTriggerActivity({
        type: 'trigger_error',
        error: error.message,
        recipeId: requestData.recipe_id,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }

  getTriggerLogs(limit = 100) {
    return this.triggerLogs.slice(-limit);
  }
}

module.exports = TriggerHandler;