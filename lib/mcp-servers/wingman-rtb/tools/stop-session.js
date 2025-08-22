/**
 * Stop Session tool for Wingman RTB MCP server
 * Stops the current wingman session
 */

const SessionHelper = require('../utils/session-helper');

class StopSessionTool {
  constructor() {
    this.sessionHelper = new SessionHelper();
    this.name = 'stop_session';
    this.description = 'Stop the current wingman session';
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
          session_id: {
            type: 'string',
            description: 'Specific session to stop (defaults to current active session)'
          },
          force: {
            type: 'boolean',
            description: 'Force stop even if session is active',
            default: false
          },
          save_before_stop: {
            type: 'boolean',
            description: 'Save session data before stopping',
            default: false
          },
          save_format: {
            type: 'string',
            description: 'Format for saving session data before stop',
            enum: ['json', 'txt', 'md'],
            default: 'json'
          },
          reason: {
            type: 'string',
            description: 'Reason for stopping the session (for logging)',
            maxLength: 500
          }
        },
        required: []
      }
    };
  }

  /**
   * Execute the stop session tool
   * @param {Object} args - Tool arguments
   * @returns {Object} Execution result
   */
  async execute(args) {
    const startTime = Date.now();
    
    try {
      // Get current session info
      const currentSession = await this.sessionHelper.getCurrentSession();
      
      if (!currentSession && !args.session_id) {
        return {
          success: false,
          error: 'No active session found to stop',
          code: 'NO_ACTIVE_SESSION',
          timestamp: new Date().toISOString()
        };
      }

      const targetSessionId = args.session_id || currentSession?.sessionId;
      const sessionName = currentSession?.metadata?.sessionName || targetSessionId;

      // Log the stop attempt
      console.error(`[RTB] Attempting to stop session: ${targetSessionId} (${sessionName})`);
      if (args.reason) {
        console.error(`[RTB] Stop reason: ${args.reason}`);
      }

      // Save session data before stopping if requested
      let saveResult = null;
      if (args.save_before_stop && currentSession) {
        try {
          const SaveToFileTool = require('./save-to-file');
          const saveToFile = new SaveToFileTool();
          
          saveResult = await saveToFile.execute({
            format: args.save_format || 'json',
            include_metadata: true,
            include_stats: true,
            include_conversation: false,
            filename: `session-${targetSessionId.substring(0, 8)}-final.${args.save_format || 'json'}`
          });
          
          if (saveResult.success) {
            console.error(`[RTB] Session data saved before stop: ${saveResult.file_path}`);
          } else {
            console.warn(`[RTB] Failed to save session data before stop:`, saveResult.error);
          }
        } catch (saveError) {
          console.warn(`[RTB] Error saving session data before stop:`, saveError.message);
          saveResult = {
            success: false,
            error: saveError.message
          };
        }
      }

      // Get session stats before stopping
      const sessionStats = currentSession ? {
        messageCount: currentSession.stats?.messageCount || 0,
        sessionDuration: currentSession.stats?.sessionDuration || 0,
        toolUsage: currentSession.stats?.toolUsage || {},
        errorRate: currentSession.stats?.errorRate || 0
      } : null;

      // Stop the session
      const stopResult = await this.sessionHelper.stopSession(targetSessionId, args.force);

      const duration = Date.now() - startTime;

      // Log successful stop
      console.error(`[RTB] Session stopped successfully: ${targetSessionId}`);

      return {
        success: true,
        session_id: targetSessionId,
        session_name: sessionName,
        was_active: currentSession !== null,
        forced: args.force || false,
        reason: args.reason || null,
        session_stats: sessionStats,
        save_result: saveResult,
        stop_result: stopResult,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error(`[RTB] Failed to stop session:`, error);

      return {
        success: false,
        error: error.message,
        code: 'SESSION_STOP_FAILED',
        session_id: args.session_id || 'unknown',
        forced: args.force || false,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get information about the current session without stopping it
   * @returns {Object} Session information
   */
  async getSessionInfo() {
    try {
      const currentSession = await this.sessionHelper.getCurrentSession();
      
      if (!currentSession) {
        return {
          success: false,
          message: 'No active session found',
          active_session: null
        };
      }

      return {
        success: true,
        active_session: {
          session_id: currentSession.sessionId,
          session_name: currentSession.metadata?.sessionName || 'Unnamed',
          created_at: currentSession.metadata?.createdAt || null,
          provider: currentSession.metadata?.provider || 'Unknown',
          model: currentSession.metadata?.model || 'Unknown',
          message_count: currentSession.stats?.messageCount || 0,
          duration_ms: currentSession.stats?.sessionDuration || 0,
          tool_usage: currentSession.stats?.toolUsage || {},
          working_directory: currentSession.stats?.workingDirectory || null
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: 'SESSION_INFO_FAILED'
      };
    }
  }

  /**
   * Gracefully stop session with cleanup
   * @param {Object} args - Stop arguments
   * @returns {Object} Stop result with cleanup info
   */
  async gracefulStop(args = {}) {
    const steps = [];
    const errors = [];

    try {
      // Step 1: Get session info
      steps.push('get_session_info');
      const sessionInfo = await this.getSessionInfo();
      
      if (!sessionInfo.success) {
        return {
          success: false,
          error: 'No active session to stop gracefully',
          steps_completed: steps,
          errors: errors
        };
      }

      // Step 2: Save session data if requested
      if (args.save_before_stop !== false) {
        steps.push('save_session_data');
        try {
          const SaveToFileTool = require('./save-to-file');
          const saveToFile = new SaveToFileTool();
          
          const saveResult = await saveToFile.execute({
            format: args.save_format || 'json',
            include_metadata: true,
            include_stats: true,
            include_conversation: false
          });
          
          if (!saveResult.success) {
            errors.push(`Failed to save session data: ${saveResult.error}`);
          }
        } catch (saveError) {
          errors.push(`Save error: ${saveError.message}`);
        }
      }

      // Step 3: Stop the session
      steps.push('stop_session');
      const stopResult = await this.execute({
        ...args,
        save_before_stop: false // Already handled above
      });

      return {
        success: stopResult.success,
        session_info: sessionInfo.active_session,
        stop_result: stopResult,
        steps_completed: steps,
        errors: errors,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      errors.push(`Graceful stop error: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        steps_completed: steps,
        errors: errors,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get tool usage examples
   * @returns {Array} Array of usage examples
   */
  getExamples() {
    return [
      {
        description: 'Basic session stop',
        input: {
          reason: 'Task completed successfully'
        }
      },
      {
        description: 'Force stop active session',
        input: {
          force: true,
          reason: 'Emergency stop requested'
        }
      },
      {
        description: 'Stop with data save',
        input: {
          save_before_stop: true,
          save_format: 'json',
          reason: 'Scheduled task completion'
        }
      },
      {
        description: 'Stop specific session',
        input: {
          session_id: '1234567890abcdef',
          reason: 'Manual intervention required'
        }
      },
      {
        description: 'Graceful stop with markdown export',
        input: {
          save_before_stop: true,
          save_format: 'md',
          reason: 'Normal task completion'
        }
      }
    ];
  }

  /**
   * Get session stop statistics (for monitoring)
   * @returns {Object} Stop statistics
   */
  getStopStatistics() {
    // This could be enhanced to track stop statistics over time
    return {
      total_stops: 0, // Would be tracked in a persistent store
      force_stops: 0,
      graceful_stops: 0,
      stops_with_save: 0,
      last_stop: null,
      average_session_duration: 0
    };
  }
}

module.exports = StopSessionTool;