const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const recipeManager = require('../recipes/manager');
const { getDatabase } = require('./utils/database');

// Select wrapper based on model and recipe requirements
function getGooseWrapper(recipeConfig = null) {
  // Use sub-recipe aware wrapper if recipe has sub-recipes
  if (recipeConfig && recipeConfig.sub_recipes && recipeConfig.sub_recipes.length > 0) {
    return require('../wrappers/sub-recipe-wrapper');
  }
  // Default to session-aware streaming wrapper
  return require('../wrappers/session-aware-wrapper');
}

const GooseCLIWrapper = getGooseWrapper();

class GooseConversationManager extends EventEmitter {
  constructor() {
    super();
    this.conversation = [];
    // Store fallback JSON under WINGMAN_HOME/tmp instead of repo
    const { paths } = require('./config');
    const tmpDir = paths().tmpDir;
    this.dataFile = path.join(tmpDir, 'conversation.json');
    fs.mkdir(tmpDir, { recursive: true }).catch(() => {});
    this.gooseWrapper = null;
    this.currentSessionName = null;
    this.db = getDatabase();
    this.dbInitialized = false;
    this.init();
  }

  async init() {
    try {
      if (!this.dbInitialized) {
        await this.db.init();
        this.dbInitialized = true;
      }
      await this.load();
    } catch (error) {
      console.error('Error initializing conversation manager:', error);
      // Fallback to JSON mode if database fails
      this.dbInitialized = false;
      await this.loadFromJson();
    }
  }

  async load() {
    if (!this.dbInitialized) {
      return this.loadFromJson();
    }
    
    try {
      if (this.currentSessionName) {
        // Load messages for current session
        const messages = await this.db.getMessages(this.currentSessionName);
        this.conversation = messages.map(msg => ({
          id: msg.message_id || msg.id.toString(),
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          source: msg.source
        }));
      } else {
        // No specific session, start with empty conversation
        this.conversation = [];
      }
    } catch (error) {
      console.error('Error loading from database:', error);
      // Fallback to JSON
      await this.loadFromJson();
    }
  }

  async loadFromJson() {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      this.conversation = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start with empty conversation
      this.conversation = [];
    }
  }

  async save() {
    if (!this.dbInitialized) {
      return this.saveToJson();
    }
    
    // Database saves are handled per-message in addMessage
    // This method is kept for API compatibility
    return Promise.resolve();
  }

  async saveToJson() {
    try {
      await fs.writeFile(this.dataFile, JSON.stringify(this.conversation, null, 2));
    } catch (error) {
      console.error('Error saving conversation to JSON:', error);
    }
  }

  async startGooseSession(options = {}) {
    if (this.gooseWrapper) {
      await this.stopGooseSession();
    }

    this.currentSessionName = options.sessionName || `web-session-${Date.now()}`;
    
    // Update session status and store context in database
    if (this.dbInitialized) {
      try {
        // Create or get session
        await this.db.createSession(this.currentSessionName).catch(error => {
          if (!error.message.includes('already exists')) {
            throw error;
          }
        });
        await this.db.updateSessionStatus(this.currentSessionName, 'active');
        
        // Store complete session context
        await this.db.storeSessionContext(this.currentSessionName, {
          workingDirectory: options.workingDirectory || process.cwd(),
          extensions: options.extensions || [],
          builtins: options.builtins || [],
          debug: options.debug || false,
          maxTurns: options.maxTurns || 1000
        });
      } catch (error) {
        console.error('Error managing session in database:', error);
      }
    }
    
    this.gooseWrapper = new GooseCLIWrapper({
      sessionName: this.currentSessionName,
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      extensions: options.extensions || [],
      builtins: options.builtins || [],
      workingDirectory: options.workingDirectory || process.cwd()
    });

    // Listen to Goose streaming events
    this.gooseWrapper.on('streamContent', (streamData) => {
      // Add streaming content as a single message
      this.addMessage({
        role: 'assistant',
        content: streamData.content,
        timestamp: streamData.timestamp,
        source: streamData.source
      });
    });

    // Keep compatibility with other wrappers
    this.gooseWrapper.on('aiMessage', (message) => {
      this.addMessage(message);
    });
    
    this.gooseWrapper.on('thinking', (message) => {
      // Forward thinking messages without adding to conversation
      this.emit('thinking', message);
    });

    this.gooseWrapper.on('toolUsage', (tool) => {
      this.addMessage(tool);
    });

    this.gooseWrapper.on('error', (error) => {
      console.error('Goose error:', error);
      this.emit('gooseError', error);
    });

    this.gooseWrapper.on('ready', () => {
      console.log('Goose session ready');
      this.emit('gooseReady');
    });

    try {
      await this.gooseWrapper.start();
      return { success: true, sessionName: this.currentSessionName };
    } catch (error) {
      console.error('Failed to start Goose session:', error);
      return { success: false, error: error.message };
    }
  }

  async startGooseSessionWithRecipe(recipeId, options = {}) {
    if (this.gooseWrapper) {
      await this.stopGooseSession();
    }

    // Get recipe from manager
    const recipe = await recipeManager.getRecipe(recipeId);
    if (!recipe) {
      throw new Error(`Recipe ${recipeId} not found`);
    }

    // Process template parameters
    const processedRecipe = await recipeManager.processTemplate(
      recipe, 
      options.parameters || {}
    );

    // Validate parameters
    await recipeManager.validateParameters(recipe, options.parameters || {});

    // Create temporary recipe file
    const recipePath = await this.createTempRecipeFile(processedRecipe);

    // Set session name
    this.currentSessionName = options.sessionName || `recipe-${recipe.name}-${Date.now()}`;

    // Get appropriate wrapper based on recipe configuration
    const WrapperClass = getGooseWrapper(processedRecipe);
    
    // Create wrapper with recipe configuration
    this.gooseWrapper = new WrapperClass({
      sessionName: this.currentSessionName,
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      extensions: [...(recipe.extensions || []), ...(options.extensions || [])],
      builtins: [...(recipe.builtins || []), ...(options.builtins || [])],
      recipePath: recipePath,
      recipeConfig: processedRecipe,
      parameters: options.parameters || {},
      workingDirectory: options.workingDirectory || process.cwd()
    });

    // Set up event listeners (same as regular session)
    this.gooseWrapper.on('streamContent', (streamData) => {
      this.addMessage({
        role: 'assistant',
        content: streamData.content,
        timestamp: streamData.timestamp,
        source: streamData.source
      });
    });

    this.gooseWrapper.on('aiMessage', (message) => {
      this.addMessage(message);
    });
    
    // Additional events
    this.gooseWrapper.on('subRecipeStreamContent', (data) => {
      this.addMessage({
        role: data.role || 'assistant',
        content: data.content,
        timestamp: data.timestamp,
        source: data.source || 'sub-recipe'
      });
    });

    this.gooseWrapper.on('subRecipeSessionCreated', (data) => {
      this.emit('subRecipeSessionCreated', data);
    });

    try {
      await this.gooseWrapper.start();
      return { success: true, sessionName: this.currentSessionName };
    } catch (error) {
      console.error('Failed to start Goose session with recipe:', error);
      return { success: false, error: error.message };
    }
  }

  async addMessage(message) {
    this.conversation.push({
      id: Date.now().toString(),
      role: message.role,
      content: message.content,
      timestamp: message.timestamp || new Date().toISOString(),
      source: message.source || 'ai'
    });
    
    // Save to database if available
    if (this.dbInitialized && this.currentSessionName) {
      try {
        await this.db.addMessage(this.currentSessionName, {
          role: message.role,
          content: message.content,
          timestamp: message.timestamp || new Date().toISOString(),
          source: message.source || 'ai'
        });
      } catch (error) {
        console.error('Error adding message to database:', error);
      }
    } else {
      await this.save();
    }
    
    this.emit('messageAdded', message);
  }

  getGooseStatus() {
    return {
      active: !!this.gooseWrapper,
      sessionName: this.currentSessionName
    };
  }

  async stopGooseSession() {
    if (this.gooseWrapper) {
      try {
        await this.gooseWrapper.stop();
        if (this.dbInitialized && this.currentSessionName) {
          await this.db.updateSessionStatus(this.currentSessionName, 'stopped');
        }
        this.gooseWrapper = null;
        this.emit('gooseStopped');
      } catch (error) {
        console.error('Error stopping Goose session:', error);
      }
    }
  }

  async createTempRecipeFile(recipe) {
    const os = require('os');
    const fsSync = require('fs');
    const tempDir = path.join(os.tmpdir(), 'wingman', 'recipes');
    await fs.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `recipe-${Date.now()}.json`);
    await fs.writeFile(filePath, JSON.stringify(recipe, null, 2));
    return filePath;
  }

  async clearConversation() {
    this.conversation = [];
    await this.save();
    this.emit('conversationCleared');
  }
}

module.exports = new GooseConversationManager();
