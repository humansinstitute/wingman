const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const conversationManager = require('./shared-state');

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
        const { sessionName, debug, extensions, builtins } = req.body;
        
        const result = await conversationManager.startGooseSession({
          sessionName: sessionName || `web-session-${Date.now()}`,
          debug: debug || false,
          extensions: extensions || [],
          builtins: builtins || ['developer']
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