const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ScheduleEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.jobs = new Map();
    this.activeExecutions = new Map();
    this.dataDir = options.dataDir || path.join(__dirname, 'data', 'schedules');
    this.recipeManager = options.recipeManager || require('./recipe-manager');
    this.sessionManager = options.sessionManager;
    this.initialized = false;
    this.initPromise = this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadPersistedSchedules();
      this.initialized = true;
      console.log('Schedule Engine initialized');
    } catch (error) {
      console.error('Failed to initialize Schedule Engine:', error);
      this.initialized = true; // Set to true even on error to prevent hanging
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  async createSchedule(config) {
    await this.ensureInitialized();
    const schedule = {
      id: config.id || uuidv4(),
      name: config.name,
      description: config.description || '',
      recipeId: config.recipeId,
      cronExpression: config.cronExpression,
      timezone: config.timezone || 'UTC',
      parameters: config.parameters || {},
      enabled: config.enabled !== false,
      maxDuration: config.maxDuration || 30 * 60 * 1000, // 30 minutes
      retryAttempts: config.retryAttempts || 2,
      retryInterval: config.retryInterval || 5 * 60 * 1000, // 5 minutes
      outputConfig: config.outputConfig || {},
      conditions: config.conditions || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastExecuted: null,
      nextExecution: null,
      executionCount: 0,
      failureCount: 0
    };

    // Validate cron expression
    if (!cron.validate(schedule.cronExpression)) {
      throw new Error(`Invalid cron expression: ${schedule.cronExpression}`);
    }

    // Calculate next execution
    schedule.nextExecution = this.calculateNextExecution(schedule);

    // Start the cron job if enabled
    if (schedule.enabled) {
      this.startCronJob(schedule);
    }

    // Store schedule
    this.jobs.set(schedule.id, schedule);
    await this.persistSchedule(schedule);

    this.emit('scheduleCreated', schedule);
    return schedule;
  }

  startCronJob(schedule) {
    if (this.jobs.has(schedule.id) && this.jobs.get(schedule.id).cronJob) {
      this.jobs.get(schedule.id).cronJob.stop();
    }

    const cronJob = cron.schedule(
      schedule.cronExpression,
      () => this.executeSchedule(schedule.id),
      {
        scheduled: false,
        timezone: schedule.timezone
      }
    );

    schedule.cronJob = cronJob;
    cronJob.start();
    
    console.log(`Started cron job for schedule: ${schedule.name} (${schedule.id})`);
  }

  async executeSchedule(scheduleId) {
    const schedule = this.jobs.get(scheduleId);
    if (!schedule || !schedule.enabled) {
      return;
    }

    const executionId = uuidv4();
    const execution = {
      id: executionId,
      scheduleId: schedule.id,
      startedAt: new Date(),
      status: 'running',
      attempts: 0
    };

    this.activeExecutions.set(executionId, execution);
    
    try {
      console.log(`Executing schedule: ${schedule.name} (${schedule.id})`);
      
      // Update schedule stats
      schedule.lastExecuted = new Date().toISOString();
      schedule.executionCount++;
      schedule.nextExecution = this.calculateNextExecution(schedule);
      
      // Execute the recipe
      const result = await this.executeRecipe(schedule, execution);
      
      // Handle successful execution
      execution.completedAt = new Date();
      execution.duration = execution.completedAt - execution.startedAt;
      execution.status = 'completed';
      execution.result = result;
      
      // Process output
      if (schedule.outputConfig.saveToObsidian && result.output) {
        await this.saveToObsidian(schedule, result);
      }
      
      // Send notifications
      if (schedule.outputConfig.notifyOnComplete) {
        await this.sendNotification(schedule, execution, 'completed');
      }
      
      this.emit('executionCompleted', { schedule, execution, result });
      
    } catch (error) {
      console.error(`Schedule execution failed: ${schedule.name}`, error);
      
      execution.error = error.message;
      execution.status = 'failed';
      execution.completedAt = new Date();
      
      schedule.failureCount++;
      
      // Handle retry logic
      if (execution.attempts < schedule.retryAttempts) {
        setTimeout(() => {
          this.retryExecution(scheduleId, executionId);
        }, schedule.retryInterval);
      } else {
        // Send failure notification
        if (schedule.outputConfig.notifyOnError) {
          await this.sendNotification(schedule, execution, 'failed');
        }
      }
      
      this.emit('executionFailed', { schedule, execution, error });
    } finally {
      await this.persistSchedule(schedule);
      await this.persistExecution(execution);
      
      // Clean up if not retrying
      if (execution.status !== 'running') {
        this.activeExecutions.delete(executionId);
      }
    }
  }

  async retryExecution(scheduleId, executionId) {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) return;

    execution.attempts++;
    execution.status = 'running';
    
    console.log(`Retrying execution ${executionId}, attempt ${execution.attempts}`);
    
    // Re-execute the schedule
    await this.executeSchedule(scheduleId);
  }

  async executeRecipe(schedule, execution) {
    const recipe = await this.recipeManager.getRecipe(schedule.recipeId);
    if (!recipe) {
      throw new Error(`Recipe not found: ${schedule.recipeId}`);
    }

    // Process recipe with parameters
    const processedRecipe = await this.recipeManager.processTemplate(recipe, schedule.parameters);
    
    // Create a new session for execution
    const sessionId = `scheduled-${schedule.id}-${execution.id}`;
    
    // Start Goose session with the recipe
    const sessionResult = await this.startGooseSession(sessionId, processedRecipe);
    
    return sessionResult;
  }

  async startGooseSession(sessionId, recipe) {
    try {
      // This integrates with your existing goose-cli-wrapper.js
      const GooseWrapper = require('./goose-cli-wrapper');
      const goose = new GooseWrapper();
      
      await goose.startSession(sessionId);
      
      // Load extensions and builtins
      for (const extension of recipe.extensions || []) {
        await goose.sendCommand(`/builtin ${extension}`);
      }
      
      // Send the main instruction
      const response = await goose.sendMessage(recipe.instructions || recipe.prompt);
      
      return {
        sessionId,
        output: response,
        success: true
      };
      
    } catch (error) {
      throw new Error(`Goose session failed: ${error.message}`);
    }
  }

  calculateNextExecution(schedule) {
    try {
      // Simple next execution calculation - for a more precise implementation,
      // you could use a dedicated library or implement cron parsing logic
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(6, 30, 0, 0); // Default to 6:30 AM next day
      
      return tomorrow.toISOString();
    } catch (error) {
      console.error(`Error calculating next execution for ${schedule.id}:`, error);
      return null;
    }
  }

  async saveToObsidian(schedule, result) {
    try {
      const obsidianConfig = schedule.outputConfig;
      const outputPath = this.processTemplate(obsidianConfig.obsidianPath, {
        date: new Date().toISOString().split('T')[0],
        schedule: schedule,
        timestamp: new Date().toISOString()
      });
      
      // Use the Obsidian MCP integration - this would need to be integrated with your MCP setup
      console.log(`Would save output to Obsidian: ${outputPath}`);
      console.log(`Content: ${this.formatObsidianOutput(schedule, result)}`);
      
    } catch (error) {
      console.error('Failed to save to Obsidian:', error);
    }
  }

  formatObsidianOutput(schedule, result) {
    const timestamp = new Date().toISOString();
    return `
# ${schedule.name} - ${new Date().toLocaleDateString()}

**Generated**: ${timestamp}
**Schedule**: ${schedule.cronExpression}
**Execution**: #${schedule.executionCount}

## Summary

${result.output}

---
*Generated by Wingman Scheduled Assistant*
`;
  }

  processTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    }
    return result;
  }

  async sendNotification(schedule, execution, type) {
    console.log(`Notification: Schedule ${schedule.name} - ${type}`);
    if (execution.error) {
      console.log(`Error: ${execution.error}`);
    }
  }

  // CRUD Operations
  async getSchedule(id) {
    await this.ensureInitialized();
    const schedule = this.jobs.get(id);
    if (!schedule) return null;
    // Return schedule without the cronJob property to avoid circular reference
    const { cronJob, ...scheduleData } = schedule;
    return scheduleData;
  }

  async getAllSchedules() {
    await this.ensureInitialized();
    // Return schedules without the cronJob property to avoid circular reference
    return Array.from(this.jobs.values()).map(schedule => {
      const { cronJob, ...scheduleData } = schedule;
      return scheduleData;
    });
  }

  async updateSchedule(id, updates) {
    await this.ensureInitialized();
    const schedule = this.jobs.get(id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }

    Object.assign(schedule, updates, {
      updatedAt: new Date().toISOString()
    });

    // Restart cron job if expression changed
    if (updates.cronExpression || updates.enabled !== undefined) {
      if (schedule.cronJob) {
        schedule.cronJob.stop();
      }
      if (schedule.enabled) {
        this.startCronJob(schedule);
      }
      schedule.nextExecution = this.calculateNextExecution(schedule);
    }

    await this.persistSchedule(schedule);
    this.emit('scheduleUpdated', schedule);
    return schedule;
  }

  async deleteSchedule(id) {
    await this.ensureInitialized();
    const schedule = this.jobs.get(id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }

    // Stop cron job
    if (schedule.cronJob) {
      schedule.cronJob.stop();
    }

    // Remove from memory
    this.jobs.delete(id);

    // Delete from disk
    await this.deletePersistedSchedule(id);

    this.emit('scheduleDeleted', { id, schedule });
    return true;
  }

  async pauseSchedule(id) {
    return this.updateSchedule(id, { enabled: false });
  }

  async resumeSchedule(id) {
    return this.updateSchedule(id, { enabled: true });
  }

  // Persistence
  async persistSchedule(schedule) {
    const filePath = path.join(this.dataDir, `${schedule.id}.json`);
    const data = { ...schedule };
    delete data.cronJob; // Don't serialize the cron job
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async loadPersistedSchedules() {
    try {
      const files = await fs.readdir(this.dataDir).catch(() => []);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.dataDir, file);
            const data = await fs.readFile(filePath, 'utf8');
            const schedule = JSON.parse(data);
            
            this.jobs.set(schedule.id, schedule);
            
            if (schedule.enabled) {
              this.startCronJob(schedule);
            }
          } catch (err) {
            console.error(`Error loading schedule ${file}:`, err.message);
          }
        }
      }
      console.log(`Loaded ${this.jobs.size} persisted schedules`);
    } catch (error) {
      console.error('Error loading persisted schedules:', error);
      // Don't throw - just log the error and continue
    }
  }

  async deletePersistedSchedule(id) {
    const filePath = path.join(this.dataDir, `${id}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Error deleting schedule file ${id}:`, error);
    }
  }

  async persistExecution(execution) {
    const executionsDir = path.join(this.dataDir, 'executions');
    await fs.mkdir(executionsDir, { recursive: true });
    
    const filePath = path.join(executionsDir, `${execution.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(execution, null, 2));
  }

  // Monitoring
  async getStatus() {
    await this.ensureInitialized();
    return {
      totalSchedules: this.jobs.size,
      activeSchedules: Array.from(this.jobs.values()).filter(s => s.enabled).length,
      runningExecutions: this.activeExecutions.size,
      uptime: process.uptime()
    };
  }

  async getExecutionHistory(scheduleId, limit = 50) {
    await this.ensureInitialized();
    const executionsDir = path.join(this.dataDir, 'executions');
    try {
      const files = await fs.readdir(executionsDir).catch(() => []);
      const executions = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(executionsDir, file);
            const data = await fs.readFile(filePath, 'utf8');
            const execution = JSON.parse(data);
            
            if (!scheduleId || execution.scheduleId === scheduleId) {
              executions.push(execution);
            }
          } catch (err) {
            console.error(`Error loading execution ${file}:`, err.message);
          }
        }
      }
      
      return executions
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, limit);
        
    } catch (error) {
      console.error('Error loading execution history:', error);
      return [];
    }
  }
}

module.exports = ScheduleEngine;