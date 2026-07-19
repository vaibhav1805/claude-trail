'use strict';

const { dataDir, globalSettingsPath } = require('../lib/paths');
const { removeHooks } = require('../lib/settingsMerge');
const { getServiceModule } = require('../lib/service');

function main() {
  const service = getServiceModule();
  service.uninstall();

  const hookResult = removeHooks(globalSettingsPath());

  console.log('claude-trail uninstall complete.');
  console.log(`  hooks removed from ${globalSettingsPath()}: ${hookResult.removed ? 'yes' : 'none were present'}`);
  console.log('  dashboard boot service: removed');
  console.log(`  data dir left in place: ${dataDir()}`);
  console.log('  (delete it yourself if you also want to remove archived transcripts and config)');
}

module.exports = { main };
