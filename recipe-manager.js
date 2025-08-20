const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const GooseConfigService = require('./goose-config-service');

class RecipeManager extends EventEmitter {
  constructor() {
    super();
    this.recipesDir = path.join(__dirname, 'recipes');
    this.metadataFile = path.join(this.recipesDir, 'metadata.json');
    this.categoriesFile = path.join(this.recipesDir, 'categories.json');
    this.cache = new Map();
    this.metadata = {};
    this.categories = [];
    
    // Initialize Goose config service
    this.gooseConfig = new GooseConfigService();
    this.setupGooseConfigEvents();
    
    // Initialize MCP Server Registry (lazy loading to avoid circular dependency)
    this.mcpServerRegistry = null;
    
    this.initializeStorage();
  }

  setupGooseConfigEvents() {
    this.gooseConfig.on('configChanged', (config) => {
      this.emit('providersUpdated', config.providers);
    });

    this.gooseConfig.on('configError', (error) => {
      console.error('Goose config error:', error);
    });
  }

  getMCPServerRegistry() {
    if (!this.mcpServerRegistry) {
      this.mcpServerRegistry = require('./mcp-server-registry');
    }
    return this.mcpServerRegistry;
  }

  async initializeStorage() {
    try {
      // Create recipes directory structure
      await fs.mkdir(this.recipesDir, { recursive: true });
      await fs.mkdir(path.join(this.recipesDir, 'built-in'), { recursive: true });
      await fs.mkdir(path.join(this.recipesDir, 'user'), { recursive: true });
      await fs.mkdir(path.join(this.recipesDir, 'imported'), { recursive: true });

      // Start watching Goose configuration
      try {
        await this.gooseConfig.startWatching();
      } catch (error) {
        console.warn('Could not initialize Goose config service:', error.message);
      }

      // Load or create metadata
      try {
        const metadataData = await fs.readFile(this.metadataFile, 'utf8');
        this.metadata = JSON.parse(metadataData);
      } catch (error) {
        this.metadata = {
          recipes: {},
          usage: {},
          lastUpdated: new Date().toISOString()
        };
        await this.saveMetadata();
      }

      // Load or create categories
      try {
        const categoriesData = await fs.readFile(this.categoriesFile, 'utf8');
        this.categories = JSON.parse(categoriesData);
      } catch (error) {
        this.categories = [
          { id: 'development', name: 'Development', icon: '💻' },
          { id: 'debugging', name: 'Debugging', icon: '🐛' },
          { id: 'testing', name: 'Testing', icon: '🧪' },
          { id: 'documentation', name: 'Documentation', icon: '📝' },
          { id: 'refactoring', name: 'Refactoring', icon: '🔧' },
          { id: 'review', name: 'Code Review', icon: '👀' },
          { id: 'deployment', name: 'Deployment', icon: '🚀' },
          { id: 'custom', name: 'Custom', icon: '⚙️' }
        ];
        await this.saveCategories();
      }
    } catch (error) {
      console.error('Error initializing recipe storage:', error);
    }
  }

  async saveMetadata() {
    try {
      await fs.writeFile(this.metadataFile, JSON.stringify(this.metadata, null, 2));
    } catch (error) {
      console.error('Error saving metadata:', error);
    }
  }

  async saveCategories() {
    try {
      await fs.writeFile(this.categoriesFile, JSON.stringify(this.categories, null, 2));
    } catch (error) {
      console.error('Error saving categories:', error);
    }
  }

  // Core CRUD Operations
  async getAllRecipes(options = {}) {
    const { category, search, limit, sortBy = 'popular' } = options;
    let recipes = [];

    // Load all recipes from disk
    const dirs = ['built-in', 'user', 'imported'];
    for (const dir of dirs) {
      const dirPath = path.join(this.recipesDir, dir);
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
            const filePath = path.join(dirPath, file);
            const recipe = await this.loadRecipeFromDisk(filePath);
            if (recipe) {
              recipe.source = dir;
              recipes.push(recipe);
            }
          }
        }
      } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
      }
    }

    // Apply filters
    if (category && category !== 'all') {
      recipes = recipes.filter(r => r.category === category);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      recipes = recipes.filter(r => 
        r.name.toLowerCase().includes(searchLower) ||
        r.description?.toLowerCase().includes(searchLower) ||
        r.tags?.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    // Sort recipes
    switch (sortBy) {
      case 'popular':
        recipes.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        break;
      case 'recent':
        recipes.sort((a, b) => new Date(b.lastUsed || 0) - new Date(a.lastUsed || 0));
        break;
      case 'name':
        recipes.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    // Apply limit
    if (limit) {
      recipes = recipes.slice(0, limit);
    }

    return recipes;
  }

  async getRecipe(id) {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    // Search for recipe file
    const recipe = await this.findRecipeById(id);
    if (recipe) {
      this.cache.set(id, recipe);
    }
    return recipe;
  }

  async findRecipeById(id) {
    const dirs = ['built-in', 'user', 'imported'];
    for (const dir of dirs) {
      const dirPath = path.join(this.recipesDir, dir);
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
            const filePath = path.join(dirPath, file);
            const recipe = await this.loadRecipeFromDisk(filePath);
            if (recipe && recipe.id === id) {
              recipe.source = dir;
              return recipe;
            }
          }
        }
      } catch (error) {
        console.error(`Error searching directory ${dir}:`, error);
      }
    }
    return null;
  }

  async createRecipe(recipeData) {
    const recipe = {
      id: recipeData.id || crypto.randomBytes(16).toString('hex'),
      version: recipeData.version || '1.0.0',
      title: recipeData.title || recipeData.name || 'Untitled Recipe',
      name: recipeData.name || 'Untitled Recipe',
      description: recipeData.description || '',
      category: recipeData.category || 'custom',
      tags: recipeData.tags || [],
      author: recipeData.author || { name: 'Unknown', email: 'unknown@example.com' },
      instructions: recipeData.instructions,
      prompt: recipeData.prompt,
      extensions: this.normalizeExtensions(recipeData.extensions || []),
      builtins: recipeData.builtins || [],
      settings: recipeData.settings || {},
      parameters: recipeData.parameters || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      isPublic: recipeData.isPublic || false
    };

    // Validate recipe
    await this.validateRecipe(recipe);

    // Save to disk
    const filePath = path.join(this.recipesDir, 'user', `${recipe.id}.json`);
    await this.saveRecipeToDisk(filePath, recipe);

    // Update metadata
    this.metadata.recipes[recipe.id] = {
      name: recipe.name,
      path: filePath,
      createdAt: recipe.createdAt
    };
    await this.saveMetadata();

    // Track MCP server usage in registry
    await this.trackMCPServerUsage(recipe.id, recipe.extensions, 'add');

    // Clear cache
    this.cache.delete(recipe.id);

    return recipe;
  }

  async updateRecipe(id, updates) {
    const existingRecipe = await this.getRecipe(id);
    if (!existingRecipe) {
      throw new Error(`Recipe ${id} not found`);
    }

    const updatedRecipe = {
      ...existingRecipe,
      ...updates,
      id: existingRecipe.id, // Prevent ID change
      updatedAt: new Date().toISOString()
    };

    // Validate updated recipe
    await this.validateRecipe(updatedRecipe);

    // Determine file path
    const source = existingRecipe.source || 'user';
    const filePath = path.join(this.recipesDir, source, `${id}.json`);
    await this.saveRecipeToDisk(filePath, updatedRecipe);

    // Update metadata
    this.metadata.recipes[id] = {
      ...this.metadata.recipes[id],
      name: updatedRecipe.name,
      updatedAt: updatedRecipe.updatedAt
    };
    await this.saveMetadata();

    // Update MCP server usage tracking
    await this.trackMCPServerUsage(id, existingRecipe.extensions, 'remove');
    await this.trackMCPServerUsage(id, updatedRecipe.extensions, 'add');

    // Clear cache
    this.cache.delete(id);

    return updatedRecipe;
  }

  async deleteRecipe(id) {
    const recipe = await this.getRecipe(id);
    if (!recipe) {
      throw new Error(`Recipe ${id} not found`);
    }

    // Don't allow deletion of built-in recipes
    if (recipe.source === 'built-in') {
      throw new Error('Cannot delete built-in recipes');
    }

    // Delete file
    const source = recipe.source || 'user';
    const filePath = path.join(this.recipesDir, source, `${id}.json`);
    await fs.unlink(filePath);

    // Update metadata
    delete this.metadata.recipes[id];
    delete this.metadata.usage[id];
    await this.saveMetadata();

    // Remove MCP server usage tracking
    await this.trackMCPServerUsage(id, recipe.extensions, 'remove');

    // Clear cache
    this.cache.delete(id);

    return { success: true };
  }

  // Import/Export
  async importFromUrl(url) {
    try {
      // For now, we'll implement a simple fetch-based import
      // In production, this should validate the URL domain and content
      const https = require('https');
      const http = require('http');
      
      return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        protocol.get(url, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', async () => {
            try {
              const recipe = JSON.parse(data);
              recipe.id = recipe.id || crypto.randomBytes(16).toString('hex');
              recipe.sourceUrl = url;
              
              // Validate and save
              await this.validateRecipe(recipe);
              
              const filePath = path.join(this.recipesDir, 'imported', `${recipe.id}.json`);
              await this.saveRecipeToDisk(filePath, recipe);
              
              resolve(recipe);
            } catch (error) {
              reject(error);
            }
          });
        }).on('error', reject);
      });
    } catch (error) {
      throw new Error(`Failed to import recipe from URL: ${error.message}`);
    }
  }

  async exportRecipe(id) {
    const recipe = await this.getRecipe(id);
    if (!recipe) {
      throw new Error(`Recipe ${id} not found`);
    }

    // In a real implementation, this would upload to a CDN or generate a sharing URL
    // For now, we'll return a data URL
    const recipeJson = JSON.stringify(recipe, null, 2);
    const shareUrl = `data:application/json;base64,${Buffer.from(recipeJson).toString('base64')}`;
    
    return shareUrl;
  }

  async validateRecipe(recipeData) {
    const errors = [];

    // Required fields
    if (!recipeData.title) {
      errors.push('Recipe title is required');
    }

    if (!recipeData.name) {
      errors.push('Recipe name is required');
    }

    if (!recipeData.id) {
      errors.push('Recipe ID is required');
    }

    // Validate parameters
    if (recipeData.parameters && Array.isArray(recipeData.parameters)) {
      for (const param of recipeData.parameters) {
        if (!param.name) {
          errors.push('Parameter name is required');
        }
        if (!['string', 'number', 'boolean', 'select'].includes(param.type)) {
          errors.push(`Invalid parameter type: ${param.type}`);
        }
        if (param.type === 'select' && (!param.options || !Array.isArray(param.options))) {
          errors.push(`Select parameter ${param.name} must have options`);
        }
      }
    }

    // Validate extensions (basic check)
    if (recipeData.extensions && !Array.isArray(recipeData.extensions)) {
      errors.push('Extensions must be an array');
    }

    if (recipeData.builtins && !Array.isArray(recipeData.builtins)) {
      errors.push('Builtins must be an array');
    }

    // Validate provider/model if specified
    if (recipeData.settings) {
      const { goose_provider, goose_model } = recipeData.settings;
      
      if (goose_provider || goose_model) {
        try {
          const validation = this.gooseConfig.validateProviderModel(goose_provider, goose_model);
          if (!validation.valid) {
            errors.push(`Provider/Model validation failed: ${validation.error}`);
          }
        } catch (error) {
          // Log warning but don't fail validation if config service unavailable
          console.warn('Could not validate provider/model:', error.message);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Recipe validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  // Template Processing
  async processTemplate(recipe, parameters = {}) {
    if (!recipe.parameters || recipe.parameters.length === 0) {
      return recipe;
    }

    // Deep clone the recipe
    const processedRecipe = JSON.parse(JSON.stringify(recipe));

    // Process each parameter
    for (const param of recipe.parameters) {
      const value = parameters[param.name] || param.default || '';
      
      // Replace in all string fields
      const placeholder = `{{${param.name}}}`;
      
      if (processedRecipe.instructions) {
        processedRecipe.instructions = processedRecipe.instructions.replace(new RegExp(placeholder, 'g'), value);
      }
      
      if (processedRecipe.prompt) {
        processedRecipe.prompt = processedRecipe.prompt.replace(new RegExp(placeholder, 'g'), value);
      }
      
      // Process nested settings
      if (processedRecipe.settings) {
        processedRecipe.settings = this.replaceInObject(processedRecipe.settings, placeholder, value);
      }
    }

    return processedRecipe;
  }

  replaceInObject(obj, placeholder, value) {
    if (typeof obj === 'string') {
      return obj.replace(new RegExp(placeholder, 'g'), value);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceInObject(item, placeholder, value));
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const key in obj) {
        result[key] = this.replaceInObject(obj[key], placeholder, value);
      }
      return result;
    }
    
    return obj;
  }

  async validateParameters(recipe, providedParams) {
    const errors = [];

    if (!recipe.parameters || recipe.parameters.length === 0) {
      return true;
    }

    for (const param of recipe.parameters) {
      const value = providedParams[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null || value === '')) {
        errors.push(`Parameter ${param.name} is required`);
        continue;
      }

      // Skip validation for optional empty parameters
      if (!param.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type validation
      switch (param.type) {
        case 'number':
          if (isNaN(value)) {
            errors.push(`Parameter ${param.name} must be a number`);
          } else {
            const numValue = Number(value);
            if (param.validation) {
              if (param.validation.min !== undefined && numValue < param.validation.min) {
                errors.push(`Parameter ${param.name} must be at least ${param.validation.min}`);
              }
              if (param.validation.max !== undefined && numValue > param.validation.max) {
                errors.push(`Parameter ${param.name} must be at most ${param.validation.max}`);
              }
            }
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
            errors.push(`Parameter ${param.name} must be a boolean`);
          }
          break;

        case 'select':
          if (!param.options.includes(value)) {
            errors.push(`Parameter ${param.name} must be one of: ${param.options.join(', ')}`);
          }
          break;

        case 'string':
          if (param.validation && param.validation.pattern) {
            const regex = new RegExp(param.validation.pattern);
            if (!regex.test(value)) {
              errors.push(`Parameter ${param.name} does not match required pattern`);
            }
          }
          break;
      }
    }

    if (errors.length > 0) {
      throw new Error(`Parameter validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  // Storage Management
  async saveRecipeToDisk(filePath, recipe) {
    try {
      await fs.writeFile(filePath, JSON.stringify(recipe, null, 2));
    } catch (error) {
      throw new Error(`Failed to save recipe: ${error.message}`);
    }
  }

  async loadRecipeFromDisk(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      
      // Support both JSON and YAML formats
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        // For YAML support, we would need to add js-yaml package
        // For now, we'll skip YAML files
        console.log(`Skipping YAML file: ${filePath}`);
        return null;
      }
      
      const recipe = JSON.parse(data);
      
      // Normalize extensions to proper format
      if (recipe.extensions) {
        recipe.extensions = this.normalizeExtensions(recipe.extensions);
      }
      
      // Add usage stats from metadata
      if (this.metadata.usage && this.metadata.usage[recipe.id]) {
        recipe.usageCount = this.metadata.usage[recipe.id].count || 0;
        recipe.lastUsed = this.metadata.usage[recipe.id].lastUsed;
      }
      
      return recipe;
    } catch (error) {
      console.error(`Error loading recipe from ${filePath}:`, error);
      return null;
    }
  }

  async updateMetadata(recipe) {
    this.metadata.recipes[recipe.id] = {
      name: recipe.name,
      category: recipe.category,
      updatedAt: recipe.updatedAt
    };
    
    this.metadata.lastUpdated = new Date().toISOString();
    await this.saveMetadata();
  }

  // Search & Discovery
  async searchRecipes(query) {
    const allRecipes = await this.getAllRecipes();
    const queryLower = query.toLowerCase();
    
    return allRecipes.filter(recipe => 
      recipe.name.toLowerCase().includes(queryLower) ||
      recipe.description?.toLowerCase().includes(queryLower) ||
      recipe.tags?.some(tag => tag.toLowerCase().includes(queryLower)) ||
      recipe.category?.toLowerCase().includes(queryLower)
    );
  }

  async getRecipesByCategory(category) {
    return this.getAllRecipes({ category });
  }

  async getPopularRecipes(limit = 10) {
    return this.getAllRecipes({ sortBy: 'popular', limit });
  }

  // Usage Tracking
  async trackUsage(recipeId, sessionId) {
    if (!this.metadata.usage) {
      this.metadata.usage = {};
    }

    if (!this.metadata.usage[recipeId]) {
      this.metadata.usage[recipeId] = {
        count: 0,
        sessions: [],
        firstUsed: new Date().toISOString()
      };
    }

    this.metadata.usage[recipeId].count++;
    this.metadata.usage[recipeId].lastUsed = new Date().toISOString();
    this.metadata.usage[recipeId].sessions.push({
      sessionId,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 sessions
    if (this.metadata.usage[recipeId].sessions.length > 100) {
      this.metadata.usage[recipeId].sessions = 
        this.metadata.usage[recipeId].sessions.slice(-100);
    }

    await this.saveMetadata();
  }

  async getUsageStats(recipeId) {
    if (!this.metadata.usage || !this.metadata.usage[recipeId]) {
      return {
        count: 0,
        sessions: [],
        firstUsed: null,
        lastUsed: null
      };
    }

    return this.metadata.usage[recipeId];
  }

  // Get all categories
  async getCategories() {
    return this.categories;
  }

  // Convert simple string extensions to proper extension objects
  normalizeExtensions(extensions) {
    if (!extensions || !Array.isArray(extensions)) {
      return [];
    }
    
    return extensions.map(ext => {
      if (typeof ext === 'string') {
        // Convert simple string to proper extension format
        return {
          type: 'stdio',
          name: ext,
          cmd: ext,
          args: []
        };
      } else {
        // Already in proper format
        return ext;
      }
    });
  }

  // Clear cache to force reload from disk
  clearCache() {
    this.cache.clear();
    console.log('Recipe cache cleared');
  }

  // New method to get available providers
  async getAvailableProviders() {
    try {
      // Ensure configuration is loaded
      if (!this.gooseConfig.configCache) {
        await this.gooseConfig.loadConfiguration();
      }
      return this.gooseConfig.getProviders();
    } catch (error) {
      return {
        providers: [],
        configValid: false,
        error: error.message
      };
    }
  }

  // New method to validate provider/model combination
  async validateProviderModel(provider, model) {
    try {
      return this.gooseConfig.validateProviderModel(provider, model);
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Get Goose configuration status
  async getConfigStatus() {
    const providers = this.gooseConfig.getProviders();
    return {
      configFound: providers.configValid,
      configValid: providers.configValid,
      providersCount: providers.providers ? providers.providers.length : 0,
      defaultsSet: !!(providers.defaultProvider && providers.defaultModel),
      providers: providers.providers || []
    };
  }

  // Track MCP server usage in registry
  async trackMCPServerUsage(recipeId, extensions, action) {
    if (!extensions || !Array.isArray(extensions)) {
      return;
    }

    try {
      const registry = this.getMCPServerRegistry();
      
      for (const extension of extensions) {
        if (!extension.name) continue;
        
        // Try to find existing server in registry by name and command
        const servers = await registry.getAllServers();
        const existingServer = servers.find(server => 
          server.name === extension.name && 
          server.cmd === extension.cmd
        );
        
        if (existingServer) {
          // Track usage for existing server
          await registry.trackServerUsage(existingServer.id, recipeId, action);
        } else if (action === 'add') {
          // Auto-register new server when adding to recipe
          try {
            const serverConfig = registry.extensionToServerConfig(extension, {
              description: `Auto-imported from recipe usage`,
              category: 'auto-imported',
              tags: [extension.name, 'auto-imported']
            });
            
            const newServer = await registry.registerServer(serverConfig);
            await registry.trackServerUsage(newServer.id, recipeId, action);
          } catch (error) {
            // Ignore registration errors (e.g., duplicates)
            console.log(`Could not auto-register server ${extension.name}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn('Error tracking MCP server usage:', error.message);
    }
  }

  // Resolve extensions using registry (for enhanced server info)
  async resolveExtensionsFromRegistry(extensions) {
    if (!extensions || !Array.isArray(extensions)) {
      return extensions;
    }

    try {
      const registry = this.getMCPServerRegistry();
      const servers = await registry.getAllServers();
      
      return extensions.map(extension => {
        // Find corresponding server in registry
        const server = servers.find(s => 
          s.name === extension.name && 
          s.cmd === extension.cmd
        );
        
        if (server) {
          // Return enhanced extension with server info
          return {
            ...extension,
            serverId: server.id,
            description: server.description,
            tags: server.tags,
            category: server.category,
            version: server.version
          };
        }
        
        return extension;
      });
    } catch (error) {
      console.warn('Error resolving extensions from registry:', error.message);
      return extensions;
    }
  }
}

module.exports = new RecipeManager();