# Wingman: Goose 

He can be your wingman... anytime.

**A sophisticated multi-session development platform for Goose AI agents with enterprise-grade persistence, recipe management, and real-time collaboration.**

No longer do you have to sit at your desk typing on your keyboard like a caveman. Wingman transforms Goose into a powerful, persistent development environment that you can access from anywhere. Use those wings my little gosling, fly free and explore.

Wingman provides a production-ready server architecture with advanced session management, structured data persistence, and a comprehensive recipe ecosystem. Marry it to Tailscale and you can leave Goose at home with your computer while you check in on your agents, setup new tasks, run workflows, or push along chats from your laptop, phone, or wherever you are.

![Launch Meme Description](public/LaunchMeme.png "Launch Meme")

## Features

### 🔄 Enterprise Session Management
- **Multi-Session Support**: Run multiple isolated Goose sessions simultaneously
- **Session Switching**: Seamlessly switch between active projects with independent contexts
- **Context Preservation**: Each session maintains isolated conversation history and working directories
- **Session Recovery**: Resume sessions after system restarts with full state restoration
- **Working Directory Isolation**: Each session operates in different project contexts
- **Real-time Synchronization**: Messages sync instantly between CLI and web interfaces

### 🗄️ Advanced Data Persistence
- **SQLite Database**: Production-ready persistence with proper schema design and migrations
- **Session Isolation**: Each conversation maintains separate history and metadata
- **Data Integrity**: FOREIGN KEY constraints, transaction safety, and automated backups
- **Backup Systems**: Automatic JSON fallback for maximum reliability
- **Usage Analytics**: Track recipe usage, session statistics, and performance metrics
- **Database Management**: Built-in migration system and data seeding capabilities

### 🧪 Recipe Ecosystem
- **Template Engine**: Dynamic parameter substitution in instructions and prompts
- **Recipe Validation**: Schema validation and security checking for imported recipes
- **Recipe Management**: Full CRUD operations with versioning and metadata support
- **Import/Export**: Share recipes via URLs, files, or direct integration
- **Usage Analytics**: Track popular recipes and identify optimization opportunities
- **Recipe Categories**: Organized workflow templates (Development, Debugging, Testing, Documentation, etc.)
- **Parameter System**: Type-safe parameter validation with custom validation rules

### 🔌 MCP Integration
- **Obsidian Integration**: Direct access to structured documentation via MCP-Obsidian
- **Documentation-Driven Development**: Recipes can access and update project documentation
- **Knowledge Management**: Seamless integration between planning and execution phases
- **Structured Workflows**: Connect documentation, planning, and implementation

### 🤖 Advanced Goose CLI Integration
- **Multiple Wrapper Implementations**: Streaming, improved, and Claude-specific wrappers
- **Automatic Failover**: Intelligent wrapper selection with fallback support
- **Real-time Streaming**: Live message streaming for immediate feedback
- **Extension Management**: Support for all Goose extensions and built-ins
- **Command Forwarding**: Direct access to all Goose slash commands

### 📱 Multi-Interface Access
- **CLI Interface**: Full-featured command-line interface with color-coded output
- **Web Interface**: Modern responsive UI accessible from any device
- **Real-time Sync**: Bi-directional synchronization across all interfaces
- **Mobile Support**: Touch-optimized interface for mobile devices
- **Session Status**: Live monitoring of session health and activity

### 🏗️ Production Architecture
- **Event-Driven Design**: WebSocket-based real-time communication
- **Modular Components**: Extensible architecture with clear separation of concerns
- **Error Recovery**: Graceful handling of failures with automatic recovery
- **Performance Optimization**: Intelligent caching and resource management
- **Git Worktree Integration**: Isolated development environments using Git worktrees

## Prerequisites

- Node.js (v14 or higher)
- Goose CLI installed and configured
- Goose CLI available in your PATH

## Installation

```bash
cd wingman
npm install
```

## Usage

### Quick Start
```bash
npm start                    # Start both web and CLI interfaces
```

### Advanced Setup

#### Database Management
```bash
npm run db:migrate          # Run database migrations
npm run db:seed            # Seed with sample data and built-in recipes
```

#### Development Workflows
```bash
npm run worktree:create <branch-name>  # Create isolated development environment
npm run worktree:switch <branch-name>  # Switch between development contexts
npm run menu                           # Interactive development menu
```

#### Monitoring & Debugging
```bash
npm run logs               # Real-time log monitoring
npm run raw-logs          # Raw Goose output analysis
npm run clearall          # Clear all session data
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

### Advanced Session Management
- **Multi-Session Dashboard**: Create and manage multiple concurrent Goose sessions
- **Session Switching**: Switch between active sessions with preserved context
- **Recipe-Based Sessions**: Start sessions with pre-configured recipes and parameters
- **Session Status Monitoring**: Real-time status indicators and health monitoring
- **Session Recovery**: Automatic reconnection and state restoration

### Recipe Management
- **Recipe Dashboard**: Browse, create, and manage custom workflow recipes
- **Parameter Forms**: Dynamic UI generation for recipe parameters
- **Recipe Import/Export**: Share recipes via URLs or file downloads
- **Usage Analytics**: Track recipe performance and popularity
- **Category Filtering**: Organize recipes by development workflow type

### Real-time Collaboration
- **Live Synchronization**: Instant message sync across all connected interfaces
- **Multi-Device Access**: Access sessions from desktop, tablet, or mobile
- **Connection Monitoring**: Automatic reconnection with offline support
- **Status Broadcasting**: Real-time session status updates for all clients

## 🏗️ Advanced Architecture

### Core Components
- **lib/database.js** - SQLite database manager with migrations and connection pooling
- **recipe-manager.js** - Comprehensive recipe ecosystem with validation and templating
- **shared-state.js** - Advanced conversation state management with multi-session support
- **goose-cli-wrapper-*.js** - Multiple wrapper implementations (streaming, improved, claude-specific)
- **server.js** - Express + Socket.IO server with comprehensive API and real-time capabilities
- **cli.js** - Full-featured command-line interface with session management
- **public/** - Modern web interface with recipe management and multi-session dashboard

### Modular Goose Wrapper System
- **Streaming Wrapper**: Real-time message streaming for immediate feedback and better UX
- **Claude Integration**: Specialized wrapper optimized for Claude models with enhanced parsing
- **Improved Wrapper**: Enhanced error handling and performance optimizations
- **Fallback System**: Automatic failover between wrapper implementations for reliability

### Git Worktree Integration
- **Branch Isolation**: Create isolated working environments using Git worktrees
- **Development Workflows**: Support for feature branch development with context switching
- **Context Management**: Switch between different development contexts seamlessly
- **Workspace Organization**: Organized project structure with separated concerns

### Event-Driven Real-time Architecture
- **WebSocket Communication**: Bi-directional real-time communication between all interfaces
- **State Synchronization**: Automatic sync of conversation state across CLI and web
- **Event Broadcasting**: System-wide notifications for session changes and status updates
- **Connection Management**: Robust connection handling with automatic reconnection

### Data Flow & Session Management

1. **Session Initialization**: Advanced session creation with recipe integration and parameter processing
2. **Multi-Process Management**: Isolated Goose CLI processes for each session with resource management  
3. **Message Pipeline**: Sophisticated message parsing, validation, and routing
4. **State Persistence**: Real-time database persistence with automatic fallback mechanisms
5. **Real-time Sync**: WebSocket-based synchronization across all connected interfaces
6. **Session Lifecycle**: Complete session management from creation to cleanup

## Goose CLI Commands Supported

The application supports all standard Goose CLI features:

- **Session Management**: Start, stop, resume sessions
- **Extensions**: Add stdio, remote, and built-in extensions
- **Mode Control**: Switch between auto, approve, chat modes
- **Planning**: Create structured plans with `/plan`
- **Tool Integration**: Full access to Goose's tool ecosystem

## Example Workflows

### Basic Development Session
1. Start the application: `npm start`
2. Open web interface: http://localhost:3000
3. Start a Goose session: `/goose-start my-project`
4. Send messages from either CLI or web interface
5. Use Goose commands: `/goose-cmd /plan implement user authentication`
6. Watch real-time synchronization between interfaces

### Recipe-Based Workflow
1. Browse recipes at http://localhost:3000/recipes
2. Select "React Web Development" recipe
3. Fill in parameters (project name, TypeScript preference, etc.)
4. Start session with recipe configuration
5. Goose automatically loads with specialized instructions and tools
6. Begin development with optimized context and workflows

### Multi-Session Development
1. Create multiple isolated sessions for different projects:
   - `/goose-start frontend-project`
   - `/goose-start backend-api`
   - `/goose-start documentation`
2. Switch between sessions via web dashboard or CLI commands
3. Each session maintains independent conversation history and context
4. Work on multiple projects simultaneously with full isolation

### Git Worktree Integration
1. Create feature branch environment: `npm run worktree:create feature-auth`
2. Switch to branch workspace: `npm run worktree:switch feature-auth`
3. Start Goose session in isolated environment
4. Develop feature with dedicated workspace and session
5. Merge and cleanup when complete

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

## ⚡ Performance & Scalability

### Intelligent Caching
- **Recipe Caching**: LRU cache for frequently used recipes and templates
- **Session State Management**: Efficient in-memory state with persistent backup
- **Database Optimization**: Indexed queries, connection pooling, and query optimization

### Resource Management  
- **Process Isolation**: Each Goose session runs in isolated process with resource limits
- **Memory Efficiency**: Streaming processing for large conversations and content
- **Error Recovery**: Graceful handling of Goose CLI failures with automatic restart

## 🔒 Security Features

### Recipe Security
- **Input Validation**: Comprehensive parameter validation and sanitization
- **Extension Whitelisting**: Controlled access to Goose extensions and built-ins
- **Import Security**: URL validation and content scanning for recipe imports
- **Template Safety**: Safe parameter substitution preventing injection attacks

### Session Isolation
- **Process Sandboxing**: Each session runs in isolated environment with controlled access
- **Data Segregation**: Session-specific conversation history and metadata
- **Access Control**: Controlled file system access per session and working directory
- **Connection Security**: WebSocket security with proper origin validation

## Development & Extensibility

The application is designed with enterprise-grade extensibility:

### Architecture Extensions
- **Custom Recipe Types**: Extend recipe system with specialized workflow types
- **Wrapper Plugins**: Add new Goose wrapper implementations for different models
- **Database Adapters**: Support for alternative databases (PostgreSQL, MySQL)
- **Authentication Systems**: Integration with enterprise authentication providers

### API Integration
- **REST API**: Comprehensive API for external integrations and automation
- **WebSocket Events**: Real-time event system for third-party monitoring
- **Webhook Support**: Notifications for external systems and CI/CD integration
- **MCP Extensions**: Additional MCP server integrations for enhanced workflows

### UI Customization
- **Theme System**: Customizable themes and branding for enterprise deployment
- **Dashboard Widgets**: Extensible dashboard with custom monitoring widgets
- **Recipe Templates**: Visual recipe editor with drag-and-drop workflow building
- **Mobile Apps**: Native mobile applications for iOS and Android