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
      recipeConfig: options.recipeConfig || null,
      recipePath: options.recipePath || null,
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
    return new Promise(async (resolve, reject) => {
      let args;
      let command;
      
      // If we have a recipe, use 'goose run' instead of 'goose session'
      if (this.options.recipeConfig || this.options.recipePath) {
        command = 'run';
        args = [];
        
        let recipePath = this.options.recipePath;
        
        // If we have recipe config but no path, create a temp file
        if (this.options.recipeConfig && !recipePath) {
          recipePath = await this.createTempRecipeFile(this.options.recipeConfig);
        }
        
        if (recipePath) {
          args.push('--recipe', recipePath);
        }
        
        // Add interactive flag to continue in chat mode
        args.push('--interactive');
        
        // Add session name
        args.push('--name', this.options.sessionName);
        
        // Note: We can't use --text with --recipe, so we'll send the prompt after startup
      } else {
        // Regular session without recipe
        command = 'session';
        args = ['--name', this.options.sessionName];
      }
      
      if (this.options.debug) {
        args.push('--debug');
      }
      
      if (this.options.maxTurns) {
        args.push('--max-turns', this.options.maxTurns.toString());
      }
      
      // Only add extensions and builtins if not using a recipe
      // When using recipes, extensions and builtins are defined in the recipe file
      if (!this.options.recipeConfig && !this.options.recipePath) {
        this.options.extensions.forEach(ext => {
          args.push('--with-extension', ext);
        });
        
        this.options.builtins.forEach(builtin => {
          args.push('--with-builtin', builtin);
        });
      }
      
      const workingDir = this.options.workingDirectory || process.cwd();
      console.log(`Starting Goose ${command}: goose ${command} ${args.join(' ')}`);
      console.log(`Working directory: ${workingDir}`);
      
      this.gooseProcess = spawn('goose', [command, ...args], {
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

      let processExited = false;
      
      this.gooseProcess.on('close', (code) => {
        console.log(`Goose process exited with code ${code}`);
        this.isReady = false;
        processExited = true;
        this.emit('close', code);
        
        // If process exits with non-zero code during startup, reject
        if (code !== 0) {
          reject(new Error(`Goose process exited with code ${code}`));
        }
      });

      this.gooseProcess.on('error', (error) => {
        console.error('Failed to start Goose:', error);
        this.isReady = false;
        processExited = true;
        reject(error);
      });

      // Wait for Goose to be ready, but check if process is still alive
      setTimeout(() => {
        if (!processExited && this.gooseProcess && !this.gooseProcess.killed) {
          this.isReady = true;
          this.emit('ready');
          resolve();
        } else if (!processExited) {
          reject(new Error('Goose process terminated before ready'));
        }
        // If processExited is true, we already rejected above
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
    
    // Check if session is ready for input (for both new and resumed sessions)
    if (this.isSessionReady(cleanData)) {
      if (!this.isReady) {
        console.log('🎯 Detected Goose is ready for input!');
        this.isReady = true;
        this.emit('ready');
      }
      
      if (this.isResuming && !this.initialHistoryLoaded) {
        this.initialHistoryLoaded = true;
        this.isResuming = false;
        return;
      }
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
    }
    
    // Check for tool usage indicators (emit immediately as system messages)
    // Process line by line to catch tool indicators mixed with other content
    const lines = cleanData.split('\n');
    let hasToolIndicator = false;
    let nonToolContent = '';
    
    for (const line of lines) {
      if (this.isToolIndicator(line)) {
        // Flush any accumulated non-tool content first
        if (nonToolContent.trim()) {
          this.contentBuffer += nonToolContent;
          this.resetFlushTimer(timestamp);
          nonToolContent = '';
        }
        
        // Flush current buffer
        this.flushBuffer(timestamp);
        
        // Emit tool indicator as system message
        this.emit('streamContent', {
          content: line.trim(),
          timestamp: timestamp,
          source: 'goose-tool-system',
          role: 'system'
        });
        hasToolIndicator = true;
      } else if (line.trim()) {
        nonToolContent += line + '\n';
      }
    }
    
    // If we processed tool indicators, handle any remaining content
    if (hasToolIndicator) {
      if (nonToolContent.trim()) {
        this.contentBuffer += nonToolContent;
        this.resetFlushTimer(timestamp);
      }
      return;
    }
    
    // Check for status messages (emit immediately as system messages)
    if (this.isStatusMessage(cleanData)) {
      this.flushBuffer(timestamp); // Flush any pending content first
      this.emit('streamContent', {
        content: cleanData.trim(),
        timestamp: timestamp,
        source: 'goose-status-system',
        role: 'system'
      });
      return;
    }
    
    // Skip context indicators - they're not part of the actual response
    if (cleanData.includes('Context: ')) {
      // Flush any buffered content when we see context (response end marker)
      this.flushBuffer(timestamp);
      return;
    }
    
    // Add to buffer for continuous streaming (assistant content)
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
      /^How can I help/i,       // Goose greeting
      /^I can be your wingman/i, // Recipe greeting
      /^Hello!/i,               // Generic greeting
      /^\d+>\s*$/,              // Numbered prompt
    ];
    
    const trimmed = data.trim();
    return readyPatterns.some(pattern => pattern.test(trimmed));
  }

  isToolIndicator(data) {
    // Detect tool usage indicators that should be single-line system messages
    const toolPatterns = [
      /^─{3,}.*─{3,}$/,                          // Tool separators like ─── shell | developer ───
      /^─{3,}.*\|.*─{3,}$/,                     // Tool separators with pipe
      /^\[\d{2}:\d{2}:\d{2}\s+\w+\]\s+─{3,}/,   // Timestamped tool indicators
      /^command:\s*/,                           // Command execution indicators  
      /^🔧/,                                    // Tool emoji indicators
      /^Running:/,                              // Running indicators
      /^Executing:/,                            // Execution indicators
      /^filepath:\s*/,                          // File path indicators for tools
      /^dirpath:\s*/,                          // Directory path indicators for tools
    ];
    
    const trimmed = data.trim();
    if (!trimmed) return false;
    
    // Debug logging to see what we're trying to match
    const isMatch = toolPatterns.some(pattern => pattern.test(trimmed));
    if (trimmed.includes('─') || trimmed.includes('obsidian')) {
      console.log(`Tool indicator check: "${trimmed.substring(0, 100)}..." -> ${isMatch}`);
    }
    
    return isMatch;
  }

  isStatusMessage(data) {
    // Detect status messages that should be single-line system messages
    const statusPatterns = [
      /^✅/,                     // Success indicators
      /^⚠️/,                      // Warning indicators
      /^❌/,                     // Error indicators
      /^Switched to session:/,   // Session switch messages
      /^Session started:/,       // Session start messages
      /^Started new session:/,   // New session messages
      /^No upstream or no unpushed commits$/,  // Git status messages
    ];
    
    const trimmed = data.trim();
    return trimmed && statusPatterns.some(pattern => pattern.test(trimmed));
  }

  stripAnsiCodes(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  async logToFile(type, content, timestamp) {
    try {
      const logsDir = path.join(__dirname, 'logs');
      const logFile = path.join(logsDir, 'goose-streaming-output.log');

      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });

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

    // Debug logging to verify message content
    console.log('=== SENDING MESSAGE TO GOOSE ===');
    console.log('Message length:', message.length);
    console.log('Contains newlines:', message.includes('\n'));
    console.log('Newline count:', (message.match(/\n/g) || []).length);
    console.log('Raw message:', JSON.stringify(message));
    console.log('=================================');

    // Flush any pending content before new message
    this.flushBuffer(new Date().toISOString());

    return new Promise((resolve) => {
      // For multi-line messages, convert to single line to prevent line-by-line processing
      if (message.includes('\n')) {
        // Join lines with spaces, collapsing multiple newlines into single spaces
        const singleLineMessage = message.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
        this.gooseProcess.stdin.write(singleLineMessage + '\n');
        console.log('Sent multi-line message as single line:', singleLineMessage.substring(0, 100) + '...');
      } else {
        // Single line message - send normally
        this.gooseProcess.stdin.write(message + '\n');
      }
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
            // Return full session objects with all metadata
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
    
    return new Promise(async (resolve, reject) => {
      // Always resume using 'goose session --resume'
      // The recipe instructions/settings are already baked into the session
      const command = 'session';
      const args = ['--resume', '--name', sessionName];
      
      if (this.options.debug) {
        args.push('--debug');
      }
      
      const workingDir = this.options.workingDirectory || process.cwd();
      console.log(`Resuming Goose ${command}: goose ${command} ${args.join(' ')}`);
      console.log(`Working directory: ${workingDir}`);
      
      this.gooseProcess = spawn('goose', [command, ...args], {
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
        console.error('Failed to resume Goose:', error);
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
  
  async createTempRecipeFile(recipe) {
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempFilePath = path.join(tempDir, `recipe-${Date.now()}.json`);
    await fs.writeFile(tempFilePath, JSON.stringify(recipe, null, 2));
    
    return tempFilePath;
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
    const fs = require('fs').promises;
    const path = require('path');
    const os = require('os');
    
    try {
      // Directly delete the session file from the filesystem (same approach as clearall.js)
      const sessionFile = path.join(os.homedir(), '.local', 'share', 'goose', 'sessions', `${sessionName}.jsonl`);
      
      try {
        await fs.unlink(sessionFile);
        console.log(`Successfully deleted session: ${sessionName}`);
        return { success: true };
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, consider it already deleted
          console.log(`Session file not found (already deleted): ${sessionName}`);
          return { success: true };
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error(`Failed to delete session ${sessionName}:`, error.message);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

}

module.exports = StreamingGooseCLIWrapper;