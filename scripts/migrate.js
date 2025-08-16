#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { DatabaseManager } = require('../lib/database');

class DataMigration {
  constructor() {
    this.projectDir = path.dirname(__dirname);
    this.db = new DatabaseManager();
    this.conversationFile = path.join(this.projectDir, 'conversation.json');
  }

  async run() {
    console.log(chalk.blue.bold('\n📦 Data Migration: JSON to SQLite\n'));
    
    try {
      // Initialize database
      console.log(chalk.yellow('🔧 Initializing database...'));
      await this.db.init();
      
      // Check if migration is needed
      const needsMigration = await this.checkMigrationNeeded();
      if (!needsMigration) {
        console.log(chalk.green('✅ Database already migrated or no data to migrate\n'));
        return;
      }
      
      // Backup existing JSON data
      await this.backupJsonData();
      
      // Migrate conversation data
      await this.migrateConversationData();
      
      // Verify migration
      await this.verifyMigration();
      
      console.log(chalk.green.bold('\n✅ Migration completed successfully!\n'));
      
    } catch (error) {
      console.error(chalk.red('❌ Migration failed:'), error.message);
      console.error(chalk.gray(error.stack));
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }

  async checkMigrationNeeded() {
    try {
      // Check if JSON file exists
      await fs.access(this.conversationFile);
      
      // Check if database has any messages
      const stats = await this.db.getStats();
      
      if (stats.messages > 0) {
        console.log(chalk.yellow(`   Database already contains ${stats.messages} messages`));
        const prompt = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        // In a real scenario, you'd want to prompt the user
        // For now, we'll assume they want to proceed
        console.log(chalk.gray('   Proceeding with migration (this will merge data)'));
        prompt.close();
      }
      
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('   No conversation.json file found'));
        return false;
      }
      throw error;
    }
  }

  async backupJsonData() {
    console.log(chalk.yellow('💾 Creating backup of JSON data...'));
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.projectDir, `conversation-backup-${timestamp}.json`);
      
      await fs.copyFile(this.conversationFile, backupFile);
      console.log(chalk.gray(`   ✓ Backup created: ${path.basename(backupFile)}`));
    } catch (error) {
      console.log(chalk.yellow(`   ⚠ Could not create backup: ${error.message}`));
    }
  }

  async migrateConversationData() {
    console.log(chalk.yellow('🔄 Migrating conversation data...'));
    
    try {
      const data = await fs.readFile(this.conversationFile, 'utf8');
      const conversations = JSON.parse(data);
      
      if (!Array.isArray(conversations) || conversations.length === 0) {
        console.log(chalk.gray('   No conversation data to migrate'));
        return;
      }
      
      console.log(chalk.gray(`   Found ${conversations.length} messages to migrate`));
      
      // Group messages by session or use default session
      const sessionName = 'migrated-session';
      let migratedCount = 0;
      
      for (const message of conversations) {
        try {
          // Ensure message has required fields
          const normalizedMessage = {
            role: message.role || 'user',
            content: message.content || '',
            timestamp: message.timestamp || new Date().toISOString(),
            source: message.source || 'json-migration',
            id: message.id || null
          };
          
          await this.db.addMessage(sessionName, normalizedMessage);
          migratedCount++;
          
          if (migratedCount % 50 === 0) {
            console.log(chalk.gray(`   Migrated ${migratedCount}/${conversations.length} messages...`));
          }
        } catch (error) {
          console.log(chalk.yellow(`   ⚠ Failed to migrate message: ${error.message}`));
        }
      }
      
      console.log(chalk.green(`   ✓ Successfully migrated ${migratedCount} messages to session '${sessionName}'`));
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('   No conversation.json file found'));
      } else {
        throw error;
      }
    }
  }

  async verifyMigration() {
    console.log(chalk.yellow('🔍 Verifying migration...'));
    
    const stats = await this.db.getStats();
    console.log(chalk.gray(`   Database now contains:`));
    console.log(chalk.gray(`   • ${stats.sessions} sessions`));
    console.log(chalk.gray(`   • ${stats.messages} messages`));
    
    // Check message integrity
    const allMessages = await this.db.getAllMessages();
    let validMessages = 0;
    
    for (const message of allMessages) {
      if (message.role && message.content && message.timestamp) {
        validMessages++;
      }
    }
    
    console.log(chalk.gray(`   • ${validMessages}/${allMessages.length} messages are valid`));
    
    if (validMessages === allMessages.length) {
      console.log(chalk.green('   ✓ All messages migrated successfully'));
    } else {
      console.log(chalk.yellow(`   ⚠ ${allMessages.length - validMessages} messages may have issues`));
    }
  }

  async rollback() {
    console.log(chalk.yellow.bold('\n🔄 Rolling back migration...\n'));
    
    try {
      // Find the most recent backup
      const files = await fs.readdir(this.projectDir);
      const backupFiles = files.filter(f => f.startsWith('conversation-backup-') && f.endsWith('.json'));
      
      if (backupFiles.length === 0) {
        console.log(chalk.red('❌ No backup files found'));
        return;
      }
      
      // Sort by timestamp (newest first)
      backupFiles.sort().reverse();
      const latestBackup = backupFiles[0];
      
      // Restore backup
      await fs.copyFile(
        path.join(this.projectDir, latestBackup),
        this.conversationFile
      );
      
      console.log(chalk.green(`✅ Restored from backup: ${latestBackup}`));
      
      // Clear database
      await this.db.init();
      await this.db.clearAllMessages();
      
      console.log(chalk.green('✅ Database cleared'));
      
    } catch (error) {
      console.error(chalk.red('❌ Rollback failed:'), error.message);
    } finally {
      await this.db.close();
    }
  }

  async status() {
    console.log(chalk.blue.bold('\n📊 Migration Status\n'));
    
    try {
      await this.db.init();
      
      // Database stats
      const stats = await this.db.getStats();
      console.log(chalk.yellow('Database:'));
      console.log(chalk.gray(`   • Sessions: ${stats.sessions}`));
      console.log(chalk.gray(`   • Messages: ${stats.messages}`));
      console.log(chalk.gray(`   • DB Size: ${stats.dbPages} pages`));
      
      // JSON file status
      console.log(chalk.yellow('\nJSON Files:'));
      try {
        await fs.access(this.conversationFile);
        const data = await fs.readFile(this.conversationFile, 'utf8');
        const conversations = JSON.parse(data);
        console.log(chalk.gray(`   • conversation.json: ${conversations.length} messages`));
      } catch (error) {
        console.log(chalk.gray('   • conversation.json: not found'));
      }
      
      // Backup files
      const files = await fs.readdir(this.projectDir);
      const backupFiles = files.filter(f => f.startsWith('conversation-backup-'));
      console.log(chalk.gray(`   • Backup files: ${backupFiles.length}`));
      
    } catch (error) {
      console.error(chalk.red('❌ Status check failed:'), error.message);
    } finally {
      await this.db.close();
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const migration = new DataMigration();
  
  if (args.includes('--rollback')) {
    await migration.rollback();
  } else if (args.includes('--status')) {
    await migration.status();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.blue.bold('\n📦 Data Migration Tool\n'));
    console.log('Usage:');
    console.log('  npm run db:migrate           # Run migration');
    console.log('  npm run db:migrate -- --status     # Show migration status');
    console.log('  npm run db:migrate -- --rollback   # Rollback to JSON backup');
    console.log('  npm run db:migrate -- --help       # Show this help\n');
  } else {
    await migration.run();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = DataMigration;