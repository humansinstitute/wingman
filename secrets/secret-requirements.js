/**
 * Secret Requirements Model (T-005)
 * 
 * Standardizes collection of required env_keys per server and per recipe.
 * Provides API to list what a session needs for secret injection.
 */

const EventEmitter = require('events');

class SecretRequirements extends EventEmitter {
  constructor() {
    super();
    this.mcpServerRegistry = null; // Lazy loaded
  }

  getMCPServerRegistry() {
    if (!this.mcpServerRegistry) {
      this.mcpServerRegistry = require('../src/mcp/registry');
    }
    return this.mcpServerRegistry;
  }

  /**
   * Get required secrets for a specific server
   * @param {string|Object} server - Server name or server config object
   * @returns {Promise<Array>} List of required env keys
   */
  async getServerRequirements(server) {
    const registry = this.getMCPServerRegistry();
    
    if (typeof server === 'string') {
      // Look up server by name in registry
      const servers = await registry.getAllServers();
      const serverConfig = servers.find(s => s.name === server);
      
      if (!serverConfig) {
        console.warn(`Server "${server}" not found in registry`);
        return [];
      }
      
      return serverConfig.env_keys || [];
    } else if (typeof server === 'object') {
      // Use provided server config
      return server.env_keys || [];
    }
    
    return [];
  }

  /**
   * Get all required secrets for a recipe
   * @param {Object} recipe - Recipe configuration object
   * @returns {Promise<Object>} Map of server name to required keys
   */
  async getRecipeRequirements(recipe) {
    const requirements = {};
    
    if (!recipe || !recipe.extensions) {
      return requirements;
    }
    
    for (const extension of recipe.extensions) {
      const serverName = extension.name || extension;
      const envKeys = await this.getServerRequirements(extension);
      
      if (envKeys.length > 0) {
        requirements[serverName] = envKeys;
      }
    }
    
    return requirements;
  }

  /**
   * Get deduplicated list of all required secrets for a recipe
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<Array>} Deduplicated list of all required env keys
   */
  async getAllRequiredKeys(recipe) {
    const requirements = await this.getRecipeRequirements(recipe);
    const allKeys = new Set();
    
    for (const [serverName, keys] of Object.entries(requirements)) {
      keys.forEach(key => allKeys.add(key));
    }
    
    return Array.from(allKeys);
  }

  /**
   * Format requirements for display
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<Object>} Formatted requirements with metadata
   */
  async formatRequirements(recipe) {
    const requirements = await this.getRecipeRequirements(recipe);
    const formatted = {
      recipe: recipe.name || 'Unnamed Recipe',
      totalServers: 0,
      totalKeys: 0,
      servers: []
    };
    
    for (const [serverName, keys] of Object.entries(requirements)) {
      formatted.servers.push({
        name: serverName,
        keys: keys,
        keyCount: keys.length
      });
      formatted.totalKeys += keys.length;
    }
    
    formatted.totalServers = formatted.servers.length;
    
    return formatted;
  }

  /**
   * Check which keys are missing for a recipe (requires keychain service)
   * @param {Object} recipe - Recipe configuration
   * @param {Object} keychainService - Keychain service instance
   * @returns {Promise<Object>} Missing keys by server
   */
  async checkMissingKeys(recipe, keychainService) {
    const requirements = await this.getRecipeRequirements(recipe);
    const missing = {};
    
    for (const [serverName, keys] of Object.entries(requirements)) {
      const missingKeys = [];
      
      for (const key of keys) {
        const secretRef = { server: serverName, key: key };
        const result = await keychainService.readSecret(secretRef);
        
        if (!result.exists) {
          missingKeys.push(key);
        }
      }
      
      if (missingKeys.length > 0) {
        missing[serverName] = missingKeys;
      }
    }
    
    return missing;
  }

  /**
   * Generate secret references for all requirements
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<Array>} Array of secret references
   */
  async generateSecretRefs(recipe) {
    const requirements = await this.getRecipeRequirements(recipe);
    const refs = [];
    
    for (const [serverName, keys] of Object.entries(requirements)) {
      for (const key of keys) {
        refs.push({
          server: serverName,
          key: key,
          keychainName: `Wingman:${serverName}:${key}`
        });
      }
    }
    
    return refs;
  }

  /**
   * Validate that all required secrets are properly configured
   * @param {Object} recipe - Recipe configuration
   * @param {Object} keychainService - Keychain service instance
   * @returns {Promise<Object>} Validation result
   */
  async validateRequirements(recipe, keychainService) {
    const missing = await this.checkMissingKeys(recipe, keychainService);
    const hasMissing = Object.keys(missing).length > 0;
    
    return {
      isValid: !hasMissing,
      missing: missing,
      totalMissing: Object.values(missing).flat().length,
      message: hasMissing 
        ? `Missing ${Object.values(missing).flat().length} secret(s) for ${Object.keys(missing).length} server(s)`
        : 'All required secrets are configured'
    };
  }
}

module.exports = new SecretRequirements();
