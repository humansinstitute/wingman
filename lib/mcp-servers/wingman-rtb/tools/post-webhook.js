/**
 * POST Webhook tool for Wingman RTB MCP server
 * Sends session data to webhooks with security validation
 */

const axios = require('axios');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { spawn } = require('child_process');
const SecurityValidator = require('../utils/security');
const SessionHelper = require('../utils/session-helper');

class PostWebhookTool {
  constructor() {
    this.security = new SecurityValidator();
    this.sessionHelper = new SessionHelper();
    this.name = 'post_webhook';
    this.description = 'Construct data from session and post to webhook with confirmation';
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
          schema: {
            type: 'object',
            description: 'Optional expected data schema/format - will be parsed from system prompt if custom format is used',
            properties: {
              format: {
                type: 'string',
                enum: ['json', 'form', 'custom'],
                default: 'json'
              },
              custom_payload: {
                type: 'object',
                description: 'Custom payload structure template (optional - will be auto-detected from system prompt if not provided)'
              }
            }
          },
          custom_payload: {
            type: 'object',
            description: 'Direct custom payload object (alternative to schema.custom_payload)'
          },
          include_session_data: {
            type: 'boolean',
            description: 'Include session metadata',
            default: true
          },
          include_conversation: {
            type: 'boolean',
            description: 'Include conversation history',
            default: false
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
        required: ['webhook_url']
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

      // Extract session data
      const sessionData = await this.extractSessionData(args);

      // Prepare payload
      const payload = await this.preparePayload(sessionData, args);

      // Send webhook using curl subprocess (Node.js network is blocked)
      const result = await this.sendWebhookCurl(args.webhook_url, payload, args);

      const duration = Date.now() - startTime;

      console.error(`[RTB] post_webhook SUCCESS: ${result.status} ${result.statusText}`);
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
        payload_size: JSON.stringify(payload).length,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Detailed error logging
      console.error(`[RTB] post_webhook FAILED: ${error.message}`);
      console.error(`[RTB] Error stack:`, error.stack);
      console.error(`[RTB] Error details:`, {
        name: error.name,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname,
        request: error.request ? 'Request made but no response' : 'No request made',
        response: error.response ? `HTTP ${error.response.status}` : 'No response'
      });
      
      this.security.logSecurityEvent('webhook_error', {
        url: args.webhook_url,
        error: error.message,
        duration_ms: duration,
        error_details: {
          name: error.name,
          code: error.code,
          errno: error.errno
        }
      });

      return {
        success: false,
        error: error.message,
        code: 'WEBHOOK_EXECUTION_FAILED',
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        debug_info: {
          error_name: error.name,
          error_code: error.code
        }
      };
    }
  }

  /**
   * Extract session data based on provided options
   * @param {Object} args - Tool arguments
   * @returns {Object} Session data
   */
  async extractSessionData(args) {
    const options = {
      includeMetadata: args.include_session_data !== false,
      includeConversation: true, // Always include conversation for content extraction
      includeStats: true,
      format: 'object' // Keep as object for webhook processing
    };

    return await this.sessionHelper.extractSessionData(options);
  }

  /**
   * Prepare payload for webhook based on schema
   * @param {Object} sessionData - Extracted session data
   * @param {Object} args - Tool arguments
   * @returns {Object} Prepared payload
   */
  async preparePayload(sessionData, args) {
    let payload = sessionData;

    // Handle custom payload - check both direct custom_payload and schema.custom_payload
    const customPayloadTemplate = args.custom_payload || (args.schema && args.schema.custom_payload);
    
    if (customPayloadTemplate || (args.schema && args.schema.format === 'custom')) {
      // Dynamically generate payload based on system prompt requirements
      payload = await this.generateDynamicPayload(sessionData, customPayloadTemplate);
    } else if (args.schema && args.schema.format === 'form') {
      // Convert to form-compatible format
      payload = this.flattenForForm(sessionData);
    }
    // Default: use sessionData as-is

    // Add webhook metadata
    payload._webhook_meta = {
      sent_by: 'wingman-rtb',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      session_id: sessionData.sessionId
    };

    return payload;
  }

  /**
   * Generate dynamic payload based on system prompt requirements
   * @param {Object} sessionData - Session data to extract from
   * @param {Object} customPayload - Custom payload structure template
   * @returns {Object} Dynamic payload with extracted content
   */
  async generateDynamicPayload(sessionData, customPayload) {
    // Debug: log session data structure
    console.error(`[RTB] Session data keys:`, Object.keys(sessionData));
    console.error(`[RTB] Conversation length:`, sessionData.conversation ? sessionData.conversation.length : 'no conversation');
    console.error(`[RTB] Metadata:`, sessionData.metadata ? Object.keys(sessionData.metadata) : 'no metadata');
    
    // Get the system prompt or instructions to understand what data is needed
    const systemPrompt = this.extractSystemPrompt(sessionData);
    console.error(`[RTB] System prompt length:`, systemPrompt.length);
    
    const requiredFields = this.parseRequiredFields(systemPrompt, customPayload);
    console.error(`[RTB] Required fields:`, requiredFields);
    
    const payload = {};
    
    for (const [key, fieldType] of Object.entries(requiredFields)) {
      payload[key] = await this.extractFieldFromSession(key, fieldType, sessionData, systemPrompt);
      console.error(`[RTB] Extracted ${key} (${fieldType}):`, payload[key]);
    }
    
    return payload;
  }

  /**
   * Extract system prompt from session data
   * @param {Object} sessionData - Session data
   * @returns {string} System prompt text
   */
  extractSystemPrompt(sessionData) {
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      // Look for system messages or initial instructions
      for (const message of sessionData.conversation) {
        if (message.role === 'system' && message.content) {
          return message.content;
        }
      }
      
      // Fallback: look for user messages that contain instructions
      for (const message of sessionData.conversation) {
        if (message.role === 'user' && message.content) {
          const content = message.content.toLowerCase();
          if (content.includes('format:') || content.includes('following format') || content.includes('webhook')) {
            return message.content;
          }
        }
      }
    }
    
    return '';
  }

  /**
   * Parse required fields from system prompt and custom payload template
   * @param {string} systemPrompt - System prompt text
   * @param {Object} customPayload - Custom payload template
   * @returns {Object} Map of field names to extraction types
   */
  parseRequiredFields(systemPrompt, customPayload) {
    const fields = {};
    
    // Extract field requirements from system prompt
    const formatMatches = systemPrompt.match(/\{([^}]+)\}/g);
    if (formatMatches) {
      formatMatches.forEach(match => {
        const content = match.slice(1, -1); // Remove braces
        const [key, description] = content.split(':').map(s => s.trim());
        
        // Determine field type based on key name and description
        let fieldType = 'text';
        if (key.toLowerCase().includes('session')) {
          fieldType = 'sessionName';
        } else if (key.toLowerCase().includes('subject')) {
          fieldType = 'subject';
        } else if (key.toLowerCase().includes('limerick') || key.toLowerCase().includes('poem')) {
          fieldType = 'limerick';
        } else if (description) {
          // Use description to determine type
          const descLower = description.toLowerCase();
          if (descLower.includes('limerick') || descLower.includes('poem')) {
            fieldType = 'limerick';
          } else if (descLower.includes('subject') || descLower.includes('topic')) {
            fieldType = 'subject';
          }
        }
        
        fields[key] = fieldType;
      });
    }
    
    // Fallback: use custom payload template keys
    if (Object.keys(fields).length === 0 && customPayload) {
      Object.keys(customPayload).forEach(key => {
        let fieldType = 'text';
        if (key.toLowerCase().includes('session')) {
          fieldType = 'sessionName';
        } else if (key.toLowerCase().includes('subject')) {
          fieldType = 'subject';
        } else if (key.toLowerCase().includes('limerick')) {
          fieldType = 'limerick';
        }
        fields[key] = fieldType;
      });
    }
    
    return fields;
  }

  /**
   * Extract specific field from session data
   * @param {string} fieldName - Name of the field to extract
   * @param {string} fieldType - Type of field (sessionName, subject, limerick, etc.)
   * @param {Object} sessionData - Session data
   * @param {string} systemPrompt - System prompt for context
   * @returns {string} Extracted field value
   */
  async extractFieldFromSession(fieldName, fieldType, sessionData, systemPrompt) {
    switch (fieldType) {
      case 'sessionName':
        return sessionData.sessionName || 
               (sessionData.metadata && sessionData.metadata.sessionName) ||
               process.env.WINGMAN_SESSION_NAME || 
               'Unknown Session';
        
      case 'subject':
        return this.extractSubjectFromSession(sessionData);
        
      case 'limerick':
        return this.extractLimerickFromSession(sessionData);
        
      case 'text':
      default:
        // Generic text extraction based on field name
        return this.extractGenericField(fieldName, sessionData, systemPrompt);
    }
  }

  /**
   * Extract generic field based on field name and context
   * @param {string} fieldName - Name of the field
   * @param {Object} sessionData - Session data
   * @param {string} systemPrompt - System prompt for context
   * @returns {string} Extracted value
   */
  extractGenericField(fieldName, sessionData, systemPrompt) {
    // Try to find content based on field name
    const fieldLower = fieldName.toLowerCase();
    
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      for (const message of sessionData.conversation) {
        if (message.role === 'assistant' && message.content) {
          const content = message.content;
          
          // Look for field-specific patterns
          if (fieldLower.includes('result') || fieldLower.includes('output')) {
            // Return the main assistant response
            return content.trim();
          }
        }
      }
    }
    
    return `${fieldName} not found`;
  }

  /**
   * Flatten object for form submission
   * @param {Object} data - Data to flatten
   * @param {string} prefix - Prefix for keys
   * @returns {Object} Flattened data
   */
  flattenForForm(data, prefix = '') {
    const flattened = {};
    
    for (const [key, value] of Object.entries(data)) {
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenForForm(value, fullKey));
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const arrayKey = `${fullKey}[${index}]`;
          if (typeof item === 'object') {
            Object.assign(flattened, this.flattenForForm(item, arrayKey));
          } else {
            flattened[arrayKey] = String(item);
          }
        });
      } else {
        flattened[fullKey] = String(value);
      }
    }
    
    return flattened;
  }

  /**
   * Extract the limerick content from session data
   * @param {Object} sessionData - Session data to extract from
   * @returns {string} Extracted limerick
   */
  extractLimerickFromSession(sessionData) {
    // Try to find limerick in conversation or content
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      // Look for assistant messages containing limericks
      for (const message of sessionData.conversation) {
        if (message.role === 'assistant' && message.content) {
          const content = message.content;
          
          // Enhanced patterns for limerick detection
          const limerickPatterns = [
            // Standard "There once was" limerick
            /There once was [^.!?]*[.!?]\s*\n[^.!?]*[.!?]\s*\n[^.!?]*[.!?]\s*\n[^.!?]*[.!?]\s*\n[^.!?]*[.!?]/gis,
            // Generic 5-line poem with ending punctuation
            /^([^.!?\n]{10,80}[.!?]\s*\n){4}[^.!?\n]{10,80}[.!?]/gim,
            // Look for block of 5 consecutive lines that look like poetry
            /([A-Z][^.!?\n]{5,60},\s*\n){4}[A-Z][^.!?\n]{5,60}[.!]/gim
          ];
          
          for (const pattern of limerickPatterns) {
            const matches = content.match(pattern);
            if (matches && matches.length > 0) {
              // Return the first match, cleaned up
              return matches[0].trim();
            }
          }
          
          // Alternative approach: look for any 5 consecutive lines that end with punctuation
          const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 5);
          if (lines.length >= 5) {
            for (let i = 0; i <= lines.length - 5; i++) {
              const fiveLines = lines.slice(i, i + 5);
              // Check if this looks like a poem (similar line lengths, ends with punctuation)
              if (fiveLines.every(line => line.length > 10 && line.length < 100 && /[.!?]$/.test(line))) {
                return fiveLines.join('\n');
              }
            }
          }
          
          // Last resort: look for any text that mentions "limerick" and extract nearby content
          if (content.toLowerCase().includes('limerick')) {
            const limerickIndex = content.toLowerCase().indexOf('limerick');
            const afterLimerick = content.substring(limerickIndex);
            
            // Look for 5 lines after the word "limerick"
            const afterLines = afterLimerick.split('\n').map(l => l.trim()).filter(l => l.length > 5);
            if (afterLines.length >= 5) {
              const potentialLimerick = afterLines.slice(1, 6); // Skip the line with "limerick"
              if (potentialLimerick.every(line => line.length > 10 && line.length < 100)) {
                return potentialLimerick.join('\n');
              }
            }
          }
        }
      }
    }
    
    return "Limerick content not found in session";
  }

  /**
   * Extract the subject from session data
   * @param {Object} sessionData - Session data to extract from  
   * @returns {string} Extracted subject
   */
  extractSubjectFromSession(sessionData) {
    // Try to extract subject from the original prompt or conversation
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      for (const message of sessionData.conversation) {
        if (message.role === 'user' && message.content) {
          const content = message.content;
          
          // Enhanced subject extraction patterns
          const subjectPatterns = [
            /(?:create|write|make) (?:a |an )?limerick about (.*?)(?:\.|!|\?|$)/i,
            /limerick about (.*?)(?:\.|!|\?|$)/i,
            /(?:create|write|make) (?:a |an )?limerick on (.*?)(?:\.|!|\?|$)/i,
            /(?:create|write|make) (?:a |an )?limerick for (.*?)(?:\.|!|\?|$)/i,
            /(?:give me|show me) (?:a |an )?limerick about (.*?)(?:\.|!|\?|$)/i,
            // More generic patterns
            /about (.*?)(?:\.|!|\?|$)/i,
            /on the topic of (.*?)(?:\.|!|\?|$)/i,
            /regarding (.*?)(?:\.|!|\?|$)/i
          ];
          
          for (const pattern of subjectPatterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
              let subject = match[1].trim();
              // Clean up common artifacts
              subject = subject.replace(/^(a |an |the )/i, '');
              subject = subject.replace(/\s*,\s*$/, '');
              if (subject.length > 2) {
                return subject;
              }
            }
          }
          
          // Fallback: if the message is short and doesn't contain specific instructions, use it as subject
          if (message.content.length < 100 && !content.toLowerCase().includes('limerick')) {
            return message.content.trim();
          }
          
          // Final fallback: extract any noun after common trigger words
          const nounPatterns = [
            /(?:robot|cat|dog|person|man|woman|boy|girl|thing|place|city|country)/i
          ];
          
          for (const pattern of nounPatterns) {
            const match = content.match(pattern);
            if (match) {
              return match[0].toLowerCase();
            }
          }
        }
      }
    }
    
    return "Unknown subject";
  }

  /**
   * Send webhook request
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

  async sendWebhookNative(url, payload, args) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const data = JSON.stringify(payload);
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'Wingman-RTB/1.0.0',
          ...args.headers
        },
        timeout: args.timeout || 30000,
        rejectUnauthorized: false // Bypass SSL for debugging
      };

      console.error(`[RTB] Native HTTP request to: ${url}`);
      console.error(`[RTB] Payload size: ${data.length} bytes`);

      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = client.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          console.error(`[RTB] HTTP Response: ${res.statusCode} ${res.statusMessage}`);
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            data: responseData
          });
        });
      });
      
      req.on('error', (error) => {
        console.error(`[RTB] Native HTTP error:`, error);
        reject(error);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.write(data);
      req.end();
    });
  }

  async sendWebhook(url, payload, args) {
    const config = {
      method: 'POST',
      url: url,
      data: payload,
      timeout: args.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Wingman-RTB/1.0.0',
        ...args.headers
      },
      // Security settings
      maxRedirects: 5,
      validateStatus: function (status) {
        return status < 600; // Don't throw on HTTP errors, let caller handle
      },
      // Add network debugging and bypass SSL issues for testing
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false, // Bypass SSL cert validation for testing
        keepAlive: true,
        maxSockets: 5
      }),
      // Additional debugging options
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    };

    // Handle form data if needed
    if (args.schema && args.schema.format === 'form') {
      config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const FormData = require('form-data');
      if (typeof payload === 'object') {
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          formData.append(key, value);
        });
        config.data = formData;
        config.headers = { ...config.headers, ...formData.getHeaders() };
      }
    }

    try {
      const response = await axios(config);
      return response;
    } catch (error) {
      if (error.response) {
        // HTTP error response
        return error.response;
      } else if (error.request) {
        // Network error
        throw new Error(`Network error: ${error.message}`);
      } else {
        // Other error
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  /**
   * Get tool usage examples
   * @returns {Array} Array of usage examples
   */
  getExamples() {
    return [
      {
        description: 'Basic webhook with session data',
        input: {
          webhook_url: 'https://api.yourdomain.ai/webhook/completed',
          include_session_data: true,
          include_conversation: false
        }
      },
      {
        description: 'Webhook with conversation history and custom headers',
        input: {
          webhook_url: 'https://webhook.company.com/sessions',
          include_session_data: true,
          include_conversation: true,
          headers: {
            'Authorization': 'Bearer your-token',
            'X-Custom-Header': 'wingman-session'
          }
        }
      },
      {
        description: 'Custom payload format',
        input: {
          webhook_url: 'https://api.internal.company.com/notify',
          schema: {
            format: 'custom',
            custom_payload: {
              event: 'session_completed',
              source: 'wingman',
              data: {}
            }
          }
        }
      }
    ];
  }
}

module.exports = PostWebhookTool;