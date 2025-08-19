#!/bin/bash

# Wingman Product Suite Setup Script
# Creates a new product structure following Wingman conventions

set -e

PRODUCT_NAME="$1"
PRODUCT_TYPE="${2:-webapp}"  # webapp, cli, service, library
BASE_DIR="/Users/mini/code"

if [ -z "$PRODUCT_NAME" ]; then
    echo "Usage: $0 <product-name> [product-type]"
    echo "Product types: webapp, cli, service, library"
    echo "Example: $0 my-new-app webapp"
    exit 1
fi

# Sanitize product name for directory/file names
SAFE_NAME=$(echo "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g')

PRODUCT_DIR="$BASE_DIR/$SAFE_NAME"

echo "🚀 Creating new product: $PRODUCT_NAME"
echo "📁 Directory: $PRODUCT_DIR"
echo "🔧 Type: $PRODUCT_TYPE"

# Check if directory already exists
if [ -d "$PRODUCT_DIR" ]; then
    echo "❌ Error: Directory $PRODUCT_DIR already exists"
    exit 1
fi

# Create main product directory
mkdir -p "$PRODUCT_DIR"
cd "$PRODUCT_DIR"

# Initialize git repository
git init
echo "# $PRODUCT_NAME" > README.md
echo "" >> README.md
echo "A new product created with Wingman workflow." >> README.md

# Create standard directory structure
mkdir -p {src,tests,docs,scripts,config}
mkdir -p .worktrees

# Create basic files based on product type
case "$PRODUCT_TYPE" in
    "webapp")
        echo "Creating webapp structure..."
        mkdir -p {public,src/{components,pages,utils},tests/{unit,integration}}
        
        # Create package.json for webapp
        cat > package.json << EOF
{
  "name": "$SAFE_NAME",
  "version": "0.1.0",
  "description": "$PRODUCT_NAME - A Wingman product",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "jest",
    "build": "webpack --mode=production"
  },
  "keywords": ["wingman", "$PRODUCT_TYPE"],
  "author": "Wingman",
  "license": "MIT"
}
EOF
        
        # Create basic index file
        cat > src/index.js << EOF
// $PRODUCT_NAME
// Created with Wingman workflow

console.log('🚀 $PRODUCT_NAME starting...');

// Your webapp code here
EOF
        ;;
        
    "cli")
        echo "Creating CLI structure..."
        mkdir -p {bin,src/{commands,utils},tests}
        
        cat > package.json << EOF
{
  "name": "$SAFE_NAME",
  "version": "0.1.0",
  "description": "$PRODUCT_NAME - A Wingman CLI tool",
  "main": "src/index.js",
  "bin": {
    "$SAFE_NAME": "bin/cli.js"
  },
  "scripts": {
    "start": "node bin/cli.js",
    "test": "jest"
  },
  "keywords": ["wingman", "cli", "$PRODUCT_TYPE"],
  "author": "Wingman",
  "license": "MIT"
}
EOF

        cat > bin/cli.js << EOF
#!/usr/bin/env node

// $PRODUCT_NAME CLI
// Created with Wingman workflow

const program = require('commander');

program
  .version('0.1.0')
  .description('$PRODUCT_NAME - A Wingman CLI tool');

program
  .command('hello')
  .description('Say hello')
  .action(() => {
    console.log('Hello from $PRODUCT_NAME! 🚀');
  });

program.parse(process.argv);
EOF
        chmod +x bin/cli.js
        ;;
        
    "service")
        echo "Creating service structure..."
        mkdir -p {src/{api,services,models},tests,config}
        
        cat > package.json << EOF
{
  "name": "$SAFE_NAME",
  "version": "0.1.0",
  "description": "$PRODUCT_NAME - A Wingman service",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest"
  },
  "keywords": ["wingman", "service", "$PRODUCT_TYPE"],
  "author": "Wingman",
  "license": "MIT"
}
EOF
        ;;
        
    "library")
        echo "Creating library structure..."
        mkdir -p {src,tests,examples}
        
        cat > package.json << EOF
{
  "name": "$SAFE_NAME",
  "version": "0.1.0",
  "description": "$PRODUCT_NAME - A Wingman library",
  "main": "src/index.js",
  "scripts": {
    "test": "jest",
    "build": "babel src -d lib"
  },
  "keywords": ["wingman", "library", "$PRODUCT_TYPE"],
  "author": "Wingman",
  "license": "MIT"
}
EOF
        ;;
esac

# Create common files
cat > .env.example << EOF
# Environment variables for $PRODUCT_NAME
NODE_ENV=development
PORT=3000
EOF

cat > .gitignore << EOF
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Build outputs
dist/
build/
lib/

# Logs
logs/
*.log

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Wingman specific
.worktrees/
temp/
EOF

# Create worktree management scripts
cp /Users/mini/code/wingman/scripts/worktree-*.sh scripts/ 2>/dev/null || echo "Note: Worktree scripts not found, skipping copy"

# Create initial commit
git add .
git commit -m "🎉 Initial commit for $PRODUCT_NAME

Created with Wingman product setup workflow.
Product type: $PRODUCT_TYPE"

echo ""
echo "✅ Product setup complete!"
echo "📁 Location: $PRODUCT_DIR"
echo "🔗 Git repository initialized"
echo "📝 Next steps:"
echo "   1. cd $PRODUCT_DIR"
echo "   2. Review and customize the generated structure"
echo "   3. Install dependencies: npm install"
echo "   4. Start developing!"
echo ""
echo "🚀 Happy coding with Wingman!"
