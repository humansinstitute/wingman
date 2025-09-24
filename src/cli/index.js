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
      console.log(chalk.yellow('🛑 Goose session interrupted.'));
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
    console.log(chalk.magenta('  /goose-stop          - Stop current Goose session'));
    console.log(chalk.magenta('  /goose-resume <name> - Resume existing session'));
    console.log(chalk.magenta('  /goose-sessions      - List saved sessions'));
    console.log(chalk.magenta('  /goose-status        - Show Goose status'));
    console.log(chalk.magenta('  /goose-interrupt     - Interrupt current operation'));
    console.log(chalk.yellow('\n=== Commands ==='));
    console.log(chalk.yellow('  /goose-cmd <command> - Send raw command to Goose'));
    console.log(chalk.yellow('  Any other text       - Send message to Goose\n'));
  }

  printStatus() {
    const status = this.currentStatus || {};
    const activeText = status.active ? chalk.green('Active') : chalk.red('Inactive');
    const readyText = status.ready ? chalk.green('Ready') : chalk.yellow('Starting...');
    const nameText = status.sessionName ? chalk.cyan(status.sessionName) : chalk.gray('None');
    console.log(chalk.gray(`Status – Session: ${nameText} | ${activeText} | ${readyText}`));
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
      console.log(chalk.red('❌ No active Goose session. Start one with /goose-start [name].'));
      return;
    }

    if (!this.currentStatus.ready) {
      console.log(chalk.yellow('⏳ Goose session is starting up. Please wait.'));
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
        this.currentStatus = { active: true, sessionName: response.data.sessionName, ready: true };
      } else {
        throw new Error(response.data?.error || 'Unknown error');
      }
    } catch (error) {
      console.log(chalk.red(`❌ Failed to start session: ${error.response?.data?.error || error.message}`));
    }
  }

  async handleGooseStop() {
    try {
      await this.http.post('/api/goose/stop');
      console.log(chalk.green('⏹ Stopped Goose session.'));
      this.currentStatus = { active: false, sessionName: null, ready: false };
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
        this.currentStatus = { active: true, sessionName, ready: true };
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
        console.log(chalk.gray('No saved Goose sessions.'));
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
      console.log(chalk.gray('No active Goose session to interrupt.'));
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
