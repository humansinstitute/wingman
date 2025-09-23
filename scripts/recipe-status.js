#!/usr/bin/env node

/**
 * Recipe Management Status Tool
 * 
 * Provides information about the current recipe management configuration,
 * migration status, and recommendations for optimization.
 */

const WingmanConfig = require('../lib/wingman-config');
const CompatibilityAdapter = require('../lib/compatibility-adapter');
const RecipeManager = require('../src/recipes/manager');
const { getDatabase } = require('../lib/database');

class RecipeStatusTool {
  async run() {
    console.log('🏠 Wingman Recipe Management Status');
    console.log('='.repeat(50));
    
    try {
      // Initialize components
      const config = await WingmanConfig.create();
      const adapter = new CompatibilityAdapter(config);
      await adapter.init();
      
      // Get status information
      const configStatus = this.getConfigurationStatus(config);
      const compatibilityStatus = adapter.getCompatibilityStatus();
      const recipeStatus = await this.getRecipeStatus();
      const sessionStatus = await this.getSessionStatus();
      
      // Display status
      this.displayConfiguration(configStatus);
      this.displayCompatibility(compatibilityStatus);
      await this.displayRecipes(recipeStatus);
      await this.displaySessions(sessionStatus);
      
      // Provide recommendations
      this.displayRecommendations(compatibilityStatus, recipeStatus, sessionStatus);
      
    } catch (error) {
      console.error('❌ Error getting status:', error.message);
      process.exit(1);
    }
  }

  getConfigurationStatus(config) {
    return {
      version: config.getVersion(),
      isCentralized: config.isCentralized(),
      worktreeId: config.getWorktreeId(),
      recipesPath: config.getRecipesPath(),
      databasePath: config.getDatabasePath(),
      backupPath: config.getBackupPath()
    };
  }

  async getRecipeStatus() {
    try {
      const recipes = await RecipeManager.getAllRecipes();
      const recipesByCategory = {};
      const recipesBySources = { 'built-in': 0, user: 0, imported: 0 };
      
      for (const recipe of recipes) {
        // Count by category
        const category = recipe.category || 'uncategorized';
        recipesByCategory[category] = (recipesByCategory[category] || 0) + 1;
        
        // Count by source
        const source = recipe.source || 'user';
        recipesBySources[source] = (recipesBySources[source] || 0) + 1;
      }
      
      return {
        total: recipes.length,
        byCategory: recipesByCategory,
        bySource: recipesBySources,
        migrationStatus: await RecipeManager.getMigrationStatus()
      };
    } catch (error) {
      return {
        total: 0,
        byCategory: {},
        bySource: {},
        error: error.message
      };
    }
  }

  async getSessionStatus() {
    try {
      const db = getDatabase();
      await db.init();
      
      const stats = await db.getStats();
      const sessions = await db.getAllSessionsWithWorktree();
      
      const byWorktree = {};
      let crossWorktreeSessions = 0;
      
      for (const session of sessions) {
        const worktree = session.worktree_id || 'main';
        byWorktree[worktree] = (byWorktree[worktree] || 0) + 1;
        
        if (session.original_worktree !== session.worktree_id) {
          crossWorktreeSessions++;
        }
      }
      
      await db.close();
      
      return {
        total: stats.sessions,
        messages: stats.messages,
        byWorktree,
        crossWorktreeSessions,
        activeWorktree: sessions.filter(s => s.status === 'active').length
      };
    } catch (error) {
      return {
        total: 0,
        messages: 0,
        byWorktree: {},
        crossWorktreeSessions: 0,
        activeWorktree: 0,
        error: error.message
      };
    }
  }

  displayConfiguration(config) {
    console.log('\n📋 Configuration');
    console.log('-'.repeat(20));
    console.log(`Version:       ${config.version}`);
    console.log(`Mode:          ${config.isCentralized ? 'Centralized' : 'Legacy'}`);
    console.log(`Worktree:      ${config.worktreeId}`);
    console.log(`Recipes Path:  ${config.recipesPath}`);
    console.log(`Database:      ${config.databasePath}`);
    console.log(`Backups:       ${config.backupPath}`);
  }

  displayCompatibility(status) {
    console.log('\n🔄 Compatibility Status');
    console.log('-'.repeat(25));
    console.log(`Current Mode:      ${status.currentMode}`);
    console.log(`Legacy Mode:       ${status.isLegacyMode ? 'Yes' : 'No'}`);
    console.log(`Migration Available: ${status.migrationAvailable ? 'Yes' : 'No'}`);
    
    if (status.paths) {
      console.log(`Active Recipes:    ${status.paths.recipes}`);
      console.log(`Active Database:   ${status.paths.database}`);
    }
  }

  async displayRecipes(status) {
    console.log('\n📚 Recipe Status');
    console.log('-'.repeat(18));
    
    if (status.error) {
      console.log(`❌ Error: ${status.error}`);
      return;
    }
    
    console.log(`Total Recipes:     ${status.total}`);
    
    if (Object.keys(status.bySource).length > 0) {
      console.log('By Source:');
      for (const [source, count] of Object.entries(status.bySource)) {
        console.log(`  ${source.padEnd(10)}: ${count}`);
      }
    }
    
    if (Object.keys(status.byCategory).length > 0) {
      console.log('By Category:');
      for (const [category, count] of Object.entries(status.byCategory)) {
        console.log(`  ${category.padEnd(10)}: ${count}`);
      }
    }
    
    if (status.migrationStatus) {
      console.log(`Migration Needed:  ${status.migrationStatus.needed ? 'Yes' : 'No'}`);
      if (status.migrationStatus.needed) {
        console.log(`Legacy Path:       ${status.migrationStatus.legacyPath}`);
        console.log(`Target Path:       ${status.migrationStatus.centralizedPath}`);
      }
    }
  }

  async displaySessions(status) {
    console.log('\n💬 Session Status');
    console.log('-'.repeat(18));
    
    if (status.error) {
      console.log(`❌ Error: ${status.error}`);
      return;
    }
    
    console.log(`Total Sessions:    ${status.total}`);
    console.log(`Total Messages:    ${status.messages}`);
    console.log(`Active Sessions:   ${status.activeWorktree}`);
    console.log(`Cross-Worktree:    ${status.crossWorktreeSessions}`);
    
    if (Object.keys(status.byWorktree).length > 0) {
      console.log('By Worktree:');
      for (const [worktree, count] of Object.entries(status.byWorktree)) {
        console.log(`  ${worktree.padEnd(10)}: ${count}`);
      }
    }
  }

  displayRecommendations(compatibility, recipes, sessions) {
    console.log('\n💡 Recommendations');
    console.log('-'.repeat(20));
    
    const recommendations = [];
    
    // Migration recommendations
    if (compatibility.migrationAvailable && compatibility.isLegacyMode) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Run migration to centralized system',
        command: 'npm run migrate-recipes',
        reason: 'Improve multi-worktree support and recipe sharing'
      });
    }
    
    // Recipe optimization
    if (recipes.total === 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Create your first recipe',
        command: 'Visit the web interface to create recipes',
        reason: 'Recipes help standardize common development tasks'
      });
    }
    
    // Cross-worktree sessions
    if (sessions.crossWorktreeSessions > 0) {
      recommendations.push({
        priority: 'INFO',
        action: 'Review cross-worktree sessions',
        command: 'Check session history for context switching patterns',
        reason: `${sessions.crossWorktreeSessions} sessions have been used across worktrees`
      });
    }
    
    // Database optimization
    if (sessions.total > 100) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Consider archiving old sessions',
        command: 'Review and archive inactive sessions',
        reason: 'Large session history may impact performance'
      });
    }
    
    if (recommendations.length === 0) {
      console.log('✅ No immediate actions needed. System is running optimally.');
    } else {
      recommendations.forEach((rec, index) => {
        const priorityIcon = rec.priority === 'HIGH' ? '🔴' : 
                           rec.priority === 'MEDIUM' ? '🟡' : 'ℹ️';
        
        console.log(`\n${index + 1}. ${priorityIcon} ${rec.action}`);
        console.log(`   Command: ${rec.command}`);
        console.log(`   Reason:  ${rec.reason}`);
      });
    }
    
    console.log('\n📋 Available Commands:');
    console.log('  npm run migrate-recipes        - Migrate to centralized system');
    console.log('  npm run migrate-recipes:dry-run - Preview migration changes');
    console.log('  npm run test:centralized       - Test centralized system');
    console.log('  node scripts/recipe-status.js  - Show this status report');
  }
}

// Run if called directly
if (require.main === module) {
  const tool = new RecipeStatusTool();
  tool.run().catch(console.error);
}

module.exports = RecipeStatusTool;
