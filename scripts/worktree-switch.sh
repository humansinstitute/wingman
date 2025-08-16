#!/bin/bash

WORKTREE_DIR=".worktrees"

if [ -z "$1" ]; then
    echo "Usage: ./scripts/worktree-switch.sh <branch-name>"
    echo "Available worktrees:"
    git worktree list
    exit 1
fi

TARGET="$WORKTREE_DIR/$1"

if [ -d "$TARGET" ]; then
    echo "Switching to worktree: $1"
    cd "$TARGET" && exec $SHELL
else
    echo "Worktree '$1' not found."
    echo "Available worktrees:"
    git worktree list
    exit 1
fi
