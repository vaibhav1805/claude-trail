'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { dataDir } = require('../paths');

const LABEL = 'com.claude-trail.dashboard';

function plistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function logsDir() {
  return path.join(dataDir(), 'logs');
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function plistContents(runCommandParts) {
  const logFile = path.join(logsDir(), 'dashboard.log');
  const argStrings = [...runCommandParts, 'dashboard']
    .map((part) => `    <string>${xmlEscape(part)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argStrings}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
</dict>
</plist>
`;
}

function domain() {
  return `gui/${process.getuid ? process.getuid() : 0}`;
}

function install(runCommandParts) {
  fs.mkdirSync(logsDir(), { recursive: true });
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), plistContents(runCommandParts));
  return { manual: false };
}

function start() {
  // `bootstrap` is not idempotent and returns a cryptic, macOS-version-
  // dependent error (commonly "5: Input/output error", not any message
  // that reliably says "already loaded") when the job is already loaded.
  // Unconditionally boot out any existing instance first so bootstrap
  // always starts from a clean slate instead of parsing fragile error text.
  try {
    execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'pipe' });
  } catch {
    // wasn't loaded — fine
  }
  execFileSync('launchctl', ['bootstrap', domain(), plistPath()], { stdio: 'pipe' });
  execFileSync('launchctl', ['enable', `${domain()}/${LABEL}`], { stdio: 'pipe' });
}

function stop() {
  try {
    execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'pipe' });
  } catch {
    // not loaded — nothing to stop
  }
}

function uninstall() {
  stop();
  try {
    fs.unlinkSync(plistPath());
  } catch {
    // already gone
  }
}

function status() {
  const installed = fs.existsSync(plistPath());
  try {
    const out = execFileSync('launchctl', ['print', `${domain()}/${LABEL}`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { installed, running: /state = running/.test(out) };
  } catch {
    return { installed, running: false };
  }
}

module.exports = { install, uninstall, start, stop, status };
