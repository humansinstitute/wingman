#!/usr/bin/env node

/**
 * Wingman Idea Workflow - Main Execution Script
 * Handles idea recording, classification, and project setup
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Configuration
const WINGMAN_ROOT = '/Users/mini/code/wingman';
const OBSIDIAN_VAULT = '/Users/mini/Documents/Obsidian Vault'; // Adjust as needed
const CODE_ROOT = '/Users/mini/code';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

class IdeaWorkflow {
  constructor() {
    this.idea = {};
    this.classification = null;
    this.setupResult = null;
  }

  async run() {
    console.log('🚀 Wingman Idea Workflow');
    console.log('========================\n');

    try {
      await this.captureIdea();
      await this.classifyIdea();
      await this.setupEnvironment();
      await this.createDocumentation();
      await this.generatePlan();
      
      console.log('\n✅ Workflow completed successfully!');
      this.displaySummary();
      
    } catch (error) {
      console.error('❌ Workflow failed:', error.message);
      process.exit(1);
    } finally {
      rl.close();
    }
  }

  async captureIdea() {
    console.log('📝 Step 1: Idea Capture');
    console.log('----------------------\n');

    this.idea.name = await question('💡 What is your idea? (Brief name): ');
    this.idea.description = await question('📖 Describe your idea in detail: ');
    this.idea.motivation = await question('🎯 What problem does this solve?: ');
    this.idea.target_audience = await question('👥 Who is the target audience?: ');
    this.idea.priority = await question('⭐ Priority (high/medium/low): ');
    
    console.log('\n✅ Idea captured successfully!\n');
  }

  async classifyIdea() {
    console.log('🔍 Step 2: Idea Classification');
    console.log('------------------------------\n');

    console.log('Please classify your idea:');
    console.log('1. New Product (standalone application/service)');
    console.log('2. Existing Product Feature (enhancement to existing project)');
    console.log('3. Research/Exploration (prototype or investigation)');
    
    const choice = await question('\nSelect option (1-3): ');
    
    switch (choice) {
      case '1':
        this.classification = 'new-product';
        this.idea.product_type = await question('Product type (webapp/cli/service/library): ');
        break;
      case '2':
        this.classification = 'existing-feature';
        this.idea.existing_product = await question('Which existing product?: ');
        this.idea.feature_scope = await question('Feature scope (small/medium/large): ');
        break;
      case '3':
        this.classification = 'research';
        this.idea.research_type = await question('Research type (prototype/investigation/poc): ');
        break;
      default:
        throw new Error('Invalid classification choice');
    }

    console.log(`\n✅ Classified as: ${this.classification}\n`);
  }

  async setupEnvironment() {
    console.log('⚙️  Step 3: Environment Setup');
    console.log('----------------------------\n');

    switch (this.classification) {
      case 'new-product':
        await this.setupNewProduct();
        break;
      case 'existing-feature':
        await this.setupFeatureWorktree();
        break;
      case 'research':
        await this.setupResearchEnvironment();
        break;
    }

    console.log('\n✅ Environment setup completed!\n');
  }

  async setupNewProduct() {
    const safeName = this.idea.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const productType = this.idea.product_type || 'webapp';
    
    console.log(`🏗️  Creating new product: ${this.idea.name}`);
    
    try {
      const command = `${WINGMAN_ROOT}/scripts/product-setup.sh "${safeName}" "${productType}"`;
      execSync(command, { stdio: 'inherit' });
      
      this.setupResult = {
        type: 'new-product',
        path: `${CODE_ROOT}/${safeName}`,
        name: safeName
      };
    } catch (error) {
      throw new Error(`Failed to create new product: ${error.message}`);
    }
  }

  async setupFeatureWorktree() {
    const safeName = this.idea.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const productPath = `${CODE_ROOT}/${this.idea.existing_product}`;
    
    if (!fs.existsSync(productPath)) {
      throw new Error(`Product directory not found: ${productPath}`);
    }
    
    console.log(`🌿 Creating feature worktree: ${this.idea.name}`);
    
    try {
      process.chdir(productPath);
      const command = `${WINGMAN_ROOT}/scripts/feature-worktree-create.sh "${safeName}" main "${this.idea.existing_product}"`;
      execSync(command, { stdio: 'inherit' });
      
      this.setupResult = {
        type: 'feature-worktree',
        path: `${productPath}/.worktrees/${safeName}`,
        product: this.idea.existing_product,
        branch: `feature/${safeName}`
      };
    } catch (error) {
      throw new Error(`Failed to create feature worktree: ${error.message}`);
    }
  }

  async setupResearchEnvironment() {
    const safeName = this.idea.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const researchPath = `${CODE_ROOT}/research/${safeName}`;
    
    console.log(`🔬 Creating research environment: ${this.idea.name}`);
    
    try {
      fs.mkdirSync(researchPath, { recursive: true });
      
      // Create basic research structure
      fs.mkdirSync(`${researchPath}/docs`);
      fs.mkdirSync(`${researchPath}/experiments`);
      fs.mkdirSync(`${researchPath}/prototypes`);
      
      // Create README
      const readme = `# ${this.idea.name} - Research Project

${this.idea.description}

## Motivation
${this.idea.motivation}

## Research Type
${this.idea.research_type}

## Structure
- \`docs/\` - Research documentation
- \`experiments/\` - Code experiments
- \`prototypes/\` - Working prototypes

## Progress
- [x] Initial setup
- [ ] Research phase
- [ ] Experimentation
- [ ] Prototype development
- [ ] Conclusions
`;
      
      fs.writeFileSync(`${researchPath}/README.md`, readme);
      
      this.setupResult = {
        type: 'research',
        path: researchPath,
        name: safeName
      };
    } catch (error) {
      throw new Error(`Failed to create research environment: ${error.message}`);
    }
  }

  async createDocumentation() {
    console.log('📚 Step 4: Documentation Creation');
    console.log('--------------------------------\n');

    // This would integrate with Obsidian MCP
    // For now, creating basic documentation structure
    console.log('📝 Creating Obsidian documentation...');
    
    // Create idea record
    const ideaRecord = {
      name: this.idea.name,
      description: this.idea.description,
      classification: this.classification,
      created: new Date().toISOString(),
      setupResult: this.setupResult
    };
    
    // Save to temp file for Obsidian integration
    const tempFile = `/tmp/wingman-idea-${Date.now()}.json`;
    fs.writeFileSync(tempFile, JSON.stringify(ideaRecord, null, 2));
    
    console.log(`💾 Idea record saved to: ${tempFile}`);
    console.log('✅ Documentation structure created!\n');
  }

  async generatePlan() {
    console.log('📋 Step 5: Development Plan Generation');
    console.log('------------------------------------\n');

    const planFile = `${this.setupResult.path}/DEVELOPMENT_PLAN.md`;
    
    const plan = `# Development Plan: ${this.idea.name}

## Overview
${this.idea.description}

## Classification
**Type:** ${this.classification}
**Priority:** ${this.idea.priority}
**Target Audience:** ${this.idea.target_audience}

## Motivation
${this.idea.motivation}

## Implementation Phases

### Phase 1: Planning & Design (Week 1)
- [ ] Detailed requirements gathering
- [ ] Technical architecture design
- [ ] UI/UX mockups (if applicable)
- [ ] Technology stack selection
- [ ] Resource planning

### Phase 2: Foundation (Week 2-3)
- [ ] Project setup and scaffolding
- [ ] Core architecture implementation
- [ ] Basic functionality framework
- [ ] Testing infrastructure setup

### Phase 3: Core Development (Week 4-6)
- [ ] Primary feature implementation
- [ ] Core business logic
- [ ] Data layer implementation
- [ ] API development (if applicable)

### Phase 4: Integration & Testing (Week 7)
- [ ] Integration testing
- [ ] Performance optimization
- [ ] Security review
- [ ] User acceptance testing

### Phase 5: Deployment & Launch (Week 8)
- [ ] Production deployment setup
- [ ] Documentation completion
- [ ] Launch preparation
- [ ] Post-launch monitoring

## Success Criteria
- [ ] Meets all core requirements
- [ ] Passes all tests
- [ ] Performance benchmarks met
- [ ] Security requirements satisfied
- [ ] Documentation complete

## Resources Required
- Development time: ~8 weeks
- Technologies: [To be defined]
- External dependencies: [To be identified]

## Risks & Mitigation
- **Risk 1:** [To be identified]
  - *Mitigation:* [Strategy]

---
*Generated by Wingman Idea Workflow on ${new Date().toLocaleDateString()}*
`;

    try {
      fs.writeFileSync(planFile, plan);
      console.log(`📋 Development plan created: ${planFile}`);
    } catch (error) {
      console.log(`⚠️  Could not create plan file: ${error.message}`);
    }
    
    console.log('✅ Development plan generated!\n');
  }

  displaySummary() {
    console.log('\n📊 Workflow Summary');
    console.log('==================\n');
    
    console.log(`💡 Idea: ${this.idea.name}`);
    console.log(`🏷️  Classification: ${this.classification}`);
    console.log(`📁 Location: ${this.setupResult.path}`);
    
    if (this.setupResult.type === 'feature-worktree') {
      console.log(`🌿 Branch: ${this.setupResult.branch}`);
      console.log(`📦 Product: ${this.setupResult.product}`);
    }
    
    console.log('\n🚀 Next Steps:');
    console.log(`   1. cd ${this.setupResult.path}`);
    console.log('   2. Review the development plan');
    console.log('   3. Start implementing!');
    console.log('\n💡 Happy coding with Wingman! 🎯');
  }
}

// Run the workflow
if (require.main === module) {
  const workflow = new IdeaWorkflow();
  workflow.run().catch(console.error);
}

module.exports = IdeaWorkflow;
