'use strict';

const dashboardProcess = require('../lib/dashboardProcess');
const { resolveRunCommand } = require('../lib/runCommand');
const { loadConfig } = require('../lib/config');

function main(argv) {
  const sub = argv[0];

  if (sub === 'start') {
    const { webPort } = loadConfig();
    const result = dashboardProcess.start(resolveRunCommand(), webPort);
    if (result.alreadyRunning) {
      console.log(`claude-trail dashboard already running: http://127.0.0.1:${result.port} (pid ${result.pid})`);
      return;
    }
    console.log(`claude-trail dashboard started: http://127.0.0.1:${result.port} (pid ${result.pid})`);
    return;
  }
  if (sub === 'stop') {
    const result = dashboardProcess.stop();
    console.log(result.wasRunning ? `claude-trail dashboard stopped (pid ${result.pid}).` : 'claude-trail dashboard was not running.');
    return;
  }
  if (sub === 'restart') {
    dashboardProcess.stop();
    const { webPort } = loadConfig();
    const result = dashboardProcess.start(resolveRunCommand(), webPort);
    console.log(`claude-trail dashboard restarted: http://127.0.0.1:${result.port} (pid ${result.pid})`);
    return;
  }
  if (sub === 'status') {
    const s = dashboardProcess.status();
    console.log(`running: ${s.running}`);
    if (s.running) {
      console.log(`pid: ${s.pid}`);
      console.log(`port: ${s.port}`);
    }
    return;
  }

  console.error('Usage: claude-trail service <start|stop|restart|status>');
  process.exitCode = 1;
}

module.exports = { main };
