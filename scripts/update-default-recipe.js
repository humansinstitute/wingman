#!/usr/bin/env node

/**
 * Update Existing Recipe to Default (T-013)
 * 
 * Takes the user's existing Chat recipe and makes it the default
 * "Chat + Search (Default)" recipe with proper settings.
 */

const path = require('path');
const recipeManager = require('../src/recipes/manager');

async function updateToDefaultRecipe(recipeId = '17e8b84071aad068fd5a2ad2d3442d44') {
  console.log(`🔄 Updating recipe ${recipeId} to be the default...`);
  
  try {
    await recipeManager.initializeStorage();
    
    // Get the existing recipe
    const existingRecipe = await recipeManager.getRecipe(recipeId);
    
    if (!existingRecipe) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }
    
    console.log('📋 Current Recipe:');
    console.log(`   Name: ${existingRecipe.name}`);
    console.log(`   Description: ${existingRecipe.description}`);
    console.log(`   Extensions: ${existingRecipe.extensions?.length || 0}`);
    
    // Enhanced configuration based on PRD requirements
    const enhancedConfig = {
      ...existingRecipe,
      name: 'Chat + Search (Default)',
      title: 'Chat + Search (Default)', 
      description: 'Friendly chat with Brave web search and citations. Default recipe with enhanced Brave Search settings.',
      category: 'built-in', // Change to built-in
      tags: ['default', 'search', 'chat', 'brave', ...(existingRecipe.tags || [])],
      instructions: 'You are Wingman, powered by Goose. Be kind and give short concise answers.\n\nYou have access to Brave Search MCP tool to look up information from the internet. Use it when web context helps. Cite your sources.',
      system_prompt: 'You are Wingman, powered by Goose. Be kind and give short concise answers.\n\nYou have access to Brave Search MCP tool to look up information from the internet. Use it when web context helps. Cite your sources.',
      
      // Enhanced extensions with Brave settings from PRD
      extensions: existingRecipe.extensions?.map(ext => {
        if (ext.name === 'brave-search') {
          return {
            ...ext,
            settings: {
              safeSearch: 'moderate',
              locale: 'en-US',
              results: 5,
              citation: 'inline'
            }
          };
        }
        return ext;
      }) || [],
      
      // Enhanced settings
      settings: {
        ...existingRecipe.settings,
        braveSearch: {
          safeSearch: 'moderate',
          locale: 'en-US',
          results: 5,
          maxResults: 10,
          citations: 'inline'
        }
      },
      
      // Default recipe properties
      isDefault: true,
      isBuiltIn: true,
      isPublic: true,
      isEditable: true,
      canDelete: false,
      resetAvailable: true,
      updatedAt: new Date().toISOString()
    };
    
    // Update the recipe
    console.log('✨ Updating recipe with enhanced default settings...');
    const updatedRecipe = await recipeManager.updateRecipe(recipeId, enhancedConfig);
    
    console.log('✅ Recipe updated successfully!');
    console.log(`   Name: ${updatedRecipe.name}`);
    console.log(`   Category: ${updatedRecipe.category}`);
    console.log(`   Extensions: ${updatedRecipe.extensions?.length || 0}`);
    console.log(`   Settings: Brave Search configured`);
    
    // Test preflight functionality
    try {
      const preflightEngine = require('../preflight/preflight-engine');
      const preflight = await preflightEngine.runPreflight(updatedRecipe);
      
      console.log('\\n🧪 Preflight Check:');
      console.log(`   Status: ${preflight.isReady ? '✅ Ready' : '⚠️ Missing Requirements'}`);
      console.log(`   Summary: ${preflight.summary}`);
      
      if (!preflight.isReady && preflight.missingSecrets.length > 0) {
        console.log('   Missing Secrets:');
        preflight.missingSecrets.forEach(secret => {
          console.log(`     - ${secret.key} for ${secret.server}`);
          console.log(`       Keychain name: ${secret.keychainName}`);
        });
        
        console.log('\\n💡 To set up missing secrets:');
        console.log(`   Run: node scripts/init-keychain.js --recipe ${recipeId}`);
        console.log('   Or use the keychain initialization wizard:');
        console.log('   node scripts/init-keychain.js --interactive');
      }
    } catch (preflightError) {
      console.warn('⚠️ Preflight check failed:', preflightError.message);
    }
    
    return updatedRecipe;
  } catch (error) {
    console.error('❌ Failed to update recipe:', error.message);
    throw error;
  }
}

// Run the update
if (require.main === module) {
  const recipeId = process.argv[2] || '17e8b84071aad068fd5a2ad2d3442d44';
  
  updateToDefaultRecipe(recipeId)
    .then(() => {
      console.log('\\n🎉 Default recipe update complete!');
      console.log('\\nYour existing recipe is now the enhanced default recipe.');
      console.log('It can be edited, and has a "Reset to Default" option.');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Update failed:', error);
      process.exit(1);
    });
}

module.exports = { updateToDefaultRecipe };
