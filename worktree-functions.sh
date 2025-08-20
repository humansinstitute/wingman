#!/bin/bash
# Source this file to get worktree switching functions
# Usage: source worktree-functions.sh
#        Then use: wt [branch-name]

# Function to switch worktrees - this CAN change your current directory
wt() {
    local WORKTREE_DIR=".worktrees"
    
    # If no argument, show available worktrees
    if [ -z "$1" ]; then
        echo "Usage: wt <branch-name>"
        echo "Available worktrees:"
        git worktree list
        return 0
    fi
    
    # Handle special case for main branch
    if [ "$1" = "main" ]; then
        local git_root=$(git rev-parse --show-toplevel 2>/dev/null)
        if [ -n "$git_root" ]; then
            echo "Switching to main worktree: $git_root"
            cd "$git_root"
            return 0
        fi
    fi
    
    # Switch to requested worktree
    local target="$WORKTREE_DIR/$1"
    
    # Find the git root directory if path is relative
    if [ "${target#/}" = "$target" ]; then
        local git_root=$(git rev-parse --show-toplevel 2>/dev/null)
        if [ -z "$git_root" ]; then
            echo "Error: Not in a git repository"
            return 1
        fi
        target="$git_root/$target"
    fi
    
    if [ -d "$target" ]; then
        echo "Switching to worktree: $1 at $target"
        cd "$target"
        pwd
    else
        echo "Worktree '$1' not found at $target"
        echo "Available worktrees:"
        git worktree list
        return 1
    fi
}

# List all worktrees with status
wtl() {
    echo "Current worktrees:"
    echo "Current directory: $(pwd)"
    echo ""
    git worktree list
}

# Create a new worktree
wtc() {
    local WORKTREE_DIR=".worktrees"
    
    if [ -z "$1" ]; then
        echo "Usage: wtc <branch-name> [base-branch]"
        return 1
    fi
    
    local BRANCH_NAME="$1"
    local BASE_BRANCH="${2:-main}"
    
    local git_root=$(git rev-parse --show-toplevel 2>/dev/null)
    if [ -z "$git_root" ]; then
        echo "Error: Not in a git repository"
        return 1
    fi
    
    if git show-ref --quiet "refs/heads/$BRANCH_NAME"; then
        echo "Branch '$BRANCH_NAME' already exists."
        echo -n "Add worktree for existing branch? [y/N]: "
        read response
        if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
            git worktree add "$git_root/$WORKTREE_DIR/$BRANCH_NAME" "$BRANCH_NAME"
        fi
    else
        echo "Creating new branch '$BRANCH_NAME' from '$BASE_BRANCH'"
        git worktree add -b "$BRANCH_NAME" "$git_root/$WORKTREE_DIR/$BRANCH_NAME" "$BASE_BRANCH"
    fi
    
    echo "Worktree created at: $git_root/$WORKTREE_DIR/$BRANCH_NAME"
    echo -n "Switch to new worktree? [y/N]: "
    read response
    if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
        cd "$git_root/$WORKTREE_DIR/$BRANCH_NAME"
        pwd
    fi
}

# Delete a worktree
wtd() {
    if [ -z "$1" ]; then
        echo "Usage: wtd <branch-name>"
        echo "Available worktrees to delete:"
        git worktree list | grep -v "$(git rev-parse --show-toplevel)$"
        return 1
    fi
    
    local path=".worktrees/$1"
    local git_root=$(git rev-parse --show-toplevel 2>/dev/null)
    
    if [ "${path#/}" = "$path" ]; then
        path="$git_root/$path"
    fi
    
    if [ -d "$path" ]; then
        echo "Removing worktree: $1 at $path"
        git worktree remove "$path" --force
        echo "Worktree removed successfully"
    else
        echo "Worktree '$1' not found"
        return 1
    fi
}

# Show help for worktree functions
wth() {
    echo "Worktree helper functions:"
    echo "  wt <branch>   - Switch to worktree (changes current directory)"
    echo "  wt            - List available worktrees"
    echo "  wtl           - List all worktrees with details"
    echo "  wtc <branch>  - Create new worktree"
    echo "  wtd <branch>  - Delete worktree"
    echo "  wth           - Show this help"
    echo ""
    echo "Example:"
    echo "  wt prov       - Switch to prov branch worktree"
    echo "  wt main       - Switch back to main branch"
    echo ""
    echo "Available worktrees:"
    git worktree list 2>/dev/null | while IFS= read -r line; do
        if echo "$line" | grep -q "$(pwd)"; then
            echo "  * ${line} (current)"
        else
            echo "    ${line}"
        fi
    done
}

echo "Worktree functions loaded! Type 'wth' for help."