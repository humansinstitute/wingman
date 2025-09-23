const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const ephemeralConfig = require('../../runtime/ephemeral-goose-config');
const secretInjector = require('../../secrets/secret-injector');
const failureHandler = require('../../runtime/failure-handler');

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
    this.isProcessing = false;
    this.pendingInterrupt = false;
    this.stderrBuffer = '';
    this.debugEnabled = (process.env.WINGMAN_DEBUG === '1' || process.env.LOG_LEVEL === 'debug' || !!this.options.debug);
  }

  async prepareSessionEnv(recipePath, workingDir) {
    // Resolve provider/model: prefer explicit; else fall back to user's default Goose config
    let provider = this.options.provider;
    let model = this.options.model;
    if (!provider) {
      try {
        const GooseConfigService = require('../shared/config/goose-config-service');
        const gcs = new GooseConfigService();
        const cfg = await gcs.loadConfiguration();
        provider = cfg.providers.defaultProvider || provider;
        model = model || cfg.providers.defaultModel || model;
      } catch (_) { /* ignore */ }
    }
    try { console.log(`[Wrapper] Using provider/model: ${provider || 'default?'} / ${model || 'default?'}`); } catch {}

    const { path: configPath } = await ephemeralConfig.createEphemeralConfig(
      this.options.sessionName,
      { provider, model },
      { allowGlobalServers: false }
    );

    let sessionEnv = {
      ...process.env,
      GOOSE_CONFIG_PATH: configPath,
      WINGMAN_SESSION_ID: this.sessionId,
      WINGMAN_SESSION_NAME: this.sessionName || this.sessionId,
      WINGMAN_WORKING_DIR: workingDir
    };

    if (!recipePath) {
      return { env: sessionEnv, configPath };
    }

    try {
      const recipeData = await fs.readFile(recipePath, 'utf-8');
      const recipe = JSON.parse(recipeData);

      if (recipe.extensions && recipe.extensions.length > 0) {
        await ephemeralConfig.addRecipeServers(configPath, recipe.extensions);
      }

      if (process.env.WINGMAN_ENV_SECRETS !== '0' && process.env.WINGMAN_ENV_SECRETS !== 'false') {
        const secretResult = await secretInjector.buildSessionEnv({
          recipe,
          selectedServers: recipe.extensions
        });

        if (secretResult.success) {
          sessionEnv = { ...sessionEnv, ...secretResult.env };
          this.logSessionStartup(recipe, secretResult.injected);
        } else if (secretResult.missing.length > 0) {
          console.warn(`⚠️ Missing ${secretResult.missing.length} required secrets`);
          console.warn('   Session may have limited functionality');
        }
      }
    } catch (error) {
      console.warn(`Failed to inject secrets: ${error.message}`);
    }

    return { env: sessionEnv, configPath };
  }

  async start() {
    return new Promise(async (resolve, reject) => {
      let args;
      let command;
      
      let recipePath = this.options.recipePath;
      
      if (!recipePath) {
        const recipeConfig = this.options.recipeConfig || (() => {
          const cfg = {
            id: `auto-${Date.now()}`,
            name: this.options.sessionName || `session-${Date.now()}`,
            title: this.options.sessionName || `session-${Date.now()}`,
            description: 'Auto-generated recipe from legacy configuration',
            extensions: this.convertToRecipeExtensions(),
            instructions: this.options.systemPrompt || 'You are Wingman. Assist the developer effectively.'
          };
          if (this.options.provider || this.options.model) {
            cfg.settings = cfg.settings || {};
            if (this.options.provider) cfg.settings.goose_provider = this.options.provider;
            if (this.options.model) cfg.settings.goose_model = this.options.model;
          }
          return cfg;
        })();
        
        recipePath = await this.createTempRecipeFile(recipeConfig);
      }
      
      command = 'run';
      args = ['--recipe', recipePath];
      
      if (this.options.recipeConfig && this.options.recipeConfig.builtins && this.options.recipeConfig.builtins.length > 0) {
        args.push('--with-builtin', this.options.recipeConfig.builtins.join(','));
      }
      
      args.push('--interactive');
      args.push('--name', this.options.sessionName);
      
      if (this.options.debug) {
        args.push('--debug');
      }
      
      if (this.options.maxTurns) {
        args.push('--max-turns', this.options.maxTurns.toString());
      }
      
      const workingDir = this.options.workingDirectory || process.cwd();
      console.log(`Starting Goose ${command}: goose ${command} ${args.join(' ')}`);
      console.log(`Working directory: ${workingDir}`);
      
      const { env: sessionEnv } = await this.prepareSessionEnv(recipePath, workingDir);
      
      this.gooseProcess = spawn('goose', [command, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDir,
        env: sessionEnv
      });

      this.gooseProcess.stdout.on('data', (data) => {
        try { console.log('[Goose stdout]', String(data).slice(0,400)); } catch {}
        this.handleOutput(data.toString());
      });

      this.gooseProcess.stderr.on('data', (data) => {
        const stderrOutput = data.toString();
        console.error('Goose stderr:', stderrOutput);
        
        this.stderrBuffer += stderrOutput;
        
        const friendlyError = this.detectMCPFailures(stderrOutput);
        if (friendlyError) {
          this.emit('mcpFailure', friendlyError);
        }
        
        this.emit('error', stderrOutput);
      });

      let processExited = false;
      
      this.gooseProcess.on('close', (code) => {
        console.log(`Goose process exited with code ${code}`);
        this.isReady = false;
        processExited = true;
        
        if (code !== 0) {
          const failureResult = failureHandler.handleProcessFailure(
            this.options.sessionName,
            code,
            this.stderrBuffer || ''
          );
          
          this.emit('processFailure', failureResult);
          reject(new Error(failureResult.message));
        } else {
          this.emit('close', code);
        }
      });

      this.gooseProcess.on('error', (error) => {
        console.error('Failed to start Goose:', error);
        this.isReady = false;
        processExited = true;
        reject(error);
      });

      setTimeout(() => {
        if (!processExited && this.gooseProcess && !this.gooseProcess.killed) {
          this.isReady = true;
          this.emit('ready');
          resolve();
        } else if (!processExited) {
          reject(new Error('Goose process terminated before ready'));
        }
      }, 2000);
    });
  }

  // -- Helpers ported from legacy wrapper (minimal versions) --
  logSessionStartup(recipe, injected) {
    try {
      const extCount = Array.isArray(recipe?.extensions) ? recipe.extensions.length : 0;
      const injectedKeys = (injected || []).map(i => `${i.key}(${i.server})`);
      console.log(`🔧 Session startup with ${extCount} extension(s)`);
      if (injectedKeys.length > 0) {
        console.log(`   Injected keys: ${injectedKeys.join(', ')}`);
      }
    } catch (_) {}
  }

  detectMCPFailures(stderrText) {
    const text = String(stderrText || '');
    if (!text) return null;
    const patterns = [
      { pattern: /Failed to access keyring|secure storage/i, type: 'keyring_access_error', suggestion: 'Unlock your macOS Keychain and run `goose configure`.' },
      { pattern: /ENOENT.*spawn|command not found/i, type: 'command_not_found', suggestion: 'Ensure the MCP server binary is installed and on PATH.' },
      { pattern: /EACCES|Permission denied/i, type: 'permission_denied', suggestion: 'Check execute permissions for the MCP server.' },
      { pattern: /timeout/i, type: 'server_timeout', suggestion: 'Increase timeout or check server startup logs.' },
      { pattern: /ECONNREFUSED/i, type: 'connection_refused', suggestion: 'Ensure the target server is running and reachable.' }
    ];
    for (const p of patterns) {
      if (p.pattern.test(text)) {
        return { type: p.type, message: text.trim(), suggestion: p.suggestion, rawError: text.trim() };
      }
    }
    return null;
  }

  handleOutput(data) {
    const cleanData = this.stripAnsiCodes(data);
    
    if (this.isSystemStartup(cleanData)) return;
    
    if (this.isSessionReady(cleanData)) {
      if (!this.isReady) {
        if (this.debugEnabled) console.log('🎯 Detected Goose is ready for input!');
        this.isReady = true;
        this.emit('ready');
      }
      if (this.isProcessing) {
        this.isProcessing = false;
      }
    }

    this.emit('streamContent', {
      content: cleanData,
      timestamp: new Date().toISOString(),
      source: 'goose'
    });
  }

  stripAnsiCodes(text) {
    return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  }

  isSystemStartup(text) {
    return text.includes('Welcome to Goose') || text.includes('Loading recipe');
  }

  isSessionReady(text) {
    return /\n>\s*$/.test(text) || /awaiting input/i.test(text);
  }

  async sendMessage(message) {
    if (!this.gooseProcess || !this.isReady) {
      throw new Error('Goose is not ready for input');
    }
    this.isProcessing = true;
    try { console.log('[Wrapper] Writing to Goose stdin'); } catch {}
    this.gooseProcess.stdin.write(message + '\n');
    return { success: true };
  }

  async interrupt() {
    if (this.gooseProcess) {
      this.gooseProcess.stdin.write('/interrupt\n');
    }
  }

  async forceStop() {
    if (this.debugEnabled) console.log('🔥 Force stopping Goose session');
    if (this.gooseProcess) {
      this.isProcessing = false;
      this.pendingInterrupt = false;
      try { this.gooseProcess.stdin.write('/exit\n'); } catch {}
      this.gooseProcess.kill('SIGTERM');
      this.emit('forceStopped', { timestamp: new Date().toISOString() });
    }
  }

  async stop() {
    if (this.gooseProcess) {
      try { this.gooseProcess.stdin.write('/exit\n'); } catch {}
      setTimeout(() => {
        if (this.gooseProcess && !this.gooseProcess.killed) {
          this.gooseProcess.kill('SIGTERM');
        }
      }, 5000);
    }
    await ephemeralConfig.cleanupSession(this.options.sessionName);
    failureHandler.resetSession(this.options.sessionName);
  }

  async resumeSession(sessionName) {
    this.options.sessionName = sessionName;
    this.isResuming = true;
    this.initialHistoryLoaded = false;
    return this.start();
  }

  convertToRecipeExtensions() {
    const extensions = [];
    (this.options.extensions || []).forEach(ext => {
      if (typeof ext === 'string') {
        extensions.push({ type: 'stdio', name: ext, cmd: ext, args: [] });
      } else if (ext && typeof ext === 'object') {
        const { name, type, ...rest } = ext;
        extensions.push({ type: type || 'stdio', name, ...rest });
      }
    });
    (this.options.builtins || []).forEach(builtin => {
      if (typeof builtin === 'string') {
        extensions.push({ type: 'builtin', name: builtin });
      } else if (builtin && typeof builtin === 'object') {
        const { name, type, isBuiltin, ...rest } = builtin;
        extensions.push({ type: type || (isBuiltin ? 'builtin' : 'builtin'), name, ...rest });
      }
    });
    return extensions;
  }

  async createTempRecipeFile(recipe) {
    const os = require('os');
    const WingmanConfig = require('../../lib/wingman-config');
    const wingHome = process.env.WINGMAN_HOME || os.homedir() + '/.wingman';
    const tempDir = path.join(wingHome, 'tmp', 'recipes');
    await fs.mkdir(tempDir, { recursive: true });
    
    if (recipe.sub_recipes && recipe.sub_recipes.length > 0) {
      if (this.debugEnabled) console.log(`Processing ${recipe.sub_recipes.length} sub-recipes for temp file creation`);
      const recipeBaseDirs = [
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'user'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'built-in'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.wingman', 'recipes', 'imported')
      ];
      for (const subRecipe of recipe.sub_recipes) {
        if (this.debugEnabled) console.log(`Looking for sub-recipe: ${subRecipe.name} at path: ${subRecipe.path}`);
        let sourceFile = null;
        for (const baseDir of recipeBaseDirs) {
          const possiblePath = path.join(baseDir, subRecipe.path);
          try { await fs.access(possiblePath); sourceFile = possiblePath; break; } catch {}
        }
        if (sourceFile) {
          const destFile = path.join(tempDir, subRecipe.path);
          await fs.copyFile(sourceFile, destFile);
          if (this.debugEnabled) console.log(`✅ Copied sub-recipe from ${sourceFile} to ${destFile}`);
        } else {
          console.warn(`❌ Sub-recipe file not found: ${subRecipe.path}`);
        }
      }
    }
    const tempFilePath = path.join(tempDir, `recipe-${Date.now()}.json`);
    await fs.writeFile(tempFilePath, JSON.stringify(recipe, null, 2));
    if (this.debugEnabled) {
      console.log(`Temporary recipe written to: ${tempFilePath}`);
    }
    return tempFilePath;
  }
}

module.exports = StreamingGooseCLIWrapper;
