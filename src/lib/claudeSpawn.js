'use strict';

const { spawn, execFileSync } = require('child_process');

// On Windows, npm-installed CLIs are often `.cmd`/`.bat` shims that
// child_process.spawn won't resolve without shell:true — an unnecessary
// shell-injection surface to take on just to find an executable. Resolve
// the concrete path up front instead and spawn that directly.
function resolveClaudeCommand() {
  if (process.platform !== 'win32') return 'claude';
  try {
    const out = execFileSync('where', ['claude'], { encoding: 'utf8' });
    const first = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];
    if (first) return first;
  } catch {
    // fall through — spawn will fail with a clear ENOENT instead
  }
  return 'claude';
}

function spawnClaude(args, opts) {
  return spawn(resolveClaudeCommand(), args, opts);
}

module.exports = { spawnClaude, resolveClaudeCommand };
