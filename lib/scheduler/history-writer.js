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
      await this._writeWithRetry(filePath, jsonLine);
    } catch (error) {
      // Log error but don't throw to avoid breaking task execution
      console.error(`[HistoryWriter] Failed to write history for task '${taskId}': ${error.message}`);
    }
  }

  /**
   * Write data to file with retry logic for better concurrent access handling
   * @private
   * @param {string} filePath - Path to write to
   * @param {string} data - Data to write
   * @param {number} retries - Number of retries left
   * @returns {Promise<void>}
   */
  async _writeWithRetry(filePath, data, retries = 3) {
    try {
      await fs.appendFile(filePath, data, 'utf8');
    } catch (error) {
      if (retries > 0 && (error.code === 'EBUSY' || error.code === 'EAGAIN' || error.code === 'ENOENT')) {
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 50));
        return this._writeWithRetry(filePath, data, retries - 1);
      }
      throw error;
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
   * Read execution history for a specific task with efficient tail reading
   * @param {string} taskId - Task identifier
   * @param {number} limit - Maximum number of records to return (default: 10)
   * @returns {Promise<Object[]>} Array of execution records (newest first)
   */
  async getHistory(taskId, limit = 10) {
    const filePath = path.join(this.historyDir, `${taskId}.jsonl`);
    
    try {
      // Check if file exists and get stats
      const stats = await fs.stat(filePath);
      
      // For small files or when limit is large, use the simple approach
      if (stats.size < 64 * 1024 || limit > 100) {
        return this._getHistorySimple(filePath, limit);
      }
      
      // Use efficient tail reading for larger files with small limits
      return this._getHistoryTail(filePath, limit);
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No history file exists yet
        return [];
      }
      throw new Error(`Failed to read history for task '${taskId}': ${error.message}`);
    }
  }

  /**
   * Simple history reading - loads entire file (for small files or large limits)
   * @private
   * @param {string} filePath - Path to history file
   * @param {number} limit - Maximum number of records to return
   * @returns {Promise<Object[]>} Array of execution records (newest first)
   */
  async _getHistorySimple(filePath, limit) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const lines = data.trim().split('\n').filter(line => line.trim());
      
      // Check if file needs truncation (>1000 entries)
      if (lines.length > 1000) {
        await this._truncateHistoryFile(filePath, lines);
        // Re-read after truncation
        const newData = await fs.readFile(filePath, 'utf8');
        const newLines = newData.trim().split('\n').filter(line => line.trim());
        return this._parseHistoryLines(newLines, limit);
      }
      
      return this._parseHistoryLines(lines, limit);
    } catch (error) {
      throw new Error(`Failed to read history file: ${error.message}`);
    }
  }

  /**
   * Efficient tail reading for large files with small limits
   * @private
   * @param {string} filePath - Path to history file
   * @param {number} limit - Maximum number of records to return
   * @returns {Promise<Object[]>} Array of execution records (newest first)
   */
  async _getHistoryTail(filePath, limit) {
    const fsSync = require('fs');
    
    return new Promise((resolve, reject) => {
      try {
        // Use file descriptor for seeking operations
        fsSync.open(filePath, 'r', (err, fd) => {
          if (err) {
            return reject(new Error(`Failed to open history file: ${err.message}`));
          }

          // Get file stats to know the file size
          fsSync.fstat(fd, (err, stats) => {
            if (err) {
              fsSync.close(fd, () => {});
              return reject(new Error(`Failed to get file stats: ${err.message}`));
            }

            this._readLinesFromEnd(fd, stats.size, limit)
              .then(lines => {
                fsSync.close(fd, (closeErr) => {
                  if (closeErr) {
                    console.warn(`[HistoryWriter] Warning: Failed to close file descriptor: ${closeErr.message}`);
                  }
                });

                // Always check if we need to truncate after reading
                // We need to do this because tail reading gives us limited visibility of total lines
                this._checkAndTruncateIfNeeded(filePath)
                  .then(() => {
                    const records = this._parseHistoryLines(lines, limit);
                    resolve(records);
                  })
                  .catch(() => {
                    // If truncation fails, continue with existing data
                    const records = this._parseHistoryLines(lines, limit);
                    resolve(records);
                  });
              })
              .catch(reject);
          });
        });
      } catch (error) {
        reject(new Error(`Failed to initialize tail reading: ${error.message}`));
      }
    });
  }

  /**
   * Read lines from the end of a file using file descriptor seeking
   * @private
   * @param {number} fd - File descriptor
   * @param {number} fileSize - Size of the file
   * @param {number} maxLines - Maximum number of lines to read
   * @returns {Promise<string[]>} Array of lines (in chronological order)
   */
  async _readLinesFromEnd(fd, fileSize, maxLines) {
    const fsSync = require('fs');
    
    return new Promise((resolve, reject) => {
      const chunkSize = Math.min(8192, fileSize); // 8KB chunks
      const lines = [];
      let position = fileSize;
      let remainingBuffer = '';

      const readChunk = () => {
        if (lines.length >= maxLines || position <= 0) {
          // We have enough lines or reached beginning of file
          resolve(lines.slice(-maxLines)); // Return last N lines in chronological order
          return;
        }

        // Calculate chunk position
        const readSize = Math.min(chunkSize, position);
        position -= readSize;
        
        const buffer = Buffer.alloc(readSize);
        
        fsSync.read(fd, buffer, 0, readSize, position, (err, bytesRead) => {
          if (err) {
            return reject(new Error(`Failed to read file chunk: ${err.message}`));
          }

          if (bytesRead === 0) {
            // End of file reached
            if (remainingBuffer.trim()) {
              lines.unshift(remainingBuffer);
            }
            resolve(lines.slice(-maxLines));
            return;
          }

          // Convert buffer to string and prepend to remaining buffer
          const chunkText = buffer.slice(0, bytesRead).toString('utf8') + remainingBuffer;
          const chunkLines = chunkText.split('\n');
          
          // The first element might be a partial line (if not at start of file)
          remainingBuffer = position > 0 ? chunkLines.shift() : '';
          
          // Add complete lines to our collection (in reverse order since we're reading backwards)
          for (let i = chunkLines.length - 1; i >= 0; i--) {
            const line = chunkLines[i].trim();
            if (line) {
              lines.unshift(line);
              if (lines.length >= maxLines * 2) {
                // Stop early if we have more than enough lines
                resolve(lines.slice(-maxLines));
                return;
              }
            }
          }

          // Continue reading the previous chunk
          setImmediate(readChunk);
        });
      };

      readChunk();
    });
  }

  /**
   * Check if file needs truncation by checking actual line count
   * @private
   * @param {string} filePath - Path to history file
   * @returns {Promise<void>}
   */
  async _checkAndTruncateIfNeeded(filePath) {
    try {
      // For truncation check, we need to know the actual line count
      // Read the file and check line count
      const data = await fs.readFile(filePath, 'utf8');
      const lines = data.trim().split('\n').filter(line => line.trim());
      
      if (lines.length > 1000) {
        console.log(`[HistoryWriter] File ${path.basename(filePath)} has ${lines.length} lines, truncating...`);
        await this._truncateHistoryFile(filePath, lines);
      }
    } catch (error) {
      console.warn(`[HistoryWriter] Failed to check file for truncation: ${error.message}`);
    }
  }

  /**
   * Parse history lines into records and return newest first
   * @private
   * @param {string[]} lines - Array of JSONL lines
   * @param {number} limit - Maximum number of records to return
   * @returns {Object[]} Array of parsed records (newest first)
   */
  _parseHistoryLines(lines, limit) {
    const records = lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.warn(`[HistoryWriter] Failed to parse history line: ${line.substring(0, 100)}...`);
          return null;
        }
      })
      .filter(record => record !== null)
      .reverse() // Newest first (since lines are in chronological order in file)
      .slice(0, limit); // Apply limit
    
    return records;
  }

  /**
   * Truncate history file to maintain maximum of 1000 entries
   * @private
   * @param {string} filePath - Path to history file
   * @param {string[]} lines - Current lines in the file
   * @returns {Promise<void>}
   */
  async _truncateHistoryFile(filePath, lines) {
    try {
      console.log(`[HistoryWriter] Truncating history file ${path.basename(filePath)} from ${lines.length} to 1000 entries`);
      
      // Keep only the most recent 1000 entries
      const keepLines = lines.slice(-1000);
      const newContent = keepLines.join('\n') + '\n';
      
      // Write truncated content atomically using a temporary file
      const tempFilePath = filePath + '.tmp';
      await fs.writeFile(tempFilePath, newContent, 'utf8');
      await fs.rename(tempFilePath, filePath);
      
      console.log(`[HistoryWriter] Successfully truncated history file ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`[HistoryWriter] Failed to truncate history file: ${error.message}`);
      // Don't throw - let the original read operation continue
    }
  }

  /**
   * Get basic statistics about task execution history
   * @param {string} taskId - Task identifier
   * @returns {Promise<Object>} Statistics about executions
   */
  async getStatistics(taskId) {
    try {
      // Use efficient reading - for stats we want a reasonable sample
      const history = await this.getHistory(taskId, 1000); 
      
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