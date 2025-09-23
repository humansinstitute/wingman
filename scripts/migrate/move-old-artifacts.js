#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function moveIfExists(src, destDir) {
  try {
    await ensureDir(destDir);
    const base = path.basename(src);
    const dest = path.join(destDir, base);
    await fsp.rename(src, dest);
    console.log(`Moved ${src} -> ${dest}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`Skip ${src}: ${e.message}`);
  }
}

async function main() {
  const cwd = process.cwd();
  const wingHome = process.env.WINGMAN_HOME || path.join(os.homedir(), '.wingman');
  const logsDir = path.join(wingHome, 'logs');
  const tmpDir = path.join(wingHome, 'tmp');

  await ensureDir(logsDir);
  await ensureDir(tmpDir);

  // Move repo logs/* -> ~/.wingman/logs
  const repoLogs = path.join(cwd, 'logs');
  if (fs.existsSync(repoLogs)) {
    const files = await fsp.readdir(repoLogs);
    for (const file of files) {
      if (file.endsWith('.log') || file.endsWith('.txt')) {
        await moveIfExists(path.join(repoLogs, file), logsDir);
      }
    }
  }

  // Move repo temp/* -> ~/.wingman/tmp
  const repoTemp = path.join(cwd, 'temp');
  if (fs.existsSync(repoTemp)) {
    const files = await fsp.readdir(repoTemp);
    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.jsonl') || file.endsWith('.tmp')) {
        await moveIfExists(path.join(repoTemp, file), tmpDir);
      }
    }
  }

  // Move a root-level conversation.json if present
  await moveIfExists(path.join(cwd, 'conversation.json'), tmpDir);

  console.log('Migration complete.');
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});

