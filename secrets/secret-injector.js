/**
 * Secret Injector (T-007)
 * 
 * Builds environment map for sessions containing only required keys
 * (values from Keychain). Reports missing keys.
 */

const EventEmitter = require('events');
const keychainService = require('./keychain-service');
const secretRequirements = require('./secret-requirements');
let envFileLoader = null;
const allowEnv = process.env.WINGMAN_ENV_SECRETS === '1' || process.env.WINGMAN_ENV_SECRETS === 'true';
if (allowEnv) {
  envFileLoader = require('./env-file-loader');
}

class SecretInjector extends EventEmitter {
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
   * Build session environment with injected secrets
   * @param {Object} options - Configuration options
   * @param {Object} options.recipe - Recipe configuration
   * @param {Array} options.selectedServers - Selected servers from recipe
   * @param {string} options.binaryPath - Path to Wingman binary for whitelisting
   * @returns {Promise<Object>} {env: Object, missing: Array, injected: Array}
   */
  async buildSessionEnv(options = {}) {
    const { recipe, selectedServers, binaryPath } = options;
    const env = { ...process.env };
    const missing = [];
    const injected = [];
    const errors = [];
    
    try {
      // Get all required secrets for the recipe
      const requirements = await secretRequirements.getRecipeRequirements(recipe);
      
      // Process each server's requirements
      for (const [serverName, requiredKeys] of Object.entries(requirements)) {
        // Check if this server is actually selected (might be filtered)
        if (selectedServers && !selectedServers.find(s => s.name === serverName)) {
          continue;
        }
        
        for (const key of requiredKeys) {
          const secretRef = { server: serverName, key };
          let secretFound = false;
          
          try {
            // Only use .env if explicitly enabled
            if (allowEnv && envFileLoader) {
              if (!envFileLoader.loaded) {
                await envFileLoader.load();
              }

              if (envFileLoader.has(key)) {
                const value = envFileLoader.get(key);
                if (value) {
                  // Inject from .env file
                  env[key] = value;
                  injected.push({
                    server: serverName,
                    key: key,
                    source: '.env',
                    injected: true
                  });
                  
                  console.log(`✅ Injected ${key} for ${serverName} (from .env)`);
                  secretFound = true;
                }
              }
            }
            
            // If not found in .env, try keychain
            if (!secretFound) {
              const result = await keychainService.readSecret(secretRef);
              
              if (result.exists && result.value) {
                // Inject from keychain
                env[key] = result.value;
                injected.push({
                  server: serverName,
                  key: key,
                  source: 'keychain',
                  injected: true
                });
                
                console.log(`✅ Injected ${key} for ${serverName} (from keychain)`);
                secretFound = true;
              }
            }
            
            // If still not found, track as missing
            if (!secretFound) {
              const missingItem = {
                server: serverName,
                key: key,
                keychainName: keychainService.formatKeychainName(secretRef)
              };
              if (allowEnv && envFileLoader) missingItem.envFile = envFileLoader.envPath;
              missing.push(missingItem);
              
              console.warn(`⚠️ Missing secret: ${key} for ${serverName} (checked .env and keychain)`);
            }
          } catch (error) {
            errors.push({
              server: serverName,
              key: key,
              error: error.message
            });
            
            // Also track as missing
              const missingItemErr = {
                server: serverName,
                key: key,
                keychainName: keychainService.formatKeychainName(secretRef),
                error: error.message
              };
              if (allowEnv && envFileLoader) missingItemErr.envFile = envFileLoader.envPath;
              missing.push(missingItemErr);
          }
        }
      }
      
      // Log summary
      this.logInjectionSummary(injected, missing, errors);
      
      return {
        env,
        missing,
        injected,
        errors,
        success: missing.length === 0
      };
    } catch (error) {
      console.error('Failed to build session environment:', error);
      throw new Error(`Secret injection failed: ${error.message}`);
    }
  }

  /**
   * Log injection summary (security-conscious)
   * @private
   */
  logInjectionSummary(injected, missing, errors) {
    console.log('\n🔐 Secret Injection Summary:');
    console.log(`   Injected: ${injected.length} secret(s)`);
    
    // Log only key names, never values
    if (injected.length > 0) {
      console.log('   Injected keys:');
      injected.forEach(item => {
        const source = item.source ? ` from ${item.source}` : '';
        console.log(`     - ${item.key} (${item.server})${source}`);
      });
    }
    
    if (missing.length > 0) {
      console.log(`   Missing: ${missing.length} secret(s)`);
      console.log('   Add missing secrets to either:');
      console.log(`     - ~/.wingman/.env file`);
      console.log(`     - Keychain (use: security add-generic-password -a Wingman -s "Wingman:ServerName:KEY" -w "value")`);
      missing.forEach(item => {
        console.log(`     - ${item.key} (${item.server})`);
      });
    }
    
    if (errors.length > 0) {
      console.log(`   Errors: ${errors.length}`);
      errors.forEach(item => {
        console.log(`     - ${item.key} (${item.server}): ${item.error}`);
      });
    }
    
    console.log('');
  }

  /**
   * Validate that all required secrets are available
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<Object>} Validation result
   */
  async validateSecrets(recipe) {
    const requirements = await secretRequirements.getRecipeRequirements(recipe);
    const validation = {
      isValid: true,
      missing: [],
      available: [],
      totalRequired: 0
    };
    
    for (const [serverName, requiredKeys] of Object.entries(requirements)) {
      for (const key of requiredKeys) {
        validation.totalRequired++;
        
        const secretRef = { server: serverName, key };
        const result = await keychainService.readSecret(secretRef);
        
        if (result.exists) {
          validation.available.push({
            server: serverName,
            key: key
          });
        } else {
          validation.isValid = false;
          validation.missing.push({
            server: serverName,
            key: key,
            keychainName: keychainService.formatKeychainName(secretRef)
          });
        }
      }
    }
    
    return validation;
  }

  /**
   * Get missing secrets for a recipe
   * @param {Object} recipe - Recipe configuration
   * @returns {Promise<Array>} List of missing secrets
   */
  async getMissingSecrets(recipe) {
    const validation = await this.validateSecrets(recipe);
    return validation.missing;
  }

  /**
   * Prepare secrets for a specific server
   * @param {string} serverName - Server name
   * @returns {Promise<Object>} Environment variables for the server
   */
  async prepareServerSecrets(serverName) {
    const registry = this.getMCPServerRegistry();
    const server = await registry.getServer(serverName);
    
    if (!server) {
      throw new Error(`Server ${serverName} not found in registry`);
    }
    
    const env = {};
    const missing = [];
    
    for (const key of server.env_keys || []) {
      const secretRef = { server: serverName, key };
      const result = await keychainService.readSecret(secretRef);
      
      if (result.exists && result.value) {
        env[key] = result.value;
      } else {
        missing.push(key);
      }
    }
    
    return {
      env,
      missing,
      success: missing.length === 0
    };
  }

  /**
   * Create minimal environment with only required secrets
   * @param {Array} requiredKeys - List of required environment keys
   * @param {string} serverName - Server name for keychain lookup
   * @returns {Promise<Object>} Minimal environment object
   */
  async createMinimalEnv(requiredKeys, serverName) {
    const minimalEnv = {};
    
    // Copy only essential system variables
    const essentialVars = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL'];
    essentialVars.forEach(key => {
      if (process.env[key]) {
        minimalEnv[key] = process.env[key];
      }
    });
    
    // Add required secrets
    for (const key of requiredKeys) {
      const secretRef = { server: serverName, key };
      const result = await keychainService.readSecret(secretRef);
      
      if (result.exists && result.value) {
        minimalEnv[key] = result.value;
      }
    }
    
    return minimalEnv;
  }

  /**
   * Clear injected secrets from environment (cleanup)
   * @param {Array} injectedKeys - List of injected keys
   */
  clearInjectedSecrets(injectedKeys) {
    injectedKeys.forEach(item => {
      if (process.env[item.key]) {
        delete process.env[item.key];
      }
    });
    
    console.log(`🧹 Cleared ${injectedKeys.length} injected secrets from environment`);
  }
}

module.exports = new SecretInjector();
