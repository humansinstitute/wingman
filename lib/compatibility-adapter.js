const fs = require('fs').promises;
const path = require('path');

/**
 * Compatibility Adapter for Wingman Recipe Management
 * 
 * Provides seamless backward compatibility between legacy and centralized modes.
 * Handles path resolution, data access, and gradual migration scenarios.
 */
class CompatibilityAdapter {
  constructor(wingmanConfig) {
    this.wingmanConfig = wingmanConfig;
    this.isLegacyMode = false;
    this.migrationWarningShown = false;
  }

  async init() {
    this.isLegacyMode = await this.wingmanConfig.needsMigration();
  }

  /**
   * Get the appropriate recipes path based on current mode
   */
  async getRecipesPath() {
    if (this.isLegacyMode) {
      return await this.wingmanConfig.getLegacyRecipesPath();
    }
    return this.wingmanConfig.getRecipesPath();
  }

  /**
   * Get the appropriate database path based on current mode
   */
  async getDatabasePath() {
    if (this.isLegacyMode) {
      return await this.wingmanConfig.getLegacyDatabasePath();
    }
    return this.wingmanConfig.getDatabasePath();
  }

  /**
   * Check if file/directory exists in either legacy or centralized location
   */
  async findPath(relativePath, type = 'file') {
    const paths = [];
    
    // Add centralized path first (preferred)
    if (!this.isLegacyMode) {
      paths.push(path.join(this.wingmanConfig.getRecipesPath(), relativePath));
    }
    
    // Add legacy path as fallback
    const legacyPath = path.join(await this.wingmanConfig.getLegacyRecipesPath(), relativePath);
    paths.push(legacyPath);
    
    // Add centralized path as fallback if in legacy mode
    if (this.isLegacyMode) {
      paths.push(path.join(this.wingmanConfig.getRecipesPath(), relativePath));
    }
    
    for (const checkPath of paths) {
      if (await this.pathExists(checkPath, type)) {
        return checkPath;
      }
    }
    
    return null;
  }

  async pathExists(path, type = 'file') {
    try {
      const stats = await fs.stat(path);
      return type === 'dir' ? stats.isDirectory() : stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Load recipe from either legacy or centralized location
   */
  async loadRecipe(recipeId) {
    // Try to find recipe file in any location
    const possibleFiles = [
      `user/${recipeId}.json`,
      `built-in/${recipeId}.json`,
      `imported/${recipeId}.json`,
      `user/${recipeId}.yaml`,
      `built-in/${recipeId}.yaml`,
      `imported/${recipeId}.yaml`
    ];
    
    for (const file of possibleFiles) {
      const recipePath = await this.findPath(file);
      if (recipePath) {
        try {
          const content = await fs.readFile(recipePath, 'utf8');
          const recipe = JSON.parse(content);
          
          // Add metadata about source location
          recipe._source = {
            path: recipePath,
            mode: this.isLegacyMode ? 'legacy' : 'centralized',
            worktree: this.wingmanConfig.getWorktreeId()
          };
          
          return recipe;
        } catch (error) {
          console.warn(`Could not load recipe from ${recipePath}:`, error.message);
        }
      }
    }
    
    return null;
  }

  /**
   * Save recipe to appropriate location based on current mode
   */
  async saveRecipe(recipe, directory = 'user') {
    const recipesPath = await this.getRecipesPath();
    const targetDir = path.join(recipesPath, directory);
    const targetPath = path.join(targetDir, `${recipe.id}.json`);
    
    // Ensure directory exists
    await fs.mkdir(targetDir, { recursive: true });
    
    // Remove source metadata before saving
    const recipeToSave = { ...recipe };
    delete recipeToSave._source;
    
    await fs.writeFile(targetPath, JSON.stringify(recipeToSave, null, 2));
    return targetPath;
  }

  /**
   * Load metadata from appropriate location, with fallback to legacy
   */
  async loadMetadata() {
    const metadataPath = await this.findPath('metadata.json');
    
    if (metadataPath) {
      try {
        const content = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(content);
        
        // Add compatibility info
        if (!metadata.system) {
          metadata.system = {
            version: this.isLegacyMode ? '1.0' : '2.0',
            mode: this.isLegacyMode ? 'legacy' : 'centralized',
            worktree: this.wingmanConfig.getWorktreeId(),
            compatibilityMode: true
          };
        }
        
        return metadata;
      } catch (error) {
        console.warn(`Could not load metadata from ${metadataPath}:`, error.message);
      }
    }
    
    // Return default metadata
    return {
      system: {
        version: this.isLegacyMode ? '1.0' : '2.0',
        mode: this.isLegacyMode ? 'legacy' : 'centralized',
        worktree: this.wingmanConfig.getWorktreeId(),
        compatibilityMode: true,
        migrationNeeded: this.isLegacyMode
      },
      recipes: {},
      usage: {},
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Save metadata to appropriate location
   */
  async saveMetadata(metadata) {
    const recipesPath = await this.getRecipesPath();
    const metadataPath = path.join(recipesPath, 'metadata.json');
    
    // Update system info
    metadata.system = {
      ...metadata.system,
      lastUpdated: new Date().toISOString(),
      mode: this.isLegacyMode ? 'legacy' : 'centralized',
      worktree: this.wingmanConfig.getWorktreeId()
    };
    
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * List all recipes from all available locations
   */
  async listAllRecipes() {
    const recipes = [];
    const seenIds = new Set();
    
    const locations = [
      { path: this.wingmanConfig.getRecipesPath(), mode: 'centralized' }
    ];
    
    // Add legacy location if different and exists
    const legacyPath = await this.wingmanConfig.getLegacyRecipesPath();
    if (legacyPath !== this.wingmanConfig.getRecipesPath()) {
      if (await this.pathExists(legacyPath, 'dir')) {
        locations.push({ path: legacyPath, mode: 'legacy' });
      }
    }
    
    const dirs = ['built-in', 'user', 'imported'];
    
    for (const location of locations) {
      for (const dir of dirs) {
        const dirPath = path.join(location.path, dir);
        
        try {
          const files = await fs.readdir(dirPath);
          
          for (const file of files) {
            if (file.endsWith('.json') || file.endsWith('.yaml')) {
              const filePath = path.join(dirPath, file);
              
              try {
                const content = await fs.readFile(filePath, 'utf8');
                const recipe = JSON.parse(content);
                
                // Skip if we've already seen this recipe ID (prefer centralized)
                if (!seenIds.has(recipe.id)) {
                  recipe._source = {
                    path: filePath,
                    mode: location.mode,
                    directory: dir,
                    worktree: this.wingmanConfig.getWorktreeId()
                  };
                  
                  recipes.push(recipe);
                  seenIds.add(recipe.id);
                }
              } catch (error) {
                console.warn(`Could not load recipe ${filePath}:`, error.message);
              }
            }
          }
        } catch (error) {
          // Directory doesn't exist, skip
        }
      }
    }
    
    return recipes;
  }

  /**
   * Show migration warning if in legacy mode (once per session)
   */
  showMigrationWarning() {
    if (this.isLegacyMode && !this.migrationWarningShown) {
      console.log('\n' + '='.repeat(60));
      console.log('⚠️  LEGACY MODE DETECTED');
      console.log('='.repeat(60));
      console.log('You are running Wingman in legacy mode with local recipe storage.');
      console.log('Consider migrating to centralized storage for improved multi-worktree support.');
      console.log('');
      console.log('To migrate, run: npm run migrate-recipes');
      console.log('To learn more: npm run migrate-recipes --dry-run');
      console.log('='.repeat(60) + '\n');
      
      this.migrationWarningShown = true;
    }
  }

  /**
   * Get compatibility status info
   */
  getCompatibilityStatus() {
    return {
      isLegacyMode: this.isLegacyMode,
      currentMode: this.isLegacyMode ? 'legacy' : 'centralized',
      migrationAvailable: this.isLegacyMode,
      version: this.wingmanConfig.getVersion(),
      worktree: this.wingmanConfig.getWorktreeId(),
      paths: {
        recipes: this.isLegacyMode ? 
          this.wingmanConfig.getLegacyRecipesPath() : 
          this.wingmanConfig.getRecipesPath(),
        database: this.isLegacyMode ?
          this.wingmanConfig.getLegacyDatabasePath() :
          this.wingmanConfig.getDatabasePath()
      }
    };
  }

  /**
   * Handle gradual migration - move a recipe from legacy to centralized
   */
  async migrateRecipe(recipeId) {
    if (!this.isLegacyMode) {
      throw new Error('Not in legacy mode, migration not needed');
    }
    
    const recipe = await this.loadRecipe(recipeId);
    if (!recipe) {
      throw new Error(`Recipe ${recipeId} not found`);
    }
    
    if (recipe._source.mode === 'centralized') {
      return { success: true, message: 'Recipe already in centralized location' };
    }
    
    // Save to centralized location
    const centralizedPath = path.join(
      this.wingmanConfig.getRecipesPath(),
      recipe._source.directory,
      `${recipe.id}.json`
    );
    
    await fs.mkdir(path.dirname(centralizedPath), { recursive: true });
    const recipeToSave = { ...recipe };
    delete recipeToSave._source;
    
    await fs.writeFile(centralizedPath, JSON.stringify(recipeToSave, null, 2));
    
    return {
      success: true,
      message: `Recipe ${recipe.name} migrated to centralized storage`,
      oldPath: recipe._source.path,
      newPath: centralizedPath
    };
  }

  /**
   * Cleanup legacy files after migration
   */
  async cleanupLegacyFiles() {
    if (!this.isLegacyMode) {
      return { success: true, message: 'Not in legacy mode, no cleanup needed' };
    }
    
    const legacyPath = await this.wingmanConfig.getLegacyRecipesPath();
    const backupPath = path.join(
      this.wingmanConfig.getBackupPath(),
      `legacy-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`
    );
    
    // Move legacy files to backup instead of deleting
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.rename(legacyPath, backupPath);
    
    return {
      success: true,
      message: 'Legacy files moved to backup',
      backupPath
    };
  }
}

module.exports = CompatibilityAdapter;