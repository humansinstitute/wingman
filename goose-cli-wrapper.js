const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class GooseCLIWrapper extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      sessionName: options.sessionName || `web-session-${Date.now()}`,
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      extensions: options.extensions || [],
      builtins: options.builtins || [],
      recipe: options.recipe || null,
      recipePath: options.recipePath || null,
      parameters: options.parameters || {},
      workingDirectory: options.workingDirectory || process.cwd(),
      ...options
    };
    
    this.gooseProcess = null;
    this.isReady = false;
    this.buffer = '';
    this.currentConversation = [];
  }

  async start() {
    return new Promise((resolve, reject) => {
      const args = ['session', '--name', this.options.sessionName];
      
      if (this.options.debug) {
        args.push('--debug');
      }
      
      if (this.options.maxTurns) {
        args.push('--max-turns', this.options.maxTurns.toString());
      }
      
      // Add recipe if specified
      if (this.options.recipePath) {
        args.push('--recipe', this.options.recipePath);
      }
      
      // Add extensions (if not using recipe or as additional)
      this.options.extensions.forEach(ext => {
        args.push('--with-extension', ext);
      });
      
      // Add built-in extensions (if not using recipe or as additional)
      this.options.builtins.forEach(builtin => {
        args.push('--with-builtin', builtin);
      });
      
      console.log(`Starting Goose session: goose ${args.join(' ')}`);
      
      this.gooseProcess = spawn('goose', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.workingDirectory
      });

      this.gooseProcess.stdout.on('data', (data) => {
        this.handleOutput(data.toString());
      });

      this.gooseProcess.stderr.on('data', (data) => {
        console.error('Goose stderr:', data.toString());
        this.emit('error', data.toString());
      });

      this.gooseProcess.on('close', (code) => {
        console.log(`Goose process exited with code ${code}`);
        this.emit('close', code);
      });

      this.gooseProcess.on('error', (error) => {
        console.error('Failed to start Goose:', error);
        reject(error);
      });

      // Wait for Goose to be ready
      setTimeout(() => {
        this.isReady = true;
        this.emit('ready');
        resolve();
      }, 2000);
    });
  }

  async startWithRecipe(recipePath, parameters = {}) {
    this.options.recipePath = recipePath;
    this.options.parameters = parameters;
    
    return this.start();
  }

  async createTempRecipeFile(recipe) {
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempFilePath = path.join(tempDir, `recipe-${Date.now()}.json`);
    await fs.writeFile(tempFilePath, JSON.stringify(recipe, null, 2));
    
    return tempFilePath;
  }

  handleOutput(data) {
    const output = data.toString();
    const timestamp = new Date().toISOString();
    
    // Log EVERYTHING to file for analysis
    this.logToFile('RAW_OUTPUT', output, timestamp);
    
    // Emit all raw output for debugging
    this.emit('rawOutput', output);
    
    // For now, let EVERYTHING through as system messages so we can see patterns
    const lines = output.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip only truly empty lines
      if (!trimmedLine) {
        continue;
      }
      
      // Clean ANSI codes for display but keep the content
      const cleanLine = trimmedLine.replace(/\x1b\[[0-9;]*m/g, '');
      
      if (cleanLine) {
        // Log each line with metadata
        this.logToFile('PARSED_LINE', cleanLine, timestamp);
        
        // Emit everything as system message for now so we can see all patterns
        this.emit('aiMessage', {
          role: 'system',
          content: cleanLine,
          timestamp: timestamp,
          source: 'goose-raw'
        });
      }
    }
  }

  async logToFile(type, content, timestamp) {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const logFile = path.join(__dirname, 'goose-output.log');
      
      const logEntry = `[${timestamp}] ${type}: ${JSON.stringify(content)}\n`;
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      // Don't crash if logging fails
      console.error('Logging error:', error.message);
    }
  }

  isToolUsage(line) {
    // Detect when Goose is using tools
    return line.includes('🔧') || 
           line.includes('Tool:') || 
           line.includes('Running:') ||
           line.includes('Executing:') ||
           line.startsWith('[');
  }

  async sendMessage(message) {
    if (!this.isReady || !this.gooseProcess) {
      throw new Error('Goose session not ready');
    }

    return new Promise((resolve) => {
      // Send the message to Goose
      this.gooseProcess.stdin.write(message + '\n');
      
      // For now, resolve immediately - real responses come through events
      resolve({ sent: true, message });
    });
  }

  async executeCommand(command) {
    if (!this.isReady || !this.gooseProcess) {
      throw new Error('Goose session not ready');
    }

    // Send slash command to Goose
    this.gooseProcess.stdin.write(command + '\n');
  }

  async stop() {
    if (this.gooseProcess) {
      // Send exit command
      this.gooseProcess.stdin.write('/exit\n');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.gooseProcess && !this.gooseProcess.killed) {
          this.gooseProcess.kill('SIGTERM');
        }
      }, 5000);
    }
  }

  async listSessions() {
    return new Promise((resolve, reject) => {
      const listProcess = spawn('goose', ['session', 'list', '--format', 'json'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.workingDirectory
      });

      let output = '';
      listProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      listProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const sessions = JSON.parse(output);
            resolve(sessions);
          } catch (error) {
            resolve([]);
          }
        } else {
          reject(new Error(`Failed to list sessions: ${code}`));
        }
      });
    });
  }

  async resumeSession(sessionName) {
    this.options.sessionName = sessionName;
    
    const args = ['session', '--resume', '--name', sessionName];
    
    if (this.options.debug) {
      args.push('--debug');
    }
    
    console.log(`Resuming Goose session: goose ${args.join(' ')}`);
    
    return this.start();
  }
}

module.exports = GooseCLIWrapper;