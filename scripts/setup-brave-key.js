#!/usr/bin/env node

/**
 * Simple Brave API Key Setup
 * 
 * Direct setup for the default recipe without complex async operations
 */

const { spawn } = require('child_process');

async function setupBraveKey() {
  console.log('🔑 Brave Search API Key Setup');
  console.log('=============================\n');
  
  // Check if key already exists
  console.log('Checking if Brave API key already exists...');
  const existingKey = await checkExistingKey();
  
  if (existingKey.exists) {
    console.log('✅ Brave API key is already configured!');
    console.log('   Key exists in keychain');
    
    // Test the recipe preflight
    await testRecipePreflight();
    return;
  }
  
  // Get API key from environment or prompt
  let apiKey = process.env.BRAVE_API_KEY;
  
  if (!apiKey) {
    console.log('❌ No Brave API key found');
    console.log('\nTo set up your Brave API key:');
    console.log('1. Get your API key from https://brave.com/search/api/');
    console.log('2. Run: BRAVE_API_KEY=your-key-here node scripts/setup-brave-key.js');
    console.log('3. Or set it manually:');
    console.log('   security add-generic-password -s "Wingman:brave-search:BRAVE_API_KEY" -a wingman -w "your-key" -U');
    return;
  }
  
  console.log('📝 Setting up Brave API key in keychain...');
  
  // Set the key
  const result = await setBraveKey(apiKey);
  
  if (result.success) {
    console.log('✅ Brave API key configured successfully!');
    
    // Verify it worked
    const verification = await checkExistingKey();
    if (verification.exists) {
      console.log('✅ Key verification passed');
      
      // Test the recipe
      await testRecipePreflight();
    } else {
      console.log('⚠️ Key was set but verification failed');
    }
  } else {
    console.log('❌ Failed to set Brave API key');
    console.log(`   Error: ${result.error}`);
    
    console.log('\n🔧 Manual setup:');
    console.log(`security add-generic-password -s "Wingman:brave-search:BRAVE_API_KEY" -a wingman -w "${apiKey}" -U`);
  }
}

async function checkExistingKey() {
  const result = await runSecurityCommand([
    'find-generic-password',
    '-s', 'Wingman:brave-search:BRAVE_API_KEY',
    '-a', 'wingman',
    '-w'
  ]);
  
  return {
    exists: result.success && result.output.trim().length > 0,
    value: result.success ? result.output.trim() : null
  };
}

async function setBraveKey(apiKey) {
  return await runSecurityCommand([
    'add-generic-password',
    '-s', 'Wingman:brave-search:BRAVE_API_KEY',
    '-a', 'wingman',
    '-w', apiKey,
    '-U' // Update if exists
  ]);
}

async function testRecipePreflight() {
  console.log('\n🧪 Testing recipe preflight...');
  
  try {
    // Simple HTTP request to test preflight
    const http = require('http');
    
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/recipes/17e8b84071aad068fd5a2ad2d3442d44/preflight',
      method: 'GET',
      timeout: 5000
    };
    
    const response = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            resolve({ error: 'Invalid JSON response' });
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.setTimeout(5000);
      req.end();
    });
    
    if (response.isReady) {
      console.log('✅ Recipe preflight PASSED! Your default recipe is ready to use.');
    } else {
      console.log('⚠️ Recipe preflight shows issues:');
      console.log(`   ${response.summary || 'Unknown issue'}`);
      if (response.missingSecrets && response.missingSecrets.length > 0) {
        response.missingSecrets.forEach(secret => {
          console.log(`   - Missing: ${secret.key} for ${secret.server}`);
        });
      }
    }
  } catch (error) {
    console.log('⚠️ Could not test preflight (server may not be running)');
    console.log('   Start the server and test manually: http://localhost:3001/recipes');
  }
}

function runSecurityCommand(args) {
  return new Promise((resolve) => {
    let output = '';
    let error = '';
    
    const proc = spawn('security', args, { timeout: 5000 });
    
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, error: 'Operation timed out', output: '' });
    }, 5000);
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        success: code === 0,
        output: output,
        error: error || (code !== 0 ? `Command failed with exit code ${code}` : ''),
        code: code
      });
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: err.message,
        output: ''
      });
    });
  });
}

// Run setup
if (require.main === module) {
  setupBraveKey()
    .then(() => {
      console.log('\n🎉 Setup complete!');
      console.log('\n🚀 Next steps:');
      console.log('1. Start Wingman: npm run web');
      console.log('2. Go to http://localhost:3001/recipes');
      console.log('3. Try your "Chat + Search (Default)" recipe!');
    })
    .catch((error) => {
      console.error('Setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = { setupBraveKey };