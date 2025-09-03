const WingmanSetup = require('../scripts/setup');
const chalk = require('chalk');

/**
 * Auto-setup utility that runs during server startup
 */
class AutoSetup {
  constructor() {
    this.setup = new WingmanSetup();
  }

  /**
   * Check if setup is needed and prompt user
   */
  async checkAndPrompt() {
    const setupNeeded = await this.setup.isSetupNeeded();
    
    if (setupNeeded) {
      console.log(chalk.yellow('\n⚠️  First-time setup needed!'));
      console.log(chalk.cyan('Wingman needs to create configuration files in ~/.wingman/'));
      console.log(chalk.gray('This includes API key templates, recipes, and MCP server configs.\n'));

      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      return new Promise((resolve) => {
        rl.question(chalk.white('Run setup now? (Y/n): '), async (answer) => {
          rl.close();
          
          const shouldSetup = !answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
          
          if (shouldSetup) {
            console.log(chalk.cyan('\nRunning first-time setup...\n'));
            await this.setup.run({ silent: false });
            resolve(true);
          } else {
            console.log(chalk.yellow('\nSetup skipped. You can run it later with: npm run setup'));
            console.log(chalk.red('Note: The application may not work correctly without proper configuration.\n'));
            resolve(false);
          }
        });
      });
    }
    
    return false; // No setup needed
  }

  /**
   * Run silent setup without prompting (for automated scenarios)
   */
  async runSilent() {
    const setupNeeded = await this.setup.isSetupNeeded();
    
    if (setupNeeded) {
      console.log(chalk.cyan('🛠️  Running first-time setup...'));
      await this.setup.run({ silent: true });
      console.log(chalk.green('✅ Setup completed automatically'));
      return true;
    }
    
    return false;
  }

  /**
   * Check setup status and show information
   */
  async checkStatus() {
    const setupNeeded = await this.setup.isSetupNeeded();
    
    if (setupNeeded) {
      console.log(chalk.yellow('⚠️  Setup required: Run `npm run setup` to configure Wingman'));
    } else {
      console.log(chalk.green('✅ Wingman is properly configured'));
    }
    
    return !setupNeeded;
  }
}

module.exports = AutoSetup;