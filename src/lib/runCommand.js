'use strict';

const path = require('path');

// Returns the argv prefix needed to invoke claude-trail from an external
// process (a hook runner, launchd, systemd, schtasks) whose PATH may not
// include `node` — confirmed live: launchd's minimal environment can't
// resolve `#!/usr/bin/env node`, which is exactly why this repo's own
// original hook wiring hardcoded a full node binary path instead of
// relying on the shebang. Under plain-Node execution (Phase A) this
// resolves to [node execPath, script path]; once SEA-packaged (Phase B)
// the binary is self-contained and node:sea.isSea() reports true, so it
// resolves to just [binaryPath].
function resolveRunCommand() {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return [process.execPath];
  } catch {
    // node:sea unavailable — not running as an SEA binary
  }
  return [process.execPath, path.resolve(process.argv[1])];
}

module.exports = { resolveRunCommand };
