#!/bin/bash

# Wingman Alias Setup Script
# Creates convenient aliases for the idea workflow system

WINGMAN_ROOT="/Users/mini/code/wingman"
SHELL_CONFIG=""

# Detect shell and config file
if [[ $SHELL == *"zsh"* ]]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [[ $SHELL == *"bash"* ]]; then
    SHELL_CONFIG="$HOME/.bashrc"
    # Also check for .bash_profile on macOS
    if [[ ! -f "$SHELL_CONFIG" ]] && [[ -f "$HOME/.bash_profile" ]]; then
        SHELL_CONFIG="$HOME/.bash_profile"
    fi
else
    echo "⚠️  Unsupported shell: $SHELL"
    echo "Please manually add the aliases to your shell configuration."
    exit 1
fi

echo "🔧 Setting up Wingman aliases..."
echo "Shell config: $SHELL_CONFIG"
echo ""

# Create backup of existing config
if [[ -f "$SHELL_CONFIG" ]]; then
    cp "$SHELL_CONFIG" "$SHELL_CONFIG.backup.$(date +%Y%m%d_%H%M%S)"
    echo "📄 Created backup: $SHELL_CONFIG.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Check if Wingman aliases already exist
if grep -q "# Wingman Idea Workflow Aliases" "$SHELL_CONFIG" 2>/dev/null; then
    echo "⚠️  Wingman aliases already exist in $SHELL_CONFIG"
    read -p "Replace existing aliases? [y/N]: " response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "❌ Setup cancelled"
        exit 0
    fi
    
    # Remove existing Wingman section
    sed -i.bak '/# Wingman Idea Workflow Aliases/,/# End Wingman Aliases/d' "$SHELL_CONFIG"
fi

# Add Wingman aliases
cat >> "$SHELL_CONFIG" << EOF

# Wingman Idea Workflow Aliases
# Generated on $(date)

# Main launcher - interactive menu system
alias go-wingman='node "$WINGMAN_ROOT/scripts/wingman-idea-launcher.js"'

# Quick access to individual scripts
alias wingman-new-product='$WINGMAN_ROOT/scripts/product-setup.sh'
alias wingman-new-feature='$WINGMAN_ROOT/scripts/feature-worktree-create.sh'
alias wingman-interactive='node $WINGMAN_ROOT/scripts/idea-workflow.js'

# Goose recipe shortcuts
alias wingman-recipe='goose run "$WINGMAN_ROOT/recipes/user/wingman-idea-workflow-recipe.md"'
alias wingman-goose='cd "$WINGMAN_ROOT" && goose run "recipes/user/wingman-idea-workflow-recipe.md"'

# Utility aliases
alias wingman-status='node "$WINGMAN_ROOT/scripts/wingman-idea-launcher.js" --status'
alias wingman-help='node "$WINGMAN_ROOT/scripts/wingman-idea-launcher.js" --help'

# Git worktree helpers
alias wt-list='git worktree list'
alias wt-create='$WINGMAN_ROOT/scripts/feature-worktree-create.sh'
alias wt-remove='git worktree remove'

# Quick navigation to Wingman projects
alias cd-wingman='cd "$WINGMAN_ROOT"'
alias cd-projects='cd "/Users/mini/code"'

# End Wingman Aliases

EOF

echo "✅ Wingman aliases added to $SHELL_CONFIG"
echo ""
echo "🎯 Available aliases:"
echo "  go-wingman              - Main launcher (recommended)"
echo "  wingman-new-product     - Create new product"
echo "  wingman-new-feature     - Create feature worktree"
echo "  wingman-interactive     - Interactive Node.js workflow"
echo "  wingman-recipe          - Run Goose recipe"
echo "  wingman-goose           - Run Goose recipe from Wingman directory"
echo ""
echo "🔧 Utility aliases:"
echo "  wingman-status          - Check system status"
echo "  wingman-help            - Show help"
echo "  wt-list                 - List git worktrees"
echo "  wt-create               - Create worktree"
echo "  wt-remove               - Remove worktree"
echo "  cd-wingman              - Navigate to Wingman root"
echo "  cd-projects             - Navigate to projects directory"
echo ""
echo "🚀 To activate the aliases, run:"
echo "   source $SHELL_CONFIG"
echo ""
echo "   Or restart your terminal session."
echo ""
echo "💡 Quick start: Run 'go-wingman' to begin!"
