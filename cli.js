const readline = require('readline');
const chalk = require('chalk');
const io = require('socket.io-client');
const conversationManager = require('./shared-state');
const ScheduleEngine = require('./schedule-engine');

class GooseCLIInterface {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue('You: ')
    });

    // Initialize schedule engine
    this.scheduleEngine = new ScheduleEngine();

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

      // Schedule management commands
      if (trimmedInput.startsWith('/schedule-create')) {
        await this.handleScheduleCreate(trimmedInput);
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-list')) {
        await this.handleScheduleList(trimmedInput);
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-show ')) {
        await this.handleScheduleShow(trimmedInput.substring(15));
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-pause ')) {
        await this.handleSchedulePause(trimmedInput.substring(16));
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-resume ')) {
        await this.handleScheduleResume(trimmedInput.substring(17));
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-delete ')) {
        await this.handleScheduleDelete(trimmedInput.substring(17));
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-run ')) {
        await this.handleScheduleRun(trimmedInput.substring(14));
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-history')) {
        await this.handleScheduleHistory(trimmedInput);
        this.rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/schedule-status')) {
        await this.handleScheduleStatus();
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
    
    console.log(chalk.blue('\n=== Schedule Management ==='));
    console.log(chalk.blue('  /schedule-create              - Create new schedule'));
    console.log(chalk.blue('  /schedule-list                - List all schedules'));
    console.log(chalk.blue('  /schedule-show <id>           - Show schedule details'));
    console.log(chalk.blue('  /schedule-pause <id>          - Pause a schedule'));
    console.log(chalk.blue('  /schedule-resume <id>         - Resume a paused schedule'));
    console.log(chalk.blue('  /schedule-delete <id>         - Delete a schedule'));
    console.log(chalk.blue('  /schedule-run <id>            - Run schedule immediately'));
    console.log(chalk.blue('  /schedule-history [id]        - Show execution history'));
    console.log(chalk.blue('  /schedule-status              - Show schedule engine status'));
    
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

  // Schedule management handlers
  async handleScheduleCreate(input) {
    console.log(chalk.cyan('\n=== Create New Schedule ==='));
    
    try {
      const config = {};
      
      // Interactive schedule creation
      config.name = await this.askQuestion('Schedule name: ');
      config.description = await this.askQuestion('Description (optional): ');
      config.recipeId = await this.askQuestion('Recipe ID: ');
      config.cronExpression = await this.askQuestion('Cron expression (e.g., "30 6 * * 1-5"): ');
      
      const parametersInput = await this.askQuestion('Parameters (JSON, optional): ');
      if (parametersInput.trim()) {
        try {
          config.parameters = JSON.parse(parametersInput);
        } catch (error) {
          console.log(chalk.red('Invalid JSON parameters, using empty object'));
          config.parameters = {};
        }
      }

      const schedule = await this.scheduleEngine.createSchedule(config);
      console.log(chalk.green(`✓ Schedule created: ${schedule.id}`));
      console.log(`Next execution: ${schedule.nextExecution}`);
    } catch (error) {
      console.log(chalk.red(`✗ Failed to create schedule: ${error.message}`));
    }
  }

  async handleScheduleList(input) {
    try {
      const schedules = await this.scheduleEngine.getAllSchedules();
      
      if (schedules.length === 0) {
        console.log(chalk.yellow('\nNo schedules found'));
        return;
      }
      
      console.log(chalk.cyan('\n=== Scheduled Jobs ==='));
      console.log('─'.repeat(80));
      
      for (const schedule of schedules) {
        const status = schedule.enabled ? chalk.green('●') : chalk.red('○');
        const nextRun = schedule.nextExecution ? 
          new Date(schedule.nextExecution).toLocaleString() : 'N/A';
        
        console.log(`${status} ${chalk.bold(schedule.name)} (${schedule.id})`);
        console.log(`   Recipe: ${schedule.recipeId}`);
        console.log(`   Schedule: ${schedule.cronExpression}`);
        console.log(`   Next run: ${nextRun}`);
        console.log(`   Executions: ${schedule.executionCount} (${schedule.failureCount} failed)`);
        console.log('');
      }
    } catch (error) {
      console.log(chalk.red(`Error listing schedules: ${error.message}`));
    }
  }

  async handleScheduleShow(scheduleId) {
    try {
      const schedule = await this.scheduleEngine.getSchedule(scheduleId);
      if (!schedule) {
        console.log(chalk.red(`Schedule not found: ${scheduleId}`));
        return;
      }

      console.log(chalk.cyan('\n=== Schedule Details ==='));
      console.log(`${chalk.bold('ID:')} ${schedule.id}`);
      console.log(`${chalk.bold('Name:')} ${schedule.name}`);
      console.log(`${chalk.bold('Description:')} ${schedule.description || 'None'}`);
      console.log(`${chalk.bold('Recipe:')} ${schedule.recipeId}`);
      console.log(`${chalk.bold('Schedule:')} ${schedule.cronExpression}`);
      console.log(`${chalk.bold('Timezone:')} ${schedule.timezone}`);
      console.log(`${chalk.bold('Status:')} ${schedule.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
      console.log(`${chalk.bold('Created:')} ${new Date(schedule.createdAt).toLocaleString()}`);
      console.log(`${chalk.bold('Next run:')} ${schedule.nextExecution ? new Date(schedule.nextExecution).toLocaleString() : 'N/A'}`);
      console.log(`${chalk.bold('Last run:')} ${schedule.lastExecuted ? new Date(schedule.lastExecuted).toLocaleString() : 'Never'}`);
      console.log(`${chalk.bold('Executions:')} ${schedule.executionCount} (${schedule.failureCount} failed)`);
      
      if (Object.keys(schedule.parameters).length > 0) {
        console.log(`${chalk.bold('Parameters:')}`);
        console.log(JSON.stringify(schedule.parameters, null, 2));
      }
    } catch (error) {
      console.log(chalk.red(`Error showing schedule: ${error.message}`));
    }
  }

  async handleSchedulePause(scheduleId) {
    try {
      await this.scheduleEngine.pauseSchedule(scheduleId);
      console.log(chalk.green(`✓ Schedule paused: ${scheduleId}`));
    } catch (error) {
      console.log(chalk.red(`✗ Failed to pause schedule: ${error.message}`));
    }
  }

  async handleScheduleResume(scheduleId) {
    try {
      await this.scheduleEngine.resumeSchedule(scheduleId);
      console.log(chalk.green(`✓ Schedule resumed: ${scheduleId}`));
    } catch (error) {
      console.log(chalk.red(`✗ Failed to resume schedule: ${error.message}`));
    }
  }

  async handleScheduleDelete(scheduleId) {
    try {
      const confirm = await this.askQuestion(`Are you sure you want to delete schedule ${scheduleId}? (y/N): `);
      if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
        await this.scheduleEngine.deleteSchedule(scheduleId);
        console.log(chalk.green(`✓ Schedule deleted: ${scheduleId}`));
      } else {
        console.log(chalk.yellow('Deletion cancelled'));
      }
    } catch (error) {
      console.log(chalk.red(`✗ Failed to delete schedule: ${error.message}`));
    }
  }

  async handleScheduleRun(scheduleId) {
    try {
      console.log(chalk.yellow(`Running schedule: ${scheduleId}`));
      await this.scheduleEngine.executeSchedule(scheduleId);
      console.log(chalk.green('✓ Schedule execution started'));
    } catch (error) {
      console.log(chalk.red(`✗ Failed to run schedule: ${error.message}`));
    }
  }

  async handleScheduleHistory(input) {
    try {
      const parts = input.trim().split(' ');
      const scheduleId = parts.length > 1 ? parts[1] : null;
      const limit = 10;

      const history = await this.scheduleEngine.getExecutionHistory(scheduleId, limit);
      
      if (history.length === 0) {
        console.log(chalk.yellow('\nNo execution history found'));
        return;
      }

      console.log(chalk.cyan('\n=== Execution History ==='));
      console.log('─'.repeat(80));

      for (const execution of history) {
        const status = execution.status === 'completed' ? chalk.green('✓') : 
                      execution.status === 'failed' ? chalk.red('✗') : 
                      chalk.yellow('●');
        
        const duration = execution.duration ? `${Math.round(execution.duration / 1000)}s` : 'N/A';
        
        console.log(`${status} ${execution.scheduleId} - ${new Date(execution.startedAt).toLocaleString()}`);
        console.log(`   Status: ${execution.status} | Duration: ${duration}`);
        if (execution.error) {
          console.log(`   Error: ${execution.error}`);
        }
        console.log('');
      }
    } catch (error) {
      console.log(chalk.red(`Error getting execution history: ${error.message}`));
    }
  }

  async handleScheduleStatus() {
    try {
      const status = await this.scheduleEngine.getStatus();
      
      console.log(chalk.cyan('\n=== Schedule Engine Status ==='));
      console.log(`${chalk.bold('Total schedules:')} ${status.totalSchedules}`);
      console.log(`${chalk.bold('Active schedules:')} ${status.activeSchedules}`);
      console.log(`${chalk.bold('Running executions:')} ${status.runningExecutions}`);
      console.log(`${chalk.bold('Engine uptime:')} ${Math.round(status.uptime)}s`);
    } catch (error) {
      console.log(chalk.red(`Error getting schedule status: ${error.message}`));
    }
  }

  askQuestion(question) {
    return new Promise(resolve => {
      this.rl.question(question, resolve);
    });
  }
}

// Start CLI if run directly
if (require.main === module) {
  new GooseCLIInterface();
}

module.exports = GooseCLIInterface;