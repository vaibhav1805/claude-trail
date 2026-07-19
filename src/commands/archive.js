'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../lib/paths');

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

// Real subagent transcripts always live under a `subagents/` directory
// (e.g. .../subagents/agent-<id>.jsonl). A main session transcript sits
// directly in the project directory instead. Some events hand us the
// latter as transcript_path — copying it would duplicate the entire
// conversation into the archive, so refuse to archive anything that
// isn't clearly a dedicated subagent transcript.
function looksLikeSubagentTranscript(transcriptPath) {
  const segments = transcriptPath.split(path.sep);
  return segments.includes('subagents');
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

  const { agent_id, agent_type, last_assistant_message, exit_reason, transcript_path, session_id, cwd } = payload;

  // Every deliberately-spawned subagent we've observed reports a real
  // agent_type. Events with agent_type missing have, so far, always
  // turned out to be internal harness bookkeeping (not user-facing
  // delegated work) whose transcript_path duplicates the whole main
  // session transcript. Drop these entirely rather than archive noise.
  if (!agent_type) return;

  const timestamp = new Date().toISOString();
  const safeType = sanitize(agent_type, 'unknown');
  const safeId = sanitize(agent_id, 'noid');

  const archiveRoot = path.join(dataDir(), 'archive');
  const indexPath = path.join(dataDir(), 'index.jsonl');

  let archivePath = null;
  let skippedReason = null;

  if (transcript_path && fs.existsSync(transcript_path)) {
    if (looksLikeSubagentTranscript(transcript_path)) {
      const destDir = path.join(archiveRoot, safeType);
      try {
        fs.mkdirSync(destDir, { recursive: true });
        const destFile = path.join(destDir, `${timestamp.replace(/[:.]/g, '-')}-${safeId}.jsonl`);
        fs.copyFileSync(transcript_path, destFile);
        archivePath = path.relative(dataDir(), destFile);
      } catch (err) {
        logError(err);
      }
    } else {
      skippedReason = 'transcript_path_not_a_subagent_transcript';
      logError(
        `Skipped archiving for agent_id=${agent_id || 'unknown'}: transcript_path ` +
        `"${transcript_path}" is not under a subagents/ directory (looks like the ` +
        `main session transcript, not a dedicated subagent transcript).`
      );
    }
  }

  const entry = {
    timestamp,
    agent_id: agent_id || null,
    agent_type: agent_type || null,
    exit_reason: exit_reason || null,
    session_id: session_id || null,
    cwd: cwd || null,
    last_assistant_message: (last_assistant_message || '').slice(0, MAX_SUMMARY_CHARS),
    archive_path: archivePath,
    skipped_reason: skippedReason,
  };

  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(indexPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    logError(err);
  }
}

function main() {
  try {
    run();
  } catch (err) {
    logError(err);
  }
  // SubagentStop hook contract: never block subagent completion.
  process.exit(0);
}

module.exports = { main };
