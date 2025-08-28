/**
 * EnvFileLoader
 * Loads environment variables from .env file in ~/.wingman/
 * Provides secure loading and validation of environment variables
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

class EnvFileLoader {
  constructor() {
    this.wingmanDir = path.join(os.homedir(), '.wingman');
    this.envPath = path.join(this.wingmanDir, '.env');
    this.envVars = new Map();
    this.loaded = false;
  }

  /**
   * Parse .env file content into key-value pairs
   * @param {string} content - Content of .env file
   * @returns {Map} Parsed environment variables
   */
  parseEnvFile(content) {
    const vars = new Map();
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Parse KEY=VALUE format
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }
      
      const key = trimmed.substring(0, equalIndex).trim();
      let value = trimmed.substring(equalIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Handle escaped characters
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
      
      if (key) {
        vars.set(key, value);
      }
    }
    
    return vars;
  }

  /**
   * Load environment variables from .env file
   * @returns {Promise<boolean>} True if loaded successfully
   */
  async load() {
    try {
      // Check if .env file exists
      await fs.access(this.envPath, fsSync.constants.F_OK);
      
      // Check file permissions (should be readable and not world-readable)
      const stats = await fs.stat(this.envPath);
      const mode = stats.mode & parseInt('777', 8);
      
      // Warn if file is world-readable (security issue)
      if (mode & 0o004) {
        console.warn('⚠️ Warning: .env file is world-readable. Consider running: chmod 600 ~/.wingman/.env');
      }
      
      // Read and parse the file
      const content = await fs.readFile(this.envPath, 'utf8');
      this.envVars = this.parseEnvFile(content);
      
      this.loaded = true;
      console.log(`✅ Loaded ${this.envVars.size} environment variables from ${this.envPath}`);
      
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`ℹ️ No .env file found at ${this.envPath}`);
      } else {
        console.error(`❌ Error loading .env file: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Get an environment variable value
   * @param {string} key - Environment variable key
   * @returns {string|undefined} Value or undefined if not found
   */
  get(key) {
    return this.envVars.get(key);
  }

  /**
   * Get all environment variables
   * @returns {Object} All environment variables as object
   */
  getAll() {
    const result = {};
    for (const [key, value] of this.envVars) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Check if a key exists
   * @param {string} key - Environment variable key
   * @returns {boolean} True if key exists
   */
  has(key) {
    return this.envVars.has(key);
  }

  /**
   * Get list of all keys
   * @returns {Array<string>} Array of environment variable keys
   */
  keys() {
    return Array.from(this.envVars.keys());
  }

  /**
   * Create a secure .env file with proper permissions
   * @param {string} content - Content to write
   * @returns {Promise<void>}
   */
  async createSecureEnvFile(content = '') {
    try {
      // Ensure directory exists
      await fs.mkdir(this.wingmanDir, { recursive: true });
      
      // Write file with secure permissions (owner read/write only)
      await fs.writeFile(this.envPath, content, { mode: 0o600 });
      
      console.log(`✅ Created secure .env file at ${this.envPath}`);
    } catch (error) {
      console.error(`❌ Error creating .env file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Copy example .env file to user's directory
   * @returns {Promise<void>}
   */
  async initializeFromTemplate() {
    try {
      const templatePath = path.join(__dirname, '..', 'templates', 'mcp-servers', '.env.example');
      
      // Check if template exists
      await fs.access(templatePath);
      
      // Check if .env already exists
      try {
        await fs.access(this.envPath);
        console.log(`ℹ️ .env file already exists at ${this.envPath}`);
        return;
      } catch (error) {
        // .env doesn't exist, proceed with copying
      }
      
      // Read template
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      // Create secure .env file
      await this.createSecureEnvFile(templateContent);
      
      console.log(`✅ Initialized .env file from template`);
      console.log(`📝 Please edit ${this.envPath} and add your API keys`);
    } catch (error) {
      console.error(`❌ Error initializing from template: ${error.message}`);
    }
  }

  /**
   * Validate that required environment variables are present
   * @param {Array<string>} required - Required environment variable keys
   * @returns {Object} {valid: boolean, missing: Array<string>}
   */
  validate(required = []) {
    const missing = [];
    
    for (const key of required) {
      if (!this.has(key) || !this.get(key)) {
        missing.push(key);
      }
    }
    
    return {
      valid: missing.length === 0,
      missing
    };
  }
}

// Export singleton instance
module.exports = new EnvFileLoader();