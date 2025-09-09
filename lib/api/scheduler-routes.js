/**
 * Scheduler API Routes
 * Express router module providing HTTP endpoints for SchedulerService functionality
 */

const express = require('express');
const router = express.Router();

/**
 * Create and configure scheduler routes
 * @param {SchedulerService} schedulerService - SchedulerService instance to expose via API
 * @returns {express.Router} Configured Express router
 */
function createSchedulerRoutes(schedulerService) {
  
  // Middleware for request logging
  router.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[SchedulerAPI] ${timestamp} ${req.method} ${req.path} - ${req.ip}`);
    next();
  });

  // Middleware for consistent error response formatting
  const handleApiError = (error, req, res, next) => {
    console.error(`[SchedulerAPI] Error on ${req.method} ${req.path}:`, error.message);
    
    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let message = error.message;

    // Categorize error types
    if (error.message.includes('not found')) {
      statusCode = 404;
      errorCode = 'NOT_FOUND';
    } else if (error.message.includes('invalid') || 
               error.message.includes('validation') ||
               error.message.includes('must be') ||
               error.message.includes('is required') ||
               error.message.includes('cannot be empty')) {
      statusCode = 400;
      errorCode = 'VALIDATION_ERROR';
    } else if (error.message.includes('Task with ID')) {
      statusCode = 404;
      errorCode = 'TASK_NOT_FOUND';
    }

    res.status(statusCode).json({
      error: message,
      code: errorCode,
      timestamp: new Date().toISOString(),
      path: req.path
    });
  };

  // Input validation and sanitization helper
  const validateTaskId = (taskId) => {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Task ID is required and must be a string');
    }
    if (taskId.trim().length === 0) {
      throw new Error('Task ID cannot be empty');
    }
    return taskId.trim();
  };

  const parseIntParam = (value, paramName, defaultValue = null, min = null, max = null) => {
    if (value === undefined || value === null || value === '') {
      if (defaultValue !== null) return defaultValue;
      throw new Error(`${paramName} is required`);
    }
    
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(`${paramName} must be a valid integer`);
    }
    
    if (min !== null && parsed < min) {
      throw new Error(`${paramName} must be at least ${min}`);
    }
    
    if (max !== null && parsed > max) {
      throw new Error(`${paramName} must be at most ${max}`);
    }
    
    return parsed;
  };

  /**
   * GET /api/scheduler/status
   * Get current scheduler status including running state, task counts, and validation errors
   */
  router.get('/status', async (req, res, next) => {
    try {
      const status = schedulerService.getStatus();
      
      // Format response according to API specification
      const response = {
        running: status.running,
        timezone: status.timezone,
        totalTasks: status.totalTasks,
        activeTasks: status.activeTasks,
        configValid: status.configValid,
        validationErrors: status.validationErrors || []
      };

      console.log(`[SchedulerAPI] Status request: running=${response.running}, tasks=${response.totalTasks}/${response.activeTasks}`);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/scheduler/tasks
   * Get list of all tasks with their scheduling information
   */
  router.get('/tasks', async (req, res, next) => {
    try {
      const tasks = schedulerService.listTasks();
      
      console.log(`[SchedulerAPI] Tasks request: returning ${tasks.length} tasks`);
      res.json(tasks);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/scheduler/reload
   * Reload scheduler configuration and reschedule tasks
   */
  router.post('/reload', async (req, res, next) => {
    try {
      console.log('[SchedulerAPI] Config reload requested');
      await schedulerService.reload();
      
      const response = {
        success: true,
        message: 'Configuration reloaded successfully',
        timestamp: new Date().toISOString()
      };

      console.log('[SchedulerAPI] Config reload completed successfully');
      res.json(response);
    } catch (error) {
      // Even if reload fails, we want to return a structured response
      const response = {
        success: false,
        message: `Configuration reload failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      
      console.error('[SchedulerAPI] Config reload failed:', error.message);
      res.status(500).json(response);
    }
  });

  /**
   * POST /api/scheduler/trigger/:id
   * Execute a specific task immediately
   */
  router.post('/trigger/:id', async (req, res, next) => {
    try {
      const taskId = validateTaskId(req.params.id);
      
      console.log(`[SchedulerAPI] Manual trigger requested for task: ${taskId}`);
      const runSummary = await schedulerService.runNow(taskId);
      
      console.log(`[SchedulerAPI] Task ${taskId} executed with status: ${runSummary.status}`);
      res.json(runSummary);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/scheduler/history
   * Get execution history for tasks
   * Query parameters:
   * - taskId (optional): Filter by specific task ID
   * - limit (optional): Maximum number of records to return (default: 10, max: 100)
   */
  router.get('/history', async (req, res, next) => {
    try {
      const taskId = req.query.taskId ? validateTaskId(req.query.taskId) : null;
      const limit = parseIntParam(req.query.limit, 'limit', 10, 1, 100);

      let history;
      if (taskId) {
        console.log(`[SchedulerAPI] History request for task: ${taskId}, limit: ${limit}`);
        history = await schedulerService.getHistory(taskId, limit);
      } else {
        // If no taskId specified, we need to get history for all tasks
        // Since SchedulerService.getHistory requires a taskId, we'll need to get all tasks first
        // and then get history for each one, then combine and sort by timestamp
        console.log(`[SchedulerAPI] History request for all tasks, limit: ${limit}`);
        
        const tasks = schedulerService.listTasks();
        const allHistory = [];
        
        // Get history for each task (limiting each to prevent too much data)
        for (const task of tasks) {
          try {
            const taskHistory = await schedulerService.getHistory(task.id, Math.min(limit, 20));
            allHistory.push(...taskHistory);
          } catch (error) {
            // If individual task history fails, log but continue with other tasks
            console.warn(`[SchedulerAPI] Failed to get history for task ${task.id}: ${error.message}`);
          }
        }
        
        // Sort by start time (newest first) and limit results
        history = allHistory
          .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
          .slice(0, limit);
      }

      console.log(`[SchedulerAPI] History request returning ${history.length} records`);
      res.json(history);
    } catch (error) {
      next(error);
    }
  });

  // Apply error handling middleware
  router.use(handleApiError);

  return router;
}

module.exports = createSchedulerRoutes;