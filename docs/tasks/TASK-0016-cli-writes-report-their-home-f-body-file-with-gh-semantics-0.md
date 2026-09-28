---
id: TASK-0016
title: CLI writes report their home; -F/--body-file with gh semantics (0.75.0)
status: done
parent_id: EPIC-0001
evidence:
  - 'Commits d00c726, d7aff71, c460830; released in server 0.75.0.'
  - >-
    E2E with the built CLI: a /tmp draft via -F, a heredoc via -F -, and
    --content with -F rejected (only one body input).
created_at: '2026-09-28T22:38:06.954Z'
updated_at: '2026-09-28T22:38:32.636Z'
type: task
---
An agent session couldn't pass a `/tmp` draft to `backlog create --source`: the
CLI had inherited the server's home-contained resolver (`2207110`), and
nothing said which home a write went to.

- `create` names the home and file on a second line; `--json` gains
  `HomeProvenance` fields (ADR 0112 R-9). The `(default → unfiled)` suffix was
  dropped as noise.
- `-F/--body-file <file>` reads any user path or `-` for stdin, like
  `gh --body-file` (cli/cli `pkg/cmdutil/file_input.go`); `--source` is an alias.
- The `HomeProvenance` projection moved to `core/home-provenance.ts`.
