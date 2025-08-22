# Wingman Triggers API Documentation

## Overview
The Triggers API allows external systems to programmatically trigger Goose sessions with specific recipes and prompts. Output handling and delivery is managed by the recipes themselves using their configured MCP tools and logic.

## Setup

### 1. Environment Configuration
Add the following to your `.env` file:
```env
TRIGGER_TOKEN=your_secure_trigger_token_here
```

### 2. Start the Server
```bash
npm start
# or
node server.js
```

## API Endpoints

### POST /api/triggers
Trigger a new Goose session with a recipe.

#### Headers
- `TRIGGER_TOKEN`: Your authentication token (required)
- `Content-Type`: application/json

#### Request Body
```json
{
  "recipe_id": "abc123",              // Required: Recipe ID (copy from Recipe Manager)
  "prompt": "Analyze the latest data", // Optional: Custom prompt (uses recipe default if not provided)
  "session_name": "My Analysis Task"   // Optional: Custom session name (defaults to recipe name + timestamp)
}
```

#### Response (Success)
```json
{
  "success": true,
  "session_id": "trigger_1234567890_abc123",
  "session_name": "Code Reviewer_triggered_2025-08-21T14:30:22.123Z",
  "recipe_name": "Code Reviewer",
  "message": "Recipe triggered successfully"
}
```

#### Response (Error)
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

#### Error Codes
- `INVALID_TOKEN`: Authentication failure (401)
- `RECIPE_NOT_FOUND`: Invalid recipe ID (404)
- `MISSING_PARAMETER`: Required parameter missing (400)
- `INTERNAL_ERROR`: Server error (500)

### GET /api/triggers/logs
Get trigger activity logs for monitoring and debugging.

#### Headers
- `TRIGGER_TOKEN`: Your authentication token (required)

#### Query Parameters
- `limit`: Number of log entries to return (default: 100)

#### Response
```json
{
  "success": true,
  "logs": [
    {
      "timestamp": "2025-08-21T14:30:22.123Z",
      "type": "trigger_success",
      "sessionId": "trigger_1234567890_abc123",
      "recipeId": "abc123",
      "recipeName": "Code Reviewer",
      "duration": 45
    }
  ],
  "count": 1
}
```

## Using the Recipe Manager

### Getting Recipe IDs
1. Open the Recipe Manager UI at http://localhost:3256/recipes
2. Each recipe card displays a truncated ID (e.g., "ID: abc12345...")
3. Click the "Copy ID" button to copy the full recipe ID to clipboard
4. Use this ID in your API calls

## Output Handling

Output handling is managed by the recipes themselves using their configured MCP tools and logic. This provides maximum flexibility for each recipe to handle outputs in the most appropriate way.

### Recipe Responsibility
- **File Output**: Recipes can use MCP tools to save files where needed
- **Webhook Delivery**: Recipes can call webhook endpoints using MCP tools
- **Custom Processing**: Recipes can implement any custom output logic
- **Notifications**: Recipes can send notifications, emails, or other alerts

## Example Usage

### Using cURL
```bash
# Basic trigger
curl -X POST http://localhost:3256/api/triggers \
  -H "Content-Type: application/json" \
  -H "TRIGGER_TOKEN: your_secure_trigger_token_here" \
  -d '{
    "recipe_id": "abc123def456",
    "prompt": "Analyze the sales data for Q3"
  }'

# With custom prompt and session name
curl -X POST http://localhost:3256/api/triggers \
  -H "Content-Type: application/json" \
  -H "TRIGGER_TOKEN: your_secure_trigger_token_here" \
  -d '{
    "recipe_id": "abc123def456",
    "prompt": "Generate weekly report for Q3 2025",
    "session_name": "Q3 2025 Weekly Report"
  }'
```

### Using Node.js
```javascript
const axios = require('axios');

async function triggerRecipe() {
  try {
    const response = await axios.post('http://localhost:3256/api/triggers', {
      recipe_id: 'abc123def456',
      prompt: 'Analyze the latest metrics'
    }, {
      headers: {
        'TRIGGER_TOKEN': 'your_secure_trigger_token_here',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Trigger successful:', response.data);
  } catch (error) {
    console.error('Trigger failed:', error.response?.data || error.message);
  }
}
```

### Using Python
```python
import requests

def trigger_recipe():
    url = 'http://localhost:3256/api/triggers'
    headers = {
        'TRIGGER_TOKEN': 'your_secure_trigger_token_here',
        'Content-Type': 'application/json'
    }
    payload = {
        'recipe_id': 'abc123def456',
        'prompt': 'Analyze the latest metrics'
    }
    
    response = requests.post(url, json=payload, headers=headers)
    
    if response.status_code == 200:
        print('Trigger successful:', response.json())
    else:
        print('Trigger failed:', response.json())
```

## Testing

Use the provided test script to verify the API:
```bash
node test-trigger-api.js
```

## Security Considerations

1. **Token Security**: Keep your `TRIGGER_TOKEN` secure and never commit it to version control
2. **HTTPS**: Use HTTPS in production to encrypt token transmission
3. **Rate Limiting**: Consider implementing rate limiting for production use
4. **Webhook Validation**: Validate webhook URLs before accepting them
5. **Access Control**: The trigger token provides full access to trigger any recipe

## Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Check that TRIGGER_TOKEN is set in .env
   - Verify the token in your request matches the configured token

2. **404 Recipe Not Found**
   - Ensure the recipe ID exists
   - Copy the exact ID from Recipe Manager

3. **Session Issues**
   - Check Recipe Manager UI to see if session was created
   - Look at server logs for session creation errors
   - Verify recipe extensions and dependencies are working

## Future Enhancements

- Multiple authentication tokens for different clients
- Rate limiting and throttling  
- Trigger scheduling capabilities
- Session priority queuing
- Real-time trigger status monitoring
- Batch trigger support