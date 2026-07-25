'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

// One JSONL line per embedded index entry, keyed by archive_path (the same
// stable, unique identifier search.js and archiveReader.js already key on).
// Entries with no archive_path (skipped/failed archives) are never embedded
// — there's no transcript text behind them worth indexing.
function vectorsPath() {
  return path.join(dataDir(), 'embeddings', 'vectors.jsonl');
}

function readVectors() {
  const p = vectorsPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeVectorsAtomic(records) {
  const p = vectorsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = path.join(path.dirname(p), `.vectors.${process.pid}.tmp`);
  const body = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, p);
}

// Appends newly-embedded records, guarding against a concurrent writer (e.g.
// a `claude-trail index` run overlapping with prune.js's own auto-index
// pass) the same way prune.js/archive.js already guard index.jsonl: re-read
// immediately before writing and keep anything that showed up in the
// meantime, keyed by archive_path so re-embedding the same entry twice
// de-dupes to the latest write instead of appending a duplicate.
function appendVectors(newRecords) {
  if (!newRecords.length) return;
  const current = readVectors();
  const byPath = new Map(current.map((r) => [r.archive_path, r]));
  for (const rec of newRecords) byPath.set(rec.archive_path, rec);
  writeVectorsAtomic(Array.from(byPath.values()));
}

// Drops vectors whose archive_path no longer has a live archived transcript
// (prune.js already deleted the file and its index.jsonl entry) — otherwise
// `search --semantic` would keep surfacing dead links forever.
function removeVectors(archivePaths) {
  if (!archivePaths.length) return 0;
  const toRemove = new Set(archivePaths);
  const current = readVectors();
  const kept = current.filter((r) => !toRemove.has(r.archive_path));
  const removedCount = current.length - kept.length;
  if (removedCount > 0) writeVectorsAtomic(kept);
  return removedCount;
}

module.exports = { vectorsPath, readVectors, appendVectors, removeVectors };
