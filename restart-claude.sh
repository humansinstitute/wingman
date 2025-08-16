#!/bin/bash
echo "🔄 Restarting with fixed Claude wrapper..."

# Kill existing processes
pkill -f "node.*goose-intCLI" 2>/dev/null || true
sleep 1

# Start with Claude wrapper
export GOOSE_MODEL=claude
echo "🚀 Starting with GOOSE_MODEL=claude..."
npm start