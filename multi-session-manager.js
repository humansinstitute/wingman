const EventEmitter = require('events');
const SessionAwareGooseCLIWrapper = require('./session-aware-goose-wrapper');
const { getDatabase } = require('./lib/database');

class SimplifiedSessionAnalytics {
  constructor() {
    this.metrics = new Map(); // sessionId -> core metrics only
  }
  
  recordCoreMetric(sessionId, metricType, value) {
    if (!this.metrics.has(sessionId)) {
      this.metrics.set(sessionId, {
        messageCount: 0,
        sessionStartTime: Date.now(),
        toolUsage: {},
        workingDirectory: null,
        errorCount: 0,
        lastActivity: Date.now()
      });
    }
    
    const sessionMetrics = this.metrics.get(sessionId);
    
    switch (metricType) {
      case 'message_sent':
        sessionMetrics.messageCount++;
        sessionMetrics.lastActivity = Date.now();
        break;
      case 'tool_used':
        sessionMetrics.toolUsage[value] = (sessionMetrics.toolUsage[value] || 0) + 1;
        break;
      case 'error_occurred':
        sessionMetrics.errorCount++;
        break;
      case 'working_directory':
        sessionMetrics.workingDirectory = value;
        break;
    }
  }
  
  getSessionStats(sessionId) {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return null;
    
    return {
      messageCount: metrics.messageCount,
      sessionDuration: Date.now() - metrics.sessionStartTime,
      toolUsage: metrics.toolUsage,
      workingDirectory: metrics.workingDirectory,
      resourceUsage: this.getCurrentResourceUsage(sessionId),
      errorRate: metrics.errorCount / Math.max(metrics.messageCount, 1)
    };
  }
  
  getCurrentResourceUsage(sessionId) {
    // Simplified resource usage - can be enhanced
    return {
      memoryUsage: process.memoryUsage().heapUsed,
      cpuUsage: process.cpuUsage()
    };
  }
  
  getCrossSessionAnalysis() {
    const allSessions = Array.from(this.metrics.values());
    
    return {
      concurrentSessionPerformance: this.analyzeConcurrentPerformance(),
      resourceUtilization: this.getSystemResourceUsage(),
      sessionSwitchingPatterns: this.getSessionSwitchPatterns(),
      popularSessionTypes: this.getPopularConfigurations(),
      errorCorrelation: this.analyzeErrorPatterns()
    };
  }
  
  // Simplified implementations for cross-session analysis
  analyzeConcurrentPerformance() {
    return { averageResponseTime: 0, concurrentSessions: this.metrics.size };
  }
  
  getSystemResourceUsage() {
    const usage = process.memoryUsage();
    return { totalMemory: usage.heapTotal, usedMemory: usage.heapUsed };
  }
  
  getSessionSwitchPatterns() {
    return { totalSwitches: 0, averageSwitchTime: 0 };
  }
  
  getPopularConfigurations() {
    return { mostUsedExtensions: [], mostUsedBuiltins: [] };
  }
  
  analyzeErrorPatterns() {
    return { commonErrors: [], errorFrequency: 0 };
  }
}

class MultiSessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // sessionId -> SessionAwareGooseCLIWrapper instance
    this.activeSessionId = null;
    this.sessionMetadata = new Map(); // sessionId -> metadata
    this.conversationCache = new Map(); // sessionId -> cached conversation
    this.analytics = new SimplifiedSessionAnalytics();
    this.db = getDatabase();
    this.dbInitialized = false;
    
    this.init();
  }
  
  async init() {
    try {
      if (!this.dbInitialized) {
        await this.db.init();
        await this.extendDatabaseSchema();
        this.dbInitialized = true;
      }
    } catch (error) {
      console.error('Failed to initialize MultiSessionManager:', error);
    }
  }
  
  async extendDatabaseSchema() {
    try {
      // Add session analytics table if it doesn't exist
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS session_analytics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          metric_name TEXT,
          metric_value REAL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions (session_name)
        )
      `);
      
      // Add session events table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS session_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          event_type TEXT,
          event_data JSON,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('Extended database schema for multi-session support');
    } catch (error) {
      console.error('Error extending database schema:', error);
    }
  }
  
  generateSessionId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }
  
  async createSession(options) {
    const sessionId = this.generateSessionId();
    const sessionName = options.sessionName || sessionId;
    
    console.log(`Creating new session: ${sessionId} (${sessionName})`);
    
    // Extract provider/model from options
    const { provider, model, providerOverride, ...wrapperOptions } = options;
    
    // Determine final provider/model
    let finalProvider = provider;
    let finalModel = model;
    
    // Handle provider override from recipe launch
    if (providerOverride) {
      finalProvider = providerOverride.provider;
      finalModel = providerOverride.model;
    }
    
    // Create wrapper with provider/model options
    const wrapper = new SessionAwareGooseCLIWrapper({
      ...wrapperOptions,
      sessionId,
      sessionName,
      provider: finalProvider,
      model: finalModel
    });
    
    // Set up event forwarding with session context
    this.setupSessionEvents(sessionId, wrapper);
    
    // Store session with provider/model metadata
    this.sessions.set(sessionId, wrapper);
    await this.saveSessionMetadata(sessionId, {
      ...options,
      provider: finalProvider,
      model: finalModel
    });
    
    // Initialize empty conversation cache for new session
    this.conversationCache.set(sessionId, []);
    console.log(`Initialized empty conversation cache for session ${sessionId}`);
    
    return { 
      sessionId, 
      wrapper, 
      sessionName,
      metadata: this.sessionMetadata.get(sessionId)
    };
  }
  
  setupSessionEvents(sessionId, wrapper) {
    // Forward all wrapper events with session context
    wrapper.on('aiMessage', (message) => {
      // Only emit for active session to avoid UI confusion
      if (sessionId === this.activeSessionId) {
        this.emit('sessionMessage', {
          sessionId,
          message: {
            ...message,
            sessionId
          }
        });
      }
    });
    
    wrapper.on('streamContent', (data) => {
      const message = {
        role: data.role || 'assistant', // Use role from data if provided, default to assistant
        content: data.content,
        timestamp: data.timestamp,
        source: data.source
      };
      
      // Store message in database
      if (this.dbInitialized) {
        const metadata = this.sessionMetadata.get(sessionId);
        if (metadata) {
          this.db.addMessage(metadata.sessionName, message).catch(error => {
            console.error('Error storing message:', error);
          });
        }
      }
      
      // Update conversation cache
      this.updateConversationCache(sessionId, message);
      
      // Only emit for active session to avoid UI confusion
      if (sessionId === this.activeSessionId) {
        this.emit('sessionMessage', {
          sessionId,
          message: {
            ...message,
            sessionId
          }
        });
      }
    });
    
    wrapper.on('metricRecorded', (metric) => {
      this.analytics.recordCoreMetric(sessionId, metric.metricType, metric.data);
      this.emit('sessionMetric', { sessionId, metric });
    });
    
    wrapper.on('ready', () => {
      this.emit('sessionReady', { sessionId });
    });
    
    wrapper.on('error', (error) => {
      this.emit('sessionError', { sessionId, error });
    });
    
    wrapper.on('close', (code) => {
      this.emit('sessionClosed', { sessionId, code });
    });
  }
  
  async saveSessionMetadata(sessionId, options) {
    const metadata = {
      sessionId,
      sessionName: options.sessionName || sessionId,
      workingDirectory: options.workingDirectory || process.cwd(),
      createdAt: new Date().toISOString(),
      status: 'inactive',
      debug: options.debug || false,
      extensions: options.extensions || [],
      builtins: options.builtins || [],
      recipeId: options.recipeId || null,
      provider: options.provider || null,
      model: options.model || null
    };
    
    this.sessionMetadata.set(sessionId, metadata);
    
    // Save to database if available
    if (this.dbInitialized) {
      try {
        await this.db.createSession(metadata.sessionName, null);
        await this.db.storeSessionContext(metadata.sessionName, {
          workingDirectory: metadata.workingDirectory,
          extensions: metadata.extensions,
          builtins: metadata.builtins,
          debug: metadata.debug,
          recipeId: metadata.recipeId,
          provider: metadata.provider,
          model: metadata.model
        });
      } catch (error) {
        console.error('Error saving session metadata to database:', error);
      }
    }
    
    return metadata;
  }
  
  async startSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    try {
      await session.start();
      
      // Update metadata
      const metadata = this.sessionMetadata.get(sessionId);
      if (metadata) {
        metadata.status = 'active';
        
        // Update database
        if (this.dbInitialized) {
          await this.db.updateSessionStatus(metadata.sessionName, 'active');
        }
      }
      
      return { success: true, sessionId };
    } catch (error) {
      throw new Error(`Failed to start session ${sessionId}: ${error.message}`);
    }
  }
  
  async stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Terminate subprocess completely (can be resumed later)
    await session.stop();
    
    // Update metadata but keep session record for resuming
    const metadata = this.sessionMetadata.get(sessionId);
    if (metadata) {
      metadata.status = 'stopped';
      
      // Update database
      if (this.dbInitialized) {
        await this.db.updateSessionStatus(metadata.sessionName, 'inactive');
      }
    }
    
    // Remove from active sessions but keep in sessions map for resume
    this.sessions.delete(sessionId);
    
    // If this was the active session, clear active session
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    
    return { 
      success: true, 
      sessionId,
      message: 'Session stopped - subprocess terminated, can be resumed later'
    };
  }
  
  async resumeSession(sessionName) {
    // Check if session is already running
    for (const [id, session] of this.sessions.entries()) {
      const metadata = this.sessionMetadata.get(id);
      if (metadata && metadata.sessionName === sessionName) {
        // Session already running, just switch to it
        return this.switchSession(id);
      }
    }
    
    // Get session context from database
    let sessionContext = {};
    if (this.dbInitialized) {
      try {
        sessionContext = await this.db.getSessionContext(sessionName) || {};
      } catch (error) {
        console.error('Error retrieving session context:', error);
      }
    }
    
    // Create new session for resume
    const sessionId = this.generateSessionId();
    const wrapperOptions = {
      sessionId,
      sessionName,
      workingDirectory: sessionContext.workingDirectory || process.cwd(),
      debug: sessionContext.debug || false,
      extensions: sessionContext.extensions || [],
      builtins: sessionContext.builtins || []
    };
    
    // Include recipe config if session was started with a recipe
    if (sessionContext.recipeConfig) {
      wrapperOptions.recipeConfig = sessionContext.recipeConfig;
    }
    
    const wrapper = new SessionAwareGooseCLIWrapper(wrapperOptions);
    
    // Set up events and store session
    this.setupSessionEvents(sessionId, wrapper);
    this.sessions.set(sessionId, wrapper);
    
    // Create metadata
    const metadataOptions = {
      sessionName,
      workingDirectory: sessionContext.workingDirectory,
      debug: sessionContext.debug,
      extensions: sessionContext.extensions,
      builtins: sessionContext.builtins
    };
    
    // Include recipe ID if session was started with a recipe
    if (sessionContext.recipeId) {
      metadataOptions.recipeId = sessionContext.recipeId;
    }
    
    await this.saveSessionMetadata(sessionId, metadataOptions);
    
    try {
      // Resume using wrapper's resume method
      await wrapper.resumeSession(sessionName);
      
      // Update status
      const metadata = this.sessionMetadata.get(sessionId);
      if (metadata) {
        metadata.status = 'active';
      }
      
      if (this.dbInitialized) {
        await this.db.updateSessionStatus(sessionName, 'active');
      }
      
      return { 
        success: true, 
        sessionId,
        sessionName,
        context: sessionContext
      };
    } catch (error) {
      // Clean up on failure
      this.sessions.delete(sessionId);
      this.sessionMetadata.delete(sessionId);
      throw new Error(`Failed to resume session ${sessionName}: ${error.message}`);
    }
  }
  
  async switchSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const previousId = this.activeSessionId;
    this.activeSessionId = sessionId;
    
    console.log(`Switching from session ${previousId} to session ${sessionId}`);
    
    // Get conversation history for the session - fetch in parallel for speed
    const metadata = this.sessionMetadata.get(sessionId);
    let conversation = [];
    
    if (this.dbInitialized && metadata) {
      try {
        // Check cache first
        conversation = this.conversationCache.get(sessionId) || [];
        
        // Immediately emit the switch event with cached conversation
        this.emit('sessionSwitched', {
          fromSessionId: previousId,
          toSessionId: sessionId,
          conversation: conversation,
          metadata: metadata
        });
        
        // Load fresh conversation asynchronously if not cached or cache is stale
        if (!this.conversationCache.has(sessionId)) {
          console.log(`Loading conversation from database for session ${sessionId} (${metadata.sessionName})`);
          const messages = await this.db.getMessages(metadata.sessionName);
          console.log(`Found ${messages.length} messages in database for session ${metadata.sessionName}`);
          
          conversation = messages.map(msg => ({
            id: msg.message_id || msg.id.toString(),
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            source: msg.source
          }));
          
          // Cache the conversation
          this.conversationCache.set(sessionId, conversation);
          
          // Emit conversation history separately if it's different from cache
          if (conversation.length > 0) {
            console.log(`Emitting conversationLoaded with ${conversation.length} messages`);
            this.emit('conversationLoaded', {
              sessionId,
              conversation
            });
          }
        }
        
      } catch (error) {
        console.error('Error loading conversation for session switch:', error);
      }
    } else {
      // Emit switch event immediately
      this.emit('sessionSwitched', {
        fromSessionId: previousId,
        toSessionId: sessionId,
        conversation,
        metadata: metadata
      });
    }
    
    return { success: true, sessionId, conversation };
  }
  
  updateConversationCache(sessionId, message) {
    if (!this.conversationCache.has(sessionId)) {
      this.conversationCache.set(sessionId, []);
    }
    
    const conversation = this.conversationCache.get(sessionId);
    conversation.push({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      source: message.source
    });
    
    // Keep cache size reasonable (last 100 messages)
    if (conversation.length > 100) {
      conversation.splice(0, conversation.length - 100);
    }
  }
  
  async sendMessageToActiveSession(message) {
    if (!this.activeSessionId) {
      throw new Error('No active session');
    }
    
    const session = this.sessions.get(this.activeSessionId);
    if (!session) {
      throw new Error('Active session not found');
    }
    
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      source: 'web-interface'
    };
    
    // Store user message in database
    const metadata = this.sessionMetadata.get(this.activeSessionId);
    if (this.dbInitialized && metadata) {
      try {
        await this.db.addMessage(metadata.sessionName, userMessage);
      } catch (error) {
        console.error('Error storing user message:', error);
      }
    }
    
    // Update conversation cache with user message
    this.updateConversationCache(this.activeSessionId, userMessage);
    
    // Emit user message immediately
    this.emit('sessionMessage', {
      sessionId: this.activeSessionId,
      message: {
        ...userMessage,
        sessionId: this.activeSessionId
      }
    });
    
    return session.sendMessage(message);
  }
  
  async getRunningSessions() {
    const running = [];
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const metadata = this.sessionMetadata.get(sessionId);
      if (session.isReady && metadata) {
        // If session has null provider/model but has a recipeId, try to restore from recipe
        if ((!metadata.provider || !metadata.model) && metadata.recipeId) {
          await this.restoreProviderModelFromRecipe(sessionId, metadata.recipeId);
        }
        
        running.push({
          sessionId,
          sessionName: metadata.sessionName,
          isActive: sessionId === this.activeSessionId,
          status: 'running',
          createdAt: metadata.createdAt,
          workingDirectory: metadata.workingDirectory,
          metadata
        });
      }
    }
    
    return running;
  }
  
  async getAvailableSessions() {
    // Get sessions from Goose CLI
    try {
      const wrapper = new SessionAwareGooseCLIWrapper();
      return await wrapper.listSessions();
    } catch (error) {
      console.error('Error listing available sessions:', error);
      return [];
    }
  }
  
  getSessionStats(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    
    return {
      ...session.getSessionStats(),
      analytics: this.analytics.getSessionStats(sessionId)
    };
  }
  
  getCrossSessionAnalysis() {
    return this.analytics.getCrossSessionAnalysis();
  }
  
  getActiveSession() {
    if (!this.activeSessionId) {
      return null;
    }
    
    return {
      sessionId: this.activeSessionId,
      session: this.sessions.get(this.activeSessionId),
      metadata: this.sessionMetadata.get(this.activeSessionId)
    };
  }

  // New method to get session provider/model info
  getSessionProviderModel(sessionId) {
    const metadata = this.sessionMetadata.get(sessionId);
    if (!metadata) {
      return null;
    }

    return {
      provider: metadata.provider,
      model: metadata.model
    };
  }

  // Enhanced session info for API responses
  async getSessionInfo(sessionId) {
    const session = this.sessions.get(sessionId);
    const metadata = this.sessionMetadata.get(sessionId);
    
    if (!session || !metadata) {
      return null;
    }

    // If session has null provider/model but has a recipeId, try to restore from recipe
    if ((!metadata.provider || !metadata.model) && metadata.recipeId) {
      await this.restoreProviderModelFromRecipe(sessionId, metadata.recipeId);
    }

    return {
      sessionId,
      sessionName: metadata.sessionName,
      status: metadata.status,
      createdAt: metadata.createdAt,
      workingDirectory: metadata.workingDirectory,
      provider: metadata.provider,
      model: metadata.model,
      recipeId: metadata.recipeId,
      isActive: this.activeSessionId === sessionId
    };
  }

  async restoreProviderModelFromRecipe(sessionId, recipeId) {
    try {
      const recipeManager = require('./recipe-manager');
      const recipe = await recipeManager.getRecipe(recipeId);
      
      if (recipe && recipe.settings) {
        const provider = recipe.settings.goose_provider;
        const model = recipe.settings.goose_model;
        
        if (provider || model) {
          const metadata = this.sessionMetadata.get(sessionId);
          if (metadata) {
            metadata.provider = provider || metadata.provider;
            metadata.model = model || metadata.model;
            this.sessionMetadata.set(sessionId, metadata);
            
            console.log(`Restored provider/model for session ${sessionId}: ${provider}/${model}`);
          }
        }
      }
    } catch (error) {
      console.warn(`Could not restore provider/model for session ${sessionId}:`, error.message);
    }
  }
}

module.exports = MultiSessionManager;