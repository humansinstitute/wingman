const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'logs', 'goose-output.log');

if (!fs.existsSync(logFile)) {
  console.log('No log file found yet. Run some Goose sessions first!');
  process.exit(0);
}

console.log('🔍 Analyzing Goose Output Patterns...\n');

const logContent = fs.readFileSync(logFile, 'utf8');
const lines = logContent.split('\n').filter(line => line.trim());

let rawOutputs = [];
let parsedLines = [];

lines.forEach(line => {
  if (line.includes('RAW_OUTPUT:')) {
    const content = line.split('RAW_OUTPUT: ')[1];
    if (content) {
      try {
        rawOutputs.push(JSON.parse(content));
      } catch (e) {
        // Skip malformed entries
      }
    }
  } else if (line.includes('PARSED_LINE:')) {
    const content = line.split('PARSED_LINE: ')[1];
    if (content) {
      try {
        parsedLines.push(JSON.parse(content));
      } catch (e) {
        // Skip malformed entries
      }
    }
  }
});

console.log(`📊 Found ${rawOutputs.length} raw outputs and ${parsedLines.length} parsed lines`);

console.log('\n🎯 Common Patterns in Parsed Lines:');
const patterns = {};
parsedLines.forEach(line => {
  // Look for common starting patterns
  const words = line.split(' ');
  const firstWord = words[0] || '';
  const firstTwoWords = words.slice(0, 2).join(' ');
  
  if (firstWord) {
    patterns[firstWord] = (patterns[firstWord] || 0) + 1;
  }
});

// Sort by frequency
const sortedPatterns = Object.entries(patterns)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

sortedPatterns.forEach(([pattern, count]) => {
  console.log(`  "${pattern}": ${count} times`);
});

console.log('\n📝 Sample Lines by Category:');

// Show samples of different types
const samples = {
  'System Messages': parsedLines.filter(line => 
    line.includes('session') || 
    line.includes('logging') || 
    line.includes('Context:') ||
    line.includes('working directory')
  ).slice(0, 3),
  
  'Potential AI Responses': parsedLines.filter(line => 
    line.length > 20 && 
    !line.includes('session') && 
    !line.includes('Context:') &&
    !line.includes('working directory') &&
    /[.!?]$/.test(line)
  ).slice(0, 5),
  
  'Questions/Prompts': parsedLines.filter(line => 
    line.includes('?') && line.length > 10
  ).slice(0, 3),
  
  'Tool Usage': parsedLines.filter(line => 
    line.includes('🔧') || 
    line.includes('Tool:') ||
    line.includes('Running:')
  ).slice(0, 3)
};

Object.entries(samples).forEach(([category, lines]) => {
  if (lines.length > 0) {
    console.log(`\n${category}:`);
    lines.forEach(line => {
      console.log(`  → "${line}"`);
    });
  }
});

console.log('\n💡 Suggestions for parsing rules:');
console.log('1. Look for lines ending with punctuation for AI responses');
console.log('2. Filter out lines containing "Context:", "session", "logging"');
console.log('3. Consider lines with questions (?) as potential user input echoes');
console.log('4. Look for tool usage patterns with specific keywords');

console.log('\n📁 Full log available at:', logFile);