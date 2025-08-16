const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ClaudeGooseCLIWrapper extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      sessionName: options.sessionName || `web-session-${Date.now()}`,
      debug: options.debug || false,
      maxTurns: options.maxTurns || 1000,
      extensions: options.extensions || [],
      builtins: options.builtins || [],
      ...options
    };
    
    this.gooseProcess = null;
    this.isReady = false;
    this.buffer = '';
    this.currentResponse = '';
    this.inStepByStep = false;
    this.stepByStepContent = '';
    this.responseTimer = null;
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
      
      this.options.extensions.forEach(ext => {
        args.push('--with-extension', ext);
      });
      
      this.options.builtins.forEach(builtin => {
        args.push('--with-builtin', builtin);
      });
      
      console.log(`Starting Goose session: goose ${args.join(' ')}`);
      
      this.gooseProcess = spawn('goose', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
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

      setTimeout(() => {
        this.isReady = true;
        this.emit('ready');
        resolve();
      }, 2000);
    });
  }

  handleOutput(data) {
    const timestamp = new Date().toISOString();
    
    // Log everything for analysis
    this.logToFile('RAW_OUTPUT', data, timestamp);
    
    // Clean ANSI escape sequences
    const cleanOutput = this.stripAnsiCodes(data);
    
    // Add to buffer for multi-line handling
    this.buffer += cleanOutput;
    
    // Process when we have a complete response (ends with newline or Context:)
    if (this.buffer.includes('\n')) {
      const lines = this.buffer.split('\n');
      
      // Keep last incomplete line in buffer
      this.buffer = lines.pop() || '';
      
      for (const line of lines) {
        this.processLine(line.trim(), timestamp);
      }
    }
  }

  processLine(line, timestamp) {
    if (!line) return;
    
    this.logToFile('PROCESSED_LINE', line, timestamp);
    
    // Skip system messages
    if (this.isSystemMessage(line)) {
      // Context: indicates end of response, emit what we have
      if (line.includes('Context:')) {
        this.flushCurrentResponse(timestamp);
      } else {
        this.handleSystemMessage(line, timestamp);
      }
      return;
    }
    
    // Detect tool usage patterns
    if (this.isToolUsage(line)) {
      this.flushCurrentResponse(timestamp);
      this.handleToolUsage(line, timestamp);
      return;
    }
    
    // Detect step-by-step reasoning patterns
    if (this.isStepByStepStart(line)) {
      this.flushCurrentResponse(timestamp);
      this.startStepByStep(line, timestamp);
      return;
    }
    
    // Collect step-by-step content
    if (this.inStepByStep) {
      if (this.isStepByStepEnd(line)) {
        this.endStepByStep(line, timestamp);
      } else {
        this.addToStepByStep(line);
      }
      return;
    }
    
    // Accumulate regular AI response content
    if (line.length > 0) {
      this.currentResponse += (this.currentResponse ? '\n' : '') + line;
      
      // Set timer to auto-flush response after inactivity
      this.resetResponseTimer(timestamp);
    }
  }

  flushCurrentResponse(timestamp) {
    if (this.currentResponse.trim()) {
      this.emitResponse(timestamp);
    }
  }

  resetResponseTimer(timestamp) {
    // Clear existing timer
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
    }
    
    // Set new timer to flush after 500ms of inactivity
    this.responseTimer = setTimeout(() => {
      this.flushCurrentResponse(timestamp);
    }, 500);
  }

  isToolUsage(line) {
    return line.includes('🔧') || 
           line.includes('Tool:') || 
           line.includes('Running:') ||
           line.includes('Executing:') ||
           line.includes('Using tool:') ||
           line.includes('File operation:') ||
           /^(Created|Updated|Deleted|Read|Writing to|Searching in)/.test(line);
  }

  handleToolUsage(line, timestamp) {
    this.emit('toolUsage', {
      role: 'system',
      content: `🔧 ${line}`,
      timestamp: timestamp,
      source: 'goose-tool'
    });
  }

  isSystemMessage(line) {
    const systemPatterns = [
      /^starting session/,
      /^logging to/,
      /^working directory:/,
      /^Context: [○●]+/,
      /^Goose is running!/,
      /WARN.*goose::/,
      /^\d{4}-\d{2}-\d{2}T.*WARN/,
      /^at crates\//
    ];
    
    return systemPatterns.some(pattern => pattern.test(line));
  }

  isStepByStepStart(line) {
    // Detect Claude's step-by-step patterns
    return /^#{1,3}\s*(Step|Solving|Breaking|Let's|I'll|Analysis|Reasoning)/i.test(line) ||
           /step.by.step|think.*through|break.*down/i.test(line);
  }

  isStepByStepEnd(line) {
    // End on conclusion markers
    return /^#{1,3}\s*(Answer|Conclusion|Result|Summary|Therefore)/i.test(line) ||
           /^(\*\*|__).*=.*(\*\*|__)$/.test(line); // Bold answer patterns
  }


  startStepByStep(line, timestamp) {
    this.inStepByStep = true;
    this.stepByStepContent = line;
  }

  addToStepByStep(line) {
    this.stepByStepContent += '\n' + line;
  }

  endStepByStep(line, timestamp) {
    this.inStepByStep = false;
    this.stepByStepContent += '\n' + line;
    
    // Emit as thinking/reasoning
    this.emit('thinking', {
      role: 'assistant',
      content: this.stepByStepContent,
      timestamp: timestamp,
      source: 'goose-reasoning',
      type: 'thinking'
    });
    
    this.stepByStepContent = '';
  }

  emitResponse(timestamp) {
    if (this.currentResponse.trim()) {
      // Clear any pending timer
      if (this.responseTimer) {
        clearTimeout(this.responseTimer);
        this.responseTimer = null;
      }
      
      this.emit('aiMessage', {
        role: 'assistant',
        content: this.currentResponse.trim(),
        timestamp: timestamp,
        source: 'goose',
        thinking: this.stepByStepContent || null
      });
      
      this.currentResponse = '';
    }
  }

  handleSystemMessage(line, timestamp) {
    this.emit('systemMessage', {
      role: 'system',
      content: line,
      timestamp: timestamp,
      source: 'goose-system'
    });
  }

  stripAnsiCodes(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  async logToFile(type, content, timestamp) {
    try {
      const logFile = path.join(__dirname, 'goose-claude-output.log');
      const logEntry = `[${timestamp}] ${type}: ${JSON.stringify(content)}\n`;
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      console.error('Logging error:', error.message);
    }
  }

  async sendMessage(message) {
    if (!this.isReady || !this.gooseProcess) {
      throw new Error('Goose session not ready');
    }

    // Flush any pending response before new message
    if (this.currentResponse.trim()) {
      this.emitResponse(new Date().toISOString());
    }

    return new Promise((resolve) => {
      this.gooseProcess.stdin.write(message + '\n');
      resolve({ sent: true, message });
    });
  }

  async executeCommand(command) {
    if (!this.isReady || !this.gooseProcess) {
      throw new Error('Goose session not ready');
    }

    this.gooseProcess.stdin.write(command + '\n');
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

module.exports = ClaudeGooseCLIWrapper;