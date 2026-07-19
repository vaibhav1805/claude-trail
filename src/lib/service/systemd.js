'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const UNIT_NAME = 'claude-trail.service';

function unitPath() {
  return path.join(os.homedir(), '.config', 'systemd', 'user', UNIT_NAME);
}

function systemdAvailable() {
  return fs.existsSync('/run/systemd/system');
}

function quoteForUnit(part) {
  return /\s/.test(part) ? `"${part}"` : part;
}

function unitContents(runCommandParts) {
  const execStart = [...runCommandParts.map(quoteForUnit), 'dashboard'].join(' ');
  return `[Unit]
Description=claude-trail dashboard

[Service]
ExecStart=${execStart}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

function manualInstructions(runCommandParts) {
  const cmd = [...runCommandParts.map(quoteForUnit), 'dashboard'].join(' ');
  return (
    `systemd isn't available on this system. To start the dashboard at login manually, add ` +
    `this line to your crontab (crontab -e):\n@reboot ${cmd} &\n`
  );
}

function install(runCommandParts) {
  if (!systemdAvailable()) {
    console.error(manualInstructions(runCommandParts));
    return { manual: true };
  }
  fs.mkdirSync(path.dirname(unitPath()), { recursive: true });
  fs.writeFileSync(unitPath(), unitContents(runCommandParts));
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  return { manual: false };
}

function start() {
  if (!systemdAvailable()) return;
  execFileSync('systemctl', ['--user', 'enable', '--now', UNIT_NAME], { stdio: 'pipe' });
  try {
    execFileSync('loginctl', ['enable-linger', os.userInfo().username], { stdio: 'pipe' });
  } catch {
    console.error(
      `Note: could not enable linger automatically. To make the dashboard start at actual ` +
      `machine boot (not just login), run: sudo loginctl enable-linger ${os.userInfo().username}`
    );
  }
}

function stop() {
  if (!systemdAvailable()) return;
  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', UNIT_NAME], { stdio: 'pipe' });
  } catch {
    // not running — nothing to stop
  }
}

function uninstall() {
  stop();
  try {
    fs.unlinkSync(unitPath());
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  } catch {
    // already gone
  }
}

function status() {
  if (!systemdAvailable()) return { installed: false, running: false, manual: true };
  const installed = fs.existsSync(unitPath());
  try {
    const out = execFileSync('systemctl', ['--user', 'is-active', UNIT_NAME], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { installed, running: out === 'active' };
  } catch {
    return { installed, running: false };
  }
}

module.exports = { install, uninstall, start, stop, status };
