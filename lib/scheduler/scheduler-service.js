const CronJob = require('cron').CronJob;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
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
   * Load configuration from file
   * @private
   */
  loadConfig() {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log(`[SchedulerService] Loaded configuration from ${this.configPath}`);
      
      // Clear and rebuild tasks map
      this.tasks.clear();
      if (this.config.tasks && Array.isArray(this.config.tasks)) {
        this.config.tasks.forEach(task => {
          this.tasks.set(task.id, task);
        });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`[SchedulerService] Configuration file not found at ${this.configPath}`);
        console.warn('[SchedulerService] Copy config.example.json to ~/.wingman/scheduler-config.json to get started');
        this.config = { tasks: [], timezone: 'system', logLevel: 'info' };
        this.tasks.clear();
        return;
      }
      console.error('[SchedulerService] Error loading config:', error.message);
      throw error;
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
}

module.exports = SchedulerService;