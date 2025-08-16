# Goose Multi-Interface Chat Application

A sophisticated multi-interface chat application that integrates with Goose CLI for AI agent conversations, providing both command-line and web interfaces with real-time synchronization.

## Features

### 🔄 Real-time Synchronization
- Messages sync instantly between CLI and web interfaces
- Shared conversation state across all interfaces
- Live Goose session status updates

### 🤖 Goose CLI Integration
- Start, stop, and resume Goose sessions
- Send messages and commands to Goose
- Support for Goose extensions and built-ins
- Session management and listing

### 💭 Collapsible Thinking Blocks
- **Web Interface**: Click to expand/collapse thinking process
- **CLI Interface**: Shows collapsed indicator, use `/show-thinking` to view
- Separate thinking from main responses for cleaner chat history
- Tool usage also displayed in collapsible blocks

### 📱 CLI Interface
- Interactive command-line chat with Goose
- Comprehensive Goose session controls
- Color-coded messages and status indicators
- Support for all Goose slash commands
- `/show-thinking` command to view last thinking process

### 🌐 Web Interface
- Modern chat UI accessible at http://localhost:3000
- Goose session management controls
- Real-time conversation updates
- Mobile-responsive design
- Collapsible thinking and tool blocks with visual indicators

### 💾 Persistence
- Conversation history automatically saved
- Session state preserved across restarts
- Goose session tracking and resumption

## Prerequisites

- Node.js (v14 or higher)
- Goose CLI installed and configured
- Goose CLI available in your PATH

## Installation

```bash
cd goose-intCLI
npm install
```

## Usage

### Start Both Interfaces Together
```bash
npm start
```

### Start Interfaces Separately
```bash
# Terminal 1 - Web server
npm run web

# Terminal 2 - CLI
npm run cli
```

## CLI Commands

### General Commands
- `/help` - Show available commands
- `/clear` - Clear conversation history  
- `/exit` - Exit the CLI

### Goose Session Commands
- `/goose-start [name]` - Start new Goose session
- `/goose-stop` - Stop current Goose session
- `/goose-resume <name>` - Resume existing Goose session
- `/goose-sessions` - List all Goose sessions
- `/goose-status` - Show Goose session status
- `/goose-cmd <command>` - Send slash command to Goose

### Example Goose Commands
```bash
/goose-cmd /help              # Show Goose help
/goose-cmd /mode chat         # Set Goose to chat mode
/goose-cmd /builtin developer # Add developer extension
/goose-cmd /plan <message>    # Create a plan in Goose
```

## Web Interface Features

### Session Management
- **Start Session**: Create new Goose session with optional name
- **Stop Session**: Terminate current Goose session
- **List Sessions**: View all available Goose sessions

### Goose Commands
- Send Goose slash commands directly from web interface
- Support for all Goose CLI commands like `/mode`, `/plan`, `/builtin`

### Real-time Status
- Live Goose session status indicator
- Connection status monitoring
- Synchronized conversation state

## Architecture

### Core Components
- **goose-cli-wrapper.js** - Spawns and controls Goose CLI processes
- **shared-state.js** - Manages conversation state and Goose integration
- **cli.js** - Command-line interface with Goose controls
- **server.js** - Express + Socket.IO web server with Goose API
- **index.js** - Main launcher for both interfaces
- **public/index.html** - Web interface with Goose controls

### How It Works

1. **Goose Integration**: Spawns Goose CLI as child process
2. **Message Parsing**: Captures and parses Goose output
3. **State Management**: Shared conversation state across interfaces
4. **Real-time Sync**: WebSocket-based synchronization
5. **Session Control**: Full Goose session lifecycle management

## Goose CLI Commands Supported

The application supports all standard Goose CLI features:

- **Session Management**: Start, stop, resume sessions
- **Extensions**: Add stdio, remote, and built-in extensions
- **Mode Control**: Switch between auto, approve, chat modes
- **Planning**: Create structured plans with `/plan`
- **Tool Integration**: Full access to Goose's tool ecosystem

## Example Workflow

1. Start the application: `npm start`
2. Open web interface: http://localhost:3000
3. Start a Goose session: `/goose-start my-project`
4. Send messages from either CLI or web interface
5. Use Goose commands: `/goose-cmd /plan implement user authentication`
6. Watch real-time synchronization between interfaces

## Troubleshooting

### Goose Not Found
Ensure Goose CLI is installed and available in your PATH:
```bash
goose --version
```

### Session Not Starting
Check if Goose is properly configured:
```bash
goose configure
```

### Port Already in Use
Change the port in server.js or kill existing processes:
```bash
pkill -f "node.*goose-intCLI"
```

## Development

The application is designed to be extensible and can be enhanced with:
- Custom Goose extension integration
- Additional UI components
- Enhanced message parsing
- Session templates and automation
- Integration with other AI tools