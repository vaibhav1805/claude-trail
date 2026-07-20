'use strict';

const fs = require('fs');
const path = require('path');
const { claudeSkillsDir } = require('./paths');

const SKILL_NAME = 'claude-trail-search';

// From source or npm-installed, skills/claude-trail-search/SKILL.md ships
// as a real file at a fixed location relative to this module. Under a SEA
// binary there's no such file on disk (single-file executable) — it's
// embedded as a named asset instead (see scripts/build-sea.js) and read
// back via node:sea.getAsset(), same pattern as the dashboard's index.html.
function sourceSkillPath() {
  return path.resolve(__dirname, '..', '..', 'skills', SKILL_NAME, 'SKILL.md');
}

function targetSkillDir() {
  return path.join(claudeSkillsDir(), SKILL_NAME);
}

function targetSkillFile() {
  return path.join(targetSkillDir(), 'SKILL.md');
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
function installSkill() {
  const target = targetSkillFile();
  fs.mkdirSync(targetSkillDir(), { recursive: true });

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
  fs.symlinkSync(source, target);
  return { action: 'linked' };
}

function uninstallSkill() {
  const dir = targetSkillDir();
  const existed = fs.existsSync(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: existed };
}

module.exports = { installSkill, uninstallSkill, targetSkillFile };
