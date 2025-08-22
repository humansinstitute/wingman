/**
 * Extract Content tool for Wingman RTB MCP server
 * Extracts structured content from conversation data based on system prompt format
 */

const SecurityValidator = require('../utils/security');
const SessionHelper = require('../utils/session-helper');

class ExtractContentTool {
  constructor() {
    this.security = new SecurityValidator();
    this.sessionHelper = new SessionHelper();
    this.name = 'extract_content';
    this.description = 'Extract structured content from session conversation based on system prompt format';
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
          format_spec: {
            type: 'string',
            description: 'Format specification (e.g., "{sessionName: name, subject: topic, limerick: content}")',
          },
          custom_fields: {
            type: 'object',
            description: 'Custom field definitions to override auto-detection',
            additionalProperties: {
              type: 'string',
              enum: ['sessionName', 'subject', 'limerick', 'text']
            }
          }
        },
        required: []
      }
    };
  }

  /**
   * Execute the content extraction tool
   * @param {Object} args - Tool arguments
   * @returns {Object} Execution result with extracted content
   */
  async execute(args) {
    try {
      // Get session data with conversation
      const sessionData = await this.sessionHelper.extractSessionData({
        includeMetadata: true,
        includeConversation: true,
        includeStats: false,
        format: 'object'
      });

      // Parse the format specification
      const formatSpec = args.format_spec || this.extractFormatFromPrompt(sessionData);
      const requiredFields = this.parseFormatSpec(formatSpec, args.custom_fields);

      // Extract content for each field
      const extractedContent = {};
      for (const [fieldName, fieldType] of Object.entries(requiredFields)) {
        extractedContent[fieldName] = this.extractField(fieldName, fieldType, sessionData);
      }

      console.error(`[RTB] extract_content SUCCESS: ${Object.keys(extractedContent).length} fields extracted`);

      return {
        success: true,
        extracted_content: extractedContent,
        session_id: sessionData.sessionId,
        format_spec: formatSpec,
        fields_extracted: Object.keys(extractedContent),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[RTB] extract_content FAILED: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        code: 'CONTENT_EXTRACTION_FAILED',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Extract format specification from system prompt in conversation
   * @param {Object} sessionData - Session data
   * @returns {string} Format specification
   */
  extractFormatFromPrompt(sessionData) {
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      for (const message of sessionData.conversation) {
        if ((message.role === 'system' || message.role === 'user') && message.content) {
          const content = message.content;
          // Look for format specifications like {key: "description", ...}
          const formatMatch = content.match(/\{[^}]+\}/);
          if (formatMatch) {
            return formatMatch[0];
          }
        }
      }
    }
    return '{}';
  }

  /**
   * Parse format specification string into field mappings
   * @param {string} formatSpec - Format specification
   * @param {Object} customFields - Custom field overrides
   * @returns {Object} Field name to type mappings
   */
  parseFormatSpec(formatSpec, customFields = {}) {
    const fields = {};
    
    // Parse JSON-like format spec
    const fieldMatches = formatSpec.match(/(\w+):\s*"[^"]*"/g) || formatSpec.match(/(\w+):\s*[^,}]+/g);
    if (fieldMatches) {
      fieldMatches.forEach(match => {
        const key = match.split(':')[0].trim();
        
        // Use custom field type if provided, otherwise auto-detect
        let fieldType = customFields[key] || this.detectFieldType(key);
        fields[key] = fieldType;
      });
    }

    return fields;
  }

  /**
   * Auto-detect field type based on field name
   * @param {string} fieldName - Field name
   * @returns {string} Detected field type
   */
  detectFieldType(fieldName) {
    const nameLower = fieldName.toLowerCase();
    
    if (nameLower.includes('session')) return 'sessionName';
    if (nameLower.includes('subject') || nameLower.includes('topic')) return 'subject';
    if (nameLower.includes('limerick') || nameLower.includes('poem')) return 'limerick';
    
    return 'text'; // Default
  }

  /**
   * Extract specific field from session data
   * @param {string} fieldName - Field name
   * @param {string} fieldType - Field type
   * @param {Object} sessionData - Session data
   * @returns {string} Extracted content
   */
  extractField(fieldName, fieldType, sessionData) {
    switch (fieldType) {
      case 'sessionName':
        return sessionData.sessionName || 
               (sessionData.metadata && sessionData.metadata.sessionName) ||
               process.env.WINGMAN_SESSION_NAME || 
               'Unknown Session';
               
      case 'subject':
        return this.extractSubject(sessionData);
        
      case 'limerick':
        return this.extractLimerick(sessionData);
        
      case 'text':
      default:
        return this.extractGenericText(fieldName, sessionData);
    }
  }

  /**
   * Extract subject from conversation
   * @param {Object} sessionData - Session data
   * @returns {string} Extracted subject
   */
  extractSubject(sessionData) {
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      for (const message of sessionData.conversation) {
        if (message.role === 'user' && message.content) {
          const content = message.content;
          
          const subjectPatterns = [
            /(?:write|create|make) (?:a |an )?limerick about (.*?)(?:\.|!|\?|$)/i,
            /limerick about (.*?)(?:\.|!|\?|$)/i,
            /about (.*?)(?:\.|!|\?|$)/i
          ];
          
          for (const pattern of subjectPatterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
              return match[1].trim().replace(/^(a |an |the )/i, '');
            }
          }
        }
      }
    }
    
    return "Unknown subject";
  }

  /**
   * Extract limerick from conversation
   * @param {Object} sessionData - Session data
   * @returns {string} Extracted limerick
   */
  extractLimerick(sessionData) {
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      for (const message of sessionData.conversation) {
        if (message.role === 'assistant' && message.content) {
          const content = message.content;
          
          // Look for "There once was" pattern
          const thereOnceMatch = content.match(/There once was [^\n]+\n[^\n]+\n[^\n]+\n[^\n]+\n[^\n]+[.!?]/i);
          if (thereOnceMatch) {
            return thereOnceMatch[0].trim();
          }
          
          // Look for any 5-line poem structure
          const lines = content.split('\n').filter(l => l.trim().length > 10);
          if (lines.length >= 5) {
            for (let i = 0; i <= lines.length - 5; i++) {
              const fiveLines = lines.slice(i, i + 5);
              if (fiveLines.every(line => /[.!?]$/.test(line.trim()))) {
                return fiveLines.map(l => l.trim()).join('\n');
              }
            }
          }
        }
      }
    }
    
    return "Limerick content not found in session";
  }

  /**
   * Extract generic text content
   * @param {string} fieldName - Field name for context
   * @param {Object} sessionData - Session data
   * @returns {string} Extracted text
   */
  extractGenericText(fieldName, sessionData) {
    if (sessionData.conversation && Array.isArray(sessionData.conversation)) {
      // Return the last assistant message as a fallback
      for (let i = sessionData.conversation.length - 1; i >= 0; i--) {
        const message = sessionData.conversation[i];
        if (message.role === 'assistant' && message.content) {
          return message.content.substring(0, 500); // Truncate long content
        }
      }
    }
    
    return `${fieldName} not found`;
  }
}

module.exports = ExtractContentTool;