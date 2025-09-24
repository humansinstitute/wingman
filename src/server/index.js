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

// Auto-setup check
const AutoSetup = require('../../lib/auto-setup');
const DEBUG_LOGS = process.env.WINGMAN_DEBUG === '1' || process.env.LOG_LEVEL === 'debug';
const autoSetup = new AutoSetup();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const pty = require('node-pty');
const recipeManager = require('../recipes/manager');
const MultiSessionManager = require('./managers/multi-session-manager');
const mcpServerRegistry = require('../mcp/registry');
const TriggerHandler = require('../../lib/triggers/trigger-handler');

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

    // Deep Dive terminal namespace
    this.terminalNamespace = this.io.of('/terminal');
    this.setupTerminalHandlers();
  }

  setupMultiSessionEvents() {
    // Handle multi-session events and broadcast to clients
    this.multiSessionManager.on('sessionMessage', (data) => {
      // Broadcast to clients; storage and caching handled by manager
      this.io.emit('newMessage', data.message);
    });

    this.multiSessionManager.on('sessionSwitched', (data) => {
      this.io.emit('sessionsUpdate', {
        type: 'sessionSwitched',
        sessionId: data.toSessionId,
        conversation: data.conversation
      });
      this.io.emit('conversationHistory', data.conversation);
    });

    this.multiSessionManager.on('conversationLoaded', (data) => {
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
    // Serve static assets from project public/ regardless of file location
    this.app.use(express.static(path.join(process.cwd(), 'public')));
  }

  setupRoutes() {
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });

    this.app.get('/recipes', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'recipes.html'));
    });

    this.app.get('/deep-dive', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'deep-dive.html'));
    });

    this.app.get('/mcp-servers', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'mcp-servers.html'));
    });
    
    // Conversation endpoints
    // Goose config: providers/models
    this.app.get('/api/goose-config/providers', async (req, res) => {
      try {
        const GooseConfigService = require('../shared/config/goose-config-service');
        const gcs = new GooseConfigService();
        const cfg = await gcs.loadConfiguration();
        const result = cfg?.providers?.providers || [];
        res.json({ providers: result });
      } catch (error) {
        console.warn('Failed to load Goose providers:', error.message);
        res.json({ providers: [] });
      }
    });

    // Conversation endpoints
    this.app.get('/api/conversation', async (req, res) => {
      try {
        const activeId = this.multiSessionManager.activeSessionId;
        if (!activeId) return res.json([]);
        const cached = this.multiSessionManager.conversationCache.get(activeId) || [];
        if (cached.length > 0) return res.json(cached);
        const metadata = this.multiSessionManager.sessionMetadata.get(activeId);
        if (!metadata) return res.json([]);
        const messages = await this.multiSessionManager.db.getMessages(metadata.sessionName);
        const conversation = messages.map(msg => ({
          id: msg.message_id || msg.id?.toString?.() || `${msg.rowid || ''}`,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          source: msg.source
        }));
        res.json(conversation);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/conversation', async (req, res) => {
      try {
        const activeId = this.multiSessionManager.activeSessionId;
        if (!activeId) return res.json({ success: true });
        const metadata = this.multiSessionManager.sessionMetadata.get(activeId);
        if (metadata && this.multiSessionManager.dbInitialized) {
          await this.multiSessionManager.db.clearMessages(metadata.sessionName);
        }
        this.multiSessionManager.conversationCache.set(activeId, []);
        this.io.emit('conversationHistory', []);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Goose status/config
    this.app.get('/api/goose/status', (req, res) => {
      try {
        const activeId = this.multiSessionManager.activeSessionId;
        if (!activeId) return res.json({ active: false, sessionName: null, ready: false });
        const meta = this.multiSessionManager.sessionMetadata.get(activeId);
        const wrapper = this.multiSessionManager.sessions.get(activeId);
        res.json({
          active: true,
          sessionName: meta?.sessionName || null,
          ready: !!(wrapper && wrapper.isReady)
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/config', (req, res) => {
      const purgeDays = process.env.ARCHIVE_PURGE_DAYS !== undefined ? parseInt(process.env.ARCHIVE_PURGE_DAYS) : 30;
      res.json({
        inputLength: parseInt(process.env.INPUT_LENGTH) || 5000,
        ARCHIVE_PURGE_DAYS: purgeDays
      });
    });

    // Sessions
    this.app.get('/api/goose/sessions', async (req, res) => {
      try {
        const availableSessions = await this.multiSessionManager.getAvailableSessions();
        const db = require('../shared/utils/database').getDatabase();
        const archivedSessions = await db.getArchivedSessions();
        const archivedNames = archivedSessions.map(s => s.session_name);
        const nonArchived = availableSessions.filter(s => !archivedNames.includes(s.id));
        res.json(nonArchived);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/sessions/running', async (req, res) => {
      try {
        const running = await this.multiSessionManager.getRunningSessions();
        res.json(running);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Sessions - available (non-archived)
    this.app.get('/api/sessions/available', async (req, res) => {
      try {
        const availableSessions = await this.multiSessionManager.getAvailableSessions();
        // Filter out archived sessions if DB supports it
        try {
          const db = require('../shared/utils/database').getDatabase();
          const archivedSessions = await db.getArchivedSessions();
          const archivedNames = archivedSessions.map(s => s.session_name);
          const nonArchived = availableSessions.filter(s => !archivedNames.includes(s.id));
          return res.json(nonArchived);
        } catch (_) {
          // If archived check fails, return all available
          return res.json(availableSessions);
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Session info (provider/model, stats)
    this.app.get('/api/sessions/:sessionId/info', async (req, res) => {
      try {
        const info = await this.multiSessionManager.getSessionInfo(req.params.sessionId);
        if (!info) return res.status(404).json({ error: 'Session not found' });
        res.json(info);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Switch active session
    this.app.post('/api/sessions/switch/:sessionId', async (req, res) => {
      try {
        const result = await this.multiSessionManager.switchSession(req.params.sessionId);
        res.json({ success: true, ...result });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Stop a specific session
    this.app.post('/api/sessions/stop/:sessionId', async (req, res) => {
      try {
        const result = await this.multiSessionManager.stopSession(req.params.sessionId);
        res.json({ success: true, ...result });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Archive operations
    this.app.get('/api/sessions/archived', async (req, res) => {
      try {
        const db = require('../shared/utils/database').getDatabase();
        const archived = await db.getArchivedSessions();
        res.json(archived);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/archive', async (req, res) => {
      try {
        const { sessionName } = req.body;
        if (!sessionName) return res.status(400).json({ error: 'sessionName required' });
        const db = require('../shared/utils/database').getDatabase();
        const ok = await db.archiveSession(sessionName);
        if (!ok) return res.status(404).json({ error: 'Session not found or already archived' });
        res.json({ success: true, message: `Archived ${sessionName}` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/archive-all', async (req, res) => {
      try {
        const db = require('../shared/utils/database').getDatabase();
        const count = await db.archiveAllSessions();
        res.json({ success: true, message: `Archived ${count} session(s)` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/sessions/archived/old', async (req, res) => {
      try {
        const db = require('../shared/utils/database').getDatabase();
        const purgeDays = process.env.ARCHIVE_PURGE_DAYS !== undefined ? parseInt(process.env.ARCHIVE_PURGE_DAYS) : 30;
        const count = await db.deleteOldArchivedSessions(purgeDays);
        res.json({ success: true, message: `Deleted ${count} old archived session(s)` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/sessions/:sessionId/restore', async (req, res) => {
      try {
        const db = require('../shared/utils/database').getDatabase();
        const ok = await db.restoreSessionById(req.params.sessionId);
        if (!ok) return res.status(404).json({ error: 'Archived session not found' });
        res.json({ success: true, message: 'Session restored' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/sessions/:sessionId', async (req, res) => {
      try {
        const db = require('../shared/utils/database').getDatabase();
        const session = await db.getSessionById(req.params.sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const ok = await db.deleteSession(session.session_name);
        if (!ok) return res.status(400).json({ error: 'Failed to delete session' });
        res.json({ success: true, message: `Deleted ${session.session_name}` });
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
        await this.multiSessionManager.switchSession(sessionResult.sessionId);
        this.io.emit('sessionsUpdate', { type: 'sessionStarted', sessionId: sessionResult.sessionId, sessionName: sessionResult.sessionName });
        this.io.emit('gooseStatusUpdate', { active: true, sessionName: sessionResult.sessionName, ready: true });
        res.json({ success: true, sessionId: sessionResult.sessionId, sessionName: sessionResult.sessionName });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Start a Goose session using a recipe (processed with parameters)
    this.app.post('/api/goose/start-with-recipe', async (req, res) => {
      try {
        const { recipeId, sessionName, parameters, workingDirectory, providerOverride, debug } = req.body || {};
        if (!recipeId) return res.status(400).json({ error: 'recipeId is required' });

        // Load recipe
        const recipe = await recipeManager.getRecipe(recipeId);
        if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

        // Process template parameters
        const processedRecipe = await recipeManager.processTemplate(recipe, parameters || {});

        // Create temporary recipe file for Goose CLI
        const fs = require('fs').promises;
        const path = require('path');
        const os = require('os');
        const wingHome = process.env.WINGMAN_HOME || path.join(os.homedir(), '.wingman');
        const tempDir = path.join(wingHome, 'tmp', 'recipes');
        await fs.mkdir(tempDir, { recursive: true });
        const tempRecipePath = path.join(tempDir, `recipe-${Date.now()}.json`);
        await fs.writeFile(tempRecipePath, JSON.stringify(processedRecipe, null, 2));

        // Determine provider/model from override or recipe settings
        let provider = providerOverride?.provider || processedRecipe?.settings?.goose_provider || null;
        let model = providerOverride?.model || processedRecipe?.settings?.goose_model || null;

        // Create session wired to this recipe
        const newSessionName = sessionName || `recipe-${recipe.name || recipe.title || 'session'}-${Date.now()}`;
        const sessionResult = await this.multiSessionManager.createSession({
          sessionName: newSessionName,
          debug: !!debug,
          // Keep for metadata and analytics
          extensions: processedRecipe.extensions || [],
          builtins: processedRecipe.builtins || [],
          workingDirectory: workingDirectory || process.cwd(),
          // Provider/model (optional)
          provider,
          model,
          // Recipe context for wrapper/restore
          recipeId: recipe.id,
          recipeConfig: processedRecipe,
          recipePath: tempRecipePath
        });

        // Start and activate the session
        await this.multiSessionManager.startSession(sessionResult.sessionId);
        await this.multiSessionManager.switchSession(sessionResult.sessionId);

        // Broadcast updates
        this.io.emit('sessionsUpdate', { type: 'sessionStarted', sessionId: sessionResult.sessionId, sessionName: sessionResult.sessionName });
        this.io.emit('gooseStatusUpdate', { active: true, sessionName: sessionResult.sessionName, ready: true });

        res.json({ success: true, sessionId: sessionResult.sessionId, sessionName: sessionResult.sessionName, recipe: { id: recipe.id, name: recipe.name || recipe.title } });
      } catch (error) {
        // Ensure JSON response for UI
        res.status(500).json({ error: error.message || String(error) });
      }
    });

    this.app.post('/api/goose/resume', async (req, res) => {
      try {
        const { sessionName } = req.body;
        if (!sessionName) return res.status(400).json({ error: 'Session name is required' });
        const result = await this.multiSessionManager.resumeSession(sessionName);
        if (result.success) {
          this.io.emit('sessionsUpdate', { type: 'sessionResumed', sessionId: result.sessionId, sessionName });
          this.io.emit('gooseStatusUpdate', { active: true, sessionName, ready: true });
        }
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/stop', async (req, res) => {
      try {
        try { await this.multiSessionManager.interruptActiveSession(); } catch {}
        const result = await this.multiSessionManager.forceStopActiveSession();
        this.io.emit('sessionForceStopped', { sessionId: result.sessionId, timestamp: new Date().toISOString() });
        this.io.emit('gooseStatusUpdate', { active: false, sessionName: null, ready: false });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/goose/interrupt', async (req, res) => {
      try {
        const result = await this.multiSessionManager.interruptActiveSession();
        this.io.emit('sessionInterrupted', { sessionId: result.sessionId, timestamp: new Date().toISOString() });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/message', async (req, res) => {
      try {
        const { content, settings } = req.body;
        if (!content) return res.status(400).json({ error: 'Content required' });
        console.log(`[HTTP] /api/message received: ${String(content).slice(0,120)}${String(content).length>120?'...':''}`);
        const activeId = this.multiSessionManager.activeSessionId;
        if (!activeId) return res.status(400).json({ error: 'No active Goose session. Please start a session first.' });
        const result = await this.multiSessionManager.sendMessageToActiveSession(content, settings);
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Recipes (minimal endpoints for UI)
    this.app.get('/api/recipes', async (req, res) => {
      try {
        const { category, search, limit, sortBy } = req.query;
        const recipes = await recipeManager.getAllRecipes({ category, search, limit, sortBy });
        res.json(recipes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/recipes/:id', async (req, res) => {
      try {
        const recipe = await recipeManager.getRecipe(req.params.id);
        if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
        res.json(recipe);
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

    this.app.post('/api/recipes/import', async (req, res) => {
      try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });
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

    this.app.get('/api/recipes/:id/sub-recipes', async (req, res) => {
      try {
        const subRecipes = await recipeManager.getSubRecipes(req.params.id);
        res.json(subRecipes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/recipes/search', async (req, res) => {
      try {
        const { query } = req.body;
        const recipes = await recipeManager.searchRecipes(query || '');
        res.json(recipes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // MCP Servers (minimal)
    this.app.get('/api/mcp-servers', async (req, res) => {
      try {
        const { includeUsage, sortBy } = req.query;
        const servers = await mcpServerRegistry.getAllServers({ includeUsage: includeUsage === 'true', sortBy: sortBy || 'name' });
        res.json(servers);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    this.app.get('/api/mcp-servers/stats', async (req, res) => {
      try {
        const stats = await mcpServerRegistry.getStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/mcp-servers/:id', async (req, res) => {
      try {
        const server = await mcpServerRegistry.getServer(req.params.id);
        if (!server) return res.status(404).json({ error: 'MCP server not found' });
        res.json({ id: req.params.id, ...server });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/mcp-servers', async (req, res) => {
      try {
        const server = await mcpServerRegistry.registerServer(req.body);
        res.status(201).json(server);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.put('/api/mcp-servers/:id', async (req, res) => {
      try {
        const server = await mcpServerRegistry.updateServer(req.params.id, req.body);
        res.json(server);
      } catch (error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      }
    });

    this.app.delete('/api/mcp-servers/:id', async (req, res) => {
      try {
        const result = await mcpServerRegistry.unregisterServer(req.params.id);
        res.json(result);
      } catch (error) {
        if (error.message.includes('not found')) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      }
    });

    this.app.post('/api/mcp-servers/search', async (req, res) => {
      try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Search query is required' });
        const servers = await mcpServerRegistry.searchServers(query);
        res.json(servers);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/mcp-servers/recipe/:recipeId', async (req, res) => {
      try {
        const servers = await mcpServerRegistry.getServersForRecipe(req.params.recipeId);
        res.json(servers);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/mcp-servers/import-from-recipes', async (req, res) => {
      try {
        const recipes = await recipeManager.getAllRecipes();
        const result = await mcpServerRegistry.importFromRecipes(recipes);
        res.json({ success: true, imported: result.importedServers.length, errors: result.errors, servers: result.importedServers });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Directory browsing for recipe paths
    this.app.get('/api/directories', async (req, res) => {
      try {
        const fs = require('fs').promises;
        const p = require('path');
        const osmod = require('os');
        const { dir } = req.query;
        let defaultDir = process.env.ROOT_WORKING_DIR || osmod.homedir();
        if (defaultDir.startsWith('~/')) {
          defaultDir = p.join(osmod.homedir(), defaultDir.slice(2));
        }
        const targetDir = dir || defaultDir;
        const resolvedPath = p.resolve(targetDir);
        const items = await fs.readdir(resolvedPath, { withFileTypes: true });
        const directories = items.filter(i => i.isDirectory()).map(i => ({ name: i.name, path: p.join(resolvedPath, i.name), isDirectory: true }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const parentPath = p.dirname(resolvedPath);
        let result = directories;
        if (parentPath !== resolvedPath) {
          result = [{ name: '..', path: parentPath, isDirectory: true, isParent: true }, ...directories];
        }
        res.json({ currentPath: resolvedPath, directories: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/create-directory', async (req, res) => {
      try {
        const fs = require('fs').promises;
        const p = require('path');
        const { parentPath, folderName } = req.body;
        if (!parentPath || !folderName) return res.status(400).send('Parent path and folder name are required');
        const newPath = p.join(parentPath, folderName);
        await fs.mkdir(newPath, { recursive: true });
        res.json({ success: true, path: newPath });
      } catch (error) {
        res.status(500).send(error.message);
      }
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client connected');

      try {
        const activeId = this.multiSessionManager.activeSessionId;
        if (activeId) {
          const conv = this.multiSessionManager.conversationCache.get(activeId) || [];
          socket.emit('conversationHistory', conv);
          const meta = this.multiSessionManager.sessionMetadata.get(activeId);
          const wrapper = this.multiSessionManager.sessions.get(activeId);
          socket.emit('gooseStatusUpdate', {
            active: true,
            sessionName: meta?.sessionName || null,
            ready: !!(wrapper && wrapper.isReady)
          });
        } else {
          socket.emit('conversationHistory', []);
          socket.emit('gooseStatusUpdate', { active: false, sessionName: null, ready: false });
        }
      } catch (e) {
        socket.emit('conversationHistory', []);
        socket.emit('gooseStatusUpdate', { active: false, sessionName: null, ready: false });
      }
    });
  }

  setupTerminalHandlers() {
    const terminalState = {
      lastAuthTime: null,
      authenticated: new Map()
    };

    const PIN_TIMEOUT = parseInt(process.env.PIN_TIMEOUT, 10) || 45; // seconds

    this.terminalNamespace.on('connection', (socket) => {
      console.log('Terminal client connected');

      let ptyProcess = null;
      let authenticated = false;

      const now = Date.now();
      if (terminalState.lastAuthTime && (now - terminalState.lastAuthTime) < (PIN_TIMEOUT * 1000)) {
        authenticated = true;
        terminalState.authenticated.set(socket.id, now);
        socket.emit('auth-success');
        console.log('Authentication still valid, skipping PIN entry');
      } else {
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
          if (ptyProcess) {
            try {
              ptyProcess.kill();
            } catch (_) {}
          }

          const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
          const cols = dimensions?.cols || 80;
          const rows = dimensions?.rows || 24;

          ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: process.cwd(),
            env: process.env
          });

          console.log('Terminal process started with PID:', ptyProcess.pid);

          ptyProcess.onData((data) => {
            socket.emit('terminal-output', data);
          });

          ptyProcess.onExit(({ exitCode, signal } = {}) => {
            console.log('Terminal process exited', { exitCode, signal });
            const message = typeof exitCode === 'number'
              ? `Terminal process exited with code: ${exitCode}`
              : 'Terminal process exited';
            socket.emit('terminal-error', message);
          });

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
        if (ptyProcess && dimensions?.cols && dimensions?.rows) {
          try {
            ptyProcess.resize(dimensions.cols, dimensions.rows);
          } catch (error) {
            console.warn('Failed to resize terminal:', error.message);
          }
        }
      });

      socket.on('disconnect', () => {
        console.log('Terminal client disconnected');
        terminalState.authenticated.delete(socket.id);

        if (ptyProcess) {
          try {
            console.log('Killing terminal process with PID:', ptyProcess.pid);
            ptyProcess.kill();
          } catch (error) {
            console.warn('Failed to kill terminal process:', error.message);
          }
          ptyProcess = null;
        }
      });
    });
  }

  start() {
    this.server.listen(this.port, () => {
      console.log(`Server listening on port ${this.port}`);
    });
  }
}

async function startServer() {
  // Run auto-setup check
  await autoSetup.checkAndPrompt();
  
  // Start the server
  const server = new GooseWebServer();
  server.start();
  return server;
}

module.exports = { GooseWebServer, startServer };

if (require.main === module) {
  startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
