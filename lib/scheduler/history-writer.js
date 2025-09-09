const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * HistoryWriter class for recording task execution history in JSONL format
 * Records each task execution as a single line of JSON for debugging and monitoring
 */
class HistoryWriter {
  /**
   * Create a new HistoryWriter instance
   * @param {string} historyDir - Optional custom history directory path
   */
  constructor(historyDir = null) {
    this.historyDir = historyDir || path.join(os.homedir(), '.wingman', 'scheduler', 'history');
    this.initialized = false;
  }

  /**
   * Initialize the history directory structure
   * Creates the history directory if it doesn't exist
   * @private
   * @returns {Promise<void>}
   */
  async ensureHistoryDir() {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.historyDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to create history directory at ${this.historyDir}: ${error.message}`);
    }
  }

  /**
   * Record a task execution in JSONL format
   * @param {string} taskId - Task identifier
   * @param {Date} startTime - Task start time
   * @param {Date} endTime - Task end time  
   * @param {string} status - Execution status: "success" or "failure"
   * @param {string} type - Task type: "http" or "command"
   * @param {Object} details - Additional details about the execution
   * @param {number} [details.httpStatus] - HTTP status code (HTTP tasks only)
   * @param {string} [details.errorSummary] - Error description (failures only)
   * @param {string} [details.responseSnippet] - First 500 chars of response
   * @returns {Promise<void>}
   */
  async recordExecution(taskId, startTime, endTime, status, type, details = {}) {
    await this.ensureHistoryDir();

    const elapsed_ms = endTime.getTime() - startTime.getTime();
    
    // Build the JSONL record according to schema
    const record = {
      task_id: taskId,
      start_ts: startTime.toISOString(),
      end_ts: endTime.toISOString(),
      status: status,
      elapsed_ms: elapsed_ms,
      type: type
    };

    // Add HTTP-specific fields
    if (type === 'http' && details.httpStatus !== undefined) {
      record.http_status = details.httpStatus;
    }

    // Add error summary for failures
    if (status === 'failure' && details.errorSummary) {
      record.error_summary = this.truncateString(details.errorSummary, 500);
    }

    // Add response snippet (truncated to 500 chars)
    if (details.responseSnippet) {
      record.response_snippet = this.truncateString(details.responseSnippet, 500);
    }

    // Write the record as a single JSON line
    const jsonLine = JSON.stringify(record) + '\n';
    const filePath = path.join(this.historyDir, `${taskId}.jsonl`);

    try {
      await fs.appendFile(filePath, jsonLine, 'utf8');
    } catch (error) {
      // Log error but don't throw to avoid breaking task execution
      console.error(`[HistoryWriter] Failed to write history for task '${taskId}': ${error.message}`);
    }
  }

  /**
   * Create a wrapper function for HTTP task execution that records history
   * @param {Function} originalExecuteHttpTask - Original HTTP task execution function
   * @param {Object} schedulerService - Reference to the scheduler service instance
   * @returns {Function} Wrapped function that records execution history
   */
  wrapHttpTaskExecution(originalExecuteHttpTask, schedulerService) {
    const historyWriter = this;
    return async function(task) {
      const startTime = new Date();
      let endTime, status, details = {};

      try {
        const result = await originalExecuteHttpTask.call(schedulerService, task);
        
        endTime = new Date();
        status = 'success';
        
        // Try to extract HTTP status from result or assume 200 for success
        if (result && typeof result === 'object') {
          details.responseSnippet = JSON.stringify(result);
          // If the result has status info, use it
          if (result.status) {
            details.httpStatus = result.status;
          } else if (result.statusCode) {
            details.httpStatus = result.statusCode;
          } else {
            details.httpStatus = 200; // Assume success
          }
        } else {
          details.httpStatus = 200;
          if (result) {
            details.responseSnippet = String(result);
          }
        }

        await historyWriter.recordExecution(task.id, startTime, endTime, status, 'http', details);
        return result;

      } catch (error) {
        endTime = new Date();
        status = 'failure';
        
        // Extract HTTP status from axios error
        if (error.response && error.response.status) {
          details.httpStatus = error.response.status;
        }
        
        // Create meaningful error summary
        details.errorSummary = historyWriter.extractErrorSummary(error);
        
        // Include response snippet if available
        if (error.response && error.response.data) {
          try {
            details.responseSnippet = typeof error.response.data === 'object' 
              ? JSON.stringify(error.response.data)
              : String(error.response.data);
          } catch {
            details.responseSnippet = '[Unable to serialize response data]';
          }
        }

        await historyWriter.recordExecution(task.id, startTime, endTime, status, 'http', details);
        throw error;
      }
    };
  }

  /**
   * Create a wrapper function for command task execution that records history
   * @param {Function} originalExecuteCommandTask - Original command task execution function
   * @param {Object} schedulerService - Reference to the scheduler service instance
   * @returns {Function} Wrapped function that records execution history
   */
  wrapCommandTaskExecution(originalExecuteCommandTask, schedulerService) {
    const historyWriter = this;
    return async function(task) {
      const startTime = new Date();
      let endTime, status, details = {};

      try {
        const result = await originalExecuteCommandTask.call(schedulerService, task);
        
        endTime = new Date();
        status = 'success';
        
        // Include stdout/stderr in response snippet
        if (result) {
          const output = [];
          if (result.stdout) output.push(`stdout: ${result.stdout.trim()}`);
          if (result.stderr) output.push(`stderr: ${result.stderr.trim()}`);
          details.responseSnippet = output.join(' | ') || '[No output]';
        }

        await historyWriter.recordExecution(task.id, startTime, endTime, status, 'command', details);
        return result;

      } catch (error) {
        endTime = new Date();
        status = 'failure';
        
        // Create error summary from command error
        details.errorSummary = historyWriter.extractErrorSummary(error);
        
        // Try to include any available output in response snippet
        if (error.stdout || error.stderr) {
          const output = [];
          if (error.stdout) output.push(`stdout: ${error.stdout.trim()}`);
          if (error.stderr) output.push(`stderr: ${error.stderr.trim()}`);
          details.responseSnippet = output.join(' | ');
        }

        await historyWriter.recordExecution(task.id, startTime, endTime, status, 'command', details);
        throw error;
      }
    };
  }

  /**
   * Extract a meaningful error summary from an error object
   * @private
   * @param {Error} error - Error object
   * @returns {string} Human-readable error summary
   */
  extractErrorSummary(error) {
    if (error.response) {
      // HTTP error
      const status = error.response.status;
      const statusText = error.response.statusText || 'Unknown Error';
      return `HTTP ${status}: ${statusText}`;
    } else if (error.code === 'ECONNREFUSED') {
      return 'Connection refused';
    } else if (error.code === 'ETIMEDOUT') {
      return 'Connection timeout';
    } else if (error.code === 'ENOTFOUND') {
      return 'Host not found';
    } else if (error.code) {
      return `${error.code}: ${error.message}`;
    } else {
      return error.message || 'Unknown error';
    }
  }

  /**
   * Truncate a string to a maximum length
   * @private
   * @param {string} str - String to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated string
   */
  truncateString(str, maxLength) {
    if (!str || typeof str !== 'string') return str;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Read execution history for a specific task
   * @param {string} taskId - Task identifier
   * @param {number} limit - Maximum number of records to return (default: 10)
   * @returns {Promise<Object[]>} Array of execution records (newest first)
   */
  async getHistory(taskId, limit = 10) {
    const filePath = path.join(this.historyDir, `${taskId}.jsonl`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const lines = data.trim().split('\n').filter(line => line.trim());
      
      // Parse each JSON line and reverse to get newest first
      const records = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (error) {
            console.warn(`[HistoryWriter] Failed to parse history line: ${line}`);
            return null;
          }
        })
        .filter(record => record !== null)
        .reverse() // Newest first
        .slice(0, limit); // Apply limit
      
      return records;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No history file exists yet
        return [];
      }
      throw new Error(`Failed to read history for task '${taskId}': ${error.message}`);
    }
  }

  /**
   * Get basic statistics about task execution history
   * @param {string} taskId - Task identifier
   * @returns {Promise<Object>} Statistics about executions
   */
  async getStatistics(taskId) {
    try {
      const history = await this.getHistory(taskId, 1000); // Get last 1000 for stats
      
      if (history.length === 0) {
        return {
          total: 0,
          success: 0,
          failure: 0,
          avgElapsed: 0,
          lastRun: null
        };
      }

      const stats = {
        total: history.length,
        success: history.filter(r => r.status === 'success').length,
        failure: history.filter(r => r.status === 'failure').length,
        avgElapsed: Math.round(history.reduce((sum, r) => sum + r.elapsed_ms, 0) / history.length),
        lastRun: history[0].start_ts // Newest first, so index 0 is most recent
      };

      return stats;
    } catch (error) {
      throw new Error(`Failed to get statistics for task '${taskId}': ${error.message}`);
    }
  }
}

module.exports = HistoryWriter;