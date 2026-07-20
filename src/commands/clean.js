'use strict';

const { dataDir, globalSettingsPath } = require('../lib/paths');
const { removeHooks } = require('../lib/settingsMerge');
const dashboardProcess = require('../lib/dashboardProcess');

function main() {
  const hookResult = removeHooks(globalSettingsPath());
  const stopResult = dashboardProcess.stop();

  console.log('claude-trail clean complete.');
  console.log(`  hooks removed from ${globalSettingsPath()}: ${hookResult.removed ? 'yes' : 'none were present'}`);
  console.log(`  background dashboard stopped: ${stopResult.wasRunning ? 'yes' : 'was not running'}`);
  console.log(`  data dir left in place: ${dataDir()}`);
  console.log('  (delete it yourself if you also want to remove archived transcripts and config)');
}

module.exports = { main };
