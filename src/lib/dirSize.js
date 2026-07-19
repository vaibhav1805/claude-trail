'use strict';

const fs = require('fs');
const path = require('path');

// Portable replacement for `du -sh` (Unix-only, breaks on Windows).
function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // file may have been removed mid-walk; skip
        }
      }
    }
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ['K', 'M', 'G', 'T'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)}${units[unitIndex]}`;
}

module.exports = { dirSizeBytes, formatBytes };
