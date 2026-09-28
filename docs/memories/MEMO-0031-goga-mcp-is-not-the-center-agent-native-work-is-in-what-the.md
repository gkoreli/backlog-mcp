---
id: MEMO-0031
title: 'Goga: MCP is not the center; agent-native work is in what the CLI returns'
parent_id: FLDR-0001
created_at: '2026-09-28T22:39:20.001Z'
updated_at: '2026-09-28T22:39:20.001Z'
type: memory
layer: semantic
source: claude
entity_refs:
  - EPIC-0001
  - TASK-0012
  - TASK-0016
tags:
  - agent-surface
  - cli
  - mcp
kind: preference
---
Goga (2026-09-28): he does not like MCPs as the product's center. Agreed direction: the CLI's input side follows battle-tested conventions (gh --body-file, '-' for stdin) rather than new dialects; the agent-native work is in what it returns: errors that name the fix, provenance on every write, stable --json on every command, and help paid for only when needed. MCP stays a thin adapter over core for shell-less clients. The primary-surface decision itself is still TASK-0012's; the CLI-first framing was the agent's recommendation, with no CLI-first trial run yet.
