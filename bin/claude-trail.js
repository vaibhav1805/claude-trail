#!/usr/bin/env node
'use strict';

const COMMANDS = {
  install: () => require('../src/commands/install'),
  uninstall: () => require('../src/commands/uninstall'),
  archive: () => require('../src/commands/archive'),
  prune: () => require('../src/commands/prune'),
  status: () => require('../src/commands/status'),
  dashboard: () => require('../src/commands/dashboard'),
  service: () => require('../src/commands/service'),
};

function printHelp() {
  console.log(`claude-trail — archive and browse Claude Code subagent transcripts

Usage:
  claude-trail install                             First-time setup (data dir, hooks, boot service)
  claude-trail uninstall                            Remove hooks and boot service
  claude-trail archive                              Archive a subagent transcript (invoked by the SubagentStop hook)
  claude-trail prune                                Prune old archived transcripts (invoked by the SessionStart hook)
  claude-trail status                               Print a summary of captured runs
  claude-trail dashboard [--port N]                 Run the local web dashboard
  claude-trail service <start|stop|restart|status>  Manage the dashboard's boot service
  claude-trail --version                            Print the installed version
  claude-trail --help                               Show this help
`);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === '--version' || cmd === '-v') {
    const pkg = require('../package.json');
    console.log(pkg.version);
    return;
  }

  const load = COMMANDS[cmd];
  if (!load) {
    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  load().main(argv.slice(1));
}

main();
