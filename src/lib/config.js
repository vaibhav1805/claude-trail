'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const DEFAULTS = {
  retentionDays: 30,
  webPort: 4870,
  summaryMode: { enabled: true, model: 'haiku' },
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
  return { webPort, retentionDays, summaryMode };
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
