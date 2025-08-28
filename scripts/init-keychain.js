#!/usr/bin/env node

/**
 * Headless Keychain Initialization Script (T-009)
 * 
 * Provides utility to batch add/update secrets and whitelist Wingman binary
 * with -T for no-prompt access. Useful for remote/unattended setups.
 * 
 * Usage:
 *   node scripts/init-keychain.js --recipe <recipe-id>
 *   node scripts/init-keychain.js --server <server-name>
 *   node scripts/init-keychain.js --interactive
 */

const readline = require('readline');
const path = require('path');
const keychainService = require('../secrets/keychain-service');
const secretRequirements = require('../secrets/secret-requirements');
const recipeManager = require('../recipe-manager');

class HeadlessKeychainInit {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.binaryPath = process.execPath; // Current Node.js binary path
  }

  async run() {
    const args = process.argv.slice(2);
    
    console.log('🔐 Wingman Keychain Initialization');
    console.log('==================================\n');
    
    try {
      if (args.includes('--interactive')) {
        await this.runInteractive();
      } else if (args.includes('--recipe')) {
        const recipeId = args[args.indexOf('--recipe') + 1];
        await this.initRecipeSecrets(recipeId);
      } else if (args.includes('--server')) {
        const serverName = args[args.indexOf('--server') + 1];
        await this.initServerSecrets(serverName);
      } else if (args.includes('--test')) {
        await this.testKeychainAccess();
      } else {
        this.showHelp();
      }
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  async runInteractive() {
    console.log('🎯 Interactive Keychain Setup');
    console.log('This will guide you through setting up secrets for your recipes.\n');
    
    // Test keychain access first
    console.log('Testing keychain access...');
    const hasAccess = await keychainService.testAccess();
    
    if (!hasAccess) {
      console.log('⚠️ Keychain access test failed. You may need to grant permissions.');
      const proceed = await this.question('Continue anyway? (y/N): ');
      if (!proceed.toLowerCase().startsWith('y')) {
        return;
      }
    } else {
      console.log('✅ Keychain access confirmed\n');
    }
    
    // List recipes
    await recipeManager.initializeStorage();
    const recipes = await recipeManager.getAllRecipes();
    
    console.log('Available recipes:');
    recipes.forEach((recipe, index) => {
      console.log(`  ${index + 1}. ${recipe.name} (${recipe.id})`);
    });
    
    const choice = await this.question('\nSelect recipe number (or 0 to exit): ');
    const recipeIndex = parseInt(choice) - 1;
    
    if (recipeIndex < 0 || recipeIndex >= recipes.length) {
      console.log('Exiting...');
      return;
    }
    
    const selectedRecipe = recipes[recipeIndex];
    await this.initRecipeSecrets(selectedRecipe.id, true);
  }

  async initRecipeSecrets(recipeId, interactive = false) {
    await recipeManager.initializeStorage();
    const recipe = await recipeManager.getRecipe(recipeId);
    
    if (!recipe) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }
    
    console.log(`🔧 Initializing secrets for recipe: ${recipe.name}`);
    console.log(`📝 Description: ${recipe.description}\n`);
    
    // Get required secrets
    const requirements = await secretRequirements.getRecipeRequirements(recipe);
    const secretsToInit = [];
    
    for (const [serverName, keys] of Object.entries(requirements)) {
      console.log(`Server: ${serverName}`);
      
      for (const key of keys) {
        const secretRef = { server: serverName, key };
        const existing = await keychainService.readSecret(secretRef);
        
        if (existing.exists) {
          console.log(`  ✅ ${key}: Already configured`);
          continue;
        }
        
        console.log(`  🔑 ${key}: Missing`);
        
        if (interactive) {
          const value = await this.question(`    Enter value for ${key} (or skip): `, true);
          if (value && value.trim()) {
            secretsToInit.push({ server: serverName, key, value: value.trim() });
          }
        } else {
          const envValue = process.env[key];
          if (envValue) {
            console.log(`    📥 Found ${key} in environment`);
            secretsToInit.push({ server: serverName, key, value: envValue });
          } else {
            console.log(`    ⚠️ ${key} not found in environment`);
          }
        }
      }
      console.log('');
    }
    
    if (secretsToInit.length === 0) {
      console.log('✅ All secrets already configured or no secrets needed');
      return;
    }
    
    console.log(`🚀 Initializing ${secretsToInit.length} secrets...`);
    const results = await keychainService.headlessInit(this.binaryPath, secretsToInit);
    
    console.log(`\n📊 Results:`);
    console.log(`  ✅ Success: ${results.success.length}`);
    console.log(`  ❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log(`\n⚠️ Failed secrets:`);
      results.failed.forEach(failure => {
        console.log(`  - ${failure.name}: ${failure.reason}`);
      });
    }
    
    // Test the recipe
    if (results.success.length > 0) {
      console.log(`\n🧪 Testing recipe readiness...`);
      const preflightEngine = require('../preflight/preflight-engine');
      const preflight = await preflightEngine.runPreflight(recipe);
      
      if (preflight.isReady) {
        console.log('✅ Recipe is ready to launch!');
      } else {
        console.log('⚠️ Recipe still has issues:');
        console.log(`   ${preflight.summary}`);
      }
    }
  }

  async initServerSecrets(serverName) {
    const mcpServerRegistry = require('../mcp-server-registry');
    const server = await mcpServerRegistry.getServer(serverName);
    
    if (!server) {
      throw new Error(`Server not found: ${serverName}`);
    }
    
    console.log(`🔧 Initializing secrets for server: ${serverName}`);
    console.log(`📝 Description: ${server.description}\n`);
    
    const requiredKeys = server.env_keys || [];
    const secretsToInit = [];
    
    for (const key of requiredKeys) {
      const secretRef = { server: serverName, key };
      const existing = await keychainService.readSecret(secretRef);
      
      if (existing.exists) {
        console.log(`✅ ${key}: Already configured`);
        continue;
      }
      
      console.log(`🔑 ${key}: Missing`);
      const envValue = process.env[key];
      
      if (envValue) {
        console.log(`  📥 Found in environment`);
        secretsToInit.push({ server: serverName, key, value: envValue });
      } else {
        console.log(`  ⚠️ Not found in environment`);
      }
    }
    
    if (secretsToInit.length === 0) {
      console.log('✅ All secrets already configured');
      return;
    }
    
    console.log(`\n🚀 Initializing ${secretsToInit.length} secrets...`);
    const results = await keychainService.headlessInit(this.binaryPath, secretsToInit);
    
    console.log(`\n📊 Results:`);
    console.log(`  ✅ Success: ${results.success.length}`);
    console.log(`  ❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log(`\n⚠️ Failed secrets:`);
      results.failed.forEach(failure => {
        console.log(`  - ${failure.name}: ${failure.reason}`);
      });
    }
  }

  async testKeychainAccess() {
    console.log('🧪 Testing Keychain Access');
    console.log('===========================\n');
    
    const hasAccess = await keychainService.testAccess();
    
    if (hasAccess) {
      console.log('✅ Keychain access is working correctly');
      console.log('   - Can read/write secrets');
      console.log('   - Security CLI is functional');
    } else {
      console.log('❌ Keychain access failed');
      console.log('   - Check macOS security permissions');
      console.log('   - Ensure security CLI is available');
      console.log('   - Try running with sudo if needed');
    }
  }

  question(prompt, sensitive = false) {
    return new Promise((resolve) => {
      if (sensitive) {
        // Hide input for sensitive values
        this.rl.question(prompt, (answer) => {
          resolve(answer);
        });
        this.rl.stdoutMuted = true;
      } else {
        this.rl.question(prompt, resolve);
      }
    });
  }

  showHelp() {
    console.log('Usage:');
    console.log('  node scripts/init-keychain.js --interactive');
    console.log('  node scripts/init-keychain.js --recipe <recipe-id>');
    console.log('  node scripts/init-keychain.js --server <server-name>');
    console.log('  node scripts/init-keychain.js --test');
    console.log('');
    console.log('Options:');
    console.log('  --interactive    Interactive setup wizard');
    console.log('  --recipe <id>    Initialize secrets for a specific recipe');
    console.log('  --server <name>  Initialize secrets for a specific server');
    console.log('  --test           Test keychain access');
    console.log('');
    console.log('Environment Variables:');
    console.log('  Set environment variables matching the required keys');
    console.log('  Example: BRAVE_API_KEY=your-key node scripts/init-keychain.js --recipe chat');
  }
}

// Run if called directly
if (require.main === module) {
  const init = new HeadlessKeychainInit();
  init.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = HeadlessKeychainInit;