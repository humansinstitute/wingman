#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { spawn } = require('child_process');

class GooseLogObserver {
  constructor() {
    this.logFiles = [
      'goose-streaming-output.log',
      'goose-output.log',
      'goose-output-improved.log',
      'goose-claude-output.log'
    ];
    this.activeLogFile = null;
    this.tailProcess = null;
  }

  start() {
    console.log(chalk.green.bold('🔍 Goose Log Observer'));
    console.log(chalk.gray('Monitoring Goose logs...\n'));

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
    let latestFilePath = null;

    const searchDirs = [path.join(__dirname, '..', '..', 'logs')];

    for (const logFile of this.logFiles) {
      for (const searchDir of searchDirs) {
        const filePath = path.join(searchDir, logFile);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtime.getTime() > latestTime) {
            latestTime = stats.mtime.getTime();
            latestFile = logFile;
            latestFilePath = filePath;
          }
        } catch (error) {
          // File doesn't exist, skip
        }
      }
    }

    this.activeLogFile = latestFile;
    this.activeLogFilePath = latestFilePath;
  }

  startTailing() {
    const logPath = this.activeLogFilePath;
    this.tailProcess = spawn('tail', ['-f', logPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.tailProcess.stdout.on('data', (data) => process.stdout.write(data.toString()));
    this.tailProcess.stderr.on('data', (data) => console.error(chalk.red('Tail error:'), data.toString()));
    this.tailProcess.on('close', (code) => console.log(chalk.yellow(`\nLog monitoring stopped (code: ${code})`)));
    this.watchForNewLogs();
  }

  watchForNewLogs() {
    this.watchInterval = setInterval(() => {
      const previousFile = this.activeLogFile;
      this.findActiveLogFile();
      if (this.activeLogFile !== previousFile) {
        if (this.tailProcess) this.tailProcess.kill();
        if (this.activeLogFile) {
          console.log(chalk.blue(`\n📋 Switching to: ${this.activeLogFile}\n`));
          this.startTailing();
        }
      }
    }, 2000);
  }

  stop() {
    if (this.tailProcess) this.tailProcess.kill();
    if (this.watchInterval) clearInterval(this.watchInterval);
    console.log(chalk.yellow('\n👋 Log observer stopped'));
  }
}

const observer = new GooseLogObserver();
process.on('SIGINT', () => { observer.stop(); process.exit(0); });
process.on('SIGTERM', () => { observer.stop(); process.exit(0); });
observer.start();

