# Multi-Session Goose Implementation

## Overview

I've implemented a comprehensive multi-session system for Wingman that allows you to run multiple Goose sessions concurrently in subprocesses and switch between them seamlessly.

## Architecture

### Core Components

1. **SessionManager** (`lib/session-manager.js`)
   - Manages multiple concurrent Goose sessions
   - Each session runs in its own subprocess
   - Provides session lifecycle management (create, switch, stop, delete)

2. **SessionProcess** (within SessionManager)
   - Individual subprocess wrapper for each Goose session
   - Handles communication with Goose CLI
   - Manages session state and output streaming

3. **MultiSessionConversationManager** (`lib/multi-session-conversation-manager.js`)
   - Replaces the original shared-state.js
   - Manages conversations for multiple sessions
   - Integrates with SessionManager for session control

4. **Updated Server API** (`server.js`)
   - New endpoints for multi-session management
   - Backward compatibility with existing single-session API

### Frontend Features

5. **Session Switcher Dropdown** (in header)
   - Shows all running sessions
   - Quick switching between sessions
   - Session count indicator
   - Actions: switch, stop sessions

6. **Enhanced Session Modal**
   - Create new sessions
   - Resume existing sessions
   - Session wizard for guided setup

## New API Endpoints

### Multi-Session Management
- `GET /api/goose/running-sessions` - Get all running sessions
- `POST /api/goose/switch-session` - Switch to a different session
- `POST /api/goose/start-new` - Start a new session with unique ID
- `POST /api/goose/stop-session` - Stop a specific session
- `POST /api/goose/send-message` - Send message to specific session
- `GET /api/goose/conversation/:sessionId` - Get conversation for specific session
- `DELETE /api/goose/conversation/:sessionId` - Clear conversation for specific session
- `GET /api/goose/session-manager-status` - Get session manager status

### Existing Endpoints (Enhanced)
All existing endpoints still work but now support the active session concept.

## Key Features

### 1. Concurrent Sessions
- Run multiple Goose sessions simultaneously
- Each session maintains its own:
  - Working directory
  - Extensions and builtins
  - Recipe configuration
  - Conversation history
  - Process state

### 2. Session Persistence
- Database storage for session metadata
- Conversation history per session
- Session context restoration
- Recipe configuration persistence

### 3. Seamless Switching
- Switch between sessions without losing context
- Background sessions continue running
- Real-time status updates
- Conversation history loads automatically

### 4. Enhanced UX
- Visual session indicator in header
- Dropdown shows all running sessions
- Session count badge
- Quick actions (switch, stop)
- Session creation wizard

## Usage

### Creating Sessions
1. Click the session dropdown in header
2. Click "+ New Session"
3. Follow the session wizard:
   - Choose session name
   - Select recipe (optional)
   - Set working directory
4. Session starts automatically

### Switching Sessions
1. Click session dropdown
2. Click on any running session
3. Conversation switches instantly
4. Previous session continues in background

### Managing Sessions
- Stop sessions using ⏹ button in dropdown
- View session status and details
- Create multiple sessions for different projects
- Resume sessions from previous runs

## Implementation Benefits

### For Users
- **Productivity**: Work on multiple projects simultaneously
- **Context Switching**: No setup overhead when switching
- **Persistence**: Sessions survive server restarts
- **Flexibility**: Different configurations per session

### For Developers
- **Scalability**: Unlimited concurrent sessions
- **Isolation**: Sessions don't interfere with each other
- **Maintainability**: Clean separation of concerns
- **Extensibility**: Easy to add new session features

## Database Schema

### Sessions Table
```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_name TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'inactive'
);
```

### Messages Table
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  session_id INTEGER,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT DEFAULT 'web-interface',
  message_id TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions (id)
);
```

### Session Metadata Table
```sql
CREATE TABLE session_metadata (
  id INTEGER PRIMARY KEY,
  session_id INTEGER,
  key TEXT NOT NULL,
  value TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions (id)
);
```

## Testing

1. Start the server: `npm start`
2. Open http://localhost:3000
3. Create multiple sessions using the wizard
4. Switch between them using the dropdown
5. Verify conversations are isolated
6. Test session persistence by restarting server

## Migration from Single Session

The implementation maintains full backward compatibility:
- Existing API endpoints work unchanged
- Single session behavior preserved
- Gradual migration possible
- No breaking changes

## Future Enhancements

1. **Session Groups**: Organize related sessions
2. **Session Templates**: Predefined session configurations
3. **Session Sharing**: Share sessions between users
4. **Session Analytics**: Usage statistics and insights
5. **Session Backup**: Export/import session data
6. **Session Scheduling**: Automatic session management

## Technical Notes

### Session Lifecycle
1. **Create**: Spawn subprocess, initialize database entry
2. **Active**: Process running, accepting messages
3. **Background**: Process running, not receiving input
4. **Stopped**: Process terminated, data preserved
5. **Deleted**: Process and data removed

### Process Management
- Each session runs as independent subprocess
- Automatic cleanup on exit
- Resource monitoring and limits
- Graceful shutdown handling

### Error Handling
- Session isolation prevents cascade failures
- Individual session recovery
- Comprehensive error logging
- User-friendly error messages

This implementation provides a robust foundation for multi-session Goose usage while maintaining the simplicity and reliability of the original system.
