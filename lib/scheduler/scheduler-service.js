const CronJob = require('cron').CronJob;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const chokidar = require('chokidar');
const nodeCron = require('node-cron');
const HistoryWriter = require('./history-writer');

/**
 * SchedulerService class for managing scheduled tasks
 * Refactored from scheduler/schedule.js to be importable as a module
 */
class SchedulerService {
  /**
   * Create a new SchedulerService instance
   * @param {string} configPath - Optional path to config file (defaults to ~/.wingman/scheduler-config.json)
   */
  constructor(configPath = null) {
    this.jobs = new Map();
    this.tasks = new Map();
    this.configPath = configPath || path.join(os.homedir(), '.wingman', 'scheduler-config.json');
    this.config = null;
    this.started = false;
    this.historyWriter = new HistoryWriter();
    
    // Validation state
    this.validationErrors = [];
    this.configValid = false;
    
    // File watching properties
    this.configWatcher = null;
    this.reloadTimeout = null;
    this.lastKnownConfig = null;
    
    // Store original methods
    this._originalExecuteHttpTask = this.executeHttpTask;
    this._originalExecuteCommandTask = this.executeCommandTask;
    
    // Wrap the task execution methods with history recording
    this.executeHttpTask = this.historyWriter.wrapHttpTaskExecution(this._originalExecuteHttpTask, this);
    this.executeCommandTask = this.historyWriter.wrapCommandTaskExecution(this._originalExecuteCommandTask, this);
  }

  /**
   * Initialize and schedule all tasks
   * @returns {Promise<void>}
   */
  async start() {
    if (this.started) {
      console.log('[SchedulerService] Service is already running');
      return;
    }

    try {
      this.loadConfig();
      this.initializeTasks();
      this.setupConfigWatcher();
      this.started = true;
      console.log('[SchedulerService] Scheduler service started');
    } catch (error) {
      console.error('[SchedulerService] Failed to start service:', error.message);
      throw error;
    }
  }

  /**
   * Stop all jobs
   * @returns {void}
   */
  stop() {
    this.stopAllJobs();
    this.cleanupConfigWatcher();
    this.started = false;
    console.log('[SchedulerService] Scheduler service stopped');
  }

  /**
   * Reload config and reschedule
   * @returns {Promise<void>}
   */
  async reload() {
    console.log('[SchedulerService] Reloading configuration...');
    this.stopAllJobs();
    this.loadConfig();
    this.initializeTasks();
    console.log('[SchedulerService] Configuration reloaded');
  }

  /**
   * Get task information
   * @returns {Array<TaskInfo>}
   */
  listTasks() {
    const taskList = [];
    this.tasks.forEach((task, taskId) => {
      const jobInfo = this.jobs.get(taskId);
      let nextRun = 'N/A';
      let nextRuns = [];
      let running = false;

      if (jobInfo && task.enabled) {
        try {
          const nextDates = jobInfo.job.nextDates(3);
          if (nextDates && nextDates.length > 0) {
            // Format first date for backward compatibility
            nextRun = this.formatDateTime(nextDates[0]);
            
            // Format all dates for nextRuns array
            nextRuns = nextDates.map(date => this.formatDateTime(date));
          }
          running = jobInfo.job.running;
        } catch (error) {
          console.warn(`[SchedulerService] Error computing next runs for task '${task.name}':`, error.message);
          nextRun = 'Invalid cron';
          nextRuns = [];
        }
      } else if (!task.enabled) {
        // Disabled tasks have empty nextRuns array
        nextRun = 'Disabled';
        nextRuns = [];
      }

      taskList.push({
        id: taskId,
        name: task.name,
        type: task.type,
        schedule: task.schedule,
        enabled: task.enabled,
        running: running,
        nextRun: nextRun,
        nextRuns: nextRuns
      });
    });
    return taskList;
  }

  /**
   * Format a date/time using the configured timezone
   * @private
   * @param {Date|moment} date - Date to format
   * @returns {string} Formatted date string in format "YYYY-MM-DD HH:MM:SS TZ"
   */
  formatDateTime(date) {
    if (!date) return 'N/A';
    
    try {
      // Handle moment objects (from CronJob.nextDates()) and regular Date objects
      let dateObj;
      if (date.toDate && typeof date.toDate === 'function') {
        // This is a moment object
        dateObj = date.toDate();
      } else if (date instanceof Date) {
        // This is already a Date object
        dateObj = date;
      } else {
        // Try to create a Date from the input
        dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
          throw new Error('Invalid date');
        }
      }
      
      // Get timezone from config or use system timezone
      const timezone = this.config ? (this.config.timezone || 'system') : 'system';
      
      if (timezone === 'system') {
        // Use local timezone formatting - format like "2025-09-09 06:30:00"
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const seconds = String(dateObj.getSeconds()).padStart(2, '0');
        
        // Get timezone abbreviation
        const tzName = dateObj.toLocaleString('en-US', { timeZoneName: 'short' }).split(' ').pop();
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${tzName}`;
      } else {
        // Use specified timezone and format consistently
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZoneName: 'short'
        });
        
        const parts = formatter.formatToParts(dateObj);
        const datePart = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
        const timePart = `${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}:${parts.find(p => p.type === 'second').value}`;
        const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || timezone;
        
        return `${datePart} ${timePart} ${tzPart}`;
      }
    } catch (error) {
      console.warn('[SchedulerService] Error formatting date:', error.message);
      // Fallback - try different approaches
      try {
        if (date.toString && typeof date.toString === 'function') {
          return date.toString();
        }
      } catch {
        return 'Invalid date';
      }
      return 'Invalid date';
    }
  }

  /**
   * Get scheduler status
   * @returns {StatusInfo}
   */
  getStatus() {
    return {
      running: this.started,
      totalTasks: this.tasks.size,
      activeTasks: this.jobs.size,
      timezone: this.config ? (this.config.timezone || 'system') : 'system',
      configPath: this.configPath,
      configValid: this.configValid,
      validationErrors: this.validationErrors,
      tasks: this.listTasks()
    };
  }

  /**
   * Execute task immediately
   * @param {string} taskId - Task ID to execute
   * @returns {Promise<RunSummary>}
   */
  async runNow(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with ID '${taskId}' not found`);
    }

    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    console.log(`[SchedulerService] Manually executing task '${task.name}' at ${timestamp}`);

    try {
      let result = null;
      if (task.type === 'http') {
        result = await this.executeHttpTask(task);
      } else if (task.type === 'command') {
        result = await this.executeCommandTask(task);
      } else {
        throw new Error(`Unknown task type: ${task.type}`);
      }

      const endTime = Date.now();
      const runSummary = {
        taskId: taskId,
        taskName: task.name,
        startTime: timestamp,
        endTime: new Date().toISOString(),
        duration: endTime - startTime,
        status: 'success',
        result: result
      };

      console.log(`[SchedulerService] Task '${task.name}' completed successfully in ${runSummary.duration}ms`);
      return runSummary;
    } catch (error) {
      const endTime = Date.now();
      const runSummary = {
        taskId: taskId,
        taskName: task.name,
        startTime: timestamp,
        endTime: new Date().toISOString(),
        duration: endTime - startTime,
        status: 'error',
        error: error.message
      };

      console.error(`[SchedulerService] Task '${task.name}' failed: ${error.message}`);
      return runSummary;
    }
  }

  /**
   * Get run history for a task
   * @param {string} taskId - Task ID
   * @param {number} limit - Maximum number of records to return
   * @returns {Promise<RunSummary[]>}
   */
  async getHistory(taskId, limit = 10) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with ID '${taskId}' not found`);
    }

    try {
      const history = await this.historyWriter.getHistory(taskId, limit);
      
      // Convert JSONL format to RunSummary format for compatibility
      const runSummaries = history.map(record => ({
        taskId: record.task_id,
        taskName: task.name,
        startTime: record.start_ts,
        endTime: record.end_ts,
        duration: record.elapsed_ms,
        status: record.status === 'success' ? 'success' : 'error',
        result: record.status === 'success' ? { 
          response: record.response_snippet,
          httpStatus: record.http_status 
        } : undefined,
        error: record.status === 'failure' ? record.error_summary : undefined
      }));

      return runSummaries;
    } catch (error) {
      console.error(`[SchedulerService] Failed to get history for task '${taskId}': ${error.message}`);
      return [];
    }
  }

  /**
   * Get execution statistics for a task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Statistics about task executions
   */
  async getTaskStatistics(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with ID '${taskId}' not found`);
    }

    try {
      return await this.historyWriter.getStatistics(taskId);
    } catch (error) {
      console.error(`[SchedulerService] Failed to get statistics for task '${taskId}': ${error.message}`);
      return {
        total: 0,
        success: 0,
        failure: 0,
        avgElapsed: 0,
        lastRun: null
      };
    }
  }

  /**
   * Validate configuration data
   * @param {Object} configData - Configuration object to validate
   * @param {string} configText - Raw configuration text for JSON syntax error reporting
   * @returns {Object} Validation result with isValid boolean and errors array
   * @private
   */
  validateConfig(configData, configText = null) {
    const errors = [];
    let isValid = true;

    // Validate JSON syntax if raw text provided
    if (configText) {
      try {
        JSON.parse(configText);
      } catch (error) {
        errors.push({
          type: 'json_syntax',
          field: 'root',
          message: `Invalid JSON syntax: ${error.message}`,
          details: this.parseJsonSyntaxError(error, configText)
        });
        isValid = false;
        // Return early for JSON syntax errors
        return { isValid, errors };
      }
    }

    // Validate root structure
    if (!configData || typeof configData !== 'object') {
      errors.push({
        type: 'structure',
        field: 'root',
        message: 'Configuration must be a valid JSON object',
        details: 'Expected an object with tasks array and optional timezone/logLevel'
      });
      isValid = false;
      return { isValid, errors };
    }

    // Validate timezone if provided
    if (configData.timezone && configData.timezone !== 'system') {
      const timezoneValidation = this.validateTimezone(configData.timezone);
      if (!timezoneValidation.isValid) {
        errors.push({
          type: 'timezone',
          field: 'timezone',
          message: timezoneValidation.message,
          details: timezoneValidation.suggestions
        });
        isValid = false;
      }
    }

    // Validate tasks array
    if (!configData.tasks) {
      errors.push({
        type: 'structure',
        field: 'tasks',
        message: 'Missing required "tasks" array',
        details: 'Configuration must include a "tasks" array, even if empty'
      });
      isValid = false;
    } else if (!Array.isArray(configData.tasks)) {
      errors.push({
        type: 'structure',
        field: 'tasks',
        message: 'Tasks must be an array',
        details: 'Expected an array of task objects'
      });
      isValid = false;
    } else {
      // Validate each task
      const taskIds = new Set();
      configData.tasks.forEach((task, index) => {
        const taskValidation = this.validateTask(task, index);
        if (!taskValidation.isValid) {
          errors.push(...taskValidation.errors);
          isValid = false;
        }

        // Check for duplicate task IDs
        if (task && task.id) {
          if (taskIds.has(task.id)) {
            errors.push({
              type: 'duplicate_id',
              field: `tasks[${index}].id`,
              message: `Duplicate task ID: "${task.id}"`,
              details: 'Each task must have a unique ID'
            });
            isValid = false;
          } else {
            taskIds.add(task.id);
          }
        }
      });
    }

    return { isValid, errors };
  }

  /**
   * Parse JSON syntax error to provide line/column information
   * @param {Error} error - JSON parse error
   * @param {string} jsonText - Original JSON text
   * @returns {Object} Error details with line/column info
   * @private
   */
  parseJsonSyntaxError(error, jsonText) {
    const match = error.message.match(/at position (\d+)/);
    if (!match || !jsonText) {
      return { line: null, column: null, context: error.message };
    }

    const position = parseInt(match[1], 10);
    const lines = jsonText.substring(0, position).split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;

    // Get context around the error
    const allLines = jsonText.split('\n');
    const contextStart = Math.max(0, line - 3);
    const contextEnd = Math.min(allLines.length, line + 2);
    const context = allLines.slice(contextStart, contextEnd);

    return {
      line,
      column,
      position,
      context: context.join('\n'),
      suggestion: 'Check for missing commas, quotes, or brackets around the indicated position'
    };
  }

  /**
   * Validate timezone setting
   * @param {string} timezone - Timezone identifier to validate
   * @returns {Object} Validation result
   * @private
   */
  validateTimezone(timezone) {
    try {
      // Test timezone by trying to format a date with it
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
      return { isValid: true };
    } catch (error) {
      const commonTimezones = [
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
        'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Kolkata',
        'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
      ];

      return {
        isValid: false,
        message: `Invalid timezone: "${timezone}"`,
        suggestions: `Common valid timezones: ${commonTimezones.join(', ')}. Use "system" for system timezone.`
      };
    }
  }

  /**
   * Validate individual task configuration
   * @param {Object} task - Task object to validate
   * @param {number} index - Task index in array
   * @returns {Object} Validation result
   * @private
   */
  validateTask(task, index) {
    const errors = [];
    let isValid = true;
    const fieldPrefix = `tasks[${index}]`;

    // Validate task is an object
    if (!task || typeof task !== 'object') {
      errors.push({
        type: 'structure',
        field: fieldPrefix,
        message: `Task at index ${index} must be an object`,
        details: 'Each task should be a JSON object with id, schedule, type, and config properties'
      });
      return { isValid: false, errors };
    }

    // Validate required fields
    if (!task.id || typeof task.id !== 'string') {
      errors.push({
        type: 'required_field',
        field: `${fieldPrefix}.id`,
        message: 'Task ID is required and must be a string',
        details: 'Use a unique, descriptive ID like "daily-backup" or "morning-report"'
      });
      isValid = false;
    }

    if (!task.schedule || typeof task.schedule !== 'string') {
      errors.push({
        type: 'required_field',
        field: `${fieldPrefix}.schedule`,
        message: 'Task schedule is required and must be a cron expression string',
        details: 'Use cron format like "0 9 * * *" for daily at 9 AM'
      });
      isValid = false;
    } else {
      // Validate cron expression
      const cronValidation = this.validateCronExpression(task.schedule);
      if (!cronValidation.isValid) {
        errors.push({
          type: 'cron_expression',
          field: `${fieldPrefix}.schedule`,
          message: cronValidation.message,
          details: cronValidation.details
        });
        isValid = false;
      }
    }

    if (!task.type || (task.type !== 'http' && task.type !== 'command')) {
      errors.push({
        type: 'invalid_value',
        field: `${fieldPrefix}.type`,
        message: 'Task type must be either "http" or "command"',
        details: 'Use "http" for HTTP requests or "command" for shell commands'
      });
      isValid = false;
    }

    // Validate enabled field if present
    if (task.enabled !== undefined && typeof task.enabled !== 'boolean') {
      errors.push({
        type: 'invalid_type',
        field: `${fieldPrefix}.enabled`,
        message: 'Task enabled field must be a boolean (true/false)',
        details: 'Use true to enable the task or false to disable it'
      });
      isValid = false;
    }

    // Validate config based on task type
    if (task.type === 'http') {
      const httpValidation = this.validateHttpTaskConfig(task.config, fieldPrefix);
      if (!httpValidation.isValid) {
        errors.push(...httpValidation.errors);
        isValid = false;
      }
    } else if (task.type === 'command') {
      const commandValidation = this.validateCommandTaskConfig(task.config, fieldPrefix);
      if (!commandValidation.isValid) {
        errors.push(...commandValidation.errors);
        isValid = false;
      }
    }

    return { isValid, errors };
  }

  /**
   * Validate cron expression
   * @param {string} cronExpression - Cron expression to validate
   * @returns {Object} Validation result
   * @private
   */
  validateCronExpression(cronExpression) {
    // Use node-cron for validation
    const isValid = nodeCron.validate(cronExpression);
    
    if (!isValid) {
      const examples = [
        '0 9 * * * - Daily at 9 AM',
        '0 */6 * * * - Every 6 hours',
        '0 9 * * 1-5 - Weekdays at 9 AM',
        '30 14 1 * * - Monthly on the 1st at 2:30 PM',
        '0 0 * * 0 - Weekly on Sunday at midnight'
      ];

      return {
        isValid: false,
        message: `Invalid cron expression: "${cronExpression}"`,
        details: `Examples of valid cron expressions:\n${examples.join('\n')}`
      };
    }

    // Check for very frequent executions using the CronJob library
    let warning = null;
    try {
      const testJob = new CronJob(cronExpression, () => {}, null, false);
      const next1 = testJob.nextDates(1);
      const next2 = testJob.nextDates(2);
      
      if (next1 && next1[0] && next2 && next2[1]) {
        const intervalMs = next2[1].toDate().getTime() - next1[0].toDate().getTime();
        if (intervalMs < 60000) { // Less than 1 minute
          warning = 'Warning: Task will run more frequently than once per minute';
        }
      }
    } catch (error) {
      // Ignore warnings if we can't calculate frequency
    }
    
    return { 
      isValid: true,
      warning
    };
  }

  /**
   * Validate HTTP task configuration
   * @param {Object} config - HTTP task config object
   * @param {string} fieldPrefix - Field prefix for error reporting
   * @returns {Object} Validation result
   * @private
   */
  validateHttpTaskConfig(config, fieldPrefix) {
    const errors = [];
    let isValid = true;
    const configPrefix = `${fieldPrefix}.config`;

    if (!config || typeof config !== 'object') {
      errors.push({
        type: 'structure',
        field: configPrefix,
        message: 'HTTP task config is required and must be an object',
        details: 'HTTP tasks require a config object with at least a "url" property'
      });
      return { isValid: false, errors };
    }

    // Validate URL
    if (!config.url || typeof config.url !== 'string') {
      errors.push({
        type: 'required_field',
        field: `${configPrefix}.url`,
        message: 'HTTP task URL is required and must be a string',
        details: 'Provide a complete URL like "https://api.example.com/webhook"'
      });
      isValid = false;
    } else {
      try {
        new URL(config.url);
      } catch {
        errors.push({
          type: 'invalid_url',
          field: `${configPrefix}.url`,
          message: `Invalid URL format: "${config.url}"`,
          details: 'URL must include protocol (http:// or https://) and be properly formatted'
        });
        isValid = false;
      }
    }

    // Validate HTTP method if provided
    if (config.method && typeof config.method !== 'string') {
      errors.push({
        type: 'invalid_type',
        field: `${configPrefix}.method`,
        message: 'HTTP method must be a string',
        details: 'Common methods: GET, POST, PUT, DELETE, PATCH'
      });
      isValid = false;
    } else if (config.method) {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      if (!validMethods.includes(config.method.toUpperCase())) {
        errors.push({
          type: 'invalid_value',
          field: `${configPrefix}.method`,
          message: `Invalid HTTP method: "${config.method}"`,
          details: `Valid methods: ${validMethods.join(', ')}`
        });
        isValid = false;
      }
    }

    // Validate headers if provided
    if (config.headers !== undefined) {
      if (typeof config.headers !== 'object' || Array.isArray(config.headers)) {
        errors.push({
          type: 'invalid_type',
          field: `${configPrefix}.headers`,
          message: 'HTTP headers must be an object',
          details: 'Headers should be key-value pairs like {"Authorization": "Bearer token", "Content-Type": "application/json"}'
        });
        isValid = false;
      }
    }

    return { isValid, errors };
  }

  /**
   * Validate command task configuration
   * @param {Object} config - Command task config object
   * @param {string} fieldPrefix - Field prefix for error reporting
   * @returns {Object} Validation result
   * @private
   */
  validateCommandTaskConfig(config, fieldPrefix) {
    const errors = [];
    let isValid = true;
    const configPrefix = `${fieldPrefix}.config`;

    if (!config || typeof config !== 'object') {
      errors.push({
        type: 'structure',
        field: configPrefix,
        message: 'Command task config is required and must be an object',
        details: 'Command tasks require a config object with a "command" property'
      });
      return { isValid: false, errors };
    }

    // Validate command
    if (!config.command || typeof config.command !== 'string') {
      errors.push({
        type: 'required_field',
        field: `${configPrefix}.command`,
        message: 'Command task command is required and must be a string',
        details: 'Provide a shell command like "echo \'Hello World\'" or "node script.js"'
      });
      isValid = false;
    } else if (config.command.trim().length === 0) {
      errors.push({
        type: 'invalid_value',
        field: `${configPrefix}.command`,
        message: 'Command cannot be empty',
        details: 'Provide a valid shell command to execute'
      });
      isValid = false;
    }

    return { isValid, errors };
  }

  /**
   * Load configuration from file
   * @private
   */
  loadConfig() {
    // Reset validation state
    this.validationErrors = [];
    this.configValid = false;
    
    try {
      const configText = fs.readFileSync(this.configPath, 'utf8');
      let configData;
      
      try {
        configData = JSON.parse(configText);
      } catch (jsonError) {
        // JSON parsing failed - use comprehensive validation for detailed error
        const validation = this.validateConfig(null, configText);
        this.validationErrors = validation.errors;
        this.configValid = false;
        
        console.error('[SchedulerService] Configuration file contains invalid JSON:');
        validation.errors.forEach(error => {
          console.error(`[SchedulerService]   ${error.message}`);
          if (error.details && error.details.line) {
            console.error(`[SchedulerService]   Error at line ${error.details.line}, column ${error.details.column}`);
          }
        });
        
        // Fall back to last known config if available
        if (this.lastKnownConfig) {
          console.warn('[SchedulerService] Using last known good configuration due to JSON syntax errors');
          this.config = { ...this.lastKnownConfig };
          this.rebuildTasksMap();
          return;
        }
        
        // No fallback available - use default empty config
        console.error('[SchedulerService] No valid configuration available, using empty configuration');
        this.config = { tasks: [], timezone: 'system', logLevel: 'info' };
        this.lastKnownConfig = { ...this.config };
        this.tasks.clear();
        return;
      }
      
      // Validate the parsed configuration
      const validation = this.validateConfig(configData, configText);
      this.validationErrors = validation.errors;
      this.configValid = validation.isValid;
      
      if (!validation.isValid) {
        console.error('[SchedulerService] Configuration validation failed:');
        validation.errors.forEach(error => {
          console.error(`[SchedulerService]   [${error.type}] ${error.field}: ${error.message}`);
          if (error.details) {
            console.error(`[SchedulerService]     Details: ${error.details}`);
          }
        });
        
        // Even with validation errors, try to use the config for non-critical errors
        // Critical errors (JSON syntax, structure) are handled above
        const hasCriticalErrors = validation.errors.some(error => 
          error.type === 'json_syntax' || 
          (error.type === 'structure' && error.field === 'root')
        );
        
        if (hasCriticalErrors) {
          // Fall back to last known config
          if (this.lastKnownConfig) {
            console.warn('[SchedulerService] Using last known good configuration due to critical validation errors');
            this.config = { ...this.lastKnownConfig };
            this.rebuildTasksMap();
            return;
          }
          
          // No fallback - use default
          console.error('[SchedulerService] No valid configuration available, using empty configuration');
          this.config = { tasks: [], timezone: 'system', logLevel: 'info' };
          this.lastKnownConfig = { ...this.config };
          this.tasks.clear();
          return;
        }
        
        console.warn('[SchedulerService] Configuration has validation errors but will attempt to use it');
        console.warn('[SchedulerService] Some tasks may be disabled due to validation issues');
      }
      
      // Configuration parsed and validated (or has non-critical errors)
      this.config = configData;
      this.lastKnownConfig = { ...this.config }; // Store backup of last known config
      
      if (validation.isValid) {
        console.log(`[SchedulerService] Successfully loaded and validated configuration from ${this.configPath}`);
      } else {
        console.log(`[SchedulerService] Loaded configuration from ${this.configPath} (with validation warnings)`);
      }
      
      this.rebuildTasksMap();
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Configuration file doesn't exist
        this.validationErrors = [{
          type: 'file_not_found',
          field: 'config',
          message: `Configuration file not found at ${this.configPath}`,
          details: 'Copy config.example.json to ~/.wingman/scheduler-config.json to get started'
        }];
        this.configValid = false;
        
        // If we have a last known config and file is missing, use it and warn
        if (this.lastKnownConfig) {
          console.warn(`[SchedulerService] Configuration file temporarily missing at ${this.configPath}, using last known configuration`);
          this.config = { ...this.lastKnownConfig };
          this.rebuildTasksMap();
          return;
        }
        
        console.warn(`[SchedulerService] Configuration file not found at ${this.configPath}`);
        console.warn('[SchedulerService] Copy config.example.json to ~/.wingman/scheduler-config.json to get started');
        this.config = { tasks: [], timezone: 'system', logLevel: 'info' };
        this.lastKnownConfig = { ...this.config };
        this.tasks.clear();
        return;
      }
      
      // Other file system errors
      this.validationErrors = [{
        type: 'file_error',
        field: 'config',
        message: `Error reading configuration file: ${error.message}`,
        details: 'Check file permissions and disk space'
      }];
      this.configValid = false;
      
      // Fall back to last known config if available
      if (this.lastKnownConfig) {
        console.error(`[SchedulerService] Error loading config: ${error.message}`);
        console.warn('[SchedulerService] Using last known good configuration');
        this.config = { ...this.lastKnownConfig };
        this.rebuildTasksMap();
        return;
      }
      
      console.error('[SchedulerService] Error loading config:', error.message);
      throw error;
    }
  }

  /**
   * Rebuild tasks map from current configuration
   * Only includes tasks that pass validation
   * @private
   */
  rebuildTasksMap() {
    this.tasks.clear();
    if (this.config.tasks && Array.isArray(this.config.tasks)) {
      this.config.tasks.forEach((task, index) => {
        // Only add task if it passes individual validation
        const taskValidation = this.validateTask(task, index);
        if (taskValidation.isValid) {
          this.tasks.set(task.id, task);
        } else {
          console.warn(`[SchedulerService] Skipping invalid task at index ${index} (ID: ${task.id || 'unknown'})`);
          taskValidation.errors.forEach(error => {
            console.warn(`[SchedulerService]   ${error.message}`);
          });
        }
      });
    }
  }

  /**
   * Initialize tasks from configuration
   * @private
   */
  initializeTasks() {
    if (!this.config.tasks || !Array.isArray(this.config.tasks)) {
      console.warn('[SchedulerService] No tasks found in configuration');
      return;
    }

    this.config.tasks.forEach(task => {
      if (task.enabled) {
        this.createJob(task);
      } else {
        console.log(`[SchedulerService] Task '${task.name}' is disabled`);
      }
    });

    console.log(`[SchedulerService] Initialized ${this.jobs.size} task(s)`);
  }

  /**
   * Create a cron job for a task
   * @private
   * @param {Object} task - Task configuration
   */
  createJob(task) {
    try {
      // Validate cron expression before creating job
      const cronValidation = this.validateCronExpression(task.schedule);
      if (!cronValidation.isValid) {
        console.error(`[SchedulerService] Invalid cron expression for task '${task.name}': ${cronValidation.message}`);
        return;
      }

      // Show warning for very frequent tasks
      if (cronValidation.warning) {
        console.warn(`[SchedulerService] ${cronValidation.warning} for task '${task.name}'`);
      }

      const job = new CronJob(
        task.schedule,
        () => this.executeTask(task),
        null,
        true,
        this.config.timezone || 'system'
      );

      this.jobs.set(task.id, { job, task });
      console.log(`[SchedulerService] Task '${task.name}' scheduled with pattern: ${task.schedule}`);
      
      const nextRun = job.nextDates(1);
      if (nextRun && nextRun[0]) {
        console.log(`[SchedulerService] Next run for '${task.name}': ${this.formatDateTime(nextRun[0])}`);
      }
    } catch (error) {
      console.error(`[SchedulerService] Error creating job for task '${task.name}':`, error.message);
      console.error(`[SchedulerService] Task will be disabled until configuration is fixed`);
    }
  }

  /**
   * Execute a task
   * @private
   * @param {Object} task - Task to execute
   */
  async executeTask(task) {
    const timestamp = new Date().toISOString();
    console.log(`[SchedulerService] Executing task '${task.name}' at ${timestamp}`);

    try {
      if (task.type === 'http') {
        await this.executeHttpTask(task);
      } else if (task.type === 'command') {
        await this.executeCommandTask(task);
      } else {
        console.error(`[SchedulerService] Unknown task type: ${task.type}`);
      }
    } catch (error) {
      console.error(`[SchedulerService] Error executing task '${task.name}':`, error.message);
      if (this.config.logLevel === 'debug') {
        console.error(error.stack);
      }
    }
  }

  /**
   * Execute an HTTP task
   * @private
   * @param {Object} task - HTTP task configuration
   */
  async executeHttpTask(task) {
    const { method, url, headers, body } = task.config;
    
    try {
      const response = await axios({
        method: method || 'GET',
        url,
        headers: headers || {},
        data: body || undefined,
        timeout: 30000
      });

      console.log(`[SchedulerService] HTTP task '${task.name}' completed successfully`);
      if (this.config.logLevel === 'debug') {
        console.log(`[SchedulerService] Response:`, response.data);
      }
      
      return response.data;
    } catch (error) {
      const errorMessage = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.message;
      
      console.error(`[SchedulerService] HTTP task '${task.name}' failed: ${errorMessage}`);
      
      if (this.config.logLevel === 'debug' && error.response) {
        console.error(`[SchedulerService] Response data:`, error.response.data);
      }
      
      throw error;
    }
  }

  /**
   * Execute a command task
   * @private
   * @param {Object} task - Command task configuration
   */
  async executeCommandTask(task) {
    const { command } = task.config;
    const { exec } = require('child_process');
    
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`[SchedulerService] Command task '${task.name}' failed:`, error.message);
          reject(error);
          return;
        }
        
        console.log(`[SchedulerService] Command task '${task.name}' completed successfully`);
        if (this.config.logLevel === 'debug') {
          if (stdout) console.log(`[SchedulerService] stdout:`, stdout);
          if (stderr) console.log(`[SchedulerService] stderr:`, stderr);
        }
        
        resolve({ stdout, stderr });
      });
    });
  }

  /**
   * Stop a specific job
   * @private
   * @param {string} taskId - Task ID to stop
   */
  stopJob(taskId) {
    const jobInfo = this.jobs.get(taskId);
    if (jobInfo) {
      jobInfo.job.stop();
      this.jobs.delete(taskId);
      console.log(`[SchedulerService] Stopped task: ${jobInfo.task.name}`);
    }
  }

  /**
   * Stop all jobs
   * @private
   */
  stopAllJobs() {
    this.jobs.forEach((jobInfo, taskId) => {
      jobInfo.job.stop();
    });
    this.jobs.clear();
    console.log('[SchedulerService] All tasks stopped');
  }

  /**
   * Set up configuration file watcher with chokidar
   * @private
   */
  setupConfigWatcher() {
    try {
      // Initialize chokidar watcher for the config file
      this.configWatcher = chokidar.watch(this.configPath, {
        ignoreInitial: true,
        usePolling: false,
        atomic: true, // Handle atomic writes (common with editors)
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50
        }
      });

      // Set up event handlers
      this.configWatcher.on('add', (filePath) => {
        console.log(`[SchedulerService] Config file created: ${filePath}`);
        this.debouncedReload();
      });

      this.configWatcher.on('change', (filePath) => {
        console.log(`[SchedulerService] Config file changed: ${filePath}`);
        this.debouncedReload();
      });

      this.configWatcher.on('unlink', (filePath) => {
        console.log(`[SchedulerService] Config file removed: ${filePath}`);
        console.warn('[SchedulerService] Configuration file was deleted - scheduler will continue with last known configuration');
      });

      this.configWatcher.on('error', (error) => {
        console.error('[SchedulerService] Config watcher error:', error.message);
      });

      console.log(`[SchedulerService] Config file watcher initialized for: ${this.configPath}`);
    } catch (error) {
      console.error('[SchedulerService] Failed to setup config watcher:', error.message);
      // Don't throw error - continue without file watching
    }
  }

  /**
   * Debounced configuration reload to handle rapid file changes
   * @private
   */
  debouncedReload() {
    // Clear existing timeout if it exists
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }

    // Set new timeout for 500ms debounce
    this.reloadTimeout = setTimeout(async () => {
      try {
        console.log('[SchedulerService] Performing debounced config reload...');
        await this.reload();
        this.reloadTimeout = null;
      } catch (error) {
        console.error('[SchedulerService] Error during debounced reload:', error.message);
        this.reloadTimeout = null;
      }
    }, 500);
  }

  /**
   * Clean up configuration file watcher
   * @private
   */
  cleanupConfigWatcher() {
    // Clear any pending reload timeout
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }

    // Close chokidar watcher
    if (this.configWatcher) {
      try {
        this.configWatcher.close();
        console.log('[SchedulerService] Config file watcher closed');
      } catch (error) {
        console.error('[SchedulerService] Error closing config watcher:', error.message);
      }
      this.configWatcher = null;
    }
  }
}

module.exports = SchedulerService;