---
id: TASK-0020
title: Run CI on pushes to main
status: done
parent_id: EPIC-0002
evidence:
  - >-
    Commit 1b0aa20. First push-triggered CI run 36493718876 on 40e782a: success.
    memory 4, viewer 17, server 117 test files passed on Node 24.
created_at: '2026-09-28T22:38:11.453Z'
updated_at: '2026-09-28T22:41:19.793Z'
type: task
---
`ci.yml` ran only on pull requests, but fixes land directly on main
(MEMO-0018), so main was tested only by the publish job. Add a `push` trigger
for main, and key concurrency on `github.head_ref || github.ref`.
