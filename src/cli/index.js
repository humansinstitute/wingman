#!/usr/bin/env node
const readline = require('readline');
const chalk = require('chalk');
const axios = require('axios');
const io = require('socket.io-client');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

class WingmanCLI {
  constructor() {
    this.socket = null;
    this.http = null;
    this.baseUrl = null;
    this.serverHost = process.env.WINGMAN_SERVER_HOST || 'localhost';
    this.currentStatus = { active: false, sessionName: null, ready: false };
    this.pendingUserEcho = [];
    this.messagesLoaded = false;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue('You: ')
    });

    this.bootstrap().catch((error) => {
      console.error(chalk.red(`Failed to start Wingman CLI: ${error.message}`));
      this.rl.close();
      process.exit(1);
    });
  }

  async bootstrap() {
    this.displayWelcome();
    const detected = await this.detectServer();

    if (!detected) {
      console.log(chalk.yellow('\nNo Wingman server detected on localhost.'));
      console.log(chalk.yellow('Start the server first with `npm run web` (or `npm start`).'));
      console.log(chalk.yellow('The CLI will exit now.')); 
      this.rl.close();
      process.exit(1);
    }

    this.baseUrl = detected.baseUrl;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000
    });

    await this.initialFetch();
    this.setupSocket();
    this.setupInputHandlers();
    this.rl.prompt();
  }

  displayWelcome() {
    console.log(chalk.green.bold('\n🪶 Wingman CLI'));
    console.log(chalk.gray('Type /help for commands, /exit to quit.'));
  }

  async detectServer() {
    // Respect explicit URL first
    if (process.env.WINGMAN_SERVER_URL) {
      const url = process.env.WINGMAN_SERVER_URL;
      try {
        const parsed = new URL(url);
        const reachable = await this.checkPort(parsed.hostname, parsed.port || 80);
        if (reachable) {
          return { baseUrl: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}` };
        }
      } catch (error) {
        console.warn(chalk.yellow(`Ignoring invalid WINGMAN_SERVER_URL: ${error.message}`));
      }
    }

    const candidatePorts = new Set();
    const addPort = (value) => {
      const num = parseInt(value, 10);
      if (!Number.isNaN(num) && num > 0) {
        candidatePorts.add(num);
      }
    };

    addPort(process.env.WINGMAN_SERVER_PORT);
    addPort(process.env.WINGMAN_WEB_PORT);
    addPort(process.env.PORT);

    for (const envPath of this.envFilesToCheck()) {
      if (fs.existsSync(envPath)) {
        try {
          const parsed = dotenv.parse(fs.readFileSync(envPath));
          addPort(parsed.WINGMAN_SERVER_PORT || parsed.WINGMAN_WEB_PORT || parsed.PORT);
        } catch (error) {
          console.warn(chalk.yellow(`Could not parse ${envPath}: ${error.message}`));
        }
      }
    }

    // Defaults if nothing configured
    if (candidatePorts.size === 0) {
      for (let port = 3000; port <= 3010; port++) {
        candidatePorts.add(port);
      }
    }

    const host = this.serverHost;
    for (const port of candidatePorts) {
      /* eslint-disable no-await-in-loop */
      const reachable = await this.checkPort(host, port);
      if (reachable) {
        return { baseUrl: `http://${host}:${port}` };
      }
      /* eslint-enable no-await-in-loop */
    }

    return null;
  }

  envFilesToCheck() {
    const files = [
      path.join(process.cwd(), '.env'),
      path.join(os.homedir(), '.wingman', '.env')
    ];
    return files;
  }

  checkPort(host, port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const cleanup = () => {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
      };

      socket.setTimeout(500);
      socket.once('connect', () => {
        cleanup();
        resolve(true);
      });

      socket.once('timeout', () => {
        cleanup();
        resolve(false);
      });

      socket.once('error', () => {
        cleanup();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  async initialFetch() {
    await this.refreshStatus();
    await this.loadConversationHistory();
    await this.showRunningSessionsBadge();
  }

  async refreshStatus() {
    try {
      const response = await this.http.get('/api/goose/status');
      this.currentStatus = response.data || { active: false };
      this.printStatus();
    } catch (error) {
      console.warn(chalk.yellow('⚠ Unable to read Goose status from server.')); 
    }
  }

  async loadConversationHistory() {
    try {
      const response = await this.http.get('/api/conversation');
      const messages = response.data || [];
      if (messages.length > 0) {
        console.log(chalk.gray('\n--- Conversation History ---'));
        messages.forEach((message) => this.displayMessage(message, true));
        console.log(chalk.gray('--- End History ---\n'));
      }
      this.messagesLoaded = true;
    } catch (error) {
      console.warn(chalk.yellow('⚠ Unable to load conversation history.'));
    }
  }

  async showRunningSessionsBadge() {
    try {
      const response = await this.http.get('/api/sessions/running');
      const running = response.data || [];
      if (running.length > 0) {
        const active = running.find((s) => s.isActive);
        if (!this.currentStatus.active && active) {
          this.currentStatus = { active: true, sessionName: active.sessionName, ready: true };
        }
        console.log(chalk.gray(`Active sessions: ${running.length}`));
      }
    } catch (error) {
      // Non-fatal
    }
  }

  setupSocket() {
    this.socket = io(this.baseUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log(chalk.green(`\n✓ Connected to Wingman server (${this.baseUrl})`));
      if (!this.messagesLoaded) {
        this.loadConversationHistory();
      }
    });

    this.socket.on('disconnect', () => {
      console.log(chalk.yellow('\n⚠ Lost connection to Wingman server. Retrying...'));
    });

    this.socket.on('conversationHistory', (messages) => {
      if (!Array.isArray(messages)) return;
      if (messages.length === 0) return;
      console.log(chalk.gray('\n--- Conversation History ---'));
      messages.forEach((message) => this.displayMessage(message, true));
      console.log(chalk.gray('--- End History ---\n'));
    });

    this.socket.on('newMessage', (message) => {
      this.displayMessage(message, false);
      this.rl.prompt();
    });

    this.socket.on('gooseStatusUpdate', (status) => {
      this.currentStatus = status;
      this.printStatus();
      this.rl.prompt();
    });

    this.socket.on('gooseError', (error) => {
      if (!error) return;
      const text = typeof error === 'string' ? error : error.error || JSON.stringify(error);
      console.log(chalk.red(`❌ Goose error: ${text}`));
      this.rl.prompt();
    });

    this.socket.on('sessionInterrupted', () => {
      console.log(chalk.yellow('🛑 Session interrupted.'));
      this.rl.prompt();
    });

    this.socket.on('processingComplete', () => {
      console.log(chalk.green('✅ Goose finished processing.'));
      this.rl.prompt();
    });

    this.socket.on('sessionsUpdate', (update) => {
      if (!update || !update.type) return;
      switch (update.type) {
        case 'sessionStarted':
          console.log(chalk.green(`✅ Session started: ${update.sessionName || update.sessionId}`));
          break;
        case 'sessionStopped':
          console.log(chalk.yellow(`⏹ Session stopped: ${update.message || update.sessionName || update.sessionId}`));
          break;
        case 'sessionResumed':
          console.log(chalk.green(`▶️ Session resumed: ${update.sessionName || update.sessionId}`));
          break;
        case 'sessionSwitched':
          console.log(chalk.cyan('🔄 Switched active session.'));
          break;
        default:
          console.log(chalk.gray(`Session update: ${update.type}`));
      }
      this.rl.prompt();
    });
  }

  setupInputHandlers() {
    this.rl.on('line', async (input) => {
      const trimmedInput = input.trim();

      if (!trimmedInput) {
        this.rl.prompt();
        return;
      }

      if (trimmedInput === '/exit') {
        await this.gracefulExit();
        return;
      }

      if (trimmedInput === '/help') {
        this.showHelp();
        this.rl.prompt();
        return;
      }

      if (trimmedInput === '/clear') {
        await this.handleClear();
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-start')) {
        await this.handleGooseStart(trimmedInput);
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/agent-start')) {
        await this.handleAgentStart(trimmedInput);
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-stop')) {
        await this.handleGooseStop();
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-resume')) {
        await this.handleGooseResume(trimmedInput);
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-sessions')) {
        await this.handleGooseSessions();
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-status')) {
        await this.refreshStatus();
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-command') || trimmedInput.startsWith('/goose-cmd')) {
        await this.handleGooseCommand(trimmedInput.replace(/^[^\s]+\s*/, ''));
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-interrupt')) {
        await this.handleGooseInterrupt();
        this.rl.prompt();
        return;
      }

      await this.handleUserMessage(trimmedInput);
      this.rl.prompt();
    });

    this.rl.on('SIGINT', async () => {
      if (this.currentStatus.active) {
        await this.handleGooseInterrupt();
        this.rl.prompt();
      } else {
        await this.gracefulExit();
      }
    });
  }

  showHelp() {
    console.log(chalk.cyan('\n=== Wingman Commands ==='));
    console.log(chalk.cyan('  /help                - Show this help'));
    console.log(chalk.cyan('  /clear               - Clear conversation history'));
    console.log(chalk.cyan('  /exit                - Exit the CLI'));
    console.log(chalk.magenta('\n=== Goose Session ==='));
    console.log(chalk.magenta('  /goose-start [name]  - Start new Goose session'));
    console.log(chalk.magenta('  /goose-stop          - Stop current session'));
    console.log(chalk.magenta('  /goose-resume <name> - Resume existing session'));
    console.log(chalk.magenta('  /goose-sessions      - List saved sessions'));
    console.log(chalk.magenta('  /goose-status        - Show session status'));
    console.log(chalk.magenta('  /goose-interrupt     - Interrupt current operation'));
    console.log(chalk.blue('\n=== AgentAPI Session ==='));
    console.log(chalk.blue('  /agent-start [options] <agent-cli> [args] - Start AgentAPI-backed session'));
    console.log(chalk.yellow('\n=== Commands ==='));
    console.log(chalk.yellow('  /goose-cmd <command> - Send raw command to Goose/agent CLI'));
    console.log(chalk.yellow('  Any other text       - Send message to active session\n'));
  }

  printStatus() {
    const status = this.currentStatus || {};
    const activeText = status.active ? chalk.green('Active') : chalk.red('Inactive');
    const readyText = status.ready ? chalk.green('Ready') : chalk.yellow('Starting...');
    const nameText = status.sessionName ? chalk.cyan(status.sessionName) : chalk.gray('None');
    const transportText = status.transport ? chalk.gray(` via ${status.transport}`) : '';
    const portText = status.port ? chalk.gray(` @:${status.port}`) : '';
    console.log(chalk.gray(`Status – Session: ${nameText}${transportText}${portText} | ${activeText} | ${readyText}`));
  }

  parseCommandArgs(input) {
    const args = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = regex.exec(input))) {
      args.push(match[1] ?? match[2] ?? match[3]);
    }
    return args;
  }

  displayMessage(message, fromHistory = false) {
    if (!message || typeof message !== 'object') return;

    // Skip internal thinking/tool chatter
    if (message.type === 'thinking' || message.source === 'goose-thinking' || message.source === 'goose-tool') {
      return;
    }

    // Avoid echoing our own user message twice
    if (message.role === 'user') {
      const idx = this.pendingUserEcho.findIndex((entry) => entry === message.content);
      if (idx !== -1) {
        this.pendingUserEcho.splice(idx, 1);
        return;
      }
    }

    const timestamp = message.timestamp ? new Date(message.timestamp) : new Date();
    const time = timestamp.toLocaleTimeString();
    const prefix = fromHistory ? chalk.gray('[history] ') : '';

    if (message.role === 'user') {
      console.log(`${prefix}${chalk.blue(`[${time}] You:`)} ${message.content}`);
    } else if (message.role === 'system') {
      console.log(`${prefix}${chalk.gray(`[${time}] ${message.content}`)}`);
    } else {
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      process.stdout.write(prefix + content);
      if (!content.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }
  }

  async handleUserMessage(content) {
    if (!this.currentStatus.active) {
      console.log(chalk.red('❌ No active session. Start one with /goose-start or /agent-start.'));
      return;
    }

    if (!this.currentStatus.ready) {
      console.log(chalk.yellow('⏳ Session is starting up. Please wait.'));
      return;
    }

    this.pendingUserEcho.push(content);
    console.log(`${chalk.blue(`[${new Date().toLocaleTimeString()}] You:`)} ${content}`);

    try {
      await this.http.post('/api/message', {
        content,
        settings: { source: 'cli' }
      });
    } catch (error) {
      console.log(chalk.red(`❌ Failed to send message: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleGooseStart(input) {
    const parts = input.split(' ');
    const sessionName = parts[1] || `cli-session-${Date.now()}`;

    try {
      const response = await this.http.post('/api/goose/start', {
        sessionName,
        builtins: ['developer']
      });

      if (response.data?.success) {
        console.log(chalk.green(`✅ Started Goose session: ${response.data.sessionName}`));
        this.currentStatus = { active: true, sessionName: response.data.sessionName, ready: true, transport: 'goose' };
      } else {
        throw new Error(response.data?.error || 'Unknown error');
      }
    } catch (error) {
      console.log(chalk.red(`❌ Failed to start session: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleAgentStart(input) {
    const raw = input.replace('/agent-start', '').trim();
    if (!raw) {
      console.log(chalk.red('❌ Usage: /agent-start [--name session] [--binary path] [--cwd dir] [--port N] <agent-cli> [args...]'));
      return;
    }

    const tokens = this.parseCommandArgs(raw);
    if (tokens.length === 0) {
      console.log(chalk.red('❌ Usage: /agent-start [options] <agent-cli> [args...]'));
      return;
    }

    let sessionName = null;
    let agentBinaryPath = null;
    let workingDirectory = null;
    const serverOptions = {};
    const env = {};
    let agentCli = null;
    const agentArgs = [];

    const readValue = (currentToken, currentIndex) => {
      if (currentToken.includes('=')) {
        return currentToken.split('=').slice(1).join('=');
      }
      if (currentIndex + 1 < tokens.length) {
        return tokens[currentIndex + 1];
      }
      return null;
    };

    const advanceIfNeeded = (token, index) => {
      if (!token.includes('=') && index + 1 < tokens.length) {
        return index + 1;
      }
      return index;
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token === '--') {
        continue;
      }

      switch (true) {
        case token.startsWith('--name'):
          sessionName = readValue(token, i) || sessionName;
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--binary'):
          agentBinaryPath = readValue(token, i) || agentBinaryPath;
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--cwd'):
        case token.startsWith('--working-dir'):
          workingDirectory = readValue(token, i) || workingDirectory;
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--port'):
          {
            const value = readValue(token, i);
            const parsed = value ? parseInt(value, 10) : NaN;
            if (!Number.isNaN(parsed)) {
              serverOptions.port = parsed;
            }
            i = advanceIfNeeded(token, i);
          }
          continue;
        case token.startsWith('--allowed-hosts'):
          serverOptions.allowedHosts = readValue(token, i);
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--allowed-origins'):
          serverOptions.allowedOrigins = readValue(token, i);
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--chat-base-path'):
          serverOptions.chatBasePath = readValue(token, i);
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--term-width'):
          {
            const value = readValue(token, i);
            const parsed = value ? parseInt(value, 10) : NaN;
            if (!Number.isNaN(parsed)) serverOptions.termWidth = parsed;
            i = advanceIfNeeded(token, i);
          }
          continue;
        case token.startsWith('--term-height'):
          {
            const value = readValue(token, i);
            const parsed = value ? parseInt(value, 10) : NaN;
            if (!Number.isNaN(parsed)) serverOptions.termHeight = parsed;
            i = advanceIfNeeded(token, i);
          }
          continue;
        case token.startsWith('--type'):
          serverOptions.type = readValue(token, i);
          i = advanceIfNeeded(token, i);
          continue;
        case token.startsWith('--initial-prompt'):
          serverOptions.initialPrompt = readValue(token, i);
          i = advanceIfNeeded(token, i);
          continue;
        case token === '--verbose':
          serverOptions.verbose = true;
          continue;
        case token.startsWith('--env'):
          {
            const pair = readValue(token, i);
            i = advanceIfNeeded(token, i);
            if (pair && pair.includes('=')) {
              const [key, ...rest] = pair.split('=');
              env[key] = rest.join('=');
            } else {
              console.log(chalk.yellow('⚠️ Ignored --env without KEY=VALUE'));
            }
          }
          continue;
        default:
          if (!agentCli) {
            agentCli = token;
          } else {
            agentArgs.push(token);
          }
      }

      if (!token.startsWith('--')) {
        // already handled above
        continue;
      }
    }

    if (!agentCli) {
      console.log(chalk.red('❌ Missing agent CLI. Provide one after options, e.g. /agent-start claude'));
      return;
    }

    const payload = {
      sessionName: sessionName || `agent-${Date.now()}`,
      agentCli,
      agentArgs,
      agentBinaryPath,
      workingDirectory,
      serverOptions,
      env
    };

    // Clean empty objects to keep payload tidy
    if (!payload.agentBinaryPath) delete payload.agentBinaryPath;
    if (!payload.workingDirectory) delete payload.workingDirectory;
    if (payload.serverOptions && Object.keys(payload.serverOptions).length === 0) delete payload.serverOptions;
    if (payload.env && Object.keys(payload.env).length === 0) delete payload.env;

    try {
      const response = await this.http.post('/api/agents/start', payload);
      if (response.data?.success) {
        const portDisplay = response.data.port ? ` on port ${response.data.port}` : '';
        console.log(chalk.green(`✅ Started AgentAPI session: ${response.data.sessionName}${portDisplay}`));
        this.currentStatus = {
          active: true,
          sessionName: response.data.sessionName,
          ready: true,
          transport: response.data.transport || 'agentapi',
          port: response.data.port || null
        };
      } else {
        throw new Error(response.data?.error || 'Unknown error');
      }
    } catch (error) {
      console.log(chalk.red(`❌ Failed to start AgentAPI session: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleGooseStop() {
    try {
      await this.http.post('/api/goose/stop');
      console.log(chalk.green('⏹ Stopped session.'));
      this.currentStatus = { active: false, sessionName: null, ready: false, transport: null, port: null };
    } catch (error) {
      console.log(chalk.red(`❌ Failed to stop session: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleGooseResume(input) {
    const [, sessionName] = input.split(' ');
    if (!sessionName) {
      console.log(chalk.red('❌ Usage: /goose-resume <session-name>'));
      return;
    }

    try {
      const response = await this.http.post('/api/goose/resume', { sessionName });
      if (response.data?.success) {
        console.log(chalk.green(`✅ Resumed session: ${sessionName}`));
        this.currentStatus = {
          active: true,
          sessionName,
          ready: true,
          transport: response.data.transport || this.currentStatus.transport || 'goose',
          port: response.data.port || null
        };
      } else {
        throw new Error(response.data?.error || 'Unknown error');
      }
    } catch (error) {
      console.log(chalk.red(`❌ Failed to resume session: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleGooseSessions() {
    try {
      const response = await this.http.get('/api/goose/sessions');
      const sessions = response.data || [];

      if (sessions.length === 0) {
      console.log(chalk.gray('No saved sessions.'));
        return;
      }

      console.log(chalk.cyan('\nAvailable sessions:'));
      sessions.forEach((session, index) => {
        const name = session.name || session.id || `Session ${index + 1}`;
        console.log(chalk.cyan(`  ${index + 1}. ${name}`));
      });
      console.log('');
    } catch (error) {
      console.log(chalk.red(`❌ Failed to list sessions: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleGooseCommand(command) {
    const trimmed = command.trim();
    if (!trimmed) {
      console.log(chalk.red('❌ Usage: /goose-cmd <command>'));
      return;
    }

    await this.handleUserMessage(trimmed.startsWith('/') ? trimmed : `/${trimmed}`);
  }

  async handleGooseInterrupt() {
    if (!this.currentStatus.active) {
      console.log(chalk.gray('No active session to interrupt.'));
      return;
    }

    try {
      await this.http.post('/api/goose/interrupt');
      console.log(chalk.yellow('🛑 Interrupt signal sent.'));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to interrupt: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleClear() {
    try {
      await this.http.delete('/api/conversation');
      console.log(chalk.green('🧹 Conversation cleared.'));
    } catch (error) {
      console.log(chalk.red(`❌ Failed to clear conversation: ${error.response?.data?.error || error.message}`));
    }
  }

  async gracefulExit() {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.rl.close();
    process.exit(0);
  }
}

if (require.main === module) {
  new WingmanCLI();
}

module.exports = WingmanCLI;
