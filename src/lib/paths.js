'use strict';

const os = require('os');
const path = require('path');

// OS-standard per-user data directory — replaces "wherever the repo happens
// to be cloned," which only worked when this was a personal, single-machine
// script instead of an installable tool.
function dataDir() {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'claude-trail');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'claude-trail');
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) return path.join(xdgDataHome, 'claude-trail');
  return path.join(os.homedir(), '.local', 'share', 'claude-trail');
}

function globalSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

module.exports = { dataDir, globalSettingsPath };
