'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const DEFAULTS = {
  retentionDays: 30,
  webPort: 4870,
  summaryMode: { enabled: true, model: 'haiku' },
  // Off by default: main-session transcripts carry the user's own prompts,
  // not just scoped subagent work — a materially bigger privacy surface than
  // what claude-trail captures otherwise. The PreCompact/SessionEnd hooks are
  // always wired (see settingsMerge.js) but archive-main.js no-ops unless
  // this is explicitly turned on.
  mainSessionCapture: { enabled: false },
  // Semantic search is opt-in: `claude-trail index` always works manually
  // regardless of this flag, but `enabled: true` also lets the SessionStart
  // -> prune hook run a small bounded auto-index pass (see prune.js) so new
  // entries stay searchable without a manual step. Off by default because it
  // requires the optional @huggingface/transformers dependency (not
  // installed by default-safe npm installs on every platform, and entirely
  // unavailable in the SEA binaries) and a one-time model download.
  semanticSearch: { enabled: false, model: 'Xenova/all-MiniLM-L6-v2', autoIndexLimit: 20 },
};

function configPath() {
  return path.join(dataDir(), 'config.json');
}

function loadConfig() {
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    // missing/invalid config falls through to defaults
  }
  const webPort = typeof parsed.webPort === 'number' && parsed.webPort > 0 ? parsed.webPort : DEFAULTS.webPort;
  const retentionDays =
    typeof parsed.retentionDays === 'number' && parsed.retentionDays > 0
      ? parsed.retentionDays
      : DEFAULTS.retentionDays;
  const summaryModeRaw = parsed.summaryMode && typeof parsed.summaryMode === 'object' ? parsed.summaryMode : {};
  const summaryMode = {
    enabled: typeof summaryModeRaw.enabled === 'boolean' ? summaryModeRaw.enabled : DEFAULTS.summaryMode.enabled,
    model:
      typeof summaryModeRaw.model === 'string' && summaryModeRaw.model
        ? summaryModeRaw.model
        : DEFAULTS.summaryMode.model,
  };
  const mainSessionCaptureRaw =
    parsed.mainSessionCapture && typeof parsed.mainSessionCapture === 'object' ? parsed.mainSessionCapture : {};
  const mainSessionCapture = {
    enabled:
      typeof mainSessionCaptureRaw.enabled === 'boolean'
        ? mainSessionCaptureRaw.enabled
        : DEFAULTS.mainSessionCapture.enabled,
  };
  const semanticSearchRaw =
    parsed.semanticSearch && typeof parsed.semanticSearch === 'object' ? parsed.semanticSearch : {};
  const semanticSearch = {
    enabled:
      typeof semanticSearchRaw.enabled === 'boolean' ? semanticSearchRaw.enabled : DEFAULTS.semanticSearch.enabled,
    model:
      typeof semanticSearchRaw.model === 'string' && semanticSearchRaw.model
        ? semanticSearchRaw.model
        : DEFAULTS.semanticSearch.model,
    autoIndexLimit:
      typeof semanticSearchRaw.autoIndexLimit === 'number' && semanticSearchRaw.autoIndexLimit > 0
        ? semanticSearchRaw.autoIndexLimit
        : DEFAULTS.semanticSearch.autoIndexLimit,
  };
  return { webPort, retentionDays, summaryMode, mainSessionCapture, semanticSearch };
}

// Called only by `install` — never overwrites a config a user has already edited.
function writeDefaultConfigIfAbsent() {
  const p = configPath();
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(DEFAULTS, null, 2) + '\n');
  return true;
}

module.exports = { loadConfig, configPath, writeDefaultConfigIfAbsent, DEFAULTS };
