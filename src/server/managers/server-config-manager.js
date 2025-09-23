/**
 * ServerConfigManager
 * Manages MCP server configurations with support for templates and user configs
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');

class ServerConfigManager extends EventEmitter {
  constructor() {
    super();
    
    // User configuration directory
    this.userConfigDir = path.join(os.homedir(), '.wingman', 'mcp-servers');
    this.userServersFile = path.join(this.userConfigDir, 'servers.json');
    
    // Template directory (in source control)
    this.templateDir = path.join(process.cwd(), 'templates', 'mcp-servers');
    this.templateFile = path.join(this.templateDir, 'servers.json');
    
    // Backup and lock files
    this.backupFile = path.join(this.userConfigDir, 'servers.backup.json');
    this.lockFile = path.join(this.userConfigDir, '.servers.lock');
    
    this.servers = {};
    this.isInitialized = false;
  }

  /**
   * Initialize the configuration manager
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Ensure user config directory exists
      await fs.mkdir(this.userConfigDir, { recursive: true });
      
      // Try to load user configuration first
      let loaded = await this.loadUserConfig();
      
      // If no user config exists, initialize from template
      if (!loaded) {
        await this.initializeFromTemplate();
        loaded = await this.loadUserConfig();
      }
      
      this.isInitialized = true;
      this.emit('initialized', this.servers);
      
      return loaded;
    } catch (error) {
      console.error('Error initializing ServerConfigManager:', error);
      throw error;
    }
  }

  /**
   * Load user configuration
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async loadUserConfig() {
    try {
      const data = await fs.readFile(this.userServersFile, 'utf8');
      this.servers = JSON.parse(data);
      console.log(`✅ Loaded ${Object.keys(this.servers.servers || {}).length} servers from user config`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('ℹ️ No user server configuration found');
        return false;
      }
      console.error('Error loading user config:', error);
      return false;
    }
  }

  /**
   * Initialize from template
   * @returns {Promise<void>}
   */
  async initializeFromTemplate() {
    try {
      console.log('📋 Initializing server configuration from template...');
      
      // Check if template exists
      const templateData = await fs.readFile(this.templateFile, 'utf8');
      const template = JSON.parse(templateData);
      
      // Remove any hardcoded secrets from template
      const cleanedServers = {};
      for (const [id, server] of Object.entries(template.servers)) {
        const cleaned = { ...server };
        
        // Ensure no hardcoded API keys in args
        if (cleaned.args) {
          cleaned.args = cleaned.args.map(arg => {
            // Replace any hardcoded API keys with placeholders
            if (arg.includes('tvly-') || arg.includes('ghp_') || arg.includes('BSA-')) {
              return arg.replace(/=([\w-]+)/, '=${$1}');
            }
            return arg;
          });
        }
        
        // Generate unique ID if needed
        if (!cleaned.id || cleaned.id === id) {
          cleaned.id = `${id}-${crypto.randomBytes(4).toString('hex')}`;
        }
        
        cleanedServers[cleaned.id] = cleaned;
      }
      
      // Create user configuration
      const userConfig = {
        servers: cleanedServers,
        metadata: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          initializedFrom: 'template'
        }
      };
      
      // Save to user config file
      await this.saveConfig(userConfig);
      
      console.log('✅ Initialized server configuration from template');
      console.log(`📁 User configuration saved to: ${this.userServersFile}`);
      
      // Also copy the .env.example file if it doesn't exist
      const envLoader = require('../../../secrets/env-file-loader');
      await envLoader.initializeFromTemplate();
      
    } catch (error) {
      console.error('Error initializing from template:', error);
      throw error;
    }
  }

  /**
   * Save configuration with atomic write
   * @param {Object} config - Configuration to save
   * @returns {Promise<void>}
   */
  async saveConfig(config = this.servers) {
    try {
      // Create backup first
      try {
        await fs.access(this.userServersFile);
        await fs.copyFile(this.userServersFile, this.backupFile);
      } catch (error) {
        // File doesn't exist yet, no backup needed
      }
      
      // Update metadata
      if (!config.metadata) {
        config.metadata = {};
      }
      config.metadata.lastUpdated = new Date().toISOString();
      
      // Atomic write
      const tempFile = `${this.userServersFile}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(config, null, 2), 'utf-8');
      await fs.rename(tempFile, this.userServersFile);
      
      this.servers = config;
      this.emit('configSaved', config);
      
      console.log('✅ Server configuration saved');
    } catch (error) {
      // Try to restore from backup
      try {
        await fs.copyFile(this.backupFile, this.userServersFile);
        console.warn('⚠️ Save failed, restored from backup');
      } catch (restoreError) {
        // Backup restore failed
      }
      throw error;
    }
  }

  /**
   * Get a server configuration by ID
   * @param {string} serverId - Server ID
   * @returns {Object|null} Server configuration or null
   */
  getServer(serverId) {
    return this.servers.servers?.[serverId] || null;
  }

  /**
   * Get all server configurations
   * @returns {Object} All server configurations
   */
  getAllServers() {
    return this.servers.servers || {};
  }

  /**
   * Add or update a server configuration
   * @param {Object} serverConfig - Server configuration
   * @returns {Promise<void>}
   */
  async upsertServer(serverConfig) {
    if (!serverConfig.id) {
      serverConfig.id = `${serverConfig.name}-${crypto.randomBytes(4).toString('hex')}`;
    }
    
    if (!this.servers.servers) {
      this.servers.servers = {};
    }
    
    this.servers.servers[serverConfig.id] = {
      ...serverConfig,
      updatedAt: new Date().toISOString(),
      createdAt: serverConfig.createdAt || new Date().toISOString()
    };
    
    await this.saveConfig(this.servers);
  }

  getUserConfigDir() {
    return this.userConfigDir;
  }
}

module.exports = new ServerConfigManager();

