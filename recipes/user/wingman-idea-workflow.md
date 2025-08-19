# Wingman Idea Workflow Recipe

You are executing the Wingman Idea Workflow - a comprehensive system for recording new ideas, classifying them, and setting up appropriate development environments.

## Workflow Overview

This workflow handles three types of ideas:
1. **New Product** - Standalone applications/services requiring new product setup
2. **Existing Product Feature** - Enhancements to existing products using git worktrees
3. **Research/Exploration** - Prototypes and investigations

## Your Tasks

### 1. Idea Capture & Classification
- Interview the user about their idea
- Capture: name, description, motivation, target audience, priority
- Classify the idea type
- Determine specific requirements based on classification

### 2. Environment Setup
Based on classification:
- **New Product**: Use `/Users/mini/code/wingman/scripts/product-setup.sh`
- **Feature**: Use `/Users/mini/code/wingman/scripts/feature-worktree-create.sh` 
- **Research**: Create research directory structure

### 3. Obsidian Documentation
- Create structured documentation in the Obsidian vault
- Link to appropriate product/feature folders
- Setup cross-references and tags

### 4. Development Planning
- Generate development roadmap
- Create task checklists
- Setup project tracking

## Tools Available

- **Obsidian MCP**: For documentation management
- **Developer Tools**: For script execution and file management  
- **Shell Commands**: For git operations and directory setup

## Process Flow

1. Start with idea capture questions
2. Guide user through classification
3. Execute appropriate setup scripts
4. Create Obsidian documentation structure
5. Generate development plan
6. Provide next steps summary

## Key Files

- Product Setup: `/Users/mini/code/wingman/scripts/product-setup.sh`
- Feature Setup: `/Users/mini/code/wingman/scripts/feature-worktree-create.sh`
- Workflow Script: `/Users/mini/code/wingman/scripts/idea-workflow.js`

## Success Criteria

- Idea properly documented
- Appropriate development environment created
- Obsidian documentation structure established
- Development plan generated
- User has clear next steps

Begin by asking the user about their idea and guiding them through the workflow.
