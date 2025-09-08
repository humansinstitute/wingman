const SessionAwareGooseCLIWrapper = require('./session-aware-goose-wrapper');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;

class SubRecipeAwareWrapper extends SessionAwareGooseCLIWrapper {
  constructor(options = {}) {
    super(options);
    
    this.parentSessionId = options.parentSessionId || null;
    this.subRecipeName = options.subRecipeName || null;
    this.isSubRecipeSession = options.isSubRecipeSession || false;
    this.subRecipeSessions = new Map(); // Track active sub-recipe sessions
    
    // Sub-recipe specific metadata
    this.subRecipeMetadata = {
      parentRecipeId: options.parentRecipeId || null,
      subRecipeConfig: options.subRecipeConfig || null,
      subRecipeParameters: options.subRecipeParameters || {},
      createdAt: new Date().toISOString()
    };
  }

  async executeSubRecipe(subRecipeName, parameters = {}) {
    console.log(`🔧 Executing sub-recipe: ${subRecipeName}`);
    
    // Get parent recipe configuration
    const parentRecipe = this.options.recipeConfig;
    if (!parentRecipe || !parentRecipe.sub_recipes) {
      throw new Error('No sub-recipes configured for this session');
    }
    
    // Find the sub-recipe configuration
    const subRecipeConfig = parentRecipe.sub_recipes.find(sr => sr.name === subRecipeName);
    if (!subRecipeConfig) {
      throw new Error(`Sub-recipe '${subRecipeName}' not found in recipe configuration`);
    }
    
    try {
      // Load sub-recipe from path
      const subRecipeData = await this.loadSubRecipeData(subRecipeConfig);
      
      // Merge pre-set values with runtime parameters
      const mergedParameters = { ...parameters, ...subRecipeConfig.values };
      
      // Process template with merged parameters
      const processedSubRecipe = await this.processSubRecipeTemplate(subRecipeData, mergedParameters);
      
      // Create sub-recipe session
      const subRecipeSession = await this.createSubRecipeSession(
        subRecipeName, 
        processedSubRecipe, 
        mergedParameters
      );
      
      // Track the sub-recipe session
      this.subRecipeSessions.set(subRecipeName, subRecipeSession);
      
      // Emit sub-recipe session created event
      this.emit('subRecipeSessionCreated', {
        parentSessionId: this.sessionId,
        subRecipeName,
        subRecipeSessionId: subRecipeSession.sessionId,
        parameters: mergedParameters
      });
      
      // Execute the sub-recipe and return results
      const results = await this.runSubRecipeSession(subRecipeSession, processedSubRecipe);
      
      // Emit completion event
      this.emit('subRecipeCompleted', {
        parentSessionId: this.sessionId,
        subRecipeName,
        subRecipeSessionId: subRecipeSession.sessionId,
        results
      });
      
      return results;
    } catch (error) {
      console.error(`Error executing sub-recipe ${subRecipeName}:`, error);
      
      // Emit error event
      this.emit('subRecipeError', {
        parentSessionId: this.sessionId,
        subRecipeName,
        error: error.message
      });
      
      throw error;
    }
  }

  async loadSubRecipeData(subRecipeConfig) {
    let subRecipePath = subRecipeConfig.path;
    
    // Resolve relative paths
    if (!path.isAbsolute(subRecipePath)) {
      // Try recipe directories first (user, built-in, imported)
      const recipeBaseDirs = [
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'user'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'built-in'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'imported')
      ];
      
      for (const baseDir of recipeBaseDirs) {
        const fullPath = path.join(baseDir, subRecipePath);
        if (await this.fileExists(fullPath)) {
          subRecipePath = fullPath;
          break;
        }
      }
      
      // If not found in recipe directories, try relative to parent recipe directory
      if (!path.isAbsolute(subRecipePath) && this.options.recipePath) {
        const recipeDir = path.dirname(this.options.recipePath);
        const relativePath = path.join(recipeDir, subRecipePath);
        
        if (await this.fileExists(relativePath)) {
          subRecipePath = relativePath;
        }
      }
      
      // If still relative, try from working directory
      if (!path.isAbsolute(subRecipePath)) {
        subRecipePath = path.resolve(this.options.workingDirectory || process.cwd(), subRecipeConfig.path);
      }
    }
    
    // Load the sub-recipe data
    const data = await fs.readFile(subRecipePath, 'utf8');
    
    // Support both JSON and YAML formats
    if (subRecipePath.endsWith('.yaml') || subRecipePath.endsWith('.yml')) {
      try {
        const yaml = require('js-yaml');
        return yaml.load(data);
      } catch (yamlError) {
        throw new Error(`Failed to parse YAML sub-recipe: ${yamlError.message}`);
      }
    }
    
    return JSON.parse(data);
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async processSubRecipeTemplate(subRecipeData, parameters) {
    // Deep clone the sub-recipe data
    const processed = JSON.parse(JSON.stringify(subRecipeData));
    
    // Process template substitutions
    for (const [key, value] of Object.entries(parameters)) {
      const placeholder = `{{ ${key} }}`;
      const placeholderAlt = `{{${key}}}`;
      
      // Replace in instructions
      if (processed.instructions) {
        processed.instructions = processed.instructions
          .replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value)
          .replace(new RegExp(placeholderAlt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
      }
      
      // Replace in prompt
      if (processed.prompt) {
        processed.prompt = processed.prompt
          .replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value)
          .replace(new RegExp(placeholderAlt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
      }
    }
    
    return processed;
  }

  async createSubRecipeSession(subRecipeName, subRecipeData, parameters) {
    // Generate unique session name for sub-recipe
    const subRecipeSessionId = `${this.sessionId}-${subRecipeName}-${Date.now()}`;
    const subRecipeSessionName = `sub-${subRecipeSessionId}`;
    
    // Create temporary recipe file for sub-recipe
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    const subRecipePath = path.join(tempDir, `sub-recipe-${subRecipeSessionId}.json`);
    await fs.writeFile(subRecipePath, JSON.stringify(subRecipeData, null, 2));
    
    // Create sub-recipe wrapper
    const SubRecipeWrapper = require('./session-aware-goose-wrapper');
    const subRecipeSession = new SubRecipeWrapper({
      sessionName: subRecipeSessionName,
      workingDirectory: this.options.workingDirectory,
      debug: this.options.debug,
      extensions: subRecipeData.extensions || [],
      builtins: subRecipeData.builtins || [],
      recipePath: subRecipePath,
      recipeConfig: subRecipeData,
      parameters: parameters,
      parentSessionId: this.sessionId,
      subRecipeName: subRecipeName,
      isSubRecipeSession: true,
      parentRecipeId: this.options.recipeConfig?.id
    });
    
    // Set up event forwarding from sub-recipe session
    subRecipeSession.on('streamContent', (data) => {
      this.emit('subRecipeStreamContent', {
        parentSessionId: this.sessionId,
        subRecipeName,
        subRecipeSessionId: subRecipeSession.sessionId,
        ...data
      });
    });
    
    subRecipeSession.on('metricRecorded', (data) => {
      this.emit('subRecipeMetricRecorded', {
        parentSessionId: this.sessionId,
        subRecipeName,
        ...data
      });
    });
    
    return {
      sessionId: subRecipeSession.sessionId,
      sessionName: subRecipeSessionName,
      wrapper: subRecipeSession,
      config: subRecipeData,
      parameters: parameters,
      tempPath: subRecipePath
    };
  }

  async runSubRecipeSession(subRecipeSession, subRecipeData) {
    try {
      // Start the sub-recipe session
      await subRecipeSession.wrapper.start();
      
      // Send initial prompt if specified
      if (subRecipeData.prompt) {
        await subRecipeSession.wrapper.sendMessage(subRecipeData.prompt);
      }
      
      // Wait for completion or timeout
      return await this.waitForSubRecipeCompletion(subRecipeSession);
    } catch (error) {
      console.error(`Error running sub-recipe session:`, error);
      throw error;
    }
  }

  async waitForSubRecipeCompletion(subRecipeSession, timeout = 300000) { // 5 minutes default
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Sub-recipe session timed out after ${timeout}ms`));
      }, timeout);
      
      // Listen for completion indicators
      const completionHandler = (data) => {
        // Look for completion patterns in the output
        if (this.isCompletionOutput(data.content)) {
          clearTimeout(timeoutId);
          
          // Get session results
          const results = {
            sessionId: subRecipeSession.sessionId,
            output: data.content,
            timestamp: new Date().toISOString(),
            stats: subRecipeSession.wrapper.getSessionStats()
          };
          
          resolve(results);
        }
      };
      
      subRecipeSession.wrapper.on('streamContent', completionHandler);
      
      // Also listen for explicit completion events
      subRecipeSession.wrapper.on('sessionCompleted', (results) => {
        clearTimeout(timeoutId);
        resolve(results);
      });
      
      // Handle errors
      subRecipeSession.wrapper.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  isCompletionOutput(content) {
    // Simple heuristics to detect when a sub-recipe is complete
    // This can be enhanced based on specific patterns
    const completionPatterns = [
      /task\s+(completed|finished|done)/i,
      /analysis\s+(complete|finished)/i,
      /process\s+(completed|finished)/i,
      /^done/i,
      /execution\s+(complete|finished)/i
    ];
    
    return completionPatterns.some(pattern => pattern.test(content));
  }

  async stopSubRecipeSession(subRecipeName) {
    const session = this.subRecipeSessions.get(subRecipeName);
    if (!session) {
      return false;
    }
    
    try {
      await session.wrapper.stop();
      
      // Clean up temporary files
      try {
        await fs.unlink(session.tempPath);
      } catch (error) {
        console.warn(`Could not clean up temp file ${session.tempPath}:`, error.message);
      }
      
      this.subRecipeSessions.delete(subRecipeName);
      
      this.emit('subRecipeSessionStopped', {
        parentSessionId: this.sessionId,
        subRecipeName,
        subRecipeSessionId: session.sessionId
      });
      
      return true;
    } catch (error) {
      console.error(`Error stopping sub-recipe session ${subRecipeName}:`, error);
      return false;
    }
  }

  async stop() {
    // Stop all active sub-recipe sessions first
    for (const [subRecipeName] of this.subRecipeSessions) {
      await this.stopSubRecipeSession(subRecipeName);
    }
    
    // Then stop the parent session
    return super.stop();
  }

  getActiveSubRecipeSessions() {
    const sessions = [];
    for (const [name, session] of this.subRecipeSessions) {
      sessions.push({
        name,
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        isActive: session.wrapper.isReady,
        stats: session.wrapper.getSessionStats()
      });
    }
    return sessions;
  }

  getSessionStats() {
    const stats = super.getSessionStats();
    
    // Add sub-recipe information
    stats.subRecipes = {
      active: this.subRecipeSessions.size,
      sessions: this.getActiveSubRecipeSessions()
    };
    
    return stats;
  }
}

module.exports = SubRecipeAwareWrapper;