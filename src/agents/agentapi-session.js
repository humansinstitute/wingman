const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { setTimeout: delay } = require('timers/promises');
const portAllocator = require('./port-allocator');

const DEFAULT_READY_RETRIES = 40;
const READY_POLL_INTERVAL_MS = 250;

class AgentAPISession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionId = options.sessionId;
    this.sessionName = options.sessionName || this.sessionId;
    this.options = {
      workingDirectory: options.workingDirectory || process.cwd(),
      agentBinaryPath: options.agentBinaryPath || process.env.AGENTAPI_BINARY || process.env.AGENTAPI_PATH,
      agentCli: options.agentCli,
      agentArgs: Array.isArray(options.agentArgs) ? options.agentArgs : (options.agentArgs ? [options.agentArgs] : []),
      agentCommand: Array.isArray(options.agentCommand) ? options.agentCommand : null,
      serverOptions: options.serverOptions || {},
      env: options.env || {},
      debug: !!options.debug
    };

    this.agentProcess = null;
    this.processExited = false;
    this.sseStream = null;
    this.sseRequest = null;
    this.port = null;
    this.releasePort = null;
    this.isReady = false;
    this.isProcessing = false;
    this.http = null;
    this.stats = {
      startTime: null,
      userMessages: 0,
      assistantMessages: 0,
      lastActivity: null
    };

    this.pendingMessages = new Map(); // messageId -> message
    this.emittedMessages = new Map(); // messageId -> content
    this.messageOrder = [];
    this.reconnectAttempts = 0;
  }

  resolveBinaryPath() {
    if (this.options.agentBinaryPath) {
      return this.options.agentBinaryPath;
    }

    const wingmanHome = process.env.WINGMAN_HOME || path.join(os.homedir(), '.wingman');
    return path.join(wingmanHome, 'agents', 'agentapi');
  }

  async start() {
    if (this.agentProcess) {
      throw new Error('AgentAPI session already started');
    }

    const binaryPath = this.resolveBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`AgentAPI binary not found at ${binaryPath}. Install it via scripts or npm run agents:install.`);
    }

    const { port, release } = portAllocator.acquire(this.options.serverOptions.port);
    this.port = port;
    this.releasePort = release;

    this.processExited = false;

    try {
      const args = this.buildProcessArgs();
      const env = { ...process.env, ...this.options.env };

      this.log(`Starting AgentAPI: ${binaryPath} ${args.join(' ')}`);
      this.log(`Working directory: ${this.options.workingDirectory}`);

      this.agentProcess = spawn(binaryPath, args, {
        cwd: this.options.workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.agentProcess.stdout.on('data', (chunk) => {
        this.log(`[agentapi stdout] ${chunk.toString()}`);
      });

      this.agentProcess.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        this.log(`[agentapi stderr] ${text}`);
        if (!this.isReady && text.toLowerCase().includes('error')) {
          this.emit('error', text.trim());
        }
      });

      this.agentProcess.on('exit', (code, signal) => {
        this.processExited = true;
        this.log(`AgentAPI process exited with code ${code} signal ${signal}`);
        this.cleanupStreams();
        if (this.releasePort) {
          this.releasePort();
          this.releasePort = null;
        }
        this.agentProcess = null;
        this.http = null;
        this.isReady = false;
        this.emit('close', code);
      });

      this.agentProcess.on('error', (error) => {
        this.processExited = true;
        this.emit('error', error);
      });

      this.stats.startTime = Date.now();
      this.stats.lastActivity = new Date().toISOString();

      const baseUrl = `http://127.0.0.1:${this.port}`;
      this.http = axios.create({
        baseURL: baseUrl,
        timeout: 5000
      });

      await this.waitForServerReady();
      await this.connectEventStream();
      await this.bootstrapInitialConversation();

      this.isReady = true;
      this.emit('ready');

      return { port: this.port };
    } catch (error) {
      this.log(`Failed to start AgentAPI session: ${error.message}`);
      if (this.agentProcess && !this.agentProcess.killed) {
        try {
          this.agentProcess.kill('SIGTERM');
        } catch (_) {}
      }
      this.cleanupStreams();
      if (this.releasePort) {
        this.releasePort();
        this.releasePort = null;
      }
      this.agentProcess = null;
      this.http = null;
      this.isReady = false;
      this.processExited = true;
      throw error;
    }
  }

  buildProcessArgs() {
    const args = ['server', '--port', String(this.port)];

    const opts = this.options.serverOptions || {};
    const allowedHosts = opts.allowedHosts || process.env.AGENTAPI_ALLOWED_HOSTS;
    const allowedOrigins = opts.allowedOrigins || process.env.AGENTAPI_ALLOWED_ORIGINS;
    const chatBasePath = opts.chatBasePath || process.env.AGENTAPI_CHAT_BASE_PATH;
    const termWidth = opts.termWidth || process.env.AGENTAPI_TERM_WIDTH;
    const termHeight = opts.termHeight || process.env.AGENTAPI_TERM_HEIGHT;
    const agentType = opts.type || process.env.AGENTAPI_TYPE;
    const initialPrompt = opts.initialPrompt || process.env.AGENTAPI_INITIAL_PROMPT;
    const verbose = opts.verbose || process.env.AGENTAPI_VERBOSE === '1';

    if (allowedHosts) {
      args.push('--allowed-hosts', String(allowedHosts));
    }
    if (allowedOrigins) {
      args.push('--allowed-origins', String(allowedOrigins));
    }
    if (chatBasePath) {
      args.push('--chat-base-path', String(chatBasePath));
    }
    if (termWidth) {
      args.push('--term-width', String(termWidth));
    }
    if (termHeight) {
      args.push('--term-height', String(termHeight));
    }
    if (agentType) {
      args.push('--type', String(agentType));
    }
    if (initialPrompt) {
      args.push('--initial-prompt', String(initialPrompt));
    }
    if (verbose) {
      args.push('--verbose');
    }

    const agentCommand = this.buildAgentCommand();
    if (!agentCommand.length) {
      throw new Error('No agent CLI specified for AgentAPI session');
    }

    args.push('--', ...agentCommand);
    return args;
  }

  buildAgentCommand() {
    if (this.options.agentCommand && this.options.agentCommand.length > 0) {
      return this.options.agentCommand;
    }
    if (!this.options.agentCli) {
      return [];
    }
    return [this.options.agentCli, ...(this.options.agentArgs || [])];
  }

  async waitForServerReady() {
    for (let attempt = 0; attempt < DEFAULT_READY_RETRIES; attempt++) {
      if (this.processExited) {
        throw new Error('AgentAPI process exited during startup');
      }
      try {
        const response = await this.http.get('/status', { timeout: 2000 });
        if (response?.status === 200) {
          return;
        }
      } catch (_) {
        // ignore and retry
      }
      await delay(READY_POLL_INTERVAL_MS);
    }
    throw new Error(`AgentAPI server did not become ready on port ${this.port}`);
  }

  async connectEventStream() {
    const response = await this.http.get('/events', {
      responseType: 'stream',
      headers: { Accept: 'text/event-stream' }
    });

    this.sseStream = response.data;
    this.sseStream.on('data', (chunk) => {
      this.processSSEChunk(chunk.toString());
    });

    this.sseStream.on('end', () => {
      if (!this.processExited) {
        this.log('AgentAPI SSE stream ended; attempting reconnect.');
        this.scheduleReconnect();
      }
    });

    this.sseStream.on('error', (error) => {
      if (!this.processExited) {
        this.log(`AgentAPI SSE error: ${error.message}`);
        this.scheduleReconnect();
      }
    });
  }

  processSSEChunk(chunk) {
    this.sseBuffer = (this.sseBuffer || '') + chunk;
    let separatorIndex;

    while ((separatorIndex = this.sseBuffer.indexOf('\n\n')) !== -1) {
      const rawEvent = this.sseBuffer.slice(0, separatorIndex);
      this.sseBuffer = this.sseBuffer.slice(separatorIndex + 2);
      if (rawEvent.trim().length === 0) continue;
      this.handleSSEBlock(rawEvent);
    }
  }

  handleSSEBlock(block) {
    const lines = block.split(/\r?\n/);
    let eventName = 'message';
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (!dataLines.length) {
      return;
    }

    const payloadRaw = dataLines.join('\n');
    let payload;
    try {
      payload = JSON.parse(payloadRaw);
    } catch (error) {
      this.log(`Failed to parse SSE payload: ${error.message}`);
      return;
    }

    this.handleSSEEvent(eventName, payload);
  }

  handleSSEEvent(eventName, payload) {
    const normalizedEvent = (eventName || '').trim().toLowerCase();

    if (normalizedEvent === 'message_update' || normalizedEvent === 'message' || normalizedEvent === '') {
      this.handleMessageUpdate(payload);
    } else if (normalizedEvent === 'status_change' || normalizedEvent === 'status') {
      this.handleStatusChange(payload);
    }
  }

  handleMessageUpdate(payload) {
    if (!payload) return;

    const role = (payload.role || '').toLowerCase() === 'user' ? 'user' : 'assistant';
    if (role === 'user') {
      return; // Wingman already records outbound user messages
    }

    const messageId = payload.id !== undefined && payload.id !== null ? String(payload.id) : undefined;
    const normalized = {
      role,
      content: payload.message || '',
      timestamp: payload.time || new Date().toISOString(),
      source: 'agentapi',
      messageId,
      id: messageId
    };

    if (normalized.content.trim().length === 0) {
      return;
    }

    if (messageId && !this.messageOrder.includes(messageId)) {
      this.messageOrder.push(messageId);
    }

    if (messageId) {
      this.pendingMessages.set(messageId, normalized);
      const previous = this.emittedMessages.get(messageId);
      if (previous !== normalized.content) {
        this.emitStreamMessage(normalized);
        this.emittedMessages.set(messageId, normalized.content);
      }
    } else {
      // No ID means we emit immediately to avoid losing content
      this.emitStreamMessage(normalized);
    }
  }

  handleStatusChange(payload) {
    if (!payload) return;
    const status = (payload.status || '').toLowerCase();
    if (status === 'running') {
      this.isProcessing = true;
    } else if (status === 'stable') {
      this.isProcessing = false;
      this.flushPendingMessages();
      this.emit('processingComplete', { sessionId: this.sessionId, status: 'stable' });
    }
  }

  flushPendingMessages() {
    for (const messageId of this.messageOrder) {
      if (!this.pendingMessages.has(messageId)) continue;
      const message = this.pendingMessages.get(messageId);
      const previous = this.emittedMessages.get(messageId);
      if (previous !== message.content) {
        this.emitStreamMessage(message);
        this.emittedMessages.set(messageId, message.content);
      }
      this.pendingMessages.delete(messageId);
    }
  }

  emitStreamMessage(message) {
    this.stats.assistantMessages += 1;
    this.stats.lastActivity = new Date().toISOString();
    this.emit('streamContent', {
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
      source: 'agentapi'
    });
  }

  async bootstrapInitialConversation() {
    try {
      const response = await this.http.get('/messages');
      if (!Array.isArray(response.data)) return;
      response.data.forEach((entry) => {
        const normalized = this.normalizeHistoryMessage(entry);
        if (!normalized) return;
        if (normalized.messageId) {
          this.emittedMessages.set(normalized.messageId, normalized.content);
        }
        this.emitStreamMessage(normalized);
      });
    } catch (error) {
      this.log(`Failed to load initial AgentAPI conversation: ${error.message}`);
    }
  }

  normalizeHistoryMessage(entry) {
    if (!entry) return null;
    const role = (entry.type || '').toLowerCase() === 'user' ? 'user' : 'assistant';
    if (role === 'user') {
      return null; // user messages already appear from Wingman
    }
    const messageId = entry.id !== undefined && entry.id !== null ? String(entry.id) : undefined;
    const content = entry.content || '';
    if (!content.trim()) return null;
    return {
      role,
      content,
      timestamp: entry.timestamp || new Date().toISOString(),
      source: 'agentapi',
      messageId,
      id: messageId
    };
  }

  scheduleReconnect() {
    if (this.processExited) return;
    if (this.reconnectTimer) return;

    const delayMs = Math.min(2000 * Math.max(1, this.reconnectAttempts + 1), 10000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.processExited) return;
      try {
        this.reconnectAttempts += 1;
        await this.connectEventStream();
        this.reconnectAttempts = 0;
      } catch (error) {
        this.log(`AgentAPI SSE reconnect failed: ${error.message}`);
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  cleanupStreams() {
    if (this.sseStream) {
      this.sseStream.removeAllListeners();
      if (typeof this.sseStream.destroy === 'function') {
        this.sseStream.destroy();
      }
      this.sseStream = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async sendMessage(content) {
    if (!this.http) {
      throw new Error('AgentAPI session has not started yet');
    }
    await this.http.post('/message', {
      content,
      type: 'user'
    });
    this.stats.userMessages += 1;
    this.stats.lastActivity = new Date().toISOString();
    return { success: true };
  }

  async interrupt() {
    return { success: false, message: 'Interrupt is not yet supported for AgentAPI sessions.' };
  }

  async forceStop() {
    await this.stop();
    return { success: true };
  }

  async stop() {
    this.cleanupStreams();
    if (this.agentProcess && !this.agentProcess.killed) {
      this.agentProcess.kill('SIGTERM');
    }
    if (this.releasePort) {
      this.releasePort();
      this.releasePort = null;
    }
  }

  getSessionStats() {
    const duration = this.stats.startTime ? Date.now() - this.stats.startTime : 0;
    return {
      assistantMessages: this.stats.assistantMessages,
      userMessages: this.stats.userMessages,
      sessionDuration: duration,
      lastActivity: this.stats.lastActivity,
      port: this.port,
      transport: 'agentapi'
    };
  }

  getListeningPort() {
    return this.port;
  }

  log(message) {
    if (this.options.debug || process.env.WINGMAN_DEBUG === '1' || process.env.LOG_LEVEL === 'debug') {
      console.log(`[AgentAPISession] ${message}`);
    }
  }
}

module.exports = AgentAPISession;
