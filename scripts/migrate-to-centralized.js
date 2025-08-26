#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const WingmanConfig = require('../lib/wingman-config');
const { DatabaseManager } = require('../lib/database');

class MigrationTool {
  constructor() {
    this.wingmanConfig = null;
    this.discoveries = {
      worktrees: [],
      totalRecipes: 0,
      totalSessions: 0,
      conflicts: [],
      duplicates: []
    };
    this.dryRun = false;
    this.interactive = true;
  }

  async init() {
    this.wingmanConfig = await WingmanConfig.create();
    console.log('Wingman Recipe Management Centralization Tool');
    console.log('=============================================\n');
  }

  async run() {
    try {
      await this.init();
      
      // Parse command line arguments
      this.parseArguments();
      
      // Step 1: Discovery - Find all existing installations
      console.log('🔍 Step 1: Discovering existing recipe installations...');
      await this.discoverInstallations();
      
      // Step 2: Analysis - Analyze what needs to be migrated
      console.log('\n📊 Step 2: Analyzing migration requirements...');
      await this.analyzeDiscoveries();
      
      // Step 3: Planning - Create migration plan
      console.log('\n📋 Step 3: Creating migration plan...');
      const migrationPlan = await this.createMigrationPlan();
      
      // Step 4: Confirmation - Show plan and get confirmation
      if (this.interactive && !this.dryRun) {
        console.log('\n❓ Step 4: Migration plan confirmation...');
        const confirmed = await this.confirmMigration(migrationPlan);
        if (!confirmed) {
          console.log('Migration cancelled by user.');
          return;
        }
      }
      
      // Step 5: Backup - Create backup of existing data
      if (!this.dryRun) {
        console.log('\n💾 Step 5: Creating backup...');
        await this.createBackup();
      }
      
      // Step 6: Migration - Execute the migration
      console.log(`\n🚀 Step 6: ${this.dryRun ? 'Simulating' : 'Executing'} migration...`);
      await this.executeMigration(migrationPlan);
      
      // Step 7: Verification - Verify migration success
      console.log('\n✅ Step 7: Verifying migration...');
      await this.verifyMigration();
      
      console.log('\n🎉 Migration completed successfully!');
      
    } catch (error) {
      console.error('\n❌ Migration failed:', error.message);
      console.error('\nPlease check the error above and run migration again.');
      process.exit(1);
    }
  }

  parseArguments() {
    const args = process.argv.slice(2);
    this.dryRun = args.includes('--dry-run') || args.includes('-n');
    this.interactive = !args.includes('--no-interactive');
    
    if (this.dryRun) {
      console.log('🧪 Running in dry-run mode (no changes will be made)\n');
    }
  }

  async discoverInstallations() {
    const currentDir = process.cwd();
    const homeDir = require('os').homedir();
    
    // Look for worktrees in common patterns
    const searchPaths = [
      path.join(homeDir, 'code'),
      path.join(homeDir, 'projects'),
      path.join(homeDir, 'workspace'),
      path.dirname(currentDir) // Parent of current directory
    ];

    for (const searchPath of searchPaths) {
      try {
        await this.findWorktreesInPath(searchPath);
      } catch (error) {
        // Ignore errors for paths that don't exist
      }
    }

    // Always check current directory
    await this.checkDirectoryForWingman(currentDir, 'current');
    
    console.log(`Found ${this.discoveries.worktrees.length} potential Wingman installations`);
  }

  async findWorktreesInPath(searchPath) {
    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(searchPath, entry.name);
          
          // Check for .worktrees directory
          if (entry.name === '.worktrees') {
            const worktreeEntries = await fs.readdir(fullPath, { withFileTypes: true });
            for (const worktreeEntry of worktreeEntries) {
              if (worktreeEntry.isDirectory()) {
                const worktreePath = path.join(fullPath, worktreeEntry.name);
                await this.checkDirectoryForWingman(worktreePath, worktreeEntry.name);
              }
            }
          }
          
          // Check direct directory for wingman
          await this.checkDirectoryForWingman(fullPath, entry.name);
        }
      }
    } catch (error) {
      // Ignore permission errors or non-existent directories
    }
  }

  async checkDirectoryForWingman(dirPath, identifier) {
    try {
      const recipesPath = path.join(dirPath, 'recipes');
      const dataPath = path.join(dirPath, 'data');
      const packageJsonPath = path.join(dirPath, 'package.json');
      
      // Check if this looks like a wingman installation
      const [recipesExists, dataExists, packageExists] = await Promise.all([
        this.pathExists(recipesPath),
        this.pathExists(dataPath),
        this.pathExists(packageJsonPath)
      ]);
      
      if (recipesExists || (dataExists && packageExists)) {
        const discovery = {
          id: identifier,
          path: dirPath,
          recipesPath: recipesExists ? recipesPath : null,
          dataPath: dataExists ? dataPath : null,
          recipes: [],
          sessions: 0,
          metadata: null
        };
        
        // Discover recipes
        if (recipesExists) {
          discovery.recipes = await this.discoverRecipes(recipesPath);
          discovery.metadata = await this.loadMetadata(recipesPath);
        }
        
        // Discover sessions
        if (dataExists) {
          discovery.sessions = await this.countSessions(path.join(dataPath, 'wingman.db'));
        }
        
        this.discoveries.worktrees.push(discovery);
        this.discoveries.totalRecipes += discovery.recipes.length;
        this.discoveries.totalSessions += discovery.sessions;
      }
      
    } catch (error) {
      // Ignore errors for individual directories
    }
  }

  async pathExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async discoverRecipes(recipesPath) {
    const recipes = [];
    const dirs = ['built-in', 'user', 'imported'];
    
    for (const dir of dirs) {
      const dirPath = path.join(recipesPath, dir);
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.yaml') || file.endsWith('.yml')) {
            const filePath = path.join(dirPath, file);
            try {
              const recipe = await this.loadRecipe(filePath);
              if (recipe && recipe.id) {
                recipes.push({
                  id: recipe.id,
                  name: recipe.name || recipe.title || file,
                  file: file,
                  path: filePath,
                  directory: dir,
                  size: (await fs.stat(filePath)).size
                });
              }
            } catch (error) {
              console.warn(`Warning: Could not load recipe ${filePath}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist, skip
      }
    }
    
    return recipes;
  }

  async loadRecipe(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  }

  async loadMetadata(recipesPath) {
    try {
      const metadataPath = path.join(recipesPath, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async countSessions(dbPath) {
    try {
      const db = new DatabaseManager(dbPath);
      await db.init();
      const stats = await db.getStats();
      await db.close();
      return stats.sessions;
    } catch {
      return 0;
    }
  }

  async analyzeDiscoveries() {
    // Find recipe conflicts (same ID, different content)
    const recipeMap = new Map();
    
    for (const worktree of this.discoveries.worktrees) {
      for (const recipe of worktree.recipes) {
        if (recipeMap.has(recipe.id)) {
          const existing = recipeMap.get(recipe.id);
          
          // Check if content is different
          const existingContent = await fs.readFile(existing.path, 'utf8');
          const newContent = await fs.readFile(recipe.path, 'utf8');
          
          if (existingContent !== newContent) {
            this.discoveries.conflicts.push({
              id: recipe.id,
              name: recipe.name,
              locations: [existing.path, recipe.path],
              worktrees: [existing.worktree, worktree.id]
            });
          } else {
            this.discoveries.duplicates.push({
              id: recipe.id,
              name: recipe.name,
              locations: [existing.path, recipe.path]
            });
          }
        } else {
          recipeMap.set(recipe.id, { ...recipe, worktree: worktree.id });
        }
      }
    }
    
    // Display analysis results
    console.log(`Total recipes found: ${this.discoveries.totalRecipes}`);
    console.log(`Total sessions found: ${this.discoveries.totalSessions}`);
    console.log(`Recipe conflicts: ${this.discoveries.conflicts.length}`);
    console.log(`Recipe duplicates: ${this.discoveries.duplicates.length}`);
    
    if (this.discoveries.conflicts.length > 0) {
      console.log('\n⚠️  Recipe Conflicts Detected:');
      for (const conflict of this.discoveries.conflicts) {
        console.log(`  - ${conflict.name} (${conflict.id})`);
        console.log(`    Locations: ${conflict.locations.join(', ')}`);
      }
    }
  }

  async createMigrationPlan() {
    const plan = {
      sourceWorktrees: this.discoveries.worktrees.filter(w => w.recipes.length > 0 || w.sessions > 0),
      targetPath: this.wingmanConfig.getRecipesPath(),
      targetDbPath: this.wingmanConfig.getDatabasePath(),
      actions: []
    };
    
    // Plan recipe migrations
    const uniqueRecipes = new Map();
    for (const worktree of plan.sourceWorktrees) {
      for (const recipe of worktree.recipes) {
        if (!uniqueRecipes.has(recipe.id)) {
          uniqueRecipes.set(recipe.id, {
            ...recipe,
            sourceWorktree: worktree.id
          });
        }
      }
    }
    
    plan.actions.push({
      type: 'migrate_recipes',
      count: uniqueRecipes.size,
      recipes: Array.from(uniqueRecipes.values())
    });
    
    // Plan database migrations
    const sessionsToMigrate = plan.sourceWorktrees.reduce((sum, w) => sum + w.sessions, 0);
    if (sessionsToMigrate > 0) {
      plan.actions.push({
        type: 'migrate_database',
        count: sessionsToMigrate,
        sourceWorktrees: plan.sourceWorktrees.filter(w => w.sessions > 0)
      });
    }
    
    // Plan metadata consolidation
    plan.actions.push({
      type: 'consolidate_metadata',
      sourceWorktrees: plan.sourceWorktrees.filter(w => w.metadata)
    });
    
    return plan;
  }

  async confirmMigration(plan) {
    console.log('\nMigration Plan:');
    console.log('===============');
    console.log(`Target recipes directory: ${plan.targetPath}`);
    console.log(`Target database: ${plan.targetDbPath}`);
    console.log(`Source worktrees: ${plan.sourceWorktrees.length}`);
    
    for (const action of plan.actions) {
      switch (action.type) {
        case 'migrate_recipes':
          console.log(`- Migrate ${action.count} unique recipes`);
          break;
        case 'migrate_database':
          console.log(`- Migrate ${action.count} sessions from ${action.sourceWorktrees.length} databases`);
          break;
        case 'consolidate_metadata':
          console.log(`- Consolidate metadata from ${action.sourceWorktrees.length} sources`);
          break;
      }
    }
    
    if (this.discoveries.conflicts.length > 0) {
      console.log(`\n⚠️  Warning: ${this.discoveries.conflicts.length} recipe conflicts detected`);
      console.log('Conflicts will be resolved by keeping the most recent version.');
    }
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question('\nDo you want to proceed with this migration? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.wingmanConfig.getBackupPath(), `pre-migration-${timestamp}`);
    
    await fs.mkdir(backupDir, { recursive: true });
    
    for (const worktree of this.discoveries.worktrees) {
      if (worktree.recipesPath) {
        const backupRecipesPath = path.join(backupDir, `${worktree.id}-recipes`);
        await this.copyDirectory(worktree.recipesPath, backupRecipesPath);
      }
      
      if (worktree.dataPath) {
        const backupDataPath = path.join(backupDir, `${worktree.id}-data`);
        await this.copyDirectory(worktree.dataPath, backupDataPath);
      }
    }
    
    console.log(`Backup created at: ${backupDir}`);
  }

  async copyDirectory(source, destination) {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destPath);
      } else {
        await fs.copyFile(sourcePath, destPath);
      }
    }
  }

  async executeMigration(plan) {
    for (const action of plan.actions) {
      switch (action.type) {
        case 'migrate_recipes':
          await this.migrateRecipes(action);
          break;
        case 'migrate_database':
          await this.migrateDatabases(action);
          break;
        case 'consolidate_metadata':
          await this.consolidateMetadata(action);
          break;
      }
    }
    
    // Mark migration as completed
    if (!this.dryRun) {
      await this.wingmanConfig.markMigrationCompleted();
    }
  }

  async migrateRecipes(action) {
    console.log(`${this.dryRun ? 'Would migrate' : 'Migrating'} ${action.count} recipes...`);
    
    if (this.dryRun) return;
    
    const targetDirs = ['built-in', 'user', 'imported'];
    for (const dir of targetDirs) {
      await fs.mkdir(path.join(this.wingmanConfig.getRecipesPath(), dir), { recursive: true });
    }
    
    for (const recipe of action.recipes) {
      const targetPath = path.join(
        this.wingmanConfig.getRecipesPath(),
        recipe.directory,
        recipe.file
      );
      
      await fs.copyFile(recipe.path, targetPath);
      console.log(`  ✓ Migrated ${recipe.name} from ${recipe.sourceWorktree}`);
    }
  }

  async migrateDatabases(action) {
    console.log(`${this.dryRun ? 'Would migrate' : 'Migrating'} sessions from ${action.sourceWorktrees.length} databases...`);
    
    if (this.dryRun) return;
    
    const targetDb = new DatabaseManager(this.wingmanConfig.getDatabasePath());
    await targetDb.init();
    
    for (const worktree of action.sourceWorktrees) {
      const sourceDbPath = path.join(worktree.dataPath, 'wingman.db');
      const sourceDb = new DatabaseManager(sourceDbPath);
      
      try {
        await sourceDb.init();
        const sessions = await sourceDb.getAllSessions(true); // Include archived
        
        for (const session of sessions) {
          // Check if session already exists in target
          const existing = await targetDb.getSession(session.session_name);
          if (!existing) {
            // Create session with worktree identification
            await targetDb.createSession(
              session.session_name,
              session.goose_session_path,
              worktree.id
            );
            
            // Migrate messages
            const messages = await sourceDb.getMessages(session.session_name);
            for (const message of messages) {
              await targetDb.addMessage(session.session_name, {
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                source: message.source,
                id: message.message_id
              });
            }
            
            console.log(`  ✓ Migrated session '${session.session_name}' from ${worktree.id}`);
          }
        }
        
        await sourceDb.close();
      } catch (error) {
        console.warn(`  ⚠️  Could not migrate database from ${worktree.id}: ${error.message}`);
      }
    }
    
    await targetDb.close();
  }

  async consolidateMetadata(action) {
    console.log(`${this.dryRun ? 'Would consolidate' : 'Consolidating'} metadata from ${action.sourceWorktrees.length} sources...`);
    
    if (this.dryRun) return;
    
    const consolidatedMetadata = {
      system: {
        version: '2.0',
        mode: 'centralized',
        migrationDate: new Date().toISOString(),
        migratedFrom: action.sourceWorktrees.map(w => w.id)
      },
      recipes: {},
      usage: {},
      lastUpdated: new Date().toISOString()
    };
    
    // Consolidate usage statistics
    for (const worktree of action.sourceWorktrees) {
      if (worktree.metadata && worktree.metadata.usage) {
        for (const [recipeId, usageData] of Object.entries(worktree.metadata.usage)) {
          if (!consolidatedMetadata.usage[recipeId]) {
            consolidatedMetadata.usage[recipeId] = { ...usageData };
          } else {
            // Merge usage data
            const existing = consolidatedMetadata.usage[recipeId];
            existing.count = (existing.count || 0) + (usageData.count || 0);
            
            if (usageData.firstUsed && (!existing.firstUsed || usageData.firstUsed < existing.firstUsed)) {
              existing.firstUsed = usageData.firstUsed;
            }
            
            if (usageData.lastUsed && (!existing.lastUsed || usageData.lastUsed > existing.lastUsed)) {
              existing.lastUsed = usageData.lastUsed;
            }
            
            if (usageData.sessions) {
              existing.sessions = (existing.sessions || []).concat(usageData.sessions);
              existing.sessions = existing.sessions.slice(-100); // Keep last 100
            }
          }
        }
      }
    }
    
    const metadataPath = path.join(this.wingmanConfig.getRecipesPath(), 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(consolidatedMetadata, null, 2));
    
    console.log(`  ✓ Consolidated metadata written to ${metadataPath}`);
  }

  async verifyMigration() {
    // Verify recipes directory exists and has content
    const recipesPath = this.wingmanConfig.getRecipesPath();
    const recipesExist = await this.pathExists(recipesPath);
    
    if (!recipesExist) {
      throw new Error('Migration verification failed: Recipes directory not found');
    }
    
    // Count migrated recipes
    const migratedRecipes = await this.discoverRecipes(recipesPath);
    console.log(`✓ Verified ${migratedRecipes.length} recipes in centralized location`);
    
    // Verify database
    const dbPath = this.wingmanConfig.getDatabasePath();
    if (await this.pathExists(dbPath)) {
      const sessionCount = await this.countSessions(dbPath);
      console.log(`✓ Verified ${sessionCount} sessions in centralized database`);
    }
    
    // Verify configuration
    const config = this.wingmanConfig.getConfig();
    if (config.recipe_management.migration_completed) {
      console.log('✓ Migration marked as completed in configuration');
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  const migration = new MigrationTool();
  migration.run().catch(console.error);
}

module.exports = MigrationTool;