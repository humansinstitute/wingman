#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
    // eslint-disable-next-line no-console
    console.log('Removed', filePath);
  } catch (_) {}
}

function removeInDir(dirPath, predicate) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isFile() && predicate(e.name)) {
        safeUnlink(full);
      }
    }
  } catch (_) {}
}

// Remove generated artifacts
removeInDir(path.join(__dirname, '..', 'temp'), (name) => name.endsWith('.json'));
removeInDir(path.join(__dirname, '..', 'logs'), (name) => name.endsWith('.log'));

// eslint-disable-next-line no-console
console.log('Cleanup complete');

