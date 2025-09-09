// service-wrapper.cjs - CommonJS wrapper for the ES module ODAG service
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting ODAG Link Creator service wrapper...');

// Set environment for service mode
process.env.NODE_ENV = 'production';

// Path to the main application (ES module)
const appPath = path.join(__dirname, 'odag-link-creator.js');

console.log(`Starting main application: ${appPath}`);
console.log(`Working directory: ${__dirname}`);

// Spawn the main application as a child process
const child = spawn('node', [appPath], {
  stdio: 'inherit',
  cwd: __dirname,
  env: process.env
});

child.on('error', (error) => {
  console.error('Failed to start ODAG Link Creator:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.log(`ODAG Link Creator exited with code ${code} and signal ${signal}`);
  // Exit with the same code as the child process
  process.exit(code || 0);
});

// Handle service shutdown signals
process.on('SIGINT', () => {
  console.log('Service wrapper received SIGINT, shutting down...');
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('Service wrapper received SIGTERM, shutting down...');
  child.kill('SIGTERM');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Service wrapper uncaught exception:', error);
  child.kill('SIGTERM');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Service wrapper unhandled rejection:', reason);
  child.kill('SIGTERM');
  process.exit(1);
});