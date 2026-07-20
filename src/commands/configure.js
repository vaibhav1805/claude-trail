'use strict';

const fs = require('fs');
const { dataDir, globalSettingsPath } = require('../lib/paths');
const { writeDefaultConfigIfAbsent, configPath } = require('../lib/config');
const { upsertHooks } = require('../lib/settingsMerge');
const { resolveRunCommand } = require('../lib/runCommand');
const { installSkill, targetSkillFile } = require('../lib/skillInstaller');

function main() {
  const runCommandParts = resolveRunCommand();

  fs.mkdirSync(dataDir(), { recursive: true });
  const wroteConfig = writeDefaultConfigIfAbsent();

  const hookResult = upsertHooks(globalSettingsPath(), runCommandParts);
  const skillResult = installSkill();

  console.log('claude-trail configure complete.');
  console.log(`  data dir: ${dataDir()}`);
  console.log(`  config: ${configPath()} ${wroteConfig ? '(created)' : '(already existed, left untouched)'}`);
  console.log(`  hooks registered in: ${globalSettingsPath()}`);
  console.log(`    SubagentStop -> claude-trail archive: ${hookResult.SubagentStop.action}`);
  console.log(`    SessionStart -> claude-trail prune: ${hookResult.SessionStart.action}`);
  console.log(`  claude-trail-search skill: ${targetSkillFile()} (${skillResult.action})`);
  console.log('  dashboard: not started automatically — run `claude-trail dashboard` when you want it,');
  console.log('  or `claude-trail service start` to run it in the background until you stop it or reboot.');
}

module.exports = { main };
