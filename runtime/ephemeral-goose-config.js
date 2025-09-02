/**
 * Ephemeral Goose Config Generator (T-002)
 * 
 * Creates minimal per-session Goose config with zero default extensions
 * to neutralize any global/default MCP servers from Goose CLI.
 * 
 * This ensures deterministic runtime where only recipe-declared
 * servers are available.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class EphemeralGooseConfig {
  constructor() {
    this.tempBasePath = path.join(os.tmpdir(), 'wingman-sessions');
    this.configs = new Map(); // Track active configs for cleanup
  }

  /**
   * Create a hybrid ephemeral Goose config that preserves working global servers 
   * but enforces deterministic behavior for recipe-declared servers
   * @param {string} sessionId - Unique session identifier
   * @param {Object} providerConfig - Provider/model configuration
   * @param {Object} options - Additional options { allowGlobalServers: boolean }
   * @returns {Promise<{dir: string, path: string}>} Config file paths
   */
  async createEphemeralConfig(sessionId, providerConfig = {}, options = {}) {
    try {
      // Ensure base temp directory exists
      await fs.mkdir(this.tempBasePath, { recursive: true });
      
      // Create unique session directory
      const sessionHash = crypto.createHash('md5').update(sessionId).digest('hex').substring(0, 8);
      const sessionDir = path.join(this.tempBasePath, `session-${sessionHash}-${Date.now()}`);
      await fs.mkdir(sessionDir, { recursive: true });
      
      // Load existing global config to preserve working servers (hybrid approach)
      let globalExtensions = {};
      const allowGlobalServers = options.allowGlobalServers === true; // Default: zero-default
      
      if (allowGlobalServers) {
        try {
          const globalConfigPath = path.join(os.homedir(), '.config', 'goose', 'config.yaml');
          if (await this.fileExists(globalConfigPath)) {
            const yaml = require('js-yaml');
            const globalConfigData = await fs.readFile(globalConfigPath, 'utf8');
            const globalConfig = yaml.load(globalConfigData);
            
            // Preserve enabled extensions from global config
            if (globalConfig.extensions) {
              globalExtensions = Object.fromEntries(
                Object.entries(globalConfig.extensions)
                  .filter(([name, ext]) => ext.enabled === true)
              );
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not load global config, proceeding with zero-defaults: ${error.message}`);
        }
      }
      
      // Build hybrid config: global servers + recipe-specific overrides
      const config = {
        providers: {},
        extensions: globalExtensions, // Include working global servers
        models: {},
        builtins: [], // Initialize empty builtins array - will be populated from recipe
        // Add provider config if specified
        ...(providerConfig.provider && {
          providers: {
            default: {
              name: providerConfig.provider,
              ...(providerConfig.model && { model: providerConfig.model }),
              ...(providerConfig.apiKey && { api_key: providerConfig.apiKey })
            }
          }
        })
      };
      
      // Write config to file
      const configPath = path.join(sessionDir, 'goose-config.json');
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      // Track for cleanup
      this.configs.set(sessionId, { dir: sessionDir, path: configPath });
      
      console.log(`📝 Created hybrid ephemeral config for session ${sessionId}:`);
      console.log(`   Path: ${configPath}`);
      const extensionCount = Object.keys(config.extensions).length;
      const enabledCount = Object.values(config.extensions).filter(ext => ext.enabled).length;
      console.log(`   Extensions: ${extensionCount} total, ${enabledCount} enabled (${allowGlobalServers ? 'hybrid' : 'zero-default'} mode)`);
      if (allowGlobalServers && extensionCount > 0) {
        console.log(`   Global servers preserved: ${Object.keys(config.extensions).join(', ')}`);
      }
      
      return {
        dir: sessionDir,
        path: configPath
      };
    } catch (error) {
      console.error(`Failed to create ephemeral config for session ${sessionId}:`, error);
      throw new Error(`Ephemeral config creation failed: ${error.message}`);
    }
  }

  /**
   * Add recipe-declared servers to an existing config (deterministic approach)
   * @param {string} configPath - Path to the ephemeral config file
   * @param {Array} recipeExtensions - Extensions from recipe
   * @param {Object} secretEnv - Environment variables with secrets
   * @returns {Promise<void>}
   */
  async addRecipeServers(configPath, recipeExtensions = [], secretEnv = {}) {
    try {
      // Read existing config
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Convert recipe extensions to config format and merge
      for (const extension of recipeExtensions) {
        const extensionName = extension.name;
        
        // Validate filesystem paths if this is a filesystem server
        if (extensionName === 'files_readonly' || extensionName.includes('filesystem')) {
          await this.validateFilesystemServer(extension);
        }
        
        // Create deterministic server config with keychain secrets
        const serverConfig = {
          type: extension.type || 'stdio',
          cmd: extension.cmd,
          args: extension.args || [],
          timeout: extension.timeout || 300,
          env_keys: extension.env_keys || [],
          enabled: true, // Recipe-declared servers are always enabled
          description: `Recipe-declared server: ${extensionName}`,
          envs: {}, // Populated by secret injector
          bundled: null
        };
        
        // Add to config (overrides global if same name)
        config.extensions[extensionName] = serverConfig;
      }
      
      // Write updated config back
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      
      console.log(`🔧 Added ${recipeExtensions.length} recipe servers to ephemeral config`);
      if (recipeExtensions.length > 0) {
        console.log(`   Recipe servers: ${recipeExtensions.map(ext => ext.name).join(', ')}`);
      }
    } catch (error) {
      console.error('Failed to add recipe servers to config:', error);
      throw error;
    }
  }

  /**
   * Check if a file exists
   * @private
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate filesystem server configuration
   * @param {Object} extension - Extension configuration
   * @throws {Error} If filesystem path is invalid
   */
  async validateFilesystemServer(extension) {
    // Look for path in args (usually the last argument)
    const args = extension.args || [];
    let pathArg = null;
    
    // Common patterns for filesystem servers
    for (const arg of args) {
      if (arg.startsWith('/') || arg.startsWith('~')) {
        pathArg = arg;
        break;
      }
    }
    
    if (pathArg) {
      // Expand tilde if present
      if (pathArg.startsWith('~')) {
        pathArg = pathArg.replace('~', os.homedir());
      }
      
      // Check if path exists
      const exists = await this.fileExists(pathArg);
      if (!exists) {
        console.error(`❌ Filesystem server path does not exist: ${pathArg}`);
        console.error(`   Server: ${extension.name}`);
        console.error(`   This will cause MCP server to fail with serde errors`);
        
        // Try to suggest alternatives
        const suggestions = [];
        if (pathArg.includes('/mini/')) {
          const altPath = pathArg.replace('/mini/', `/${process.env.USER || 'user'}/`);
          if (await this.fileExists(altPath)) {
            suggestions.push(altPath);
          }
        }
        
        if (suggestions.length > 0) {
          console.error(`   Suggested alternative: ${suggestions[0]}`);
        }
        
        // Don't throw - log warning but continue
        // This allows the session to start even with bad paths
        console.warn(`⚠️ Continuing with invalid path - server may fail`);
      } else {
        console.log(`✅ Validated filesystem path: ${pathArg}`);
      }
    }
  }

  /**
   * Clean up ephemeral config for a session
   * @param {string} sessionId - Session to clean up
   */
  async cleanupSession(sessionId) {
    const config = this.configs.get(sessionId);
    if (!config) {
      return;
    }
    
    try {
      // Remove the entire session directory
      await fs.rm(config.dir, { recursive: true, force: true });
      this.configs.delete(sessionId);
      console.log(`🧹 Cleaned up ephemeral config for session ${sessionId}`);
    } catch (error) {
      console.warn(`Failed to cleanup session ${sessionId}:`, error.message);
    }
  }

  /**
   * Clean up all ephemeral configs (for shutdown)
   */
  async cleanupAll() {
    console.log(`🧹 Cleaning up ${this.configs.size} ephemeral configs...`);
    
    const cleanupPromises = [];
    for (const [sessionId] of this.configs) {
      cleanupPromises.push(this.cleanupSession(sessionId));
    }
    
    await Promise.allSettled(cleanupPromises);
    
    // Try to remove base temp directory if empty
    try {
      await fs.rmdir(this.tempBasePath);
    } catch (error) {
      // Directory not empty or doesn't exist, ignore
    }
  }

  /**
   * Get the config path for a session
   * @param {string} sessionId - Session ID
   * @returns {string|null} Config file path or null if not found
   */
  getConfigPath(sessionId) {
    const config = this.configs.get(sessionId);
    return config ? config.path : null;
  }

  /**
   * Verify that a config enforces zero defaults
   * @param {string} configPath - Path to config file to verify
   * @returns {Promise<boolean>} True if config has zero defaults
   */
  async verifyZeroDefaults(configPath) {
    try {
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      // Check that extensions array is empty
      const hasZeroExtensions = !config.extensions || config.extensions.length === 0;
      
      // Check that no default MCP servers are configured
      const hasNoDefaultServers = !config.mcp_servers || Object.keys(config.mcp_servers).length === 0;
      
      return hasZeroExtensions && hasNoDefaultServers;
    } catch (error) {
      console.error(`Failed to verify config at ${configPath}:`, error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new EphemeralGooseConfig();