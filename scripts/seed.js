#!/usr/bin/env node

const chalk = require('chalk');
const { DatabaseManager } = require('../lib/database');

class DatabaseSeeder {
  constructor() {
    this.db = new DatabaseManager();
  }

  async run() {
    console.log(chalk.blue.bold('\n🌱 Database Seeder\n'));
    
    try {
      await this.db.init();
      
      // Check if database already has data
      const stats = await this.db.getStats();
      if (stats.messages > 0 || stats.sessions > 0) {
        console.log(chalk.yellow('⚠️  Database already contains data:'));
        console.log(chalk.gray(`   • ${stats.sessions} sessions`));
        console.log(chalk.gray(`   • ${stats.messages} messages`));
        console.log(chalk.yellow('\nUse --force to seed anyway, or --clear to clear first\n'));
        return;
      }
      
      await this.seedSampleData();
      
      console.log(chalk.green.bold('\n✅ Database seeded successfully!\n'));
      
    } catch (error) {
      console.error(chalk.red('❌ Seeding failed:'), error.message);
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }

  async seedSampleData() {
    console.log(chalk.yellow('📝 Creating sample data...'));
    
    // Create sample sessions
    const sessions = [
      {
        name: 'web-development-chat',
        messages: [
          {
            role: 'user',
            content: 'Help me build a React component for user authentication',
            source: 'web-interface'
          },
          {
            role: 'assistant',
            content: 'I\'ll help you create a React authentication component. Let\'s start with a login form...',
            source: 'goose'
          },
          {
            role: 'user',
            content: 'Can you add validation to the form?',
            source: 'web-interface'
          },
          {
            role: 'assistant',
            content: 'Absolutely! Here\'s how we can add form validation using React hooks...',
            source: 'goose'
          }
        ]
      },
      {
        name: 'debugging-session',
        messages: [
          {
            role: 'user',
            content: 'I\'m getting a "Cannot read property" error in my Node.js application',
            source: 'cli'
          },
          {
            role: 'assistant',
            content: 'This error typically occurs when trying to access a property on null or undefined. Let me help you debug this...',
            source: 'goose'
          },
          {
            role: 'system',
            content: 'Command executed: npm test',
            source: 'command'
          },
          {
            role: 'assistant',
            content: 'I see the issue in your test output. The problem is in line 42 where you\'re accessing user.profile before checking if user exists.',
            source: 'goose'
          }
        ]
      },
      {
        name: 'api-design-discussion',
        messages: [
          {
            role: 'user',
            content: 'What\'s the best approach for designing a RESTful API for a blog system?',
            source: 'web-interface'
          },
          {
            role: 'assistant',
            content: 'Great question! For a blog system, you\'ll want to consider these main resources: users, posts, comments, and categories. Here\'s how I\'d structure the endpoints...',
            source: 'goose'
          }
        ]
      }
    ];

    let totalMessages = 0;
    
    for (const sessionData of sessions) {
      console.log(chalk.gray(`   Creating session: ${sessionData.name}`));
      
      // Create session
      await this.db.createSession(sessionData.name);
      
      // Add messages with realistic timestamps
      let messageTime = new Date();
      messageTime.setHours(messageTime.getHours() - 2); // Start 2 hours ago
      
      for (const message of sessionData.messages) {
        // Add some time between messages (1-5 minutes)
        messageTime = new Date(messageTime.getTime() + Math.random() * 5 * 60 * 1000 + 60 * 1000);
        
        const messageWithTimestamp = {
          ...message,
          timestamp: messageTime.toISOString(),
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
        };
        
        await this.db.addMessage(sessionData.name, messageWithTimestamp);
        totalMessages++;
      }
    }
    
    console.log(chalk.green(`   ✓ Created ${sessions.length} sessions with ${totalMessages} messages`));
    
    // Add some metadata
    console.log(chalk.gray('   Adding session metadata...'));
    await this.db.setSessionMetadata('web-development-chat', 'project_type', 'React');
    await this.db.setSessionMetadata('web-development-chat', 'complexity', 'intermediate');
    await this.db.setSessionMetadata('debugging-session', 'error_type', 'runtime');
    await this.db.setSessionMetadata('debugging-session', 'resolved', 'true');
    await this.db.setSessionMetadata('api-design-discussion', 'domain', 'blog');
    
    console.log(chalk.green('   ✓ Added session metadata'));
  }

  async clear() {
    console.log(chalk.yellow.bold('\n🗑️  Clearing database...\n'));
    
    try {
      await this.db.init();
      
      const messageCount = await this.db.clearAllMessages();
      const sessions = await this.db.getAllSessions();
      
      for (const session of sessions) {
        await this.db.deleteSession(session.session_name);
      }
      
      console.log(chalk.green(`✅ Cleared ${messageCount} messages and ${sessions.length} sessions\n`));
      
    } catch (error) {
      console.error(chalk.red('❌ Clear failed:'), error.message);
    } finally {
      await this.db.close();
    }
  }

  async force() {
    console.log(chalk.yellow.bold('\n🚀 Force seeding database...\n'));
    
    try {
      await this.db.init();
      await this.seedSampleData();
      console.log(chalk.green.bold('\n✅ Database force-seeded successfully!\n'));
    } catch (error) {
      console.error(chalk.red('❌ Force seeding failed:'), error.message);
    } finally {
      await this.db.close();
    }
  }

  async status() {
    console.log(chalk.blue.bold('\n📊 Database Status\n'));
    
    try {
      await this.db.init();
      
      const stats = await this.db.getStats();
      const sessions = await this.db.getAllSessions();
      
      console.log(chalk.yellow('Overview:'));
      console.log(chalk.gray(`   • Total sessions: ${stats.sessions}`));
      console.log(chalk.gray(`   • Total messages: ${stats.messages}`));
      console.log(chalk.gray(`   • Database pages: ${stats.dbPages}`));
      
      if (sessions.length > 0) {
        console.log(chalk.yellow('\nSessions:'));
        for (const session of sessions) {
          const messageCount = await this.db.getMessages(session.session_name);
          console.log(chalk.gray(`   • ${session.session_name}: ${messageCount.length} messages (${session.status})`));
        }
      }
      
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
  const seeder = new DatabaseSeeder();
  
  if (args.includes('--clear')) {
    await seeder.clear();
  } else if (args.includes('--force')) {
    await seeder.force();
  } else if (args.includes('--status')) {
    await seeder.status();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.blue.bold('\n🌱 Database Seeder\n'));
    console.log('Usage:');
    console.log('  npm run db:seed              # Seed database (only if empty)');
    console.log('  npm run db:seed -- --force         # Force seed (add to existing data)');
    console.log('  npm run db:seed -- --clear         # Clear all data');
    console.log('  npm run db:seed -- --status        # Show database status');
    console.log('  npm run db:seed -- --help          # Show this help\n');
    console.log('Sample data includes:');
    console.log('  • 3 conversation sessions');
    console.log('  • Various message types (user, assistant, system)');
    console.log('  • Realistic timestamps');
    console.log('  • Session metadata examples\n');
  } else {
    await seeder.run();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = DatabaseSeeder;