/**
 * Keychain Service (T-006)
 * 
 * Implements macOS Keychain read/write for secrets with names like
 * "Wingman:<ServerName>:<KEY>". Falls back to security CLI if needed.
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

class KeychainService extends EventEmitter {
  constructor() {
    super();
    this.keychainPrefix = 'Wingman';
    this.serviceName = 'Wingman';
    this.accountName = 'wingman';
  }

  /**
   * Format a keychain item name
   * @param {Object} ref - Secret reference {server, key}
   * @returns {string} Formatted keychain name
   */
  formatKeychainName(ref) {
    return `${this.keychainPrefix}:${ref.server}:${ref.key}`;
  }

  /**
   * Read a secret from the keychain
   * @param {Object} ref - Secret reference {server, key}
   * @returns {Promise<Object>} {exists: boolean, value?: string}
   */
  async readSecret(ref) {
    const keychainName = this.formatKeychainName(ref);
    
    try {
      // Try using security CLI (most reliable on macOS)
      const value = await this.readSecretCLI(keychainName);
      return { exists: true, value };
    } catch (error) {
      if (error.code === 'NotFound') {
        return { exists: false };
      }
      // Try fallback method if CLI failed for other reasons
      try {
        const value = await this.readSecretFallback(ref);
        return { exists: true, value };
      } catch (fallbackError) {
        return { exists: false };
      }
    }
  }

  /**
   * Write a secret to the keychain
   * @param {Object} ref - Secret reference {server, key}
   * @param {string} value - Secret value
   * @returns {Promise<void>}
   */
  async writeSecret(ref, value) {
    const keychainName = this.formatKeychainName(ref);
    
    try {
      // Use security CLI to add/update the secret
      await this.writeSecretCLI(keychainName, value);
      this.emit('secretWritten', ref);
    } catch (error) {
      // Try fallback method
      await this.writeSecretFallback(ref, value);
      this.emit('secretWritten', ref);
    }
  }

  /**
   * Delete a secret from the keychain
   * @param {Object} ref - Secret reference {server, key}
   * @returns {Promise<void>}
   */
  async deleteSecret(ref) {
    const keychainName = this.formatKeychainName(ref);
    
    try {
      await this.deleteSecretCLI(keychainName);
      this.emit('secretDeleted', ref);
    } catch (error) {
      // Secret might not exist, which is fine
      if (!error.message.includes('not found')) {
        throw error;
      }
    }
  }

  /**
   * Read secret using security CLI
   * @private
   */
  async readSecretCLI(keychainName) {
    return new Promise((resolve, reject) => {
      const args = [
        'find-generic-password',
        '-s', keychainName,
        '-a', this.accountName,
        '-w' // Output password only
      ];
      
      const proc = spawn('security', args, { timeout: 10000 });
      let stdout = '';
      let stderr = '';
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Keychain operation timed out'));
      }, 10000);
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve(stdout.trim());
        } else if (stderr.includes('could not be found') || stderr.includes('The specified item could not be found')) {
          const error = new Error('Secret not found');
          error.code = 'NotFound';
          reject(error);
        } else {
          reject(new Error(`Failed to read secret: ${stderr}`));
        }
      });
      
      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Write secret using security CLI with -T for whitelisting
   * @private
   */
  async writeSecretCLI(keychainName, value, whitelistPath = null) {
    return new Promise((resolve, reject) => {
      // First try to delete existing (update pattern)
      this.deleteSecretCLI(keychainName).catch(() => {
        // Ignore delete errors
      }).finally(() => {
        const args = [
          'add-generic-password',
          '-s', keychainName,
          '-a', this.accountName,
          '-w', value,
          '-U' // Update if exists
        ];
        
        // Add whitelisting if path provided
        if (whitelistPath) {
          args.push('-T', whitelistPath);
        } else if (process.execPath) {
          // Try to whitelist current process
          args.push('-T', process.execPath);
        }
        
        const proc = spawn('security', args, { timeout: 10000 });
        let stderr = '';
        
        const timeoutId = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error('Keychain write operation timed out'));
        }, 10000);
        
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        proc.on('close', (code) => {
          clearTimeout(timeoutId);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Failed to write secret: ${stderr}`));
          }
        });
        
        proc.on('error', (error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });
    });
  }

  /**
   * Delete secret using security CLI
   * @private
   */
  async deleteSecretCLI(keychainName) {
    return new Promise((resolve, reject) => {
      const args = [
        'delete-generic-password',
        '-s', keychainName,
        '-a', this.accountName
      ];
      
      const proc = spawn('security', args);
      let stderr = '';
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to delete secret: ${stderr}`));
        }
      });
    });
  }

  /**
   * Fallback: Read secret from environment variable
   * @private
   */
  async readSecretFallback(ref) {
    // Check if the env key is set in current process
    const envKey = ref.key;
    if (process.env[envKey]) {
      return process.env[envKey];
    }
    throw new Error('Secret not found in environment');
  }

  /**
   * Fallback: Store in memory (session-only)
   * @private
   */
  async writeSecretFallback(ref, value) {
    // Store in process env as fallback (session-only)
    process.env[ref.key] = value;
    console.warn(`⚠️ Secret stored in session memory only (not persisted)`);
  }

  /**
   * Batch read multiple secrets
   * @param {Array<Object>} refs - Array of secret references
   * @returns {Promise<Object>} Map of ref to result
   */
  async readSecrets(refs) {
    const results = {};
    
    for (const ref of refs) {
      try {
        results[this.formatKeychainName(ref)] = await this.readSecret(ref);
      } catch (error) {
        results[this.formatKeychainName(ref)] = { exists: false, error: error.message };
      }
    }
    
    return results;
  }

  /**
   * Whitelist Wingman binary for keychain access
   * @param {string} binaryPath - Path to Wingman binary
   * @param {Array<Object>} refs - Secret references to whitelist
   * @returns {Promise<void>}
   */
  async whitelistBinary(binaryPath, refs) {
    console.log(`🔐 Whitelisting ${binaryPath} for keychain access...`);
    
    for (const ref of refs) {
      const keychainName = this.formatKeychainName(ref);
      
      // Read current value
      const result = await this.readSecret(ref);
      if (result.exists) {
        // Re-write with whitelisting
        await this.writeSecretCLI(keychainName, result.value, binaryPath);
      }
    }
    
    console.log(`✅ Whitelisted for ${refs.length} secrets`);
  }

  /**
   * Headless initialization for remote/unattended setups
   * @param {string} binaryPath - Path to Wingman binary
   * @param {Array<Object>} secretsWithValues - [{server, key, value}]
   * @returns {Promise<Object>} Results
   */
  async headlessInit(binaryPath, secretsWithValues) {
    console.log(`🚀 Headless keychain initialization...`);
    const results = { success: [], failed: [] };
    
    for (const secret of secretsWithValues) {
      try {
        const ref = { server: secret.server, key: secret.key };
        const keychainName = this.formatKeychainName(ref);
        
        // Write with whitelisting
        await this.writeSecretCLI(keychainName, secret.value, binaryPath);
        
        // Verify
        const verify = await this.readSecret(ref);
        if (verify.exists && verify.value === secret.value) {
          results.success.push(keychainName);
        } else {
          results.failed.push({ name: keychainName, reason: 'Verification failed' });
        }
      } catch (error) {
        results.failed.push({ 
          name: this.formatKeychainName({ server: secret.server, key: secret.key }), 
          reason: error.message 
        });
      }
    }
    
    console.log(`✅ Success: ${results.success.length}, Failed: ${results.failed.length}`);
    return results;
  }

  /**
   * Test keychain access
   * @returns {Promise<boolean>} True if keychain is accessible
   */
  async testAccess() {
    try {
      const testRef = { server: 'test', key: 'ACCESS_CHECK' };
      const testValue = `test-${Date.now()}`;
      
      // Try write
      await this.writeSecret(testRef, testValue);
      
      // Try read
      const result = await this.readSecret(testRef);
      
      // Clean up
      await this.deleteSecret(testRef);
      
      return result.exists && result.value === testValue;
    } catch (error) {
      console.error('Keychain access test failed:', error.message);
      return false;
    }
  }
}

module.exports = new KeychainService();