#!/usr/bin/env node
// Minimal CLI placeholder wired for restructure
// Keeps bin/wingman functional without legacy root deps

class GooseCLIInterface {
  constructor() {
    console.log('Wingman CLI has moved. For now, use the web UI.');
    console.log('- Start the server: npm run web');
    console.log('- Then open http://localhost:3000');
  }
}

module.exports = GooseCLIInterface;

if (require.main === module) {
  new GooseCLIInterface();
}
