---
name: claude-trail-search
description: Search Claude Code subagent transcripts archived by claude-trail's SubagentStop hook for prior context. Use PROACTIVELY before investigating a bug, design question, or codebase area that a past subagent might already have looked into, or before starting work similar in shape to something recently delegated to a subagent — even if the user hasn't asked to search. Also use when the user explicitly asks "have we hit this before", "what did that agent find/do", to search claude-trail, or to look up past subagent work.
---

# claude-trail-search

Wraps the `claude-trail search` CLI, which searches transcripts archived by [claude-trail](https://github.com/vaibhav1805/claude-trail).

## Resolve the binary

claude-trail isn't always on PATH — resolve once per session:

```bash
command -v claude-trail >/dev/null 2>&1 && CT=claude-trail || CT=""
```

If `$CT` is empty, claude-trail likely isn't installed on this machine — don't guess at a path. Tell the user briefly (e.g. "claude-trail isn't on PATH — install with `npm install -g @flurryhead/claude-trail` or grab a release binary") instead of silently skipping the search.

## Search

Run an index search first — fast, matches only `agent_type`, `cwd`, and the last assistant message:

```bash
$CT search "<query>" --limit 5
```

If nothing useful comes back, rerun with `--deep` to scan full transcript bodies — slower, but catches matches buried mid-conversation:

```bash
$CT search "<query>" --deep --limit 5
```

Narrow with `--type <agent_type>` when relevant. Add `--json` for structured output instead of reading text directly.

## Read full context

Each match includes an `archive_path`. To read the whole conversation instead of just the matched excerpt:

```bash
$CT search --show "<archive_path>"
```

Prints the full cleaned transcript (harness/bookkeeping lines stripped) as `--- ROLE ---` blocks.

## Interpret results

- Treat no matches as "nothing found in the archive," not "this never came up" — retention defaults to 30 days, and only machines with claude-trail configured get captured.
- Weave findings into the response naturally (e.g. "a subagent looked into this on 2026-07-14 and found X") rather than pasting raw transcript text.
- Treat archived findings as a snapshot, not ground truth — verify against current code before relying on them.
