# Claude Code session hooks

Every wakeup briefing ends with a two-line **memory protocol**: a *recall*
rubric (when to reach for prior knowledge instead of re-deriving it) and its
session-end twin, a *remember* rubric (the three conditions worth writing
down, in your own words, before the session ends). The rubric is policy, not
retrieved data — the briefing stays bounded by a hard 3,072-byte ceiling with
the rubric as non-droppable content
([ADR 0118.1](../adr/0118.1-intent-gated-recall-lifecycle-hooks.md)).

The client owns the hooks. This recipe injects a briefing; it does not invoke
recall or author memory bodies (ADR 0118.1 R1). Managed task completion can
still capture an episode through the core
([ADR 0092.2](../adr/0092.2-phase-3-implicit-episodic-capture.md)). To mount the
briefing in Claude Code, add a `SessionStart` command hook to
`.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "npx backlog-mcp --home project --project-root \"$CLAUDE_PROJECT_DIR\" wakeup --max-knowledge 0 --max-constraints 3 --max-completions 3 --max-activity 3 | jq -Rs '{hookSpecificOutput:{hookEventName:\"SessionStart\",additionalContext:.}}'",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The recipe requires `jq` and an available `npx` executable. `--max-knowledge 0`
keeps retrieved memory bodies out of session-start context; the agent recalls
when its intent warrants it. A command hook can run without an MCP connection.

Checked against the [official Claude Code hook reference](https://code.claude.com/docs/en/hooks)
on 2026-10-05: `SessionStart` accepts the four matcher values above and supports
`hookSpecificOutput.additionalContext`. Plain-text stdout also supplies context;
the JSON wrapper is a supported structured form, not the only injection method.
Hook failures can produce diagnostics. Do not configure this orientation recipe
to block work or promise that failures are silent. Client versions may differ;
consult the reference when adapting the recipe.

The remember rubric travels in the briefing and is re-delivered after compaction.
The doer captures durable knowledge at its own checkpoint, in its own words
([capture law](../prompts/0006-first-person-memory-capture-law.md)). Lifecycle
receipt hooks may record continuity facts; they do not author memory payloads
under ADR 0118.1. See [Memory protocol](memory-protocol.md) for the full loop.
