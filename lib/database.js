const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const WingmanConfig = require('./wingman-config');

class DatabaseManager {
  constructor(dbPath = null) {
    this.dbPath = dbPath;
    this.db = null;
    this.wingmanConfig = null;
    this.isLegacyMode = false;
    
    // Initialize configuration if dbPath not explicitly provided
    if (!this.dbPath) {
      this.initializeConfig();
    }
  }

  async initializeConfig() {
    try {
      this.wingmanConfig = await WingmanConfig.create();
      
      // Determine database path based on migration status
      if (await this.wingmanConfig.needsMigration()) {
        this.isLegacyMode = true;
        this.dbPath = await this.wingmanConfig.getLegacyDatabasePath();
        console.log('Database Manager: Using legacy database path for backward compatibility');
      } else {
        this.dbPath = this.wingmanConfig.getDatabasePath();
      }
      
      console.log(`Database path: ${this.dbPath}`);
    } catch (error) {
      console.warn('Failed to initialize Wingman config for database, using fallback:', error.message);
      this.dbPath = path.join(__dirname, '..', 'data', 'wingman.db');
    }
  }

  async init() {
    try {
      // Ensure configuration is initialized
      if (!this.dbPath) {
        await this.initializeConfig();
      }
      
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
          goose_session_path TEXT,
          archived BOOLEAN DEFAULT 0,
          archived_at DATETIME,
          worktree_id TEXT,
          original_worktree TEXT
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

      await this.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          system_prompt TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS project_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          prompt TEXT,
          status TEXT NOT NULL DEFAULT 'Waiting',
          session TEXT,
          position INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
      `);

      // Handle schema upgrades for existing databases FIRST
      await this.upgradeSchema();
      
      // Create indexes for better performance AFTER schema upgrade
      await this.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions (session_name)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_sessions_worktree ON sessions (worktree_id)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_projects_name ON projects (name)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks (project_id)');
      await this.run('CREATE INDEX IF NOT EXISTS idx_project_tasks_position ON project_tasks (project_id, position)');

      console.log('Database migrations completed');
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  async upgradeSchema() {
    try {
      // Check if worktree columns exist and add them if they don't
      const tableInfo = await this.all("PRAGMA table_info(sessions)");
      const columnNames = tableInfo.map(col => col.name);
      
      if (!columnNames.includes('worktree_id')) {
        await this.run('ALTER TABLE sessions ADD COLUMN worktree_id TEXT');
        console.log('Added worktree_id column to sessions table');
      }
      
      if (!columnNames.includes('original_worktree')) {
        await this.run('ALTER TABLE sessions ADD COLUMN original_worktree TEXT');
        console.log('Added original_worktree column to sessions table');
      }

      // Update existing sessions with current worktree info
      if (this.wingmanConfig) {
        const currentWorktree = this.wingmanConfig.getWorktreeId();
        await this.run(
          'UPDATE sessions SET worktree_id = ?, original_worktree = ? WHERE worktree_id IS NULL',
          [currentWorktree, currentWorktree]
        );
      }
      
      // Ensure projects table has expected columns if it already existed
      const projectsTableInfo = await this.all("PRAGMA table_info(projects)");
      if (Array.isArray(projectsTableInfo) && projectsTableInfo.length > 0) {
        const projectColumns = projectsTableInfo.map(col => col.name);

        if (!projectColumns.includes('description')) {
          await this.run('ALTER TABLE projects ADD COLUMN description TEXT');
          console.log('Added description column to projects table');
        }

        if (!projectColumns.includes('system_prompt')) {
          await this.run('ALTER TABLE projects ADD COLUMN system_prompt TEXT');
          console.log('Added system_prompt column to projects table');
        }

        if (!projectColumns.includes('created_at')) {
          await this.run('ALTER TABLE projects ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
          console.log('Added created_at column to projects table');
        }

        if (!projectColumns.includes('updated_at')) {
          await this.run('ALTER TABLE projects ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
          console.log('Added updated_at column to projects table');
        }

        await this.run(`
          UPDATE projects
          SET
            created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
            updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        `);
      }

      // Ensure project_tasks table schema is up to date
      const projectTasksTableInfo = await this.all("PRAGMA table_info(project_tasks)");
      if (Array.isArray(projectTasksTableInfo) && projectTasksTableInfo.length > 0) {
        const taskColumns = projectTasksTableInfo.map(col => col.name);

        if (!taskColumns.includes('prompt')) {
          await this.run('ALTER TABLE project_tasks ADD COLUMN prompt TEXT');
          console.log('Added prompt column to project_tasks table');
        }

        if (!taskColumns.includes('status')) {
          await this.run("ALTER TABLE project_tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'Waiting'");
          console.log('Added status column to project_tasks table');
        }

        if (!taskColumns.includes('session')) {
          await this.run('ALTER TABLE project_tasks ADD COLUMN session TEXT');
          console.log('Added session column to project_tasks table');
        }

        if (!taskColumns.includes('position')) {
          await this.run('ALTER TABLE project_tasks ADD COLUMN position INTEGER');
          console.log('Added position column to project_tasks table');
        }

        if (!taskColumns.includes('created_at')) {
          await this.run('ALTER TABLE project_tasks ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
          console.log('Added created_at column to project_tasks table');
        }

        if (!taskColumns.includes('updated_at')) {
          await this.run('ALTER TABLE project_tasks ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
          console.log('Added updated_at column to project_tasks table');
        }

        await this.run(`
          UPDATE project_tasks
          SET
            status = COALESCE(NULLIF(status, ''), 'Waiting'),
            created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
            updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        `);
      }

    } catch (error) {
      console.warn('Schema upgrade warning:', error.message);
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
  async createSession(sessionName, gooseSessionPath = null, worktreeId = null) {
    try {
      // Determine worktree ID
      const currentWorktree = worktreeId || (this.wingmanConfig ? this.wingmanConfig.getWorktreeId() : 'main');
      
      const result = await this.run(
        'INSERT INTO sessions (session_name, goose_session_path, status, worktree_id, original_worktree) VALUES (?, ?, ?, ?, ?)',
        [sessionName, gooseSessionPath, 'active', currentWorktree, currentWorktree]
      );
      return { id: result.id, sessionName, worktreeId: currentWorktree };
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT') {
        // Session already exists, get it instead
        const existingSession = await this.getSession(sessionName);
        if (existingSession) {
          // Update worktree info for existing session
          await this.updateSessionWorktree(sessionName, worktreeId);
          return { id: existingSession.id, sessionName, worktreeId };
        }
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

  async getAllSessions(includeArchived = false) {
    const whereClause = includeArchived ? '' : 'WHERE archived = 0';
    return await this.all(
      `SELECT * FROM sessions ${whereClause} ORDER BY updated_at DESC`
    );
  }

  async getArchivedSessions() {
    return await this.all(
      'SELECT * FROM sessions WHERE archived = 1 ORDER BY archived_at DESC'
    );
  }

  async updateSessionStatus(sessionName, status) {
    await this.run(
      'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE session_name = ?',
      [status, sessionName]
    );
  }

  async updateSessionWorktree(sessionName, worktreeId = null) {
    const currentWorktree = worktreeId || (this.wingmanConfig ? this.wingmanConfig.getWorktreeId() : 'main');
    await this.run(
      'UPDATE sessions SET worktree_id = ?, updated_at = CURRENT_TIMESTAMP WHERE session_name = ?',
      [currentWorktree, sessionName]
    );
  }

  async getSessionsByWorktree(worktreeId, includeArchived = false) {
    const whereClause = includeArchived 
      ? 'WHERE worktree_id = ?' 
      : 'WHERE worktree_id = ? AND archived = 0';
    return await this.all(
      `SELECT * FROM sessions ${whereClause} ORDER BY updated_at DESC`,
      [worktreeId]
    );
  }

  async getAllSessionsWithWorktree(includeArchived = false) {
    const whereClause = includeArchived ? '' : 'WHERE archived = 0';
    return await this.all(
      `SELECT *, 
        CASE WHEN worktree_id IS NULL THEN 'main' ELSE worktree_id END as worktree_id,
        CASE WHEN original_worktree IS NULL THEN 'main' ELSE original_worktree END as original_worktree
       FROM sessions ${whereClause} ORDER BY updated_at DESC`
    );
  }

  async deleteSession(sessionName) {
    const result = await this.run(
      'DELETE FROM sessions WHERE session_name = ?',
      [sessionName]
    );
    return result.changes > 0;
  }

  // Archive operations
  async archiveSession(sessionName) {
    const result = await this.run(
      'UPDATE sessions SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE session_name = ? AND archived = 0',
      [sessionName]
    );
    return result.changes > 0;
  }

  async archiveSessionById(sessionId) {
    const result = await this.run(
      'UPDATE sessions SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived = 0',
      [sessionId]
    );
    return result.changes > 0;
  }

  async restoreSession(sessionName) {
    const result = await this.run(
      'UPDATE sessions SET archived = 0, archived_at = NULL WHERE session_name = ? AND archived = 1',
      [sessionName]
    );
    return result.changes > 0;
  }

  async restoreSessionById(sessionId) {
    const result = await this.run(
      'UPDATE sessions SET archived = 0, archived_at = NULL WHERE id = ? AND archived = 1',
      [sessionId]
    );
    return result.changes > 0;
  }

  // Bulk operations
  async archiveAllSessions() {
    const result = await this.run(
      'UPDATE sessions SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE archived = 0'
    );
    return result.changes;
  }

  async archiveNonActiveSessions() {
    const result = await this.run(
      'UPDATE sessions SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE status != ? AND archived = 0',
      ['active']
    );
    return result.changes;
  }

  async deleteAllSessions() {
    const result = await this.run('DELETE FROM sessions');
    return result.changes;
  }

  async deleteNonActiveSessions() {
    const result = await this.run(
      'DELETE FROM sessions WHERE status != ?',
      ['active']
    );
    return result.changes;
  }

  async deleteArchivedSessions() {
    const result = await this.run(
      'DELETE FROM sessions WHERE archived = 1'
    );
    return result.changes;
  }

  async restoreAllArchivedSessions() {
    const result = await this.run(
      'UPDATE sessions SET archived = 0, archived_at = NULL WHERE archived = 1'
    );
    return result.changes;
  }

  async deleteOldArchivedSessions(days = 30) {
    // Use SQLite datetime comparison to avoid string-format issues
    const interval = `-${days} days`;
    const result = await this.run(
      "DELETE FROM sessions WHERE archived = 1 AND datetime(archived_at) < datetime('now', ?)",
      [interval]
    );
    return result.changes;
  }

  // Get count of archived sessions older than specified days
  async getOldArchivedSessionsCount(days = 30) {
    const interval = `-${days} days`;
    const result = await this.get(
      "SELECT COUNT(*) as count FROM sessions WHERE archived = 1 AND datetime(archived_at) < datetime('now', ?)",
      [interval]
    );
    return result.count;
  }

  // Get list of archived sessions older than specified days
  async getOldArchivedSessions(days = 30) {
    const interval = `-${days} days`;
    return await this.all(
      "SELECT * FROM sessions WHERE archived = 1 AND datetime(archived_at) < datetime('now', ?)",
      [interval]
    );
  }

  // Get existing session or create new one
  async getOrCreateSession(sessionName, gooseSessionPath = null, worktreeId = null) {
    let session = await this.getSession(sessionName);
    if (!session) {
      const createResult = await this.createSession(sessionName, gooseSessionPath, worktreeId);
      session = { 
        id: createResult.id, 
        session_name: sessionName,
        worktree_id: createResult.worktreeId 
      };
    } else {
      // Update worktree info for existing session if needed
      const currentWorktree = worktreeId || (this.wingmanConfig ? this.wingmanConfig.getWorktreeId() : 'main');
      if (session.worktree_id !== currentWorktree) {
        await this.updateSessionWorktree(sessionName, currentWorktree);
        session.worktree_id = currentWorktree;
      }
    }
    return session;
  }

  // Message management methods
  async addMessage(sessionName, message) {
    // Get or create session
    const session = await this.getOrCreateSession(sessionName);

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

  // Store complete session context
  async storeSessionContext(sessionName, context) {
    const session = await this.getOrCreateSession(sessionName);
    
    const contextEntries = [
      ['working_directory', context.workingDirectory],
      ['recipe_id', context.recipeId || null],
      ['recipe_parameters', context.recipeParameters ? JSON.stringify(context.recipeParameters) : null],
      ['extensions', context.extensions ? JSON.stringify(context.extensions) : null],
      ['builtins', context.builtins ? JSON.stringify(context.builtins) : null],
      ['debug_mode', context.debug ? 'true' : 'false'],
      ['max_turns', context.maxTurns ? context.maxTurns.toString() : null],
      ['recipe_config', context.recipeConfig ? JSON.stringify(context.recipeConfig) : null],
      ['provider', context.provider || null],
      ['model', context.model || null]
    ];

    for (const [key, value] of contextEntries) {
      if (value !== null) {
        await this.setSessionMetadata(sessionName, key, value);
      }
    }
  }

  // Retrieve complete session context
  async getSessionContext(sessionName) {
    const session = await this.getSession(sessionName);
    if (!session) {
      return null;
    }

    const context = {};
    
    const workingDirectory = await this.getSessionMetadata(sessionName, 'working_directory');
    if (workingDirectory) context.workingDirectory = workingDirectory;
    
    const recipeId = await this.getSessionMetadata(sessionName, 'recipe_id');
    if (recipeId) context.recipeId = recipeId;
    
    const recipeParameters = await this.getSessionMetadata(sessionName, 'recipe_parameters');
    if (recipeParameters) {
      try {
        context.recipeParameters = JSON.parse(recipeParameters);
      } catch (e) {
        console.warn('Failed to parse recipe parameters:', e);
      }
    }
    
    const extensions = await this.getSessionMetadata(sessionName, 'extensions');
    if (extensions) {
      try {
        context.extensions = JSON.parse(extensions);
      } catch (e) {
        console.warn('Failed to parse extensions:', e);
        context.extensions = [];
      }
    }
    
    const builtins = await this.getSessionMetadata(sessionName, 'builtins');
    if (builtins) {
      try {
        context.builtins = JSON.parse(builtins);
      } catch (e) {
        console.warn('Failed to parse builtins:', e);
        context.builtins = [];
      }
    }
    
    const debugMode = await this.getSessionMetadata(sessionName, 'debug_mode');
    if (debugMode) context.debug = debugMode === 'true';
    
    const maxTurns = await this.getSessionMetadata(sessionName, 'max_turns');
    if (maxTurns) context.maxTurns = parseInt(maxTurns);
    
    const recipeConfig = await this.getSessionMetadata(sessionName, 'recipe_config');
    if (recipeConfig) {
      try {
        context.recipeConfig = JSON.parse(recipeConfig);
      } catch (e) {
        console.warn('Failed to parse recipe config:', e);
      }
    }
    
    const provider = await this.getSessionMetadata(sessionName, 'provider');
    if (provider) context.provider = provider;
    
    const model = await this.getSessionMetadata(sessionName, 'model');
    if (model) context.model = model;

    return context;
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

  // Project management
  async createProject({ name, description = '', systemPrompt = '' }) {
    const result = await this.run(`
      INSERT INTO projects (name, description, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [name, description, systemPrompt]);

    return await this.getProjectById(result.id);
  }

  async getProjectById(projectId) {
    return await this.get('SELECT * FROM projects WHERE id = ?', [projectId]);
  }

  async getProjects() {
    return await this.all(
      'SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC'
    );
  }

  async updateProject(projectId, { name, description, systemPrompt }) {
    const fields = [];
    const params = [];

    if (typeof name === 'string') {
      fields.push('name = ?');
      params.push(name);
    }

    if (typeof description === 'string') {
      fields.push('description = ?');
      params.push(description);
    }

    if (typeof systemPrompt === 'string') {
      fields.push('system_prompt = ?');
      params.push(systemPrompt);
    }

    if (fields.length === 0) {
      return await this.getProjectById(projectId);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(projectId);

    await this.run(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    return await this.getProjectById(projectId);
  }

  async deleteProject(projectId) {
    const result = await this.run('DELETE FROM projects WHERE id = ?', [projectId]);
    return result.changes > 0;
  }

  async getProjectTasks(projectId) {
    return await this.all(
      `SELECT * FROM project_tasks WHERE project_id = ? ORDER BY position ASC, created_at ASC, id ASC`,
      [projectId]
    );
  }

  async getProjectTaskById(taskId) {
    return await this.get('SELECT * FROM project_tasks WHERE id = ?', [taskId]);
  }

  async createProjectTask(projectId, { name, prompt = '', status = 'Waiting', session = null, position = null }) {
    const normalizedStatus = this.normalizeTaskStatus(status);
    const resolvedPosition = await this.resolveTaskPosition(projectId, position);

    const result = await this.run(`
      INSERT INTO project_tasks (project_id, name, prompt, status, session, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [projectId, name, prompt, normalizedStatus, session, resolvedPosition]);

    return await this.getProjectTaskById(result.id);
  }

  async updateProjectTask(taskId, { name, prompt, status, session, position }) {
    const fields = [];
    const params = [];

    if (typeof name === 'string') {
      fields.push('name = ?');
      params.push(name);
    }

    if (typeof prompt === 'string') {
      fields.push('prompt = ?');
      params.push(prompt);
    }

    if (typeof status === 'string') {
      fields.push('status = ?');
      params.push(this.normalizeTaskStatus(status));
    }

    if (typeof session === 'string') {
      fields.push('session = ?');
      params.push(session);
    }

    if (position !== undefined) {
      const task = await this.getProjectTaskById(taskId);
      if (task) {
        const resolvedPosition = await this.resolveTaskPosition(task.project_id, position);
        fields.push('position = ?');
        params.push(resolvedPosition);
      }
    }

    if (fields.length === 0) {
      return await this.getProjectTaskById(taskId);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(taskId);

    await this.run(
      `UPDATE project_tasks SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    return await this.getProjectTaskById(taskId);
  }

  async deleteProjectTask(taskId) {
    const result = await this.run('DELETE FROM project_tasks WHERE id = ?', [taskId]);
    return result.changes > 0;
  }

  async reorderProjectTasks(projectId, taskIds) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return await this.getProjectTasks(projectId);
    }

    const normalizedIds = taskIds
      .map((id) => {
        const value = Number.parseInt(String(id), 10);
        return Number.isInteger(value) && value > 0 ? value : null;
      })
      .filter((value) => value !== null);

    if (normalizedIds.length === 0) {
      return await this.getProjectTasks(projectId);
    }

    const uniqueIds = Array.from(new Set(normalizedIds));

    // Ensure all referenced tasks exist for this project
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = await this.all(
      `SELECT id FROM project_tasks WHERE project_id = ? AND id IN (${placeholders})`,
      [projectId, ...uniqueIds]
    );

    if (!Array.isArray(rows) || rows.length !== uniqueIds.length) {
      throw new Error('Invalid task ids for reorder');
    }

    await this.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (let index = 0; index < normalizedIds.length; index += 1) {
        const taskId = normalizedIds[index];
        await this.run(
          'UPDATE project_tasks SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND id = ?',
          [index, projectId, taskId]
        );
      }
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }

    return await this.getProjectTasks(projectId);
  }

  async resolveTaskPosition(projectId, position) {
    if (Number.isInteger(position) && position >= 0) {
      return position;
    }

    const row = await this.get(
      'SELECT MAX(position) as max_position FROM project_tasks WHERE project_id = ?',
      [projectId]
    );

    const maxPosition = row && typeof row.max_position === 'number'
      ? row.max_position
      : (row && row.max_position !== null ? Number.parseInt(row.max_position, 10) : null);

    if (Number.isInteger(maxPosition)) {
      return maxPosition + 1;
    }

    return 0;
  }

  normalizeTaskStatus(status) {
    const allowed = new Set(['Waiting', 'In Progress', 'Complete']);
    if (typeof status === 'string') {
      const trimmed = status.trim();
      for (const option of allowed) {
        if (option.toLowerCase() === trimmed.toLowerCase()) {
          return option;
        }
      }
    }
    return 'Waiting';
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
