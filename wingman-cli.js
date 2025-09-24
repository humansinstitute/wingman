#!/usr/bin/env node
const WingmanCLI = require('./src/cli');

if (require.main === module) {
  new WingmanCLI();
}

module.exports = WingmanCLI;
