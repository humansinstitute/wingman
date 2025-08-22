/**
 * Session helper utilities for Wingman RTB MCP server
 * Handles session data extraction and management
 */

const path = require('path');
const fs = require('fs').promises;

class SessionHelper {
  constructor() {
    // Import the MultiSessionManager from the main project
    try {
      const projectRoot = path.resolve(__dirname, '../../../..');
      this.multiSessionManager = require(path.join(projectRoot, 'multi-session-manager'));
    } catch (error) {
      console.error('Failed to load MultiSessionManager:', error);
      this.multiSessionManager = null;
    }
  }

  /**
   * Get current active session information
   * @returns {Object|null} Session information or null if no active session
   */
  async getCurrentSession() {
    // Use environment variables passed from Wingman session
    const sessionId = process.env.WINGMAN_SESSION_ID;
    const sessionName = process.env.WINGMAN_SESSION_NAME;
    const workingDir = process.env.WINGMAN_WORKING_DIR;

    if (!sessionId) {
      return null;
    }

    return {
      sessionId,
      sessionName: sessionName || sessionId,
      workingDirectory: workingDir,
      isActive: true,
      status: 'running',
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Extract session data for export
   * @param {Object} options - Export options
   * @returns {Object} Formatted session data
   */
  async extractSessionData(options = {}) {
    const {
      includeMetadata = true,
      includeConversation = false,
      includeStats = true,
      format = 'json'
    } = options;

    const currentSession = await this.getCurrentSession();
    if (!currentSession) {
      throw new Error('No active session found');
    }

    const data = {
      sessionId: currentSession.sessionId,
      timestamp: new Date().toISOString(),
      extractedBy: 'wingman-rtb'
    };

    if (includeMetadata && currentSession.metadata) {
      data.metadata = {
        sessionName: currentSession.metadata.sessionName,
        createdAt: currentSession.metadata.createdAt,
        provider: currentSession.metadata.provider,
        model: currentSession.metadata.model,
        extensions: currentSession.metadata.extensions || [],
        workingDirectory: currentSession.metadata.workingDirectory
      };
    }

    if (includeStats && currentSession.stats) {
      data.stats = {
        messageCount: currentSession.stats.messageCount,
        sessionDuration: currentSession.stats.sessionDuration,
        toolUsage: currentSession.stats.toolUsage,
        errorRate: currentSession.stats.errorRate,
        workingDirectory: currentSession.stats.workingDirectory
      };
    }

    if (includeConversation) {
      try {
        // Get conversation history from cache if available
        const conversationCache = this.multiSessionManager.conversationCache;
        if (conversationCache && conversationCache.has(currentSession.sessionId)) {
          data.conversation = conversationCache.get(currentSession.sessionId);
        } else {
          data.conversation = [];
          console.warn('No conversation history available in cache');
        }
      } catch (error) {
        console.warn('Failed to extract conversation history:', error);
        data.conversation = [];
      }
    }

    return this.formatData(data, format);
  }

  /**
   * Format data according to specified format
   * @param {Object} data - Data to format
   * @param {string} format - Output format (json, txt, md)
   * @returns {string} Formatted data
   */
  formatData(data, format) {
    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(data, null, 2);
      
      case 'txt':
        return this.formatAsText(data);
      
      case 'md':
      case 'markdown':
        return this.formatAsMarkdown(data);
      
      case 'object':
        return data; // Return raw object for further processing
      
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Format data as plain text
   * @param {Object} data - Data to format
   * @returns {string} Text-formatted data
   */
  formatAsText(data) {
    let output = [];
    
    output.push(`Wingman Session Export`);
    output.push(`========================`);
    output.push(`Session ID: ${data.sessionId}`);
    output.push(`Exported: ${data.timestamp}`);
    output.push('');

    if (data.metadata) {
      output.push(`Session Details:`);
      output.push(`  Name: ${data.metadata.sessionName || 'Unnamed'}`);
      output.push(`  Created: ${data.metadata.createdAt || 'Unknown'}`);
      output.push(`  Provider: ${data.metadata.provider || 'Unknown'}`);
      output.push(`  Model: ${data.metadata.model || 'Unknown'}`);
      output.push(`  Working Directory: ${data.metadata.workingDirectory || 'Unknown'}`);
      output.push('');
    }

    if (data.stats) {
      output.push(`Session Statistics:`);
      output.push(`  Messages: ${data.stats.messageCount || 0}`);
      output.push(`  Duration: ${Math.round((data.stats.sessionDuration || 0) / 1000)}s`);
      output.push(`  Error Rate: ${(data.stats.errorRate || 0).toFixed(2)}`);
      
      if (data.stats.toolUsage && Object.keys(data.stats.toolUsage).length > 0) {
        output.push(`  Tool Usage:`);
        Object.entries(data.stats.toolUsage).forEach(([tool, count]) => {
          output.push(`    ${tool}: ${count}`);
        });
      }
      output.push('');
    }

    if (data.conversation && data.conversation.length > 0) {
      output.push(`Conversation History:`);
      output.push(`---------------------`);
      data.conversation.forEach((msg, index) => {
        output.push(`[${index + 1}] ${msg.role || 'unknown'}: ${msg.content || ''}`);
      });
    }

    return output.join('\n');
  }

  /**
   * Format data as Markdown
   * @param {Object} data - Data to format
   * @returns {string} Markdown-formatted data
   */
  formatAsMarkdown(data) {
    let output = [];
    
    output.push(`# Wingman Session Export`);
    output.push('');
    output.push(`**Session ID:** ${data.sessionId}`);
    output.push(`**Exported:** ${data.timestamp}`);
    output.push('');

    if (data.metadata) {
      output.push(`## Session Details`);
      output.push('');
      output.push(`- **Name:** ${data.metadata.sessionName || 'Unnamed'}`);
      output.push(`- **Created:** ${data.metadata.createdAt || 'Unknown'}`);
      output.push(`- **Provider:** ${data.metadata.provider || 'Unknown'}`);
      output.push(`- **Model:** ${data.metadata.model || 'Unknown'}`);
      output.push(`- **Working Directory:** ${data.metadata.workingDirectory || 'Unknown'}`);
      output.push('');
    }

    if (data.stats) {
      output.push(`## Session Statistics`);
      output.push('');
      output.push(`- **Messages:** ${data.stats.messageCount || 0}`);
      output.push(`- **Duration:** ${Math.round((data.stats.sessionDuration || 0) / 1000)}s`);
      output.push(`- **Error Rate:** ${(data.stats.errorRate || 0).toFixed(2)}`);
      
      if (data.stats.toolUsage && Object.keys(data.stats.toolUsage).length > 0) {
        output.push(`- **Tool Usage:**`);
        Object.entries(data.stats.toolUsage).forEach(([tool, count]) => {
          output.push(`  - ${tool}: ${count}`);
        });
      }
      output.push('');
    }

    if (data.conversation && data.conversation.length > 0) {
      output.push(`## Conversation History`);
      output.push('');
      data.conversation.forEach((msg, index) => {
        output.push(`### Message ${index + 1}`);
        output.push(`**Role:** ${msg.role || 'unknown'}`);
        output.push('');
        output.push(msg.content || '');
        output.push('');
      });
    }

    return output.join('\n');
  }

  /**
   * Generate a unique filename for session export
   * @param {string} sessionId - Session ID
   * @param {string} format - File format
   * @returns {string} Generated filename
   */
  generateFilename(sessionId, format = 'json') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const shortSessionId = sessionId.substring(0, 8);
    return `wingman-session-${shortSessionId}-${timestamp}.${format}`;
  }

  /**
   * Get the output directory for session files
   * @returns {string} Output directory path
   */
  getOutputDirectory() {
    // Use the same temp/output structure as the triggers API
    const projectRoot = path.resolve(__dirname, '../../../..');
    const baseDir = path.join(projectRoot, 'temp/output');
    const timestamp = new Date().toISOString().split('T')[0];
    return path.join(baseDir, timestamp);
  }

  /**
   * Ensure output directory exists
   * @param {string} dirPath - Directory path to create
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Stop the current session
   * @param {string} sessionId - Session ID to stop (optional, defaults to current)
   * @param {boolean} force - Force stop the session
   * @returns {Object} Stop result
   */
  async stopSession(sessionId = null, force = false) {
    if (!this.multiSessionManager) {
      throw new Error('MultiSessionManager not available');
    }

    const targetSessionId = sessionId || this.multiSessionManager.activeSessionId;
    
    if (!targetSessionId) {
      throw new Error('No session to stop');
    }

    try {
      if (force) {
        return await this.multiSessionManager.forceStopActiveSession();
      } else {
        return await this.multiSessionManager.stopSession(targetSessionId);
      }
    } catch (error) {
      throw new Error(`Failed to stop session ${targetSessionId}: ${error.message}`);
    }
  }
}

module.exports = SessionHelper;