---
id: MEMO-0013
title: >-
  Never process.exit() after ONNX inference — drain the loop; onnxruntime-node
  1.21 aborts with "mutex lock failed" (ADR 0130)
parent_id: FLDR-0001
created_at: '2026-09-02T05:02:17.375Z'
updated_at: '2026-09-02T05:02:17.375Z'
type: memory
layer: procedural
source: goga
tags:
  - daemon
  - onnx
  - exit
  - gotcha
  - adr-0130
kind: timeless
---
The `libc++abi: terminating … mutex lock failed: Invalid argument` abort (exit 134) on `backlog serve`, CLI error exits, and daemon shutdown was onnxruntime-node 1.21.0 tearing down its thread pool under C `exit()` after inference had run. Isolated repro: import-only is clean; inference + `process.exit()` aborts; inference + natural drain is clean; `dispose()` and single-threading do NOT help; ORT 1.24.3 (transformers 4.2.0's pin) and 1.29.0 are clean. Fix shipped in 0.72.0: transformers ^4.2.0 (reaches npx consumers — the ORT pin is nested so a workspace override cannot) plus exit discipline: `utils/process-exit.ts requestExit()` sets exitCode and drains; node-server decides the port via `resolvePortBeforeBind` BEFORE composing the app (a deferring serve loads nothing); `cli/cli-failure.ts` is the one CLI error boundary (`parseAsync().catch`). Sanctioned hard exits: uncaughtException, the 5 s forced-drain fallback (logged), and the bridge (never loads the runtime).
