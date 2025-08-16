const readline = require('readline');
const chalk = require('chalk');
const io = require('socket.io-client');
const conversationManager = require('./shared-state');

class GooseCLIInterface {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue('You: ')
    });

    // Connect to the web server if it's running
    this.socket = io('http://localhost:3000', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    this.setupSocketListeners();
    this.setupEventListeners();
    this.setupGooseListeners();
    this.displayWelcome();
    
    // Load conversation history after connection
    setTimeout(() => {
      this.showConversationHistory();
      this.showGooseStatus();
      
      // Auto-show session menu if no active session
      const status = conversationManager.getGooseStatus();
      if (!status.active) {
        setTimeout(() => {
          this.autoShowSessionMenu();
        }, 100);
      }
      
      this.rl.prompt();
    }, 500);
  }

  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log(chalk.green('✓ Connected to web server'));
    });

    this.socket.on('disconnect', () => {
      console.log(chalk.yellow('⚠ Disconnected from web server - running in standalone mode'));
    });

    this.socket.on('conversationHistory', (messages) => {
      conversationManager.conversation = messages;
      conversationManager.save();
    });

    this.socket.on('newMessage', (message) => {
      if (message.source !== 'cli') {
        this.displayMessage(message);
        this.rl.prompt();
      }
    });

    this.socket.on('conversationCleared', () => {
      conversationManager.conversation = [];
      conversationManager.save();
      console.clear();
      this.displayWelcome();
      this.rl.prompt();
    });

    this.socket.on('gooseStatusUpdate', (status) => {
      this.displayGooseStatus(status);
    });
  }

  setupGooseListeners() {
    conversationManager.on('messageAdded', (message) => {
      if (message.source === 'cli' && this.socket.connected) {
        this.socket.emit('cliMessage', message);
      }
    });

    conversationManager.on('gooseReady', () => {
      console.log(chalk.green('🚀 Goose session is ready!'));
      this.rl.prompt();
    });

    conversationManager.on('gooseError', (error) => {
      console.log(chalk.red(`❌ Goose error: ${error}`));
      this.rl.prompt();
    });

    conversationManager.on('gooseStopped', () => {
      console.log(chalk.yellow('⏹ Goose session stopped'));
      this.rl.prompt();
    });
  }

  setupEventListeners() {
    this.rl.on('line', async (input) => {
      const trimmedInput = input.trim();
      
      if (trimmedInput === '/exit') {
        console.log(chalk.yellow('Stopping Goose session and exiting...'));
        await conversationManager.stopGooseSession();
        this.socket.disconnect();
        process.exit(0);
      }
      
      if (trimmedInput === '/clear') {
        conversationManager.clear();
        if (this.socket.connected) {
          this.socket.emit('clearConversation');
        }
        console.clear();
        this.displayWelcome();
        this.rl.prompt();
        return;
      }

      if (trimmedInput === '/help') {
        this.showHelp();
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
        this.showGooseStatus();
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/goose-cmd ')) {
        await this.handleGooseCommand(trimmedInput.substring(11));
        this.rl.prompt();
        return;
      }
      

      if (trimmedInput) {
        await this.handleUserMessage(trimmedInput);
      }
      
      this.rl.prompt();
    });
  }

  displayWelcome() {
    console.log(chalk.green.bold('\n🤖 Goose CLI Interface'));
    console.log(chalk.gray('Enhanced with Goose AI Agent Integration'));
    console.log(chalk.gray('Type /help for commands, /exit to quit\n'));
  }

  showHelp() {
    console.log(chalk.cyan('\n=== General Commands ==='));
    console.log(chalk.cyan('  /help           - Show this help'));
    console.log(chalk.cyan('  /clear          - Clear conversation'));
    console.log(chalk.cyan('  /exit           - Exit application'));
    
    console.log(chalk.magenta('\n=== Goose Session Commands ==='));
    console.log(chalk.magenta('  /goose-start [name]           - Start new Goose session'));
    console.log(chalk.magenta('  /goose-stop                   - Stop current Goose session'));
    console.log(chalk.magenta('  /goose-resume <name>          - Resume existing Goose session'));
    console.log(chalk.magenta('  /goose-sessions               - List all Goose sessions'));
    console.log(chalk.magenta('  /goose-status                 - Show Goose session status'));
    console.log(chalk.magenta('  /goose-cmd <command>          - Send slash command to Goose'));
    
    console.log(chalk.yellow('\n=== Example Goose Commands ==='));
    console.log(chalk.yellow('  /goose-cmd /help              - Show Goose help'));
    console.log(chalk.yellow('  /goose-cmd /mode chat         - Set Goose to chat mode'));
    console.log(chalk.yellow('  /goose-cmd /builtin developer - Add developer extension'));
    console.log(chalk.yellow('  /goose-cmd /plan <message>    - Create a plan in Goose\n'));
  }
  

  async handleGooseStart(input) {
    const parts = input.split(' ');
    const sessionName = parts[1] || `cli-session-${Date.now()}`;
    
    console.log(chalk.yellow(`Starting Goose session: ${sessionName}...`));
    
    const result = await conversationManager.startGooseSession({
      sessionName: sessionName,
      debug: false,
      builtins: ['developer'] // Default to developer builtin
    });
    
    if (result.success) {
      console.log(chalk.green(`✅ Goose session "${sessionName}" started successfully`));
      if (this.socket.connected) {
        this.socket.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
      }
    } else {
      console.log(chalk.red(`❌ Failed to start Goose session: ${result.error}`));
    }
  }

  async handleGooseStop() {
    console.log(chalk.yellow('Stopping Goose session...'));
    await conversationManager.stopGooseSession();
    console.log(chalk.green('✅ Goose session stopped'));
    
    if (this.socket.connected) {
      this.socket.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
    }
  }

  async handleGooseResume(input) {
    const parts = input.split(' ');
    const sessionName = parts[1];
    
    if (!sessionName) {
      console.log(chalk.red('❌ Please specify a session name: /goose-resume <name>'));
      return;
    }
    
    console.log(chalk.yellow(`Resuming Goose session: ${sessionName}...`));
    
    const result = await conversationManager.resumeGooseSession(sessionName);
    
    if (result.success) {
      console.log(chalk.green(`✅ Resumed Goose session "${sessionName}"`));
      if (this.socket.connected) {
        this.socket.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
      }
    } else {
      console.log(chalk.red(`❌ Failed to resume session: ${result.error}`));
    }
  }

  async handleGooseSessions() {
    console.log(chalk.yellow('📋 Listing Goose sessions...'));
    
    try {
      const sessions = await conversationManager.listGooseSessions();
      
      if (sessions.length === 0) {
        console.log(chalk.gray('No Goose sessions found'));
        return;
      }
      
      console.log(chalk.cyan('\n=== Available Sessions ==='));
      sessions.forEach((session, index) => {
        const name = session.name || session.id || `Session ${index + 1}`;
        const date = session.date ? new Date(session.date).toLocaleString() : 'Unknown date';
        console.log(chalk.cyan(`  ${index + 1}. ${name} (${date})`));
      });
      console.log('');
      
    } catch (error) {
      console.log(chalk.red(`❌ Error listing sessions: ${error.message}`));
    }
  }

  async autoShowSessionMenu() {
    console.log(chalk.yellow('\n🚀 No active session detected. Loading session options...'));
    
    try {
      const sessions = await conversationManager.listGooseSessions();
      
      console.log(chalk.cyan('\n=== Quick Session Menu ==='));
      
      if (sessions.length === 0) {
        console.log(chalk.gray('📄 No existing sessions found'));
        console.log(chalk.green('💡 Start a new session with: /goose-start [name]'));
      } else {
        console.log(chalk.cyan('📋 Available sessions:'));
        sessions.forEach((session, index) => {
          const name = session.name || session.id || `Session ${index + 1}`;
          const date = session.date ? new Date(session.date).toLocaleString() : 'Unknown date';
          console.log(chalk.cyan(`  ${index + 1}. ${name} (${date})`));
        });
        
        console.log(chalk.green('\n💡 Quick actions:'));
        console.log(chalk.green('   • Resume session: /goose-resume <name>'));
        console.log(chalk.green('   • Start new session: /goose-start [name]'));
        console.log(chalk.green('   • List all sessions: /goose-sessions'));
      }
      
      console.log(chalk.gray('   • Type /help for all commands\n'));
      
    } catch (error) {
      console.log(chalk.red(`❌ Error loading session menu: ${error.message}`));
      console.log(chalk.green('💡 Start a new session with: /goose-start [name]\n'));
    }
  }

  async handleGooseCommand(command) {
    const status = conversationManager.getGooseStatus();
    
    if (!status.active) {
      console.log(chalk.red('❌ No active Goose session. Start one with /goose-start'));
      return;
    }
    
    console.log(chalk.yellow(`Sending command to Goose: ${command}`));
    
    try {
      await conversationManager.executeGooseCommand(command);
      console.log(chalk.green('✅ Command sent to Goose'));
    } catch (error) {
      console.log(chalk.red(`❌ Error executing command: ${error.message}`));
    }
  }

  showGooseStatus() {
    const status = conversationManager.getGooseStatus();
    console.log(chalk.cyan('\n=== Goose Status ==='));
    console.log(chalk.cyan(`  Active: ${status.active ? '✅ Yes' : '❌ No'}`));
    console.log(chalk.cyan(`  Session: ${status.sessionName || 'None'}`));
    console.log(chalk.cyan(`  Ready: ${status.ready ? '✅ Yes' : '⏳ Starting...'}\n`));
  }

  displayGooseStatus(status) {
    console.log(chalk.blue(`\n🔄 Goose Status Update: ${status.active ? 'Active' : 'Inactive'}`));
    if (status.sessionName) {
      console.log(chalk.blue(`   Session: ${status.sessionName}`));
    }
  }

  showConversationHistory() {
    const conversation = conversationManager.getConversation();
    conversation.forEach(message => {
      this.displayMessage(message, false);
    });
  }

  displayMessage(message, showSource = true) {
    // Skip thinking and tool messages - they're included in the main stream
    if (message.type === 'thinking' || message.source === 'goose-thinking' || message.source === 'goose-tool') {
      return;
    }
    
    const time = new Date(message.timestamp).toLocaleTimeString();
    
    if (message.role === 'user') {
      console.log(chalk.blue(`[${time}] You: ${message.content}`));
    } else if (message.role === 'system') {
      console.log(chalk.gray(`[${time}] ${message.content}`));
    } else {
      // Everything else (Goose responses) displayed as continuous text
      process.stdout.write(message.content);
      if (!message.content.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }
  }

  async handleUserMessage(content) {
    const status = conversationManager.getGooseStatus();
    
    if (!status.active) {
      console.log(chalk.red('❌ No active Goose session. Start one with /goose-start [name]'));
      return;
    }
    
    if (!status.ready) {
      console.log(chalk.yellow('⏳ Goose session is starting... Please wait.'));
      return;
    }

    try {
      // Don't add message here - sendToGoose will handle it
      this.displayMessage({
        role: 'user',
        content: content,
        source: 'cli',
        timestamp: new Date().toISOString()
      }, false);

      // Show thinking indicator
      process.stdout.write(chalk.yellow('\nGoose is thinking...'));

      await conversationManager.sendToGoose(content, 'cli');

      // Clear thinking indicator
      process.stdout.write('\r' + ' '.repeat(20) + '\r');

    } catch (error) {
      process.stdout.write('\r' + ' '.repeat(20) + '\r');
      console.log(chalk.red(`\nError communicating with Goose: ${error.message}`));
    }
  }
}

// Start CLI if run directly
if (require.main === module) {
  new GooseCLIInterface();
}

module.exports = GooseCLIInterface;