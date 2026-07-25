'use strict';

const { readEntries, readTranscript, findEntryByArchivePath } = require('../lib/archiveReader');
const { loadConfig } = require('../lib/config');

// Cosine similarity from a mean-pooled MiniLM sentence embedding runs much
// lower in absolute terms than intuition suggests for long, multi-topic
// archived entries — a genuinely relevant match scored as low as 0.147 in
// testing. Without a floor, --semantic silently returns every indexed entry
// (just sorted), which reads as "search" but behaves as "rank everything."
// This default is a conservative floor to cut the obviously-unrelated tail,
// not a precision-tuned cutoff — --min-score lets a query override it.
const DEFAULT_MIN_SIMILARITY = 0.08;

// Split into lowercase words so a query like "database migration" matches
// "migration of the database" — matchesQuery requires every token to appear
// somewhere in the haystack (AND semantics), not the literal phrase verbatim.
function tokenize(text) {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesQuery(haystack, tokens) {
  const lower = haystack.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

function excerptAround(text, tokens, radius = 120) {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (idx === -1 || found < idx)) idx = found;
  }
  if (idx === -1) return text.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '…' : '')
  );
}

// Scans the full archived transcript for a query — slower than the index-only
// pass, so it's opt-in via --deep rather than always-on.
function searchTranscript(entry, tokens) {
  if (!entry.archive_path) return null;
  let transcript;
  try {
    transcript = readTranscript(entry.archive_path);
  } catch {
    return null; // archived transcript may have been pruned since indexing
  }
  for (const m of transcript) {
    if (m.text && matchesQuery(m.text, tokens)) return m.text;
  }
  return null;
}

function printHelp() {
  console.log(`Usage:
  claude-trail search <query> [--type <agent_type>] [--limit N] [--deep] [--json]
  claude-trail search <query> --semantic [--limit N] [--json]
  claude-trail search --show <archive_path>

  <query>            Text to search for across archived subagent runs.
  --type <substr>    Only match entries whose agent_type contains this substring.
  --limit N          Max matches to return (default 20).
  --deep             Also scan full transcript bodies, not just the last message
                     and cwd recorded in the index (slower).
  --semantic         Rank by embedding similarity instead of exact word matches —
                     finds paraphrases lexical search misses (e.g. "auth session
                     expiry" matching a run about "tokens timing out"). Requires
                     running \`claude-trail index\` first and the optional
                     "@huggingface/transformers" dependency. Not combined with
                     --deep/--type in the same run.
  --min-score N      With --semantic, drop matches below this similarity score
                     (default ${DEFAULT_MIN_SIMILARITY}). Lower to widen recall,
                     raise to cut weak matches.
  --json             Output structured JSON instead of a human-readable list.
  --show <path>      Print the full cleaned transcript for one archive_path
                     (as returned by a prior search) to read complete context.
`);
}

function runShow(archivePath) {
  let transcript;
  try {
    transcript = readTranscript(archivePath);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  for (const m of transcript) {
    if (!m.text) continue;
    console.log(`--- ${(m.role || m.type || '').toUpperCase()} ---`);
    console.log(m.text);
    console.log('');
  }
}

function parseArgs(argv) {
  const asJson = argv.includes('--json');
  const deep = argv.includes('--deep');
  const semantic = argv.includes('--semantic');
  let typeFilter = null;
  let limit = 20;
  let minScore = DEFAULT_MIN_SIMILARITY;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--type' && argv[i + 1]) {
      typeFilter = argv[i + 1].toLowerCase();
      i += 1;
      continue;
    }
    if (argv[i] === '--limit' && argv[i + 1]) {
      limit = Number(argv[i + 1]) || limit;
      i += 1;
      continue;
    }
    if (argv[i] === '--min-score' && argv[i + 1] !== undefined) {
      const parsed = Number(argv[i + 1]);
      if (!Number.isNaN(parsed)) minScore = parsed;
      i += 1;
      continue;
    }
    if (argv[i] === '--json' || argv[i] === '--deep' || argv[i] === '--semantic') continue;
    positional.push(argv[i]);
  }

  return { asJson, deep, semantic, typeFilter, limit, minScore, rawQuery: positional.join(' ').trim() };
}

function printResults(results, rawQuery, asJson, deep, semantic) {
  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (!results.length) {
    const hint = semantic
      ? ' (tip: pass a lower --min-score to widen the match, default ' + DEFAULT_MIN_SIMILARITY + ')'
      : deep
        ? ''
        : ' (tip: pass --deep to also search full transcript bodies, not just the last message)';
    console.log(`No archived subagent runs matched "${rawQuery}".${hint}`);
    return;
  }

  console.log(`${results.length} match(es) for "${rawQuery}":\n`);
  for (const r of results) {
    console.log(`[${r.agent_type}] ${r.timestamp || ''}${typeof r.score === 'number' ? ` (similarity: ${r.score.toFixed(3)})` : ''}`);
    if (r.cwd) console.log(`  cwd: ${r.cwd}`);
    console.log(`  ${r.excerpt}`);
    if (r.archive_path) {
      console.log(`  archive_path: ${r.archive_path}`);
      console.log(`  full transcript: claude-trail search --show "${r.archive_path}"`);
    }
    console.log('');
  }
}

async function runSemanticSearch(rawQuery, limit, minScore, asJson) {
  const config = loadConfig();

  let embedText, cosineSimilarity;
  try {
    ({ embedText, cosineSimilarity } = require('../lib/embeddingModel'));
  } catch (err) {
    console.error(`claude-trail search --semantic failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const { readVectors } = require('../lib/vectorStore');
  const vectors = readVectors();
  if (!vectors.length) {
    console.log('claude-trail: no semantic index yet — run `claude-trail index` first.');
    return;
  }

  let queryVector;
  try {
    queryVector = await embedText(config.semanticSearch.model, rawQuery);
  } catch (err) {
    console.error(`claude-trail search --semantic failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const ranked = vectors
    .map((v) => ({ archive_path: v.archive_path, score: cosineSimilarity(queryVector, v.vector) }))
    .filter((v) => v.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const results = ranked
    .map(({ archive_path, score }) => {
      const entry = findEntryByArchivePath(archive_path);
      if (!entry) return null; // pruned since indexing; vectorStore cleans these up separately
      return {
        agent_type: entry.agent_type || 'unknown',
        agent_id: entry.agent_id || null,
        timestamp: entry.timestamp || null,
        cwd: entry.cwd || null,
        archive_path: entry.archive_path || null,
        excerpt: (entry.last_assistant_message || '').slice(0, 280),
        matched_in: 'semantic',
        score,
      };
    })
    .filter(Boolean);

  printResults(results, rawQuery, asJson, true, true);
}

function runSearch(argv) {
  const { asJson, deep, semantic, typeFilter, limit, minScore, rawQuery } = parseArgs(argv);

  if (!rawQuery) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (semantic) {
    return runSemanticSearch(rawQuery, limit, minScore, asJson);
  }

  const queryTokens = tokenize(rawQuery);

  const entries = readEntries(); // newest first
  const results = [];

  for (const entry of entries) {
    if (results.length >= limit) break;
    if (typeFilter && !(entry.agent_type || '').toLowerCase().includes(typeFilter)) continue;

    const indexHaystack = [entry.agent_type, entry.cwd, entry.last_assistant_message]
      .filter(Boolean)
      .join(' ');

    let excerpt = null;
    let matchedIn = null;

    if (matchesQuery(indexHaystack, queryTokens)) {
      excerpt = excerptAround(entry.last_assistant_message || '', queryTokens);
      matchedIn = 'index';
    } else if (deep) {
      const deepText = searchTranscript(entry, queryTokens);
      if (deepText) {
        excerpt = excerptAround(deepText, queryTokens);
        matchedIn = 'transcript';
      }
    }

    if (!excerpt) continue;

    results.push({
      agent_type: entry.agent_type || 'unknown',
      agent_id: entry.agent_id || null,
      timestamp: entry.timestamp || null,
      cwd: entry.cwd || null,
      archive_path: entry.archive_path || null,
      excerpt,
      matched_in: matchedIn,
    });
  }

  printResults(results, rawQuery, asJson, deep);
}

function main(argv) {
  const showIdx = argv.indexOf('--show');
  if (showIdx !== -1) {
    const archivePath = argv[showIdx + 1];
    if (!archivePath) {
      printHelp();
      process.exitCode = 1;
      return;
    }
    runShow(archivePath);
    return;
  }

  runSearch(argv);
}

module.exports = { main };
