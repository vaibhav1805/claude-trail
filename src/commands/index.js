'use strict';

const { readEntries } = require('../lib/archiveReader');
const { loadConfig } = require('../lib/config');
const { readVectors, appendVectors } = require('../lib/vectorStore');
const { embeddingTextFor } = require('../lib/embeddingText');

function printHelp() {
  console.log(`Usage:
  claude-trail index [--limit N]

  Builds/updates the local semantic-search embedding index over archived
  entries. Incremental — only embeds entries not already indexed (or all of
  them, the first time). Requires the optional "@huggingface/transformers"
  dependency; see the error message if it's missing.

  --limit N   Embed at most N new entries this run (useful for a large
              first-time backlog, or for bounding time in automation).
`);
}

async function run(argv) {
  let limit = Infinity;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      limit = Number(argv[i + 1]) || limit;
      i += 1;
    }
  }

  const config = loadConfig();
  const entries = readEntries().filter((e) => e.archive_path && embeddingTextFor(e));
  const already = new Set(readVectors().map((v) => v.archive_path));
  const pending = entries.filter((e) => !already.has(e.archive_path)).slice(0, limit);

  if (!pending.length) {
    console.log(`claude-trail: ${already.size} entr${already.size === 1 ? 'y' : 'ies'} already indexed, nothing new to embed.`);
    return;
  }

  let embedBatch;
  try {
    ({ embedBatch } = require('../lib/embeddingModel'));
  } catch (err) {
    console.error(`claude-trail index failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`claude-trail: embedding ${pending.length} new entr${pending.length === 1 ? 'y' : 'ies'} (model: ${config.semanticSearch.model})...`);

  let vectors;
  try {
    vectors = await embedBatch(config.semanticSearch.model, pending.map(embeddingTextFor));
  } catch (err) {
    console.error(`claude-trail index failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const records = pending.map((entry, i) => ({
    archive_path: entry.archive_path,
    model: config.semanticSearch.model,
    embedded_at: new Date().toISOString(),
    vector: vectors[i],
  }));

  appendVectors(records);
  console.log(`claude-trail: indexed ${records.length} entr${records.length === 1 ? 'y' : 'ies'} (${already.size + records.length} total).`);
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  run(argv).catch((err) => {
    console.error(`claude-trail index failed: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
