---
id: TASK-0020
title: Run CI on pushes to main
status: open
parent_id: EPIC-0002
created_at: '2026-09-28T22:38:11.453Z'
updated_at: '2026-09-28T22:38:11.453Z'
type: task
---
`ci.yml` ran only on pull requests, but fixes land directly on main
(MEMO-0018), so main was tested only by the publish job. Add a `push` trigger
for main, and key concurrency on `github.head_ref || github.ref`.
