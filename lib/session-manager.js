const { spawn, fork } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const { getDatabase } = require('./database');

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // sessionId -> SessionProcess
    this.activeSessionId = null;
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
      await this.loadActiveSessions();
    } catch (error) {
      console.error('Error initializing session manager:', error);
    }
  }

  async loadActiveSessions() {
    // Load any previously active sessions from database
    if (this.dbInitialized) {
      try {
        const activeSessions = await this.db.getActiveSessions();
        console.log(`Found ${activeSessions.length} previously active sessions`);
        
        // Note: We don't auto-restart sessions on server restart
        // Users will need to manually resume sessions they want to continue
      } catch (error) {
        console.error('Error loading active sessions:', error);
      }
    }
  }

  async createSession(options = {}) {
    const sessionId = options.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const sessionProcess = new SessionProcess({
      sessionId,
      sessionName: options.sessionName || sessionId,
      workingDirectory: options.workingDirectory || process.cwd(),
      extensions: options.extensions || [],
      builtins: options.builtins || ['developer'],
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      recipeId: options.recipeId,
      recipeConfig: options.recipeConfig,
      parameters: options.parameters
    });

    // Set up event listeners
    sessionProcess.on('message', (data) => {
      // Forward messages with session context
      this.emit('sessionMessage', {
        sessionId,
        ...data
      });
    });

    sessionProcess.on('ready', () => {
      this.emit('sessionReady', { sessionId });
    });

    sessionProcess.on('error', (error) => {
      this.emit('sessionError', { sessionId, error });
    });

    sessionProcess.on('exit', (code) => {
      this.sessions.delete(sessionId);
      this.emit('sessionExit', { sessionId, code });
      
      // If this was the active session, clear it
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }
    });

    this.sessions.set(sessionId, sessionProcess);

    try {
      await sessionProcess.start();
      
      // Store in database
      if (this.dbInitialized) {
        await this.db.createSession(sessionId);
        await this.db.updateSessionStatus(sessionId, 'active');
        await this.db.storeSessionContext(sessionId, {
          workingDirectory: options.workingDirectory || process.cwd(),
          extensions: options.extensions || [],
          builtins: options.builtins || ['developer'],
          debug: options.debug || false,
          maxTurns: options.maxTurns || 1000,
          recipeId: options.recipeId,
          recipeConfig: options.recipeConfig,
          parameters: options.parameters
        });
      }

      return {
        success: true,
        sessionId,
        sessionName: options.sessionName || sessionId
      };
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  async resumeSession(sessionName) {
    // Check if session is already running
    for (const [sessionId, sessionProcess] of this.sessions) {
      if (sessionProcess.sessionName === sessionName) {
        this.activeSessionId = sessionId;
        return {
          success: true,
          sessionId,
          sessionName,
          isRunning: true
        };
      }
    }

    // Create new session process for existing session
    const sessionId = `resumed-${sessionName}-${Date.now()}`;
    
    let sessionContext = {};
    if (this.dbInitialized) {
      try {
        sessionContext = await this.db.getSessionContext(sessionName) || {};
      } catch (error) {
        console.error('Error retrieving session context:', error);
      }
    }

    const sessionProcess = new SessionProcess({
      sessionId,
      sessionName,
      workingDirectory: sessionContext.workingDirectory || process.cwd(),
      extensions: sessionContext.extensions || [],
      builtins: sessionContext.builtins || ['developer'],
      debug: sessionContext.debug || false,
      maxTurns: sessionContext.maxTurns || 1000,
      recipeId: sessionContext.recipeId,
      recipeConfig: sessionContext.recipeConfig,
      parameters: sessionContext.parameters,
      isResume: true
    });

    // Set up event listeners
    this.setupSessionListeners(sessionId, sessionProcess);
    this.sessions.set(sessionId, sessionProcess);

    try {
      await sessionProcess.resume(sessionName);
      this.activeSessionId = sessionId;
      
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
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  setupSessionListeners(sessionId, sessionProcess) {
    sessionProcess.on('message', (data) => {
      this.emit('sessionMessage', {
        sessionId,
        ...data
      });
    });

    sessionProcess.on('ready', () => {
      this.emit('sessionReady', { sessionId });
    });

    sessionProcess.on('error', (error) => {
      this.emit('sessionError', { sessionId, error });
    });

    sessionProcess.on('exit', (code) => {
      this.sessions.delete(sessionId);
      this.emit('sessionExit', { sessionId, code });
      
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }
    });
  }

  switchToSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const previousActive = this.activeSessionId;
    this.activeSessionId = sessionId;
    
    this.emit('sessionSwitched', {
      from: previousActive,
      to: sessionId
    });

    return {
      success: true,
      activeSessionId: sessionId,
      previousSessionId: previousActive
    };
  }

  async sendMessage(sessionId, message, source = 'web-interface') {
    const sessionProcess = this.sessions.get(sessionId);
    if (!sessionProcess) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!sessionProcess.isReady) {
      throw new Error(`Session ${sessionId} not ready`);
    }

    return await sessionProcess.sendMessage(message, source);
  }

  async sendMessageToActive(message, source = 'web-interface') {
    if (!this.activeSessionId) {
      throw new Error('No active session');
    }

    return await this.sendMessage(this.activeSessionId, message, source);
  }

  async stopSession(sessionId) {
    const sessionProcess = this.sessions.get(sessionId);
    if (!sessionProcess) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await sessionProcess.stop();
      
      if (this.dbInitialized) {
        await this.db.updateSessionStatus(sessionProcess.sessionName, 'inactive');
      }

      return { success: true };
    } catch (error) {
      console.error(`Error stopping session ${sessionId}:`, error);
      throw error;
    }
  }

  async deleteSession(sessionId) {
    // First stop the session if it's running
    if (this.sessions.has(sessionId)) {
      await this.stopSession(sessionId);
    }

    const sessionProcess = this.sessions.get(sessionId);
    const sessionName = sessionProcess?.sessionName || sessionId;

    try {
      // Delete the session file directly from filesystem (like main branch)
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      
      const sessionFile = path.join(os.homedir(), '.local', 'share', 'goose', 'sessions', `${sessionName}.jsonl`);
      
      try {
        await fs.unlink(sessionFile);
        console.log(`Successfully deleted session file: ${sessionName}`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, consider it already deleted
          console.log(`Session file not found (already deleted): ${sessionName}`);
        } else {
          console.error(`Error deleting session file: ${error.message}`);
          // Continue with cleanup even if file deletion fails
        }
      }

      // Delete from database
      if (this.dbInitialized) {
        await this.db.deleteSession(sessionName);
      }

      this.sessions.delete(sessionId);

      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
      }

      return { success: true };
    } catch (error) {
      console.error(`Error deleting session ${sessionId}:`, error);
      throw error;
    }
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getActiveSession() {
    if (!this.activeSessionId) {
      return null;
    }
    return this.sessions.get(this.activeSessionId);
  }

  getAllSessions() {
    const sessions = [];
    for (const [sessionId, sessionProcess] of this.sessions) {
      sessions.push({
        sessionId,
        sessionName: sessionProcess.sessionName,
        isActive: sessionId === this.activeSessionId,
        isReady: sessionProcess.isReady,
        workingDirectory: sessionProcess.workingDirectory,
        status: sessionProcess.isReady ? 'ready' : 'starting'
      });
    }
    return sessions;
  }

  async getGooseSessions() {
    // Get sessions from Goose CLI
    try {
      const { spawn } = require('child_process');
      const listProcess = spawn('goose', ['session', 'list', '--format', 'json'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      listProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      return new Promise((resolve) => {
        listProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const gooseSessions = JSON.parse(output);
              
              // Merge with running sessions info
              const runningSessions = this.getAllSessions();
              const runningSessionNames = new Set(runningSessions.map(s => s.sessionName));
              
              const mergedSessions = gooseSessions.map(session => ({
                ...session,
                name: session.id, // Normalize the field name
                isRunning: runningSessionNames.has(session.id),
                sessionId: runningSessions.find(s => s.sessionName === session.id)?.sessionId
              }));
              
              resolve(mergedSessions);
            } catch (error) {
              resolve([]);
            }
          } else {
            resolve([]);
          }
        });
      });
    } catch (error) {
      console.error('Error listing Goose sessions:', error);
      return [];
    }
  }

  getStatus() {
    return {
      totalSessions: this.sessions.size,
      activeSessionId: this.activeSessionId,
      sessions: this.getAllSessions()
    };
  }
}

class SessionProcess extends EventEmitter {
  constructor(options) {
    super();
    this.sessionId = options.sessionId;
    this.sessionName = options.sessionName;
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.extensions = options.extensions || [];
    this.builtins = options.builtins || [];
    this.debug = options.debug || false;
    this.maxTurns = options.maxTurns || 1000;
    this.recipeId = options.recipeId;
    this.recipeConfig = options.recipeConfig;
    this.parameters = options.parameters;
    this.isResume = options.isResume || false;
    
    this.gooseProcess = null;
    this.isReady = false;
    this.contentBuffer = '';
    this.flushTimer = null;
    this.isResuming = false;
    this.initialHistoryLoaded = false;
  }

  async start() {
    return new Promise((resolve, reject) => {
      // ALWAYS use --name, never --resume (matches main branch behavior)
      // The main branch never actually uses --resume, it just starts a new session with the same name
      const args = ['session', '--name', this.sessionName];
      
      // Reset resume mode flags
      this.resumeMode = false;
      this.resumeSessionName = null;
      
      if (this.debug) {
        args.push('--debug');
      }
      
      if (this.maxTurns) {
        args.push('--max-turns', this.maxTurns.toString());
      }
      
      this.extensions.forEach(ext => {
        args.push('--with-extension', ext);
      });
      
      this.builtins.forEach(builtin => {
        args.push('--with-builtin', builtin);
      });

      // Add recipe support (but not for resume)
      if (this.recipeConfig && !this.isResuming) {
        // Create temporary recipe file
        this.createTempRecipeFile().then(recipePath => {
          if (recipePath) {
            args.push('--recipe', recipePath);
          }
          this.startGooseProcess(args, resolve, reject);
        }).catch(reject);
      } else {
        this.startGooseProcess(args, resolve, reject);
      }
    });
  }

  startGooseProcess(args, resolve, reject) {
    console.log(`[${this.sessionId}] Starting Goose: goose ${args.join(' ')}`);
    console.log(`[${this.sessionId}] Working directory: ${this.workingDirectory}`);
    
    this.gooseProcess = spawn('goose', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.workingDirectory
    });
    
    // Ensure stdin is properly configured
    this.gooseProcess.stdin.setEncoding('utf-8');
    this.gooseProcess.stdin.setDefaultEncoding('utf-8');

    this.gooseProcess.stdout.on('data', (data) => {
      this.handleOutput(data.toString());
    });

    this.gooseProcess.stderr.on('data', (data) => {
      console.error(`[${this.sessionId}] Goose stderr:`, data.toString());
      this.emit('error', data.toString());
    });

    this.gooseProcess.on('close', (code) => {
      console.log(`[${this.sessionId}] Goose process exited with code ${code}`);
      this.emit('exit', code);
    });

    this.gooseProcess.on('error', (error) => {
      console.error(`[${this.sessionId}] Failed to start Goose:`, error);
      reject(error);
    });

    // Give Goose time to start up
    setTimeout(() => {
      this.isReady = true;
      this.emit('ready');
      resolve();
    }, 3000);
  }

  async resume(sessionName) {
    this.isResuming = true;
    this.initialHistoryLoaded = false;
    this.sessionName = sessionName; // Update session name
    
    // Set up resume args and call start() like the main branch does
    this.resumeMode = true;
    this.resumeSessionName = sessionName;
    
    return this.start();
  }

  async createTempRecipeFile() {
    if (!this.recipeConfig) return null;
    
    try {
      const tempDir = path.join(__dirname, '..', 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      
      const tempFilePath = path.join(tempDir, `recipe-${this.sessionId}.json`);
      await fs.writeFile(tempFilePath, JSON.stringify(this.recipeConfig, null, 2));
      
      return tempFilePath;
    } catch (error) {
      console.error(`[${this.sessionId}] Error creating temp recipe file:`, error);
      return null;
    }
  }

  handleOutput(data) {
    const timestamp = new Date().toISOString();
    const cleanData = this.stripAnsiCodes(data);
    
    // Skip system startup messages
    if (this.isSystemStartup(cleanData)) {
      return;
    }
    
    // Handle conversation history when resuming
    if (this.isResuming && !this.initialHistoryLoaded) {
      if (this.isConversationHistory(cleanData)) {
        this.emit('message', {
          type: 'history',
          content: cleanData,
          timestamp: timestamp,
          source: 'goose-history'
        });
        return;
      }
      
      if (this.isSessionReady(cleanData)) {
        this.initialHistoryLoaded = true;
        this.isResuming = false;
        return;
      }
    }
    
    // Skip context indicators
    if (cleanData.includes('Context: ')) {
      this.flushBuffer(timestamp);
      return;
    }
    
    // Add to buffer for continuous streaming
    this.contentBuffer += cleanData;
    this.resetFlushTimer(timestamp);
  }

  resetFlushTimer(timestamp) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.flushTimer = setTimeout(() => {
      this.flushBuffer(timestamp);
    }, 200);
  }

  flushBuffer(timestamp) {
    if (this.contentBuffer.trim()) {
      this.emit('message', {
        type: 'stream',
        role: 'assistant',
        content: this.contentBuffer.trim(),
        timestamp: timestamp,
        source: 'goose-stream'
      });
      
      this.contentBuffer = '';
    }
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  isSystemStartup(data) {
    const systemPatterns = [
      /^starting session/,
      /^logging to/,
      /^working directory:/,
      /^Goose is running!/,
      /WARN.*goose::/,
      /^\d{4}-\d{2}-\d{2}T.*WARN/,
      /^at crates\//
    ];
    
    return systemPatterns.some(pattern => pattern.test(data.trim()));
  }

  isConversationHistory(data) {
    const historyPatterns = [
      /^You:/,
      /^Assistant:/,
      /^User:/,
      /^\[.*\] You:/,
      /^\[.*\] Assistant:/,
      /^.*: /,
      /^[A-Za-z]/,
    ];
    
    if (this.isSystemStartup(data)) {
      return false;
    }
    
    return data.trim().length > 5 && historyPatterns.some(pattern => pattern.test(data.trim()));
  }

  isSessionReady(data) {
    const readyPatterns = [
      /^>$/,
      /^Enter your message:/,
      /ready for input/i,
      /What would you like/i,
    ];
    
    return readyPatterns.some(pattern => pattern.test(data.trim()));
  }

  stripAnsiCodes(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  async sendMessage(message, source = 'web-interface') {
    if (!this.isReady || !this.gooseProcess) {
      throw new Error(`Session ${this.sessionId} not ready`);
    }

    // Flush any pending content before new message
    this.flushBuffer(new Date().toISOString());

    // Emit user message
    const userMessage = {
      type: 'user',
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      source: source
    };
    
    this.emit('message', userMessage);

    return new Promise((resolve) => {
      this.gooseProcess.stdin.write(message + '\n');
      resolve({ sent: true, message: userMessage });
    });
  }

  async stop() {
    if (this.gooseProcess) {
      this.gooseProcess.stdin.write('/exit\n');
      
      setTimeout(() => {
        if (this.gooseProcess && !this.gooseProcess.killed) {
          this.gooseProcess.kill('SIGTERM');
        }
      }, 5000);
    }
  }
}

module.exports = SessionManager;
