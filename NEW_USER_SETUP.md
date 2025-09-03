# New User Setup Guide

Welcome to Wingman! This guide will help you set up your local environment after cloning the repository.

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Set Your Code Directory**
   ```bash
   # If your projects are in ~/code (default), skip this step
   # Otherwise, set your custom path:
   export WINGMAN_CODE_PATH=/path/to/your/projects
   
   # Make it permanent by adding to your shell profile:
   echo 'export WINGMAN_CODE_PATH=/path/to/your/projects' >> ~/.bashrc  # or ~/.zshrc
   ```

3. **Copy Configuration Templates**
   ```bash
   # Create your personal configuration directory
   mkdir -p ~/.wingman

   # Copy environment template
   cp templates/mcp-servers/.env.example ~/.wingman/.env
   
   # Copy scheduler config template (optional)
   cp scheduler/config.example.json ~/.wingman/scheduler-config.json
   ```

4. **Configure API Keys** (optional)
   Edit `~/.wingman/.env` and add your API keys for services you want to use:
   ```bash
   nano ~/.wingman/.env
   ```

5. **Start the Application**
   ```bash
   # Web interface with scheduler
   npm run web
   
   # CLI interface
   npm run cli
   
   # Just the scheduler
   npm run scheduler
   ```

## What Gets Created

When you first run Wingman, it creates:

- `~/.wingman/.env` - Your API keys and environment variables (keep this secure!)
- `~/.wingman/scheduler-config.json` - Your scheduled task configuration
- `~/.wingman/mcp-servers/` - Your MCP server configurations
- `~/.wingman/recipes/` - Your personal AI agent recipes

## Customizing Recipes

1. **Copy Example Recipes**
   ```bash
   cp templates/recipes/planner.example.json ~/.wingman/recipes/planner.json
   cp templates/recipes/writing-assistant.example.json ~/.wingman/recipes/writing-assistant.json
   ```

2. **Edit Recipe Paths**
   Update the `instructions` field in your recipes to match your directory structure.

## Environment Variables

### Required
- `WINGMAN_CODE_PATH` - Path to your projects directory (defaults to `~/code`)

### Optional (add to `~/.wingman/.env`)
- `OBSIDIAN_API_KEY` - For Obsidian integration
- `TAVILY_API_KEY` - For web search
- `BRAVE_API_KEY` - For Brave search
- `GITHUB_PERSONAL_ACCESS_TOKEN` - For GitHub integration

## Troubleshooting

### "MCP server failed to start"
- Check that `WINGMAN_CODE_PATH` points to an existing directory
- Verify filesystem permissions on your code directory

### "Configuration file not found"
- Make sure you copied the templates to `~/.wingman/`
- Check file paths and permissions

### "Recipe not found"
- Copy example recipes from `templates/recipes/` to `~/.wingman/recipes/`
- Update recipe paths to match your setup

## Security Notes

- Never commit files in `~/.wingman/` to version control
- Keep your `.env` file secure (it contains API keys)
- The `.gitignore` is configured to exclude user-specific data

## Need Help?

- Check the main [README.md](README.md) for detailed documentation
- Review [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md) for advanced configuration
- File issues at: https://github.com/your-repo/wingman/issues