---
id: MEMO-0015
title: >-
  Daemon restart from the UI rides the existing takeover drain; control routes
  are loopback-origin only (ADR 0131)
parent_id: FLDR-0001
created_at: '2026-09-02T05:54:06.521Z'
updated_at: '2026-09-02T05:54:06.521Z'
type: memory
layer: procedural
source: 'aime:granite'
tags:
  - daemon
  - viewer
  - security
  - adr-0131
kind: timeless
---
"Update available" for the locally running daemon means one thing: the install's package.json on disk (re-read per request by core/installed-version.ts) is strictly newer than the version the process loaded at start — the same fact the ADR 0124 newer-wins takeover keys on. `GET /api/release` exposes it; `POST /api/restart` records a handover (process.execPath + this install's dist/node-server.mjs), answers 202, runs the ADR 0130 drain, and only after listener + runtimes are closed spawns the replacement via `spawnDetachedServer` (extracted from cli/server-manager.ts), so two daemons never contend for the port. Both `/api/restart` and `/shutdown` refuse a non-loopback `Origin` (server/loopback-origin.ts) — before this, a foreign web page could POST /shutdown through the permissive CORS and it was verified live to kill the daemon. Deliberately NOT in scope (maintainer ruling): npm registry checks, npx/npm -g update modes, install-kind detection — a first cut had them and they were removed.
