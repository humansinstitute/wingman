const { spawn } = require('child_process');
const chalk = require('chalk');

// Simple debug script to see exactly what Goose outputs
console.log('Starting Goose debug session...\n');

const goose = spawn('goose', ['session', '--name', 'debug-test'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

goose.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(chalk.green('STDOUT:'), JSON.stringify(output));
  console.log(chalk.blue('VISIBLE:'), output);
  console.log(chalk.gray('---'));
});

goose.stderr.on('data', (data) => {
  const output = data.toString();
  console.log(chalk.red('STDERR:'), output);
});

goose.on('close', (code) => {
  console.log(`Goose exited with code ${code}`);
});

// Send a test message after 3 seconds
setTimeout(() => {
  console.log('\nSending test message to Goose...');
  goose.stdin.write('Hello, can you help me?\n');
}, 3000);

// Exit after 15 seconds
setTimeout(() => {
  console.log('\nExiting debug session...');
  goose.stdin.write('/exit\n');
  setTimeout(() => process.exit(0), 2000);
}, 15000);