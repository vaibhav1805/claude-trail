'use strict';

const { getServiceModule } = require('../lib/service');

function main(argv) {
  const sub = argv[0];
  const service = getServiceModule();

  if (sub === 'start') {
    service.start();
    console.log('claude-trail dashboard service started.');
    return;
  }
  if (sub === 'stop') {
    service.stop();
    console.log('claude-trail dashboard service stopped.');
    return;
  }
  if (sub === 'restart') {
    service.stop();
    service.start();
    console.log('claude-trail dashboard service restarted.');
    return;
  }
  if (sub === 'status') {
    const s = service.status();
    console.log(`installed: ${s.installed}`);
    console.log(`running: ${s.running}`);
    return;
  }

  console.error('Usage: claude-trail service <start|stop|restart|status>');
  process.exitCode = 1;
}

module.exports = { main };
