# Wingman Environment Configuration Guide

Wingman uses a dual `.env` file approach to separate application configuration from sensitive MCP server secrets.

## 📁 Two Types of Environment Files

### 1. Application Configuration: `.env` (Project Root)
**Purpose**: Configure the Wingman application itself  
**Location**: Copy from `.env.example` in the project root  
**Contains**:
- `PORT` - Web server port (default: 3000)
- `PIN` - Authentication PIN (default: 1234) 
- `DATABASE_PATH` - SQLite database location
- `ROOT_WORKING_DIR` - Default directory for file browser
- `INPUT_LENGTH` - Maximum message length
- `TERMINALCMD` - Command for Deep Dive terminal
- `PIN_TIMEOUT` - PIN authentication timeout
- `TRIGGER_TOKEN` - API authentication token

**Example**:
```bash
# Copy and customize
cp .env.example .env
```

### 2. MCP Server Secrets: `~/.wingman/.env`
**Purpose**: Store API keys and secrets for MCP servers  
**Location**: `~/.wingman/.env` (user's home directory)  
**Contains**:
- `TAVILY_API_KEY` - Tavily search API key
- `GITHUB_PERSONAL_ACCESS_TOKEN` - GitHub API token
- `BRAVE_API_KEY` - Brave search API key
- `CONTEXT7_API_KEY` - Context7 documentation API key
- `OBSIDIAN_API_KEY` - Obsidian vault API key
- `WINGMAN_RTB_WEBHOOK_WHITELIST` - RTB webhook security settings
- And other MCP server credentials

**Setup**:
```bash
# Initialize MCP secrets file
node scripts/secrets-cli.js init

# Or manually copy template
cp templates/mcp-servers/.env.example ~/.wingman/.env
```

## 🔐 Security Benefits

### Separation of Concerns
- **Application config** (`.env`): Non-sensitive settings in project
- **API secrets** (`~/.wingman/.env`): Sensitive keys in user directory

### Git Safety
- Project `.env` is gitignored but can be shared as `.env.example`
- User secrets in `~/.wingman/` never risk accidental commits
- Each developer manages their own API keys

### Permission Control
- `~/.wingman/.env` created with restricted permissions (600)
- User controls access to their personal API keys

## 🛠️ Managing Secrets

### Using the Secrets CLI
```bash
# List all secrets and their status
node scripts/secrets-cli.js list

# Set an API key (stores in Keychain + optionally .env)
node scripts/secrets-cli.js set TAVILY_API_KEY

# Check what secrets are available for servers
node scripts/secrets-cli.js check

# Initialize .env file from template
node scripts/secrets-cli.js init
```

### Manual Management
Edit `~/.wingman/.env` directly:
```bash
# Edit your MCP secrets
nano ~/.wingman/.env

# Set file permissions (done automatically)
chmod 600 ~/.wingman/.env
```

## 🔄 How It Works

1. **Server Startup**: `server.js` loads both `.env` files:
   - First: Project root `.env` (application config)
   - Then: `~/.wingman/.env` (MCP secrets)

2. **MCP Sessions**: `SecretInjector` provides secrets to MCP servers:
   - Checks `~/.wingman/.env` first
   - Falls back to macOS Keychain
   - Reports missing secrets clearly

3. **Priority Order**: If same variable exists in both files:
   - `~/.wingman/.env` takes precedence
   - Allows user override of default settings

## 📝 Migration from Legacy Setup

If you have existing secrets in your project root `.env`:

1. **Identify MCP secrets** (API keys, tokens)
2. **Move them to** `~/.wingman/.env`
3. **Keep application config** in project `.env`
4. **Use migration helpers**:
   ```bash
   # Migrate existing secrets to Keychain
   node scripts/secrets-cli.js migrate
   
   # Or manually move them to ~/.wingman/.env
   ```

## ⚠️ Important Notes

- **Never commit** API keys to git
- **Use templates** (`.env.example`) to document required variables
- **Set up both files** for full functionality
- **Keep backups** of your `~/.wingman/.env` file
- **Use Keychain** for maximum security (CLI supports both)

## 🔍 Troubleshooting

### Missing Secrets Error
```bash
# Check what's available
node scripts/secrets-cli.js list

# Validate all required secrets
node scripts/secrets-cli.js validate
```

### Server Won't Start
1. Check both `.env` files exist
2. Verify file permissions (600 for `~/.wingman/.env`)  
3. Check for syntax errors in environment files

### API Keys Not Working
1. Verify keys are in `~/.wingman/.env` not project root
2. Check key format and validity
3. Ensure no trailing spaces or quotes issues

---

This dual approach provides security, organization, and flexibility while maintaining backward compatibility with existing Wingman installations.