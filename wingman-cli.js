#!/usr/bin/env node
const GooseCLIInterface = require('./src/cli/index');

if (require.main === module) {
  new GooseCLIInterface();
}

module.exports = GooseCLIInterface;

// Color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bright: '\x1b[1m'
};

// Configuration
const SESSIONS_PER_PAGE = 9;
let currentPage = 0;
const WINGMAN_CONFIG_PATH = path.join(os.homedir(), '.wingman-config.json');

// Project context detection
let projectContext = {
  name: null,
  type: null,
  hasPackageJson: false,
  hasWorktrees: false,
  hasMenuScript: false,
  devCommand: null,
  testCommand: null
};

// Tmux status bar color themes
const statusThemes = [
  {
    name: 'blue',
    bg: '#1e3a8a',    // blue-800
    fg: '#ffffff',
    accent: '#60a5fa'  // blue-400
  },
  {
    name: 'green',
    bg: '#166534',    // green-800
    fg: '#ffffff',
    accent: '#4ade80'  // green-400
  },
  {
    name: 'purple',
    bg: '#7c3aed',    // violet-600
    fg: '#ffffff',
    accent: '#a78bfa'  // violet-400
  },
  {
    name: 'orange',
    bg: '#ea580c',    // orange-600
    fg: '#ffffff',
    accent: '#fb923c'  // orange-400
  },
  {
    name: 'red',
    bg: '#dc2626',    // red-600
    fg: '#ffffff',
    accent: '#f87171'  // red-400
  },
  {
    name: 'teal',
    bg: '#0f766e',    // teal-700
    fg: '#ffffff',
    accent: '#5eead4'  // teal-300
  },
  {
    name: 'pink',
    bg: '#be185d',    // pink-700
    fg: '#ffffff',
    accent: '#f472b6'  // pink-400
  },
  {
    name: 'indigo',
    bg: '#4338ca',    // indigo-600
    fg: '#ffffff',
    accent: '#818cf8'  // indigo-400
  },
  {
    name: 'cyan',
    bg: '#0891b2',    // cyan-600
    fg: '#ffffff',
    accent: '#67e8f9'  // cyan-300
  }
];

// Create readline interface
let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Configuration management
function getDefaultConfig() {
  return {
    firstRun: true,
    projectFolders: [],
    preferences: {
      defaultLayout: 'single',
      autoMenu: true,
      reconnectToRecent: true
    },
    lastSession: null
  };
}

function loadWingmanConfig() {
  try {
    if (fs.existsSync(WINGMAN_CONFIG_PATH)) {
      const configData = fs.readFileSync(WINGMAN_CONFIG_PATH, 'utf8');
      const config = JSON.parse(configData);
      
      // Merge with defaults to ensure all properties exist
      return { ...getDefaultConfig(), ...config };
    }
  } catch (error) {
    console.log(`${colors.yellow}Warning: Could not load config file: ${error.message}${colors.reset}`);
  }
  
  return getDefaultConfig();
}

function saveWingmanConfig(config) {
  try {
    const configData = JSON.stringify(config, null, 2);
    fs.writeFileSync(WINGMAN_CONFIG_PATH, configData, 'utf8');
    return true;
  } catch (error) {
    console.log(`${colors.red}Error: Could not save config file: ${error.message}${colors.reset}`);
    return false;
  }
}

function isFirstRun() {
  const config = loadWingmanConfig();
  return config.firstRun;
}

function markFirstRunComplete() {
  const config = loadWingmanConfig();
  config.firstRun = false;
  return saveWingmanConfig(config);
}

// Hash function to consistently assign colors based on session name
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Detect project context
async function detectProjectContext() {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // Check for package.json
    if (fs.existsSync('package.json')) {
      projectContext.hasPackageJson = true;
      try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        projectContext.name = packageJson.name || path.basename(process.cwd());
        projectContext.type = 'nodejs';
        
        // Detect common scripts
        if (packageJson.scripts) {
          if (packageJson.scripts.dev) projectContext.devCommand = 'dev';
          else if (packageJson.scripts.start) projectContext.devCommand = 'start';
          else if (packageJson.scripts.serve) projectContext.devCommand = 'serve';
          
          if (packageJson.scripts.test) projectContext.testCommand = 'test';
        }
        
        // Detect project framework
        if (packageJson.dependencies || packageJson.devDependencies) {
          const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
          if (allDeps.react) projectContext.type = 'react';
          else if (allDeps.vue) projectContext.type = 'vue';
          else if (allDeps.next) projectContext.type = 'nextjs';
          else if (allDeps['@angular/core']) projectContext.type = 'angular';
        }
      } catch (e) {
        // Invalid JSON, but file exists
        projectContext.name = path.basename(process.cwd());
      }
    } else {
      projectContext.name = path.basename(process.cwd());
    }
    
    // Check for other project types
    if (fs.existsSync('Cargo.toml')) {
      projectContext.type = 'rust';
      projectContext.devCommand = 'run';
      projectContext.testCommand = 'test';
    } else if (fs.existsSync('go.mod')) {
      projectContext.type = 'go';
      projectContext.devCommand = 'run .';
      projectContext.testCommand = 'test ./...';
    } else if (fs.existsSync('requirements.txt') || fs.existsSync('pyproject.toml')) {
      projectContext.type = 'python';
    }
    
    // Check for worktree setup
    projectContext.hasWorktrees = fs.existsSync('.worktrees');
    
    // Check for menu script
    projectContext.hasMenuScript = fs.existsSync('menu.sh');
    
    return projectContext;
  } catch (error) {
    // Fallback to directory name
    projectContext.name = path.basename(process.cwd());
    projectContext.type = 'unknown';
    return projectContext;
  }
}

// Get theme for session
function getThemeForSession(sessionName) {
  const hash = hashString(sessionName);
  return statusThemes[hash % statusThemes.length];
}

// Set tmux status bar colors and configuration for a session
async function setSessionColors(sessionName, useSplitScreen = true) {
  const theme = getThemeForSession(sessionName);
  const os = require('os');
  
  // Keep platform detection minimal; avoid reattach-to-user-namespace complexity
  
  try {
    // Set status bar colors and essential configuration
    const commands = [
      // Status bar colors
      `tmux set-option -t "${sessionName}" status-bg "${theme.bg}"`,
      `tmux set-option -t "${sessionName}" status-fg "${theme.fg}"`,
      `tmux set-option -t "${sessionName}" status-left-style "bg=${theme.accent},fg=${theme.bg}"`,
      `tmux set-option -t "${sessionName}" status-right-style "bg=${theme.accent},fg=${theme.bg}"`,
      `tmux set-option -t "${sessionName}" window-status-current-style "bg=${theme.accent},fg=${theme.bg}"`,
      `tmux set-option -t "${sessionName}" window-status-style "bg=${theme.bg},fg=${theme.fg}"`,
      `tmux set-option -t "${sessionName}" pane-active-border-style "fg=${theme.accent}"`,
      `tmux set-option -t "${sessionName}" pane-border-style "fg=${theme.bg}"`,
      
      // Essential configuration
      `tmux set-option -t "${sessionName}" mouse on`,
      `tmux set-option -t "${sessionName}" history-limit 10000`,
      
      `tmux set-option -t "${sessionName}" base-index 1`,
      `tmux set-window-option -t "${sessionName}" pane-base-index 1`,
      `tmux set-window-option -t "${sessionName}" mode-keys vi`,
      `tmux set-option -t "${sessionName}" renumber-windows on`,
      
      // Clipboard integration
      `tmux set-option -t "${sessionName}" set-clipboard on`
    ];
    
    
    // Add clipboard-specific configuration based on platform and tools
    if (os.platform() === 'darwin') {
      // macOS: simple, predictable pbcopy integration
      try {
        await execPromise('which pbcopy');
        commands.push(
          `tmux bind-key -t "${sessionName}" -T copy-mode-vi v send-keys -X begin-selection`,
          `tmux bind-key -t "${sessionName}" -T copy-mode-vi y send-keys -X copy-pipe-and-cancel 'pbcopy'`,
          `tmux bind-key -t "${sessionName}" -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel 'pbcopy'`
        );
      } catch {}
    } else {
      // Linux/BSD: prefer Wayland wl-copy, fall back to xclip
      let bound = false;
      try {
        await execPromise('which wl-copy');
        commands.push(
          `tmux bind-key -t "${sessionName}" -T copy-mode-vi v send-keys -X begin-selection`,
          `tmux bind-key -t "${sessionName}" -T copy-mode-vi y send-keys -X copy-pipe-and-cancel 'wl-copy'`,
          `tmux bind-key -t "${sessionName}" -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel 'wl-copy'`
        );
        bound = true;
      } catch {}
      if (!bound) {
        try {
          await execPromise('which xclip');
          commands.push(
            `tmux bind-key -t "${sessionName}" -T copy-mode-vi v send-keys -X begin-selection`,
            `tmux bind-key -t "${sessionName}" -T copy-mode-vi y send-keys -X copy-pipe-and-cancel 'xclip -selection clipboard -i'`,
            `tmux bind-key -t "${sessionName}" -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel 'xclip -selection clipboard -i'`
          );
        } catch {}
      }
    }
    
    // Paste binding (works on both platforms)
    commands.push(`tmux bind-key -t "${sessionName}" p paste-buffer`);
    
    // Conditionally add auto split screen keybindings
    if (useSplitScreen) {
      commands.push(
        `tmux bind-key -t "${sessionName}" c new-window \\; split-window -h -c "#{pane_current_path}" \\; select-pane -L`,
        `tmux bind-key -t "${sessionName}" S new-session \\; split-window -h -c "#{pane_current_path}" \\; select-pane -L`
      );
    } else {
      // Standard keybindings for single pane mode
      commands.push(
        `tmux bind-key -t "${sessionName}" c new-window -c "#{pane_current_path}"`,
        `tmux bind-key -t "${sessionName}" S new-session -c "#{pane_current_path}"`
      );
    }
    
    // Execute all color commands
    for (const cmd of commands) {
      await execPromise(cmd);
    }
    
    return theme;
  } catch (error) {
    // Ignore errors if session doesn't exist yet
    return theme;
  }
}

// Ask user about split screen preference for new sessions
async function askSplitScreenPreference() {
  return new Promise((resolve) => {
    console.log();
    console.log(`${colors.yellow}Session Layout Preference:${colors.reset}`);
    console.log(`${colors.white}1. Single pane (default)${colors.reset}`);
    console.log(`${colors.white}2. Split screen (left/right)${colors.reset}`);
    console.log();
    
    rl.question(`${colors.cyan}Choose layout (1-2, Enter for single): ${colors.reset}`, (answer) => {
      const choice = answer.trim();
      const useSplitScreen = choice === '2';
      
      if (useSplitScreen) {
        console.log(`${colors.green}✓ Split screen layout selected${colors.reset}`);
      } else {
        console.log(`${colors.green}✓ Single pane layout selected${colors.reset}`);
      }
      
      resolve(useSplitScreen);
    });
  });
}

// Ask user about project-aware session setup
async function askProjectSetupPreference() {
  return new Promise((resolve) => {
    console.log();
    console.log(`${colors.yellow}Session Setup Preference:${colors.reset}`);
    console.log(`${colors.white}1. Standard setup (single window)${colors.reset}`);
    console.log(`${colors.white}2. Project-aware setup (multiple windows for ${projectContext.type})${colors.reset}`);
    console.log();
    
    rl.question(`${colors.cyan}Choose setup (1-2, Enter for standard): ${colors.reset}`, (answer) => {
      const choice = answer.trim();
      const useProjectSetup = choice === '2';
      
      if (useProjectSetup) {
        console.log(`${colors.green}✓ Project-aware setup selected${colors.reset}`);
      } else {
        console.log(`${colors.green}✓ Standard setup selected${colors.reset}`);
      }
      
      resolve(useProjectSetup);
    });
  });
}

// Clear screen and show header
function showHeader() {
  console.clear();
  console.log(`${colors.cyan}╔═══════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.white}${colors.bright}                      Wingman CLI!                        ${colors.reset}`);
  console.log(`${colors.cyan}╚═══════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();
}

// Show welcome header for first-time setup
function showWelcomeHeader() {
  console.clear();
  console.log(`${colors.cyan}╔═══════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.white}${colors.bright}              Welcome to Wingman CLI!                      ${colors.reset}`);
  console.log(`${colors.cyan}║${colors.white}${colors.bright}                 First-Time Setup                          ${colors.reset}`);
  console.log(`${colors.cyan}╚═══════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log();
}

// First-time setup flow for project folders
async function setupProjectFolders() {
  showWelcomeHeader();
  
  console.log(`${colors.green}Welcome to Wingman CLI!${colors.reset}`);
  console.log(`${colors.white}This is a tmux session manager that can work with or without project setup.${colors.reset}`);
  console.log();
  console.log(`${colors.yellow}Optional Project Folder Configuration:${colors.reset}`);
  console.log(`${colors.white}You can set up project folders for enhanced session management,${colors.reset}`);
  console.log(`${colors.white}or skip this to use Wingman as a standard tmux session manager.${colors.reset}`);
  console.log();
  
  const skipSetup = await question(`${colors.cyan}Skip project setup and use standard mode? [y/N]: ${colors.reset}`);
  
  if (skipSetup.toLowerCase().startsWith('y')) {
    console.log();
    console.log(`${colors.green}✓ Using standard tmux session management mode${colors.reset}`);
    console.log(`${colors.white}You can configure project folders later from the main menu.${colors.reset}`);
    
    // Mark first run as complete but don't set up folders
    const config = loadWingmanConfig();
    config.firstRun = false;
    saveWingmanConfig(config);
    
    await sleep(2000);
    return false; // Continue to normal session management
  }
  
  console.log();
  console.log(`${colors.yellow}Project Folder Setup:${colors.reset}`);
  console.log(`${colors.white}Let's configure project folders where tmux sessions will begin.${colors.reset}`);
  console.log(`${colors.white}Sessions in these folders can auto-run menu scripts if available.${colors.reset}`);
  console.log();
  
  const config = loadWingmanConfig();
  const projectFolders = [];
  
  // Add current directory as the first project folder if it looks like a project
  const currentDir = process.cwd();
  const currentProjectName = await detectCurrentProjectName();
  
  if (currentProjectName) {
    console.log(`${colors.cyan}Current directory detected as project:${colors.reset}`);
    console.log(`${colors.white}  Path: ${currentDir}${colors.reset}`);
    console.log(`${colors.white}  Name: ${currentProjectName}${colors.reset}`);
    console.log();
    
    const addCurrent = await question(`${colors.green}Add current directory as a project folder? [Y/n]: ${colors.reset}`);
    
    if (!addCurrent.toLowerCase().startsWith('n')) {
      const description = await question(`${colors.cyan}Enter description for this project (optional): ${colors.reset}`);
      
      projectFolders.push({
        path: currentDir,
        name: currentProjectName,
        description: description || `${currentProjectName} project`,
        autoMenu: true
      });
      
      console.log(`${colors.green}✓ Added ${currentProjectName} project folder${colors.reset}`);
      console.log();
    }
  }
  
  // Allow user to add additional project folders
  console.log(`${colors.yellow}Additional Project Folders:${colors.reset}`);
  console.log(`${colors.white}You can add more project folders for different repositories or workspaces.${colors.reset}`);
  console.log();
  
  while (true) {
    const addMore = await question(`${colors.green}Add another project folder? [y/N]: ${colors.reset}`);
    
    if (!addMore.toLowerCase().startsWith('y')) {
      break;
    }
    
    const folderPath = await question(`${colors.cyan}Enter project folder path: ${colors.reset}`);
    
    if (!folderPath) {
      console.log(`${colors.red}Path cannot be empty${colors.reset}`);
      continue;
    }
    
    // Expand ~ to home directory
    const expandedPath = folderPath.startsWith('~') 
      ? path.join(os.homedir(), folderPath.slice(1))
      : path.resolve(folderPath);
    
    // Check if directory exists
    if (!fs.existsSync(expandedPath)) {
      console.log(`${colors.red}Directory does not exist: ${expandedPath}${colors.reset}`);
      const create = await question(`${colors.yellow}Create directory? [y/N]: ${colors.reset}`);
      
      if (create.toLowerCase().startsWith('y')) {
        try {
          fs.mkdirSync(expandedPath, { recursive: true });
          console.log(`${colors.green}✓ Directory created${colors.reset}`);
        } catch (error) {
          console.log(`${colors.red}Failed to create directory: ${error.message}${colors.reset}`);
          continue;
        }
      } else {
        continue;
      }
    }
    
    const folderName = await question(`${colors.cyan}Enter session name for this folder (default: ${path.basename(expandedPath)}): ${colors.reset}`);
    const sessionName = folderName || path.basename(expandedPath);
    
    const description = await question(`${colors.cyan}Enter description (optional): ${colors.reset}`);
    
    const autoMenu = await question(`${colors.cyan}Auto-run menu if available? [Y/n]: ${colors.reset}`);
    
    projectFolders.push({
      path: expandedPath,
      name: sessionName,
      description: description || `${sessionName} workspace`,
      autoMenu: !autoMenu.toLowerCase().startsWith('n')
    });
    
    console.log(`${colors.green}✓ Added ${sessionName} project folder${colors.reset}`);
    console.log();
  }
  
  // Set default preferences
  console.log(`${colors.yellow}Session Preferences:${colors.reset}`);
  
  const defaultLayout = await question(`${colors.cyan}Default session layout (single/split) [single]: ${colors.reset}`);
  const layoutChoice = defaultLayout.toLowerCase() === 'split' ? 'split' : 'single';
  
  const autoMenu = await question(`${colors.cyan}Auto-run project menus when available? [Y/n]: ${colors.reset}`);
  const autoMenuChoice = !autoMenu.toLowerCase().startsWith('n');
  
  console.log();
  
  // Save configuration
  config.projectFolders = projectFolders;
  config.preferences.defaultLayout = layoutChoice;
  config.preferences.autoMenu = autoMenuChoice;
  config.firstRun = false;
  
  if (saveWingmanConfig(config)) {
    console.log(`${colors.green}✓ Configuration saved successfully!${colors.reset}`);
    console.log();
    
    if (projectFolders.length > 0) {
      console.log(`${colors.yellow}Configured project folders:${colors.reset}`);
      projectFolders.forEach((folder, index) => {
        console.log(`${colors.white}  ${index + 1}. ${folder.name}${colors.reset}`);
        console.log(`${colors.magenta}     ${folder.path}${colors.reset}`);
        console.log(`${colors.blue}     ${folder.description}${colors.reset}`);
      });
      console.log();
      
      const createSessions = await question(`${colors.green}Create tmux sessions for these folders now? [Y/n]: ${colors.reset}`);
      
      if (!createSessions.toLowerCase().startsWith('n')) {
        await createProjectFolderSessions(projectFolders);
        return true; // Sessions created, will connect automatically
      }
    }
  } else {
    console.log(`${colors.red}Failed to save configuration. You may need to run setup again.${colors.reset}`);
    console.log();
  }
  
  return false; // Continue to normal session selection
}

// Detect project name from current directory
async function detectCurrentProjectName() {
  try {
    // Check for package.json first
    if (fs.existsSync('package.json')) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (packageJson.name) {
        return packageJson.name;
      }
    }
    
    // Check for other project indicators
    if (fs.existsSync('Cargo.toml')) {
      const cargoToml = fs.readFileSync('Cargo.toml', 'utf8');
      const nameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) {
        return nameMatch[1];
      }
    }
    
    if (fs.existsSync('go.mod')) {
      const goMod = fs.readFileSync('go.mod', 'utf8');
      const moduleMatch = goMod.match(/^module\s+(.+)$/m);
      if (moduleMatch) {
        return path.basename(moduleMatch[1]);
      }
    }
    
    // Check if it's a git repository
    if (fs.existsSync('.git')) {
      return path.basename(process.cwd());
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Create tmux sessions for configured project folders
async function createProjectFolderSessions(projectFolders) {
  console.log(`${colors.yellow}Creating tmux sessions for project folders...${colors.reset}`);
  console.log();
  
  const config = loadWingmanConfig();
  const useSplitScreen = config.preferences.defaultLayout === 'split';
  
  for (const folder of projectFolders) {
    try {
      console.log(`${colors.cyan}Setting up session: ${folder.name}${colors.reset}`);
      
      // Check if session already exists
      try {
        await execPromise(`tmux has-session -t "${folder.name}"`);
        console.log(`${colors.yellow}  Session '${folder.name}' already exists, skipping...${colors.reset}`);
        continue;
      } catch (error) {
        // Session doesn't exist, create it
      }
      
      // Create session in the project folder directory
      await execPromise(`tmux new-session -d -s "${folder.name}" -c "${folder.path}"`);
      
      // Apply theme and configuration
      const theme = await setSessionColors(folder.name, useSplitScreen);
      
      // Set session description
      if (folder.description) {
        await execPromise(`tmux set-option -t "${folder.name}" @description "${folder.description}"`);
      }
      
      // Setup session layout
      if (useSplitScreen) {
        await execPromise(`tmux split-window -h -t "${folder.name}:0" -c "${folder.path}"`);
        await execPromise(`tmux select-pane -t "${folder.name}:0.0"`);
      }
      
      // Check for and run menu if available and enabled
      if (folder.autoMenu && config.preferences.autoMenu) {
        const hasNpmMenu = await checkForNpmMenu(folder.path);
        const hasMenuScript = await checkForMenuScript(folder.path);
        
        if (hasNpmMenu || hasMenuScript) {
          let menuCommand = '';
          let windowName = 'menu';
          
          if (hasNpmMenu) {
            menuCommand = 'npm run menu';
            console.log(`${colors.green}  ✓ Found npm run menu, will auto-start${colors.reset}`);
          } else if (hasMenuScript) {
            menuCommand = './menu.sh';
            console.log(`${colors.green}  ✓ Found menu.sh script, will auto-start${colors.reset}`);
          }
          
          if (menuCommand) {
            // Create a dedicated window for the menu
            await execPromise(`tmux new-window -t "${folder.name}" -n "${windowName}" -c "${folder.path}"`);
            await execPromise(`tmux send-keys -t "${folder.name}:${windowName}" "${menuCommand}" Enter`);
            
            // Return to the first window
            await execPromise(`tmux select-window -t "${folder.name}:0"`);
          }
        } else {
          console.log(`${colors.blue}  No menu script found in ${folder.path}${colors.reset}`);
        }
      }
      
      console.log(`${colors.green}  ✓ Session '${folder.name}' created (${theme.name} theme)${colors.reset}`);
      
    } catch (error) {
      console.log(`${colors.red}  ✗ Failed to create session '${folder.name}': ${error.message}${colors.reset}`);
    }
  }
  
  console.log();
  console.log(`${colors.green}✓ Project folder sessions setup complete!${colors.reset}`);
  console.log();
  
  // Show created sessions
  const sessions = await getSessions();
  if (sessions.length > 0) {
    console.log(`${colors.yellow}Available sessions:${colors.reset}`);
    for (const session of sessions) {
      const info = await getSessionInfo(session);
      console.log(`${colors.white}  • ${session}${colors.reset} - ${colors.magenta}${info}${colors.reset}`);
    }
    console.log();
    
    // Ask which session to connect to
    const firstSession = projectFolders[0]?.name || sessions[0];
    const connectChoice = await question(`${colors.green}Connect to session '${firstSession}'? [Y/n]: ${colors.reset}`);
    
    if (!connectChoice.toLowerCase().startsWith('n')) {
      await connectToSpecificSession(firstSession);
      return;
    }
  }
  
  // If not connecting automatically, update last session
  config.lastSession = projectFolders[0]?.name || null;
  saveWingmanConfig(config);
}

// Check if project has npm run menu command
async function checkForNpmMenu(projectPath) {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return packageJson.scripts && packageJson.scripts.menu;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Check if project has menu.sh script
async function checkForMenuScript(projectPath) {
  try {
    const menuScriptPath = path.join(projectPath, 'menu.sh');
    return fs.existsSync(menuScriptPath);
  } catch (error) {
    return false;
  }
}

// Connect to a specific session
async function connectToSpecificSession(sessionName) {
  try {
    // Set session colors before connecting
    const theme = await setSessionColors(sessionName);
    console.log(`${colors.green}Connecting to session: ${sessionName} (${theme.name} theme)${colors.reset}`);
    await sleep(1000);
    
    // Update last session in config
    const config = loadWingmanConfig();
    config.lastSession = sessionName;
    saveWingmanConfig(config);
    
    // Attach to tmux session
    rl.close();
    const tmux = spawn('tmux', ['attach-session', '-t', sessionName], {
      stdio: 'inherit'
    });
    
    tmux.on('exit', () => {
      process.exit(0);
    });
    
  } catch (error) {
    console.log(`${colors.red}Failed to connect to session '${sessionName}': ${error.message}${colors.reset}`);
    await sleep(2000);
  }
}

// Check if tmux is installed
async function checkTmux() {
  try {
    await execPromise('which tmux');
    return true;
  } catch (error) {
    console.log(`${colors.red}Error: tmux is not installed${colors.reset}`);
    console.log('Please install tmux first: brew install tmux (macOS) or apt install tmux (Ubuntu)');
    process.exit(1);
  }
}

// Check for clipboard integration tools on macOS
async function checkClipboardTools() {
  const os = require('os');
  if (os.platform() === 'darwin') {
    try {
      await execPromise('which reattach-to-user-namespace');
      return true;
    } catch (error) {
      console.log(`${colors.yellow}Note: Clipboard integration uses tmux set-clipboard on macOS.${colors.reset}`);
      console.log(`${colors.blue}Optional: On older setups, reattach-to-user-namespace may help:${colors.reset}`);
      console.log(`${colors.white}  brew install reattach-to-user-namespace${colors.reset}`);
      console.log();
      return false;
    }
  }
  return true;
}

// Get all tmux sessions
async function getSessions() {
  try {
    const { stdout } = await execPromise('tmux list-sessions -F "#{session_name}"');
    if (!stdout.trim()) return [];
    return stdout.trim().split('\n');
  } catch (error) {
    // No sessions exist
    return [];
  }
}

// Get detailed session info
async function getSessionInfo(sessionName) {
  try {
    const { stdout } = await execPromise(
      `tmux list-sessions -F "#{session_name}:#{session_windows}:#{?session_attached,attached,not attached}" | grep "^${sessionName}:"`
    );
    const [, windows, status] = stdout.trim().split(':');
    
    // Try to get session description if set
    let description = '';
    try {
      const { stdout: descOutput } = await execPromise(
        `tmux show-option -t "${sessionName}" -qv @description`
      );
      if (descOutput.trim()) {
        description = ` - ${descOutput.trim()}`;
      }
    } catch (e) {
      // No description set
    }
    
    return `${windows} windows, ${status}${description}`;
  } catch (error) {
    return 'unknown';
  }
}

// Display sessions with pagination
async function displaySessions(sessions) {
  const totalSessions = sessions.length;
  const startIdx = currentPage * SESSIONS_PER_PAGE;
  const endIdx = Math.min(startIdx + SESSIONS_PER_PAGE, totalSessions);
  
  console.log(`${colors.yellow}Available Sessions:${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  
  if (totalSessions === 0) {
    console.log(`${colors.red}No tmux sessions found${colors.reset}`);
    return false;
  }
  
  let displayCount = 0;
  for (let i = startIdx; i < endIdx; i++) {
    displayCount++;
    const sessionName = sessions[i];
    const sessionInfo = await getSessionInfo(sessionName);
    
    console.log(`${colors.white}${displayCount})${colors.reset} ${colors.green}${sessionName}${colors.reset}`);
    console.log(`   ${colors.magenta}${sessionInfo}${colors.reset}`);
  }
  
  // Show pagination info
  const totalPages = Math.ceil(totalSessions / SESSIONS_PER_PAGE);
  if (totalPages > 1) {
    console.log();
    console.log(`${colors.cyan}Page ${currentPage + 1} of ${totalPages}${colors.reset}`);
  }
  
  return true;
}

// Connect to a session
async function connectToSession() {
  while (true) {
    showHeader();
    
    const sessions = await getSessions();
    const hasSessions = await displaySessions(sessions);
    
    if (!hasSessions) {
      console.log();
      console.log(`${colors.yellow}Options:${colors.reset}`);
      console.log(`${colors.white}n)${colors.reset} Create new session`);
      console.log(`${colors.white}q)${colors.reset} Quit`);
      console.log();
      
      const choice = await question('Enter your choice: ');
      
      switch(choice.toLowerCase()) {
        case 'n':
          await createNewSession();
          return;
        case 'q':
          process.exit(0);
        default:
          console.log(`${colors.red}Invalid option${colors.reset}`);
          await sleep(1000);
      }
      continue;
    }
    
    const totalSessions = sessions.length;
    const startIdx = currentPage * SESSIONS_PER_PAGE;
    const endIdx = Math.min(startIdx + SESSIONS_PER_PAGE, totalSessions);
    const totalPages = Math.ceil(totalSessions / SESSIONS_PER_PAGE);
    
    console.log();
    console.log(`${colors.yellow}Options:${colors.reset}`);
    console.log(`${colors.white}1-9)${colors.reset} Connect to session`);
    
    if (totalPages > 1) {
      if (currentPage > 0) {
        console.log(`${colors.white}p)${colors.reset} Previous page`);
      }
      if (currentPage + 1 < totalPages) {
        console.log(`${colors.white}n)${colors.reset} Next page`);
      }
    }
    
    console.log(`${colors.white}c)${colors.reset} Create new session`);
    console.log(`${colors.white}e)${colors.reset} Edit session (rename/description)`);
    console.log(`${colors.white}d)${colors.reset} Delete session`);
    console.log(`${colors.white}r)${colors.reset} Refresh`);
    console.log(`${colors.white}q)${colors.reset} Quit`);
    console.log();
    
    const choice = await question('Enter your choice: ');
    
    if (/^[1-9]$/.test(choice)) {
      const sessionIdx = startIdx + parseInt(choice) - 1;
      if (sessionIdx < endIdx && sessionIdx < totalSessions) {
        const selectedSession = sessions[sessionIdx];
        
        // Set session colors before connecting
        const theme = await setSessionColors(selectedSession);
        console.log(`${colors.green}Connecting to session: ${selectedSession} (${theme.name} theme)${colors.reset}`);
        await sleep(1000);
        
        // Update last session in config
        const config = loadWingmanConfig();
        config.lastSession = selectedSession;
        saveWingmanConfig(config);
        
        // Close readline for tmux session
        rl.close();
        const tmux = spawn('tmux', ['attach-session', '-t', selectedSession], {
          stdio: 'inherit'
        });
        
        tmux.on('exit', async (code) => {
          // Check if session still exists (detached) or was terminated
          try {
            const remainingSessions = await getSessions();
            const sessionExists = remainingSessions.includes(selectedSession);
            
            if (sessionExists) {
              // Session was detached, not terminated - return to menu
              console.log(`${colors.green}Detached from session: ${selectedSession}${colors.reset}`);
              
              // Recreate readline interface for menu
              rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
              });
              
              // Reset page and restart session management
              currentPage = 0;
              
              // Use setTimeout to avoid potential recursion issues
              setTimeout(async () => {
                await connectToSession();
              }, 100);
            } else {
              // Session was terminated - exit normally
              process.exit(0);
            }
          } catch (error) {
            // If we can't check sessions, assume termination
            console.log(`${colors.red}Session ended${colors.reset}`);
            process.exit(0);
          }
        });
        
        return;
      } else {
        console.log(`${colors.red}Invalid session number${colors.reset}`);
        await sleep(1000);
      }
    } else {
      switch(choice.toLowerCase()) {
        case 'p':
          if (currentPage > 0) {
            currentPage--;
          } else {
            console.log(`${colors.red}Already on first page${colors.reset}`);
            await sleep(1000);
          }
          break;
        case 'n':
          if (currentPage + 1 < totalPages) {
            currentPage++;
          } else {
            await createNewSession();
            return;
          }
          break;
        case 'c':
          await createNewSession();
          return;
        case 'e':
          await editSession();
          currentPage = 0;
          break;
        case 'd':
          await deleteSession();
          currentPage = 0;
          break;
        case 'r':
          currentPage = 0;
          break;
        case 'q':
          process.exit(0);
        default:
          console.log(`${colors.red}Invalid option${colors.reset}`);
          await sleep(1000);
      }
    }
  }
}

// Generate project-aware session name suggestions
function generateSessionNameSuggestions() {
  const suggestions = [];
  const baseName = projectContext.name || 'project';
  
  // Add project-based suggestions
  suggestions.push(baseName);
  suggestions.push(`${baseName}-dev`);
  suggestions.push(`${baseName}-main`);
  
  // Add type-specific suggestions
  if (projectContext.type) {
    suggestions.push(`${baseName}-${projectContext.type}`);
  }
  
  // Add worktree-aware suggestions
  if (projectContext.hasWorktrees) {
    suggestions.push(`${baseName}-feature`);
    suggestions.push(`${baseName}-hotfix`);
  }
  
  return suggestions.slice(0, 3); // Return top 3 suggestions
}

// Setup project-specific tmux session
async function setupProjectSession(sessionName, useSplitScreen) {
  try {
    // Create session
    await execPromise(`tmux new-session -d -s "${sessionName}"`);
    
    // Setup project-specific windows and panes
    if (projectContext.type === 'nodejs' || projectContext.type === 'react' || projectContext.type === 'nextjs') {
      // Create windows for Node.js projects
      await execPromise(`tmux new-window -t "${sessionName}" -n "editor"`);
      
      if (projectContext.devCommand) {
        await execPromise(`tmux new-window -t "${sessionName}" -n "dev"`);
        await execPromise(`tmux send-keys -t "${sessionName}:dev" "npm run ${projectContext.devCommand}" Enter`);
      }
      
      if (projectContext.testCommand) {
        await execPromise(`tmux new-window -t "${sessionName}" -n "test"`);
        await execPromise(`tmux send-keys -t "${sessionName}:test" "npm run ${projectContext.testCommand}" Enter`);
      }
      
      // If has menu script, add menu window
      if (projectContext.hasMenuScript) {
        await execPromise(`tmux new-window -t "${sessionName}" -n "menu"`);
        await execPromise(`tmux send-keys -t "${sessionName}:menu" "./menu.sh" Enter`);
      }
      
    } else if (projectContext.type === 'rust') {
      await execPromise(`tmux new-window -t "${sessionName}" -n "editor"`);
      await execPromise(`tmux new-window -t "${sessionName}" -n "cargo"`);
      await execPromise(`tmux send-keys -t "${sessionName}:cargo" "cargo run" Enter`);
      
    } else if (projectContext.type === 'go') {
      await execPromise(`tmux new-window -t "${sessionName}" -n "editor"`);
      await execPromise(`tmux new-window -t "${sessionName}" -n "go"`);
      await execPromise(`tmux send-keys -t "${sessionName}:go" "go run ." Enter`);
    }
    
    // Setup initial window with split if requested
    if (useSplitScreen) {
      await execPromise(`tmux split-window -h -t "${sessionName}:0" -c "#{pane_current_path}"`);
      await execPromise(`tmux select-pane -t "${sessionName}:0.0"`);
    }
    
    // Select first window
    await execPromise(`tmux select-window -t "${sessionName}:0"`);
    
  } catch (error) {
    console.log(`${colors.red}Error setting up project session: ${error.message}${colors.reset}`);
    throw error;
  }
}

// Create a new session
async function createNewSession() {
  showHeader();
  console.log(`${colors.yellow}Create New Tmux Session${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  console.log();
  
  // Show project context if available
  if (projectContext.name) {
    console.log(`${colors.cyan}Project Context:${colors.reset}`);
    console.log(`  Name: ${colors.white}${projectContext.name}${colors.reset}`);
    console.log(`  Type: ${colors.white}${projectContext.type || 'unknown'}${colors.reset}`);
    if (projectContext.devCommand) {
      console.log(`  Dev Command: ${colors.white}npm run ${projectContext.devCommand}${colors.reset}`);
    }
    console.log();
    
    // Show suggestions
    const suggestions = generateSessionNameSuggestions();
    console.log(`${colors.cyan}Suggested session names:${colors.reset}`);
    suggestions.forEach((name, index) => {
      console.log(`  ${index + 1}. ${colors.green}${name}${colors.reset}`);
    });
    console.log();
  }
  
  while (true) {
    const input = await question("Enter session name, number from suggestions, or 'q' to quit: ");
    
    if (input.toLowerCase() === 'q') {
      return;
    }
    
    let sessionName;
    
    // Check if input is a number (suggestion selection)
    if (/^[1-3]$/.test(input) && projectContext.name) {
      const suggestions = generateSessionNameSuggestions();
      sessionName = suggestions[parseInt(input) - 1];
      console.log(`${colors.green}Selected: ${sessionName}${colors.reset}`);
    } else {
      sessionName = input;
    }
    
    if (!sessionName) {
      console.log(`${colors.red}Session name cannot be empty${colors.reset}`);
      continue;
    }
    
    // Check if session already exists
    try {
      await execPromise(`tmux has-session -t "${sessionName}"`);
      console.log(`${colors.red}Session '${sessionName}' already exists${colors.reset}`);
      const connectChoice = await question('Do you want to connect to it instead? (y/n): ');
      
      if (connectChoice.toLowerCase() === 'y') {
        // Set session colors before connecting
        const theme = await setSessionColors(sessionName);
        console.log(`${colors.green}Connecting to existing session: ${sessionName} (${theme.name} theme)${colors.reset}`);
        await sleep(1000);
        
        rl.close();
        const tmux = spawn('tmux', ['attach-session', '-t', sessionName], {
          stdio: 'inherit'
        });
        
        tmux.on('exit', () => {
          process.exit(0);
        });
        
        return;
      }
    } catch (error) {
      // Session doesn't exist, create it
      const theme = getThemeForSession(sessionName);
      console.log(`${colors.green}Creating session: ${sessionName} (${theme.name} theme)${colors.reset}`);
      
      // Ask about project-aware setup
      let useProjectSetup = false;
      if (projectContext.name && projectContext.type !== 'unknown') {
        console.log();
        useProjectSetup = await askProjectSetupPreference();
      }
      
      // Ask user about split screen preference
      const useSplitScreen = await askSplitScreenPreference();
      
      // Ask for optional description
      console.log();
      const description = await question(`${colors.cyan}Enter session description (optional): ${colors.reset}`);
      
      await sleep(500);
      
      // Create session with project-aware setup or standard setup
      try {
        if (useProjectSetup) {
          await setupProjectSession(sessionName, useSplitScreen);
        } else {
          // Standard session creation
          await execPromise(`tmux new-session -d -s "${sessionName}"`);
          
          // Conditionally auto-split the initial window
          if (useSplitScreen) {
            await execPromise(`tmux split-window -h -t "${sessionName}:0" -c "#{pane_current_path}"`);
            await execPromise(`tmux select-pane -t "${sessionName}:0.0"`);
          }
        }
        
        await setSessionColors(sessionName, useSplitScreen);
        
        // Set description if provided
        if (description) {
          try {
            await execPromise(`tmux set-option -t "${sessionName}" @description "${description}"`);
          } catch (e) {
            // Ignore error if session doesn't exist yet
          }
        }
        
        rl.close();
        const tmux = spawn('tmux', ['attach-session', '-t', sessionName], {
          stdio: 'inherit'
        });
        
        tmux.on('exit', () => {
          process.exit(0);
        });
        
        return;
      } catch (createError) {
        console.log(`${colors.red}Failed to create session: ${createError.message}${colors.reset}`);
        await sleep(1000);
        continue;
      }
    }
  }
}

// Edit session (rename and/or set description)
async function editSession() {
  while (true) {
    showHeader();
    console.log(`${colors.yellow}Edit Tmux Session${colors.reset}`);
    console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
    console.log();
    
    const sessions = await getSessions();
    const hasSessions = await displaySessions(sessions);
    
    if (!hasSessions) {
      console.log();
      console.log(`${colors.yellow}No sessions to edit${colors.reset}`);
      console.log(`${colors.white}Press Enter to return...${colors.reset}`);
      await question('');
      return;
    }
    
    const totalSessions = sessions.length;
    const startIdx = currentPage * SESSIONS_PER_PAGE;
    const endIdx = Math.min(startIdx + SESSIONS_PER_PAGE, totalSessions);
    const totalPages = Math.ceil(totalSessions / SESSIONS_PER_PAGE);
    
    console.log();
    console.log(`${colors.yellow}Options:${colors.reset}`);
    console.log(`${colors.white}1-9)${colors.reset} Select session to edit`);
    
    if (totalPages > 1) {
      if (currentPage > 0) {
        console.log(`${colors.white}p)${colors.reset} Previous page`);
      }
      if (currentPage + 1 < totalPages) {
        console.log(`${colors.white}n)${colors.reset} Next page`);
      }
    }
    
    console.log(`${colors.white}r)${colors.reset} Refresh`);
    console.log(`${colors.white}q)${colors.reset} Back to menu`);
    console.log();
    
    const choice = await question('Enter your choice: ');
    
    if (/^[1-9]$/.test(choice)) {
      const sessionIdx = startIdx + parseInt(choice) - 1;
      if (sessionIdx < endIdx && sessionIdx < totalSessions) {
        const selectedSession = sessions[sessionIdx];
        
        // Edit submenu
        console.log();
        console.log(`${colors.cyan}Editing session: ${colors.green}${selectedSession}${colors.reset}`);
        console.log();
        console.log(`${colors.yellow}What would you like to do?${colors.reset}`);
        console.log(`${colors.white}1)${colors.reset} Rename session`);
        console.log(`${colors.white}2)${colors.reset} Set/update description`);
        console.log(`${colors.white}3)${colors.reset} Both`);
        console.log(`${colors.white}q)${colors.reset} Cancel`);
        console.log();
        
        const editChoice = await question('Enter your choice: ');
        
        if (editChoice === '1' || editChoice === '3') {
          // Rename session
          console.log();
          const newName = await question(`Enter new name for session (current: ${selectedSession}): `);
          
          if (newName && newName !== selectedSession) {
            // Check if new name already exists
            try {
              await execPromise(`tmux has-session -t "${newName}"`);
              console.log(`${colors.red}Session '${newName}' already exists${colors.reset}`);
              await sleep(2000);
              continue;
            } catch (e) {
              // Name doesn't exist, proceed with rename
              try {
                await execPromise(`tmux rename-session -t "${selectedSession}" "${newName}"`);
                console.log(`${colors.green}Session renamed from '${selectedSession}' to '${newName}'${colors.reset}`);
                
                // Update the selected session name for description setting
                if (editChoice === '3') {
                  selectedSession = newName;
                }
              } catch (error) {
                console.log(`${colors.red}Failed to rename session: ${error.message}${colors.reset}`);
                await sleep(2000);
                continue;
              }
            }
          }
        }
        
        if (editChoice === '2' || editChoice === '3') {
          // Set description
          console.log();
          
          // Get current description if exists
          let currentDesc = '';
          try {
            const { stdout } = await execPromise(
              `tmux show-option -t "${selectedSession}" -qv @description`
            );
            currentDesc = stdout.trim();
          } catch (e) {
            // No description set
          }
          
          if (currentDesc) {
            console.log(`${colors.cyan}Current description: ${colors.white}${currentDesc}${colors.reset}`);
          }
          
          const newDesc = await question('Enter new description (or leave empty to clear): ');
          
          try {
            if (newDesc) {
              await execPromise(`tmux set-option -t "${selectedSession}" @description "${newDesc}"`);
              console.log(`${colors.green}Description updated for session '${selectedSession}'${colors.reset}`);
            } else if (currentDesc) {
              await execPromise(`tmux set-option -t "${selectedSession}" -u @description`);
              console.log(`${colors.green}Description cleared for session '${selectedSession}'${colors.reset}`);
            }
          } catch (error) {
            console.log(`${colors.red}Failed to update description: ${error.message}${colors.reset}`);
          }
        }
        
        if (editChoice === '1' || editChoice === '2' || editChoice === '3') {
          await sleep(2000);
        }
        
        currentPage = 0;
      } else {
        console.log(`${colors.red}Invalid session number${colors.reset}`);
        await sleep(1000);
      }
    } else {
      switch(choice.toLowerCase()) {
        case 'p':
          if (currentPage > 0) {
            currentPage--;
          } else {
            console.log(`${colors.red}Already on first page${colors.reset}`);
            await sleep(1000);
          }
          break;
        case 'n':
          if (currentPage + 1 < totalPages) {
            currentPage++;
          } else {
            console.log(`${colors.red}Already on last page${colors.reset}`);
            await sleep(1000);
          }
          break;
        case 'r':
          currentPage = 0;
          break;
        case 'q':
          return;
        default:
          console.log(`${colors.red}Invalid option${colors.reset}`);
          await sleep(1000);
      }
    }
  }
}

// Delete a session
async function deleteSession() {
  while (true) {
    showHeader();
    console.log(`${colors.yellow}Delete Tmux Session${colors.reset}`);
    console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
    console.log();
    
    const sessions = await getSessions();
    const hasSessions = await displaySessions(sessions);
    
    if (!hasSessions) {
      console.log();
      console.log(`${colors.yellow}No sessions to delete${colors.reset}`);
      console.log(`${colors.white}Press Enter to return...${colors.reset}`);
      await question('');
      return;
    }
    
    const totalSessions = sessions.length;
    const startIdx = currentPage * SESSIONS_PER_PAGE;
    const endIdx = Math.min(startIdx + SESSIONS_PER_PAGE, totalSessions);
    const totalPages = Math.ceil(totalSessions / SESSIONS_PER_PAGE);
    
    console.log();
    console.log(`${colors.red}⚠ WARNING: Deleting a session will terminate all processes in it${colors.reset}`);
    console.log();
    console.log(`${colors.yellow}Options:${colors.reset}`);
    console.log(`${colors.white}1-9)${colors.reset} Select session to delete`);
    
    if (totalPages > 1) {
      if (currentPage > 0) {
        console.log(`${colors.white}p)${colors.reset} Previous page`);
      }
      if (currentPage + 1 < totalPages) {
        console.log(`${colors.white}n)${colors.reset} Next page`);
      }
    }
    
    console.log(`${colors.white}r)${colors.reset} Refresh`);
    console.log(`${colors.white}q)${colors.reset} Back to menu`);
    console.log();
    
    const choice = await question('Enter your choice: ');
    
    if (/^[1-9]$/.test(choice)) {
      const sessionIdx = startIdx + parseInt(choice) - 1;
      if (sessionIdx < endIdx && sessionIdx < totalSessions) {
        const selectedSession = sessions[sessionIdx];
        console.log();
        console.log(`${colors.yellow}Are you sure you want to delete session: ${colors.red}${selectedSession}${colors.yellow}?${colors.reset}`);
        const confirm = await question("Type 'yes' to confirm: ");
        
        if (confirm === 'yes') {
          try {
            await execPromise(`tmux kill-session -t "${selectedSession}"`);
            console.log(`${colors.green}Session '${selectedSession}' deleted successfully${colors.reset}`);
          } catch (error) {
            console.log(`${colors.red}Failed to delete session '${selectedSession}'${colors.reset}`);
          }
          await sleep(1000);
          currentPage = 0;
        } else {
          console.log(`${colors.yellow}Deletion cancelled${colors.reset}`);
          await sleep(1000);
        }
      } else {
        console.log(`${colors.red}Invalid session number${colors.reset}`);
        await sleep(1000);
      }
    } else {
      switch(choice.toLowerCase()) {
        case 'p':
          if (currentPage > 0) {
            currentPage--;
          } else {
            console.log(`${colors.red}Already on first page${colors.reset}`);
            await sleep(1000);
          }
          break;
        case 'n':
          if (currentPage + 1 < totalPages) {
            currentPage++;
          } else {
            console.log(`${colors.red}Already on last page${colors.reset}`);
            await sleep(1000);
          }
          break;
        case 'r':
          currentPage = 0;
          break;
        case 'q':
          return;
        default:
          console.log(`${colors.red}Invalid option${colors.reset}`);
          await sleep(1000);
      }
    }
  }
}

// Manage wingman configuration
async function manageConfiguration() {
  while (true) {
    showHeader();
    console.log(`${colors.yellow}Wingman Configuration (Optional)${colors.reset}`);
    console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
    console.log();
    console.log(`${colors.white}Note: Project folders are optional. Wingman works as a standard${colors.reset}`);
    console.log(`${colors.white}tmux session manager without any configuration.${colors.reset}`);
    console.log();
    
    const config = loadWingmanConfig();
    
    // Show current configuration
    console.log(`${colors.cyan}Current Configuration:${colors.reset}`);
    console.log(`${colors.white}  First Run: ${config.firstRun ? 'Yes' : 'No'}${colors.reset}`);
    console.log(`${colors.white}  Default Layout: ${config.preferences.defaultLayout}${colors.reset}`);
    console.log(`${colors.white}  Auto Menu: ${config.preferences.autoMenu ? 'Yes' : 'No'}${colors.reset}`);
    console.log(`${colors.white}  Reconnect to Recent: ${config.preferences.reconnectToRecent ? 'Yes' : 'No'}${colors.reset}`);
    console.log(`${colors.white}  Last Session: ${config.lastSession || 'None'}${colors.reset}`);
    console.log();
    
    if (config.projectFolders.length > 0) {
      console.log(`${colors.cyan}Project Folders:${colors.reset}`);
      config.projectFolders.forEach((folder, index) => {
        console.log(`${colors.white}  ${index + 1}. ${folder.name}${colors.reset}`);
        console.log(`${colors.magenta}     ${folder.path}${colors.reset}`);
        console.log(`${colors.blue}     ${folder.description}${colors.reset}`);
        console.log(`${colors.green}     Auto Menu: ${folder.autoMenu ? 'Yes' : 'No'}${colors.reset}`);
      });
    } else {
      console.log(`${colors.yellow}No project folders configured${colors.reset}`);
    }
    
    console.log();
    console.log(`${colors.yellow}Options:${colors.reset}`);
    console.log(`${colors.white}1)${colors.reset} Add project folder`);
    console.log(`${colors.white}2)${colors.reset} Remove project folder`);
    console.log(`${colors.white}3)${colors.reset} Edit project folder`);
    console.log(`${colors.white}4)${colors.reset} Update preferences`);
    console.log(`${colors.white}5)${colors.reset} Reset to first run`);
    console.log(`${colors.white}6)${colors.reset} Create sessions for all folders`);
    console.log(`${colors.white}q)${colors.reset} Back to main menu`);
    console.log();
    
    const choice = await question('Enter your choice: ');
    
    switch(choice) {
      case '1':
        await addProjectFolder();
        break;
      case '2':
        await removeProjectFolder();
        break;
      case '3':
        await editProjectFolder();
        break;
      case '4':
        await updatePreferences();
        break;
      case '5':
        await resetToFirstRun();
        break;
      case '6':
        const currentConfig = loadWingmanConfig();
        if (currentConfig.projectFolders.length > 0) {
          await createProjectFolderSessions(currentConfig.projectFolders);
          return;
        } else {
          console.log(`${colors.red}No project folders configured${colors.reset}`);
          await sleep(1000);
        }
        break;
      case 'q':
        return;
      default:
        console.log(`${colors.red}Invalid option${colors.reset}`);
        await sleep(1000);
    }
  }
}

// Add a new project folder
async function addProjectFolder() {
  showHeader();
  console.log(`${colors.yellow}Add Project Folder${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  console.log();
  
  const config = loadWingmanConfig();
  
  const folderPath = await question(`${colors.cyan}Enter project folder path: ${colors.reset}`);
  
  if (!folderPath) {
    console.log(`${colors.red}Path cannot be empty${colors.reset}`);
    await sleep(1000);
    return;
  }
  
  // Expand ~ to home directory
  const expandedPath = folderPath.startsWith('~') 
    ? path.join(os.homedir(), folderPath.slice(1))
    : path.resolve(folderPath);
  
  // Check if directory exists
  if (!fs.existsSync(expandedPath)) {
    console.log(`${colors.red}Directory does not exist: ${expandedPath}${colors.reset}`);
    const create = await question(`${colors.yellow}Create directory? [y/N]: ${colors.reset}`);
    
    if (create.toLowerCase().startsWith('y')) {
      try {
        fs.mkdirSync(expandedPath, { recursive: true });
        console.log(`${colors.green}✓ Directory created${colors.reset}`);
      } catch (error) {
        console.log(`${colors.red}Failed to create directory: ${error.message}${colors.reset}`);
        await sleep(2000);
        return;
      }
    } else {
      return;
    }
  }
  
  const folderName = await question(`${colors.cyan}Enter session name for this folder (default: ${path.basename(expandedPath)}): ${colors.reset}`);
  const sessionName = folderName || path.basename(expandedPath);
  
  // Check for duplicate names
  if (config.projectFolders.some(f => f.name === sessionName)) {
    console.log(`${colors.red}A project folder with name '${sessionName}' already exists${colors.reset}`);
    await sleep(2000);
    return;
  }
  
  const description = await question(`${colors.cyan}Enter description (optional): ${colors.reset}`);
  const autoMenu = await question(`${colors.cyan}Auto-run menu if available? [Y/n]: ${colors.reset}`);
  
  config.projectFolders.push({
    path: expandedPath,
    name: sessionName,
    description: description || `${sessionName} workspace`,
    autoMenu: !autoMenu.toLowerCase().startsWith('n')
  });
  
  if (saveWingmanConfig(config)) {
    console.log(`${colors.green}✓ Added ${sessionName} project folder${colors.reset}`);
  } else {
    console.log(`${colors.red}Failed to save configuration${colors.reset}`);
  }
  
  await sleep(1500);
}

// Remove a project folder
async function removeProjectFolder() {
  const config = loadWingmanConfig();
  
  if (config.projectFolders.length === 0) {
    console.log(`${colors.red}No project folders to remove${colors.reset}`);
    await sleep(1000);
    return;
  }
  
  showHeader();
  console.log(`${colors.yellow}Remove Project Folder${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  console.log();
  
  config.projectFolders.forEach((folder, index) => {
    console.log(`${colors.white}${index + 1}) ${folder.name}${colors.reset}`);
    console.log(`   ${colors.magenta}${folder.path}${colors.reset}`);
  });
  
  console.log();
  const choice = await question(`Enter folder number to remove (1-${config.projectFolders.length}) or 'q' to cancel: `);
  
  if (choice.toLowerCase() === 'q') {
    return;
  }
  
  const index = parseInt(choice) - 1;
  if (index >= 0 && index < config.projectFolders.length) {
    const folder = config.projectFolders[index];
    const confirm = await question(`${colors.red}Remove '${folder.name}'? [y/N]: ${colors.reset}`);
    
    if (confirm.toLowerCase().startsWith('y')) {
      config.projectFolders.splice(index, 1);
      
      if (saveWingmanConfig(config)) {
        console.log(`${colors.green}✓ Removed ${folder.name}${colors.reset}`);
      } else {
        console.log(`${colors.red}Failed to save configuration${colors.reset}`);
      }
    }
  } else {
    console.log(`${colors.red}Invalid selection${colors.reset}`);
  }
  
  await sleep(1500);
}

// Edit a project folder
async function editProjectFolder() {
  const config = loadWingmanConfig();
  
  if (config.projectFolders.length === 0) {
    console.log(`${colors.red}No project folders to edit${colors.reset}`);
    await sleep(1000);
    return;
  }
  
  showHeader();
  console.log(`${colors.yellow}Edit Project Folder${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  console.log();
  
  config.projectFolders.forEach((folder, index) => {
    console.log(`${colors.white}${index + 1}) ${folder.name}${colors.reset}`);
    console.log(`   ${colors.magenta}${folder.path}${colors.reset}`);
  });
  
  console.log();
  const choice = await question(`Enter folder number to edit (1-${config.projectFolders.length}) or 'q' to cancel: `);
  
  if (choice.toLowerCase() === 'q') {
    return;
  }
  
  const index = parseInt(choice) - 1;
  if (index >= 0 && index < config.projectFolders.length) {
    const folder = config.projectFolders[index];
    
    console.log();
    console.log(`${colors.cyan}Editing: ${folder.name}${colors.reset}`);
    console.log();
    
    const newName = await question(`Name [${folder.name}]: `);
    const newDescription = await question(`Description [${folder.description}]: `);
    const newAutoMenu = await question(`Auto-run menu [${folder.autoMenu ? 'Yes' : 'No'}] (y/n): `);
    
    if (newName) folder.name = newName;
    if (newDescription) folder.description = newDescription;
    if (newAutoMenu.toLowerCase() === 'y' || newAutoMenu.toLowerCase() === 'n') {
      folder.autoMenu = newAutoMenu.toLowerCase() === 'y';
    }
    
    if (saveWingmanConfig(config)) {
      console.log(`${colors.green}✓ Updated ${folder.name}${colors.reset}`);
    } else {
      console.log(`${colors.red}Failed to save configuration${colors.reset}`);
    }
  } else {
    console.log(`${colors.red}Invalid selection${colors.reset}`);
  }
  
  await sleep(1500);
}

// Update preferences
async function updatePreferences() {
  showHeader();
  console.log(`${colors.yellow}Update Preferences${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  console.log();
  
  const config = loadWingmanConfig();
  
  console.log(`${colors.cyan}Current preferences:${colors.reset}`);
  console.log(`${colors.white}  Default Layout: ${config.preferences.defaultLayout}${colors.reset}`);
  console.log(`${colors.white}  Auto Menu: ${config.preferences.autoMenu ? 'Yes' : 'No'}${colors.reset}`);
  console.log(`${colors.white}  Reconnect to Recent: ${config.preferences.reconnectToRecent ? 'Yes' : 'No'}${colors.reset}`);
  console.log();
  
  const layout = await question(`Default session layout (single/split) [${config.preferences.defaultLayout}]: `);
  const autoMenu = await question(`Auto-run project menus (y/n) [${config.preferences.autoMenu ? 'y' : 'n'}]: `);
  const reconnect = await question(`Reconnect to recent session (y/n) [${config.preferences.reconnectToRecent ? 'y' : 'n'}]: `);
  
  if (layout === 'single' || layout === 'split') {
    config.preferences.defaultLayout = layout;
  }
  
  if (autoMenu.toLowerCase() === 'y' || autoMenu.toLowerCase() === 'n') {
    config.preferences.autoMenu = autoMenu.toLowerCase() === 'y';
  }
  
  if (reconnect.toLowerCase() === 'y' || reconnect.toLowerCase() === 'n') {
    config.preferences.reconnectToRecent = reconnect.toLowerCase() === 'y';
  }
  
  if (saveWingmanConfig(config)) {
    console.log(`${colors.green}✓ Preferences updated${colors.reset}`);
  } else {
    console.log(`${colors.red}Failed to save configuration${colors.reset}`);
  }
  
  await sleep(1500);
}

// Reset to first run state
async function resetToFirstRun() {
  showHeader();
  console.log(`${colors.yellow}Reset to First Run${colors.reset}`);
  console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
  console.log();
  
  console.log(`${colors.red}This will reset Wingman CLI to first-run state.${colors.reset}`);
  console.log(`${colors.white}Your project folders and preferences will be cleared.${colors.reset}`);
  console.log();
  
  const confirm = await question(`${colors.red}Are you sure? Type 'yes' to confirm: ${colors.reset}`);
  
  if (confirm === 'yes') {
    const config = getDefaultConfig();
    
    if (saveWingmanConfig(config)) {
      console.log(`${colors.green}✓ Reset to first run state${colors.reset}`);
      console.log(`${colors.yellow}Next time you run Wingman CLI, the first-time setup will run again.${colors.reset}`);
    } else {
      console.log(`${colors.red}Failed to reset configuration${colors.reset}`);
    }
  } else {
    console.log(`${colors.yellow}Reset cancelled${colors.reset}`);
  }
  
  await sleep(2000);
}

// Show main menu
async function showMainMenu() {
  while (true) {
    showHeader();
    
    // Show quick stats
    const sessions = await getSessions();
    const sessionCount = sessions.length;
    
    if (sessionCount > 0) {
      console.log(`${colors.cyan}Current status: ${colors.green}${sessionCount} active session(s)${colors.reset}`);
    } else {
      console.log(`${colors.cyan}Current status: ${colors.yellow}No active sessions${colors.reset}`);
    }
    
    console.log();
    console.log(`${colors.yellow}Main Menu:${colors.reset}`);
    console.log(`${colors.blue}─────────────────────────────────${colors.reset}`);
    console.log(`${colors.white}1)${colors.reset} Connect to existing sessions`);
    console.log(`${colors.white}2)${colors.reset} Create new session`);
    console.log(`${colors.white}3)${colors.reset} Edit session (rename/description)`);
    console.log(`${colors.white}4)${colors.reset} Delete session`);
    console.log(`${colors.white}5)${colors.reset} Configuration (optional project folders & preferences)`);
    console.log(`${colors.white}q)${colors.reset} Quit`);
    console.log();
    
    const choice = await question('Enter your choice: ');
    
    switch(choice) {
      case '1':
        currentPage = 0;
        await connectToSession();
        break;
      case '2':
        await createNewSession();
        break;
      case '3':
        currentPage = 0;
        await editSession();
        break;
      case '4':
        currentPage = 0;
        await deleteSession();
        break;
      case '5':
        await manageConfiguration();
        break;
      case 'q':
      case 'Q':
        console.log(`${colors.green}Goodbye!${colors.reset}`);
        process.exit(0);
      default:
        console.log(`${colors.red}Invalid option. Please choose 1, 2, 3, 4, 5, or q${colors.reset}`);
        await sleep(1000);
    }
  }
}

// Helper function for sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log();
  console.log(`${colors.green}Goodbye!${colors.reset}`);
  process.exit(0);
});

// Main execution
async function main() {
  await checkTmux();
  await checkClipboardTools();
  
  // Check if this is the first run after go-wingman
  if (isFirstRun()) {
    // First time setup flow
    const sessionsCreated = await setupProjectFolders();
    
    if (sessionsCreated) {
      // Sessions were created and user was connected automatically
      return;
    }
    
    // If we reach here, user didn't create sessions or declined to connect
    // Fall through to normal session management
  }
  
  // Detect project context for current directory
  await detectProjectContext();
  
  // Normal session management flow - always show full session list
  currentPage = 0;
  await connectToSession();
}

// Run the application
main().catch(error => {
  console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
  process.exit(1);
});
