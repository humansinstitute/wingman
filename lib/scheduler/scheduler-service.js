const CronJob = require('cron').CronJob;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

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
      let running = false;

      if (jobInfo) {
        const nextDates = jobInfo.job.nextDates(1);
        nextRun = nextDates && nextDates[0] ? nextDates[0].toString() : 'N/A';
        running = jobInfo.job.running;
      }

      taskList.push({
        id: taskId,
        name: task.name,
        type: task.type,
        schedule: task.schedule,
        enabled: task.enabled,
        running: running,
        nextRun: nextRun
      });
    });
    return taskList;
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
   * Get run history for a task (stub for now)
   * @param {string} taskId - Task ID
   * @param {number} limit - Maximum number of records to return
   * @returns {Promise<RunSummary[]>}
   */
  async getHistory(taskId, limit = 10) {
    // This is a stub implementation as requested
    // In a future implementation, this would retrieve stored run history
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with ID '${taskId}' not found`);
    }

    console.log(`[SchedulerService] getHistory called for task '${taskId}' (stub implementation)`);
    return [];
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
        console.log(`[SchedulerService] Next run for '${task.name}': ${nextRun[0].toString()}`);
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