#!/bin/bash

WORKTREE_DIR=".worktrees"

if [ -z "$1" ]; then
    echo "Usage: ./scripts/worktree-create.sh <branch-name> [base-branch]"
    exit 1
fi

BRANCH_NAME="$1"
BASE_BRANCH="${2:-main}"

if git show-ref --quiet "refs/heads/$BRANCH_NAME"; then
    echo "Branch '$BRANCH_NAME' already exists."
    read -p "Add worktree for existing branch? [y/N]: " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        git worktree add "$WORKTREE_DIR/$BRANCH_NAME" "$BRANCH_NAME"
    fi
else
    echo "Creating new branch '$BRANCH_NAME' from '$BASE_BRANCH'"
    git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR/$BRANCH_NAME" "$BASE_BRANCH"
fi

echo "Worktree created at: $WORKTREE_DIR/$BRANCH_NAME"
