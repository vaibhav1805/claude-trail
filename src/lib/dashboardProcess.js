'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { dataDir } = require('./paths');

// Manages the dashboard as a plain detached background process tracked by a
// pidfile — deliberately not an OS-level boot service (launchd/systemd/Task
// Scheduler). The dashboard is something you open occasionally to browse
// captures, not something that needs to survive a reboot; this covers
// "survive closing the terminal" without the per-OS install/uninstall
// surface that model required.

function pidFilePath() {
  return path.join(dataDir(), 'dashboard.pid');
}

function logFilePath() {
  return path.join(dataDir(), 'logs', 'dashboard.log');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

// Returns the live state, clearing a stale pidfile (process no longer
// running) as a side effect so callers never have to think about staleness.
function status() {
  const recorded = readPidFile();
  if (!recorded) return { running: false };
  if (isAlive(recorded.pid)) return { running: true, pid: recorded.pid, port: recorded.port };
  try {
    fs.unlinkSync(pidFilePath());
  } catch {
    // already gone
  }
  return { running: false };
}

function start(runCommandParts, port) {
  const existing = status();
  if (existing.running) return { alreadyRunning: true, pid: existing.pid, port: existing.port };

  fs.mkdirSync(path.dirname(logFilePath()), { recursive: true });
  const logFd = fs.openSync(logFilePath(), 'a');

  const [cmd, ...args] = runCommandParts;
  const child = spawn(cmd, [...args, 'dashboard', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  child.unref();

  fs.writeFileSync(pidFilePath(), JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }));
  return { alreadyRunning: false, pid: child.pid, port };
}

function stop() {
  const existing = status();
  if (!existing.running) return { wasRunning: false };
  try {
    process.kill(existing.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  try {
    fs.unlinkSync(pidFilePath());
  } catch {
    // already gone
  }
  return { wasRunning: true, pid: existing.pid };
}

module.exports = { pidFilePath, logFilePath, status, start, stop };
