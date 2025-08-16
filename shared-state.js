const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const recipeManager = require('./recipe-manager');

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
    this.dataFile = path.join(__dirname, 'conversation.json');
    this.gooseWrapper = null;
    this.currentSessionName = null;
    this.load();
  }

  async load() {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      this.conversation = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start with empty conversation
      this.conversation = [];
    }
  }

  async save() {
    try {
      await fs.writeFile(this.dataFile, JSON.stringify(this.conversation, null, 2));
    } catch (error) {
      console.error('Error saving conversation:', error);
    }
  }

  async startGooseSession(options = {}) {
    if (this.gooseWrapper) {
      await this.stopGooseSession();
    }

    this.currentSessionName = options.sessionName || `web-session-${Date.now()}`;
    this.gooseWrapper = new GooseCLIWrapper({
      sessionName: this.currentSessionName,
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      extensions: options.extensions || [],
      builtins: options.builtins || []
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
      parameters: options.parameters || {}
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

    // Clear current conversation when switching sessions
    this.clear();

    this.currentSessionName = sessionName;
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
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
    };
    
    this.conversation.push(timestampedMessage);
    this.save();
    
    // Emit event for real-time updates
    this.emit('messageAdded', timestampedMessage);
    
    return timestampedMessage;
  }

  getConversation() {
    return this.conversation;
  }

  clear() {
    this.conversation = [];
    this.save();
    this.emit('conversationCleared');
  }

  async deleteGooseSession(sessionName) {
    try {
      const wrapper = new GooseCLIWrapper();
      await wrapper.deleteSession(sessionName);
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