// Bridge module: GooseConfigService during restructure
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const yaml = require('js-yaml');

class GooseConfigService extends EventEmitter {
  constructor() {
    super();
    this.configCache = null;
    this.lastModified = null;
    this.watchers = new Map();
    this.configPaths = this.getConfigPaths();
  }

  getConfigPaths() {
    return [
      path.join(os.homedir(), '.config', 'goose', 'config.yaml'),
      path.join(os.homedir(), '.config', 'goose', 'config.json'),
      path.join(os.homedir(), '.goose', 'config.yaml'),
      path.join(os.homedir(), '.goose', 'config.json'),
      path.join(process.cwd(), '.goose', 'config.yaml'),
      path.join(process.cwd(), '.goose', 'config.json'),
      process.env.GOOSE_CONFIG_PATH
    ].filter(Boolean);
  }

  async loadConfiguration() {
    for (const configPath of this.configPaths) {
      try {
        const stats = await fs.stat(configPath);
        const content = await fs.readFile(configPath, 'utf8');
        
        let config;
        if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
          config = yaml.load(content);
        } else {
          config = JSON.parse(content);
        }
        
        this.configCache = {
          path: configPath,
          lastModified: stats.mtime,
          config: config,
          providers: await this.parseProviders(config)
        };
        
        this.emit('configLoaded', this.configCache);
        return this.configCache;
      } catch (_) {
        continue;
      }
    }
    
    console.warn('No valid Goose configuration found, using empty config');
    this.configCache = {
      path: null,
      lastModified: null,
      config: {},
      providers: {
        providers: [],
        defaultProvider: null,
        defaultModel: null,
        configValid: false
      }
    };
    
    return this.configCache;
  }

  async parseProviders(config) {
    const providers = [];
    if (config.providers) {
      for (const [providerId, providerConfig] of Object.entries(config.providers)) {
        providers.push({
          id: providerId,
          name: this.getProviderDisplayName(providerId),
          configured: this.isProviderConfigured(providerConfig),
          models: providerConfig.models || [],
          default: config.default_provider === providerId
        });
      }
    }
    const currentProvider = config.GOOSE_PROVIDER;
    const currentModel = config.GOOSE_MODEL;
    const detectedProviders = new Set();
    if (currentProvider) detectedProviders.add(currentProvider);
    if (config.OLLAMA_HOST) detectedProviders.add('ollama');
    if (config.ANTHROPIC_API_KEY) detectedProviders.add('anthropic');
    if (config.OPENAI_API_KEY) detectedProviders.add('openai');
    if (config.GROQ_API_KEY) detectedProviders.add('groq');
    for (const providerId of detectedProviders) {
      let providerEntry = providers.find(p => p.id === providerId);
      if (!providerEntry) {
        providerEntry = {
          id: providerId,
          name: this.getProviderDisplayName(providerId),
          configured: true,
          models: this.getDefaultModelsForProvider(providerId),
          default: providerId === currentProvider
        };
        providers.push(providerEntry);
      } else {
        providerEntry.default = providerId === currentProvider;
      }
      if (currentModel && providerId === currentProvider && !providerEntry.models.includes(currentModel)) {
        providerEntry.models.unshift(currentModel);
      }
    }
    for (const provider of providers) {
      if (provider.models.length === 0) {
        if (provider.id === 'ollama') {
          try {
            const http = require('http');
            const ollamaHost = this.configCache?.config?.OLLAMA_HOST || 'localhost';
            const models = await new Promise((resolve) => {
              const req = http.get(`http://${ollamaHost}:11434/api/tags`, { timeout: 2000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                  try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.models?.map(m => m.name) || []);
                  } catch {
                    resolve([]);
                  }
                });
              });
              req.on('error', () => resolve([]));
              req.on('timeout', () => { req.destroy(); resolve([]); });
            });
            provider.models = models.length > 0 ? models : this.getDefaultModelsForProvider(provider.id);
          } catch {
            provider.models = this.getDefaultModelsForProvider(provider.id);
          }
        } else {
          provider.models = this.getDefaultModelsForProvider(provider.id);
        }
      }
    }
    return {
      providers,
      defaultProvider: config.default_provider || config.GOOSE_PROVIDER || null,
      defaultModel: config.default_model || config.GOOSE_MODEL || null,
      configValid: providers.length > 0
    };
  }

  getProviderDisplayName(providerId) {
    const displayNames = {
      'anthropic': 'Anthropic',
      'openrouter': 'OpenRouter',
      'openai': 'OpenAI',
      'azure': 'Azure OpenAI',
      'groq': 'Groq',
      'cohere': 'Cohere',
      'google': 'Google AI',
      'ollama': 'Ollama'
    };
    return displayNames[providerId] || providerId;
  }

  getDefaultModelsForProvider(providerId) {
    const defaults = {
      'anthropic': ['claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022','claude-3-opus-20240229'],
      'openrouter': ['anthropic/claude-3.5-sonnet','anthropic/claude-3-opus','openai/gpt-4o','openai/gpt-4o-mini','meta-llama/llama-3.1-405b-instruct'],
      'openai': ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'],
      'ollama': ['llama3.2','llama3.1','codellama','mistral','phi3'],
      'groq': ['llama-3.1-405b-reasoning','llama-3.1-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768']
    };
    return defaults[providerId] || [];
  }

  isProviderConfigured(providerConfig) {
    return !!(providerConfig.api_key || providerConfig.models);
  }

  async startWatching() {
    if (!this.configCache) {
      await this.loadConfiguration();
    }
    const configPath = this.configCache.path;
    if (!configPath) return;
    try {
      const { watch } = require('fs');
      const watcher = watch(configPath, (eventType) => {
        if (eventType === 'change') {
          this.handleConfigChange();
        }
      });
      this.watchers.set(configPath, watcher);
    } catch (error) {
      console.warn('Could not watch config file:', error.message);
    }
  }

  async handleConfigChange() {
    try {
      clearTimeout(this.changeTimeout);
      this.changeTimeout = setTimeout(async () => {
        const newConfig = await this.loadConfiguration();
        this.emit('configChanged', newConfig);
      }, 500);
    } catch (error) {
      this.emit('configError', error);
    }
  }

  getProviders() {
    return this.configCache ? this.configCache.providers : { 
      providers: [], 
      configValid: false,
      defaultProvider: null,
      defaultModel: null
    };
  }

  validateProviderModel(provider, model) {
    if (!provider) {
      return { valid: true, warnings: ['Using Goose default provider'] };
    }
    if (!this.configCache) return { valid: false, error: 'Configuration not loaded' };
    const providerConfig = this.configCache.providers.providers.find(p => p.id === provider);
    if (!providerConfig) return { valid: false, error: `Provider '${provider}' not configured` };
    if (!providerConfig.configured) return { valid: false, error: `Provider '${provider}' not properly configured` };
    if (model && providerConfig.models.length > 0 && !providerConfig.models.includes(model)) {
      return { valid: false, error: `Model '${model}' not available for provider '${provider}'` };
    }
    return { valid: true };
  }

  stopWatching() {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = GooseConfigService;
