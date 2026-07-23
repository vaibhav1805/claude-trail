'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_NAME = 'claude-trail-search';

// From source or npm-installed, skills/claude-trail-search/SKILL.md ships
// as a real file at a fixed location relative to this module. Under a SEA
// binary there's no such file on disk (single-file executable) — it's
// embedded as a named asset instead (see scripts/build-sea.js) and read
// back via node:sea.getAsset(), same pattern as the dashboard's index.html.
function sourceSkillPath() {
  return path.resolve(__dirname, '..', '..', 'skills', SKILL_NAME, 'SKILL.md');
}

// baseSkillsDir is the caller-resolved target (project or global — see
// lib/paths.js skillsDir()); this module only knows how to install into it.
function targetSkillDir(baseSkillsDir) {
  return path.join(baseSkillsDir, SKILL_NAME);
}

function targetSkillFile(baseSkillsDir) {
  return path.join(targetSkillDir(baseSkillsDir), 'SKILL.md');
}

function getSea() {
  try {
    const sea = require('node:sea');
    return sea.isSea() ? sea : null;
  } catch {
    return null;
  }
}

// Idempotent: re-running just confirms the link/copy is already correct.
function installSkill(baseSkillsDir) {
  const target = targetSkillFile(baseSkillsDir);
  fs.mkdirSync(targetSkillDir(baseSkillsDir), { recursive: true });

  const sea = getSea();
  if (sea) {
    fs.writeFileSync(target, Buffer.from(sea.getAsset('skill.md')));
    return { action: 'copied' };
  }

  const source = sourceSkillPath();
  try {
    const existingTarget = fs.readlinkSync(target);
    if (existingTarget === source) return { action: 'already-linked' };
  } catch {
    // not a symlink (or doesn't exist yet) — fall through and (re)create it
  }
  fs.rmSync(target, { force: true });
  try {
    fs.symlinkSync(source, target);
    return { action: 'linked' };
  } catch (err) {
    // Creating a symlink needs Developer Mode or admin rights on Windows —
    // don't let that take configure down. A plain copy works everywhere;
    // the only cost is it won't pick up future edits to the source file
    // without re-running configure.
    fs.copyFileSync(source, target);
    return { action: 'copied (symlink unavailable: ' + err.code + ')' };
  }
}

function uninstallSkill(baseSkillsDir) {
  const dir = targetSkillDir(baseSkillsDir);
  const existed = fs.existsSync(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: existed };
}

module.exports = { installSkill, uninstallSkill, targetSkillFile };
