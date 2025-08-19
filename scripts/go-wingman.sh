#!/bin/bash

# Wingman Idea Workflow - Quick Launcher
# This script provides easy access to the idea workflow

WINGMAN_ROOT="/Users/mini/code/wingman"
RECIPE_PATH="$WINGMAN_ROOT/recipes/user/wingman-idea-workflow.md"

echo "🚀 Wingman Idea Workflow Launcher"
echo "================================="
echo ""

# Check if we're in a git repository
if git rev-parse --git-dir > /dev/null 2>&1; then
    echo "📍 Current location: $(pwd)"
    echo "🌿 Git repository detected"
else
    echo "📍 Current location: $(pwd)"
    echo "⚠️  Not in a git repository"
fi

echo ""
echo "Choose workflow execution method:"
echo "1. Interactive Script (Node.js)"
echo "2. Goose Recipe (AI-assisted)"
echo "3. Manual Setup"
echo ""

read -p "Select option (1-3): " choice

case $choice in
    1)
        echo "🚀 Starting interactive workflow..."
        node "$WINGMAN_ROOT/scripts/idea-workflow.js"
        ;;
    2)
        echo "🤖 Starting Goose AI workflow..."
        if command -v goose &> /dev/null; then
            goose run "$RECIPE_PATH"
        else
            echo "❌ Goose not found. Please install Goose first."
            exit 1
        fi
        ;;
    3)
        echo "📋 Manual Setup Options:"
        echo ""
        echo "New Product:"
        echo "  $WINGMAN_ROOT/scripts/product-setup.sh <name> <type>"
        echo ""
        echo "Feature Worktree:"
        echo "  $WINGMAN_ROOT/scripts/feature-worktree-create.sh <feature> [base-branch] [product]"
        echo ""
        echo "Available scripts in: $WINGMAN_ROOT/scripts/"
        ;;
    *)
        echo "❌ Invalid option"
        exit 1
        ;;
esac
