const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ImprovedGooseCLIWrapper extends EventEmitter {
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
    this.currentThinking = '';
    this.inThinkBlock = false;
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
        cwd: process.cwd(),
        env: { ...process.env }
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
    
    // Log everything for continued analysis
    this.logToFile('RAW_OUTPUT', data, timestamp);
    
    // Clean ANSI escape sequences
    const cleanOutput = this.stripAnsiCodes(data);
    
    // Process line by line
    const lines = cleanOutput.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      this.logToFile('CLEAN_LINE', trimmedLine, timestamp);
      
      // Parse different types of content
      if (this.isSystemMessage(trimmedLine)) {
        this.handleSystemMessage(trimmedLine, timestamp);
      } else if (this.isThinkingStart(trimmedLine)) {
        this.startThinkingBlock(timestamp);
      } else if (this.isThinkingEnd(trimmedLine)) {
        this.endThinkingBlock(timestamp);
      } else if (this.inThinkBlock) {
        this.addToThinking(trimmedLine);
      } else if (this.isAIResponse(trimmedLine)) {
        this.handleAIResponse(trimmedLine, timestamp);
      } else if (this.isToolUsage(trimmedLine)) {
        this.handleToolUsage(trimmedLine, timestamp);
      }
    }
  }

  stripAnsiCodes(text) {
    // Remove ANSI escape sequences
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  isSystemMessage(line) {
    const systemPatterns = [
      /^starting session/,
      /^logging to/,
      /^working directory:/,
      /^Context: ○+/,
      /^Goose is running!/,
      /WARN.*goose::/,
      /^\d{4}-\d{2}-\d{2}T.*WARN/,
      /^at crates\//
    ];
    
    return systemPatterns.some(pattern => pattern.test(line));
  }

  isThinkingStart(line) {
    return line === '<think>';
  }

  isThinkingEnd(line) {
    return line === '</think>';
  }

  isAIResponse(line) {
    // AI responses are any content that's not system messages or thinking
    return line.length > 0 && 
           !this.isSystemMessage(line) && 
           !this.isThinkingStart(line) && 
           !this.isThinkingEnd(line) &&
           !this.isToolUsage(line);
  }

  isToolUsage(line) {
    return line.includes('🔧') || 
           line.includes('Tool:') || 
           line.includes('Running:') ||
           line.includes('Executing:');
  }

  handleSystemMessage(line, timestamp) {
    this.emit('systemMessage', {
      role: 'system',
      content: line,
      timestamp: timestamp,
      source: 'goose-system'
    });
  }

  startThinkingBlock(timestamp) {
    this.inThinkBlock = true;
    this.currentThinking = '';
  }

  addToThinking(line) {
    this.currentThinking += (this.currentThinking ? ' ' : '') + line;
  }

  endThinkingBlock(timestamp) {
    this.inThinkBlock = false;
    
    if (this.currentThinking.trim()) {
      this.emit('thinking', {
        role: 'assistant',
        content: this.currentThinking.trim(),
        timestamp: timestamp,
        source: 'goose-thinking',
        type: 'thinking'
      });
    }
    
    this.currentThinking = '';
  }

  handleAIResponse(line, timestamp) {
    this.emit('aiMessage', {
      role: 'assistant',
      content: line,
      timestamp: timestamp,
      source: 'goose',
      thinking: this.currentThinking.trim() || null
    });
  }

  handleToolUsage(line, timestamp) {
    this.emit('toolUsage', {
      role: 'system',
      content: `🔧 ${line}`,
      timestamp: timestamp,
      source: 'goose-tool'
    });
  }

  async logToFile(type, content, timestamp) {
    try {
      const logFile = path.join(__dirname, 'goose-output-improved.log');
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

module.exports = ImprovedGooseCLIWrapper;