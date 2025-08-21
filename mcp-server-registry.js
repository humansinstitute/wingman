const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class MCPServerRegistry extends EventEmitter {
  constructor() {
    super();
    this.registryDir = path.join(__dirname, 'recipes');
    this.registryFile = path.join(this.registryDir, 'mcp-servers.json');
    this.cache = new Map();
    this.servers = {};
    
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      // Ensure registry directory exists
      await fs.mkdir(this.registryDir, { recursive: true });

      // Load or create server registry
      try {
        const registryData = await fs.readFile(this.registryFile, 'utf8');
        this.servers = JSON.parse(registryData);
      } catch (error) {
        // Create initial registry with some common servers
        this.servers = {
          servers: {},
          metadata: {
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          }
        };
        await this.saveRegistry();
      }
    } catch (error) {
      console.error('Error initializing MCP server registry:', error);
    }
  }

  async saveRegistry() {
    try {
      this.servers.metadata.lastUpdated = new Date().toISOString();
      await fs.writeFile(this.registryFile, JSON.stringify(this.servers, null, 2));
      this.emit('registryUpdated', this.servers);
    } catch (error) {
      console.error('Error saving MCP server registry:', error);
      throw new Error(`Failed to save registry: ${error.message}`);
    }
  }

  // Get all registered servers
  async getAllServers(options = {}) {
    const { includeUsage = false, sortBy = 'name' } = options;
    
    if (!this.servers || !this.servers.servers) {
      return [];
    }
    
    const serverList = Object.entries(this.servers.servers).map(([id, server]) => ({
      id,
      ...server,
      ...(includeUsage && { 
        usageCount: server.usedByRecipes ? server.usedByRecipes.length : 0 
      })
    }));

    // Sort servers
    serverList.sort((a, b) => {
      switch (sortBy) {
        case 'usage':
          return (b.usageCount || 0) - (a.usageCount || 0);
        case 'recent':
          return new Date(b.lastUsed || 0) - new Date(a.lastUsed || 0);
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return serverList;
  }

  // Get a specific server by ID
  async getServer(serverId) {
    if (this.cache.has(serverId)) {
      return this.cache.get(serverId);
    }

    const server = this.servers.servers[serverId];
    if (server) {
      this.cache.set(serverId, server);
    }
    return server;
  }

  // Register a new MCP server
  async registerServer(serverConfig) {
    const serverId = serverConfig.id || this.generateServerId(serverConfig.name);
    
    const server = {
      id: serverId,
      name: serverConfig.name,
      description: serverConfig.description || '',
      type: serverConfig.type || 'stdio',
      cmd: serverConfig.cmd,
      args: serverConfig.args || [],
      timeout: serverConfig.timeout || 300,
      env_keys: serverConfig.env_keys || [],
      tags: serverConfig.tags || [],
      category: serverConfig.category || 'custom',
      author: serverConfig.author || { name: 'Unknown', email: 'unknown@example.com' },
      version: serverConfig.version || '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usedByRecipes: [],
      isPublic: serverConfig.isPublic || false,
      isBuiltIn: serverConfig.isBuiltIn || false
    };

    // Validate server configuration
    await this.validateServer(server);

    // Check for duplicates
    const duplicate = await this.findDuplicateServer(server);
    if (duplicate) {
      throw new Error(`Similar server already exists: ${duplicate.name} (${duplicate.id})`);
    }

    this.servers.servers[serverId] = server;
    await this.saveRegistry();

    // Clear cache
    this.cache.delete(serverId);

    this.emit('serverRegistered', server);
    return server;
  }

  // Update an existing server
  async updateServer(serverId, updates) {
    const existingServer = this.servers.servers[serverId];
    if (!existingServer) {
      throw new Error(`Server ${serverId} not found`);
    }

    const updatedServer = {
      ...existingServer,
      ...updates,
      id: serverId, // Prevent ID change
      updatedAt: new Date().toISOString()
    };

    // Validate updated server
    await this.validateServer(updatedServer);

    this.servers.servers[serverId] = updatedServer;
    await this.saveRegistry();

    // Clear cache
    this.cache.delete(serverId);

    this.emit('serverUpdated', updatedServer);
    return updatedServer;
  }

  // Remove a server from registry
  async unregisterServer(serverId) {
    const server = this.servers.servers[serverId];
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Check if server is in use
    if (server.usedByRecipes && server.usedByRecipes.length > 0) {
      throw new Error(`Cannot remove server ${serverId}: still used by ${server.usedByRecipes.length} recipe(s)`);
    }

    // Don't allow removal of built-in servers
    if (server.isBuiltIn) {
      throw new Error('Cannot remove built-in servers');
    }

    delete this.servers.servers[serverId];
    await this.saveRegistry();

    // Clear cache
    this.cache.delete(serverId);

    this.emit('serverUnregistered', { id: serverId, server });
    return { success: true };
  }

  // Find similar servers to avoid duplicates
  async findDuplicateServer(serverConfig) {
    if (!this.servers || !this.servers.servers) {
      return null;
    }
    
    for (const [id, server] of Object.entries(this.servers.servers)) {
      // Check for same name and command combination
      if (server.name === serverConfig.name && 
          server.cmd === serverConfig.cmd &&
          JSON.stringify(server.args) === JSON.stringify(serverConfig.args)) {
        return { ...server, id };
      }
    }
    return null;
  }

  // Track server usage by recipes
  async trackServerUsage(serverId, recipeId, action = 'add') {
    const server = this.servers.servers[serverId];
    if (!server) {
      console.warn(`Server ${serverId} not found in registry`);
      return;
    }

    if (!server.usedByRecipes) {
      server.usedByRecipes = [];
    }

    if (action === 'add') {
      if (!server.usedByRecipes.includes(recipeId)) {
        server.usedByRecipes.push(recipeId);
        server.lastUsed = new Date().toISOString();
      }
    } else if (action === 'remove') {
      server.usedByRecipes = server.usedByRecipes.filter(id => id !== recipeId);
    }

    await this.saveRegistry();
  }

  // Get servers used by a specific recipe
  async getServersForRecipe(recipeId) {
    return Object.entries(this.servers.servers)
      .filter(([id, server]) => server.usedByRecipes && server.usedByRecipes.includes(recipeId))
      .map(([id, server]) => ({ id, ...server }));
  }

  // Search servers
  async searchServers(query) {
    const queryLower = query.toLowerCase();
    return Object.entries(this.servers.servers)
      .filter(([id, server]) => 
        server.name.toLowerCase().includes(queryLower) ||
        server.description.toLowerCase().includes(queryLower) ||
        server.tags.some(tag => tag.toLowerCase().includes(queryLower)) ||
        server.cmd.toLowerCase().includes(queryLower)
      )
      .map(([id, server]) => ({ id, ...server }));
  }

  // Convert extension config to server config for registry
  extensionToServerConfig(extension, metadata = {}) {
    return {
      name: extension.name,
      description: metadata.description || `MCP server for ${extension.name}`,
      type: extension.type || 'stdio',
      cmd: extension.cmd,
      args: extension.args || [],
      timeout: extension.timeout || 300,
      env_keys: extension.env_keys || [],
      tags: metadata.tags || [extension.name],
      category: metadata.category || 'imported',
      author: metadata.author || { name: 'System', email: 'system@wingman.com' },
      version: '1.0.0',
      isBuiltIn: false
    };
  }

  // Convert server config to extension format for recipes
  serverToExtension(server) {
    return {
      type: server.type,
      name: server.name,
      cmd: server.cmd,
      args: server.args,
      timeout: server.timeout,
      env_keys: server.env_keys
    };
  }

  // Validate server configuration
  async validateServer(server) {
    const errors = [];

    // Required fields
    if (!server.name) {
      errors.push('Server name is required');
    }

    if (!server.cmd) {
      errors.push('Server command is required');
    }

    if (!server.type || !['stdio'].includes(server.type)) {
      errors.push('Server type must be "stdio"');
    }

    // Validate args array
    if (server.args && !Array.isArray(server.args)) {
      errors.push('Server args must be an array');
    }

    // Validate env_keys array
    if (server.env_keys && !Array.isArray(server.env_keys)) {
      errors.push('Server env_keys must be an array');
    }

    // Validate timeout
    if (server.timeout && (typeof server.timeout !== 'number' || server.timeout < 1)) {
      errors.push('Server timeout must be a positive number');
    }

    if (errors.length > 0) {
      throw new Error(`Server validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  // Generate unique server ID
  generateServerId(serverName) {
    const base = serverName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const hash = crypto.createHash('md5').update(`${serverName}-${Date.now()}`).digest('hex');
    return `${base}-${hash.substring(0, 8)}`;
  }

  // Get registry statistics
  async getStats() {
    const serverCount = Object.keys(this.servers.servers).length;
    const builtInCount = Object.values(this.servers.servers).filter(s => s.isBuiltIn).length;
    const customCount = serverCount - builtInCount;
    
    // Calculate usage stats
    const usageCounts = Object.values(this.servers.servers).map(s => s.usedByRecipes ? s.usedByRecipes.length : 0);
    const totalUsage = usageCounts.reduce((sum, count) => sum + count, 0);
    const avgUsage = serverCount > 0 ? totalUsage / serverCount : 0;

    return {
      totalServers: serverCount,
      builtInServers: builtInCount,
      customServers: customCount,
      totalUsage,
      averageUsage: Math.round(avgUsage * 100) / 100,
      lastUpdated: this.servers.metadata.lastUpdated
    };
  }

  // Import servers from existing recipes (migration helper)
  async importFromRecipes(recipes) {
    const importedServers = [];
    const errors = [];

    for (const recipe of recipes) {
      if (!recipe.extensions || !Array.isArray(recipe.extensions)) {
        continue;
      }

      for (const extension of recipe.extensions) {
        try {
          // Check if server already exists
          const existingServer = await this.findDuplicateServer(extension);
          if (existingServer) {
            // Just track usage for existing server
            await this.trackServerUsage(existingServer.id, recipe.id, 'add');
            continue;
          }

          // Create new server from extension
          const serverConfig = this.extensionToServerConfig(extension, {
            description: `Imported from recipe: ${recipe.name}`,
            category: 'imported',
            tags: [extension.name, 'imported']
          });

          const server = await this.registerServer(serverConfig);
          await this.trackServerUsage(server.id, recipe.id, 'add');
          
          importedServers.push(server);
        } catch (error) {
          errors.push(`Failed to import server ${extension.name} from recipe ${recipe.name}: ${error.message}`);
        }
      }
    }

    return { importedServers, errors };
  }

  // Clear cache to force reload
  clearCache() {
    this.cache.clear();
    console.log('MCP Server Registry cache cleared');
  }
}

module.exports = new MCPServerRegistry();