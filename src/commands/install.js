'use strict';

const fs = require('fs');
const { dataDir, globalSettingsPath } = require('../lib/paths');
const { writeDefaultConfigIfAbsent, configPath } = require('../lib/config');
const { upsertHooks } = require('../lib/settingsMerge');
const { getServiceModule } = require('../lib/service');
const { resolveRunCommand } = require('../lib/runCommand');

function main() {
  const runCommandParts = resolveRunCommand();

  fs.mkdirSync(dataDir(), { recursive: true });
  const wroteConfig = writeDefaultConfigIfAbsent();

  const hookResult = upsertHooks(globalSettingsPath(), runCommandParts);

  const service = getServiceModule();
  service.install(runCommandParts);
  service.start();
  const svcStatus = service.status();

  console.log('claude-trail install complete.');
  console.log(`  data dir: ${dataDir()}`);
  console.log(`  config: ${configPath()} ${wroteConfig ? '(created)' : '(already existed, left untouched)'}`);
  console.log(`  hooks registered in: ${globalSettingsPath()}`);
  console.log(`    SubagentStop -> claude-trail archive: ${hookResult.SubagentStop.action}`);
  console.log(`    SessionStart -> claude-trail prune: ${hookResult.SessionStart.action}`);
  console.log(`  dashboard service: installed=${svcStatus.installed} running=${svcStatus.running}`);
}

module.exports = { main };
