/**
 * Failure Handler (T-015)
 * 
 * Implements retry-then-disable pattern for MCP server failures.
 * Shows human-readable errors, retries once, then disables server and continues.
 */

const EventEmitter = require('events');

class FailureHandler extends EventEmitter {
  constructor() {
    super();
    this.failedServers = new Map(); // Track failed servers per session
    this.retryAttempts = new Map(); // Track retry attempts
    this.maxRetries = 1;
    this.retryDelayMs = 1500;
  }

  /**
   * Handle server startup failure
   * @param {string} sessionId - Session identifier
   * @param {string} serverName - Name of the failing server
   * @param {Error} error - The error that occurred
   * @returns {Promise<Object>} Action to take {action: 'retry'|'disable', shouldContinue: boolean}
   */
  async handleServerFailure(sessionId, serverName, error) {
    const failureKey = `${sessionId}:${serverName}`;
    const retryCount = this.retryAttempts.get(failureKey) || 0;
    
    // Log the failure
    this.logFailure(serverName, error, retryCount);
    
    if (retryCount < this.maxRetries) {
      // Attempt retry
      this.retryAttempts.set(failureKey, retryCount + 1);
      
      console.log(`🔄 Retrying ${serverName} (attempt ${retryCount + 1}/${this.maxRetries})...`);
      
      // Wait before retry
      await this.delay(this.retryDelayMs);
      
      this.emit('serverRetry', {
        sessionId,
        serverName,
        attempt: retryCount + 1,
        maxRetries: this.maxRetries
      });
      
      return {
        action: 'retry',
        shouldContinue: true,
        message: `Retrying ${serverName} after failure`
      };
    } else {
      // Max retries exceeded, disable server
      this.failedServers.set(failureKey, {
        serverName,
        error: error.message,
        disabledAt: new Date().toISOString(),
        retryCount
      });
      
      const readableError = this.makeErrorReadable(error);
      console.log(`❌ Disabling ${serverName} after ${retryCount} failed attempts`);
      console.log(`   Reason: ${readableError}`);
      
      this.emit('serverDisabled', {
        sessionId,
        serverName,
        error: readableError,
        retryCount
      });
      
      return {
        action: 'disable',
        shouldContinue: true,
        message: `Server ${serverName} disabled after repeated failures: ${readableError}`,
        error: readableError
      };
    }
  }

  /**
   * Handle process failure (Goose process exit)
   * @param {string} sessionId - Session identifier
   * @param {number} exitCode - Exit code from process
   * @param {string} stderr - Standard error output
   * @returns {Object} Action to take
   */
  handleProcessFailure(sessionId, exitCode, stderr) {
    const readableError = this.makeProcessErrorReadable(exitCode, stderr);
    
    console.log(`💥 Goose process failed (exit code: ${exitCode})`);
    console.log(`   Error: ${readableError}`);
    
    this.emit('processFailure', {
      sessionId,
      exitCode,
      error: readableError,
      stderr
    });
    
    return {
      action: 'fail',
      shouldContinue: false,
      message: `Session failed: ${readableError}`,
      error: readableError
    };
  }

  /**
   * Check if a server is disabled for a session
   * @param {string} sessionId - Session identifier
   * @param {string} serverName - Server name
   * @returns {boolean} True if server is disabled
   */
  isServerDisabled(sessionId, serverName) {
    const failureKey = `${sessionId}:${serverName}`;
    return this.failedServers.has(failureKey);
  }

  /**
   * Get disabled servers for a session
   * @param {string} sessionId - Session identifier
   * @returns {Array} List of disabled servers
   */
  getDisabledServers(sessionId) {
    const disabled = [];
    for (const [key, failure] of this.failedServers) {
      if (key.startsWith(`${sessionId}:`)) {
        disabled.push(failure);
      }
    }
    return disabled;
  }

  /**
   * Reset failure state for a session
   * @param {string} sessionId - Session identifier
   */
  resetSession(sessionId) {
    const keysToDelete = [];
    
    for (const key of this.failedServers.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of this.retryAttempts.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.failedServers.delete(key);
      this.retryAttempts.delete(key);
    });
    
    console.log(`🧹 Reset failure state for session ${sessionId}`);
  }

  /**
   * Log server failure with appropriate detail level
   * @private
   */
  logFailure(serverName, error, retryCount) {
    const timestamp = new Date().toISOString();
    
    console.log(`\n[${timestamp}] [FAILURE] Server: ${serverName}`);
    console.log(`  Attempt: ${retryCount + 1}`);
    console.log(`  Error: ${error.message}`);
    
    // Log full error details to debug
    console.debug(`  Stack: ${error.stack}`);
    
    // Emit for external logging
    this.emit('failure', {
      timestamp,
      serverName,
      error: error.message,
      stack: error.stack,
      retryCount
    });
  }

  /**
   * Make error messages human-readable
   * @private
   */
  makeErrorReadable(error) {
    const message = error.message || error.toString();
    
    // Common error patterns
    const patterns = [
      {
        pattern: /ENOENT.*spawn/,
        message: 'Command not found - check if the MCP server is installed'
      },
      {
        pattern: /EACCES/,
        message: 'Permission denied - check file permissions'
      },
      {
        pattern: /ECONNREFUSED/,
        message: 'Connection refused - server may not be running'
      },
      {
        pattern: /timeout/i,
        message: 'Server startup timed out'
      },
      {
        pattern: /port.*already in use/i,
        message: 'Port already in use by another process'
      },
      {
        pattern: /module not found/i,
        message: 'Required module not found - check installation'
      },
      {
        pattern: /authentication.*fail/i,
        message: 'Authentication failed - check your API keys'
      },
      {
        pattern: /api.*key.*invalid/i,
        message: 'Invalid API key - check your configuration'
      }
    ];
    
    for (const { pattern, message: readableMessage } of patterns) {
      if (pattern.test(message)) {
        return readableMessage;
      }
    }
    
    // Return original message if no pattern matches
    return message;
  }

  /**
   * Make process error readable
   * @private
   */
  makeProcessErrorReadable(exitCode, stderr) {
    if (exitCode === 127) {
      return 'Goose command not found - ensure Goose is installed and in PATH';
    }
    
    if (exitCode === 126) {
      return 'Permission denied running Goose - check file permissions';
    }
    
    if (exitCode === 1 && stderr.includes('recipe not found')) {
      return 'Recipe file not found or invalid';
    }
    
    if (exitCode === 1 && stderr.includes('provider')) {
      return 'Invalid provider configuration';
    }
    
    if (stderr && stderr.trim()) {
      return `Process error: ${stderr.trim()}`;
    }
    
    return `Process exited with code ${exitCode}`;
  }

  /**
   * Delay utility
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get failure statistics
   * @returns {Object} Failure stats
   */
  getStats() {
    const totalFailures = this.failedServers.size;
    const totalRetries = Array.from(this.retryAttempts.values()).reduce((sum, count) => sum + count, 0);
    
    return {
      totalFailures,
      totalRetries,
      currentlyDisabled: totalFailures,
      failureRate: totalRetries > 0 ? (totalFailures / totalRetries * 100).toFixed(1) + '%' : '0%'
    };
  }
}

module.exports = new FailureHandler();