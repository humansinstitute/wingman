require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const os = require('os');
const conversationManager = require('./shared-state');
const recipeManager = require('./recipe-manager');
const MultiSessionManager = require('./multi-session-manager');

class GooseWebServer {
  constructor(port = 3000) {
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

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupConversationSync();
  }

  setupMultiSessionEvents() {
    // Handle multi-session events and broadcast to clients
    this.multiSessionManager.on('sessionMessage', (data) => {
      // Add message to conversation manager for UI compatibility
      try {
        conversationManager.addMessage(data.message);
      } catch (error) {
        console.error('Error adding message to conversation manager:', error);
      }
      
      // Broadcast to clients
      this.io.emit('newMessage', data.message);
    });

    this.multiSessionManager.on('sessionSwitched', (data) => {
      // Update conversation manager with new conversation
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

    this.app.get('/api/conversation', (req, res) => {
      res.json(conversationManager.getConversation());
    });

    this.app.get('/api/goose/status', (req, res) => {
      res.json(conversationManager.getGooseStatus());
    });

    this.app.get('/api/config', (req, res) => {
      res.json({
        inputLength: parseInt(process.env.INPUT_LENGTH) || 5000
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
        
        // Set as active session
        this.multiSessionManager.activeSessionId = sessionResult.sessionId;
        
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

    this.app.post('/api/goose/stop', async (req, res) => {
      try {
        await conversationManager.stopGooseSession();
        
        // Broadcast status update to all clients
        this.io.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
        
        res.json({ success: true });
      } catch (error) {
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
          // Set as active session
          this.multiSessionManager.activeSessionId = result.sessionId;
          
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
        const { content } = req.body;
        
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
        
        // Send message to active session
        const result = await this.multiSessionManager.sendMessageToActiveSession(content);
        
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
        const { recipeId, sessionName, parameters, workingDirectory } = req.body;
        
        if (!recipeId) {
          return res.status(400).json({ error: 'Recipe ID is required' });
        }
        
        const result = await conversationManager.startGooseSessionWithRecipe(
          recipeId, 
          { sessionName, parameters, workingDirectory }
        );
        
        if (result.success) {
          // Broadcast status update to all clients
          this.io.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
        }
        
        res.json(result);
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

    // Multi-Session Management API Endpoints
    this.app.get('/api/sessions/running', (req, res) => {
      try {
        if (!this.multiSessionManager) {
          console.log('MultiSessionManager not available, returning empty array');
          return res.json([]);
        }
        
        const runningSessions = this.multiSessionManager.getRunningSessions();
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
        res.json(availableSessions);
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

  start() {
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