#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

async function rmrf(dir) {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    console.log(`Removed ${dir}`);
  } catch (e) {
    console.warn(`Skip ${dir}: ${e.message}`);
  }
}

async function main() {
  const cwd = process.cwd();
  const distDir = path.join(cwd, 'dist');
  const home = process.env.WINGMAN_HOME || path.join(os.homedir(), '.wingman');
  const tmpDir = path.join(home, 'tmp');
  await rmrf(distDir);
  await rmrf(tmpDir);
}

main().catch((e) => { console.error(e); process.exit(1); });

