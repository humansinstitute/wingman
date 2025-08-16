#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { spawn } = require('child_process');

class GooseLogObserver {
  constructor() {
    this.logFiles = [
      'goose-output.log',
      'goose-output-improved.log', 
      'goose-claude-output.log'
    ];
    this.activeLogFile = null;
    this.tailProcess = null;
  }

  start() {
    console.log(chalk.green.bold('🔍 Goose Log Observer'));
    console.log(chalk.gray('Monitoring all Goose activity...\n'));

    // Find the most recently updated log file
    this.findActiveLogFile();

    if (!this.activeLogFile) {
      console.log(chalk.yellow('No active log files found. Waiting for Goose session to start...'));
      this.watchForNewLogs();
      return;
    }

    console.log(chalk.blue(`📋 Monitoring: ${this.activeLogFile}\n`));
    this.startTailing();
  }

  findActiveLogFile() {
    let latestTime = 0;
    let latestFile = null;

    for (const logFile of this.logFiles) {
      const filePath = path.join(__dirname, logFile);
      try {
        const stats = fs.statSync(filePath);
        if (stats.mtime.getTime() > latestTime) {
          latestTime = stats.mtime.getTime();
          latestFile = logFile;
        }
      } catch (error) {
        // File doesn't exist, skip
      }
    }

    this.activeLogFile = latestFile;
  }

  startTailing() {
    const logPath = path.join(__dirname, this.activeLogFile);
    
    // Use tail -f to follow the log file
    this.tailProcess = spawn('tail', ['-f', logPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.tailProcess.stdout.on('data', (data) => {
      this.processLogLine(data.toString());
    });

    this.tailProcess.stderr.on('data', (data) => {
      console.error(chalk.red('Tail error:'), data.toString());
    });

    this.tailProcess.on('close', (code) => {
      console.log(chalk.yellow(`\nLog monitoring stopped (code: ${code})`));
    });

    // Watch for log file changes
    this.watchForNewLogs();
  }

  processLogLine(data) {
    const lines = data.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        // Parse the log entry
        const match = line.match(/^\[(.*?)\]\s+([^:]+):\s+(.*)$/);
        if (!match) {
          console.log(line);
          continue;
        }

        const [, timestamp, type, content] = match;
        const time = new Date(timestamp).toLocaleTimeString();

        // Parse JSON content if possible
        let parsedContent;
        try {
          parsedContent = JSON.parse(content);
        } catch {
          parsedContent = content;
        }

        this.displayLogEntry(time, type, parsedContent);
      } catch (error) {
        console.log(line);
      }
    }
  }

  displayLogEntry(time, type, content) {
    const timeStr = chalk.dim(`[${time}]`);
    
    // Show EVERYTHING with minimal filtering
    if (typeof content === 'string') {
      const cleanContent = this.cleanAnsi(content);
      if (cleanContent.trim()) {
        console.log(`${timeStr} ${chalk.blue(type.padEnd(12))} ${cleanContent}`);
      }
    } else {
      // For non-string content, stringify it
      console.log(`${timeStr} ${chalk.yellow(type.padEnd(12))} ${JSON.stringify(content)}`);
    }
  }

  cleanAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '').trim();
  }

  watchForNewLogs() {
    // Check for new log files every 2 seconds
    this.watchInterval = setInterval(() => {
      const previousFile = this.activeLogFile;
      this.findActiveLogFile();
      
      if (this.activeLogFile !== previousFile) {
        if (this.tailProcess) {
          this.tailProcess.kill();
        }
        
        if (this.activeLogFile) {
          console.log(chalk.blue(`\n📋 Switching to: ${this.activeLogFile}\n`));
          this.startTailing();
        }
      }
    }, 2000);
  }

  stop() {
    if (this.tailProcess) {
      this.tailProcess.kill();
    }
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
    console.log(chalk.yellow('\n👋 Log observer stopped'));
  }
}

// Handle Ctrl+C gracefully
const observer = new GooseLogObserver();

process.on('SIGINT', () => {
  observer.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  observer.stop();
  process.exit(0);
});

// Start the observer
observer.start();