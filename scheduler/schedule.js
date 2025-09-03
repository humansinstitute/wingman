const CronJob = require('cron').CronJob;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.configPath = path.join(os.homedir(), '.wingman', 'scheduler-config.json');
    this.loadConfig();
  }

  loadConfig() {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log(`[Scheduler] Loaded configuration from ${this.configPath}`);
      this.initializeTasks();
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`[Scheduler] Configuration file not found at ${this.configPath}`);
        console.warn('[Scheduler] Copy config.example.json to ~/.wingman/scheduler-config.json to get started');
        this.config = { tasks: [], timezone: 'system', logLevel: 'info' };
        return;
      }
      console.error('[Scheduler] Error loading config:', error.message);
      process.exit(1);
    }
  }

  reloadConfig() {
    console.log('[Scheduler] Reloading configuration...');
    this.stopAllJobs();
    this.loadConfig();
  }

  initializeTasks() {
    if (!this.config.tasks || !Array.isArray(this.config.tasks)) {
      console.warn('[Scheduler] No tasks found in configuration');
      return;
    }

    this.config.tasks.forEach(task => {
      if (task.enabled) {
        this.createJob(task);
      } else {
        console.log(`[Scheduler] Task '${task.name}' is disabled`);
      }
    });

    console.log(`[Scheduler] Initialized ${this.jobs.size} task(s)`);
  }

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
      console.log(`[Scheduler] Task '${task.name}' scheduled with pattern: ${task.schedule}`);
      
      const nextRun = job.nextDates(1);
      if (nextRun && nextRun[0]) {
        console.log(`[Scheduler] Next run for '${task.name}': ${nextRun[0].toString()}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Error creating job for task '${task.name}':`, error.message);
    }
  }

  async executeTask(task) {
    const timestamp = new Date().toISOString();
    console.log(`[Scheduler] Executing task '${task.name}' at ${timestamp}`);

    try {
      if (task.type === 'http') {
        await this.executeHttpTask(task);
      } else if (task.type === 'command') {
        await this.executeCommandTask(task);
      } else {
        console.error(`[Scheduler] Unknown task type: ${task.type}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Error executing task '${task.name}':`, error.message);
      if (this.config.logLevel === 'debug') {
        console.error(error.stack);
      }
    }
  }

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

      console.log(`[Scheduler] HTTP task '${task.name}' completed successfully`);
      if (this.config.logLevel === 'debug') {
        console.log(`[Scheduler] Response:`, response.data);
      }
      
      return response.data;
    } catch (error) {
      const errorMessage = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.message;
      
      console.error(`[Scheduler] HTTP task '${task.name}' failed: ${errorMessage}`);
      
      if (this.config.logLevel === 'debug' && error.response) {
        console.error(`[Scheduler] Response data:`, error.response.data);
      }
      
      throw error;
    }
  }

  async executeCommandTask(task) {
    const { command } = task.config;
    const { exec } = require('child_process');
    
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`[Scheduler] Command task '${task.name}' failed:`, error.message);
          reject(error);
          return;
        }
        
        console.log(`[Scheduler] Command task '${task.name}' completed successfully`);
        if (this.config.logLevel === 'debug') {
          if (stdout) console.log(`[Scheduler] stdout:`, stdout);
          if (stderr) console.log(`[Scheduler] stderr:`, stderr);
        }
        
        resolve({ stdout, stderr });
      });
    });
  }

  stopJob(taskId) {
    const jobInfo = this.jobs.get(taskId);
    if (jobInfo) {
      jobInfo.job.stop();
      this.jobs.delete(taskId);
      console.log(`[Scheduler] Stopped task: ${jobInfo.task.name}`);
    }
  }

  stopAllJobs() {
    this.jobs.forEach((jobInfo, taskId) => {
      jobInfo.job.stop();
    });
    this.jobs.clear();
    console.log('[Scheduler] All tasks stopped');
  }

  listJobs() {
    const jobList = [];
    this.jobs.forEach((jobInfo, taskId) => {
      const nextRun = jobInfo.job.nextDates(1);
      jobList.push({
        id: taskId,
        name: jobInfo.task.name,
        schedule: jobInfo.task.schedule,
        running: jobInfo.job.running,
        nextRun: nextRun && nextRun[0] ? nextRun[0].toString() : 'N/A'
      });
    });
    return jobList;
  }

  getStatus() {
    return {
      running: true,
      totalTasks: this.config.tasks ? this.config.tasks.length : 0,
      activeTasks: this.jobs.size,
      timezone: this.config.timezone || 'system',
      tasks: this.listJobs()
    };
  }
}

const scheduler = new SchedulerService();

fs.watch(scheduler.configPath, (eventType, filename) => {
  if (eventType === 'change') {
    console.log('[Scheduler] Configuration file changed, reloading...');
    setTimeout(() => scheduler.reloadConfig(), 1000);
  }
});

console.log('[Scheduler] Wingman Scheduler Service started');
console.log('[Scheduler] Watching for configuration changes...');

if (require.main === module) {
  process.on('SIGINT', () => {
    console.log('\n[Scheduler] Shutting down...');
    scheduler.stopAllJobs();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Scheduler] Received SIGTERM, shutting down...');
    scheduler.stopAllJobs();
    process.exit(0);
  });

  setInterval(() => {
    const status = scheduler.getStatus();
    if (scheduler.config?.logLevel === 'debug') {
      console.log('[Scheduler] Status:', JSON.stringify(status, null, 2));
    }
  }, 60000);
}

module.exports = { SchedulerService };