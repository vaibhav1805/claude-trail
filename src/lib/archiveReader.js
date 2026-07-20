'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

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

// Renders each transcript line down to {type, role, text, timestamp} so
// callers don't need to understand the full Claude Code transcript schema.
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

module.exports = {
  archiveDir,
  indexPath,
  readEntries,
  findEntryByArchivePath,
  extractText,
  resolveArchivePath,
  readTranscript,
};
