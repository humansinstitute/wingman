/**
 * Save to File tool for Wingman RTB MCP server
 * Saves session data to local filesystem with path validation
 */

const fs = require('fs').promises;
const path = require('path');
const SecurityValidator = require('../utils/security');
const SessionHelper = require('../utils/session-helper');

class SaveToFileTool {
  constructor() {
    this.security = new SecurityValidator();
    this.sessionHelper = new SessionHelper();
    this.name = 'save_to_file';
    this.description = 'Save session data to local filesystem in wingman directory';
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
          filename: {
            type: 'string',
            description: 'Custom filename (auto-generated if not provided)',
            pattern: '^[a-zA-Z0-9._-]+$'
          },
          format: {
            type: 'string',
            description: 'Output format',
            enum: ['json', 'txt', 'md'],
            default: 'json'
          },
          include_metadata: {
            type: 'boolean',
            description: 'Include session metadata',
            default: true
          },
          include_conversation: {
            type: 'boolean',
            description: 'Include conversation history',
            default: false
          },
          include_stats: {
            type: 'boolean',
            description: 'Include session statistics',
            default: true
          },
          directory: {
            type: 'string',
            description: 'Custom subdirectory within output folder',
            pattern: '^[a-zA-Z0-9._-]+$'
          },
          overwrite: {
            type: 'boolean',
            description: 'Overwrite existing file if it exists',
            default: false
          }
        },
        required: []
      }
    };
  }

  /**
   * Execute the save to file tool
   * @param {Object} args - Tool arguments
   * @returns {Object} Execution result
   */
  async execute(args) {
    const startTime = Date.now();
    
    try {
      // Get current session info for filename generation
      const currentSession = await this.sessionHelper.getCurrentSession();
      if (!currentSession) {
        throw new Error('No active session found');
      }

      // Determine output format
      const format = args.format || 'json';
      
      // Generate filename if not provided
      const filename = args.filename || 
        this.sessionHelper.generateFilename(currentSession.sessionId, format);

      // Validate filename
      if (!this.isValidFilename(filename)) {
        throw new Error('Invalid filename - only alphanumeric characters, dots, hyphens, and underscores allowed');
      }

      // Determine output directory
      const baseOutputDir = this.sessionHelper.getOutputDirectory();
      const outputDir = args.directory ? 
        path.join(baseOutputDir, args.directory) : 
        baseOutputDir;

      // Security validation for path
      const projectRoot = path.resolve(__dirname, '../../../..');
      const pathValidation = this.security.validateFilePath(
        path.join(outputDir, filename),
        path.join(projectRoot, 'temp')
      );

      if (!pathValidation.success) {
        return {
          success: false,
          error: pathValidation.error,
          code: pathValidation.code,
          details: {
            path: path.join(outputDir, filename),
            base_dir: path.join(__dirname, '../../../temp')
          }
        };
      }

      // Ensure output directory exists
      await this.sessionHelper.ensureDirectoryExists(outputDir);

      // Check if file exists and handle overwrite
      const fullPath = path.join(outputDir, filename);
      const fileExists = await this.fileExists(fullPath);
      
      if (fileExists && !args.overwrite) {
        return {
          success: false,
          error: 'File already exists and overwrite is disabled',
          code: 'FILE_EXISTS',
          file_path: fullPath
        };
      }

      // Extract session data
      const sessionData = await this.extractSessionData(args);

      // Format data according to specified format
      const formattedData = this.sessionHelper.formatData(sessionData, format);

      // Write file
      await fs.writeFile(fullPath, formattedData, 'utf8');

      // Get file stats
      const stats = await fs.stat(fullPath);

      const duration = Date.now() - startTime;

      // Log successful file save
      console.error(`[RTB] Session data saved to: ${fullPath}`);

      return {
        success: true,
        file_path: fullPath,
        filename: filename,
        format: format,
        size_bytes: stats.size,
        created_at: stats.birthtime.toISOString(),
        session_id: currentSession.sessionId,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`[RTB] Failed to save session data:`, error);

      return {
        success: false,
        error: error.message,
        code: 'FILE_SAVE_FAILED',
        duration_ms: duration,
        timestamp: new Date().toISOString()
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
      includeMetadata: args.include_metadata !== false,
      includeConversation: args.include_conversation === true,
      includeStats: args.include_stats !== false,
      format: 'object' // Keep as object for formatting
    };

    return await this.sessionHelper.extractSessionData(options);
  }

  /**
   * Check if filename is valid (security check)
   * @param {string} filename - Filename to validate
   * @returns {boolean} True if valid
   */
  isValidFilename(filename) {
    // Only allow alphanumeric characters, dots, hyphens, and underscores
    const validPattern = /^[a-zA-Z0-9._-]+$/;
    
    // Check pattern
    if (!validPattern.test(filename)) {
      return false;
    }

    // Check for reserved names (Windows)
    const reservedNames = [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];
    
    const nameWithoutExt = path.parse(filename).name.toUpperCase();
    if (reservedNames.includes(nameWithoutExt)) {
      return false;
    }

    // Check length
    if (filename.length > 255) {
      return false;
    }

    return true;
  }

  /**
   * Check if file exists
   * @param {string} filePath - Path to check
   * @returns {boolean} True if file exists
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
   * Get available output formats with descriptions
   * @returns {Object} Format descriptions
   */
  getAvailableFormats() {
    return {
      json: {
        description: 'JSON format with full data structure',
        extension: '.json',
        content_type: 'application/json'
      },
      txt: {
        description: 'Plain text format, human-readable',
        extension: '.txt',
        content_type: 'text/plain'
      },
      md: {
        description: 'Markdown format with structured sections',
        extension: '.md',
        content_type: 'text/markdown'
      }
    };
  }

  /**
   * Get tool usage examples
   * @returns {Array} Array of usage examples
   */
  getExamples() {
    return [
      {
        description: 'Basic save with auto-generated filename',
        input: {
          format: 'json',
          include_metadata: true,
          include_stats: true
        }
      },
      {
        description: 'Save with conversation history in markdown format',
        input: {
          filename: 'session-complete.md',
          format: 'md',
          include_conversation: true,
          include_metadata: true
        }
      },
      {
        description: 'Save to custom subdirectory',
        input: {
          filename: 'session-summary.txt',
          format: 'txt',
          directory: 'completed-sessions',
          overwrite: true
        }
      },
      {
        description: 'Minimal data export',
        input: {
          format: 'json',
          include_metadata: false,
          include_stats: false,
          include_conversation: false
        }
      }
    ];
  }

  /**
   * Clean up old files in output directory
   * @param {number} maxAgeMs - Maximum age in milliseconds
   * @returns {Object} Cleanup result
   */
  async cleanupOldFiles(maxAgeMs = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    try {
      const outputDir = this.sessionHelper.getOutputDirectory();
      const files = await fs.readdir(outputDir);
      
      let deletedCount = 0;
      let errorCount = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(outputDir, file);
          const stats = await fs.stat(filePath);
          
          if (Date.now() - stats.mtime.getTime() > maxAgeMs) {
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch (error) {
          errorCount++;
          console.warn(`Failed to process file ${file}:`, error.message);
        }
      }
      
      return {
        success: true,
        deleted_count: deletedCount,
        error_count: errorCount,
        max_age_ms: maxAgeMs
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: 'CLEANUP_FAILED'
      };
    }
  }
}

module.exports = SaveToFileTool;