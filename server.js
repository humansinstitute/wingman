// Load Wingman application configuration
require('dotenv').config();

// Also load MCP server secrets from ~/.wingman/.env if available
const path = require('path');
const os = require('os');
const fs = require('fs');
const mcpEnvPath = path.join(os.homedir(), '.wingman', '.env');
if (fs.existsSync(mcpEnvPath)) {
  require('dotenv').config({ path: mcpEnvPath });
  console.log('✅ Loaded MCP server environment from ~/.wingman/.env');
}
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const os = require('os');
const pty = require('node-pty');
const conversationManager = require('./shared-state');
const recipeManager = require('./recipe-manager');
const MultiSessionManager = require('./multi-session-manager');
const mcpServerRegistry = require('./mcp-server-registry');
const TriggerHandler = require('./lib/triggers/trigger-handler');

// Clear recipe cache on server startup to ensure fresh data
recipeManager.clearCache();
console.log('🔄 Recipe cache cleared - recipes will use updated format');

class GooseWebServer {
  constructor(port = process.env.PORT || 3000) {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    this.port = port;

    // Initialize multi-session manager
    this.multiSessionManager = new MultiSessionManager();
    this.setupMultiSessionEvents();
    
    // Initialize trigger handler
    this.triggerHandler = new TriggerHandler(this.multiSessionManager, recipeManager);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupConversationSync();
  }

  setupMultiSessionEvents() {
    // Handle multi-session events and broadcast to clients
    this.multiSessionManager.on('sessionMessage', (data) => {
      // Only broadcast to clients - don't add to conversationManager to avoid double emission
      // The MultiSessionManager already handles database storage and caching
      this.io.emit('newMessage', data.message);
    });

    this.multiSessionManager.on('sessionSwitched', (data) => {
      // Update conversation manager immediately (may be empty initially)
      try {
        conversationManager.conversation = data.conversation;
        conversationManager.emit('conversationHistory', data.conversation);
      } catch (error) {
        console.error('Error updating conversation manager:', error);
      }
      
      this.io.emit('sessionsUpdate', {
        type: 'sessionSwitched',
        sessionId: data.toSessionId,
        conversation: data.conversation
      });
      this.io.emit('conversationHistory', data.conversation);
    });

    this.multiSessionManager.on('conversationLoaded', (data) => {
      // Update conversation manager with full conversation
      try {
        conversationManager.conversation = data.conversation;
        conversationManager.emit('conversationHistory', data.conversation);
      } catch (error) {
        console.error('Error updating conversation manager with loaded data:', error);
      }
      
      // Broadcast the loaded conversation
      this.io.emit('conversationHistory', data.conversation);
    });

    this.multiSessionManager.on('sessionReady', (data) => {
      this.io.emit('sessionsUpdate', {
        type: 'sessionReady',
        sessionId: data.sessionId
      });
    });

    this.multiSessionManager.on('sessionError', (data) => {
      this.io.emit('sessionError', {
        sessionId: data.sessionId,
        error: data.error
      });
    });

    this.multiSessionManager.on('sessionClosed', (data) => {
      this.io.emit('sessionsUpdate', {
        type: 'sessionClosed',
        sessionId: data.sessionId,
        code: data.code
      });
    });
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  setupRoutes() {
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    this.app.get('/recipes', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'recipes.html'));
    });

    this.app.get('/deep-dive', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'deep-dive.html'));
    });

    this.app.get('/mcp-servers', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'mcp-servers.html'));
    });

    this.app.get('/api/conversation', (req, res) => {
      res.json(conversationManager.getConversation());
    });

    this.app.get('/api/goose/status', (req, res) => {
      res.json(conversationManager.getGooseStatus());
    });

    this.app.get('/api/config', (req, res) => {
      const purgeDays = process.env.ARCHIVE_PURGE_DAYS !== undefined ? parseInt(process.env.ARCHIVE_PURGE_DAYS) : 30;
      res.json({
        inputLength: parseInt(process.env.INPUT_LENGTH) || 5000,
        ARCHIVE_PURGE_DAYS: purgeDays
      });
    });

    this.app.get('/api/goose/sessions', async (req, res) => {
      try {
        const sessions = await conversationManager.listGooseSessions();
        res.json(sessions);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/start', async (req, res) => {
      try {
        const { sessionName, debug, extensions, builtins, workingDirectory } = req.body;
        
        const sessionResult = await this.multiSessionManager.createSession({
          sessionName: sessionName || `web-session-${Date.now()}`,
          debug: debug || false,
          extensions: extensions || [],
          builtins: builtins || ['developer'],
          workingDirectory: workingDirectory || process.cwd()
        });
        
        await this.multiSessionManager.startSession(sessionResult.sessionId);
        
        // Switch to the new session (this will clear UI and set as active)
        await this.multiSessionManager.switchSession(sessionResult.sessionId);
        
        // Broadcast session update to all clients
        this.io.emit('sessionsUpdate', {
          type: 'sessionStarted',
          sessionId: sessionResult.sessionId,
          sessionName: sessionResult.sessionName
        });
        
        // Also emit gooseStatusUpdate for backward compatibility
        this.io.emit('gooseStatusUpdate', {
          active: true,
          sessionName: sessionResult.sessionName,
          ready: true
        });
        
        res.json({ 
          success: true, 
          sessionId: sessionResult.sessionId,
          sessionName: sessionResult.sessionName
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/interrupt', async (req, res) => {
      try {
        const result = await this.multiSessionManager.interruptActiveSession();
        
        // Broadcast interrupt event to all clients
        this.io.emit('sessionInterrupted', {
          sessionId: result.sessionId,
          timestamp: new Date().toISOString()
        });
        
        res.json(result);
      } catch (error) {
        console.error('Error interrupting session:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/stop', async (req, res) => {
      try {
        // First try to interrupt gracefully
        try {
          await this.multiSessionManager.interruptActiveSession();
        } catch (interruptError) {
          console.log('Could not interrupt gracefully, proceeding with force stop');
        }
        
        // Then force stop
        const result = await this.multiSessionManager.forceStopActiveSession();
        
        // Broadcast session stopped event to all clients
        this.io.emit('sessionForceStopped', {
          sessionId: result.sessionId,
          timestamp: new Date().toISOString()
        });
        
        // Also broadcast legacy status update for backward compatibility
        this.io.emit('gooseStatusUpdate', {
          active: false,
          sessionName: null,
          ready: false
        });
        
        res.json(result);
      } catch (error) {
        console.error('Error stopping session:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/resume', async (req, res) => {
      try {
        const { sessionName } = req.body;
        
        if (!sessionName) {
          return res.status(400).json({ error: 'Session name is required' });
        }
        
        const result = await this.multiSessionManager.resumeSession(sessionName);
        
        if (result.success) {
          // Switch to the resumed session (this will load conversation and set as active)
          await this.multiSessionManager.switchSession(result.sessionId);
          
          // Broadcast session update to all clients
          this.io.emit('sessionsUpdate', {
            type: 'sessionResumed',
            sessionId: result.sessionId,
            sessionName: sessionName
          });
          
          // Also emit gooseStatusUpdate for backward compatibility
          this.io.emit('gooseStatusUpdate', {
            active: true,
            sessionName: sessionName,
            ready: true
          });
        }
        
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/command', async (req, res) => {
      try {
        const { command } = req.body;
        
        if (!command) {
          return res.status(400).json({ error: 'Command is required' });
        }
        
        await conversationManager.executeGooseCommand(command);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/delete', async (req, res) => {
      try {
        const { sessionName } = req.body;
        
        if (!sessionName) {
          return res.status(400).json({ error: 'Session name is required' });
        }
        
        const result = await conversationManager.deleteGooseSession(sessionName);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/message', async (req, res) => {
      try {
        const { content, settings } = req.body;
        
        // Debug logging for message content
        console.log('=== RECEIVED MESSAGE AT SERVER ===');
        console.log('Content length:', content.length);
        console.log('Contains newlines:', content.includes('\n'));
        console.log('Newline count:', (content.match(/\n/g) || []).length);
        console.log('Raw content:', JSON.stringify(content));
        console.log('==================================');
        
        // Check if we have an active session in MultiSessionManager
        const activeSession = this.multiSessionManager.getActiveSession();
        if (!activeSession) {
          return res.status(400).json({ 
            error: 'No active Goose session. Please start a session first.' 
          });
        }
        
        // Send message to active session with settings
        const result = await this.multiSessionManager.sendMessageToActiveSession(content, settings);
        
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/conversation', (req, res) => {
      conversationManager.clear();
      res.json({ success: true });
    });

    // Recipe Management Routes
    this.app.get('/api/recipes', async (req, res) => {
      try {
        const { category, search, limit, sortBy } = req.query;
        const recipes = await recipeManager.getAllRecipes({ category, search, limit, sortBy });
        res.json(recipes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/recipes/popular', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        const recipes = await recipeManager.getPopularRecipes(limit);
        res.json(recipes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/recipes/categories', async (req, res) => {
      try {
        const categories = await recipeManager.getCategories();
        res.json(categories);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/recipes/:id', async (req, res) => {
      try {
        const recipe = await recipeManager.getRecipe(req.params.id);
        if (!recipe) {
          return res.status(404).json({ error: 'Recipe not found' });
        }
        res.json(recipe);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/recipes', async (req, res) => {
      try {
        const recipe = await recipeManager.createRecipe(req.body);
        res.status(201).json(recipe);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.put('/api/recipes/:id', async (req, res) => {
      try {
        const recipe = await recipeManager.updateRecipe(req.params.id, req.body);
        res.json(recipe);
      } catch (error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      }
    });

    this.app.delete('/api/recipes/:id', async (req, res) => {
      try {
        await recipeManager.deleteRecipe(req.params.id);
        res.json({ success: true });
      } catch (error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      }
    });

    // Recipe Import/Export
    this.app.post('/api/recipes/import', async (req, res) => {
      try {
        const { url } = req.body;
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }
        const recipe = await recipeManager.importFromUrl(url);
        res.status(201).json(recipe);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/recipes/:id/export', async (req, res) => {
      try {
        const shareUrl = await recipeManager.exportRecipe(req.params.id);
        res.json({ shareUrl });
      } catch (error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(500).json({ error: error.message });
        }
      }
    });

    // Start session with recipe
    this.app.post('/api/goose/start-with-recipe', async (req, res) => {
      try {
        const { recipeId, sessionName, parameters, workingDirectory, providerOverride } = req.body;
        
        if (!recipeId) {
          return res.status(400).json({ error: 'Recipe ID is required' });
        }
        
        // Get recipe details
        const recipe = await recipeManager.getRecipe(recipeId);
        if (!recipe) {
          return res.status(404).json({ error: 'Recipe not found' });
        }
        
        // Validate provider override if provided
        if (providerOverride) {
          const validation = await recipeManager.validateProviderModel(
            providerOverride.provider, 
            providerOverride.model
          );
          
          if (!validation.valid) {
            return res.status(400).json({ 
              error: `Provider/Model validation failed: ${validation.error}` 
            });
          }
        }
        
        // Process recipe with parameters
        const processedRecipe = await recipeManager.processTemplate(recipe, parameters || {});
        
        // Determine provider/model (override or recipe default)
        const recipeProvider = recipe.settings?.goose_provider;
        const recipeModel = recipe.settings?.goose_model;
        
        // Create session with recipe using MultiSessionManager
        const sessionResult = await this.multiSessionManager.createSession({
          sessionName: sessionName || `recipe-${recipe.name}-${Date.now()}`,
          workingDirectory: workingDirectory || process.cwd(),
          extensions: [], // Extensions are defined in the recipe file
          builtins: [], // Builtins are defined in the recipe file
          recipeId: recipeId,
          recipeConfig: processedRecipe,
          provider: recipeProvider,
          model: recipeModel,
          providerOverride: providerOverride // This will take precedence
        });
        
        // Start the session 
        await sessionResult.wrapper.start();
        
        // Switch to the new session (this will clear UI and set as active)
        await this.multiSessionManager.switchSession(sessionResult.sessionId);
        
        // Track recipe usage
        await recipeManager.trackUsage(recipeId, sessionResult.sessionName);
        
        // Broadcast session update to all clients
        this.io.emit('sessionsUpdate', {
          type: 'sessionStarted',
          sessionId: sessionResult.sessionId,
          sessionName: sessionResult.sessionName
        });
        
        // Also emit gooseStatusUpdate for backward compatibility
        this.io.emit('gooseStatusUpdate', {
          active: true,
          sessionName: sessionResult.sessionName,
          ready: true
        });
        
        res.json({ 
          success: true, 
          sessionId: sessionResult.sessionId,
          sessionName: sessionResult.sessionName,
          recipe: {
            id: recipe.id,
            name: recipe.name,
            description: recipe.description
          },
          providerModel: {
            provider: sessionResult.metadata.provider,
            model: sessionResult.metadata.model,
            overridden: !!providerOverride
          }
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Recipe search
    this.app.post('/api/recipes/search', async (req, res) => {
      try {
        const { query } = req.body;
        if (!query) {
          return res.status(400).json({ error: 'Search query is required' });
        }
        const recipes = await recipeManager.searchRecipes(query);
        res.json(recipes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Goose Configuration API Endpoints
    
    // Get available providers from Goose config
    this.app.get('/api/goose-config/providers', async (req, res) => {
      try {
        const providers = await recipeManager.getAvailableProviders();
        res.json(providers);
      } catch (error) {
        res.status(500).json({ 
          error: error.message,
          providers: [],
          configValid: false 
        });
      }
    });

    // Validate provider/model combination
    this.app.post('/api/goose-config/validate', async (req, res) => {
      try {
        const { provider, model } = req.body;
        
        if (!provider) {
          return res.status(400).json({ error: 'Provider is required' });
        }
        
        const validation = await recipeManager.validateProviderModel(provider, model);
        res.json(validation);
      } catch (error) {
        res.status(500).json({ 
          valid: false, 
          error: error.message 
        });
      }
    });

    // Get current Goose configuration status
    this.app.get('/api/goose-config/status', async (req, res) => {
      try {
        const status = await recipeManager.getConfigStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({
          configFound: false,
          configValid: false,
          providersCount: 0,
          defaultsSet: false,
          error: error.message
        });
      }
    });

    // MCP Server Registry API Endpoints
    
    // Get all registered MCP servers
    this.app.get('/api/mcp-servers', async (req, res) => {
      try {
        const { includeUsage, sortBy } = req.query;
        const servers = await mcpServerRegistry.getAllServers({ 
          includeUsage: includeUsage === 'true', 
          sortBy: sortBy || 'name' 
        });
        res.json(servers);
      } catch (error) {
        console.error('Error fetching MCP servers:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get registry statistics (must come before /:id route)
    this.app.get('/api/mcp-servers/stats', async (req, res) => {
      try {
        const stats = await mcpServerRegistry.getStats();
        res.json(stats);
      } catch (error) {
        console.error('Error fetching registry stats:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get a specific MCP server
    this.app.get('/api/mcp-servers/:id', async (req, res) => {
      try {
        const server = await mcpServerRegistry.getServer(req.params.id);
        if (!server) {
          return res.status(404).json({ error: 'MCP server not found' });
        }
        res.json({ id: req.params.id, ...server });
      } catch (error) {
        console.error('Error fetching MCP server:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Register a new MCP server
    this.app.post('/api/mcp-servers', async (req, res) => {
      try {
        const server = await mcpServerRegistry.registerServer(req.body);
        res.status(201).json(server);
      } catch (error) {
        console.error('Error registering MCP server:', error);
        res.status(400).json({ error: error.message });
      }
    });

    // Update an existing MCP server
    this.app.put('/api/mcp-servers/:id', async (req, res) => {
      try {
        const server = await mcpServerRegistry.updateServer(req.params.id, req.body);
        res.json(server);
      } catch (error) {
        console.error('Error updating MCP server:', error);
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      }
    });

    // Delete an MCP server
    this.app.delete('/api/mcp-servers/:id', async (req, res) => {
      try {
        const result = await mcpServerRegistry.unregisterServer(req.params.id);
        res.json(result);
      } catch (error) {
        console.error('Error deleting MCP server:', error);
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else if (error.message.includes('still used by')) {
          res.status(409).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      }
    });

    // Search MCP servers
    this.app.post('/api/mcp-servers/search', async (req, res) => {
      try {
        const { query } = req.body;
        if (!query) {
          return res.status(400).json({ error: 'Search query is required' });
        }
        const servers = await mcpServerRegistry.searchServers(query);
        res.json(servers);
      } catch (error) {
        console.error('Error searching MCP servers:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get MCP servers for a specific recipe
    this.app.get('/api/mcp-servers/recipe/:recipeId', async (req, res) => {
      try {
        const servers = await mcpServerRegistry.getServersForRecipe(req.params.recipeId);
        res.json(servers);
      } catch (error) {
        console.error('Error fetching recipe servers:', error);
        res.status(500).json({ error: error.message });
      }
    });


    // Import servers from existing recipes (migration endpoint)
    this.app.post('/api/mcp-servers/import-from-recipes', async (req, res) => {
      try {
        // Get all recipes to import servers from
        const recipes = await recipeManager.getAllRecipes();
        const result = await mcpServerRegistry.importFromRecipes(recipes);
        
        res.json({
          success: true,
          imported: result.importedServers.length,
          errors: result.errors,
          servers: result.importedServers
        });
      } catch (error) {
        console.error('Error importing servers from recipes:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Directory browsing API
    this.app.get('/api/directories', async (req, res) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        
        const { dir } = req.query;
        
        // Use ROOT_WORKING_DIR from environment, expanding ~ to home directory
        let defaultDir = process.env.ROOT_WORKING_DIR || os.homedir();
        if (defaultDir.startsWith('~/')) {
          defaultDir = path.join(os.homedir(), defaultDir.slice(2));
        }
        
        const targetDir = dir || defaultDir;
        
        // Security: Ensure we can't browse outside reasonable bounds
        const resolvedPath = path.resolve(targetDir);
        
        const items = await fs.readdir(resolvedPath, { withFileTypes: true });
        const directories = items
          .filter(item => item.isDirectory())
          .map(item => ({
            name: item.name,
            path: path.join(resolvedPath, item.name),
            isDirectory: true
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        
        // Add parent directory option if not at root
        const parentPath = path.dirname(resolvedPath);
        let result = directories;
        
        if (parentPath !== resolvedPath) {
          result = [
            {
              name: '..',
              path: parentPath,
              isDirectory: true,
              isParent: true
            },
            ...directories
          ];
        }
        
        res.json({
          currentPath: resolvedPath,
          directories: result
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Create directory endpoint
    this.app.post('/api/create-directory', async (req, res) => {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        
        const { parentPath, folderName } = req.body;
        
        if (!parentPath || !folderName) {
          return res.status(400).send('Parent path and folder name are required');
        }
        
        // Validate folder name
        if (!/^[a-zA-Z0-9_\-\s]+$/.test(folderName)) {
          return res.status(400).send('Invalid folder name');
        }
        
        // Security: Ensure we can't create directories outside reasonable bounds
        const resolvedParentPath = path.resolve(parentPath);
        const newDirPath = path.join(resolvedParentPath, folderName);
        
        // Check if directory already exists
        try {
          await fs.access(newDirPath);
          return res.status(409).send('Directory already exists');
        } catch (error) {
          // Directory doesn't exist, which is what we want
        }
        
        // Create the directory
        await fs.mkdir(newDirPath, { recursive: false });
        
        res.json({ 
          success: true, 
          path: newDirPath 
        });
      } catch (error) {
        console.error('Error creating directory:', error);
        res.status(500).send(error.message);
      }
    });

    // Triggers API
    this.app.post('/api/triggers', async (req, res) => {
      try {
        const token = req.headers['trigger_token'] || req.headers['authorization']?.replace('Bearer ', '');
        
        const result = await this.triggerHandler.processTrigger(req.body, token);
        res.json(result);
      } catch (error) {
        console.error('Trigger API error:', error);
        
        // Determine error code based on error message
        let statusCode = 500;
        let errorCode = 'INTERNAL_ERROR';
        
        if (error.message.includes('token')) {
          statusCode = 401;
          errorCode = 'INVALID_TOKEN';
        } else if (error.message.includes('Recipe') && error.message.includes('not found')) {
          statusCode = 404;
          errorCode = 'RECIPE_NOT_FOUND';
        } else if (error.message.includes('required')) {
          statusCode = 400;
          errorCode = 'MISSING_PARAMETER';
        }
        
        res.status(statusCode).json({
          success: false,
          error: error.message,
          code: errorCode
        });
      }
    });
    
    // Get trigger logs (for debugging/monitoring)
    this.app.get('/api/triggers/logs', (req, res) => {
      const token = req.headers['trigger_token'] || req.headers['authorization']?.replace('Bearer ', '');
      
      try {
        // Validate token for accessing logs
        this.triggerHandler.validateToken(token);
        
        const limit = parseInt(req.query.limit) || 100;
        const logs = this.triggerHandler.getTriggerLogs(limit);
        
        res.json({
          success: true,
          logs,
          count: logs.length
        });
      } catch (error) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
          code: 'INVALID_TOKEN'
        });
      }
    });

    // Multi-Session Management API Endpoints
    this.app.get('/api/sessions/running', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          console.log('MultiSessionManager not available, returning empty array');
          return res.json([]);
        }
        
        const runningSessions = await this.multiSessionManager.getRunningSessions();
        console.log('API /api/sessions/running: Found', runningSessions.length, 'running sessions:', runningSessions);
        res.json(runningSessions);
      } catch (error) {
        console.error('Error in /api/sessions/running:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/sessions/available', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          // Fallback to existing method
          const sessions = await conversationManager.listGooseSessions();
          return res.json(sessions);
        }
        
        const availableSessions = await this.multiSessionManager.getAvailableSessions();
        
        // Filter out archived sessions from database
        const db = require('./lib/database').getDatabase();
        const archivedSessions = await db.getArchivedSessions();
        const archivedSessionNames = archivedSessions.map(s => s.session_name);
        
        const nonArchivedSessions = availableSessions.filter(session => 
          !archivedSessionNames.includes(session.id)
        );
        
        res.json(nonArchivedSessions);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/start', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const { sessionName, debug, extensions, builtins, workingDirectory } = req.body;
        
        const sessionResult = await this.multiSessionManager.createSession({
          sessionName: sessionName || `web-session-${Date.now()}`,
          debug: debug || false,
          extensions: extensions || [],
          builtins: builtins || ['developer'],
          workingDirectory: workingDirectory || process.cwd()
        });
        
        await this.multiSessionManager.startSession(sessionResult.sessionId);
        
        // Broadcast session update to all clients
        this.io.emit('sessionsUpdate', {
          type: 'sessionStarted',
          sessionId: sessionResult.sessionId,
          sessionName: sessionResult.sessionName
        });
        
        res.json({ 
          success: true, 
          sessionId: sessionResult.sessionId,
          sessionName: sessionResult.sessionName
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/resume/:name', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionName = req.params.name;
        
        const result = await this.multiSessionManager.resumeSession(sessionName);
        
        // Broadcast session update to all clients
        this.io.emit('sessionsUpdate', {
          type: 'sessionResumed',
          sessionId: result.sessionId,
          sessionName: sessionName
        });
        
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/stop/:id', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        
        const result = await this.multiSessionManager.stopSession(sessionId);
        
        // Broadcast session stop to all clients
        this.io.emit('sessionsUpdate', {
          type: 'sessionStopped',
          sessionId: sessionId,
          message: 'Session subprocess terminated'
        });
        
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/switch/:id', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        
        const result = await this.multiSessionManager.switchSession(sessionId);
        
        // Broadcast session switch to all clients
        this.io.emit('sessionsUpdate', {
          type: 'sessionSwitched',
          sessionId: sessionId,
          conversation: result.conversation
        });
        
        // Update conversation display
        this.io.emit('conversationHistory', result.conversation);
        
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/api/sessions/:id/conversation', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        const session = this.multiSessionManager.sessions.get(sessionId);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        // Get conversation from database
        const metadata = this.multiSessionManager.sessionMetadata.get(sessionId);
        if (metadata && this.multiSessionManager.dbInitialized) {
          const messages = await this.multiSessionManager.db.getMessages(metadata.sessionName);
          const conversation = messages.map(msg => ({
            id: msg.message_id || msg.id.toString(),
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            source: msg.source
          }));
          res.json(conversation);
        } else {
          res.json([]);
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/:id/message', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        const { content } = req.body;
        
        if (!content) {
          return res.status(400).json({ error: 'Message content is required' });
        }
        
        // Switch to session if not already active
        if (this.multiSessionManager.activeSessionId !== sessionId) {
          await this.multiSessionManager.switchSession(sessionId);
        }
        
        // Send message to active session
        const result = await this.multiSessionManager.sendMessageToActiveSession(content);
        
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Session Analytics Endpoints
    this.app.get('/api/sessions/:id/stats', (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        const stats = this.multiSessionManager.getSessionStats(sessionId);
        res.json(stats || { error: 'Session not found' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/sessions/analysis', (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const analysis = this.multiSessionManager.getCrossSessionAnalysis();
        res.json(analysis);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get session provider/model information
    this.app.get('/api/sessions/:id/provider-model', (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        const providerModel = this.multiSessionManager.getSessionProviderModel(sessionId);
        
        if (!providerModel) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        res.json(providerModel);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Enhanced session info including provider/model
    this.app.get('/api/sessions/:id/info', async (req, res) => {
      try {
        if (!this.multiSessionManager) {
          return res.status(503).json({ error: 'Multi-session manager not available' });
        }

        const sessionId = req.params.id;
        const sessionInfo = await this.multiSessionManager.getSessionInfo(sessionId);
        
        if (!sessionInfo) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        res.json(sessionInfo);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Archive and Bulk Operations API Endpoints
    
    // Archive all sessions
    this.app.post('/api/sessions/archive-all', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        
        // Get all database sessions that are not already archived
        const allDbSessions = await db.getAllSessions(true); // include archived to check
        const sessionsToArchive = allDbSessions.filter(session => !session.archived);
        
        // Archive each session
        let count = 0;
        for (const session of sessionsToArchive) {
          const success = await db.archiveSession(session.session_name);
          if (success) count++;
        }
        
        res.json({ success: true, message: `Archived ${count} sessions` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Archive non-active sessions
    this.app.post('/api/sessions/archive-non-active', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        
        // Get list of currently running session names
        const runningSessions = await this.multiSessionManager.getRunningSessions();
        const runningSessionNames = Array.isArray(runningSessions) ? runningSessions.map(s => s.sessionName) : [];
        
        // Get all database sessions that are not running and not already archived
        const allDbSessions = await db.getAllSessions(true); // include archived to check
        const sessionsToArchive = allDbSessions.filter(session => 
          !runningSessionNames.includes(session.session_name) && !session.archived
        );
        
        // Archive each non-active session
        let count = 0;
        for (const session of sessionsToArchive) {
          const success = await db.archiveSession(session.session_name);
          if (success) count++;
        }
        
        res.json({ success: true, message: `Archived ${count} non-active sessions` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete all sessions
    this.app.delete('/api/sessions/delete-all', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        
        // Stop all running sessions first
        const runningSessions = await this.multiSessionManager.getRunningSessions();
        for (const session of runningSessions) {
          await this.multiSessionManager.stopSession(session.id);
        }
        
        const count = await db.deleteAllSessions();
        res.json({ success: true, message: `Deleted ${count} sessions` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete non-active sessions
    this.app.delete('/api/sessions/delete-non-active', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const count = await db.deleteNonActiveSessions();
        res.json({ success: true, message: `Deleted ${count} non-active sessions` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });


    // Get archived sessions
    this.app.get('/api/sessions/archived', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const sessions = await db.getArchivedSessions();
        res.json(sessions);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Archive individual session by name
    this.app.post('/api/sessions/archive', async (req, res) => {
      try {
        const { sessionName } = req.body;
        if (!sessionName) {
          return res.status(400).json({ error: 'sessionName is required' });
        }

        // Check if session is currently running
        const runningSessions = await this.multiSessionManager.getRunningSessions();
        const isRunning = Array.isArray(runningSessions) && runningSessions.some(s => s.sessionName === sessionName);
        
        if (isRunning) {
          return res.status(400).json({ error: 'Cannot archive running session' });
        }

        const db = require('./lib/database').getDatabase();
        
        // Try to create the session in database if it doesn't exist
        await db.getOrCreateSession(sessionName);
        
        const success = await db.archiveSession(sessionName);
        if (success) {
          res.json({ success: true, message: `Archived session: ${sessionName}` });
        } else {
          res.status(404).json({ error: 'Session not found or already archived' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Restore archived session
    this.app.post('/api/sessions/:id/restore', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const success = await db.restoreSessionById(req.params.id);
        if (success) {
          res.json({ success: true, message: 'Session restored successfully' });
        } else {
          res.status(404).json({ error: 'Session not found or not archived' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete individual archived session
    this.app.delete('/api/sessions/:id', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const fs = require('fs').promises;
        const path = require('path');
        const os = require('os');
        
        // Get session info first
        const session = await db.getSessionById(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        // Delete the session file from disk
        try {
          const gooseSessionsDir = path.join(os.homedir(), '.local', 'share', 'goose', 'sessions');
          const sessionFilePath = path.join(gooseSessionsDir, `${session.session_name}.jsonl`);
          await fs.unlink(sessionFilePath);
          console.log(`Deleted session file: ${sessionFilePath}`);
        } catch (fileError) {
          console.warn(`Could not delete session file for "${session.session_name}":`, fileError.message);
          // Continue with database deletion even if file deletion fails
        }
        
        // Delete the session from database (this will cascade and delete messages too)
        const success = await db.deleteSession(session.session_name);
        if (success) {
          res.json({ success: true, message: `Session "${session.session_name}" deleted successfully` });
        } else {
          res.status(404).json({ error: 'Session not found' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete archived session permanently
    this.app.delete('/api/sessions/archived/:id', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const session = await db.getSessionById(req.params.id);
        
        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }
        
        if (!session.archived) {
          return res.status(400).json({ error: 'Session must be archived before permanent deletion' });
        }
        
        const success = await db.deleteSession(session.session_name);
        if (success) {
          res.json({ success: true, message: 'Session permanently deleted' });
        } else {
          res.status(404).json({ error: 'Failed to delete session' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Restore all archived sessions
    this.app.post('/api/sessions/restore-all', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const count = await db.restoreAllArchivedSessions();
        res.json({ success: true, message: `Restored ${count} sessions` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete all archived sessions
    this.app.delete('/api/sessions/archived', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const count = await db.deleteArchivedSessions();
        res.json({ success: true, message: `Permanently deleted ${count} archived sessions` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete archived sessions older than N days
    this.app.delete('/api/sessions/archived/old', async (req, res) => {
      try {
        const db = require('./lib/database').getDatabase();
        const fs = require('fs').promises;
        const path = require('path');
        const os = require('os');
        const purgeDays = process.env.ARCHIVE_PURGE_DAYS !== undefined ? parseInt(process.env.ARCHIVE_PURGE_DAYS) : 30;
        
        // Get list of sessions to delete first
        const sessionsToDelete = await db.getOldArchivedSessions(purgeDays);
        
        if (sessionsToDelete.length === 0) {
          return res.json({ success: true, message: `No archived sessions older than ${purgeDays} days found` });
        }
        
        // Delete session files from disk
        const gooseSessionsDir = path.join(os.homedir(), '.local', 'share', 'goose', 'sessions');
        let filesDeleted = 0;
        
        for (const session of sessionsToDelete) {
          try {
            const sessionFilePath = path.join(gooseSessionsDir, `${session.session_name}.jsonl`);
            await fs.unlink(sessionFilePath);
            console.log(`Deleted session file: ${sessionFilePath}`);
            filesDeleted++;
          } catch (fileError) {
            console.warn(`Could not delete session file for "${session.session_name}":`, fileError.message);
            // Continue with other files even if one fails
          }
        }
        
        // Delete the old sessions from database
        const deletedCount = await db.deleteOldArchivedSessions(purgeDays);
        res.json({ 
          success: true, 
          message: `Permanently deleted ${deletedCount} archived sessions older than ${purgeDays} days (${filesDeleted} files deleted from disk)`,
          count: deletedCount,
          filesDeleted: filesDeleted,
          days: purgeDays
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ============ SECRET MANAGEMENT ENDPOINTS (T-009) ============
    
    // Get preflight status for a recipe
    this.app.get('/api/recipes/:id/preflight', async (req, res) => {
      try {
        const recipeManager = require('./recipe-manager');
        const preflightEngine = require('./preflight/preflight-engine');
        
        await recipeManager.initializeStorage();
        const recipe = await recipeManager.getRecipe(req.params.id);
        
        if (!recipe) {
          return res.status(404).json({ error: 'Recipe not found' });
        }
        
        const preflight = await preflightEngine.runPreflight(recipe);
        res.json(preflight);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get missing secrets with instructions
    this.app.get('/api/recipes/:id/missing-secrets', async (req, res) => {
      try {
        const recipeManager = require('./recipe-manager');
        const preflightEngine = require('./preflight/preflight-engine');
        
        await recipeManager.initializeStorage();
        const recipe = await recipeManager.getRecipe(req.params.id);
        
        if (!recipe) {
          return res.status(404).json({ error: 'Recipe not found' });
        }
        
        const missing = await preflightEngine.getMissingSecretsWithInstructions(recipe);
        res.json(missing);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Check keychain access
    this.app.get('/api/secrets/test-access', async (req, res) => {
      try {
        const keychainService = require('./secrets/keychain-service');
        const hasAccess = await keychainService.testAccess();
        
        res.json({ 
          hasAccess,
          message: hasAccess ? 'Keychain access confirmed' : 'Keychain access failed'
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Set a secret in keychain
    this.app.post('/api/secrets/:server/:key', async (req, res) => {
      try {
        const keychainService = require('./secrets/keychain-service');
        const { server, key } = req.params;
        const { value } = req.body;
        
        if (!value) {
          return res.status(400).json({ error: 'Secret value is required' });
        }
        
        const secretRef = { server, key };
        await keychainService.writeSecret(secretRef, value);
        
        res.json({ 
          success: true,
          message: `Secret ${key} set for ${server}`,
          keychainName: keychainService.formatKeychainName(secretRef)
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Check if a secret exists
    this.app.get('/api/secrets/:server/:key', async (req, res) => {
      try {
        const keychainService = require('./secrets/keychain-service');
        const { server, key } = req.params;
        
        const secretRef = { server, key };
        const result = await keychainService.readSecret(secretRef);
        
        res.json({ 
          exists: result.exists,
          keychainName: keychainService.formatKeychainName(secretRef),
          hasValue: result.exists && !!result.value
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Delete a secret from keychain
    this.app.delete('/api/secrets/:server/:key', async (req, res) => {
      try {
        const keychainService = require('./secrets/keychain-service');
        const { server, key } = req.params;
        
        const secretRef = { server, key };
        await keychainService.deleteSecret(secretRef);
        
        res.json({ 
          success: true,
          message: `Secret ${key} deleted for ${server}`
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Test a specific MCP server
    this.app.post('/api/mcp-servers/:name/test', async (req, res) => {
      try {
        const preflightEngine = require('./preflight/preflight-engine');
        const serverName = req.params.name;
        
        const testResult = await preflightEngine.testServer(serverName);
        res.json(testResult);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client connected');

      // Send current conversation and Goose status
      socket.emit('conversationHistory', conversationManager.getConversation());
      socket.emit('gooseStatusUpdate', conversationManager.getGooseStatus());

      // Handle CLI message events
      socket.on('cliMessage', (message) => {
        socket.broadcast.emit('newMessage', message);
        
        if (!conversationManager.conversation.find(m => m.id === message.id)) {
          conversationManager.conversation.push(message);
          conversationManager.save();
        }
      });

      // Handle clear conversation from CLI
      socket.on('clearConversation', () => {
        conversationManager.clear();
      });

      // Handle history requests
      socket.on('requestHistory', () => {
        socket.emit('conversationHistory', conversationManager.getConversation());
      });

      // Handle Goose status updates from CLI
      socket.on('gooseStatusUpdate', (status) => {
        socket.broadcast.emit('gooseStatusUpdate', status);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });
    });

    // Terminal namespace for Deep Dive feature
    this.terminalNamespace = this.io.of('/terminal');
    this.setupTerminalHandlers();
  }

  setupTerminalHandlers() {
    // Terminal session state management
    const terminalState = {
      lastAuthTime: null,
      authenticated: new Map() // socketId -> timestamp
    };

    // Get PIN timeout from environment (with default)
    const PIN_TIMEOUT = parseInt(process.env.PIN_TIMEOUT) || 45; // seconds

    this.terminalNamespace.on('connection', (socket) => {
      console.log('Terminal client connected');
      
      let ptyProcess = null;
      let authenticated = false;

      // Check if authentication is still valid from recent connection
      const now = Date.now();
      if (terminalState.lastAuthTime && (now - terminalState.lastAuthTime) < (PIN_TIMEOUT * 1000)) {
        authenticated = true;
        terminalState.authenticated.set(socket.id, now);
        socket.emit('auth-success');
        console.log('Authentication still valid, skipping PIN entry');
      } else {
        // Request PIN entry
        socket.emit('auth-required');
      }

      socket.on('authenticate', (pin) => {
        const correctPin = process.env.PIN || '1234';
        if (pin === correctPin) {
          authenticated = true;
          const authTime = Date.now();
          terminalState.lastAuthTime = authTime;
          terminalState.authenticated.set(socket.id, authTime);
          socket.emit('auth-success');
          console.log('Authentication successful');
        } else {
          socket.emit('auth-failed', 'Invalid PIN');
        }
      });

      socket.on('start-terminal', (dimensions) => {
        if (!authenticated) {
          socket.emit('terminal-error', 'Not authenticated. Please enter PIN.');
          return;
        }

        try {
          // Determine shell and platform
          const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
          
          // Use provided dimensions or defaults
          const cols = dimensions?.cols || 80;
          const rows = dimensions?.rows || 24;
          
          // Spawn terminal process
          ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: cols,
            rows: rows,
            cwd: process.cwd(),
            env: process.env
          });

          console.log('Terminal process started with PID:', ptyProcess.pid);

          // Send terminal output to client
          ptyProcess.onData((data) => {
            socket.emit('terminal-output', data);
          });

          // Handle terminal exit
          ptyProcess.onExit((exitCode) => {
            console.log('Terminal process exited with code:', exitCode);
            socket.emit('terminal-error', `Terminal process exited with code: ${exitCode}`);
          });

          // Always start with wingman command after PIN authentication
          const terminalCmd = process.env.TERMINALCMD || 'node wingman-cli.js';
          
          console.log('Starting terminal session with wingman command');
          ptyProcess.write(`${terminalCmd}\r`);
          socket.emit('session-fresh');

        } catch (error) {
          console.error('Error starting terminal:', error);
          socket.emit('terminal-error', error.message);
        }
      });

      socket.on('terminal-input', (data) => {
        if (ptyProcess) {
          ptyProcess.write(data);
        }
      });

      socket.on('terminal-resize', (dimensions) => {
        if (ptyProcess) {
          ptyProcess.resize(dimensions.cols, dimensions.rows);
        }
      });

      socket.on('disconnect', () => {
        console.log('Terminal client disconnected');
        
        // Clean up authentication state
        terminalState.authenticated.delete(socket.id);
        
        // Kill terminal process
        if (ptyProcess) {
          console.log('Killing terminal process with PID:', ptyProcess.pid);
          ptyProcess.kill();
          ptyProcess = null;
        }
      });
    });
  }

  setupConversationSync() {
    // Broadcast new messages to all connected clients
    conversationManager.on('messageAdded', (message) => {
      this.io.emit('newMessage', message);
    });

    conversationManager.on('conversationCleared', () => {
      this.io.emit('conversationCleared');
    });
    
    // Broadcast thinking messages
    conversationManager.on('thinking', (message) => {
      this.io.emit('newMessage', message);
    });

    // Broadcast Goose-specific events
    conversationManager.on('gooseReady', () => {
      this.io.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
    });

    conversationManager.on('gooseStopped', () => {
      this.io.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
    });

    conversationManager.on('gooseError', (error) => {
      this.io.emit('gooseError', error);
    });

    // Broadcast conversation history updates (for session switching)
    conversationManager.on('conversationHistory', (conversation) => {
      this.io.emit('conversationHistory', conversation);
    });
  }

  async findAvailablePort(startPort) {
    const net = require('net');

    return new Promise((resolve) => {
      const tryPort = (port) => {
        const server = net.createServer();

        server.once('error', () => {
          server.close();
          tryPort(port + 1);
        });

        server.once('listening', () => {
          server.close(() => {
            resolve(port);
          });
        });

        server.listen(port, '0.0.0.0');
      };

      tryPort(startPort);
    });
  }

  async start() {
    const desiredPort = this.port;
    const availablePort = await this.findAvailablePort(desiredPort);

    if (availablePort !== desiredPort) {
      console.log(`⚠️  Port ${desiredPort} is in use, using port ${availablePort} instead`);
    }

    this.port = availablePort;

    this.server.listen(this.port, () => {
      console.log(`🌐 Goose Web interface running at http://localhost:${this.port}`);
    });
  }
}

// Start web server if run directly
if (require.main === module) {
  const server = new GooseWebServer();
  server.start();
}

module.exports = GooseWebServer;