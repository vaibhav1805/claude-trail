'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { removeVectors } = require('../lib/vectorStore');

function logError(err) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(
      path.join(dataDir(), 'hook-errors.log'),
      `${new Date().toISOString()} ${err && err.stack ? err.stack : err}\n`
    );
  } catch {
    // nothing more we can do
  }
}

function removeEmptyArchiveDirs(archiveRoot) {
  if (!fs.existsSync(archiveRoot)) return;
  for (const sub of fs.readdirSync(archiveRoot)) {
    const subPath = path.join(archiveRoot, sub);
    try {
      if (fs.statSync(subPath).isDirectory() && fs.readdirSync(subPath).length === 0) {
        fs.rmdirSync(subPath);
      }
    } catch (err) {
      logError(err);
    }
  }
}

// archive-main.js's cursor files (dataDir()/cursors/<session_id>.json) track
// progress independently of index.jsonl, so they need their own sweep — a
// session that ended weeks ago leaves an orphaned cursor with nothing else
// to key its cleanup off of.
function removeStaleCursors(cutoff) {
  const cursorsDir = path.join(dataDir(), 'cursors');
  if (!fs.existsSync(cursorsDir)) return;
  for (const name of fs.readdirSync(cursorsDir)) {
    const cursorFile = path.join(cursorsDir, name);
    try {
      const { updatedAt } = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
      const updatedTime = Date.parse(updatedAt);
      if (!Number.isNaN(updatedTime) && updatedTime < cutoff) {
        fs.unlinkSync(cursorFile);
      }
    } catch (err) {
      logError(err);
    }
  }
}

function run() {
  const config = loadConfig();
  const { retentionDays } = config;
  const indexPath = path.join(dataDir(), 'index.jsonl');
  const archiveRoot = path.join(dataDir(), 'archive');
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  removeStaleCursors(cutoff);

  if (!fs.existsSync(indexPath)) {
    console.log('claude-trail: no index.jsonl yet, nothing to prune.');
    maybeAutoIndex(config);
    return;
  }

  const lines = fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);

  const kept = [];
  const removedArchivePaths = [];
  let removedCount = 0;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      logError(err);
      kept.push(line); // don't silently drop lines we can't parse
      continue;
    }

    const entryTime = Date.parse(entry.timestamp);
    const isStale = !Number.isNaN(entryTime) && entryTime < cutoff;

    if (!isStale) {
      kept.push(line);
      continue;
    }

    if (entry.archive_path) {
      const fullPath = path.join(dataDir(), entry.archive_path);
      const summaryPath = `${fullPath}.summary.json`;
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
      } catch (err) {
        logError(err);
      }
      removedArchivePaths.push(entry.archive_path);
    }
    removedCount += 1;
  }

  if (removedCount > 0) {
    // archive.js can append a new line (a subagent completing concurrently)
    // at any point during the scan above. Re-read right before writing and
    // carry forward anything appended since our first read — archive.js
    // only ever appends, never rewrites existing lines, so anything beyond
    // the line count we started with is new and must be preserved rather
    // than silently clobbered by this rewrite.
    let currentLines = lines;
    try {
      currentLines = fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
    } catch (err) {
      logError(err); // fall back to the lines already in hand
    }
    const appendedSinceScan = currentLines.slice(lines.length);
    const finalLines = kept.concat(appendedSinceScan);

    const tmpPath = `${indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, finalLines.length ? finalLines.join('\n') + '\n' : '');
    fs.renameSync(tmpPath, indexPath);
    removeEmptyArchiveDirs(archiveRoot);

    if (removedArchivePaths.length) {
      try {
        removeVectors(removedArchivePaths);
      } catch (err) {
        logError(err); // stale vector rows are harmless noise, never fatal
      }
    }
  }

  console.log(
    `claude-trail: pruned ${removedCount} entr${removedCount === 1 ? 'y' : 'ies'} ` +
    `older than ${retentionDays} days. ${kept.length} remain.`
  );

  maybeAutoIndex(config);
}

// Bounded, best-effort: only runs when the user has explicitly opted in via
// config.semanticSearch.enabled, and only ever embeds a small capped batch
// per run (autoIndexLimit) so a large backlog can't blow past this hook's
// 15s timeout (see settingsMerge.js SessionStart def) or delay session
// start noticeably. Never fatal — a failure here (missing optional
// dependency, network hiccup downloading the model) must not break prune's
// own job of trimming old entries, which already succeeded above.
function maybeAutoIndex(config) {
  if (!config.semanticSearch.enabled) return;
  try {
    const { readEntries } = require('../lib/archiveReader');
    const { readVectors, appendVectors } = require('../lib/vectorStore');
    const { embedBatch } = require('../lib/embeddingModel');
    const { embeddingTextFor } = require('../lib/embeddingText');

    const entries = readEntries().filter((e) => e.archive_path && embeddingTextFor(e));
    const already = new Set(readVectors().map((v) => v.archive_path));
    const pending = entries.filter((e) => !already.has(e.archive_path)).slice(0, config.semanticSearch.autoIndexLimit);
    if (!pending.length) return;

    embedBatch(config.semanticSearch.model, pending.map(embeddingTextFor))
      .then((vectors) => {
        appendVectors(
          pending.map((entry, i) => ({
            archive_path: entry.archive_path,
            model: config.semanticSearch.model,
            embedded_at: new Date().toISOString(),
            vector: vectors[i],
          }))
        );
      })
      .catch((err) => logError(err));
  } catch (err) {
    logError(err); // optional dependency missing, etc. — silently skip
  }
}

function main() {
  try {
    run();
  } catch (err) {
    logError(err);
  }
}

module.exports = { main };
