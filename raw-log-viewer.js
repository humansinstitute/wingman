#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { spawn } = require('child_process');

class RawLogViewer {
  constructor() {
    this.logFiles = [
      'goose-output.log',
      'goose-output-improved.log', 
      'goose-claude-output.log'
    ];
  }

  start() {
    console.log(chalk.green.bold('📝 Raw Goose Log Viewer'));
    console.log(chalk.gray('Showing RAW_OUTPUT entries only...\n'));

    const { activeLog, activeLogPath } = this.findActiveLogFile();
    
    if (!activeLog) {
      console.log(chalk.yellow('No log files found.'));
      return;
    }

    console.log(chalk.blue(`📋 Reading: ${activeLog}\n`));
    
    const logPath = activeLogPath;
    
    // Use tail to follow the log
    const tailProcess = spawn('tail', ['-f', logPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    tailProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Only show RAW_OUTPUT entries
        if (line.includes('RAW_OUTPUT:')) {
          try {
            const match = line.match(/^\[(.*?)\]\s+RAW_OUTPUT:\s+(.*)$/);
            if (match) {
              const [, timestamp, content] = match;
              const time = new Date(timestamp).toLocaleTimeString();
              
              // Parse the JSON to get the raw content
              const rawContent = JSON.parse(content);
              
              // Remove ANSI codes but preserve the raw structure
              const cleanContent = rawContent.replace(/\x1b\[[0-9;]*m/g, '');
              
              if (cleanContent.trim()) {
                console.log(`${chalk.dim(`[${time}]`)} ${cleanContent}`);
              }
            }
          } catch (error) {
            // If parsing fails, just show the line
            console.log(chalk.gray(line));
          }
        }
      }
    });

    tailProcess.stderr.on('data', (data) => {
      console.error(chalk.red('Error:'), data.toString());
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      tailProcess.kill();
      console.log(chalk.yellow('\n👋 Raw log viewer stopped'));
      process.exit(0);
    });
  }

  findActiveLogFile() {
    let latestTime = 0;
    let latestFile = null;
    let latestFilePath = null;

    // Check both root directory and logs/ directory
    const searchDirs = [__dirname, path.join(__dirname, 'logs')];

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

    return { activeLog: latestFile, activeLogPath: latestFilePath };
  }
}

new RawLogViewer().start();