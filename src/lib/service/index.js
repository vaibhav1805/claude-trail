'use strict';

function getServiceModule() {
  if (process.platform === 'darwin') return require('./launchd');
  if (process.platform === 'win32') return require('./windowsTaskScheduler');
  return require('./systemd');
}

module.exports = { getServiceModule };
