# Wingman: Solvitur Ambulando 

He can be your wingman... anytime.

**A multi-session development platform for Goose AI agents with persistence, recipe management, and remote access.**

No longer do you have to sit at your desk typing on your keyboard like a caveman.

Wingman transforms Goose into a powerful, persistent development environment that you can access from anywhere. Use those wings my little gosling, fly free and explore.

Wingman provides a server architecture with session management, structured data persistence, and a recipe ecosystem to your installed Goose Cli. Marry it to Tailscale and you can leave Goose at home with your computer while you check in on your agents, setup new tasks, run workflows, or push along chats from your laptop, phone, or wherever you are.

If this is useful - send sats! pw21@walletofsatoshi.com

![Launch Meme Description](public/LaunchMeme.png "Launch Meme")

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

### 📱 CLI Interface
- Interactive command-line chat with Goose
- Comprehensive Goose session controls
- Color-coded messages and status indicators
- Support for all Goose slash commands
- `/show-thinking` command to view last thinking process

### 🌐 Web Interface
- Modern chat UI accessible at http://localhost:3000 (or next available port)
- Goose session management controls
- Real-time conversation updates
- Recipe support for custom agents and tasks
- MCP support and access via Goose Agent
- Mobile-responsive design
- **Deep Dive Terminal**: Web-based terminal access with configurable command

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
cd wingman
npm install
```

### Quick Start (First-time users)

For new users, Wingman has automatic setup:

```bash
# Start web interface (with auto-setup prompt)
npm run web

# Or start CLI (with silent auto-setup)
npm run cli

# Or run setup manually first
npm run setup
```

The setup creates configuration in `~/.wingman/` including:
- API key templates (`~/.wingman/.env`) 
- MCP server configurations
- AI agent recipes
- Scheduler configuration

📖 **For detailed setup instructions, see [NEW_USER_SETUP.md](NEW_USER_SETUP.md)**

## Configuration

### Environment Variables

**Note**: Modern Wingman uses `~/.wingman/.env` for configuration. The setup script will create this for you.

For legacy support, you can still use a local `.env` file:

```bash
# Server configuration
NODE_ENV=development
PORT=3000

# Root directory for file browser (customize for your system)
ROOT_WORKING_DIR=~/code
WINGMAN_CODE_PATH=~/code  # Modern way to set code path

# Terminal command for Deep Dive feature
# Default: "node wingman-cli.js" (relative to wingman path)
# If you have wingman aliased in your shell, you can use: "wingman"
TERMINALCMD="node wingman-cli.js"

# Maximum character limit for the message input field
INPUT_LENGTH=5000

# PIN for Deep Dive terminal access
PIN=1234
```

### Deep Dive Terminal Configuration

The Deep Dive feature provides a web-based terminal that automatically launches your Wingman CLI. Configure the command using the `TERMINALCMD` environment variable:

- **With alias**: If you have `wingman` aliased in your shell: `TERMINALCMD="wingman"`
- **Without alias**: Use the relative path: `TERMINALCMD="node wingman-cli.js"`
- **Custom command**: You can specify any command that launches your preferred terminal interface

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
2. Open web interface: http://localhost:3000 (check console for actual port if 3000 is in use)
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
