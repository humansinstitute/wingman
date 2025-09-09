#!/usr/bin/env node

/**
 * CLI Wrapper for Wingman Scheduler Service
 * Provides backward compatibility with existing npm run scheduler usage
 */

const fs = require('fs');
const path = require('path');
const SchedulerService = require('../lib/scheduler/scheduler-service');

// Create scheduler instance
const scheduler = new SchedulerService();
let configWatcher = null;

/**
 * Intercept SchedulerService console output to maintain [Scheduler] prefix
 * for backward compatibility
 */
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

function replacePrefix(message) {
  if (typeof message === 'string') {
    return message.replace(/\[SchedulerService\]/g, '[Scheduler]');
  }
  return message;
}

console.log = (...args) => {
  const processedArgs = args.map(replacePrefix);
  originalConsole.log(...processedArgs);
};

console.warn = (...args) => {
  const processedArgs = args.map(replacePrefix);
  originalConsole.warn(...processedArgs);
};

console.error = (...args) => {
  const processedArgs = args.map(replacePrefix);
  originalConsole.error(...processedArgs);
};

/**
 * Start the scheduler service
 */
async function startScheduler() {
  try {
    await scheduler.start();
    
    // Set up config file watcher for hot reload
    if (fs.existsSync(scheduler.configPath)) {
      configWatcher = fs.watch(scheduler.configPath, (eventType, filename) => {
        if (eventType === 'change') {
          console.log('[Scheduler] Configuration file changed, reloading...');
          setTimeout(async () => {
            try {
              await scheduler.reload();
            } catch (error) {
              console.error('[Scheduler] Error reloading config:', error.message);
            }
          }, 1000);
        }
      });
    }

    console.log('[Scheduler] Wingman Scheduler Service started');
    console.log('[Scheduler] Watching for configuration changes...');
    
    return true;
  } catch (error) {
    console.error('[Scheduler] Failed to start scheduler:', error.message);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
function gracefulShutdown(signal) {
  console.log(`\n[Scheduler] ${signal === 'SIGINT' ? 'Shutting down...' : 'Received SIGTERM, shutting down...'}`);
  
  // Close config watcher
  if (configWatcher) {
    configWatcher.close();
  }
  
  // Stop scheduler
  scheduler.stop();
  console.log('[Scheduler] Scheduler stopped');
  
  process.exit(0);
}

// Only run if this script is executed directly (not required as a module)
if (require.main === module) {
  // Signal handlers for graceful shutdown
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('[Scheduler] Uncaught exception:', error.message);
    process.exit(1);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Scheduler] Unhandled promise rejection:', reason);
    process.exit(1);
  });
  
  // Start the scheduler
  startScheduler();
}

// Export for backward compatibility
module.exports = { SchedulerService };