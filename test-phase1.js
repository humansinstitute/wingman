#!/usr/bin/env node

/**
 * Phase 1 Test Script - Scheduler UI and In-Process API
 * Tests Work Packages 1.1, 1.2, and 1.3
 * 
 * Usage: node test-phase1.js
 */

const SchedulerService = require('./lib/scheduler/scheduler-service');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class Phase1Tester {
  constructor() {
    this.testResults = [];
    this.configPath = path.join(process.env.HOME, '.wingman', 'scheduler-config.json');
  }

  async runAllTests() {
    console.log('🧪 Phase 1 Test Suite - Scheduler Foundation & Service Architecture\n');
    
    try {
      await this.testWorkPackage11();
      await this.testWorkPackage12();
      await this.testWorkPackage13();
      
      this.printSummary();
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }
  }

  async testWorkPackage11() {
    console.log('📦 Testing Work Package 1.1: SchedulerService Core Module');
    console.log('=' .repeat(60));

    // Test 1.1.1: Module Import
    await this.test('1.1.1', 'SchedulerService module imports correctly', async () => {
      const SchedulerService = require('./lib/scheduler/scheduler-service');
      if (typeof SchedulerService !== 'function') {
        throw new Error('SchedulerService is not a constructor function');
      }
      return true;
    });

    // Test 1.1.2: Service Instantiation
    await this.test('1.1.2', 'Service instantiates without errors', async () => {
      const service = new SchedulerService();
      if (!service) {
        throw new Error('Failed to instantiate SchedulerService');
      }
      return true;
    });

    // Test 1.1.3: Required Methods Present
    await this.test('1.1.3', 'All required API methods are present', async () => {
      const service = new SchedulerService();
      const requiredMethods = ['start', 'stop', 'reload', 'listTasks', 'getStatus', 'runNow', 'getHistory'];
      
      for (const method of requiredMethods) {
        if (typeof service[method] !== 'function') {
          throw new Error(`Missing method: ${method}`);
        }
      }
      return true;
    });

    // Test 1.1.4: Service Start/Stop
    await this.test('1.1.4', 'Service starts and stops without errors', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const status = service.getStatus();
      if (!status.running) {
        throw new Error('Service did not start properly');
      }
      
      service.stop();
      
      const statusAfterStop = service.getStatus();
      if (statusAfterStop.running) {
        throw new Error('Service did not stop properly');
      }
      return true;
    });

    // Test 1.1.5: Configuration Loading
    await this.test('1.1.5', 'Service loads configuration correctly', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const tasks = service.listTasks();
      if (!Array.isArray(tasks)) {
        throw new Error('listTasks() did not return an array');
      }
      
      service.stop();
      return true;
    });

    console.log();
  }

  async testWorkPackage12() {
    console.log('📦 Testing Work Package 1.2: CLI Wrapper');
    console.log('=' .repeat(60));

    // Test 1.2.1: CLI Script Exists
    await this.test('1.2.1', 'CLI wrapper script exists', async () => {
      const cliPath = './scheduler/schedule.js';
      if (!fs.existsSync(cliPath)) {
        throw new Error('CLI wrapper script not found');
      }
      return true;
    });

    // Test 1.2.2: CLI Can Start (Quick Test)
    await this.test('1.2.2', 'CLI wrapper can start scheduler service', async () => {
      return new Promise((resolve, reject) => {
        const child = spawn('node', ['scheduler/schedule.js'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let hasStarted = false;

        child.stdout.on('data', (data) => {
          output += data.toString();
          if (output.includes('Scheduler service started')) {
            hasStarted = true;
            child.kill('SIGTERM');
          }
        });

        child.on('exit', () => {
          if (hasStarted) {
            resolve(true);
          } else {
            reject(new Error('Scheduler did not start properly. Output: ' + output));
          }
        });

        child.on('error', (error) => {
          reject(error);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('CLI test timed out'));
        }, 10000);
      });
    });

    // Test 1.2.3: Module Export Compatibility
    await this.test('1.2.3', 'CLI wrapper maintains module export compatibility', async () => {
      const cliModule = require('./scheduler/schedule.js');
      if (!cliModule || !cliModule.SchedulerService) {
        throw new Error('CLI wrapper does not export SchedulerService');
      }
      return true;
    });

    console.log();
  }

  async testWorkPackage13() {
    console.log('📦 Testing Work Package 1.3: Next Run Time Computation');
    console.log('=' .repeat(60));

    // Test 1.3.1: Next Run Times in Task List
    await this.test('1.3.1', 'listTasks() includes nextRuns array', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const tasks = service.listTasks();
      
      for (const task of tasks) {
        if (!Array.isArray(task.nextRuns)) {
          service.stop();
          throw new Error(`Task ${task.id} does not have nextRuns array`);
        }
        
        if (task.enabled && task.nextRuns.length === 0) {
          service.stop();
          throw new Error(`Enabled task ${task.id} has empty nextRuns array`);
        }
      }
      
      service.stop();
      return true;
    });

    // Test 1.3.2: Next Run Time Format
    await this.test('1.3.2', 'Next run times are properly formatted', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const tasks = service.listTasks();
      const timeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} .+$/;
      
      for (const task of tasks) {
        if (task.enabled && task.nextRuns.length > 0) {
          for (const nextRun of task.nextRuns) {
            if (!timeRegex.test(nextRun)) {
              service.stop();
              throw new Error(`Invalid time format for task ${task.id}: ${nextRun}`);
            }
          }
        }
      }
      
      service.stop();
      return true;
    });

    // Test 1.3.3: Three Future Runs
    await this.test('1.3.3', 'Enabled tasks show exactly 3 future run times', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const tasks = service.listTasks();
      
      for (const task of tasks) {
        if (task.enabled) {
          if (task.nextRuns.length !== 3) {
            service.stop();
            throw new Error(`Task ${task.id} should have exactly 3 next runs, got ${task.nextRuns.length}`);
          }
        }
      }
      
      service.stop();
      return true;
    });

    // Test 1.3.4: Chronological Order
    await this.test('1.3.4', 'Next run times are in chronological order', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const tasks = service.listTasks();
      
      for (const task of tasks) {
        if (task.enabled && task.nextRuns.length >= 2) {
          const time1 = new Date(task.nextRuns[0]);
          const time2 = new Date(task.nextRuns[1]);
          
          if (time1 >= time2) {
            service.stop();
            throw new Error(`Task ${task.id} next runs not in chronological order`);
          }
        }
      }
      
      service.stop();
      return true;
    });

    // Test 1.3.5: Backward Compatibility
    await this.test('1.3.5', 'Legacy nextRun field still present', async () => {
      const service = new SchedulerService();
      await service.start();
      
      const tasks = service.listTasks();
      
      for (const task of tasks) {
        if (task.enabled && typeof task.nextRun === 'undefined') {
          service.stop();
          throw new Error(`Task ${task.id} missing legacy nextRun field`);
        }
      }
      
      service.stop();
      return true;
    });

    console.log();
  }

  async test(id, description, testFn) {
    process.stdout.write(`  ${id}: ${description}... `);
    
    try {
      const result = await testFn();
      console.log('✅ PASS');
      this.testResults.push({ id, description, status: 'PASS' });
      return result;
    } catch (error) {
      console.log('❌ FAIL');
      console.log(`      Error: ${error.message}`);
      this.testResults.push({ id, description, status: 'FAIL', error: error.message });
      throw error;
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PHASE 1 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const total = this.testResults.length;

    console.log(`\nTotal Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`   ${r.id}: ${r.description} - ${r.error}`));
      
      console.log('\n🚨 Phase 1 implementation has FAILED tests. Please fix before proceeding to Phase 2.');
      process.exit(1);
    } else {
      console.log('\n🎉 ALL TESTS PASSED! Phase 1 implementation is complete and ready.');
      console.log('\n📋 Work Packages Validated:');
      console.log('   ✅ 1.1: Refactor SchedulerService Core Module');
      console.log('   ✅ 1.2: Create CLI Wrapper for Backward Compatibility');
      console.log('   ✅ 1.3: Add Next Run Time Computation');
      
      console.log('\n🚀 Ready to proceed to Phase 2: History & Persistence');
    }
  }
}

// Run the tests
if (require.main === module) {
  const tester = new Phase1Tester();
  tester.runAllTests().catch(console.error);
}

module.exports = Phase1Tester;