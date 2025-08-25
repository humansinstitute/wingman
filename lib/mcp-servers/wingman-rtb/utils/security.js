/**
 * Security utilities for Wingman RTB MCP server
 * Handles domain whitelisting and URL validation
 */

const { URL } = require('url');

class SecurityValidator {
  constructor() {
    this.whitelistPatterns = this.loadWhitelistPatterns();
  }

  /**
   * Load whitelist patterns from environment variable
   * @returns {string[]} Array of whitelist patterns
   */
  loadWhitelistPatterns() {
    const whitelistEnv = process.env.WINGMAN_RTB_WEBHOOK_WHITELIST;
    
    if (!whitelistEnv || whitelistEnv.trim() === '') {
      console.warn('WINGMAN_RTB_WEBHOOK_WHITELIST not set - all webhooks will be blocked');
      return [];
    }

    return whitelistEnv
      .split(',')
      .map(pattern => pattern.trim())
      .filter(pattern => pattern.length > 0);
  }

  /**
   * Validate if a webhook URL is allowed based on whitelist patterns
   * @param {string} webhookUrl - The webhook URL to validate
   * @returns {Object} Validation result with success status and details
   */
  validateWebhookUrl(webhookUrl) {
    try {
      // Parse URL to extract domain and port
      const url = new URL(webhookUrl);
      const domain = url.hostname;
      const port = url.port;
      const fullHost = port ? `${domain}:${port}` : domain;

      // If no whitelist patterns, block all
      if (this.whitelistPatterns.length === 0) {
        return {
          success: false,
          error: 'No webhook domains whitelisted',
          code: 'NO_WHITELIST_CONFIGURED',
          domain: fullHost,
          patterns: []
        };
      }

      // Check if domain matches any whitelist pattern
      const isAllowed = this.isAllowedDomain(fullHost, this.whitelistPatterns);

      if (isAllowed) {
        return {
          success: true,
          domain: fullHost,
          matchedPattern: this.getMatchingPattern(fullHost, this.whitelistPatterns)
        };
      } else {
        return {
          success: false,
          error: 'Webhook URL blocked by security policy',
          code: 'DOMAIN_NOT_WHITELISTED',
          domain: fullHost,
          patterns: this.whitelistPatterns
        };
      }

    } catch (error) {
      return {
        success: false,
        error: 'Invalid webhook URL format',
        code: 'INVALID_URL',
        details: error.message
      };
    }
  }

  /**
   * Check if a domain matches any of the whitelist patterns
   * @param {string} domain - Domain to check (with optional port)
   * @param {string[]} patterns - Array of whitelist patterns
   * @returns {boolean} True if domain is allowed
   */
  isAllowedDomain(domain, patterns) {
    return patterns.some(pattern => this.matchesPattern(domain, pattern));
  }

  /**
   * Get the first matching pattern for a domain
   * @param {string} domain - Domain to check
   * @param {string[]} patterns - Array of whitelist patterns
   * @returns {string|null} Matching pattern or null
   */
  getMatchingPattern(domain, patterns) {
    return patterns.find(pattern => this.matchesPattern(domain, pattern)) || null;
  }

  /**
   * Check if a domain matches a specific pattern
   * Supports wildcards (*) and port specifications
   * @param {string} domain - Domain to check
   * @param {string} pattern - Pattern to match against
   * @returns {boolean} True if domain matches pattern
   */
  matchesPattern(domain, pattern) {
    // Handle exact matches first
    if (domain === pattern) {
      return true;
    }

    // Convert pattern to regex
    // Escape special regex characters except *
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`, 'i'); // Case insensitive
    return regex.test(domain);
  }

  /**
   * Validate file path to prevent directory traversal attacks
   * @param {string} filePath - File path to validate
   * @param {string} baseDir - Base directory that file must be within
   * @returns {Object} Validation result
   */
  validateFilePath(filePath, baseDir) {
    const path = require('path');
    
    try {
      // Resolve the absolute path
      const resolvedPath = path.resolve(filePath);
      const resolvedBaseDir = path.resolve(baseDir);

      // Check if the file path is within the base directory
      const isWithinBase = resolvedPath.startsWith(resolvedBaseDir);

      if (!isWithinBase) {
        return {
          success: false,
          error: 'File path outside allowed directory',
          code: 'PATH_TRAVERSAL_BLOCKED',
          path: filePath,
          baseDir
        };
      }

      // Check for suspicious path components
      const suspiciousPatterns = ['..', '~', '/etc/', '/proc/', '/sys/'];
      const hasSuspiciousPattern = suspiciousPatterns.some(pattern => 
        filePath.includes(pattern)
      );

      if (hasSuspiciousPattern) {
        return {
          success: false,
          error: 'Suspicious file path detected',
          code: 'SUSPICIOUS_PATH',
          path: filePath
        };
      }

      return {
        success: true,
        resolvedPath,
        baseDir: resolvedBaseDir
      };

    } catch (error) {
      return {
        success: false,
        error: 'Invalid file path',
        code: 'INVALID_PATH',
        details: error.message
      };
    }
  }

  /**
   * Log security events for audit purposes
   * @param {string} event - Event type (webhook_blocked, webhook_allowed, etc.)
   * @param {Object} details - Event details
   */
  logSecurityEvent(event, details) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      event,
      ...details
    };

    console.error(`[SECURITY] ${timestamp} - ${event}:`, JSON.stringify(details, null, 2));
  }

  /**
   * Get current security configuration
   * @returns {Object} Current security settings
   */
  getSecurityConfig() {
    return {
      whitelistPatterns: this.whitelistPatterns,
      maxPayloadSize: process.env.WINGMAN_RTB_MAX_PAYLOAD_SIZE || 10485760, // 10MB
      timeout: process.env.WINGMAN_RTB_TIMEOUT || 30000, // 30s
      whitelistConfigured: this.whitelistPatterns.length > 0
    };
  }
}

module.exports = SecurityValidator;