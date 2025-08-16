#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { DatabaseManager } = require('../lib/database');

class GooseCleanup {
  constructor() {
    this.projectDir = path.dirname(__dirname);
    this.gooseSessionsDir = path.join(os.homedir(), '.local', 'share', 'goose', 'sessions');
    this.db = new DatabaseManager();
    this.logFiles = [
      'conversation.json',
      'goose-output.log',
      'goose-claude-output.log', 
      'goose-output-improved.log',
      'goose-streaming-output.log'
    ];
  }

  async run() {
    console.log(chalk.blue.bold('\n🧹 Goose Environment Cleanup Tool\n'));
    
    try {
      await this.clearLocalLogs();
      await this.clearGooseSessions();
      await this.clearConversationData();
      await this.clearDatabase();
      
      console.log(chalk.green.bold('\n✅ Cleanup completed successfully!\n'));
      
    } catch (error) {
      console.error(chalk.red('❌ Cleanup failed:'), error.message);
      process.exit(1);
    } finally {
      try {
        await this.db.close();
      } catch (error) {
        // Ignore close errors
      }
    }
  }

  async clearLocalLogs() {
    console.log(chalk.yellow('📋 Clearing local log files...'));
    
    let clearedCount = 0;
    
    for (const logFile of this.logFiles) {
      const filePath = path.join(this.projectDir, logFile);
      
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log(chalk.gray(`   ✓ Deleted: ${logFile}`));
        clearedCount++;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.log(chalk.yellow(`   ⚠ Could not delete ${logFile}: ${error.message}`));
        }
      }
    }
    
    console.log(chalk.green(`   Cleared ${clearedCount} log files`));
  }

  async clearGooseSessions() {
    console.log(chalk.yellow('🗂️  Clearing Goose sessions...'));
    
    try {
      await fs.access(this.gooseSessionsDir);
      const files = await fs.readdir(this.gooseSessionsDir);
      
      let clearedCount = 0;
      let totalSize = 0;
      
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const filePath = path.join(this.gooseSessionsDir, file);
          
          try {
            const stats = await fs.stat(filePath);
            totalSize += stats.size;
            await fs.unlink(filePath);
            console.log(chalk.gray(`   ✓ Deleted session: ${file}`));
            clearedCount++;
          } catch (error) {
            console.log(chalk.yellow(`   ⚠ Could not delete ${file}: ${error.message}`));
          }
        }
      }
      
      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
      console.log(chalk.green(`   Cleared ${clearedCount} session files (${sizeInMB}MB)`));
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('   No Goose sessions directory found'));
      } else {
        console.log(chalk.yellow(`   ⚠ Could not access sessions directory: ${error.message}`));
      }
    }
  }

  async clearConversationData() {
    console.log(chalk.yellow('💬 Clearing conversation data...'));
    
    // Clear any additional conversation files or cache
    const conversationFiles = [
      'conversation.json',
      '.conversation_cache',
      'session_state.json'
    ];
    
    let clearedCount = 0;
    
    for (const file of conversationFiles) {
      const filePath = path.join(this.projectDir, file);
      
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log(chalk.gray(`   ✓ Deleted: ${file}`));
        clearedCount++;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.log(chalk.yellow(`   ⚠ Could not delete ${file}: ${error.message}`));
        }
      }
    }
    
    console.log(chalk.green(`   Cleared ${clearedCount} conversation files`));
  }

  async clearDatabase() {
    console.log(chalk.yellow('🗄️  Clearing database...'));
    
    try {
      await this.db.init();
      
      // Get stats before clearing
      const stats = await this.db.getStats();
      console.log(chalk.gray(`   Found ${stats.sessions} sessions, ${stats.messages} messages`));
      
      if (stats.messages > 0 || stats.sessions > 0) {
        // Clear all messages and sessions
        const clearedMessages = await this.db.clearAllMessages();
        const sessions = await this.db.getAllSessions();
        
        for (const session of sessions) {
          await this.db.deleteSession(session.session_name);
        }
        
        console.log(chalk.green(`   ✓ Cleared ${clearedMessages} messages and ${sessions.length} sessions`));
        
        // Clean up the database file
        await this.db.vacuum();
        console.log(chalk.gray('   ✓ Database optimized'));
      } else {
        console.log(chalk.gray('   Database already empty'));
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('   No database found'));
      } else {
        console.log(chalk.yellow(`   ⚠ Could not clear database: ${error.message}`));
      }
    }
  }

  // Helper method to show what would be deleted (dry run)
  async showPreview() {
    console.log(chalk.blue.bold('\n👀 Preview: Files that would be deleted\n'));
    
    console.log(chalk.yellow('Local log files:'));
    for (const logFile of this.logFiles) {
      const filePath = path.join(this.projectDir, logFile);
      try {
        const stats = await fs.stat(filePath);
        const sizeInKB = (stats.size / 1024).toFixed(1);
        console.log(chalk.gray(`   • ${logFile} (${sizeInKB}KB)`));
      } catch (error) {
        // File doesn't exist
      }
    }
    
    console.log(chalk.yellow('\nGoose session files:'));
    try {
      const files = await fs.readdir(this.gooseSessionsDir);
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const filePath = path.join(this.gooseSessionsDir, file);
          try {
            const stats = await fs.stat(filePath);
            const sizeInKB = (stats.size / 1024).toFixed(1);
            console.log(chalk.gray(`   • ${file} (${sizeInKB}KB)`));
          } catch (error) {
            // File might be inaccessible
          }
        }
      }
    } catch (error) {
      console.log(chalk.gray('   No session files found'));
    }
    
    console.log(chalk.yellow('\nDatabase data:'));
    try {
      await this.db.init();
      const stats = await this.db.getStats();
      if (stats.sessions > 0 || stats.messages > 0) {
        console.log(chalk.gray(`   • ${stats.sessions} sessions`));
        console.log(chalk.gray(`   • ${stats.messages} messages`));
        console.log(chalk.gray(`   • ${stats.dbPages} database pages`));
      } else {
        console.log(chalk.gray('   No database data found'));
      }
    } catch (error) {
      console.log(chalk.gray('   No database found'));
    } finally {
      try {
        await this.db.close();
      } catch (error) {
        // Ignore close errors
      }
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const cleanup = new GooseCleanup();
  
  if (args.includes('--preview') || args.includes('-p')) {
    await cleanup.showPreview();
    console.log(chalk.blue('\nRun without --preview to actually delete files\n'));
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.blue.bold('\n🧹 Goose Cleanup Tool\n'));
    console.log('Usage:');
    console.log('  npm run clearall           # Delete all files');
    console.log('  npm run clearall -- --preview    # Show what would be deleted');
    console.log('  npm run clearall -- --help       # Show this help\n');
  } else {
    // Confirm before deletion
    console.log(chalk.yellow('⚠️  This will permanently delete:'));
    console.log('   • All local log files');
    console.log('   • All Goose session files');
    console.log('   • All conversation data');
    
    // Note: In a real interactive environment, you'd want to use readline
    // For now, proceeding with deletion
    console.log(chalk.gray('\nProceeding with cleanup...\n'));
    await cleanup.run();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = GooseCleanup;