const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

class DatabaseManager {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'wingman.db');
    this.db = null;
  }

  async init() {
    try {
      // Ensure the data directory exists
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Initialize database connection
      this.db = new sqlite3.Database(this.dbPath);
      
      // Enable foreign keys
      await this.run('PRAGMA foreign_keys = ON');
      
      // Run migrations
      await this.runMigrations();
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async runMigrations() {
    try {
      // Create tables if they don't exist
      await this.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_name TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'inactive',
          goose_session_path TEXT
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT DEFAULT 'web-interface',
          message_id TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS session_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER,
          key TEXT NOT NULL,
          value TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
        )
      `);

      // Create indexes for better performance
      await this.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions (session_name)');
      
      console.log('Database migrations completed');
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  // Promise wrapper for database operations
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Session management methods
  async createSession(sessionName, gooseSessionPath = null) {
    try {
      const result = await this.run(
        'INSERT INTO sessions (session_name, goose_session_path, status) VALUES (?, ?, ?)',
        [sessionName, gooseSessionPath, 'active']
      );
      return { id: result.id, sessionName };
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Session '${sessionName}' already exists`);
      }
      throw error;
    }
  }

  async getSession(sessionName) {
    return await this.get(
      'SELECT * FROM sessions WHERE session_name = ?',
      [sessionName]
    );
  }

  async getSessionById(sessionId) {
    return await this.get(
      'SELECT * FROM sessions WHERE id = ?',
      [sessionId]
    );
  }

  async getAllSessions() {
    return await this.all(
      'SELECT * FROM sessions ORDER BY updated_at DESC'
    );
  }

  async updateSessionStatus(sessionName, status) {
    await this.run(
      'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE session_name = ?',
      [status, sessionName]
    );
  }

  async deleteSession(sessionName) {
    const result = await this.run(
      'DELETE FROM sessions WHERE session_name = ?',
      [sessionName]
    );
    return result.changes > 0;
  }

  // Message management methods
  async addMessage(sessionName, message) {
    // Get or create session
    let session = await this.getSession(sessionName);
    if (!session) {
      const createResult = await this.createSession(sessionName);
      session = { id: createResult.id };
    }

    // Insert message
    const result = await this.run(`
      INSERT INTO messages (session_id, role, content, timestamp, source, message_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      message.role,
      message.content,
      message.timestamp || new Date().toISOString(),
      message.source || 'web-interface',
      message.id || null
    ]);

    // Update session timestamp
    await this.run(
      'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [session.id]
    );

    return {
      id: result.id,
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    };
  }

  async getMessages(sessionName, limit = null) {
    const session = await this.getSession(sessionName);
    if (!session) {
      return [];
    }

    let sql = `
      SELECT * FROM messages 
      WHERE session_id = ? 
      ORDER BY timestamp ASC
    `;
    
    const params = [session.id];
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    return await this.all(sql, params);
  }

  async getAllMessages() {
    return await this.all(`
      SELECT m.*, s.session_name 
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      ORDER BY m.timestamp ASC
    `);
  }

  async clearMessages(sessionName) {
    const session = await this.getSession(sessionName);
    if (!session) {
      return false;
    }

    const result = await this.run(
      'DELETE FROM messages WHERE session_id = ?',
      [session.id]
    );
    return result.changes > 0;
  }

  async clearAllMessages() {
    const result = await this.run('DELETE FROM messages');
    return result.changes;
  }

  // Metadata management
  async setSessionMetadata(sessionName, key, value) {
    const session = await this.getSession(sessionName);
    if (!session) {
      throw new Error(`Session '${sessionName}' not found`);
    }

    await this.run(`
      INSERT OR REPLACE INTO session_metadata (session_id, key, value)
      VALUES (?, ?, ?)
    `, [session.id, key, value]);
  }

  async getSessionMetadata(sessionName, key) {
    const session = await this.getSession(sessionName);
    if (!session) {
      return null;
    }

    const result = await this.get(
      'SELECT value FROM session_metadata WHERE session_id = ? AND key = ?',
      [session.id, key]
    );
    return result ? result.value : null;
  }

  // Database maintenance
  async vacuum() {
    await this.run('VACUUM');
  }

  async getStats() {
    const sessionCount = await this.get('SELECT COUNT(*) as count FROM sessions');
    const messageCount = await this.get('SELECT COUNT(*) as count FROM messages');
    const dbSize = await this.get('PRAGMA page_count');
    
    return {
      sessions: sessionCount.count,
      messages: messageCount.count,
      dbPages: dbSize['page_count']
    };
  }

  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('Database connection closed');
            resolve();
          }
        });
      });
    }
  }
}

// Singleton instance
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}

module.exports = {
  DatabaseManager,
  getDatabase
};