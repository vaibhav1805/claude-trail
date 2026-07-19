'use strict';

const { execFileSync } = require('child_process');

const TASK_NAME = 'claude-trail-dashboard';

// Admin-free by design: schtasks with /sc onlogon needs no elevation, but
// as a result the dashboard starts at user logon, not raw machine boot.
// A true Windows Service is a possible future upgrade requiring an
// elevated installer — deliberately out of scope here.
function install(runCommandParts) {
  const command = [...runCommandParts.map((p) => `"${p}"`), 'dashboard'].join(' ');
  execFileSync(
    'schtasks',
    ['/create', '/tn', TASK_NAME, '/tr', command, '/sc', 'onlogon', '/rl', 'limited', '/f'],
    { stdio: 'pipe' }
  );
  return { manual: false };
}

function start() {
  try {
    execFileSync('schtasks', ['/run', '/tn', TASK_NAME], { stdio: 'pipe' });
  } catch {
    // will start at next logon regardless
  }
}

function stop() {
  try {
    execFileSync('schtasks', ['/end', '/tn', TASK_NAME], { stdio: 'pipe' });
  } catch {
    // not running
  }
}

function uninstall() {
  try {
    execFileSync('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], { stdio: 'pipe' });
  } catch {
    // already gone
  }
}

function status() {
  try {
    const out = execFileSync('schtasks', ['/query', '/tn', TASK_NAME, '/fo', 'list'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { installed: true, running: /Status:\s*Running/i.test(out) };
  } catch {
    return { installed: false, running: false };
  }
}

module.exports = { install, uninstall, start, stop, status };
