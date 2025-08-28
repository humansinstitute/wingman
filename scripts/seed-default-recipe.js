#!/usr/bin/env node

/**
 * Seed Default Recipe Script (T-013)
 * 
 * Creates the default "Chat + Search (Default)" recipe with Brave Search
 * as specified in the PRD. Makes it editable but provides reset functionality.
 */

const path = require('path');
const recipeManager = require('../recipe-manager');

async function seedDefaultRecipe() {
  console.log('🌱 Seeding Default Recipe...');
  
  try {
    await recipeManager.initializeStorage();
    
    const defaultRecipeConfig = {
      id: 'builtin.chat.search',
      version: '1.0.0',
      name: 'Chat + Search (Default)',
      title: 'Chat + Search (Default)',
      description: 'Friendly chat with Brave web search and citations. This is the default recipe that ships with Wingman.',
      category: 'built-in',
      tags: ['default', 'search', 'chat', 'brave'],
      author: {
        name: 'Wingman',
        email: 'support@wingman.dev'
      },
      instructions: 'You are Wingman, be nice, answer questions. Use Brave Search when web context helps. Cite your sources.',
      system_prompt: 'You are Wingman, be nice, answer questions. Use Brave Search when web context helps. Cite your sources.',
      extensions: [
        {
          type: 'stdio',
          name: 'brave-search',
          cmd: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          timeout: 300,
          env_keys: ['BRAVE_API_KEY'],
          settings: {
            safeSearch: 'moderate',
            locale: 'en-US',
            results: 5,
            citation: 'inline'
          }
        }
      ],
      builtins: [],
      settings: {
        braveSearch: {
          safeSearch: 'moderate',
          locale: 'en-US',
          results: 5,
          maxResults: 10,
          citations: 'inline'
        }
      },
      parameters: [],
      isDefault: true,
      isBuiltIn: true,
      isPublic: true,
      isEditable: true, // Can be edited
      canDelete: false, // Cannot be deleted
      resetAvailable: true, // Can be reset to default
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0
    };
    
    // Check if default recipe already exists
    const existingRecipe = await recipeManager.getRecipe('builtin.chat.search');
    
    if (existingRecipe) {
      console.log('📋 Default recipe already exists');
      console.log(`   Name: ${existingRecipe.name}`);
      console.log(`   ID: ${existingRecipe.id}`);
      
      const shouldUpdate = process.argv.includes('--force');
      if (shouldUpdate) {
        console.log('🔄 Updating existing default recipe...');
        await recipeManager.updateRecipe('builtin.chat.search', {
          ...defaultRecipeConfig,
          updatedAt: new Date().toISOString()
        });
        console.log('✅ Default recipe updated');
      } else {
        console.log('   Use --force to update existing recipe');
      }
      
      return existingRecipe;
    }
    
    // Create the default recipe
    console.log('✨ Creating default recipe...');
    const createdRecipe = await recipeManager.createRecipe(defaultRecipeConfig);
    
    console.log('✅ Default recipe created successfully!');
    console.log(`   Name: ${createdRecipe.name}`);
    console.log(`   ID: ${createdRecipe.id}`);
    console.log(`   Extensions: ${createdRecipe.extensions.length}`);
    
    // Verify the recipe works with preflight
    try {
      const preflightEngine = require('../preflight/preflight-engine');
      const preflight = await preflightEngine.runPreflight(createdRecipe);
      
      console.log('\n🧪 Preflight Check:');
      console.log(`   Status: ${preflight.isReady ? '✅ Ready' : '⚠️ Missing Requirements'}`);
      console.log(`   Summary: ${preflight.summary}`);
      
      if (!preflight.isReady && preflight.missingSecrets.length > 0) {
        console.log('   Missing Secrets:');
        preflight.missingSecrets.forEach(secret => {
          console.log(`     - ${secret.key} for ${secret.server}`);
          console.log(`       Set with: security add-generic-password -s "${secret.keychainName}" -a wingman -w <your-api-key>`);
        });
      }
    } catch (preflightError) {
      console.warn('⚠️ Preflight check failed:', preflightError.message);
    }
    
    return createdRecipe;
  } catch (error) {
    console.error('❌ Failed to seed default recipe:', error.message);
    throw error;
  }
}

// Run based on command line arguments
if (require.main === module) {
  seedDefaultRecipe()
    .then(() => {
      console.log('\n🎉 Seeding complete!');
      console.log('\n💡 To set up Brave Search:');
      console.log('   1. Get API key from https://brave.com/search/api/');
      console.log('   2. Run: node scripts/init-keychain.js --recipe builtin.chat.search');
      console.log('   3. Or manually: security add-generic-password -s "Wingman:brave-search:BRAVE_API_KEY" -a wingman -w <your-key>');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedDefaultRecipe };