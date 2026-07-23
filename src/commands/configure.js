'use strict';

const fs = require('fs');
const { dataDir, settingsPath, skillsDir } = require('../lib/paths');
const { writeDefaultConfigIfAbsent, configPath } = require('../lib/config');
const { upsertHooks } = require('../lib/settingsMerge');
const { resolveRunCommand } = require('../lib/runCommand');
const { installSkill, targetSkillFile } = require('../lib/skillInstaller');

function main(argv) {
  const isGlobal = (argv || []).includes('--global');
  const targetSettingsPath = settingsPath(isGlobal);
  const targetSkillsDir = skillsDir(isGlobal);
  const runCommandParts = resolveRunCommand();

  fs.mkdirSync(dataDir(), { recursive: true });
  const wroteConfig = writeDefaultConfigIfAbsent();

  let hookResult;
  try {
    hookResult = upsertHooks(targetSettingsPath, runCommandParts);
  } catch (err) {
    console.error(`claude-trail configure failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const skillResult = installSkill(targetSkillsDir);

  console.log('claude-trail configure complete.');
  console.log(`  scope: ${isGlobal ? 'global (--global)' : 'project (this directory — pass --global for all projects)'}`);
  console.log(`  data dir: ${dataDir()}`);
  console.log(`  config: ${configPath()} ${wroteConfig ? '(created)' : '(already existed, left untouched)'}`);
  console.log(`  hooks registered in: ${targetSettingsPath}`);
  console.log(`    SubagentStop -> claude-trail archive: ${hookResult.SubagentStop.action}`);
  console.log(`    SessionStart -> claude-trail prune: ${hookResult.SessionStart.action}`);
  console.log(`  claude-trail-search skill: ${targetSkillFile(targetSkillsDir)} (${skillResult.action})`);
  console.log('  dashboard: not started automatically — run `claude-trail dashboard` when you want it,');
  console.log('  or `claude-trail service start` to run it in the background until you stop it or reboot.');
}

module.exports = { main };
