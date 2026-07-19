'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { dirSizeBytes, formatBytes } = require('../lib/dirSize');

function main() {
  const { retentionDays } = loadConfig();
  const indexPath = path.join(dataDir(), 'index.jsonl');
  const archiveRoot = path.join(dataDir(), 'archive');

  if (!fs.existsSync(indexPath)) {
    console.log(`claude-trail status: 0 entries captured yet. retentionDays=${retentionDays}.`);
    return;
  }

  const lines = fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
  const byType = {};
  let oldest = null;
  let newest = null;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const type = entry.agent_type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;

    const t = Date.parse(entry.timestamp);
    if (!Number.isNaN(t)) {
      if (oldest === null || t < oldest) oldest = t;
      if (newest === null || t > newest) newest = t;
    }
  }

  console.log('claude-trail status');
  console.log(`  data dir: ${dataDir()}`);
  console.log(`  total entries: ${lines.length}`);
  console.log('  by agent_type:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log(`  oldest capture: ${oldest ? new Date(oldest).toISOString() : 'n/a'}`);
  console.log(`  newest capture: ${newest ? new Date(newest).toISOString() : 'n/a'}`);
  console.log(`  retentionDays: ${retentionDays}`);
  console.log(`  archive size on disk: ${formatBytes(dirSizeBytes(archiveRoot))}`);
}

module.exports = { main };
