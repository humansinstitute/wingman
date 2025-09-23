/**
 * MCPServerRegistry (Refactored)
 * Now uses ServerConfigManager for improved secret management and user configs
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');
const serverConfigManager = require('../server/managers/server-config-manager');

class MCPServerRegistry extends EventEmitter {
  constructor() {
    super();
    
    // Legacy paths for backward compatibility
    this.legacyRegistryDir = path.join(process.cwd(), 'recipes');
    this.legacyRegistryFile = path.join(this.legacyRegistryDir, 'mcp-servers.json');
    
    // Use ServerConfigManager for new path
    this.configManager = serverConfigManager;
    
    this.cache = new Map();
    this.servers = {};
    this.isWriting = false;
    this.useLegacy = false; // Will be determined during initialization
    
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      // Try to initialize with new ServerConfigManager first
      const initialized = await this.configManager.initialize();
      
      if (initialized) {
        // Use new config system
        this.servers = this.configManager.servers;
        this.useLegacy = false;
        console.log('✅ Using new MCP server configuration from ~/.wingman/mcp-servers/');
      } else {
        // Fall back to legacy if new system fails
        console.log('⚠️ Falling back to legacy configuration...');
        await this.loadLegacyConfig();
      }
      
      // Set up event forwarding from config manager
      this.configManager.on('configSaved', (config) => {
        this.servers = config;
        this.emit('registryUpdated', config);
      });
      
    } catch (error) {
      console.error('Error initializing MCP server registry:', error);
      // Try legacy as last resort
      await this.loadLegacyConfig();
    }
  }

  async loadLegacyConfig() {
    try {
      // Ensure legacy directory exists
      await fs.mkdir(this.legacyRegistryDir, { recursive: true });

      // Load legacy registry
      try {
        const registryData = await fs.readFile(this.legacyRegistryFile, 'utf8');
        this.servers = JSON.parse(registryData);
        this.useLegacy = true;
        console.log('⚠️ Loaded legacy configuration. Run migration script to update.');
      } catch (error) {
        // No legacy config either, create empty
        this.servers = {
          servers: {},
          metadata: {
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          }
        };
      }
    } catch (error) {
      console.error('Error loading legacy config:', error);
    }
  }

  async saveRegistry() {
    // Use new config manager if not in legacy mode
    if (!this.useLegacy) {
      await this.configManager.saveConfig(this.servers);
      return;
    }
    
    // Legacy save implementation
    if (this.isWriting) {
      // Wait for current write to complete
      await new Promise(resolve => {
        const checkWrite = setInterval(() => {
          if (!this.isWriting) {
            clearInterval(checkWrite);
            resolve();
          }
        }, 50);
      });
    }
    
    this.isWriting = true;
    
    try {
      // Acquire lock
      await this.acquireLock();
      
      // Create backup of current file if it exists
      const backupFile = path.join(this.legacyRegistryDir, 'mcp-servers.bak');
      try {
        await fs.access(this.legacyRegistryFile);
        await fs.copyFile(this.legacyRegistryFile, backupFile);
      } catch (error) {
        // File doesn't exist yet, no backup needed
      }
      
      // Update metadata
      this.servers.metadata.lastUpdated = new Date().toISOString();
      
      // Write to temp file first (atomic write pattern)
      const tempFile = `${this.legacyRegistryFile}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(this.servers, null, 2), 'utf-8');
      
      // Atomic rename (on POSIX systems)
      await fs.rename(tempFile, this.legacyRegistryFile);
      
      // Release lock
      await this.releaseLock();
      
      this.emit('registryUpdated', this.servers);
      console.log('✅ Registry saved with atomic write (legacy)');
    } catch (error) {
      // Try to restore from backup if write failed
      const backupFile = path.join(this.legacyRegistryDir, 'mcp-servers.bak');
      try {
        await fs.copyFile(backupFile, this.legacyRegistryFile);
        console.warn('⚠️ Registry write failed, restored from backup');
      } catch (restoreError) {
        // Backup restore failed too
      }
      
      console.error('Error saving MCP server registry:', error);
      throw new Error(`Failed to save registry: ${error.message}`);
    } finally {
      this.isWriting = false;
    }
  }

  async acquireLock(maxWaitMs = 5000) {
    const lockFile = this.useLegacy ? 
      path.join(this.legacyRegistryDir, 'mcp-servers.lock') :
      path.join(this.configManager.getUserConfigDir(), '.servers.lock');
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Try to create lock file exclusively
        const fd = await fs.open(lockFile, 'wx');
        await fd.close();
        return; // Lock acquired
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Lock exists, wait and retry
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          throw error;
        }
      }
    }
    
    // Timeout - force acquire by removing stale lock
    console.warn('⚠️ Force acquiring stale lock');
    await this.releaseLock();
    const fd = await fs.open(lockFile, 'wx');
    await fd.close();
  }

  async releaseLock() {
    const lockFile = this.useLegacy ? 
      path.join(this.legacyRegistryDir, 'mcp-servers.lock') :
      path.join(this.configManager.getUserConfigDir(), '.servers.lock');
    
    try {
      await fs.unlink(lockFile);
    } catch (error) {
      // Lock file doesn't exist, already released
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
        default:
          return (a.name || '').localeCompare(b.name || '');
      }
    });
    
    return serverList;
  }

  // Other APIs preserved as in original file
  async getStats() {
    const total = Object.keys(this.servers.servers || {}).length;
    return { total };
  }

  async getServer(id) {
    return this.servers.servers?.[id] || null;
  }

  async registerServer(server) {
    if (!this.servers.servers) this.servers.servers = {};
    const id = server.id || `${server.name}-${crypto.randomBytes(4).toString('hex')}`;
    this.servers.servers[id] = { ...server, id };
    await this.saveRegistry();
    return { id, ...this.servers.servers[id] };
  }

  async updateServer(id, updates) {
    if (!this.servers.servers?.[id]) throw new Error('Server not found');
    this.servers.servers[id] = { ...this.servers.servers[id], ...updates };
    await this.saveRegistry();
    return { id, ...this.servers.servers[id] };
  }

  async unregisterServer(id) {
    if (!this.servers.servers?.[id]) throw new Error('Server not found');
    delete this.servers.servers[id];
    await this.saveRegistry();
    return { success: true };
  }

  async searchServers(query) {
    const q = (query || '').toLowerCase();
    return (await this.getAllServers()).filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  }

  async getServersForRecipe(recipeId) {
    // Placeholder for recipe-based lookup (kept compatible)
    return await this.getAllServers();
  }

  async importFromRecipes(recipes = []) {
    const importedServers = [];
    const errors = [];
    
    for (const recipe of recipes || []) {
      try {
        if (!recipe?.mcpServers) continue;
        for (const server of recipe.mcpServers) {
          const id = server.id || `${server.name}-${crypto.randomBytes(4).toString('hex')}`;
          this.servers.servers[id] = { ...server, id };
          importedServers.push({ id, ...server });
        }
      } catch (e) {
        errors.push({ recipe: recipe?.id || 'unknown', error: e.message });
      }
    }
    await this.saveRegistry();
    return { importedServers, errors };
  }
}

module.exports = new MCPServerRegistry();

