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
    
    const wrapper = new SessionAwareGooseCLIWrapper({
      ...options,
      sessionId,
      sessionName
    });
    
    // Set up event forwarding with session context
    this.setupSessionEvents(sessionId, wrapper);
    
    // Store session
    this.sessions.set(sessionId, wrapper);
    await this.saveSessionMetadata(sessionId, options);
    
    return { sessionId, wrapper, sessionName };
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
      // Only emit for active session to avoid UI confusion
      if (sessionId === this.activeSessionId) {
        this.emit('sessionMessage', {
          sessionId,
          message: {
            role: 'assistant',
            content: data.content,
            timestamp: data.timestamp,
            source: data.source,
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
      recipeId: options.recipeId || null
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
          recipeId: metadata.recipeId
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
    const wrapper = new SessionAwareGooseCLIWrapper({
      sessionId,
      sessionName,
      workingDirectory: sessionContext.workingDirectory || process.cwd(),
      debug: sessionContext.debug || false,
      extensions: sessionContext.extensions || [],
      builtins: sessionContext.builtins || []
    });
    
    // Set up events and store session
    this.setupSessionEvents(sessionId, wrapper);
    this.sessions.set(sessionId, wrapper);
    
    // Create metadata
    await this.saveSessionMetadata(sessionId, {
      sessionName,
      workingDirectory: sessionContext.workingDirectory,
      debug: sessionContext.debug,
      extensions: sessionContext.extensions,
      builtins: sessionContext.builtins
    });
    
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
    
    // Get conversation history for the session
    const metadata = this.sessionMetadata.get(sessionId);
    let conversation = [];
    
    if (this.dbInitialized && metadata) {
      try {
        const messages = await this.db.getMessages(metadata.sessionName);
        conversation = messages.map(msg => ({
          id: msg.message_id || msg.id.toString(),
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          source: msg.source
        }));
      } catch (error) {
        console.error('Error loading conversation for session switch:', error);
      }
    }
    
    // Emit switch event with conversation history
    this.emit('sessionSwitched', {
      fromSessionId: previousId,
      toSessionId: sessionId,
      conversation,
      metadata: metadata
    });
    
    return { success: true, sessionId, conversation };
  }
  
  async sendMessageToActiveSession(message) {
    if (!this.activeSessionId) {
      throw new Error('No active session');
    }
    
    const session = this.sessions.get(this.activeSessionId);
    if (!session) {
      throw new Error('Active session not found');
    }
    
    // Emit user message immediately
    this.emit('sessionMessage', {
      sessionId: this.activeSessionId,
      message: {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        source: 'web-interface',
        sessionId: this.activeSessionId
      }
    });
    
    return session.sendMessage(message);
  }
  
  getRunningSessions() {
    const running = [];
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const metadata = this.sessionMetadata.get(sessionId);
      if (session.isReady && metadata) {
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
}

module.exports = MultiSessionManager;