'use strict';

const { readEntries, readTranscript } = require('../lib/archiveReader');

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
  claude-trail search --show <archive_path>

  <query>            Text to search for across archived subagent runs.
  --type <substr>    Only match entries whose agent_type contains this substring.
  --limit N          Max matches to return (default 20).
  --deep             Also scan full transcript bodies, not just the last message
                     and cwd recorded in the index (slower).
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

function runSearch(argv) {
  const asJson = argv.includes('--json');
  const deep = argv.includes('--deep');
  let typeFilter = null;
  let limit = 20;
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
    if (argv[i] === '--json' || argv[i] === '--deep') continue;
    positional.push(argv[i]);
  }

  const rawQuery = positional.join(' ').trim();
  if (!rawQuery) {
    printHelp();
    process.exitCode = 1;
    return;
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

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (!results.length) {
    const hint = deep ? '' : ' (tip: pass --deep to also search full transcript bodies, not just the last message)';
    console.log(`No archived subagent runs matched "${rawQuery}".${hint}`);
    return;
  }

  console.log(`${results.length} match(es) for "${rawQuery}":\n`);
  for (const r of results) {
    console.log(`[${r.agent_type}] ${r.timestamp || ''}`);
    if (r.cwd) console.log(`  cwd: ${r.cwd}`);
    console.log(`  ${r.excerpt}`);
    if (r.archive_path) {
      console.log(`  archive_path: ${r.archive_path}`);
      console.log(`  full transcript: claude-trail search --show "${r.archive_path}"`);
    }
    console.log('');
  }
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
