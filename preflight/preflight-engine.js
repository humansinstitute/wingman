/**
 * Preflight Engine Backend (T-008)
 * 
 * Computes readiness state for recipes, checking that all required
 * secrets are present and servers are configured correctly.
 */

const EventEmitter = require('events');
const secretRequirements = require('../secrets/secret-requirements');
const keychainService = require('../secrets/keychain-service');
const secretInjector = require('../secrets/secret-injector');

class PreflightEngine extends EventEmitter {
  constructor() {
    super();
    this.mcpServerRegistry = null; // Lazy loaded
    this.cache = new Map(); // Cache preflight results
    this.cacheTTL = 30000; // 30 seconds cache TTL
  }

  getMCPServerRegistry() {
    if (!this.mcpServerRegistry) {
      this.mcpServerRegistry = require('../mcp-server-registry');
    }
    return this.mcpServerRegistry;
  }

  /**
   * Run preflight check for a recipe
   * @param {Object} recipe - Recipe configuration
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Preflight result
   */
  async runPreflight(recipe, options = {}) {
    const cacheKey = `${recipe.id || recipe.name}-${Date.now()}`;
    
    // Check cache
    if (!options.force && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.result;
      }
    }
    
    const result = {
      recipe: recipe.name || 'Unnamed Recipe',
      recipeId: recipe.id,
      timestamp: new Date().toISOString(),
      isReady: true,
      servers: [],
      missingSecrets: [],
      errors: [],
      warnings: [],
      summary: ''
    };
    
    try {
      // Check each server in the recipe
      const registry = this.getMCPServerRegistry();
      
      for (const extension of recipe.extensions || []) {
        const serverName = extension.name || extension;
        const serverCheck = {
          name: serverName,
          isConfigured: false,
          isReady: false,
          missingKeys: [],
          errors: []
        };
        
        // Check if server exists in registry
        const servers = await registry.getAllServers();
        const serverConfig = servers.find(s => s.name === serverName);
        
        if (!serverConfig) {
          serverCheck.errors.push(`Server not found in registry`);
          result.errors.push(`Server "${serverName}" not found in registry`);
        } else {
          serverCheck.isConfigured = true;
          
          // Check required secrets
          const requiredKeys = serverConfig.env_keys || [];
          for (const key of requiredKeys) {
            const secretRef = { server: serverName, key };
            const secretResult = await keychainService.readSecret(secretRef);
            
            if (!secretResult.exists) {
              serverCheck.missingKeys.push(key);
              result.missingSecrets.push({
                server: serverName,
                key: key,
                keychainName: keychainService.formatKeychainName(secretRef)
              });
            }
          }
          
          serverCheck.isReady = serverCheck.missingKeys.length === 0;
        }
        
        result.servers.push(serverCheck);
        
        if (!serverCheck.isReady) {
          result.isReady = false;
        }
      }
      
      // Generate summary
      result.summary = this.generateSummary(result);
      
      // Cache result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });
      
      // Emit event
      this.emit('preflightComplete', result);
      
      return result;
    } catch (error) {
      result.isReady = false;
      result.errors.push(`Preflight check failed: ${error.message}`);
      result.summary = `❌ Preflight failed: ${error.message}`;
      
      return result;
    }
  }

  /**
   * Generate human-readable summary
   * @private
   */
  generateSummary(result) {
    if (result.isReady) {
      return `✅ Ready to launch - all ${result.servers.length} servers configured`;
    }
    
    const issues = [];
    
    if (result.missingSecrets.length > 0) {
      const uniqueServers = new Set(result.missingSecrets.map(s => s.server));
      issues.push(`${result.missingSecrets.length} missing secret(s) for ${uniqueServers.size} server(s)`);
    }
    
    if (result.errors.length > 0) {
      issues.push(`${result.errors.length} error(s)`);
    }
    
    return `⚠️ Not ready: ${issues.join(', ')}`;
  }

  /**
   * Get missing secrets with actionable info
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<Array>} Missing secrets with setup instructions
   */
  async getMissingSecretsWithInstructions(recipe) {
    const missing = await secretInjector.getMissingSecrets(recipe);
    const instructions = [];
    
    for (const item of missing) {
      instructions.push({
        ...item,
        instruction: `Set in Keychain: security add-generic-password -s "${item.keychainName}" -a wingman -w <value> -U`,
        uiAction: 'Set in Keychain',
        exampleValue: this.getExampleValue(item.key)
      });
    }
    
    return instructions;
  }

  /**
   * Get example value for a known key type
   * @private
   */
  getExampleValue(key) {
    const examples = {
      'API_KEY': 'your-api-key-here',
      'BRAVE_API_KEY': 'BSA-xxx-your-brave-api-key',
      'GITHUB_PERSONAL_ACCESS_TOKEN': 'ghp_xxxxxxxxxxxxxxxxxxxx',
      'OBSIDIAN_API_KEY': 'your-obsidian-key',
      'CONTEXT7_API_KEY': 'your-context7-key',
      'POSTGRES_CONNECTION_STRING': 'postgresql://user:pass@host:5432/db',
      'EVERART_API_KEY': 'your-everart-key'
    };
    
    return examples[key] || '<your-secret-value>';
  }

  /**
   * Run quick readiness check (no details)
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<boolean>} True if ready
   */
  async isReady(recipe) {
    const result = await this.runPreflight(recipe);
    return result.isReady;
  }

  /**
   * Get readiness state for multiple recipes
   * @param {Array} recipes - Array of recipes
   * @returns {Promise<Object>} Map of recipe ID to readiness
   */
  async checkMultipleRecipes(recipes) {
    const results = {};
    
    for (const recipe of recipes) {
      const preflight = await this.runPreflight(recipe);
      results[recipe.id || recipe.name] = {
        isReady: preflight.isReady,
        summary: preflight.summary,
        missingCount: preflight.missingSecrets.length
      };
    }
    
    return results;
  }

  /**
   * Test a specific server configuration
   * @param {string} serverName - Server name
   * @returns {Promise<Object>} Test result
   */
  async testServer(serverName) {
    const registry = this.getMCPServerRegistry();
    const result = {
      server: serverName,
      exists: false,
      hasSecrets: false,
      canStart: false,
      errors: []
    };
    
    try {
      // Check if server exists
      const servers = await registry.getAllServers();
      const serverConfig = servers.find(s => s.name === serverName);
      
      if (!serverConfig) {
        result.errors.push('Server not found in registry');
        return result;
      }
      
      result.exists = true;
      
      // Check secrets
      const secrets = await secretInjector.prepareServerSecrets(serverName);
      result.hasSecrets = secrets.success;
      
      if (!secrets.success) {
        result.errors.push(`Missing secrets: ${secrets.missing.join(', ')}`);
      }
      
      // TODO: Actual server start test (spawn process with timeout)
      result.canStart = result.exists && result.hasSecrets;
      
      return result;
    } catch (error) {
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Clear preflight cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🧹 Preflight cache cleared');
  }

  /**
   * Get preflight status as badge/icon
   * @param {Object} result - Preflight result
   * @returns {Object} Badge info
   */
  getBadgeInfo(result) {
    if (result.isReady) {
      return {
        status: 'ready',
        icon: '✅',
        text: 'Ready',
        color: 'green'
      };
    }
    
    if (result.missingSecrets.length > 0) {
      return {
        status: 'missing-secrets',
        icon: '🔐',
        text: `${result.missingSecrets.length} secrets missing`,
        color: 'yellow'
      };
    }
    
    if (result.errors.length > 0) {
      return {
        status: 'error',
        icon: '❌',
        text: 'Configuration error',
        color: 'red'
      };
    }
    
    return {
      status: 'unknown',
      icon: '❓',
      text: 'Unknown',
      color: 'gray'
    };
  }
}

module.exports = new PreflightEngine();