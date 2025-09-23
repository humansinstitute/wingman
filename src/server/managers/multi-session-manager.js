const EventEmitter = require('events');
const SessionAwareGooseCLIWrapper = require('../../wrappers/session-aware-wrapper');
const { getDatabase } = require('../../shared/utils/database');
const WingmanConfig = require('../../shared/config/wingman-config');

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
    this.wingmanConfig = null;
    
    this.init();
  }
  
  async init() {
    try {
      if (!this.dbInitialized) {
        // Initialize Wingman configuration for worktree support
        this.wingmanConfig = await WingmanConfig.create();
        
        await this.db.init();
        await this.extendDatabaseSchema();
        this.dbInitialized = true;
        
        console.log(`MultiSessionManager initialized for worktree: ${this.wingmanConfig.getWorktreeId()}`);
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
    
    console.log('Session creation options:', {
      provider,
      model,
      providerOverride,
      hasProviderOverride: !!providerOverride
    });
    
    // Determine final provider/model
    let finalProvider = provider;
    let finalModel = model;
    
    // Handle provider override from recipe launch
    if (providerOverride) {
      finalProvider = providerOverride.provider;
      finalModel = providerOverride.model;
      console.log('Applied provider override:', { finalProvider, finalModel });
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
    
    // Store session with provider/model and worktree metadata
    this.sessions.set(sessionId, wrapper);
    console.log('Saving metadata with provider/model:', { 
      finalProvider, 
      finalModel,
      optionsProvider: options.provider,
      optionsModel: options.model
    });
    
    // Get recipe name if recipe ID is provided
    let recipeName = null;
    if (options.recipeId) {
      try {
        const RecipeManager = require('../../recipes/manager');
        const recipe = await RecipeManager.getRecipe(options.recipeId);
        if (recipe) {
          recipeName = recipe.name || recipe.title || null;
        }
      } catch (error) {
        console.warn(`Could not get recipe name for ID ${options.recipeId}:`, error.message);
      }
    }
    
    await this.saveSessionMetadata(sessionId, {
      ...options,
      provider: finalProvider,
      model: finalModel,
      recipeName: recipeName,
      worktreeId: this.wingmanConfig ? this.wingmanConfig.getWorktreeId() : 'main',
      originalWorktree: this.wingmanConfig ? this.wingmanConfig.getWorktreeId() : 'main'
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
      let friendly = error;
      try {
        const text = typeof error === 'string' ? error : (error?.message || '');
        if (/Failed to access keyring|Platform secure storage failure/i.test(text)) {
          friendly = 'Keychain locked. Unlock your macOS Keychain (Keychain Access → unlock "login") and run `goose configure` to re-store credentials, then retry.';
        }
      } catch (_) {}
      this.emit('sessionError', { sessionId, error: friendly });
    });
    
    wrapper.on('close', (code) => {
      this.emit('sessionClosed', { sessionId, code });
    });
  }
  
  async saveSessionMetadata(sessionId, options) {
    console.log('saveSessionMetadata called with options:', {
      provider: options.provider,
      model: options.model,
      hasProvider: 'provider' in options,
      hasModel: 'model' in options
    });
    
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
      recipeName: options.recipeName || null,
      provider: options.provider || null,
      model: options.model || null
    };
    
    console.log('Final metadata to store:', {
      provider: metadata.provider,
      model: metadata.model
    });
    
    this.sessionMetadata.set(sessionId, metadata);
    
    // Save to database if available
    if (this.dbInitialized) {
      try {
        // Persist full session context (compatible API). Will create if missing.
        await this.db.storeSessionContext(metadata.sessionName, metadata);
        await this.db.updateSessionStatus(metadata.sessionName, 'inactive');
      } catch (error) {
        console.error('Error saving session metadata:', error);
      }
    }
  }
  
  updateConversationCache(sessionId, message) {
    if (!this.conversationCache.has(sessionId)) {
      this.conversationCache.set(sessionId, []);
    }
    this.conversationCache.get(sessionId).push(message);
  }
  
  async startSession(sessionId) {
    const wrapper = this.sessions.get(sessionId);
    if (!wrapper) throw new Error('Session not found');
    await wrapper.start();
    const metadata = this.sessionMetadata.get(sessionId);
    if (this.dbInitialized && metadata) {
      await this.db.updateSessionStatus(metadata.sessionName, 'active');
    }
    return { success: true };
  }
  
  async sendMessageToActiveSession(content, settings = {}) {
    if (!this.activeSessionId) throw new Error('No active session');
    const wrapper = this.sessions.get(this.activeSessionId);
    if (!wrapper) throw new Error('Active session not found');
    try {
      console.log(`[MultiSession] Sending message to session ${this.activeSessionId}: ${String(content).slice(0,120)}${String(content).length>120?'...':''}`);
    } catch (_) {}
    
    // If session is not yet ready, wait briefly for readiness to avoid UX errors after resume/start
    if (!wrapper.isReady) {
      await new Promise((resolve) => {
        let settled = false;
        const onReady = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
        const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); resolve(); } }, 3000);
        const cleanup = () => {
          clearTimeout(timer);
          wrapper.off && wrapper.off('ready', onReady);
          wrapper.removeListener && wrapper.removeListener('ready', onReady);
        };
        if (wrapper.on) wrapper.on('ready', onReady);
      });
    }
    
    // Store user message
    if (this.dbInitialized) {
      const metadata = this.sessionMetadata.get(this.activeSessionId);
      if (metadata) {
        const msg = {
          role: 'user',
          content,
          timestamp: new Date().toISOString(),
          source: 'web'
        };
        await this.db.addMessage(metadata.sessionName, msg).catch(() => {});
        // Update cache immediately so UI reflects the message without waiting
        this.updateConversationCache(this.activeSessionId, msg);
        // Emit a session message so server broadcasts to clients
        this.emit('sessionMessage', { sessionId: this.activeSessionId, message: { ...msg, sessionId: this.activeSessionId } });
      }
    }
    
    const result = await wrapper.sendMessage(content, settings);
    console.log(`[MultiSession] Message injected into Goose stdin for session ${this.activeSessionId}`);
    return result;
  }
  
  async interruptActiveSession() {
    if (!this.activeSessionId) throw new Error('No active session');
    const wrapper = this.sessions.get(this.activeSessionId);
    if (!wrapper) throw new Error('Active session not found');
    await wrapper.interrupt();
    return { success: true, sessionId: this.activeSessionId };
  }
  
  async forceStopActiveSession() {
    if (!this.activeSessionId) throw new Error('No active session');
    const wrapper = this.sessions.get(this.activeSessionId);
    if (!wrapper) throw new Error('Active session not found');
    await wrapper.forceStop();
    return { success: true, sessionId: this.activeSessionId };
  }
  
  async stopSession(sessionId) {
    const wrapper = this.sessions.get(sessionId);
    if (!wrapper) throw new Error('Session not found');
    await wrapper.stop();
    const metadata = this.sessionMetadata.get(sessionId);
    if (this.dbInitialized && metadata) {
      await this.db.updateSessionStatus(metadata.sessionName, 'stopped');
    }
    return { success: true };
  }
  
  async resumeSession(sessionName) {
    console.log(`Attempting to resume session: ${sessionName}`);
    
    // Check if session is already running
    for (const [id, session] of this.sessions.entries()) {
      const metadata = this.sessionMetadata.get(id);
      if (metadata && metadata.sessionName === sessionName) {
        console.log(`Session ${sessionName} already running, switching to it`);
        return this.switchSession(id);
      }
    }
    
    // Get session context from database
    let sessionContext = {};
    if (this.dbInitialized) {
      try {
        sessionContext = await this.db.getSessionContext(sessionName) || {};
        console.log(`Retrieved session context for ${sessionName}:`, {
          hasRecipe: !!sessionContext.recipeId,
          worktree: sessionContext.worktree || 'unknown',
          extensions: sessionContext.extensions?.length || 0
        });
      } catch (error) {
        console.error('Error retrieving session context:', error);
      }
    }
    
    // Check if session exists in database
    const sessionRecord = await this.db.getSession(sessionName);
    if (!sessionRecord) {
      throw new Error(`Session '${sessionName}' not found in database`);
    }
    
    // Handle cross-worktree session restoration
    const currentWorktree = this.wingmanConfig ? this.wingmanConfig.getWorktreeId() : 'main';
    const sessionWorktree = sessionRecord.worktree_id || sessionRecord.original_worktree || 'main';
    
    if (sessionWorktree !== currentWorktree) {
      console.log(`Cross-worktree restoration: ${sessionWorktree} → ${currentWorktree}`);
      // Update session worktree in database
      await this.db.updateSessionWorktree(sessionName, currentWorktree);
    }
    
    // Verify recipe availability for cross-worktree restoration
    if (sessionContext.recipeId) {
      try {
        const RecipeManager = require('../../recipes/manager');
        const recipe = await RecipeManager.getRecipe(sessionContext.recipeId);
        if (!recipe) {
          console.warn(`Recipe ${sessionContext.recipeId} not found in current worktree ${currentWorktree}`);
          console.warn('Session will be resumed without recipe context');
          delete sessionContext.recipeId;
          delete sessionContext.recipeConfig;
        } else {
          console.log(`Recipe ${recipe.name} found and available for session restoration`);
        }
      } catch (error) {
        console.error('Error checking recipe availability:', error);
        delete sessionContext.recipeId;
        delete sessionContext.recipeConfig;
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
      builtins: sessionContext.builtins,
      provider: sessionContext.provider,
      model: sessionContext.model
    };
    
    // Include recipe ID and name if session was started with a recipe
    if (sessionContext.recipeId) {
      metadataOptions.recipeId = sessionContext.recipeId;
      
      // Try to get recipe name
      try {
        const RecipeManager = require('../../../recipe-manager');
        const recipe = await RecipeManager.getRecipe(sessionContext.recipeId);
        if (recipe) {
          metadataOptions.recipeName = recipe.name || recipe.title || null;
        }
      } catch (error) {
        console.warn(`Could not get recipe name for resumed session:`, error.message);
      }
    }
    
    await this.saveSessionMetadata(sessionId, metadataOptions);
    
    // Load conversation from database
    if (this.dbInitialized) {
      try {
        const messages = await this.db.getMessages(sessionName);
        const conversation = messages.map(msg => ({
          id: msg.message_id || msg.id?.toString?.() || `${msg.rowid || ''}`,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          source: msg.source
        }));
        this.conversationCache.set(sessionId, conversation);
      } catch (error) {
        console.error('Error loading conversation for resumed session:', error);
        this.conversationCache.set(sessionId, []);
      }
    }
    
    // Start the underlying process and mark active
    try {
      await this.startSession(sessionId);
    } catch (error) {
      console.error('Error starting resumed session process:', error);
    }
    
    // Switch to the resumed session (broadcasts conversation)
    await this.switchSession(sessionId);
    
    return { success: true, sessionId };
  }
  
  async getAvailableSessions() {
    if (!this.dbInitialized) return [];
    const sessions = await this.db.getAllSessions();
    return sessions.map(s => ({ id: s.session_name, title: s.session_name }));
  }
  
  async getRunningSessions() {
    const result = [];
    for (const [id] of this.sessions.entries()) {
      const meta = this.sessionMetadata.get(id);
      result.push({
        sessionId: id,
        sessionName: meta?.sessionName || id,
        isActive: id === this.activeSessionId
      });
    }
    return result;
  }
  
  async switchSession(sessionId) {
    if (!this.sessions.has(sessionId)) throw new Error('Session not found');
    this.activeSessionId = sessionId;
    const conversation = this.conversationCache.get(sessionId) || [];
    this.emit('sessionSwitched', { toSessionId: sessionId, conversation });
    return { success: true, conversation };
  }
  
  getSessionStats(sessionId) {
    const wrapper = this.sessions.get(sessionId);
    if (!wrapper) return null;
    const stats = this.analytics.getSessionStats(sessionId) || {};
    return { ...wrapper.getSessionStats?.(), ...stats };
  }
  
  getCrossSessionAnalysis() {
    return this.analytics.getCrossSessionAnalysis();
  }
  
  getSessionProviderModel(sessionId) {
    const meta = this.sessionMetadata.get(sessionId);
    if (!meta) return null;
    return { provider: meta.provider, model: meta.model };
  }
  
  async getSessionInfo(sessionId) {
    const meta = this.sessionMetadata.get(sessionId);
    if (!meta) return null;
    const stats = this.getSessionStats(sessionId);
    const resource = await this.sessions.get(sessionId)?.getResourceUsage?.();
    return { ...meta, stats, resource };
  }
}

module.exports = MultiSessionManager;
