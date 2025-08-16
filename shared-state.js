const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const recipeManager = require('./recipe-manager');
const { getDatabase } = require('./lib/database');

// Select wrapper based on model (can be configured)
function getGooseWrapper() {
  // Use streaming wrapper for better continuous display
  try {
    return require('./goose-cli-wrapper-streaming');
  } catch (e) {
    console.log('Streaming wrapper not found, using original wrapper');
    // Fall back to original wrapper
    return require('./goose-cli-wrapper');
  }
}

const GooseCLIWrapper = getGooseWrapper();

class GooseConversationManager extends EventEmitter {
  constructor() {
    super();
    this.conversation = [];
    this.dataFile = path.join(__dirname, 'conversation.json'); // Keep for legacy backup
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
    
    // Update session status in database
    if (this.dbInitialized) {
      try {
        // Create or get session
        await this.db.createSession(this.currentSessionName).catch(error => {
          if (!error.message.includes('already exists')) {
            throw error;
          }
        });
        await this.db.updateSessionStatus(this.currentSessionName, 'active');
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

    // Create wrapper with recipe configuration
    this.gooseWrapper = new GooseCLIWrapper({
      sessionName: this.currentSessionName,
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      extensions: [...(recipe.extensions || []), ...(options.extensions || [])],
      builtins: [...(recipe.builtins || []), ...(options.builtins || [])],
      recipePath: recipePath,
      recipe: processedRecipe,
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
    
    this.gooseWrapper.on('thinking', (message) => {
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
      console.log('Goose session ready with recipe:', recipe.name);
      this.emit('gooseReady');
    });

    try {
      // Track recipe usage
      await recipeManager.trackUsage(recipeId, this.currentSessionName);

      // Start the session
      await this.gooseWrapper.start();

      // Send initial prompt if specified in recipe
      if (processedRecipe.prompt) {
        setTimeout(() => {
          this.sendToGoose(processedRecipe.prompt);
        }, 3000); // Wait a bit for Goose to be fully ready
      }

      return { 
        success: true, 
        sessionName: this.currentSessionName,
        recipe: {
          id: recipe.id,
          name: recipe.name,
          description: recipe.description
        }
      };
    } catch (error) {
      console.error('Failed to start Goose session with recipe:', error);
      return { success: false, error: error.message };
    }
  }

  async createTempRecipeFile(recipe) {
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempFilePath = path.join(tempDir, `recipe-${Date.now()}.json`);
    await fs.writeFile(tempFilePath, JSON.stringify(recipe, null, 2));
    
    return tempFilePath;
  }

  async stopGooseSession() {
    if (this.gooseWrapper) {
      // Update session status in database
      if (this.dbInitialized && this.currentSessionName) {
        try {
          await this.db.updateSessionStatus(this.currentSessionName, 'inactive');
        } catch (error) {
          console.error('Error updating session status:', error);
        }
      }
      
      await this.gooseWrapper.stop();
      this.gooseWrapper = null;
      this.currentSessionName = null;
      this.emit('gooseStopped');
    }
  }

  async sendToGoose(message, source = 'web-interface') {
    if (!this.gooseWrapper) {
      throw new Error('No active Goose session');
    }

    // Add the user message to our conversation ONCE
    const userMessage = this.addMessage({
      role: 'user',
      content: message,
      source: source
    });

    // Send to Goose
    try {
      await this.gooseWrapper.sendMessage(message);
      return userMessage;
    } catch (error) {
      console.error('Error sending to Goose:', error);
      throw error;
    }
  }

  async executeGooseCommand(command) {
    if (!this.gooseWrapper) {
      throw new Error('No active Goose session');
    }

    try {
      await this.gooseWrapper.executeCommand(command);
      
      // Add command to conversation
      this.addMessage({
        role: 'system',
        content: `Command: ${command}`,
        timestamp: new Date().toISOString(),
        source: 'command'
      });
    } catch (error) {
      console.error('Error executing Goose command:', error);
      throw error;
    }
  }

  async listGooseSessions() {
    const wrapper = new GooseCLIWrapper();
    try {
      return await wrapper.listSessions();
    } catch (error) {
      console.error('Error listing sessions:', error);
      return [];
    }
  }

  async resumeGooseSession(sessionName) {
    if (this.gooseWrapper) {
      await this.stopGooseSession();
    }

    // Switch to the new session
    this.currentSessionName = sessionName;
    
    // Update session status in database
    if (this.dbInitialized) {
      try {
        await this.db.updateSessionStatus(sessionName, 'active');
      } catch (error) {
        console.error('Error updating session status:', error);
      }
    }
    
    // Load conversation for this session
    await this.load();

    this.gooseWrapper = new GooseCLIWrapper({
      sessionName: sessionName
    });
    
    // Set up event listeners
    this.setupGooseListeners();
    
    try {
      await this.gooseWrapper.resumeSession(sessionName);
      return { success: true, sessionName };
    } catch (error) {
      console.error('Failed to resume Goose session:', error);
      return { success: false, error: error.message };
    }
  }

  setupGooseListeners() {
    if (!this.gooseWrapper) return;

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

    // Listen for session history when resuming
    this.gooseWrapper.on('historyMessage', (historyData) => {
      // Parse and add historical messages
      this.parseAndAddHistoryMessage(historyData);
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
  }

  addMessage(message) {
    const timestampedMessage = {
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
      id: message.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9))
    };
    
    // Add to in-memory conversation for immediate UI updates
    this.conversation.push(timestampedMessage);
    
    // Save to database if initialized
    if (this.dbInitialized && this.currentSessionName) {
      this.db.addMessage(this.currentSessionName, timestampedMessage).catch(error => {
        console.error('Error saving message to database:', error);
        // Fallback to JSON save
        this.saveToJson();
      });
    } else {
      // Fallback to JSON save
      this.saveToJson();
    }
    
    // Emit event for real-time updates
    this.emit('messageAdded', timestampedMessage);
    
    return timestampedMessage;
  }

  getConversation() {
    return this.conversation;
  }

  clear() {
    this.conversation = [];
    
    // Clear from database if available
    if (this.dbInitialized && this.currentSessionName) {
      this.db.clearMessages(this.currentSessionName).catch(error => {
        console.error('Error clearing messages from database:', error);
        // Fallback to JSON save
        this.saveToJson();
      });
    } else {
      this.saveToJson();
    }
    
    this.emit('conversationCleared');
  }

  async deleteGooseSession(sessionName) {
    try {
      // Delete from Goose CLI
      const wrapper = new GooseCLIWrapper();
      await wrapper.deleteSession(sessionName);
      
      // Delete from database if available
      if (this.dbInitialized) {
        try {
          await this.db.deleteSession(sessionName);
        } catch (dbError) {
          console.error('Error deleting session from database:', dbError);
          // Continue anyway since Goose session was deleted
        }
      }
      
      // If this was the current session, clear it
      if (this.currentSessionName === sessionName) {
        this.currentSessionName = null;
        this.conversation = [];
        this.emit('conversationCleared');
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting session:', error);
      return { success: false, error: error.message };
    }
  }

  parseAndAddHistoryMessage(historyData) {
    const content = historyData.content;
    const timestamp = historyData.timestamp;
    const role = historyData.role;
    
    // If we have role from session file, use it directly
    if (historyData.source === 'session-file' && role && content) {
      this.addMessage({
        role: role,
        content: content,
        timestamp: timestamp,
        source: 'goose-history'
      });
      return;
    }
    
    // Legacy parsing for output-based history detection
    if (content.startsWith('You:') || content.startsWith('[') && content.includes('] You:')) {
      // Extract user message content
      const messageContent = content.replace(/^(\[.*\])?\s*You:\s*/, '').trim();
      if (messageContent) {
        this.addMessage({
          role: 'user',
          content: messageContent,
          timestamp: timestamp,
          source: 'goose-history'
        });
      }
    } else if (content.startsWith('Assistant:') || content.startsWith('[') && content.includes('] Assistant:')) {
      // Extract assistant message content
      const messageContent = content.replace(/^(\[.*\])?\s*Assistant:\s*/, '').trim();
      if (messageContent) {
        this.addMessage({
          role: 'assistant',
          content: messageContent,
          timestamp: timestamp,
          source: 'goose-history'
        });
      }
    } else if (content.trim()) {
      // If we can't determine the role, treat as system message
      this.addMessage({
        role: 'assistant',
        content: content.trim(),
        timestamp: timestamp,
        source: 'goose-history'
      });
    }
  }

  getGooseStatus() {
    return {
      active: !!this.gooseWrapper,
      sessionName: this.currentSessionName,
      ready: this.gooseWrapper?.isReady || false
    };
  }
}

module.exports = new GooseConversationManager();