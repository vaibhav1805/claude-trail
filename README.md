# claude-trail

A small, dependency-free Node.js CLI that archives Claude Code subagent transcripts as they complete, so past subagent work stays searchable instead of disappearing when a session ends. Includes a local web dashboard for browsing captures.

> **Status:** the packaged, publicly-installable release (`curl | sh`, prebuilt binaries, no Node required) doesn't exist yet. Right now this runs from source with plain Node — see [Running from source](#running-from-source) below. `install.sh`/`install.ps1` and prebuilt binaries are a planned later phase.

## Commands

```
claude-trail install                             First-time setup (data dir, hooks, boot service)
claude-trail uninstall                            Remove hooks and boot service
claude-trail archive                              Archive a subagent transcript (invoked by the SubagentStop hook)
claude-trail prune                                Prune old archived transcripts (invoked by the SessionStart hook)
claude-trail status                               Print a summary of captured runs
claude-trail dashboard [--port N]                 Run the local web dashboard
claude-trail service <start|stop|restart|status>  Manage the dashboard's boot service
claude-trail --version                            Print the installed version
claude-trail --help                               Show this help
```

## Running from source

```
node bin/claude-trail.js install
```

This is the whole install flow for now — clone the repo, run `install` with plain Node. `install` is idempotent (safe to re-run) and:

1. Creates the OS-standard data directory (see below).
2. Writes a default `config.json` there, **only if one doesn't already exist**.
3. Registers two hooks in your **global** `~/.claude/settings.json` — `SubagentStop → claude-trail archive` and `SessionStart → claude-trail prune` (async) — surgically merged in: only claude-trail's own entries are touched, every other tool's hooks in that file are left byte-for-byte untouched.
4. Installs and starts a boot service that runs `claude-trail dashboard` (see [Boot service](#boot-service-per-os) below).

`claude-trail uninstall` reverses all of it — removes only claude-trail's hook entries, stops and removes the boot service — but **leaves the data directory in place** so you decide whether to keep your archive.

Both the registered hooks and the boot service invoke the exact Node binary and script path that were active when you ran `install` (`process.execPath` + the resolved script path) — not a bare `node` on PATH. This matters because hook runners and OS service managers (especially launchd) often run with a minimal environment that can't resolve `node` via `#!/usr/bin/env node`.

## Data directory

Replaces "wherever the repo happens to be cloned" from earlier versions of this tool — `config.json`, `index.jsonl`, `hook-errors.log`, and `archive/` all live here instead:

- macOS: `~/Library/Application Support/claude-trail`
- Linux: `$XDG_DATA_HOME/claude-trail` or `~/.local/share/claude-trail`
- Windows: `%APPDATA%\claude-trail`

If you have an older local clone with data at the repo root (`config.json`, `index.jsonl`, `archive/`, `hook-errors.log`), move it into the new data directory by hand — this is a one-time manual step, not something `install` automates.

## Boot service per OS

`claude-trail service <start|stop|restart|status>` manages it manually; `install`/`uninstall` handle registration.

- **macOS** — a launchd LaunchAgent (`~/Library/LaunchAgents/com.claude-trail.dashboard.plist`), `RunAtLoad` + `KeepAlive` (restarts on crash). Logs to `<data dir>/logs/dashboard.log`.
- **Linux** — a systemd user unit (`~/.config/systemd/user/claude-trail.service`). `install` also attempts `loginctl enable-linger` so the dashboard starts at actual machine boot, not just at login — if that fails (restricted/managed systems), it prints a one-line manual fallback instead of failing. On systemd-less distros, `install` prints manual `@reboot` crontab instructions instead.
- **Windows** — a Task Scheduler entry (admin-free, `/sc onlogon`). **Limitation:** this starts the dashboard at user logon, not raw machine boot — there's no admin-free equivalent to launchd/systemd on Windows. A true Windows Service is a possible future upgrade, deliberately out of scope for now.

## Viewing captured runs

**Quick summary:**
```
node bin/claude-trail.js status
```
Prints the data directory, total entries, a breakdown by `agent_type`, oldest/newest capture timestamps, current `retentionDays`, and on-disk archive size.

**Dashboard:**
```
node bin/claude-trail.js dashboard
```
Then open `http://127.0.0.1:<webPort>` (default `4870`) — or just let the boot service keep it running after `install`. Left sidebar lists captured runs, filterable by `agent_type`, text, or `cwd`; right pane shows the transcript for whatever row you click.

The transcript view drops pure harness/session bookkeeping lines (`mode`, `permission-mode`, `file-history-snapshot`, `file-history-delta`, `attachment`, `last-prompt`, `ai-title`, `queue-operation`, `system`) — only `user`/`assistant` message content is shown. Display-time filter only; the archived `.jsonl` file itself is untouched.

No runtime dependencies — the dashboard uses only Node's built-in `http`, `fs`, `path`, `url`, and `child_process` modules.

### Summary mode

A "Summary" tab next to "Trace" generates a short, structured summary (task / approach / outcome / notable issues) instead of showing the full trace. On-demand — nothing is generated until you click the tab.

Works by shelling out to the local `claude` CLI in headless mode (`claude -p --bare --tools ""`), reusing whatever auth your Claude Code install already has — no separate API key. Tool use and hooks are disabled for this call; it only ever reads the prompt text it's given and returns text. Each summary is cached to `<archived-transcript>.summary.json` next to the transcript, so re-opening an entry doesn't re-run the LLM call — "Regenerate" forces a refresh. `claude-trail prune` removes these cache files along with their transcript when an entry ages out.

## Configuration

Edit `config.json` in the data directory:

```json
{
  "retentionDays": 30,
  "webPort": 4870,
  "summaryMode": {
    "enabled": true,
    "model": "haiku"
  }
}
```

- `retentionDays` — how long archived transcripts and index entries are kept before `claude-trail prune` removes them. Defaults to 30 if missing or invalid.
- `webPort` — the port `claude-trail dashboard` binds to. Defaults to 4870 if missing or invalid.
- `summaryMode.enabled` — whether the "Summary" tab and `/api/summary` endpoint are available. Defaults to `true`.
- `summaryMode.model` — the model alias passed to `claude -p --model`. Defaults to `haiku`.

## Privacy / safety

- Archived transcripts can contain anything a subagent read, wrote, or discussed — treat the data directory like any other sensitive local data.
- The dashboard binds to `127.0.0.1` only; it is never reachable from outside the machine.
- The `/api/transcript` and `/api/summary` endpoints resolve and check the requested path stays under the archive directory, guarding against path traversal.
- `claude-trail archive` (the `SubagentStop` hook) fails safe: any error is logged to `hook-errors.log`, and it always exits 0 so it never blocks a subagent from completing.
- Summary mode sends transcript content to the model via your existing local `claude` CLI session — the same trust boundary as any other Claude Code usage on this machine, just triggered from this tool instead of interactively.
- `install` only ever edits the `SubagentStop` and `SessionStart` arrays in `~/.claude/settings.json`, and only the specific entries it owns within them — verified against a real settings.json with several other tools' hooks already registered.
