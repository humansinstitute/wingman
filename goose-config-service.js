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
    // Standard Goose config locations - check both YAML and JSON
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
      } catch (error) {
        // Continue to next config path
        continue;
      }
    }
    
    // If no config found, return empty config
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
    
    // Handle nested providers object (JSON format)
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
    
    // Handle YAML format with top-level GOOSE_PROVIDER
    const currentProvider = config.GOOSE_PROVIDER;
    const currentModel = config.GOOSE_MODEL;
    
    // Detect available providers based on configuration keys
    const detectedProviders = new Set();
    
    if (currentProvider) {
      detectedProviders.add(currentProvider);
    }
    
    // Check for provider-specific configuration keys
    if (config.OLLAMA_HOST) {
      detectedProviders.add('ollama');
    }
    if (config.ANTHROPIC_API_KEY) {
      detectedProviders.add('anthropic');
    }
    if (config.OPENAI_API_KEY) {
      detectedProviders.add('openai');
    }
    if (config.GROQ_API_KEY) {
      detectedProviders.add('groq');
    }
    
    // Add detected providers to the list
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
      
      // Add current model to the provider's models if not already there and it belongs to this provider
      if (currentModel && providerId === currentProvider && !providerEntry.models.includes(currentModel)) {
        providerEntry.models.unshift(currentModel); // Add to beginning as it's the current model
      }
    }
    
    // For common providers, add some default models if none are specified
    for (const provider of providers) {
      if (provider.models.length === 0) {
        if (provider.id === 'ollama') {
          // Try to get actual Ollama models
          try {
            console.log('Fetching actual Ollama models...');
            const ollamaModels = await this.getOllamaModels();
            console.log('Ollama models fetched:', ollamaModels);
            if (ollamaModels.length > 0) {
              provider.models = ollamaModels;
              console.log('Using actual Ollama models');
            } else {
              provider.models = this.getDefaultModelsForProvider(provider.id);
              console.log('Using default Ollama models (no models found)');
            }
          } catch (error) {
            console.log('Error fetching Ollama models:', error);
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

  async getOllamaModels() {
    try {
      const http = require('http');
      const ollamaHost = this.configCache?.config?.OLLAMA_HOST || 'localhost';
      
      return new Promise((resolve) => {
        const req = http.get(`http://${ollamaHost}:11434/api/tags`, { timeout: 2000 }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const models = parsed.models?.map(model => model.name) || [];
              resolve(models);
            } catch (error) {
              resolve([]);
            }
          });
        });
        
        req.on('error', () => resolve([]));
        req.on('timeout', () => {
          req.destroy();
          resolve([]);
        });
      });
    } catch (error) {
      console.warn('Could not fetch Ollama models:', error.message);
      return [];
    }
  }

  getDefaultModelsForProvider(providerId) {
    // Return common models for each provider
    const defaultModels = {
      'anthropic': [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022', 
        'claude-3-opus-20240229'
      ],
      'openrouter': [
        'anthropic/claude-3.5-sonnet',
        'anthropic/claude-3-opus',
        'openai/gpt-4o',
        'openai/gpt-4o-mini',
        'meta-llama/llama-3.1-405b-instruct'
      ],
      'openai': [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-3.5-turbo'
      ],
      'ollama': [
        'llama3.2',
        'llama3.1',
        'codellama',
        'mistral',
        'phi3'
      ],
      'groq': [
        'llama-3.1-405b-reasoning',
        'llama-3.1-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768'
      ]
    };
    
    return defaultModels[providerId] || [];
  }

  isProviderConfigured(providerConfig) {
    // Check if provider has required configuration
    return !!(providerConfig.api_key || providerConfig.models);
  }

  async startWatching() {
    if (!this.configCache) {
      await this.loadConfiguration();
    }

    const configPath = this.configCache.path;
    
    if (!configPath) {
      console.warn('No config path to watch');
      return;
    }
    
    try {
      // Use fs.watch for file changes
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
      // Debounce rapid changes
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
    
    if (!this.configCache) {
      return { valid: false, error: 'Configuration not loaded' };
    }

    const providerConfig = this.configCache.providers.providers.find(p => p.id === provider);
    if (!providerConfig) {
      return { valid: false, error: `Provider '${provider}' not configured` };
    }

    if (!providerConfig.configured) {
      return { valid: false, error: `Provider '${provider}' not properly configured` };
    }

    if (model && providerConfig.models.length > 0 && !providerConfig.models.includes(model)) {
      return { valid: false, error: `Model '${model}' not available for provider '${provider}'` };
    }

    return { valid: true };
  }

  stopWatching() {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = GooseConfigService;