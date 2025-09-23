#!/usr/bin/env node

/**
 * Wingman Secrets Management CLI
 * 
 * Command-line interface for managing API keys and secrets
 * Supports both .env files and macOS Keychain
 */

const path = require('path');
const os = require('os');

class SecretsManager {
  constructor() {
    this.keychainService = require('../secrets/keychain-service');
    this.envFileLoader = require('../secrets/env-file-loader');
    this.serverConfigManager = require('../src/server/managers/server-config-manager');
  }

  async run(command, args = []) {
    try {
      switch (command) {
        case 'list':
          await this.listSecrets();
          break;
        case 'set':
          await this.setSecret(args[0], args[1], args[2]);
          break;
        case 'get':
          await this.getSecret(args[0], args[1]);
          break;
        case 'delete':
          await this.deleteSecret(args[0], args[1]);
          break;
        case 'check':
          await this.checkSecrets(args[0]);
          break;
        case 'init':
          await this.initializeEnvFile();
          break;
        case 'migrate':
          await this.migrateToKeychain();
          break;
        case 'validate':
          await this.validateAllSecrets();
          break;
        default:
          this.showHelp();
          break;
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  }

  async listSecrets() {
    console.log('🔐 Wingman Secrets Inventory');
    console.log('============================\\n');

    // Load .env file
    await this.envFileLoader.load();

    // Get all server configs to know what secrets are expected
    await this.serverConfigManager.initialize();
    const allServers = this.serverConfigManager.getAllServers();

    // Collect all unique secret keys
    const allKeys = new Set();
    const serverKeyMap = new Map(); // key -> [server1, server2, ...]

    for (const [serverId, server] of Object.entries(allServers)) {
      if (!server.env_keys) continue;

      for (const key of server.env_keys) {
        allKeys.add(key);
        
        if (!serverKeyMap.has(key)) {
          serverKeyMap.set(key, []);
        }
        serverKeyMap.get(key).push(server.name);
      }
    }

    if (allKeys.size === 0) {
      console.log('ℹ️ No secrets are required by current server configurations.');
      return;
    }

    // Check status of each secret
    const secretStatus = [];

    for (const key of allKeys) {
      const status = {
        key,
        servers: serverKeyMap.get(key),
        envFile: false,
        keychain: false,
        available: false
      };

      // Check .env file
      if (this.envFileLoader.has(key) && this.envFileLoader.get(key)) {
        status.envFile = true;
        status.available = true;
      }

      // Check keychain (check all servers that use this key)
      for (const serverName of status.servers) {
        try {
          const result = await this.keychainService.readSecret({ server: serverName, key });
          if (result.exists && result.value) {
            status.keychain = true;
            status.available = true;
            break; // Found in keychain for at least one server
          }
        } catch (error) {
          // Keychain read failed, continue
        }
      }

      secretStatus.push(status);
    }

    // Display results
    console.log('Secret Status:');
    console.log('==============\\n');

    for (const status of secretStatus) {
      const envIcon = status.envFile ? '✅' : '❌';
      const keychainIcon = status.keychain ? '✅' : '❌';
      const overallIcon = status.available ? '🟢' : '🔴';

      console.log(`${overallIcon} ${status.key}`);
      console.log(`   .env file:  ${envIcon}`);
      console.log(`   Keychain:   ${keychainIcon}`);
      console.log(`   Used by:    ${status.servers.join(', ')}`);
      console.log('');
    }

    // Summary
    const available = secretStatus.filter(s => s.available).length;
    const total = secretStatus.length;

    console.log(`\\n📊 Summary: ${available}/${total} secrets available`);

    if (available < total) {
      console.log('\\n💡 To add missing secrets:');
      console.log(`   wingman secrets set <KEY> <value>     # Store in keychain`);
      console.log(`   echo 'KEY=value' >> ~/.wingman/.env   # Store in .env file`);
    }
  }

  async setSecret(key, value, serverName = null) {
    if (!key) {
      throw new Error('Secret key is required. Usage: wingman secrets set <KEY> <value> [server]');
    }

    if (!value) {
      // Prompt for value securely
      value = await this.promptSecret(`Enter value for ${key}: `);
    }

    if (!value) {
      throw new Error('Secret value cannot be empty');
    }

    // If no server specified, try to auto-detect from config
    if (!serverName) {
      await this.serverConfigManager.initialize();
      const allServers = this.serverConfigManager.getAllServers();
      
      // Find servers that use this key
      const serversUsingKey = [];
      for (const [serverId, server] of Object.entries(allServers)) {
        if (server.env_keys && server.env_keys.includes(key)) {
          serversUsingKey.push(server.name);
        }
      }

      if (serversUsingKey.length === 1) {
        serverName = serversUsingKey[0];
      } else if (serversUsingKey.length > 1) {
        console.log(`\\n🤔 Multiple servers use ${key}:`);
        serversUsingKey.forEach((name, i) => console.log(`   ${i + 1}. ${name}`));
        
        const choice = await this.prompt('Choose server (number) or press Enter for first: ');
        const index = parseInt(choice) - 1;
        
        if (index >= 0 && index < serversUsingKey.length) {
          serverName = serversUsingKey[index];
        } else {
          serverName = serversUsingKey[0];
        }
      } else {
        // No servers use this key yet, use generic name
        serverName = 'wingman';
      }
    }

    try {
      // Store in keychain
      await this.keychainService.writeSecret({ server: serverName, key }, value);
      console.log(`✅ Secret ${key} stored in keychain for ${serverName}`);

      // Also offer to add to .env file
      const addToEnv = await this.prompt('Also add to .env file? (y/N): ');
      if (addToEnv.toLowerCase() === 'y' || addToEnv.toLowerCase() === 'yes') {
        await this.addToEnvFile(key, value);
      }
    } catch (error) {
      throw new Error(`Failed to store secret: ${error.message}`);
    }
  }

  async getSecret(key, serverName = null) {
    if (!key) {
      throw new Error('Secret key is required. Usage: wingman secrets get <KEY> [server]');
    }

    console.log(`🔍 Looking up secret: ${key}`);

    // Check .env file first
    await this.envFileLoader.load();
    if (this.envFileLoader.has(key)) {
      const value = this.envFileLoader.get(key);
      if (value) {
        console.log(`✅ Found in .env file: ${this.maskSecret(value)}`);
        return;
      }
    }

    // Check keychain
    if (!serverName) {
      // Try to find server name from config
      await this.serverConfigManager.initialize();
      const allServers = this.serverConfigManager.getAllServers();
      
      for (const [serverId, server] of Object.entries(allServers)) {
        if (server.env_keys && server.env_keys.includes(key)) {
          try {
            const result = await this.keychainService.readSecret({ server: server.name, key });
            if (result.exists && result.value) {
              console.log(`✅ Found in keychain (${server.name}): ${this.maskSecret(result.value)}`);
              return;
            }
          } catch (error) {
            // Continue searching
          }
        }
      }
    } else {
      // Check specific server
      try {
        const result = await this.keychainService.readSecret({ server: serverName, key });
        if (result.exists && result.value) {
          console.log(`✅ Found in keychain (${serverName}): ${this.maskSecret(result.value)}`);
          return;
        }
      } catch (error) {
        // Fall through to not found
      }
    }

    console.log(`❌ Secret ${key} not found`);
  }

  async deleteSecret(key, serverName = null) {
    if (!key) {
      throw new Error('Secret key is required. Usage: wingman secrets delete <KEY> [server]');
    }

    console.log(`🗑️ Deleting secret: ${key}`);

    let deletedFrom = [];

    // Delete from keychain
    if (serverName) {
      try {
        await this.keychainService.deleteSecret({ server: serverName, key });
        deletedFrom.push(`keychain (${serverName})`);
      } catch (error) {
        console.warn(`⚠️ Could not delete from keychain: ${error.message}`);
      }
    } else {
      // Delete from all servers
      await this.serverConfigManager.initialize();
      const allServers = this.serverConfigManager.getAllServers();
      
      for (const [serverId, server] of Object.entries(allServers)) {
        if (server.env_keys && server.env_keys.includes(key)) {
          try {
            await this.keychainService.deleteSecret({ server: server.name, key });
            deletedFrom.push(`keychain (${server.name})`);
          } catch (error) {
            // Secret might not exist for this server
          }
        }
      }
    }

    // Note about .env file (don't auto-delete from .env for safety)
    console.log(`\\n⚠️ Note: Secret may still exist in ~/.wingman/.env`);
    console.log('   Edit the file manually to remove it if needed.');

    if (deletedFrom.length > 0) {
      console.log(`✅ Deleted from: ${deletedFrom.join(', ')}`);
    } else {
      console.log('ℹ️ No secrets were deleted (they may not have existed)');
    }
  }

  async checkSecrets(serverId = null) {
    console.log('🔍 Checking secret availability...');

    await this.serverConfigManager.initialize();
    await this.envFileLoader.load();

    if (serverId) {
      // Check specific server
      const server = this.serverConfigManager.getServer(serverId);
      if (!server) {
        throw new Error(`Server ${serverId} not found`);
      }

      const result = await this.serverConfigManager.checkRequiredSecrets(serverId);
      
      console.log(`\\n📋 Server: ${server.name} (${serverId})`);
      console.log(`✅ Available: ${result.available.length}`);
      console.log(`❌ Missing: ${result.missing.length}`);

      if (result.available.length > 0) {
        console.log('\\nAvailable secrets:');
        result.available.forEach(item => {
          console.log(`   - ${item.key} (${item.source})`);
        });
      }

      if (result.missing.length > 0) {
        console.log('\\nMissing secrets:');
        result.missing.forEach(key => {
          console.log(`   - ${key}`);
        });
      }
    } else {
      // Check all servers
      const allServers = this.serverConfigManager.getAllServers();
      let totalAvailable = 0;
      let totalMissing = 0;

      console.log('\\n📊 Secret Status by Server:');
      console.log('============================\\n');

      for (const [serverId, server] of Object.entries(allServers)) {
        if (!server.env_keys || server.env_keys.length === 0) {
          console.log(`${server.name}: No secrets required`);
          continue;
        }

        const result = await this.serverConfigManager.checkRequiredSecrets(serverId);
        totalAvailable += result.available.length;
        totalMissing += result.missing.length;

        const icon = result.missing.length === 0 ? '✅' : '⚠️';
        console.log(`${icon} ${server.name}: ${result.available.length}/${server.env_keys.length} secrets available`);
        
        if (result.missing.length > 0) {
          console.log(`   Missing: ${result.missing.join(', ')}`);
        }
      }

      console.log(`\\n📈 Overall: ${totalAvailable} available, ${totalMissing} missing`);
    }
  }

  async initializeEnvFile() {
    console.log('🚀 Initializing .env file...');
    
    await this.envFileLoader.initializeFromTemplate();
    
    console.log('\\n✅ .env file initialized!');
    console.log(`📁 Location: ${this.envFileLoader.envPath}`);
    console.log('📝 Edit the file to add your API keys');
  }

  async migrateToKeychain() {
    console.log('🔄 Migrating secrets from .env to Keychain...');

    await this.envFileLoader.load();
    
    if (!this.envFileLoader.loaded) {
      console.log('ℹ️ No .env file found, nothing to migrate');
      return;
    }

    const envVars = this.envFileLoader.getAll();
    const migrated = [];

    for (const [key, value] of Object.entries(envVars)) {
      if (!value || value.trim() === '') continue;

      // Find which servers use this key
      await this.serverConfigManager.initialize();
      const allServers = this.serverConfigManager.getAllServers();
      
      let serverName = null;
      for (const [serverId, server] of Object.entries(allServers)) {
        if (server.env_keys && server.env_keys.includes(key)) {
          serverName = server.name;
          break;
        }
      }

      if (!serverName) {
        serverName = 'wingman'; // Default server name
      }

      try {
        await this.keychainService.writeSecret({ server: serverName, key }, value);
        migrated.push({ key, server: serverName });
        console.log(`✅ Migrated ${key} to keychain (${serverName})`);
      } catch (error) {
        console.warn(`⚠️ Failed to migrate ${key}: ${error.message}`);
      }
    }

    if (migrated.length > 0) {
      console.log(`\\n✅ Successfully migrated ${migrated.length} secrets to keychain`);
      console.log('\\n⚠️ Your .env file still contains the secrets.');
      console.log('   Consider removing them after verifying the migration worked.');
    } else {
      console.log('ℹ️ No secrets were migrated');
    }
  }

  async validateAllSecrets() {
    console.log('🔍 Validating all secrets...');

    await this.serverConfigManager.initialize();
    await this.envFileLoader.load();

    const allServers = this.serverConfigManager.getAllServers();
    const results = [];

    for (const [serverId, server] of Object.entries(allServers)) {
      if (!server.env_keys || server.env_keys.length === 0) continue;

      const validation = await this.serverConfigManager.checkRequiredSecrets(serverId);
      results.push({
        serverId,
        serverName: server.name,
        required: server.env_keys.length,
        available: validation.available.length,
        missing: validation.missing,
        isValid: validation.missing.length === 0
      });
    }

    // Display results
    console.log('\\n📊 Secret Validation Results:');
    console.log('===============================\\n');

    let allValid = true;
    for (const result of results) {
      const icon = result.isValid ? '✅' : '❌';
      console.log(`${icon} ${result.serverName}`);
      console.log(`   Required: ${result.required}, Available: ${result.available}`);
      
      if (!result.isValid) {
        allValid = false;
        console.log(`   Missing: ${result.missing.join(', ')}`);
      }
      console.log('');
    }

    if (allValid) {
      console.log('🎉 All secrets are properly configured!');
    } else {
      console.log('⚠️ Some secrets are missing. Run "wingman secrets list" for details.');
    }
  }

  async addToEnvFile(key, value) {
    const fs = require('fs').promises;
    const envPath = this.envFileLoader.envPath;

    try {
      // Check if key already exists in .env
      await this.envFileLoader.load();
      if (this.envFileLoader.has(key)) {
        console.log(`ℹ️ ${key} already exists in .env file`);
        return;
      }

      // Append to .env file
      const entry = `\\n# Added by secrets CLI on ${new Date().toISOString()}\\n${key}=${value}\\n`;
      await fs.appendFile(envPath, entry, { mode: 0o600 });
      
      console.log(`✅ Added ${key} to .env file`);
    } catch (error) {
      console.warn(`⚠️ Could not add to .env file: ${error.message}`);
    }
  }

  maskSecret(value) {
    if (!value || value.length < 8) {
      return '***';
    }
    
    const start = value.substring(0, 4);
    const end = value.substring(value.length - 4);
    const middle = '*'.repeat(Math.min(value.length - 8, 8));
    
    return `${start}${middle}${end}`;
  }

  async prompt(question) {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise(resolve => {
      readline.question(question, answer => {
        readline.close();
        resolve(answer.trim());
      });
    });
  }

  async promptSecret(question) {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise(resolve => {
      // Hide input for secret prompts
      readline.stdoutMuted = true;
      readline.question(question, answer => {
        readline.stdoutMuted = false;
        readline.close();
        console.log(''); // New line after hidden input
        resolve(answer.trim());
      });
      
      readline._writeToOutput = function _writeToOutput(stringToWrite) {
        if (readline.stdoutMuted) {
          readline.output.write('*');
        } else {
          readline.output.write(stringToWrite);
        }
      };
    });
  }

  showHelp() {
    console.log(`Wingman Secrets Management CLI

Usage: wingman secrets <command> [args]

Commands:
  list                     List all secrets and their status
  set <key> [value] [server]   Set a secret (prompts for value if not provided)
  get <key> [server]       Get a secret value (masked)
  delete <key> [server]    Delete a secret
  check [server-id]        Check secret availability for server(s)
  init                     Initialize .env file from template
  migrate                  Migrate secrets from .env to Keychain
  validate                 Validate all required secrets are available

Examples:
  wingman secrets list
  wingman secrets set TAVILY_API_KEY
  wingman secrets set GITHUB_PERSONAL_ACCESS_TOKEN ghp_abc123
  wingman secrets get TAVILY_API_KEY
  wingman secrets check tavily-search-123
  wingman secrets delete BRAVE_API_KEY

Storage Options:
  - macOS Keychain: Secure, encrypted storage (recommended)
  - .env file: Plain text file at ~/.wingman/.env (convenient)

Both storage methods are supported and checked automatically.
`);
  }
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    const manager = new SecretsManager();
    manager.showHelp();
    return;
  }
  
  const command = args[0];
  const commandArgs = args.slice(1);
  
  const manager = new SecretsManager();
  await manager.run(command, commandArgs);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ CLI error:', error.message);
    process.exit(1);
  });
}

module.exports = SecretsManager;
