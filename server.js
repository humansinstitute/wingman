require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const os = require('os');
const conversationManager = require('./shared-state');
const recipeManager = require('./recipe-manager');

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

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupConversationSync();
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
        
        const result = await conversationManager.startGooseSession({
          sessionName: sessionName || `web-session-${Date.now()}`,
          debug: debug || false,
          extensions: extensions || [],
          builtins: builtins || ['developer'],
          workingDirectory: workingDirectory
        });
        
        if (result.success) {
          // Broadcast status update to all clients
          this.io.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
        }
        
        res.json(result);
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
        
        const result = await conversationManager.resumeGooseSession(sessionName);
        
        if (result.success) {
          // Broadcast status update to all clients
          this.io.emit('gooseStatusUpdate', conversationManager.getGooseStatus());
          // Note: conversationHistory is now emitted from the conversationManager itself
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
        
        const status = conversationManager.getGooseStatus();
        if (!status.active) {
          return res.status(400).json({ 
            error: 'No active Goose session. Please start a session first.' 
          });
        }
        
        // Send message to Goose
        const userMessage = await conversationManager.sendToGoose(content);
        
        res.json({ success: true, userMessage });
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