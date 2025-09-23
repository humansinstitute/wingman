const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const GooseConfigService = require('../shared/config/goose-config-service');
const WingmanConfig = require('../../lib/wingman-config');
const CompatibilityAdapter = require('../../lib/compatibility-adapter');

class RecipeManager extends EventEmitter {
  constructor() {
    super();
    
    // Initialize Wingman configuration system
    this.wingmanConfig = null;
    this.compatibilityAdapter = null;
    this.recipesDir = null; // Will be set by wingman config
    this.metadataFile = null;
    this.categoriesFile = null;
    this.cache = new Map();
    this.metadata = {};
    this.categories = [];
    this.isLegacyMode = false;
    
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
      this.mcpServerRegistry = require('../mcp/registry');
    }
    return this.mcpServerRegistry;
  }

  async initializeStorage() {
    try {
      // Initialize Wingman configuration system
      this.wingmanConfig = await WingmanConfig.create();
      
      // Initialize compatibility adapter
      this.compatibilityAdapter = new CompatibilityAdapter(this.wingmanConfig);
      await this.compatibilityAdapter.init();
      
      // Get paths from compatibility adapter
      this.isLegacyMode = this.compatibilityAdapter.isLegacyMode;
      this.recipesDir = await this.compatibilityAdapter.getRecipesPath();
      
      // Set up paths based on current mode
      this.metadataFile = path.join(this.recipesDir, 'metadata.json');
      this.categoriesFile = path.join(this.recipesDir, 'categories.json');

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

      // Load metadata using compatibility adapter
      this.metadata = await this.compatibilityAdapter.loadMetadata();
      
      // Ensure metadata is saved to current location
      await this.compatibilityAdapter.saveMetadata(this.metadata);

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

      // Log current configuration status
      console.log(`Recipe Manager initialized in ${this.isLegacyMode ? 'legacy' : 'centralized'} mode`);
      console.log(`Recipes directory: ${this.recipesDir}`);
      
      // Show migration warning if needed
      this.compatibilityAdapter.showMigrationWarning();
      
    } catch (error) {
      console.error('Error initializing recipe storage:', error);
    }
  }

  async saveMetadata() {
    try {
      if (this.compatibilityAdapter) {
        await this.compatibilityAdapter.saveMetadata(this.metadata);
      } else {
        await fs.writeFile(this.metadataFile, JSON.stringify(this.metadata, null, 2));
      }
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
      sub_recipes: recipeData.sub_recipes || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      isPublic: recipeData.isPublic || false
    };

    // Validate recipe structure
    await this.validateRecipe(recipe);
    
    // Validate sub-recipe existence and structure
    await this.validateSubRecipeExistence(recipe);

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

    return true;
  }

  async importFromUrl(url) {
    // Network access is restricted in this environment; placeholder to keep API
    throw new Error('Import from URL is not available in this environment');
  }

  async exportRecipe(id) {
    // Placeholder for future export implementation
    return `recipe://${id}`;
  }

  async loadRecipeFromDisk(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      
      // Support both JSON and YAML formats
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        try {
          const yaml = require('js-yaml');
          return yaml.load(data);
        } catch (yamlError) {
          console.log(`Skipping YAML file (js-yaml not available): ${filePath}`);
          return null;
        }
      }
      
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading recipe from ${filePath}:`, error);
      return null;
    }
  }

  async saveRecipeToDisk(filePath, recipe) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(recipe, null, 2));
  }

  // Validation, parameters, sub-recipe helpers (unchanged logic)
  async validateRecipe(recipeData) {
    const errors = [];

    // Basic required fields
    if (!recipeData.name && !recipeData.title) {
      errors.push('Recipe name/title is required');
    }

    // Validate parameters (structure only)
    if (recipeData.parameters && !Array.isArray(recipeData.parameters)) {
      errors.push('Parameters must be an array');
    }

    // Validate sub-recipes
    if (recipeData.sub_recipes && Array.isArray(recipeData.sub_recipes)) {
      for (const subRecipe of recipeData.sub_recipes) {
        if (!subRecipe.name) {
          errors.push('Sub-recipe name is required');
        }
        if (!subRecipe.path) {
          errors.push('Sub-recipe path is required');
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(subRecipe.name)) {
          errors.push(`Sub-recipe name '${subRecipe.name}' must be a valid tool name (letters, numbers, underscores only, cannot start with number)`);
        }
        if (subRecipe.values && typeof subRecipe.values !== 'object') {
          errors.push(`Sub-recipe ${subRecipe.name} values must be an object`);
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
          console.warn('Could not validate provider/model:', error.message);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Recipe validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  async validateParameters(recipe, providedParams = {}) {
    if (!recipe.parameters || recipe.parameters.length === 0) return true;
    // Basic presence validation only; types/regex can be added later
    for (const param of recipe.parameters) {
      const key = param.key || param.name;
      if (param.required && (providedParams[key] === undefined || providedParams[key] === '')) {
        throw new Error(`Missing required parameter: ${key}`);
      }
    }
    return true;
  }

  async validateSubRecipeExistence(recipeData) {
    if (!recipeData.sub_recipes || !Array.isArray(recipeData.sub_recipes)) {
      return true; // No sub-recipes to validate
    }

    const errors = [];
    
    for (const subRecipe of recipeData.sub_recipes) {
      try {
        const resolvedPath = await this.resolveSubRecipePath(subRecipe.path);
        const subRecipeData = await this.loadRecipeFromPath(resolvedPath);
        
        if (!subRecipeData) {
          errors.push(`Sub-recipe not found at path: ${subRecipe.path}`);
          continue;
        }

        if (subRecipeData.sub_recipes && subRecipeData.sub_recipes.length > 0) {
          errors.push(`Sub-recipe '${subRecipe.name}' cannot have its own sub-recipes (nesting not allowed)`);
        }

        if (subRecipe.values && subRecipeData.parameters) {
          for (const paramKey in subRecipe.values) {
            const paramDef = subRecipeData.parameters.find(p => p.key === paramKey);
            if (!paramDef) {
              errors.push(`Sub-recipe '${subRecipe.name}' defines value for undefined parameter '${paramKey}'`);
            }
          }
        }
      } catch (error) {
        errors.push(`Error validating sub-recipe '${subRecipe.name}': ${error.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Sub-recipe validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  async resolveSubRecipePath(subRecipePath) {
    if (!subRecipePath) {
      throw new Error('Sub-recipe path cannot be null or undefined');
    }
    
    if (!subRecipePath.includes('/') && !path.isAbsolute(subRecipePath)) {
      const dirs = ['user', 'built-in', 'imported'];
      
      for (const dir of dirs) {
        const dirPath = path.join(this.recipesDir, dir, subRecipePath);
        if (await this.fileExists(dirPath)) {
          return dirPath;
        }
      }
    }
    
    if (!path.isAbsolute(subRecipePath)) {
      const userRelativePath = path.join(this.recipesDir, 'user', subRecipePath);
      if (await this.fileExists(userRelativePath)) {
        return userRelativePath;
      }
      
      const recipesRelativePath = path.join(this.recipesDir, subRecipePath);
      if (await this.fileExists(recipesRelativePath)) {
        return recipesRelativePath;
      }
      
      const cwdRelativePath = path.resolve(process.cwd(), subRecipePath);
      if (await this.fileExists(cwdRelativePath)) {
        return cwdRelativePath;
      }
    }
    
    return subRecipePath;
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async loadRecipeFromPath(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        try {
          const yaml = require('js-yaml');
          return yaml.load(data);
        } catch (yamlError) {
          throw new Error(`Failed to parse YAML: ${yamlError.message}`);
        }
      }
      
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading recipe from ${filePath}:`, error);
      return null;
    }
  }

  async getSubRecipes(recipeId) {
    const recipe = await this.getRecipe(recipeId);
    if (!recipe || !recipe.sub_recipes) {
      return [];
    }

    const subRecipeDetails = [];
    
    for (const subRecipe of recipe.sub_recipes) {
      try {
        const resolvedPath = await this.resolveSubRecipePath(subRecipe.path);
        const subRecipeData = await this.loadRecipeFromPath(resolvedPath);
        
        if (subRecipeData) {
          subRecipeDetails.push({
            name: subRecipe.name,
            path: subRecipe.path,
            resolvedPath,
            values: subRecipe.values || {},
            recipe: subRecipeData
          });
        }
      } catch (error) {
        console.error(`Error loading sub-recipe ${subRecipe.name}:`, error);
      }
    }
    
    return subRecipeDetails;
  }

  // Template Processing
  async processTemplate(recipe, parameters = {}) {
    if (!recipe.parameters || recipe.parameters.length === 0) {
      return recipe;
    }

    const processedRecipe = JSON.parse(JSON.stringify(recipe));

    for (const param of recipe.parameters) {
      const paramKey = param.key || param.name;
      const value = parameters[paramKey] || param.default || '';
      const placeholder = `{{${paramKey}}}`;
      
      if (processedRecipe.instructions) {
        processedRecipe.instructions = processedRecipe.instructions.replace(new RegExp(placeholder, 'g'), value);
      }
      
      if (processedRecipe.prompt) {
        processedRecipe.prompt = processedRecipe.prompt.replace(new RegExp(placeholder, 'g'), value);
      }
      
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

  // Convert simple string extensions to proper extension objects
  normalizeExtensions(extensions) {
    if (!extensions || !Array.isArray(extensions)) {
      return [];
    }
    
    return extensions.map(ext => {
      if (typeof ext === 'string') {
        return {
          type: 'stdio',
          name: ext,
          cmd: ext,
          args: []
        };
      } else {
        return ext;
      }
    });
  }

  // Usage tracking and stats (minimal)
  async trackMCPServerUsage(recipeId, extensions, action) {
    try {
      const registry = this.getMCPServerRegistry();
      for (const extension of extensions || []) {
        try {
          const servers = await registry.getAllServers();
          const existingServer = servers.find(server => 
            server.name === extension.name && server.cmd === extension.cmd
          );
          if (!existingServer && action === 'add') {
            const serverConfig = registry.extensionToServerConfig(extension, {
              description: `Auto-registered from recipe ${recipeId}`
            });
            await registry.registerServer(serverConfig);
          }
        } catch (e) {
          console.log(`Could not auto-register server ${extension.name}:`, e.message);
        }
      }
    } catch (error) {
      console.warn('Error tracking MCP server usage:', error.message);
    }
  }

  clearCache() {
    this.cache.clear();
    console.log('Recipe cache cleared');
  }
}

module.exports = new RecipeManager();

