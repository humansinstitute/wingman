require('dotenv').config();
const GooseWebServer = require('./server');
const GooseCLIInterface = require('./cli');

console.log('🚀 Starting Goose Multi-Interface App...\n');

// Start web server
const webServer = new GooseWebServer(process.env.PORT || 3000);
webServer.start();

// Wait a moment then start CLI
setTimeout(() => {
  console.log('\n📱 Starting Goose CLI interface...\n');
  
  // Start CLI interface
  new GooseCLIInterface();
}, 1000);