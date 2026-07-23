'use strict';

const { dataDir, settingsPath, skillsDir } = require('../lib/paths');
const { removeHooks } = require('../lib/settingsMerge');
const dashboardProcess = require('../lib/dashboardProcess');
const { uninstallSkill } = require('../lib/skillInstaller');

function main(argv) {
  const isGlobal = (argv || []).includes('--global');
  const targetSettingsPath = settingsPath(isGlobal);
  const targetSkillsDir = skillsDir(isGlobal);

  let hookResult;
  try {
    hookResult = removeHooks(targetSettingsPath);
  } catch (err) {
    console.error(`claude-trail clean failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const stopResult = dashboardProcess.stop();
  const skillResult = uninstallSkill(targetSkillsDir);

  console.log('claude-trail clean complete.');
  console.log(`  scope: ${isGlobal ? 'global (--global)' : 'project (this directory — pass --global for all projects)'}`);
  console.log(`  hooks removed from ${targetSettingsPath}: ${hookResult.removed ? 'yes' : 'none were present'}`);
  console.log(`  background dashboard stopped: ${stopResult.wasRunning ? 'yes' : 'was not running'}`);
  console.log(`  claude-trail-search skill removed: ${skillResult.removed ? 'yes' : 'was not present'}`);
  console.log(`  data dir left in place: ${dataDir()}`);
  console.log('  (delete it yourself if you also want to remove archived transcripts and config)');
}

module.exports = { main };
