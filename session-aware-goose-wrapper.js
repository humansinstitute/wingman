const StreamingGooseCLIWrapper = require('./goose-cli-wrapper-streaming');
const EventEmitter = require('events');

class SessionAwareGooseCLIWrapper extends StreamingGooseCLIWrapper {
  constructor(options = {}) {
    super(options);
    
    this.sessionId = options.sessionId || this.generateId();
    this.sessionName = options.sessionName || this.options.sessionName;
    this.metadata = {
      startTime: null,
      messageCount: 0,
      toolUsage: {},
      performanceMetrics: {},
      errorCount: 0,
      lastActivity: null
    };
    
    // Initialize analytics tracking
    this.analytics = {
      sessionStartTime: null,
      resourceUsage: {
        memoryUsage: 0,
        cpuUsage: 0
      }
    };
  }

  generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  async start() {
    this.metadata.startTime = new Date().toISOString();
    this.analytics.sessionStartTime = Date.now();
    this.metadata.lastActivity = new Date().toISOString();
    
    // Call parent start method
    const result = await super.start();
    
    // Record session start metric
    this.recordMetric('session_started', { timestamp: Date.now() });
    
    return result;
  }

  async sendMessage(message) {
    const result = await super.sendMessage(message);
    
    // Track message sending
    this.metadata.messageCount++;
    this.metadata.lastActivity = new Date().toISOString();
    this.recordMetric('message_sent', { 
      timestamp: Date.now(),
      messageLength: message.length 
    });
    
    return result;
  }

  async interrupt() {
    console.log(`🛑 Interrupting session ${this.sessionId}`);
    
    this.recordMetric('session_interrupted', { 
      timestamp: Date.now(),
      sessionId: this.sessionId 
    });
    
    return await super.interrupt();
  }

  async forceStop() {
    console.log(`🔥 Force stopping session ${this.sessionId}`);
    
    this.recordMetric('session_force_stopped', { 
      timestamp: Date.now(),
      sessionId: this.sessionId 
    });
    
    return await super.forceStop();
  }

  async resumeSession(sessionName) {
    // Use EXACT main branch resume pattern for 100% reliability
    this.options.sessionName = sessionName;
    this.sessionName = sessionName;
    
    const args = ['session', '--resume', '--name', sessionName];
    
    if (this.options.debug) {
      args.push('--debug');
    }
    
    console.log(`Resuming session: goose ${args.join(' ')}`);
    
    // Record resume attempt
    this.recordMetric('session_resume_attempt', { 
      sessionName, 
      timestamp: Date.now() 
    });
    
    // Use the exact same start() method to ensure consistency
    return this.start();
  }

  recordMetric(metricType, data) {
    const timestamp = Date.now();
    
    switch (metricType) {
      case 'message_sent':
        this.metadata.messageCount++;
        break;
      case 'tool_used':
        this.metadata.toolUsage[data.toolName] = (this.metadata.toolUsage[data.toolName] || 0) + 1;
        break;
      case 'error_occurred':
        this.metadata.errorCount++;
        break;
      case 'working_directory_changed':
        this.metadata.workingDirectory = data.newDirectory;
        break;
    }
    
    this.metadata.lastActivity = new Date().toISOString();
    
    // Emit metric for external collection
    this.emit('metricRecorded', {
      sessionId: this.sessionId,
      sessionName: this.sessionName,
      metricType,
      data,
      timestamp
    });
  }

  handleOutput(data) {
    // Call parent method first
    super.handleOutput(data);
    
    // Check for tool usage patterns for analytics
    const output = data.toString();
    if (this.isToolUsage(output)) {
      this.recordMetric('tool_used', { 
        toolName: this.extractToolName(output),
        timestamp: Date.now()
      });
    }
    
    // Check for errors
    if (this.isErrorOutput(output)) {
      this.recordMetric('error_occurred', { 
        error: output.trim(),
        timestamp: Date.now()
      });
    }
  }

  isToolUsage(output) {
    // Detect when Goose is using tools
    return output.includes('🔧') || 
           output.includes('Tool:') || 
           output.includes('Running:') ||
           output.includes('Executing:') ||
           output.startsWith('[');
  }

  extractToolName(output) {
    // Simple tool name extraction - can be enhanced
    if (output.includes('🔧')) {
      const match = output.match(/🔧\s*(\w+)/);
      return match ? match[1] : 'unknown';
    }
    return 'unknown';
  }

  isErrorOutput(output) {
    const errorPatterns = [
      'error',
      'Error',
      'ERROR',
      'failed',
      'Failed',
      'exception',
      'Exception'
    ];
    
    return errorPatterns.some(pattern => output.toLowerCase().includes(pattern.toLowerCase()));
  }

  getSessionStats() {
    const now = Date.now();
    const sessionDuration = this.analytics.sessionStartTime ? 
      now - this.analytics.sessionStartTime : 0;
    
    return {
      sessionId: this.sessionId,
      sessionName: this.sessionName,
      messageCount: this.metadata.messageCount,
      sessionDuration,
      toolUsage: this.metadata.toolUsage,
      workingDirectory: this.options.workingDirectory,
      errorCount: this.metadata.errorCount,
      errorRate: this.metadata.errorCount / Math.max(this.metadata.messageCount, 1),
      lastActivity: this.metadata.lastActivity,
      startTime: this.metadata.startTime,
      isActive: this.isReady
    };
  }

  async getResourceUsage() {
    try {
      const process = require('process');
      const usage = process.memoryUsage();
      
      return {
        memoryUsage: usage.heapUsed,
        memoryTotal: usage.heapTotal,
        cpuUsage: process.cpuUsage()
      };
    } catch (error) {
      console.error('Error getting resource usage:', error);
      return {
        memoryUsage: 0,
        memoryTotal: 0,
        cpuUsage: { user: 0, system: 0 }
      };
    }
  }

  async stop() {
    // Record session stop
    this.recordMetric('session_stopped', { 
      timestamp: Date.now(),
      duration: Date.now() - this.analytics.sessionStartTime
    });
    
    // Call parent stop method
    return super.stop();
  }
}

module.exports = SessionAwareGooseCLIWrapper;