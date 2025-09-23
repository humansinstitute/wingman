require('dotenv').config();
const { GooseWebServer } = require('./server');

console.log('🚀 Starting Wingman Server...');

const webServer = new GooseWebServer(process.env.PORT || 3000);
webServer.start();

