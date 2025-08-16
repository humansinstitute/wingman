const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class StreamingGooseCLIWrapper extends EventEmitter {
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
    this.contentBuffer = '';
    this.flushTimer = null;
    this.isResuming = false;
    this.initialHistoryLoaded = false;
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
      
      const workingDir = this.options.workingDirectory || process.cwd();
      console.log(`Starting Goose session: goose ${args.join(' ')}`);
      console.log(`Working directory: ${workingDir}`);
      
      this.gooseProcess = spawn('goose', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDir
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
    
    // Log everything for debugging
    this.logToFile('RAW_OUTPUT', data, timestamp);
    
    // Clean ANSI codes for display
    const cleanData = this.stripAnsiCodes(data);
    
    // Skip system startup messages
    if (this.isSystemStartup(cleanData)) {
      return;
    }
    
    // When resuming, check if we're getting conversation history
    if (this.isResuming && !this.initialHistoryLoaded) {
      // Look for patterns that indicate we're getting conversation history
      if (this.isConversationHistory(cleanData)) {
        // Emit as historical content
        this.emit('historyMessage', {
          content: cleanData,
          timestamp: timestamp,
          source: 'goose-history'
        });
        return;
      }
      
      // Mark history as loaded when we see a prompt or ready indicator
      if (this.isSessionReady(cleanData)) {
        this.initialHistoryLoaded = true;
        this.isResuming = false;
        return;
      }
    }
    
    // Skip context indicators - they're not part of the actual response
    if (cleanData.includes('Context: ')) {
      // Flush any buffered content when we see context (response end marker)
      this.flushBuffer(timestamp);
      return;
    }
    
    // Add to buffer for continuous streaming
    this.contentBuffer += cleanData;
    
    // Set/reset flush timer - emit content after brief pause
    this.resetFlushTimer(timestamp);
  }

  resetFlushTimer(timestamp) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    // Emit buffered content after 200ms of no new output
    this.flushTimer = setTimeout(() => {
      this.flushBuffer(timestamp);
    }, 200);
  }

  flushBuffer(timestamp) {
    if (this.contentBuffer.trim()) {
      // Emit as continuous stream content
      this.emit('streamContent', {
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
    // Detect conversation history patterns when resuming
    const historyPatterns = [
      /^You:/,           // User messages
      /^Assistant:/,     // Assistant messages  
      /^User:/,          // Alternative user pattern
      /^\[.*\] You:/,    // Timestamped user messages
      /^\[.*\] Assistant:/, // Timestamped assistant messages
      /^.*: /,           // Generic role-based messages
      // Also check for any substantial content during resumption
      // that doesn't look like system messages
      /^[A-Za-z]/,       // Text starting with letters (likely conversation)
    ];
    
    // Skip if it looks like a system message
    if (this.isSystemStartup(data)) {
      return false;
    }
    
    return data.trim().length > 5 && historyPatterns.some(pattern => pattern.test(data.trim()));
  }

  isSessionReady(data) {
    // Detect when session is ready for new input
    const readyPatterns = [
      /^>$/,                    // Command prompt
      /^Enter your message:/,   // Input prompt
      /ready for input/i,       // Ready indicator
      /What would you like/i,   // Question prompt
    ];
    
    return readyPatterns.some(pattern => pattern.test(data.trim()));
  }

  stripAnsiCodes(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  async logToFile(type, content, timestamp) {
    try {
      const logFile = path.join(__dirname, 'goose-streaming-output.log');
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

    // Flush any pending content before new message
    this.flushBuffer(new Date().toISOString());

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

  async listSessions() {
    return new Promise((resolve, reject) => {
      const listProcess = spawn('goose', ['session', 'list', '--format', 'json'], {
        stdio: ['pipe', 'pipe', 'pipe']
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
    this.isResuming = true;
    this.initialHistoryLoaded = false;
    
    // Try to load conversation history from session file before starting
    await this.loadSessionHistory(sessionName);
    
    const args = ['session', '--resume', '--name', sessionName];
    
    if (this.options.debug) {
      args.push('--debug');
    }
    
    console.log(`Resuming Goose session: goose ${args.join(' ')}`);
    
    return this.start();
  }

  async loadSessionHistory(sessionName) {
    try {
      const os = require('os');
      const sessionPath = path.join(os.homedir(), '.local', 'share', 'goose', 'sessions', `${sessionName}.jsonl`);
      
      console.log(`Loading session history from: ${sessionPath}`);
      
      const fileExists = await fs.access(sessionPath).then(() => true).catch(() => false);
      if (!fileExists) {
        console.log(`Session file not found: ${sessionPath}`);
        return;
      }

      const sessionData = await fs.readFile(sessionPath, 'utf8');
      const lines = sessionData.trim().split('\n').filter(line => line.trim());
      
      console.log(`Found ${lines.length} entries in session file`);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          // Skip session metadata (first line)
          if (entry.working_dir || entry.description) {
            continue;
          }
          
          if (entry.role && entry.content) {
            // Extract text content from the content array
            let textContent = '';
            if (Array.isArray(entry.content)) {
              for (const contentItem of entry.content) {
                if (contentItem.type === 'text' && contentItem.text) {
                  textContent += contentItem.text + '\n';
                }
              }
            } else if (typeof entry.content === 'string') {
              textContent = entry.content;
            }
            
            textContent = textContent.trim();
            
            if (textContent) {
              // Emit each historical message
              this.emit('historyMessage', {
                content: textContent,
                timestamp: entry.created ? new Date(entry.created * 1000).toISOString() : new Date().toISOString(),
                role: entry.role,
                source: 'session-file'
              });
            }
          }
        } catch (parseError) {
          console.log(`Skipped invalid JSON line: ${line.substring(0, 100)}...`);
        }
      }
      
      console.log(`Loaded conversation history with ${lines.length} messages`);
      
    } catch (error) {
      console.error('Error loading session history:', error);
    }
  }

  async deleteSession(sessionName) {
    return new Promise((resolve, reject) => {
      const deleteProcess = spawn('goose', ['session', 'remove', '--name', sessionName], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      deleteProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      deleteProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      deleteProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`Successfully deleted session: ${sessionName}`);
          resolve({ success: true });
        } else {
          console.error(`Failed to delete session ${sessionName}:`, errorOutput);
          reject(new Error(`Failed to delete session: ${errorOutput || 'Unknown error'}`));
        }
      });

      deleteProcess.on('error', (error) => {
        console.error('Error spawning delete process:', error);
        reject(error);
      });
    });
  }
}

module.exports = StreamingGooseCLIWrapper;