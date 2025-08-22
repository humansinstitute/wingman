/**
 * Send Webhook tool for Wingman RTB MCP server
 * Sends structured data to webhooks with security validation
 */

const { spawn } = require('child_process');
const SecurityValidator = require('../utils/security');

class SendWebhookTool {
  constructor() {
    this.security = new SecurityValidator();
    this.name = 'send_webhook';
    this.description = 'Send structured data to webhook with security validation';
  }

  /**
   * Get tool schema for MCP
   * @returns {Object} Tool schema
   */
  getSchema() {
    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: {
          webhook_url: {
            type: 'string',
            description: 'Target webhook URL (must be whitelisted)',
            format: 'uri'
          },
          payload: {
            type: 'object',
            description: 'Data payload to send',
            additionalProperties: true
          },
          headers: {
            type: 'object',
            description: 'Custom HTTP headers to send',
            properties: {
              'Content-Type': {
                type: 'string',
                default: 'application/json'
              }
            },
            additionalProperties: {
              type: 'string'
            }
          },
          timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds',
            default: 30000,
            minimum: 1000,
            maximum: 300000
          }
        },
        required: ['webhook_url', 'payload']
      }
    };
  }

  /**
   * Execute the webhook tool
   * @param {Object} args - Tool arguments
   * @returns {Object} Execution result
   */
  async execute(args) {
    const startTime = Date.now();
    
    try {
      // Validate required arguments
      if (!args.webhook_url) {
        throw new Error('webhook_url is required');
      }
      
      if (!args.payload) {
        throw new Error('payload is required');
      }

      // Security validation
      const securityCheck = this.security.validateWebhookUrl(args.webhook_url);
      if (!securityCheck.success) {
        this.security.logSecurityEvent('webhook_blocked', {
          url: args.webhook_url,
          reason: securityCheck.error,
          code: securityCheck.code,
          patterns: securityCheck.patterns
        });
        
        return {
          success: false,
          error: securityCheck.error,
          code: securityCheck.code,
          details: {
            domain: securityCheck.domain,
            allowed_patterns: securityCheck.patterns || []
          }
        };
      }

      this.security.logSecurityEvent('webhook_allowed', {
        url: args.webhook_url,
        domain: securityCheck.domain,
        matched_pattern: securityCheck.matchedPattern
      });

      // Add webhook metadata to payload
      const enrichedPayload = {
        ...args.payload,
        _webhook_meta: {
          sent_by: 'wingman-rtb',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          session_id: process.env.WINGMAN_SESSION_ID
        }
      };

      // Send webhook using curl subprocess
      const result = await this.sendWebhookCurl(args.webhook_url, enrichedPayload, args);

      const duration = Date.now() - startTime;

      console.error(`[RTB] send_webhook SUCCESS: ${result.status} ${result.statusText}`);
      console.error(`[RTB] Webhook response:`, result.data);

      return {
        success: true,
        webhook_url: args.webhook_url,
        response: {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          data: result.data
        },
        payload_size: JSON.stringify(enrichedPayload).length,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`[RTB] send_webhook FAILED: ${error.message}`);
      console.error(`[RTB] Error details:`, {
        name: error.name,
        code: error.code,
        errno: error.errno
      });
      
      this.security.logSecurityEvent('webhook_error', {
        url: args.webhook_url,
        error: error.message,
        duration_ms: duration
      });

      return {
        success: false,
        error: error.message,
        code: 'WEBHOOK_SEND_FAILED',
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Send webhook request using curl subprocess
   * @param {string} url - Webhook URL
   * @param {Object} payload - Payload to send
   * @param {Object} args - Tool arguments
   * @returns {Object} HTTP response
   */
  async sendWebhookCurl(url, payload, args) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      console.error(`[RTB] Using curl for webhook: ${url}`);
      console.error(`[RTB] Payload size: ${data.length} bytes`);

      const curlArgs = [
        '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-H', `User-Agent: Wingman-RTB/1.0.0`,
        '-d', data,
        '--max-time', String(Math.floor((args.timeout || 30000) / 1000)),
        '--silent',
        '--write-out', '%{http_code}|%{time_total}',
        '--show-error',
        url
      ];

      // Add custom headers if provided
      if (args.headers) {
        Object.entries(args.headers).forEach(([key, value]) => {
          curlArgs.push('-H', `${key}: ${value}`);
        });
      }

      const curl = spawn('curl', curlArgs);
      let stdout = '';
      let stderr = '';

      curl.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      curl.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      curl.on('close', (code) => {
        if (code === 0) {
          // Parse curl output: response_body + http_code|time_total
          const parts = stdout.split('|');
          if (parts.length >= 2) {
            const timeTotal = parts.pop();
            const httpCode = parseInt(parts.pop());
            const responseBody = parts.join('|');

            console.error(`[RTB] curl SUCCESS: HTTP ${httpCode} (${timeTotal}s)`);
            
            resolve({
              status: httpCode,
              statusText: httpCode >= 200 && httpCode < 300 ? 'OK' : 'Error',
              headers: {},
              data: responseBody
            });
          } else {
            resolve({
              status: 200,
              statusText: 'OK',
              headers: {},
              data: stdout
            });
          }
        } else {
          console.error(`[RTB] curl FAILED: exit code ${code}`);
          console.error(`[RTB] curl stderr: ${stderr}`);
          reject(new Error(`curl failed with exit code ${code}: ${stderr}`));
        }
      });

      curl.on('error', (error) => {
        console.error(`[RTB] curl spawn error:`, error);
        reject(error);
      });
    });
  }
}

module.exports = SendWebhookTool;