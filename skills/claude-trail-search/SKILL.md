---
name: claude-trail-search
description: Search Claude Code subagent transcripts (and, if enabled, main-session history) archived by claude-trail for prior context — by keyword, full-text, or paraphrase-aware semantic search. Use PROACTIVELY before investigating a bug, design question, or codebase area that a past subagent might already have looked into, or before starting work similar in shape to something recently delegated to a subagent — even if the user hasn't asked to search. Also use when the user explicitly asks "have we hit this before", "what did that agent find/do", to search claude-trail, or to look up past subagent work.
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

If `--deep` still comes up empty but you have a real reason to believe something relevant was archived under different wording (a paraphrase, not the same words), try semantic search instead of concluding nothing exists:

```bash
$CT search "<query>" --semantic --limit 5
```

Requires `claude-trail index` to have been run at least once, and only works if the optional embedding dependency is installed — if it errors, fall back to reporting no match rather than treating the error as a dead end worth pursuing further. Read the similarity scores: a result whose score is far above the rest is a real hit; several closely-scored results (especially low ones) usually mean the query didn't land on anything specific — don't present those with the same confidence as a clear top match.

Narrow with `--type <agent_type>` when relevant — `--type main-session` searches only main-session captures, on machines where that's enabled. Add `--json` for structured output instead of reading text directly.

## Read full context — do this before answering, not after

A search result's excerpt is a pointer, not the answer. If a match looks relevant, pull its full transcript **before** replying — don't stop at "a subagent looked into this" and offer to fetch more only if asked. Each match includes an `archive_path`:

```bash
$CT search --show "<archive_path>"
```

Prints the full cleaned transcript (harness/bookkeeping lines stripped) as `--- ROLE ---` blocks. Read that output, then actually answer the question using it as your source — quote or closely paraphrase the substance, the way you would from any other document you just read. Don't confuse "I found where this was answered" with "I answered it" — the second one is the job. Reserve *offering* to pull more detail for when the excerpt is genuinely ambiguous about relevance, not as a substitute for reading it yourself.

## Interpret results

- Treat no matches as "nothing found in the archive," not "this never came up" — retention defaults to 30 days, and only machines with claude-trail configured get captured.
- Cite where it came from naturally (e.g. "a subagent looked into this on 2026-07-14 and found X") but lead with the substance, not the fact that you found something.
- Treat archived findings as a snapshot, not ground truth — verify against current code before relying on them.
