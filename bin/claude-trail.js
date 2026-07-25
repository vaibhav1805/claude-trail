#!/usr/bin/env node
'use strict';

const COMMANDS = {
  configure: () => require('../src/commands/configure'),
  clean: () => require('../src/commands/clean'),
  archive: () => require('../src/commands/archive'),
  'archive-main': () => require('../src/commands/archive-main'),
  prune: () => require('../src/commands/prune'),
  status: () => require('../src/commands/status'),
  search: () => require('../src/commands/search'),
  index: () => require('../src/commands/index'),
  dashboard: () => require('../src/commands/dashboard'),
  service: () => require('../src/commands/service'),
};

function printHelp() {
  console.log(`claude-trail — archive and browse Claude Code subagent transcripts

Usage:
  claude-trail configure [--global]                 First-time setup (data dir, hooks) — project-scoped by default
  claude-trail clean [--global]                     Remove hooks and stop the background dashboard
  claude-trail archive                              Archive a subagent transcript (invoked by the SubagentStop hook)
  claude-trail archive-main                         Archive main-session transcript deltas (invoked by PreCompact/SessionEnd;
                                                     no-op unless config.mainSessionCapture.enabled is true)
  claude-trail prune                                Prune old archived transcripts (invoked by the SessionStart hook)
  claude-trail status                               Print a summary of captured runs
  claude-trail search <query> [opts]                Search archived subagent transcripts for context
  claude-trail index [--limit N]                    Build/update the local semantic-search embedding index
  claude-trail dashboard [--port N] [--background]  Run the local web dashboard
  claude-trail service <start|stop|restart|status>  Run/stop the dashboard in the background
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
