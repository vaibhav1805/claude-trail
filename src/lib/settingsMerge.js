'use strict';

const fs = require('fs');
const path = require('path');

// Idempotent, surgical upsert of claude-trail's two hooks into a Claude Code
// settings.json that may already contain many other tools' hook entries
// (verified against a real ~/.claude/settings.json with 4+ other tools
// wired in). This must NEVER touch anything outside the exact hook entries
// it owns — not other event names, not other hooks within the same event,
// not any top-level key.

// runCommandParts is an array like [nodeExecPath, scriptPath] (Phase A,
// plain Node) or [binaryPath] (Phase B, SEA) — see lib/runCommand.js.
function formatCommand(runCommandParts, args) {
  return [...runCommandParts.map((p) => JSON.stringify(p)), ...args].join(' ');
}

// Matches on "claude-trail" (regardless of extension: .js, .exe, or none)
// followed eventually by the subcommand as the final token — robust to
// however many quoted path segments precede it (a bare SEA binary path vs.
// a [node, script] pair) and to the extension changing between phases.
function matcherFor(subcommand) {
  return new RegExp(`claude-trail[^\\s"']*["']?\\s+${subcommand}\\s*$`);
}

const HOOK_DEFS = {
  SubagentStop: {
    matchPattern: matcherFor('archive'),
    buildHook: (runCommandParts) => ({
      type: 'command',
      command: formatCommand(runCommandParts, ['archive']),
      timeout: 10,
    }),
  },
  SessionStart: {
    matchPattern: matcherFor('prune'),
    buildHook: (runCommandParts) => ({
      type: 'command',
      command: formatCommand(runCommandParts, ['prune']),
      timeout: 15,
      async: true,
    }),
  },
};

function readJsonOrDefault(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function upsertEventEntry(hooksRoot, eventName, matchPattern, hookDef) {
  hooksRoot[eventName] = Array.isArray(hooksRoot[eventName]) ? hooksRoot[eventName] : [];
  const blocks = hooksRoot[eventName];

  for (const block of blocks) {
    if (!block || !Array.isArray(block.hooks)) continue;
    for (const hook of block.hooks) {
      if (hook && typeof hook.command === 'string' && matchPattern.test(hook.command)) {
        Object.assign(hook, hookDef);
        return 'updated';
      }
    }
  }

  blocks.push({ hooks: [hookDef] });
  return 'added';
}

function upsertHooks(settingsPath, runCommandParts) {
  const settings = readJsonOrDefault(settingsPath, {});
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

  const results = {};
  for (const [eventName, def] of Object.entries(HOOK_DEFS)) {
    results[eventName] = {
      action: upsertEventEntry(settings.hooks, eventName, def.matchPattern, def.buildHook(runCommandParts)),
    };
  }

  writeJsonAtomic(settingsPath, settings);
  return results;
}

function removeHooks(settingsPath) {
  const settings = readJsonOrDefault(settingsPath, null);
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') return { removed: false };

  let anyRemoved = false;
  for (const [eventName, def] of Object.entries(HOOK_DEFS)) {
    const blocks = settings.hooks[eventName];
    if (!Array.isArray(blocks)) continue;

    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i];
      if (!block || !Array.isArray(block.hooks)) continue;
      const before = block.hooks.length;
      block.hooks = block.hooks.filter(
        (hook) => !(hook && typeof hook.command === 'string' && def.matchPattern.test(hook.command))
      );
      if (block.hooks.length !== before) anyRemoved = true;
      if (block.hooks.length === 0) blocks.splice(i, 1);
    }

    if (blocks.length === 0) delete settings.hooks[eventName];
  }

  if (anyRemoved) writeJsonAtomic(settingsPath, settings);
  return { removed: anyRemoved };
}

module.exports = { upsertHooks, removeHooks, HOOK_DEFS, formatCommand };
