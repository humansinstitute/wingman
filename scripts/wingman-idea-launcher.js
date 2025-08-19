#!/usr/bin/env node

/**
 * Wingman Idea Launcher - Main Entry Point
 * Provides multiple ways to access the idea workflow system
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const WINGMAN_ROOT = '/Users/mini/code/wingman';
const RECIPE_PATH = `${WINGMAN_ROOT}/recipes/user/wingman-idea-workflow-recipe.md`;

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function banner() {
  log('\n🚀 Wingman Idea System', 'cyan');
  log('═══════════════════════', 'cyan');
  log('Transform ideas into development-ready projects\n', 'bright');
}

function showMenu() {
  log('Available workflow options:', 'bright');
  log('');
  log('1. 🤖 Goose Recipe (AI-Assisted Workflow)', 'green');
  log('   └─ Comprehensive guided experience with AI help');
  log('');
  log('2. 📋 Interactive Script (Node.js)', 'blue');
  log('   └─ Step-by-step workflow with manual control');
  log('');
  log('3. ⚡ Quick Setup (Direct Scripts)', 'yellow');
  log('   └─ Direct access to individual setup scripts');
  log('');
  log('4. 📚 Documentation & Help', 'magenta');
  log('   └─ View workflow documentation and examples');
  log('');
  log('5. 🔧 System Status', 'cyan');
  log('   └─ Check system requirements and configuration');
  log('');
  log('0. Exit', 'red');
  log('');
}

function checkSystemStatus() {
  log('\n🔧 System Status Check', 'cyan');
  log('─────────────────────', 'cyan');
  
  const checks = [
    {
      name: 'Wingman Root Directory',
      check: () => fs.existsSync(WINGMAN_ROOT),
      path: WINGMAN_ROOT
    },
    {
      name: 'Recipe File',
      check: () => fs.existsSync(RECIPE_PATH),
      path: RECIPE_PATH
    },
    {
      name: 'Product Setup Script',
      check: () => fs.existsSync(`${WINGMAN_ROOT}/scripts/product-setup.sh`),
      path: `${WINGMAN_ROOT}/scripts/product-setup.sh`
    },
    {
      name: 'Feature Worktree Script',
      check: () => fs.existsSync(`${WINGMAN_ROOT}/scripts/feature-worktree-create.sh`),
      path: `${WINGMAN_ROOT}/scripts/feature-worktree-create.sh`
    },
    {
      name: 'Node.js Interactive Script',
      check: () => fs.existsSync(`${WINGMAN_ROOT}/scripts/idea-workflow.js`),
      path: `${WINGMAN_ROOT}/scripts/idea-workflow.js`
    }
  ];
  
  let allGood = true;
  
  checks.forEach(check => {
    const status = check.check();
    const symbol = status ? '✅' : '❌';
    const color = status ? 'green' : 'red';
    log(`${symbol} ${check.name}`, color);
    if (!status) {
      log(`   Missing: ${check.path}`, 'red');
      allGood = false;
    }
  });
  
  log('');
  
  // Check for Goose
  try {
    execSync('which goose', { stdio: 'ignore' });
    log('✅ Goose CLI available', 'green');
  } catch {
    log('⚠️  Goose CLI not found (Recipe option unavailable)', 'yellow');
  }
  
  // Check for Git
  try {
    execSync('which git', { stdio: 'ignore' });
    log('✅ Git available', 'green');
  } catch {
    log('❌ Git not found (Required for workflow)', 'red');
    allGood = false;
  }
  
  log('');
  
  if (allGood) {
    log('🎉 System ready for idea workflows!', 'green');
  } else {
    log('⚠️  Some components are missing. Please check the setup.', 'yellow');
  }
}

function showDocumentation() {
  log('\n📚 Wingman Idea Workflow Documentation', 'magenta');
  log('─────────────────────────────────────', 'magenta');
  log('');
  
  const docs = [
    {
      title: 'Workflow Overview',
      content: 'Transforms ideas into development-ready projects through 6 phases:\n   1. Idea Capture\n   2. Classification & Planning\n   3. Environment Setup\n   4. Documentation Creation\n   5. Development Planning\n   6. Implementation Handoff'
    },
    {
      title: 'Project Types',
      content: 'Supports three types of ideas:\n   • New Product (standalone applications)\n   • Existing Product Feature (git worktree-based)\n   • Research/Exploration (prototype/investigation)'
    },
    {
      title: 'Key Files',
      content: `Recipe: ${RECIPE_PATH}\nScripts: ${WINGMAN_ROOT}/scripts/\nTemplates: Available in Obsidian vault`
    },
    {
      title: 'Quick Start',
      content: 'For new users, start with option 1 (Goose Recipe) for the best guided experience.'
    }
  ];
  
  docs.forEach(doc => {
    log(`\n📖 ${doc.title}`, 'bright');
    log(`   ${doc.content.replace(/\n/g, '\n   ')}`);
  });
  
  log('\n💡 For detailed documentation, check the recipe file and script comments.', 'cyan');
}

function quickSetup() {
  log('\n⚡ Quick Setup Options', 'yellow');
  log('─────────────────────', 'yellow');
  log('');
  
  log('1. Create New Product', 'bright');
  log(`   ${WINGMAN_ROOT}/scripts/product-setup.sh <name> <type>`);
  log('   Types: webapp, cli, service, library');
  log('');
  
  log('2. Create Feature Worktree', 'bright');
  log(`   ${WINGMAN_ROOT}/scripts/feature-worktree-create.sh <feature> [base-branch] [product]`);
  log('');
  
  log('3. Run Interactive Workflow', 'bright');
  log(`   node ${WINGMAN_ROOT}/scripts/idea-workflow.js`);
  log('');
  
  log('Examples:', 'cyan');
  log('  New webapp:    ./scripts/product-setup.sh my-app webapp');
  log('  New feature:   ./scripts/feature-worktree-create.sh auth-system main wingman');
  log('  Interactive:   node ./scripts/idea-workflow.js');
}

async function runGooseRecipe() {
  log('\n🤖 Starting Goose Recipe Workflow...', 'green');
  log('─────────────────────────────────────', 'green');
  
  try {
    // Check if Goose is available
    execSync('which goose', { stdio: 'ignore' });
    
    log('✨ Launching AI-assisted idea workflow...\n', 'cyan');
    
    // Execute Goose with the recipe
    execSync(`goose run "${RECIPE_PATH}"`, {
      stdio: 'inherit',
      cwd: WINGMAN_ROOT
    });
    
  } catch (error) {
    if (error.message.includes('command not found')) {
      log('❌ Goose CLI not found!', 'red');
      log('Please install Goose to use this option.', 'yellow');
      log('See: https://github.com/block/goose for installation instructions.\n', 'cyan');
    } else {
      log(`❌ Error running Goose recipe: ${error.message}`, 'red');
    }
  }
}

async function runInteractiveScript() {
  log('\n📋 Starting Interactive Workflow...', 'blue');
  log('──────────────────────────────────', 'blue');
  
  try {
    const scriptPath = `${WINGMAN_ROOT}/scripts/idea-workflow.js`;
    
    if (!fs.existsSync(scriptPath)) {
      log('❌ Interactive script not found!', 'red');
      log(`Expected: ${scriptPath}`, 'yellow');
      return;
    }
    
    log('🚀 Starting Node.js interactive workflow...\n', 'cyan');
    
    execSync(`node "${scriptPath}"`, {
      stdio: 'inherit',
      cwd: WINGMAN_ROOT
    });
    
  } catch (error) {
    log(`❌ Error running interactive script: ${error.message}`, 'red');
  }
}

async function getUserChoice() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Select an option (0-5): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  banner();
  
  while (true) {
    showMenu();
    const choice = await getUserChoice();
    
    switch (choice) {
      case '1':
        await runGooseRecipe();
        break;
        
      case '2':
        await runInteractiveScript();
        break;
        
      case '3':
        quickSetup();
        break;
        
      case '4':
        showDocumentation();
        break;
        
      case '5':
        checkSystemStatus();
        break;
        
      case '0':
        log('\n👋 Thanks for using Wingman! Happy coding! 🚀\n', 'green');
        process.exit(0);
        break;
        
      default:
        log('\n❌ Invalid option. Please try again.\n', 'red');
    }
    
    // Pause before showing menu again
    log('\nPress Enter to continue...', 'cyan');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    log(''); // Add spacing
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  log('\n\n👋 Goodbye! Thanks for using Wingman! 🚀\n', 'green');
  process.exit(0);
});

// Run the main function
if (require.main === module) {
  main().catch(error => {
    log(`\n❌ Unexpected error: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = { main, checkSystemStatus, showDocumentation };
