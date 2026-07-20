'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { dataDir } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { spawnClaude } = require('../lib/claudeSpawn');
const { readEntries, findEntryByArchivePath, resolveArchivePath, readTranscript } = require('../lib/archiveReader');
const { resolveRunCommand } = require('../lib/runCommand');
const dashboardProcess = require('../lib/dashboardProcess');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'web', 'public');

// When packaged as a Node SEA binary there's no `web/public/index.html`
// sitting next to the executable to fs.readFile — it's embedded as a named
// asset at build time instead (see scripts/build-sea.js) and read back via
// node:sea.getAsset(). Under plain `node bin/claude-trail.js` execution
// node:sea.isSea() is false, so this stays unused and the normal
// filesystem read below runs exactly as before.
let sea = null;
try {
  const seaModule = require('node:sea');
  if (seaModule.isSea()) sea = seaModule;
} catch {
  // node:sea unavailable — not running as an SEA binary
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

function serveIndexHtml(res) {
  if (sea) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(Buffer.from(sea.getAsset('index.html')));
    return;
  }
  serveStatic(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
}

function createServer() {
  return http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
      serveIndexHtml(res);
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
  let background = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1]) {
      portArg = Number(argv[i + 1]);
    }
    if (argv[i] === '--background') {
      background = true;
    }
  }
  const config = loadConfig();
  const port = portArg && portArg > 0 ? portArg : config.webPort;

  if (background) {
    const result = dashboardProcess.start(resolveRunCommand(), port);
    if (result.alreadyRunning) {
      console.log(`claude-trail dashboard already running in the background: http://127.0.0.1:${result.port} (pid ${result.pid})`);
      return;
    }
    console.log(`claude-trail dashboard started in the background: http://127.0.0.1:${result.port} (pid ${result.pid})`);
    console.log(`  logs: ${dashboardProcess.logFilePath()}`);
    console.log('  stop with: claude-trail service stop');
    return;
  }

  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`claude-trail dashboard: http://127.0.0.1:${port}`);
  });
}

module.exports = { main, createServer };
