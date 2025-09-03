#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

class WingmanSetup {
  constructor() {
    this.wingmanDir = path.join(os.homedir(), '.wingman');
    this.templatesDir = path.join(__dirname, '..', 'templates');
  }

  log(message, color = 'cyan') {
    console.log(chalk[color](`🛠️  ${message}`));
  }

  warn(message) {
    console.log(chalk.yellow(`⚠️  ${message}`));
  }

  error(message) {
    console.log(chalk.red(`❌ ${message}`));
  }

  success(message) {
    console.log(chalk.green(`✅ ${message}`));
  }

  async createDirectory(dirPath, description) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      this.success(`Created ${description}: ${dirPath}`);
      return true;
    } else {
      this.log(`${description} already exists: ${dirPath}`, 'gray');
      return false;
    }
  }

  async copyTemplate(templatePath, targetPath, description) {
    if (!fs.existsSync(targetPath)) {
      if (fs.existsSync(templatePath)) {
        fs.copyFileSync(templatePath, targetPath);
        this.success(`Created ${description}: ${targetPath}`);
        return true;
      } else {
        this.error(`Template not found: ${templatePath}`);
        return false;
      }
    } else {
      this.log(`${description} already exists: ${targetPath}`, 'gray');
      return false;
    }
  }

  async setupEnvironmentFile() {
    const templatePath = path.join(this.templatesDir, 'mcp-servers', '.env.example');
    const targetPath = path.join(this.wingmanDir, '.env');
    
    const created = await this.copyTemplate(templatePath, targetPath, 'Environment configuration');
    
    if (created) {
      // Set secure permissions on the env file
      try {
        fs.chmodSync(targetPath, 0o600);
        this.success('Set secure permissions (600) on .env file');
      } catch (error) {
        this.warn('Could not set secure permissions on .env file');
      }
    }
    
    return created;
  }

  async setupSchedulerConfig() {
    const templatePath = path.join(__dirname, '..', 'scheduler', 'config.example.json');
    const targetPath = path.join(this.wingmanDir, 'scheduler-config.json');
    
    return await this.copyTemplate(templatePath, targetPath, 'Scheduler configuration');
  }

  async setupMcpServers() {
    const mcpServersDir = path.join(this.wingmanDir, 'mcp-servers');
    const templatePath = path.join(this.templatesDir, 'mcp-servers', 'servers.json');
    const targetPath = path.join(mcpServersDir, 'servers.json');

    await this.createDirectory(mcpServersDir, 'MCP servers directory');
    return await this.copyTemplate(templatePath, targetPath, 'MCP servers configuration');
  }

  async setupRecipes() {
    const recipesDir = path.join(this.wingmanDir, 'recipes');
    await this.createDirectory(recipesDir, 'Recipes directory');

    const recipeTemplates = [
      { file: 'planner.example.json', name: 'planner.json', description: 'Planner recipe' },
      { file: 'readonly-planner.example.json', name: 'readonly-planner.json', description: 'Read-only planner recipe' },
      { file: 'writing-assistant.example.json', name: 'writing-assistant.json', description: 'Writing assistant recipe' }
    ];

    let created = false;
    for (const recipe of recipeTemplates) {
      const templatePath = path.join(this.templatesDir, 'recipes', recipe.file);
      const targetPath = path.join(recipesDir, recipe.name);
      const wasCreated = await this.copyTemplate(templatePath, targetPath, recipe.description);
      created = created || wasCreated;
    }

    return created;
  }

  checkEnvironment() {
    const codePath = process.env.WINGMAN_CODE_PATH || path.join(os.homedir(), 'code');
    
    this.log(`Checking environment...`);
    this.log(`Code path: ${codePath}`);
    
    if (!fs.existsSync(codePath)) {
      this.warn(`Code directory does not exist: ${codePath}`);
      this.log(`You may want to set WINGMAN_CODE_PATH environment variable`, 'yellow');
      this.log(`Or create the directory: mkdir -p "${codePath}"`, 'yellow');
    } else {
      this.success(`Code directory found: ${codePath}`);
    }
  }

  async run(options = {}) {
    const { force = false, silent = false } = options;

    if (!silent) {
      console.log(chalk.cyan.bold('\n🚀 Wingman Setup\n'));
    }

    // Create main directory
    await this.createDirectory(this.wingmanDir, 'Wingman configuration directory');

    // Setup components
    let anyChanges = false;
    anyChanges = await this.setupEnvironmentFile() || anyChanges;
    anyChanges = await this.setupSchedulerConfig() || anyChanges;
    anyChanges = await this.setupMcpServers() || anyChanges;
    anyChanges = await this.setupRecipes() || anyChanges;

    // Check environment
    if (!silent) {
      this.checkEnvironment();
    }

    if (!silent) {
      if (anyChanges) {
        console.log(chalk.green.bold('\n✨ Setup completed! New files were created.'));
        console.log(chalk.cyan('\nNext steps:'));
        console.log(chalk.white('1. Edit ~/.wingman/.env to add your API keys'));
        console.log(chalk.white('2. Customize recipes in ~/.wingman/recipes/'));
        console.log(chalk.white('3. Set WINGMAN_CODE_PATH if your projects are not in ~/code'));
        console.log(chalk.white('4. Run: npm start\n'));
      } else {
        console.log(chalk.green('\n✅ All configuration files already exist.'));
        console.log(chalk.cyan('Your Wingman setup is ready to go!\n'));
      }
    }

    return anyChanges;
  }

  // Check if setup is needed (for auto-setup)
  async isSetupNeeded() {
    const requiredFiles = [
      path.join(this.wingmanDir, '.env'),
      path.join(this.wingmanDir, 'mcp-servers', 'servers.json')
    ];

    return !requiredFiles.every(file => fs.existsSync(file));
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const silent = args.includes('--silent');
  const checkOnly = args.includes('--check');

  const setup = new WingmanSetup();

  if (checkOnly) {
    setup.isSetupNeeded().then(needed => {
      console.log(needed ? 'true' : 'false');
      process.exit(needed ? 1 : 0);
    });
  } else {
    setup.run({ force, silent }).catch(error => {
      console.error(chalk.red('Setup failed:'), error.message);
      process.exit(1);
    });
  }
}

module.exports = WingmanSetup;