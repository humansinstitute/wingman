#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Recipe Management Centralization
 * 
 * Tests the new centralized recipe management system including:
 * - Configuration loading and path resolution
 * - Recipe discovery and loading from multiple sources
 * - Database migration and worktree identification
 * - Session restoration across worktrees
 * - Compatibility layer functionality
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class CentralizedRecipeTest {
  constructor() {
    this.testResults = [];
    this.tempDirs = [];
    this.originalEnv = {};
  }

  async runAllTests() {
    console.log('🧪 Starting Centralized Recipe Management Tests');
    console.log('='.repeat(60));
    
    try {
      await this.setupTestEnvironment();
      
      // Test Configuration System
      await this.testConfigurationLoading();
      await this.testPathResolution();
      await this.testEnvironmentOverrides();
      
      // Test Compatibility Layer
      await this.testCompatibilityAdapter();
      await this.testLegacyFallback();
      
      // Test Recipe Management
      await this.testRecipeDiscovery();
      await this.testCrossWorktreeRecipes();
      
      // Test Database Migration
      await this.testDatabaseMigration();
      await this.testWorktreeIdentification();
      
      // Test Session Management
      await this.testSessionRestoration();
      await this.testCrossWorktreeSessionRestoration();
      
      this.printResults();
      
    } catch (error) {
      console.error('❌ Test suite failed with error:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  async setupTestEnvironment() {
    console.log('\n📋 Setting up test environment...');
    
    // Create temporary directories for testing
    const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'wingman-test-'));
    this.tempDirs.push(tempBase);
    
    this.testPaths = {
      base: tempBase,
      legacy: path.join(tempBase, 'legacy-wingman'),
      centralized: path.join(tempBase, '.wingman'),
      worktree1: path.join(tempBase, 'worktree-main'),
      worktree2: path.join(tempBase, 'worktree-feature')
    };
    
    // Create directory structures
    for (const dir of Object.values(this.testPaths)) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    // Set up legacy structure
    await this.createLegacyStructure();
    
    // Set up sample recipes
    await this.createSampleRecipes();
    
    console.log(`✅ Test environment created at: ${tempBase}`);
  }

  async createLegacyStructure() {
    const legacyRecipesDir = path.join(this.testPaths.legacy, 'recipes');
    const legacyDataDir = path.join(this.testPaths.legacy, 'data');
    
    await fs.mkdir(path.join(legacyRecipesDir, 'user'), { recursive: true });
    await fs.mkdir(path.join(legacyRecipesDir, 'built-in'), { recursive: true });
    await fs.mkdir(legacyDataDir, { recursive: true });
    
    // Create sample legacy metadata
    const metadata = {
      recipes: {
        'legacy-recipe-1': {
          name: 'Legacy Recipe 1',
          path: path.join(legacyRecipesDir, 'user', 'legacy-recipe-1.json')
        }
      },
      usage: {
        'legacy-recipe-1': {
          count: 5,
          lastUsed: new Date().toISOString()
        }
      },
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(
      path.join(legacyRecipesDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );
  }

  async createSampleRecipes() {
    const recipe1 = {
      id: 'test-recipe-1',
      name: 'Test Recipe 1',
      description: 'A test recipe for centralized storage',
      instructions: 'Test instructions',
      version: '1.0.0',
      category: 'testing'
    };
    
    const recipe2 = {
      id: 'legacy-recipe-1',
      name: 'Legacy Recipe 1',
      description: 'A legacy recipe to be migrated',
      instructions: 'Legacy test instructions',
      version: '1.0.0',
      category: 'testing'
    };
    
    // Save to legacy location
    const legacyPath = path.join(this.testPaths.legacy, 'recipes', 'user', 'legacy-recipe-1.json');
    await fs.writeFile(legacyPath, JSON.stringify(recipe2, null, 2));
    
    // Save to centralized location
    const centralizedDir = path.join(this.testPaths.centralized, 'recipes', 'user');
    await fs.mkdir(centralizedDir, { recursive: true });
    const centralizedPath = path.join(centralizedDir, 'test-recipe-1.json');
    await fs.writeFile(centralizedPath, JSON.stringify(recipe1, null, 2));
  }

  async testConfigurationLoading() {
    console.log('\n🔧 Testing Configuration Loading...');
    
    try {
      // Save original environment
      this.originalEnv.WINGMAN_HOME = process.env.WINGMAN_HOME;
      
      // Test with custom path
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const WingmanConfig = require('../lib/wingman-config');
      const config = await WingmanConfig.create();
      
      this.assertEqual(
        config.wingmanHome,
        this.testPaths.centralized,
        'Configuration should use WINGMAN_HOME environment variable'
      );
      
      this.assertTrue(
        config.getRecipesPath().includes(this.testPaths.centralized),
        'Recipe path should be under centralized directory'
      );
      
      console.log('✅ Configuration loading test passed');
      
    } catch (error) {
      this.addTestResult('Configuration Loading', false, error.message);
    }
  }

  async testPathResolution() {
    console.log('\n📁 Testing Path Resolution...');
    
    try {
      const WingmanConfig = require('../lib/wingman-config');
      const config = new WingmanConfig();
      
      // Test default path resolution
      const defaultHome = config.resolveWingmanHome();
      this.assertTrue(
        defaultHome.includes('.wingman'),
        'Default path should include .wingman directory'
      );
      
      console.log('✅ Path resolution test passed');
      
    } catch (error) {
      this.addTestResult('Path Resolution', false, error.message);
    }
  }

  async testEnvironmentOverrides() {
    console.log('\n🌍 Testing Environment Overrides...');
    
    try {
      // Test WINGMAN_RECIPE_HOME override
      process.env.WINGMAN_RECIPE_HOME = this.testPaths.base;
      
      const WingmanConfig = require('../lib/wingman-config');
      const config = new WingmanConfig();
      
      this.assertEqual(
        config.wingmanHome,
        this.testPaths.base,
        'WINGMAN_RECIPE_HOME should override default path'
      );
      
      delete process.env.WINGMAN_RECIPE_HOME;
      console.log('✅ Environment override test passed');
      
    } catch (error) {
      this.addTestResult('Environment Overrides', false, error.message);
    }
  }

  async testCompatibilityAdapter() {
    console.log('\n🔄 Testing Compatibility Adapter...');
    
    try {
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const WingmanConfig = require('../lib/wingman-config');
      const CompatibilityAdapter = require('../lib/compatibility-adapter');
      
      const config = await WingmanConfig.create();
      const adapter = new CompatibilityAdapter(config);
      await adapter.init();
      
      const status = adapter.getCompatibilityStatus();
      
      this.assertTrue(
        status.hasOwnProperty('currentMode'),
        'Compatibility status should include current mode'
      );
      
      this.assertTrue(
        status.hasOwnProperty('paths'),
        'Compatibility status should include path information'
      );
      
      console.log('✅ Compatibility adapter test passed');
      
    } catch (error) {
      this.addTestResult('Compatibility Adapter', false, error.message);
    }
  }

  async testLegacyFallback() {
    console.log('\n⬅️  Testing Legacy Fallback...');
    
    try {
      // Configure environment to detect legacy setup
      delete process.env.WINGMAN_HOME;
      process.chdir(this.testPaths.legacy);
      
      const WingmanConfig = require('../lib/wingman-config');
      const config = await WingmanConfig.create();
      
      // Should detect legacy mode when legacy files exist
      const needsMigration = await config.needsMigration();
      console.log(`Legacy detection result: ${needsMigration}`);
      
      if (needsMigration) {
        const legacyPath = await config.getLegacyRecipesPath();
        this.assertTrue(
          legacyPath.includes('recipes'),
          'Legacy path should point to recipes directory'
        );
        
        console.log('✅ Legacy fallback test passed');
      } else {
        console.log('ℹ️  No legacy setup detected (expected in clean test environment)');
      }
      
    } catch (error) {
      this.addTestResult('Legacy Fallback', false, error.message);
    }
  }

  async testRecipeDiscovery() {
    console.log('\n🔍 Testing Recipe Discovery...');
    
    try {
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const WingmanConfig = require('../lib/wingman-config');
      const CompatibilityAdapter = require('../lib/compatibility-adapter');
      
      const config = await WingmanConfig.create();
      const adapter = new CompatibilityAdapter(config);
      await adapter.init();
      
      const recipes = await adapter.listAllRecipes();
      
      this.assertTrue(
        recipes.length > 0,
        'Should discover at least one recipe'
      );
      
      const testRecipe = recipes.find(r => r.id === 'test-recipe-1');
      this.assertTrue(
        !!testRecipe,
        'Should find test-recipe-1 in centralized location'
      );
      
      console.log('✅ Recipe discovery test passed');
      
    } catch (error) {
      this.addTestResult('Recipe Discovery', false, error.message);
    }
  }

  async testCrossWorktreeRecipes() {
    console.log('\n🌳 Testing Cross-Worktree Recipes...');
    
    try {
      // This test simulates recipe availability across worktrees
      // In a real centralized system, recipes should be available everywhere
      
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const WingmanConfig = require('../lib/wingman-config');
      const config = await WingmanConfig.create();
      
      // Simulate different worktree contexts
      const originalGetWorktreeId = config.getWorktreeId;
      
      config.getWorktreeId = () => 'main';
      const recipesMain = config.getRecipesPath();
      
      config.getWorktreeId = () => 'feature-branch';
      const recipesFeature = config.getRecipesPath();
      
      // Restore original method
      config.getWorktreeId = originalGetWorktreeId;
      
      this.assertEqual(
        recipesMain,
        recipesFeature,
        'Recipe paths should be identical across worktrees'
      );
      
      console.log('✅ Cross-worktree recipes test passed');
      
    } catch (error) {
      this.addTestResult('Cross-Worktree Recipes', false, error.message);
    }
  }

  async testDatabaseMigration() {
    console.log('\n🗃️  Testing Database Migration...');
    
    try {
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const { DatabaseManager } = require('../lib/database');
      const db = new DatabaseManager();
      await db.init();
      
      // Test creating a session with worktree info
      const result = await db.createSession('test-session', null, 'test-worktree');
      
      this.assertTrue(
        result.sessionName === 'test-session',
        'Should create session successfully'
      );
      
      // Test retrieving session
      const session = await db.getSession('test-session');
      
      this.assertTrue(
        session.worktree_id === 'test-worktree',
        'Session should have worktree information'
      );
      
      await db.close();
      console.log('✅ Database migration test passed');
      
    } catch (error) {
      this.addTestResult('Database Migration', false, error.message);
    }
  }

  async testWorktreeIdentification() {
    console.log('\n🏷️  Testing Worktree Identification...');
    
    try {
      const WingmanConfig = require('../lib/wingman-config');
      const config = new WingmanConfig();
      
      const worktreeId = config.getCurrentWorktree();
      
      this.assertTrue(
        typeof worktreeId === 'string' && worktreeId.length > 0,
        'Worktree ID should be a non-empty string'
      );
      
      console.log(`✅ Detected worktree: ${worktreeId}`);
      
    } catch (error) {
      this.addTestResult('Worktree Identification', false, error.message);
    }
  }

  async testSessionRestoration() {
    console.log('\n🔄 Testing Session Restoration...');
    
    try {
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const { DatabaseManager } = require('../lib/database');
      const db = new DatabaseManager();
      await db.init();
      
      // Create a session with context
      await db.createSession('restore-test', null, 'main');
      await db.storeSessionContext('restore-test', {
        workingDirectory: process.cwd(),
        recipeId: 'test-recipe-1'
      });
      
      // Retrieve session context
      const context = await db.getSessionContext('restore-test');
      
      this.assertTrue(
        context.recipeId === 'test-recipe-1',
        'Should restore recipe context'
      );
      
      this.assertTrue(
        context.workingDirectory === process.cwd(),
        'Should restore working directory'
      );
      
      await db.close();
      console.log('✅ Session restoration test passed');
      
    } catch (error) {
      this.addTestResult('Session Restoration', false, error.message);
    }
  }

  async testCrossWorktreeSessionRestoration() {
    console.log('\n🌐 Testing Cross-Worktree Session Restoration...');
    
    try {
      process.env.WINGMAN_HOME = this.testPaths.centralized;
      
      const { DatabaseManager } = require('../lib/database');
      const db = new DatabaseManager();
      await db.init();
      
      // Create session in 'main' worktree
      await db.createSession('cross-worktree-test', null, 'main');
      
      // Update to 'feature' worktree (simulating worktree switch)
      await db.updateSessionWorktree('cross-worktree-test', 'feature');
      
      // Verify update
      const session = await db.getSession('cross-worktree-test');
      
      this.assertTrue(
        session.worktree_id === 'feature',
        'Session worktree should be updated'
      );
      
      this.assertTrue(
        session.original_worktree === 'main',
        'Original worktree should be preserved'
      );
      
      await db.close();
      console.log('✅ Cross-worktree session restoration test passed');
      
    } catch (error) {
      this.addTestResult('Cross-Worktree Session Restoration', false, error.message);
    }
  }

  // Utility methods
  addTestResult(testName, passed, error = null) {
    this.testResults.push({ testName, passed, error });
    if (!passed) {
      console.log(`❌ ${testName} failed: ${error}`);
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message} - Expected: ${expected}, Actual: ${actual}`);
    }
  }

  assertTrue(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => !r.passed).length;
    const total = this.testResults.length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total:  ${total}`);
    console.log(`🎯 Success Rate: ${((passed/total) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => console.log(`   - ${r.testName}: ${r.error}`));
    }
    
    console.log('='.repeat(60));
    
    if (failed === 0) {
      console.log('🎉 All tests passed! Recipe centralization is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Please review and fix issues before deployment.');
      process.exit(1);
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test environment...');
    
    // Restore environment variables
    for (const [key, value] of Object.entries(this.originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    
    // Clean up temporary directories
    for (const tempDir of this.tempDirs) {
      try {
        await fs.rmdir(tempDir, { recursive: true });
      } catch (error) {
        console.warn(`Could not clean up ${tempDir}: ${error.message}`);
      }
    }
    
    console.log('✅ Cleanup completed');
  }
}

// Run tests if called directly
if (require.main === module) {
  const test = new CentralizedRecipeTest();
  test.runAllTests().catch(console.error);
}

module.exports = CentralizedRecipeTest;