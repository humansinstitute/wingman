const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const recipeManager = require('../recipe-manager');
const { getDatabase } = require('./database');
const SessionManager = require('./session-manager');

class MultiSessionConversationManager extends EventEmitter {
  constructor() {
    super();
    this.conversations = new Map(); // sessionId -> conversation array
    this.activeSessionId = null;
    this.dataFile = path.join(__dirname, '..', 'conversation.json');
    this.sessionManager = new SessionManager();
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
      
      // Set up session manager event listeners
      this.setupSessionManagerListeners();
      
      await this.load();
    } catch (error) {
      console.error('Error initializing multi-session conversation manager:', error);
      this.dbInitialized = false;
    }
  }

  setupSessionManagerListeners() {
    this.sessionManager.on('sessionMessage', (data) => {
      const { sessionId, ...messageData } = data;
      this.addMessage(sessionId, messageData);
    });

    this.sessionManager.on('sessionReady', ({ sessionId }) => {
      this.emit('sessionReady', { sessionId });
    });

    this.sessionManager.on('sessionError', ({ sessionId, error }) => {
      this.emit('sessionError', { sessionId, error });
    });

    this.sessionManager.on('sessionExit', ({ sessionId, code }) => {
      this.emit('sessionExit', { sessionId, code });
    });

    this.sessionManager.on('sessionSwitched', ({ from, to }) => {
      this.activeSessionId = to;
      this.emit('sessionSwitched', { from, to });
      
      // Emit conversation for new active session
      const conversation = this.getConversation(to);
      this.emit('conversationHistory', conversation);
    });
  }

  async load() {
    // Load conversations for all sessions if needed
    // For now, conversations are loaded on-demand when sessions are accessed
  }

  async loadConversation(sessionId) {
    if (!sessionId) return [];
    
    if (this.conversations.has(sessionId)) {
      return this.conversations.get(sessionId);
    }

    if (!this.dbInitialized) {
      // Fallback to empty conversation
      this.conversations.set(sessionId, []);
      return [];
    }
    
    try {
      const session = this.sessionManager.getSession(sessionId);
      const sessionName = session?.sessionName || sessionId;
      
      const messages = await this.db.getMessages(sessionName);
      const conversation = messages.map(msg => ({
        id: msg.message_id || msg.id?.toString(),
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        source: msg.source,
        sessionId: sessionId
      }));
      
      this.conversations.set(sessionId, conversation);
      return conversation;
    } catch (error) {
      console.error(`Error loading conversation for session ${sessionId}:`, error);
      this.conversations.set(sessionId, []);
      return [];
    }
  }

  async startGooseSession(options = {}) {
    try {
      const result = await this.sessionManager.createSession(options);
      
      if (result.success) {
        // Set as active session
        this.activeSessionId = result.sessionId;
        
        // Initialize empty conversation for this session
        this.conversations.set(result.sessionId, []);
        
        this.emit('gooseReady', { sessionId: result.sessionId });
      }
      
      return result;
    } catch (error) {
      console.error('Failed to start Goose session:', error);
      return { success: false, error: error.message };
    }
  }

  async startGooseSessionWithRecipe(recipeId, options = {}) {
    try {
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

      // Create session with recipe configuration
      const sessionOptions = {
        ...options,
        recipeId: recipeId,
        recipeConfig: processedRecipe,
        extensions: [...(recipe.extensions || []), ...(options.extensions || [])],
        builtins: [...(recipe.builtins || []), ...(options.builtins || [])],
        sessionName: options.sessionName || `recipe-${recipe.name}-${Date.now()}`
      };

      const result = await this.sessionManager.createSession(sessionOptions);
      
      if (result.success) {
        this.activeSessionId = result.sessionId;
        this.conversations.set(result.sessionId, []);
        
        // Track recipe usage
        await recipeManager.trackUsage(recipeId, result.sessionId);
        
        // Send initial prompt if specified in recipe
        if (processedRecipe.prompt) {
          setTimeout(() => {
            this.sendToGoose(processedRecipe.prompt, result.sessionId);
          }, 4000);
        }
        
        this.emit('gooseReady', { sessionId: result.sessionId });
        
        return { 
          ...result,
          recipe: {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description
          }
        };
      }
      
      return result;
    } catch (error) {
      console.error('Failed to start Goose session with recipe:', error);
      return { success: false, error: error.message };
    }
  }

  async stopGooseSession(sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    
    if (!targetSessionId) {
      throw new Error('No session specified and no active session');
    }

    try {
      await this.sessionManager.stopSession(targetSessionId);
      
      // If we stopped the active session, clear it
      if (targetSessionId === this.activeSessionId) {
        this.activeSessionId = null;
      }
      
      this.emit('gooseStopped', { sessionId: targetSessionId });
      return { success: true };
    } catch (error) {
      console.error(`Error stopping session ${targetSessionId}:`, error);
      throw error;
    }
  }

  async resumeGooseSession(sessionName) {
    try {
      const result = await this.sessionManager.resumeSession(sessionName);
      
      if (result.success) {
        this.activeSessionId = result.sessionId;
        
        // Load conversation for this session
        await this.loadConversation(result.sessionId);
        
        this.emit('gooseReady', { sessionId: result.sessionId });
        
        // Emit conversation history for the resumed session
        const conversation = this.getConversation(result.sessionId);
        this.emit('conversationHistory', conversation);
      }
      
      return result;
    } catch (error) {
      console.error('Failed to resume Goose session:', error);
      return { success: false, error: error.message };
    }
  }

  async switchSession(sessionId) {
    try {
      const result = this.sessionManager.switchToSession(sessionId);
      
      if (result.success) {
        this.activeSessionId = sessionId;
        
        // Load conversation for this session if not already loaded
        await this.loadConversation(sessionId);
        
        // Emit conversation history for the switched session
        const conversation = this.getConversation(sessionId);
        this.emit('conversationHistory', conversation);
      }
      
      return result;
    } catch (error) {
      console.error(`Failed to switch to session ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendToGoose(message, sessionId = null, source = 'web-interface') {
    const targetSessionId = sessionId || this.activeSessionId;
    
    if (!targetSessionId) {
      throw new Error('No session specified and no active session');
    }

    try {
      const result = await this.sessionManager.sendMessage(targetSessionId, message, source);
      return result;
    } catch (error) {
      console.error(`Error sending message to session ${targetSessionId}:`, error);
      throw error;
    }
  }

  async executeGooseCommand(command, sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    
    if (!targetSessionId) {
      throw new Error('No session specified and no active session');
    }

    const session = this.sessionManager.getSession(targetSessionId);
    if (!session) {
      throw new Error(`Session ${targetSessionId} not found`);
    }

    try {
      // For now, treat commands as messages
      await this.sendToGoose(`/${command}`, targetSessionId, 'command');
      
      return { success: true };
    } catch (error) {
      console.error(`Error executing command in session ${targetSessionId}:`, error);
      throw error;
    }
  }

  async listGooseSessions() {
    try {
      return await this.sessionManager.getGooseSessions();
    } catch (error) {
      console.error('Error listing sessions:', error);
      return [];
    }
  }

  async deleteGooseSession(sessionName) {
    try {
      // Find the session by name
      const sessions = this.sessionManager.getAllSessions();
      const session = sessions.find(s => s.sessionName === sessionName);
      
      let sessionId = null;
      if (session) {
        sessionId = session.sessionId;
        await this.sessionManager.deleteSession(sessionId);
      } else {
        // Session not running, but may exist in Goose - delete anyway
        const { spawn } = require('child_process');
        const deleteProcess = spawn('goose', ['session', 'delete', '--name', sessionName], {
          stdio: 'inherit'
        });

        await new Promise((resolve) => {
          deleteProcess.on('close', () => resolve());
          deleteProcess.on('error', () => resolve());
        });
      }
      
      // Clean up conversation data
      if (sessionId) {
        this.conversations.delete(sessionId);
        
        if (this.activeSessionId === sessionId) {
          this.activeSessionId = null;
        }
      }
      
      // Delete from database
      if (this.dbInitialized) {
        try {
          await this.db.deleteSession(sessionName);
        } catch (error) {
          console.error('Error deleting session from database:', error);
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error(`Error deleting session ${sessionName}:`, error);
      return { success: false, error: error.message };
    }
  }

  addMessage(sessionId, message) {
    const timestampedMessage = {
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
      id: message.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9)),
      sessionId: sessionId
    };
    
    // Ensure conversation exists for this session
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    
    // Add to in-memory conversation
    const conversation = this.conversations.get(sessionId);
    conversation.push(timestampedMessage);
    
    // Save to database if initialized
    if (this.dbInitialized) {
      const session = this.sessionManager.getSession(sessionId);
      const sessionName = session?.sessionName || sessionId;
      
      this.db.addMessage(sessionName, timestampedMessage).catch(error => {
        console.error(`Error saving message to database for session ${sessionId}:`, error);
      });
    }
    
    // Emit event for real-time updates (only for active session)
    if (sessionId === this.activeSessionId) {
      this.emit('messageAdded', timestampedMessage);
    }
    
    return timestampedMessage;
  }

  getConversation(sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    
    if (!targetSessionId) {
      return [];
    }
    
    return this.conversations.get(targetSessionId) || [];
  }

  clear(sessionId = null) {
    const targetSessionId = sessionId || this.activeSessionId;
    
    if (!targetSessionId) {
      return;
    }
    
    this.conversations.set(targetSessionId, []);
    
    // Clear from database if available
    if (this.dbInitialized) {
      const session = this.sessionManager.getSession(targetSessionId);
      const sessionName = session?.sessionName || targetSessionId;
      
      this.db.clearMessages(sessionName).catch(error => {
        console.error(`Error clearing messages from database for session ${targetSessionId}:`, error);
      });
    }
    
    // Only emit cleared event for active session
    if (targetSessionId === this.activeSessionId) {
      this.emit('conversationCleared');
    }
  }

  getGooseStatus() {
    const sessionManagerStatus = this.sessionManager.getStatus();
    const activeSession = this.sessionManager.getActiveSession();
    
    return {
      active: !!activeSession,
      sessionId: this.activeSessionId,
      sessionName: activeSession?.sessionName,
      ready: activeSession?.isReady || false,
      totalSessions: sessionManagerStatus.totalSessions,
      sessions: sessionManagerStatus.sessions
    };
  }

  getAllSessions() {
    return this.sessionManager.getAllSessions();
  }

  getSessionManager() {
    return this.sessionManager;
  }

  // Legacy compatibility methods
  async save() {
    // No-op for compatibility
    return Promise.resolve();
  }

  // Legacy single-session methods for backward compatibility
  async startGooseSessionLegacy(options = {}) {
    return this.startGooseSession(options);
  }

  async stopGooseSessionLegacy() {
    return this.stopGooseSession();
  }

  async sendToGooseLegacy(message, source = 'web-interface') {
    return this.sendToGoose(message, null, source);
  }

  getConversationLegacy() {
    return this.getConversation();
  }

  clearLegacy() {
    return this.clear();
  }
}

module.exports = new MultiSessionConversationManager();
