# Wingman RTB (Return to Base) MCP Server

## Overview

Wingman RTB is a Model Context Protocol (MCP) server that provides session completion tools for external data delivery. It enables recipes to save session data, send webhooks, and manage session lifecycle with security controls.

## Features

### 🔧 Tools Available

1. **`post_webhook`** - Send session data to webhooks with domain validation
2. **`save_to_file`** - Save session data to local filesystem 
3. **`stop_session`** - Stop the current wingman session

### 🔒 Security Features

- **Domain Whitelisting**: Only allow webhooks to whitelisted domains
- **Path Validation**: Prevent directory traversal attacks for file operations
- **Environment Configuration**: Secure configuration via environment variables
- **Audit Logging**: Security events are logged for compliance

## Installation

The Wingman RTB server is automatically installed as a built-in MCP server. No manual installation required.

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Required: Webhook domain whitelist (comma-separated patterns)
WINGMAN_RTB_WEBHOOK_WHITELIST=*.yourdomain.ai,localhost:*

# Optional: Additional security settings
WINGMAN_RTB_MAX_PAYLOAD_SIZE=10485760  # 10MB default
WINGMAN_RTB_TIMEOUT=30000              # 30s default
```

### Whitelist Pattern Examples

- `*.example.com` - Allow all subdomains of example.com
- `webhook.company.com` - Allow specific domain only
- `localhost:*` - Allow localhost with any port
- `192.168.1.100:3000` - Allow specific IP and port

## Usage in Recipes

### Basic Usage

Add these instructions to your recipe prompts:

```
"At the end of this task, use wingman-rtb tools to complete the session:
1. Save session results using save_to_file
2. Send completion notification using post_webhook to https://api.yourdomain.ai/completed
3. Stop the session using stop_session"
```

### Tool Examples

#### 1. POST Webhook

```json
{
  "tool": "post_webhook",
  "arguments": {
    "webhook_url": "https://api.yourdomain.ai/webhook/completed",
    "include_session_data": true,
    "include_conversation": false,
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

#### 2. Save to File

```json
{
  "tool": "save_to_file", 
  "arguments": {
    "filename": "session-results.json",
    "format": "json",
    "include_metadata": true,
    "include_conversation": true
  }
}
```

#### 3. Stop Session

```json
{
  "tool": "stop_session",
  "arguments": {
    "save_before_stop": true,
    "save_format": "md",
    "reason": "Task completed successfully"
  }
}
```

## Output Formats

### JSON Format
- Full structured data with all session information
- Machine-readable for API consumption
- Includes metadata, stats, and optional conversation history

### Text Format  
- Human-readable plain text summary
- Session details and statistics
- Conversation history if included

### Markdown Format
- Structured markdown with headers and sections
- Great for documentation and reports
- Easy to read and share

## File Storage

Files are saved to `temp/output/YYYY-MM-DD/` directory structure:

```
temp/output/
└── 2025-08-22/
    ├── wingman-session-12345678-2025-08-22T06-30-15.json
    ├── session-results.md
    └── completed-sessions/
        └── final-report.txt
```

## Webhook Payload Structure

```json
{
  "sessionId": "trigger_1234567890_abc123",
  "timestamp": "2025-08-22T06:30:15.123Z",
  "extractedBy": "wingman-rtb",
  "metadata": {
    "sessionName": "Code Review Session",
    "createdAt": "2025-08-22T06:25:10.000Z",
    "provider": "anthropic",
    "model": "claude-3-sonnet",
    "workingDirectory": "/path/to/project"
  },
  "stats": {
    "messageCount": 15,
    "sessionDuration": 305000,
    "toolUsage": {
      "read_file": 8,
      "write_file": 3
    },
    "errorRate": 0.0
  },
  "_webhook_meta": {
    "sent_by": "wingman-rtb",
    "version": "1.0.0",
    "timestamp": "2025-08-22T06:30:15.123Z",
    "session_id": "trigger_1234567890_abc123"
  }
}
```

## Security Considerations

### Domain Whitelisting

- **Required**: Set `WINGMAN_RTB_WEBHOOK_WHITELIST` environment variable
- **Fail-safe**: If not set, all webhooks are blocked
- **Patterns**: Support wildcards and port specifications
- **Logging**: All webhook attempts are logged with security status

### File Operations

- **Path Validation**: Prevents directory traversal attacks
- **Base Directory**: Files restricted to `temp/output/` directory
- **Filename Validation**: Only alphanumeric characters, dots, hyphens, underscores
- **Overwrite Protection**: Optional protection against accidental overwrites

### Error Handling

- **Graceful Failures**: Tools return detailed error information
- **Security Blocks**: Clear error messages for blocked operations
- **Audit Trail**: Security events logged for monitoring

## Testing

Run the test suite to verify installation:

```bash
node test-wingman-rtb.js
```

Test output:
```
🧪 Testing Wingman RTB MCP Server...
✅ Server created successfully
✅ Security config loaded  
✅ Tools loaded successfully
✅ All tests passed!
```

## Troubleshooting

### Common Issues

1. **"WINGMAN_RTB_WEBHOOK_WHITELIST not set"**
   - Add whitelist to `.env` file
   - Restart the application

2. **"Webhook URL blocked by security policy"**
   - Check if domain matches whitelist patterns
   - Verify pattern syntax (use `*` for wildcards)

3. **"No active session found"**
   - Tools require an active session to work
   - Only call from within running sessions

4. **"File path outside allowed directory"**
   - Files restricted to `temp/output/` directory
   - Check for path traversal attempts

### Debug Mode

Enable debug logging by setting:
```bash
NODE_ENV=development
```

## Integration Examples

### External System Integration

```bash
# 1. Trigger session via API
curl -X POST http://localhost:3256/api/triggers \
  -H "TRIGGER_TOKEN: your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "recipe_id": "abc123",
    "prompt": "Analyze code and use wingman-rtb to send results to https://api.company.com/webhook"
  }'

# 2. Session will automatically:
#    - Complete the analysis
#    - Save results to file
#    - Send webhook notification
#    - Stop the session
```

### Webhook Endpoint Implementation

```javascript
// Express.js webhook handler
app.post('/webhook/completed', (req, res) => {
  const { sessionId, metadata, stats } = req.body;
  
  console.log(`Session ${sessionId} completed:`);
  console.log(`- Duration: ${stats.sessionDuration}ms`);
  console.log(`- Messages: ${stats.messageCount}`);
  console.log(`- Tools used: ${Object.keys(stats.toolUsage).join(', ')}`);
  
  // Process the completion...
  
  res.json({ success: true });
});
```

## Version History

- **v1.0.0** - Initial release with core tools and security features

## Support

For issues and questions:
- Check the troubleshooting section above
- Review security configuration
- Verify environment variables are set correctly