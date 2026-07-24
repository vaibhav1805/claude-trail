'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { extractText } = require('../lib/archiveReader');

const MAX_SUMMARY_CHARS = 1000;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

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

function sanitize(segment, fallback) {
  return (segment || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function cursorPath(sessionId) {
  return path.join(dataDir(), 'cursors', `${sanitize(sessionId, 'unknown')}.json`);
}

// One JSON file per session_id holding the line count already archived, so
// a PreCompact/SessionEnd firing later in the same session only captures
// what's new since the last checkpoint instead of re-copying the whole
// (ever-growing) transcript file every time.
function readCursor(sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cursorPath(sessionId), 'utf8'));
    return typeof parsed.lastLine === 'number' && parsed.lastLine >= 0 ? parsed.lastLine : 0;
  } catch {
    return 0; // no cursor yet (or unreadable) — treat the whole transcript as new
  }
}

function writeCursor(sessionId, lastLine) {
  const p = cursorPath(sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ lastLine, updatedAt: new Date().toISOString() }));
}

// PreCompact carries a manual/auto trigger, SessionEnd carries a reason
// (clear/exit/resume/etc.) — fold whichever applies into one label so
// index.jsonl entries and `search --type` stay meaningful without a
// separate column per hook.
function triggerLabel(payload) {
  if (payload.hook_event_name === 'PreCompact') return `precompact-${payload.trigger || 'unknown'}`;
  if (payload.hook_event_name === 'SessionEnd') return `session-end-${payload.reason || 'unknown'}`;
  return payload.hook_event_name || 'unknown';
}

// Pulls the last assistant turn's text out of the newly-captured delta —
// the same "headline" role last_assistant_message plays for subagent
// entries in archive.js.
function lastAssistantText(deltaLines) {
  for (let i = deltaLines.length - 1; i >= 0; i -= 1) {
    let parsed;
    try {
      parsed = JSON.parse(deltaLines[i]);
    } catch {
      continue;
    }
    if (parsed.message && parsed.message.role === 'assistant') {
      const text = extractText(parsed.message.content);
      if (text) return text;
    }
  }
  return '';
}

function run() {
  const raw = readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    logError(err);
    return;
  }

  // Opt-in: the PreCompact/SessionEnd hooks are always wired (see
  // settingsMerge.js) so toggling this on doesn't require re-running
  // `configure`, but this command no-ops immediately unless the user has
  // explicitly turned it on — main-session transcripts carry the user's own
  // prompts, a bigger privacy surface than subagent-scoped archiving.
  const config = loadConfig();
  if (!config.mainSessionCapture.enabled) return;

  const { session_id, transcript_path, cwd } = payload;
  if (!session_id || !transcript_path || !fs.existsSync(transcript_path)) return;

  let lines;
  try {
    lines = fs.readFileSync(transcript_path, 'utf8').split('\n').filter(Boolean);
  } catch (err) {
    logError(err);
    return;
  }

  const lastLine = readCursor(session_id);
  const delta = lines.slice(lastLine);
  if (!delta.length) return; // nothing new since the last checkpoint — e.g. back-to-back compactions

  const timestamp = new Date().toISOString();
  const safeSessionId = sanitize(session_id, 'unknown');
  const archiveRoot = path.join(dataDir(), 'archive', 'main-session');
  const indexPath = path.join(dataDir(), 'index.jsonl');

  let archivePath;
  try {
    fs.mkdirSync(archiveRoot, { recursive: true });
    const destFile = path.join(archiveRoot, `${timestamp.replace(/[:.]/g, '-')}-${safeSessionId}.jsonl`);
    fs.writeFileSync(destFile, delta.join('\n') + '\n');
    archivePath = path.relative(dataDir(), destFile);
  } catch (err) {
    logError(err);
    return; // don't advance the cursor or write an index entry for a chunk that didn't land
  }

  const entry = {
    timestamp,
    agent_id: null,
    agent_type: 'main-session',
    exit_reason: null,
    session_id,
    cwd: cwd || null,
    trigger: triggerLabel(payload),
    last_assistant_message: lastAssistantText(delta).slice(0, MAX_SUMMARY_CHARS),
    archive_path: archivePath,
    skipped_reason: null,
  };

  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(indexPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    logError(err);
  }

  // Only advance the cursor once the chunk and index entry are both safely
  // written — a failure above should leave the next run free to retry the
  // same delta rather than silently lose it.
  writeCursor(session_id, lines.length);
}

function main() {
  try {
    run();
  } catch (err) {
    logError(err);
  }
  // Same contract as archive.js: never block compaction or session end.
  process.exit(0);
}

module.exports = { main };
