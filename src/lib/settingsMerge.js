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
  // Main-session capture is opt-in (config.mainSessionCapture.enabled, off by
  // default — see config.js) but the hooks themselves are always wired so
  // toggling the config on doesn't require re-running `configure`.
  // archive-main.js no-ops immediately when the config flag is off.
  PreCompact: {
    matchPattern: matcherFor('archive-main'),
    buildHook: (runCommandParts) => ({
      type: 'command',
      command: formatCommand(runCommandParts, ['archive-main']),
      timeout: 10,
      async: true,
    }),
  },
  SessionEnd: {
    matchPattern: matcherFor('archive-main'),
    buildHook: (runCommandParts) => ({
      type: 'command',
      command: formatCommand(runCommandParts, ['archive-main']),
      timeout: 10,
      async: true,
    }),
  },
};

// Only missing-file is a real "nothing here yet" case — fall back silently.
// A file that exists but fails to parse (mid-edit, trailing comma, etc.)
// must NOT fall back silently: upsertHooks/removeHooks would then write
// that fallback straight back over the real file, discarding whatever
// was actually there. Throw instead so configure/clean abort loudly
// rather than quietly destroying a hand-edited settings.json.
function readJsonOrDefault(filePath, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${filePath} exists but isn't valid JSON — refusing to touch it to avoid ` +
      `overwriting whatever's actually there. Fix the JSON syntax and try again. (${err.message})`
    );
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
