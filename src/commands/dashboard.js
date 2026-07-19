'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { dataDir } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { spawnClaude } = require('../lib/claudeSpawn');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'web', 'public');

function archiveDir() {
  return path.join(dataDir(), 'archive');
}

function indexPath() {
  return path.join(dataDir(), 'index.jsonl');
}

function readEntries() {
  const ip = indexPath();
  if (!fs.existsSync(ip)) return [];
  return fs
    .readFileSync(ip, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse(); // newest first
}

function findEntryByArchivePath(relativePath) {
  return readEntries().find((e) => e.archive_path === relativePath) || null;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'text') return block.text || '';
        if (block.type === 'tool_use') return `[tool call: ${block.name || 'unknown'}]`;
        if (block.type === 'tool_result') return '[tool result]';
        if (block.type === 'thinking') return `[thinking] ${block.thinking || ''}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// Harness/session bookkeeping line types that never carry conversation
// content — dropped from the viewer entirely rather than shown as noise.
const BOOKKEEPING_TYPES = new Set([
  'mode',
  'permission-mode',
  'file-history-snapshot',
  'file-history-delta',
  'attachment',
  'last-prompt',
  'ai-title',
  'queue-operation',
  'system',
]);

function resolveArchivePath(relativePath) {
  const resolved = path.resolve(dataDir(), relativePath);
  if (!resolved.startsWith(archiveDir() + path.sep)) {
    throw new Error('path escapes archive directory');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('transcript not found');
  }
  return resolved;
}

// Renders each transcript line down to {type, role, text, timestamp} so the
// frontend doesn't need to understand the full Claude Code transcript schema.
function readTranscript(relativePath) {
  const resolved = resolveArchivePath(relativePath);
  const lines = fs.readFileSync(resolved, 'utf8').split('\n').filter(Boolean);
  return lines
    .map((line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return { type: 'raw', text: line };
      }
      if (BOOKKEEPING_TYPES.has(parsed.type)) return null;
      if (parsed.message && parsed.message.role) {
        return {
          type: parsed.type || parsed.message.role,
          role: parsed.message.role,
          text: extractText(parsed.message.content),
          timestamp: parsed.timestamp || null,
        };
      }
      return {
        type: parsed.type || 'meta',
        text: parsed.subtype ? `[${parsed.type}:${parsed.subtype}]` : `[${parsed.type || 'meta'}]`,
        timestamp: parsed.timestamp || null,
      };
    })
    .filter(Boolean);
}

const SUMMARY_PER_MESSAGE_MAX_CHARS = 4000;
const SUMMARY_TOTAL_MAX_CHARS = 60000;
const SUMMARY_CHILD_TIMEOUT_MS = 60000;

function summaryCachePath(resolvedTranscriptPath) {
  return `${resolvedTranscriptPath}.summary.json`;
}

// Builds a bounded plaintext rendition of the (already-filtered) transcript
// for the LLM to summarize. Thinking blocks are dropped — they're internal
// reasoning, not conversation content, and would just bloat the prompt.
function buildSummaryPrompt(entry, transcriptEntries) {
  const lines = [];
  let total = 0;
  let truncated = false;

  for (const m of transcriptEntries) {
    if (!m.text || m.text.startsWith('[thinking]')) continue;
    const role = (m.role || m.type || 'meta').toUpperCase();
    let text = m.text;
    if (text.length > SUMMARY_PER_MESSAGE_MAX_CHARS) {
      text = `${text.slice(0, SUMMARY_PER_MESSAGE_MAX_CHARS)}… [truncated]`;
    }
    const line = `${role}: ${text}`;
    if (total + line.length > SUMMARY_TOTAL_MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    total += line.length;
  }

  const header =
    `agent_type: ${entry.agent_type || 'unknown'}, cwd: ${entry.cwd || 'unknown'}, ` +
    `captured: ${entry.timestamp || 'unknown'}`;

  return (
    'You are summarizing a Claude Code subagent transcript for a developer reviewing past work. ' +
    'Use only what is in the transcript below — do not speculate beyond it. Reply in this format:\n\n' +
    '- Task: what was asked\n' +
    '- Approach: key steps, tools, or files involved\n' +
    '- Outcome: what was concluded or produced\n' +
    '- Notable issues: caveats, errors, or gaps (omit this line if none)\n\n' +
    'Keep it under 200 words.\n\n' +
    `--- TRANSCRIPT (${header}) ---\n` +
    lines.join('\n') +
    (truncated ? '\n… [earlier/later transcript content omitted for length]' : '') +
    '\n--- END TRANSCRIPT ---'
  );
}

// Shells out to the local `claude` CLI in headless print mode, reusing
// whatever auth the user's Claude Code install already has (no separate API
// key to manage). Tools and hooks are disabled — this call only ever reads
// the prompt text we hand it and returns text, nothing else.
function runClaudeSummary(promptText, model) {
  return new Promise((resolve, reject) => {
    const child = spawnClaude(
      ['-p', '--model', model, '--bare', '--no-session-persistence', '--tools', '', '--output-format', 'text'],
      { cwd: dataDir(), stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('claude CLI timed out'));
    }, SUMMARY_CHILD_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

async function getSummary(relativePath, forceRefresh, config) {
  if (!config.summaryMode.enabled) {
    const err = new Error('summary mode is disabled in config.json');
    err.statusCode = 403;
    throw err;
  }

  const resolved = resolveArchivePath(relativePath);
  const cachePath = summaryCachePath(resolved);

  if (!forceRefresh && fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch {
      // fall through and regenerate if the cache file is unreadable
    }
  }

  const entry = findEntryByArchivePath(relativePath) || {};
  const transcriptEntries = readTranscript(relativePath);
  const prompt = buildSummaryPrompt(entry, transcriptEntries);

  const summaryText = await runClaudeSummary(prompt, config.summaryMode.model);
  const result = {
    summary: summaryText,
    model: config.summaryMode.model,
    generatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(cachePath, JSON.stringify(result));
  } catch {
    // caching is best-effort; a failed write just means we regenerate next time
  }

  return result;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
      serveStatic(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (parsed.pathname === '/api/config') {
      const config = loadConfig();
      sendJson(res, 200, { summaryMode: config.summaryMode });
      return;
    }

    if (parsed.pathname === '/api/entries') {
      try {
        sendJson(res, 200, readEntries());
      } catch (err) {
        sendJson(res, 500, { error: String((err && err.message) || err) });
      }
      return;
    }

    if (parsed.pathname === '/api/transcript') {
      const rel = parsed.query.path;
      if (!rel) {
        sendJson(res, 400, { error: 'missing path query param' });
        return;
      }
      try {
        sendJson(res, 200, readTranscript(String(rel)));
      } catch (err) {
        sendJson(res, 400, { error: String((err && err.message) || err) });
      }
      return;
    }

    if (parsed.pathname === '/api/summary') {
      const rel = parsed.query.path;
      if (!rel) {
        sendJson(res, 400, { error: 'missing path query param' });
        return;
      }
      const forceRefresh = parsed.query.refresh === '1';
      const config = loadConfig();
      getSummary(String(rel), forceRefresh, config)
        .then((result) => sendJson(res, 200, result))
        .catch((err) => {
          sendJson(res, err.statusCode || 500, { error: String((err && err.message) || err) });
        });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });
}

function main(argv) {
  let portArg = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1]) {
      portArg = Number(argv[i + 1]);
    }
  }
  const config = loadConfig();
  const port = portArg && portArg > 0 ? portArg : config.webPort;

  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`claude-trail dashboard: http://127.0.0.1:${port}`);
  });
}

module.exports = { main, createServer };
