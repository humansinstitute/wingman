/**
 * MCP Runtime Determinism Tests (T-017)
 * 
 * Implements the 4 highest-value tests specified in the PRD:
 * 1. Zero-default enforcement
 * 2. Secrets preflight gating 
 * 3. Failure policy (retry-then-disable)
 * 4. Default recipe editability + reset
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Import modules to test
const ephemeralConfig = require('../runtime/ephemeral-goose-config');
const keychainService = require('../secrets/keychain-service');
const secretRequirements = require('../secrets/secret-requirements');
const preflightEngine = require('../preflight/preflight-engine');
const failureHandler = require('../runtime/failure-handler');
const recipeManager = require('../src/recipes/manager');

describe('MCP Runtime Determinism', () => {
  let testSessionId;
  
  beforeEach(() => {
    testSessionId = `test-session-${Date.now()}`;
  });
  
  afterEach(async () => {
    // Cleanup
    await ephemeralConfig.cleanupSession(testSessionId);
    failureHandler.resetSession(testSessionId);
  });
  
  describe('1. Zero-default enforcement', () => {
    test('Ephemeral config has no default extensions', async () => {
      const { path: configPath } = await ephemeralConfig.createEphemeralConfig(testSessionId, {
        provider: 'openai',
        model: 'gpt-4'
      });
      
      // Read the generated config
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      // Verify zero defaults
      expect(config.extensions).toEqual([]);
      expect(config.providers.default.name).toBe('openai');
      expect(config.providers.default.model).toBe('gpt-4');
      
      // Verify the verification method works
      const hasZeroDefaults = await ephemeralConfig.verifyZeroDefaults(configPath);
      expect(hasZeroDefaults).toBe(true);
    });
    
    test('Config path is unique per session', async () => {
      const session1 = `test-session-1-${Date.now()}`;
      const session2 = `test-session-2-${Date.now()}`;
      
      const config1 = await ephemeralConfig.createEphemeralConfig(session1);
      const config2 = await ephemeralConfig.createEphemeralConfig(session2);
      
      expect(config1.path).not.toBe(config2.path);
      
      // Cleanup
      await ephemeralConfig.cleanupSession(session1);
      await ephemeralConfig.cleanupSession(session2);
    });
  });
  
  describe('2. Secrets preflight gating', () => {
    const testRecipe = {
      id: 'test-recipe',
      name: 'Test Recipe',
      extensions: [{
        name: 'brave-search',
        env_keys: ['BRAVE_API_KEY']
      }]
    };
    
    test('Recipe is not ready when secrets are missing', async () => {
      // Ensure test secret doesn't exist
      const secretRef = { server: 'brave-search', key: 'BRAVE_API_KEY' };
      try {
        await keychainService.deleteSecret(secretRef);
      } catch (error) {
        // Ignore if secret doesn't exist
      }
      
      const preflight = await preflightEngine.runPreflight(testRecipe);
      
      expect(preflight.isReady).toBe(false);
      expect(preflight.missingSecrets).toHaveLength(1);
      expect(preflight.missingSecrets[0].server).toBe('brave-search');
      expect(preflight.missingSecrets[0].key).toBe('BRAVE_API_KEY');
    });
    
    test('Recipe becomes ready after setting secrets', async () => {
      const secretRef = { server: 'brave-search', key: 'BRAVE_API_KEY' };
      const testValue = `test-api-key-${Date.now()}`;
      
      try {
        // Set the secret
        await keychainService.writeSecret(secretRef, testValue);
        
        // Check preflight
        const preflight = await preflightEngine.runPreflight(testRecipe);
        
        expect(preflight.isReady).toBe(true);
        expect(preflight.missingSecrets).toHaveLength(0);
        
        // Verify secret exists
        const result = await keychainService.readSecret(secretRef);
        expect(result.exists).toBe(true);
        expect(result.value).toBe(testValue);
      } finally {
        // Cleanup
        await keychainService.deleteSecret(secretRef);
      }
    });
    
    test('Secret requirements are calculated correctly', async () => {
      const requirements = await secretRequirements.getRecipeRequirements(testRecipe);
      
      expect(requirements).toHaveProperty('brave-search');
      expect(requirements['brave-search']).toEqual(['BRAVE_API_KEY']);
      
      const allKeys = await secretRequirements.getAllRequiredKeys(testRecipe);
      expect(allKeys).toEqual(['BRAVE_API_KEY']);
    });
  });
  
  describe('3. Failure policy (retry-then-disable)', () => {
    test('Server failure triggers retry then disable', async () => {
      const serverName = 'test-server';
      const error = new Error('Server startup failed');
      
      // First failure should trigger retry
      const result1 = await failureHandler.handleServerFailure(testSessionId, serverName, error);
      expect(result1.action).toBe('retry');
      expect(result1.shouldContinue).toBe(true);
      
      // Second failure should disable
      const result2 = await failureHandler.handleServerFailure(testSessionId, serverName, error);
      expect(result2.action).toBe('disable');
      expect(result2.shouldContinue).toBe(true);
      
      // Server should now be disabled
      expect(failureHandler.isServerDisabled(testSessionId, serverName)).toBe(true);
    });
    
    test('Process failure is handled with readable errors', () => {
      const result = failureHandler.handleProcessFailure(testSessionId, 127, 'command not found');
      
      expect(result.action).toBe('fail');
      expect(result.shouldContinue).toBe(false);
      expect(result.error).toContain('Goose command not found');
    });
    
    test('Error messages are made human-readable', () => {
      const handler = failureHandler;
      
      // Test ENOENT error
      const enoentError = new Error('spawn npx ENOENT');
      const readable1 = handler.makeErrorReadable(enoentError);
      expect(readable1).toContain('Command not found');
      
      // Test authentication error
      const authError = new Error('authentication failed');
      const readable2 = handler.makeErrorReadable(authError);
      expect(readable2).toContain('Authentication failed');
    });
  });
  
  describe('4. Default recipe editability + reset', () => {
    test('Default recipe exists and is editable', async () => {
      await recipeManager.initializeStorage();
      
      // The recipe should exist (we updated it in the previous steps)
      const defaultRecipe = await recipeManager.getRecipe('17e8b84071aad068fd5a2ad2d3442d44');
      
      expect(defaultRecipe).toBeDefined();
      expect(defaultRecipe.name).toBe('Chat + Search (Default)');
      expect(defaultRecipe.isEditable).toBe(true);
      expect(defaultRecipe.canDelete).toBe(false);
      expect(defaultRecipe.resetAvailable).toBe(true);
      expect(defaultRecipe.isDefault).toBe(true);
    });
    
    test('Default recipe has correct Brave settings', async () => {
      await recipeManager.initializeStorage();
      
      const defaultRecipe = await recipeManager.getRecipe('17e8b84071aad068fd5a2ad2d3442d44');
      
      expect(defaultRecipe.extensions).toHaveLength(1);
      expect(defaultRecipe.extensions[0].name).toBe('brave-search');
      expect(defaultRecipe.extensions[0].settings).toEqual({
        safeSearch: 'moderate',
        locale: 'en-US', 
        results: 5,
        citation: 'inline'
      });
      
      expect(defaultRecipe.settings.braveSearch).toEqual({
        safeSearch: 'moderate',
        locale: 'en-US',
        results: 5,
        maxResults: 10,
        citations: 'inline'
      });
    });
    
    test('Recipe persists edits', async () => {
      await recipeManager.initializeStorage();
      
      const originalRecipe = await recipeManager.getRecipe('17e8b84071aad068fd5a2ad2d3442d44');
      const originalDescription = originalRecipe.description;
      
      // Make an edit
      const testDescription = `Edited description ${Date.now()}`;
      await recipeManager.updateRecipe('17e8b84071aad068fd5a2ad2d3442d44', {
        ...originalRecipe,
        description: testDescription,
        updatedAt: new Date().toISOString()
      });
      
      // Verify edit persisted
      const editedRecipe = await recipeManager.getRecipe('17e8b84071aad068fd5a2ad2d3442d44');
      expect(editedRecipe.description).toBe(testDescription);
      
      // Restore original
      await recipeManager.updateRecipe('17e8b84071aad068fd5a2ad2d3442d44', {
        ...originalRecipe,
        updatedAt: new Date().toISOString()
      });
    });
  });
  
  describe('Integration tests', () => {
    test('Full preflight to launch flow', async () => {
      const recipe = {
        id: 'integration-test',
        name: 'Integration Test Recipe',
        extensions: [{
          name: 'brave-search',
          env_keys: ['BRAVE_API_KEY']
        }]
      };
      
      // 1. Check preflight (should fail)
      const preflight1 = await preflightEngine.runPreflight(recipe);
      expect(preflight1.isReady).toBe(false);
      
      // 2. Set up secrets
      const secretRef = { server: 'brave-search', key: 'BRAVE_API_KEY' };
      const testValue = 'test-integration-key';
      
      try {
        await keychainService.writeSecret(secretRef, testValue);
        
        // 3. Check preflight again (should pass)
        const preflight2 = await preflightEngine.runPreflight(recipe);
        expect(preflight2.isReady).toBe(true);
        
        // 4. Create ephemeral config
        const config = await ephemeralConfig.createEphemeralConfig(testSessionId);
        expect(config.path).toBeDefined();
        
        // 5. Verify zero defaults
        const hasZeroDefaults = await ephemeralConfig.verifyZeroDefaults(config.path);
        expect(hasZeroDefaults).toBe(true);
        
      } finally {
        await keychainService.deleteSecret(secretRef);
      }
    });
  });
});
