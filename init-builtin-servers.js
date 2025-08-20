// Initialize built-in MCP servers in the registry
const mcpServerRegistry = require('./mcp-server-registry');

async function initializeBuiltInServers() {
  console.log('🔧 Initializing built-in MCP servers...');
  
  // Wait for registry to be properly initialized
  await mcpServerRegistry.initializeStorage();
  
  const builtInServers = [
    {
      name: 'mcpobsidian',
      description: 'MCP server for Obsidian vault integration - read, write, and search notes',
      type: 'stdio',
      cmd: 'uvx',
      args: ['mcp-obsidian'],
      timeout: 300,
      env_keys: ['OBSIDIAN_API_KEY'],
      tags: ['obsidian', 'notes', 'knowledge-management'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'filesread',
      description: 'Read-only filesystem access for file operations and code analysis',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/mini/code'],
      timeout: 300,
      env_keys: [],
      tags: ['filesystem', 'read-only', 'files'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'files_readonly',
      description: 'Alternative read-only filesystem server for secure file access',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@danielsuguimoto/readonly-server-filesystem', '/Users/mini/code'],
      timeout: 300,
      env_keys: [],
      tags: ['filesystem', 'read-only', 'security'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'gitmcp',
      description: 'Git operations and repository management via MCP',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', 'mcp-remote', 'https://gitmcp.io/docs'],
      timeout: 300,
      env_keys: [],
      tags: ['git', 'version-control', 'remote'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'context7',
      description: 'Access to up-to-date documentation and code examples for libraries',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@context7/mcp-server'],
      timeout: 300,
      env_keys: ['CONTEXT7_API_KEY'],
      tags: ['documentation', 'libraries', 'examples'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'brave-search',
      description: 'Web search capabilities using Brave Search API',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      timeout: 300,
      env_keys: ['BRAVE_API_KEY'],
      tags: ['search', 'web', 'research'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'postgres',
      description: 'PostgreSQL database operations and queries',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      timeout: 300,
      env_keys: ['POSTGRES_CONNECTION_STRING'],
      tags: ['database', 'sql', 'postgres'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'github',
      description: 'GitHub repository operations, issues, and pull requests',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      timeout: 300,
      env_keys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
      tags: ['github', 'repository', 'issues', 'pr'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'sqlite',
      description: 'SQLite database operations and queries',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
      timeout: 300,
      env_keys: [],
      tags: ['database', 'sql', 'sqlite'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    },
    {
      name: 'everart',
      description: 'AI image generation and visual content creation',
      type: 'stdio',
      cmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everart'],
      timeout: 300,
      env_keys: ['EVERART_API_KEY'],
      tags: ['image', 'ai', 'generation', 'visual'],
      category: 'built-in',
      version: '1.0.0',
      isBuiltIn: true,
      isPublic: true
    }
  ];

  let registered = 0;
  let errors = [];

  for (const serverConfig of builtInServers) {
    try {
      // Check if server already exists
      const existingServer = await mcpServerRegistry.findDuplicateServer(serverConfig);
      if (existingServer) {
        console.log(`📋 Built-in server "${serverConfig.name}" already exists, skipping...`);
        continue;
      }

      await mcpServerRegistry.registerServer(serverConfig);
      console.log(`✅ Registered built-in server: ${serverConfig.name}`);
      registered++;
    } catch (error) {
      console.error(`❌ Failed to register server ${serverConfig.name}:`, error.message);
      errors.push(`${serverConfig.name}: ${error.message}`);
    }
  }

  console.log(`\n🎉 Built-in server initialization complete!`);
  console.log(`   Registered: ${registered} servers`);
  if (errors.length > 0) {
    console.log(`   Errors: ${errors.length}`);
    errors.forEach(error => console.log(`   - ${error}`));
  }

  return { registered, errors };
}

// Run initialization if called directly
if (require.main === module) {
  initializeBuiltInServers()
    .then((result) => {
      console.log('\n🏁 Initialization finished!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Initialization failed:', error);
      process.exit(1);
    });
}

module.exports = { initializeBuiltInServers };