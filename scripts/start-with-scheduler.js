const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Wingman with Scheduler...\n');

const schedulerPath = path.join(__dirname, '..', 'scheduler', 'schedule.js');
const scheduler = spawn('node', [schedulerPath], {
  detached: false,
  stdio: ['ignore', 'inherit', 'inherit']
});

scheduler.on('error', (err) => {
  console.error('[Main] Failed to start scheduler:', err.message);
});

scheduler.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[Main] Scheduler terminated by signal: ${signal}`);
  } else if (code !== 0) {
    console.log(`[Main] Scheduler exited with code: ${code}`);
  }
});

console.log(`[Main] Scheduler started with PID: ${scheduler.pid}`);

const mainScript = process.argv[2] || 'index.js';
const mainPath = path.join(__dirname, '..', mainScript);

setTimeout(() => {
  console.log(`[Main] Starting main application: ${mainScript}\n`);
  
  if (mainScript === 'server.js') {
    const GooseWebServer = require(mainPath);
    const server = new GooseWebServer();
    server.start();
  } else if (mainScript === 'index.js') {
    require(mainPath);
  } else {
    require(mainPath);
  }
}, 500);

process.on('SIGINT', () => {
  console.log('\n[Main] Shutting down...');
  scheduler.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', () => {
  console.log('[Main] Received SIGTERM, shutting down...');
  scheduler.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
});