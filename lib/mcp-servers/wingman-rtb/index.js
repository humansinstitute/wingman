#!/usr/bin/env node

/**
 * Wingman RTB (Return to Base) MCP Server
 * Provides session completion tools with security controls
 */

const PostWebhookTool = require('./tools/post-webhook');
const SendWebhookTool = require('./tools/send-webhook');
const SaveToFileTool = require('./tools/save-to-file');
const StopSessionTool = require('./tools/stop-session');
const ExtractContentTool = require('./tools/extract-content');
const SecurityValidator = require('./utils/security');

class WingmanRTBServer {
  constructor() {
    this.name = 'wingman-rtb';
    this.version = '1.0.0';
    this.description = 'Return to Base - Session completion tools with security controls';
    
    // Initialize tools
    this.tools = {
      extract_content: new ExtractContentTool(),
      send_webhook: new SendWebhookTool(),
      post_webhook: new PostWebhookTool(), // Keep legacy tool for compatibility
      save_to_file: new SaveToFileTool(),
      stop_session: new StopSessionTool()
    };

    this.security = new SecurityValidator();
    
    // Bind methods
    this.handleRequest = this.handleRequest.bind(this);
    this.sendResponse = this.sendResponse.bind(this);
    this.sendError = this.sendError.bind(this);
  }

  /**
   * Start the MCP server
   */
  async start() {
    try {
      console.error(`[${this.name}] Starting Wingman RTB MCP Server v${this.version}`);
      
      // Log security configuration
      const securityConfig = this.security.getSecurityConfig();
      console.error(`[${this.name}] Security config:`, {
        whitelistConfigured: securityConfig.whitelistConfigured,
        patterns: securityConfig.whitelistPatterns?.length || 0,
        maxPayloadSize: securityConfig.maxPayloadSize,
        timeout: securityConfig.timeout
      });

      // Set up stdio communication
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', this.handleRequest);
      process.stdin.on('end', () => {
        console.error(`[${this.name}] Input stream ended, shutting down`);
        process.exit(0);
      });

      // Handle process termination
      process.on('SIGTERM', this.handleShutdown.bind(this));
      process.on('SIGINT', this.handleShutdown.bind(this));

      console.error(`[${this.name}] Server ready, waiting for requests...`);
      
    } catch (error) {
      console.error(`[${this.name}] Failed to start server:`, error);
      process.exit(1);
    }
  }

  /**
   * Handle incoming MCP requests
   * @param {string} data - Raw request data
   */
  async handleRequest(data) {
    try {
      const lines = data.trim().split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          const request = JSON.parse(line);
          await this.processRequest(request);
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error handling request:`, error);
      this.sendError(null, 'PARSE_ERROR', 'Failed to parse request', error.message);
    }
  }

  /**
   * Process a single MCP request
   * @param {Object} request - MCP request object
   */
  async processRequest(request) {
    const { id, method, params } = request;

    try {
      let response;

      switch (method) {
        case 'initialize':
          response = await this.handleInitialize(params);
          break;
          
        case 'tools/list':
          response = await this.handleListTools();
          break;
          
        case 'tools/call':
          response = await this.handleCallTool(params);
          break;
          
        case 'ping':
          response = { pong: true };
          break;
          
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      this.sendResponse(id, response);
      
    } catch (error) {
      console.error(`[${this.name}] Error processing request ${method}:`, error);
      this.sendError(id, 'INTERNAL_ERROR', error.message);
    }
  }

  /**
   * Handle initialization request
   * @param {Object} params - Initialize parameters
   * @returns {Object} Initialize response
   */
  async handleInitialize(params) {
    console.error(`[${this.name}] Initializing with client:`, params?.clientInfo?.name || 'unknown');
    
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: this.name,
        version: this.version,
        description: this.description
      }
    };
  }

  /**
   * Handle list tools request
   * @returns {Object} Tools list response
   */
  async handleListTools() {
    const tools = Object.values(this.tools).map(tool => tool.getSchema());
    
    console.error(`[${this.name}] Listing ${tools.length} available tools`);
    
    return {
      tools: tools
    };
  }

  /**
   * Handle call tool request
   * @param {Object} params - Tool call parameters
   * @returns {Object} Tool call response
   */
  async handleCallTool(params) {
    const { name, arguments: args } = params;
    
    console.error(`[${this.name}] Calling tool: ${name}`);
    
    if (!this.tools[name]) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const tool = this.tools[name];
    const result = await tool.execute(args || {});
    
    // Format response according to MCP protocol
    if (result.success) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: result.error,
              code: result.code,
              details: result.details || {}
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Send successful response
   * @param {string|number} id - Request ID
   * @param {Object} result - Response result
   */
  sendResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id: id,
      result: result
    };
    
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /**
   * Send error response
   * @param {string|number} id - Request ID
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {any} data - Additional error data
   */
  sendError(id, code, message, data = null) {
    const response = {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: code,
        message: message,
        data: data
      }
    };
    
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /**
   * Handle server shutdown
   */
  handleShutdown() {
    console.error(`[${this.name}] Shutting down gracefully...`);
    
    // Log shutdown event
    this.security.logSecurityEvent('server_shutdown', {
      server: this.name,
      version: this.version,
      timestamp: new Date().toISOString()
    });
    
    process.exit(0);
  }

  /**
   * Get server health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      server: this.name,
      version: this.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      security: this.security.getSecurityConfig(),
      tools: Object.keys(this.tools),
      timestamp: new Date().toISOString()
    };
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new WingmanRTBServer();
  server.start().catch(error => {
    console.error('Failed to start Wingman RTB server:', error);
    process.exit(1);
  });
}

module.exports = WingmanRTBServer;