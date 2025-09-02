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
    
    // Extract provider/model from recipe settings (like start-with-recipe does)
    const recipeProvider = recipe.settings?.goose_provider;
    const recipeModel = recipe.settings?.goose_model;
    
    const sessionOptions = {
      sessionName,
      recipeConfig: recipe,  // Pass the entire recipe instead of individual extensions
      workingDirectory: process.cwd(),
      recipeId: recipe.id,
      provider: recipeProvider,
      model: recipeModel,
      isTriggered: true,
      forceZeroDefaults: true  // Always use zero-defaults for triggered sessions
    };
    
    const sessionResult = await this.multiSessionManager.createSession(sessionOptions);
    
    await this.multiSessionManager.startSession(sessionResult.sessionId);
    
    // Switch to the new session and send the prompt
    await this.multiSessionManager.switchSession(sessionResult.sessionId);
    
    // Wait for session to be ready before sending the initial prompt
    const finalPrompt = prompt || recipe.prompt || 'Execute recipe instructions';
    
    // Set up a one-time ready listener for this session
    const sendInitialPrompt = () => {
      this.multiSessionManager.sendMessageToActiveSession(finalPrompt, {
        provider: recipeProvider,
        model: recipeModel
      }).catch(error => {
        console.error('Error sending message to triggered session:', error);
      });
    };
    
    // Listen for session ready event or timeout after 10 seconds
    const sessionReadyTimeout = setTimeout(() => {
      console.warn('Session ready timeout, sending prompt anyway');
      sendInitialPrompt();
    }, 10000);
    
    this.multiSessionManager.once('sessionReady', (eventData) => {
      if (eventData.sessionId === sessionResult.sessionId) {
        clearTimeout(sessionReadyTimeout);
        sendInitialPrompt();
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