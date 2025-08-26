const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class WingmanConfig {
  constructor() {
    this.configVersion = '2.0';
    this.legacyVersion = '1.0';
    
    // Central configuration paths
    this.wingmanHome = this.resolveWingmanHome();
    this.configFile = path.join(this.wingmanHome, 'config.json');
    this.recipesDir = path.join(this.wingmanHome, 'recipes');
    this.dataDir = path.join(this.wingmanHome, 'data');
    this.backupDir = path.join(this.wingmanHome, 'backup');
    
    // Legacy paths for backward compatibility
    this.legacyRecipesDir = path.join(process.cwd(), 'recipes');
    this.legacyDataDir = path.join(process.cwd(), 'data');
    
    // Default configuration
    this.defaultConfig = {
      version: this.configVersion,
      recipe_management: {
        mode: 'centralized',
        migration_completed: false,
        paths: {
          recipes: this.recipesDir,
          database: path.join(this.dataDir, 'wingman.db'),
          backup: this.backupDir
        },
        compatibility: {
          support_legacy: true,
          legacy_recipes: this.legacyRecipesDir,
          legacy_database: path.join(this.legacyDataDir, 'wingman.db')
        }
      },
      worktree: {
        current: this.getCurrentWorktree(),
        identification: true
      }
    };
    
    this.config = null;
  }

  resolveWingmanHome() {
    // Priority: ENV var > ~/.wingman
    return process.env.WINGMAN_HOME || 
           process.env.WINGMAN_RECIPE_HOME || // Legacy support
           path.join(os.homedir(), '.wingman');
  }

  getCurrentWorktree() {
    try {
      // Try to detect current worktree/branch
      const cwd = process.cwd();
      const parts = cwd.split(path.sep);
      const worktreeIndex = parts.findIndex(part => part === '.worktrees');
      
      if (worktreeIndex !== -1 && worktreeIndex + 1 < parts.length) {
        return parts[worktreeIndex + 1];
      }
      
      // Fallback: try to read from git if available
      const gitDir = path.join(cwd, '.git');
      return 'main'; // Default fallback
    } catch (error) {
      return 'main';
    }
  }

  async init() {
    await this.loadOrCreateConfig();
    await this.ensureDirectories();
  }

  async loadOrCreateConfig() {
    try {
      const configData = await fs.readFile(this.configFile, 'utf8');
      this.config = JSON.parse(configData);
      
      // Validate version and upgrade if needed
      if (!this.config.version || this.config.version === this.legacyVersion) {
        await this.upgradeConfig();
      }
      
      // Update current worktree
      this.config.worktree.current = this.getCurrentWorktree();
      await this.saveConfig();
      
    } catch (error) {
      // Config doesn't exist or is corrupted, create default
      this.config = { ...this.defaultConfig };
      await this.saveConfig();
      console.log('Created new Wingman configuration');
    }
  }

  async upgradeConfig() {
    console.log('Upgrading Wingman configuration to version 2.0...');
    
    const oldConfig = { ...this.config };
    this.config = {
      ...this.defaultConfig,
      recipe_management: {
        ...this.defaultConfig.recipe_management,
        migration_completed: false, // Trigger migration
        legacy_config: oldConfig // Preserve old config for reference
      }
    };
    
    await this.saveConfig();
  }

  async saveConfig() {
    await this.ensureDirectories();
    await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
  }

  async ensureDirectories() {
    const dirs = [
      this.wingmanHome,
      this.recipesDir,
      path.join(this.recipesDir, 'built-in'),
      path.join(this.recipesDir, 'user'), 
      path.join(this.recipesDir, 'imported'),
      this.dataDir,
      this.backupDir
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  // Path resolution methods
  getRecipesPath() {
    return this.config?.recipe_management?.paths?.recipes || this.recipesDir;
  }

  getDatabasePath() {
    return this.config?.recipe_management?.paths?.database || 
           path.join(this.dataDir, 'wingman.db');
  }

  getBackupPath() {
    return this.config?.recipe_management?.paths?.backup || this.backupDir;
  }

  // Legacy support methods
  async shouldUseLegacy() {
    if (!this.config?.recipe_management?.compatibility?.support_legacy) {
      return false;
    }

    // Check if migration has been completed
    if (this.config?.recipe_management?.migration_completed) {
      return false;
    }

    // Check if legacy directories exist and have content
    try {
      const legacyStats = await fs.stat(this.legacyRecipesDir);
      if (legacyStats.isDirectory()) {
        const legacyFiles = await fs.readdir(this.legacyRecipesDir);
        return legacyFiles.length > 0;
      }
    } catch (error) {
      // Legacy directory doesn't exist
    }

    return false;
  }

  async getLegacyRecipesPath() {
    return this.config?.recipe_management?.compatibility?.legacy_recipes || 
           this.legacyRecipesDir;
  }

  async getLegacyDatabasePath() {
    return this.config?.recipe_management?.compatibility?.legacy_database ||
           path.join(this.legacyDataDir, 'wingman.db');
  }

  // Migration support
  async markMigrationCompleted() {
    if (!this.config) {
      await this.loadOrCreateConfig();
    }
    
    this.config.recipe_management.migration_completed = true;
    this.config.recipe_management.migration_date = new Date().toISOString();
    await this.saveConfig();
  }

  async needsMigration() {
    if (!this.config) {
      await this.loadOrCreateConfig();
    }
    
    return !this.config.recipe_management.migration_completed && 
           await this.shouldUseLegacy();
  }

  // Worktree support
  getWorktreeId() {
    return this.config?.worktree?.current || 'main';
  }

  async updateWorktreeId(worktreeId) {
    if (!this.config) {
      await this.loadOrCreateConfig();
    }
    
    this.config.worktree.current = worktreeId;
    await this.saveConfig();
  }

  // Configuration getters
  getConfig() {
    return this.config;
  }

  getVersion() {
    return this.config?.version || this.legacyVersion;
  }

  isCentralized() {
    return this.config?.recipe_management?.mode === 'centralized';
  }

  // Backup and rollback support
  async createBackup(source, label = 'migration') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${label}-${timestamp}`;
    const backupPath = path.join(this.getBackupPath(), backupName);
    
    await fs.mkdir(backupPath, { recursive: true });
    
    // Copy source directory to backup
    await this.copyDirectory(source, backupPath);
    
    return backupPath;
  }

  async copyDirectory(source, destination) {
    try {
      const stats = await fs.stat(source);
      
      if (stats.isDirectory()) {
        await fs.mkdir(destination, { recursive: true });
        const entries = await fs.readdir(source);
        
        for (const entry of entries) {
          const sourcePath = path.join(source, entry);
          const destPath = path.join(destination, entry);
          await this.copyDirectory(sourcePath, destPath);
        }
      } else {
        await fs.copyFile(source, destination);
      }
    } catch (error) {
      console.warn(`Warning: Could not copy ${source} to ${destination}:`, error.message);
    }
  }

  // Static factory method
  static async create() {
    const config = new WingmanConfig();
    await config.init();
    return config;
  }
}

module.exports = WingmanConfig;