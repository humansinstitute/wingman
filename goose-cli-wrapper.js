const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const ephemeralConfig = require('./runtime/ephemeral-goose-config');
const secretInjector = require('./secrets/secret-injector');
const preflightEngine = require('./preflight/preflight-engine');

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
      provider: options.provider || null,
      model: options.model || null,
      ...options
    };
    
    this.gooseProcess = null;
    this.isReady = false;
    this.buffer = '';
    this.currentConversation = [];
  }

  async start() {
    return new Promise(async (resolve, reject) => {
      let args;
      let command;
      
      // ENFORCEMENT: Always use recipes-only execution (T-001)
      // If no recipe is provided, create a minimal recipe from extensions/builtins
      let recipePath = this.options.recipePath;
      
      if (!recipePath) {
        // Convert legacy extensions/builtins to a recipe config
        const recipeConfig = this.options.recipeConfig || {
          name: this.options.sessionName || `session-${Date.now()}`,
          title: this.options.sessionName || `session-${Date.now()}`,
          description: 'Auto-generated recipe from legacy configuration',
          extensions: this.convertToRecipeExtensions(),
          system_prompt: this.options.systemPrompt || ''
        };
        
        recipePath = await this.createTempRecipeFile(recipeConfig);
      }
      
      // Always use 'goose run' with recipe
      command = 'run';
      args = ['--recipe', recipePath];
      
      // Add provider/model flags if specified
      if (this.options.provider) {
        args.push('--provider', this.options.provider);
      }
      
      if (this.options.model) {
        args.push('--model', this.options.model);
      }
      
      // Add parameters if provided
      if (this.options.parameters && Object.keys(this.options.parameters).length > 0) {
        for (const [key, value] of Object.entries(this.options.parameters)) {
          args.push('--params', `${key}=${value}`);
        }
      }
      
      // Add interactive flag to continue in chat mode
      args.push('--interactive');
      
      // Add session name
      args.push('--name', this.options.sessionName);
      
      if (this.options.debug) {
        args.push('--debug');
      }
      
      if (this.options.maxTurns) {
        args.push('--max-turns', this.options.maxTurns.toString());
      }
      
      console.log(`Starting Goose ${command}: goose ${command} ${args.join(' ')}`);
      
      // T-003: Create ephemeral config and set GOOSE_CONFIG_PATH
      const { path: configPath } = await ephemeralConfig.createEphemeralConfig(
        this.options.sessionName,
        {
          provider: this.options.provider,
          model: this.options.model
        }
      );
      
      // Build environment with ephemeral config and injected secrets
      let sessionEnv = {
        ...process.env,
        GOOSE_CONFIG_PATH: configPath, // Zero-default enforcement
        WINGMAN_SESSION_ID: this.options.sessionName
      };
      
      // Inject required secrets for the recipe
      if (recipePath) {
        try {
          const recipeData = await fs.readFile(recipePath, 'utf-8');
          const recipe = JSON.parse(recipeData);
          
          // Add recipe-declared servers to the hybrid config
          if (recipe.extensions && recipe.extensions.length > 0) {
            await ephemeralConfig.addRecipeServers(configPath, recipe.extensions);
          }
          
          const secretResult = await secretInjector.buildSessionEnv({
            recipe: recipe,
            selectedServers: recipe.extensions
          });
          
          if (secretResult.success) {
            sessionEnv = secretResult.env;
            
            // T-016: Log active extensions and injected env key names (no values)
            this.logSessionStartup(recipe, secretResult.injected);
          } else if (secretResult.missing.length > 0) {
            console.warn(`⚠️ Missing ${secretResult.missing.length} required secrets`);
            console.warn('   Session may have limited functionality');
          }
        } catch (error) {
          console.warn(`Failed to inject secrets: ${error.message}`);
        }
      }
      
      this.gooseProcess = spawn('goose', [command, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.workingDirectory,
        env: sessionEnv
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

  async startWithRecipe(recipePath, parameters = {}) {
    this.options.recipePath = recipePath;
    this.options.parameters = parameters;
    
    return this.start();
  }

  convertToRecipeExtensions() {
    // Convert legacy extensions/builtins arrays to recipe format
    const extensions = [];
    
    // Convert extensions (assuming they're just names for now)
    this.options.extensions.forEach(ext => {
      if (typeof ext === 'string') {
        // Legacy format: just the extension name
        extensions.push({ name: ext });
      } else {
        // Already in object format
        extensions.push(ext);
      }
    });
    
    // Convert builtins (same approach)
    this.options.builtins.forEach(builtin => {
      if (typeof builtin === 'string') {
        extensions.push({ name: builtin, isBuiltin: true });
      } else {
        extensions.push(builtin);
      }
    });
    
    return extensions;
  }

  async createTempRecipeFile(recipe) {
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Handle sub-recipes - copy them to temp directory or use absolute paths
    if (recipe.sub_recipes && recipe.sub_recipes.length > 0) {
      console.log(`Processing ${recipe.sub_recipes.length} sub-recipes for temp file creation`);
      
      const recipeBaseDirs = [
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'user'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'built-in'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'imported')
      ];
      
      // Copy sub-recipe files to temp directory
      for (const subRecipe of recipe.sub_recipes) {
        console.log(`Looking for sub-recipe: ${subRecipe.name} at path: ${subRecipe.path}`);
        let sourceFile = null;
        
        // Find the sub-recipe file in recipe directories
        for (const baseDir of recipeBaseDirs) {
          const possiblePath = path.join(baseDir, subRecipe.path);
          console.log(`Checking: ${possiblePath}`);
          try {
            await fs.access(possiblePath);
            sourceFile = possiblePath;
            console.log(`Found sub-recipe at: ${sourceFile}`);
            break;
          } catch (err) {
            console.log(`Not found at: ${possiblePath}`);
          }
        }
        
        if (sourceFile) {
          const destFile = path.join(tempDir, subRecipe.path);
          await fs.copyFile(sourceFile, destFile);
          console.log(`✅ Copied sub-recipe from ${sourceFile} to ${destFile}`);
        } else {
          console.warn(`❌ Sub-recipe file not found: ${subRecipe.path}`);
        }
      }
    }
    
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
      const logsDir = path.join(__dirname, 'logs');
      const logFile = path.join(logsDir, 'goose-output.log');

      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });
      
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
    
    // Clean up ephemeral config
    await ephemeralConfig.cleanupSession(this.options.sessionName);
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
    
    return new Promise(async (resolve, reject) => {
      // Always resume using 'goose session --resume'
      // The recipe instructions/settings are already baked into the session
      const command = 'session';
      const args = ['--resume', '--name', sessionName];
      
      if (this.options.debug) {
        args.push('--debug');
      }
      
      console.log(`Resuming Goose ${command}: goose ${command} ${args.join(' ')}`);
      
      this.gooseProcess = spawn('goose', [command, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.workingDirectory || process.cwd()
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

  // New method to update provider/model for existing session
  updateProviderModel(provider, model) {
    this.options.provider = provider;
    this.options.model = model;
  }

  /**
   * Log session startup details (T-016)
   * @private
   */
  logSessionStartup(recipe, injectedSecrets) {
    const timestamp = new Date().toISOString();
    
    console.log(`\n[${timestamp}] [RUNTIME] Session Starting`);
    console.log(`  Recipe: ${recipe.name} (${recipe.id})`);
    console.log(`  Session: ${this.options.sessionName}`);
    
    // Log active extensions
    const extensions = recipe.extensions || [];
    console.log(`  Active Extensions: ${extensions.length}`);
    extensions.forEach((ext, index) => {
      const name = ext.name || ext;
      console.log(`    ${index + 1}. ${name}`);
    });
    
    // Log injected environment key names (NEVER log values)
    if (injectedSecrets && injectedSecrets.length > 0) {
      console.log(`  Injected Environment Keys: ${injectedSecrets.length}`);
      injectedSecrets.forEach(secret => {
        console.log(`    - ${secret.key} (for ${secret.server})`);
      });
    }
    
    console.log(`  Working Directory: ${this.options.workingDirectory || process.cwd()}`);
    console.log(`  Zero-Default Config: Enforced\n`);
  }

  // New method to get current provider/model
  getProviderModel() {
    return {
      provider: this.options.provider,
      model: this.options.model
    };
  }
}

module.exports = GooseCLIWrapper;