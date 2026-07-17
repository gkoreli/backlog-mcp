---
title: "EXP-2 rerun — Erent cold-open A/B: tool arm 10/10 twice, Q3 and Q5 closed"
date: 2026-07-17
status: Complete
author: rerun harness (Fable 5 orchestrator + cold subagents)
type: acceptance-rerun
relates_to:
  - ../proposals/wakeup-first-impression-2026-07.md
  - ../proposals/cold-open-ab-experiment-2026-07.md
---

# EXP-2 rerun — Erent cold-open A/B (acceptance item 3)

## Verdict

**PASS on every element of the charter acceptance bar** (wakeup-first-impression
charter, "One acceptance harness" item 3):

| Bar element | Required | Observed | Verdict |
| --- | --- | --- | --- |
| Both tool runs 10/10 | 10/10 twice | Session 1: **10/10**; Session 2: **10/10** (blind) | **MET** |
| Q3 temporal grounding | 1/2 → 2/2 both runs | 2/2 both sessions | **MET** |
| Q5 root run guidance | 1/2 → 2/2 both runs | 2/2 both sessions | **MET** |
| Vision pointer | `NORTH_STAR.md` (underscore) surfaces | Surfaced in both sessions' wakeup + one direct check (3/3) | **MET** |
| Call budget | ≤8 tool calls per run | 7 calls per session | **MET** |
| Containment | erent read-only, git identical before/after | Clean/`478b134` before, clean/`478b134` after; `.backlog/` removed | **MET** |

**Honest caveat — tokens went up, not down.** Correctness closed to 10/10, but
each rerun session cost more tokens than the original 0.62-line tool arm
(64,807/85,020 vs 39,516/40,795) and ~3x the frozen raw-file baseline
(22,103/23,438). The acceptance bar constrains calls and correctness, not
tokens, so this does not fail the gate — but the North Star's byte-economy
tenet says it should be recorded. Two confounds and one real defect are noted
in "Token accounting" below; the actionable defect is that **bare-path `get
README.md` returns "(no content)"** even though wakeup advertises
"orientation (paths open with get)", so both sessions burned one wasted call
and re-hydrated everything through `mcp://backlog/...` URIs.

## Environment

- Build under test: `packages/server/dist/cli/index.mjs` **v0.63.0**
  (post-charter-fix build; dist dated 2026-07-17 12:38). Original experiment
  ran the released 0.62 line.
- Corpus: `~/Documents/goga/erent` at `478b134` — **the same HEAD as the
  original experiment**, so the frozen raw-file baseline (10/10 at
  22,103/23,438 tokens) remains a valid comparison and was **not** rerun.
- Invocation: `node .../dist/cli/index.mjs --home project --project-root
  ~/Documents/goga/erent <command>`.

## Grades — per question, per session (blind)

| Question | Session 1 | Session 2 | Original A1/A2 |
| --- | :-: | :-: | :-: |
| Q1 what is this | 2 | 2 | 2 / 2 |
| Q2 key decisions | 2 | 2 | 2 / 2 |
| Q3 recent / in-flight work | **2** | **2** | 1 / 1 |
| Q4 constraints | 2 | 2 | 2 / 2 |
| Q5 how do I run it | **2** | **2** | 1 / 1 |
| **Total** | **10/10** | **10/10** | 8 / 8 |

The grader (blind; see Methodology) verified Q3 against `git log` ground
truth: both sessions correctly identified the 2026-07-15 Resend
notification-outbox release and ADR 015 Slice A/B as shipped, named Slice C
as the in-flight next step, and neither called shipped work "in flight" —
the exact failure of both original A runs. Both sessions answered Q5 with
`pnpm db:migrate:local` + `pnpm dev`, ports 5173/8787, the Vite `/api/*`
proxy, Node/pnpm prerequisites, and quality gates — the README/AGENTS.md
content the original tool arm could not reach.

## Tokens and calls vs original arms

| run | arm / build | correctness | tokens | wall-clock | CLI calls |
| --- | --- | :-: | ---: | ---: | :-: |
| Rerun S1 | tool-only, 0.63.0 | **10** | 64,807 | 112.5s | 7 |
| Rerun S2 | tool-only, 0.63.0 | **10** | 85,020 | 123.3s | 7 |
| Original A1 | tool-only, 0.62 | 8 | 39,516 | 89.9s | 8 |
| Original A2 | tool-only, 0.62 | 8 | 40,795 | 84.4s | 8 |
| Frozen B1 | raw files | 10 | 22,103 | 43.6s | 9 reads |
| Frozen B2 | raw files | 10 | 23,438 | 53.1s | 4 reads |

### Token accounting

Method: total subagent-session tokens as reported by the agent harness
(`subagent_tokens`), the same accounting the original used (its four runs sum
to 125,852 against its stated "~170k subagent tokens total" including the
grader). Confounds vs the original numbers: (a) the rerun sessions ran on a
different orchestrating model generation than the original subagents, and
(b) each rerun session hydrated more document bodies (S2 pulled six full
docs including two large ADRs). The non-confound defect: wakeup's
orientation stubs advertise bare paths, but `get README.md` returns
"(no content)"; only `mcp://backlog/<path>` URIs hydrate. Both sessions
spent call 2 discovering this and a later call redoing it. Fixing bare-path
`get` would remove one call and one round of redundant output per cold
session.

## Methodology

**Protocol replicated from the original** (`cold-open-ab-experiment-2026-07.md`
at `348a4ed`): same five orientation questions, two fresh tool-only runs,
≤8 CLI calls each, no file reads, blind 0–2-per-question grading against an
independently built answer key with `git log` ground truth for Q3. The raw
arm was not rerun; its original results stand as the frozen baseline per the
rerun charter.

- **Question wording.** The original recorded the questions only in shorthand
  ("what is this / key decisions / active work / constraints / how do I run
  it"). They were reconstructed as: (1) What is this project? What does it
  do? (2) What are the key decisions (architectural/product) that shape it?
  (3) What work is most recent, and what is actively in flight right now?
  (4) What constraints or rules must a contributor follow? (5) How do I run
  it locally? (commands, ports, prerequisites).
- **Cold sessions.** Each session was a separate freshly spawned subagent
  whose prompt contained only the five questions, the CLI invocation pattern,
  the allowed read subcommands (wakeup/search/get/recall/list), and the
  ≤8-call budget — no repo knowledge, no file-reading permission. `.backlog/`
  was absent before Session 1 and **deleted between sessions**, so both
  sessions paid the full cold index build (stricter than the original, which
  only documents removal after both runs).
- **Blindness.** The grader was a third subagent that received the five
  questions and the two answer sets only — labeled "Set A"/"Set B", assigned
  by coin flip (Set A = Session 2, Set B = Session 1; de-anonymized after
  grading). The grader prompt never mentioned arms, builds, tools, sessions,
  or the experiment; sessions were instructed to write answers as plain
  repository statements with no method references, and their CALLS/WAKEUP
  sections were stripped before grading. The grader built its own answer key
  from the repo (files + read-only `git log`) *before* reading either set.
- **Containment.** erent `git status` clean and HEAD `478b134` before, between,
  and after; all tool writes confined to `.backlog/`, which was deleted
  after each session and at the end. Notably, the v0.63.0 build created a
  self-ignoring `.backlog/.gitignore`, so `git status` stayed clean **while
  `.backlog/` existed** — charter repair 3 (derived-state hygiene) observed
  working; cache size ~3.0 MB (vs 4.8–7.1 MB measured in EXP-1a/1b).
- **Vision pointer.** All three wakeup invocations (S1, S2, one direct check)
  rendered `── vision ── Erent North Star — NORTH_STAR.md (hydrate on
  demand)` — the underscore spelling that the pre-fix C.2 convention would
  have missed — plus orientation stubs for README.md and AGENTS.md and the
  honest line "No tasks, memories, or constraints are recorded yet, but 41
  existing documents are indexed and searchable." The empty-wakeup failure
  shape (rich repo rendered as nothing) did not reproduce.

**Residual friction observed (non-blocking, for the ledger):**

1. Bare-path `get` returns "(no content)" for wakeup-advertised paths;
   `mcp://backlog/...` URIs required (cost one call per session — see above).
2. `list` still surfaces only the three claimed PROMPT items, not the broader
   41-document resource namespace (only `search` exposes it) — the
   namespace-discoverability friction from the original stands.
3. `recall` on a virgin repo returns empty without hinting that `search` is
   the fallback (mitigated in practice by wakeup's "indexed and searchable"
   line).
4. N=2 caveat carried forward from the charter: a flipped result at N=5
   voids the exact numbers.

## Appendix A — Session 1 transcript

**Calls (7 of 8):**

1. `... wakeup`
2. `... get README.md AGENTS.md NORTH_STAR.md`
3. `... list`
4. `... get "PROMPT 0001" "PROMPT 0002" "PROMPT 0003"`
5. `... search "architecture decision record ADR"`
6. `... recall local development commands run dev server ports wrangler`
7. `... get mcp://backlog/README.md mcp://backlog/AGENTS.md mcp://backlog/NORTH_STAR.md mcp://backlog/docs/adr/016-use-resend-for-inquiry-notifications.md mcp://backlog/docs/adr/015-conversion-ready-tourist-seo-acquisition.md`

(All prefixed `node /Users/goga/Documents/goga/backlog-mcp/packages/server/dist/cli/index.mjs --home project --project-root /Users/goga/Documents/goga/erent`.)

**Wakeup output (verbatim):**

```
── vision ──
  Erent North Star — NORTH_STAR.md (hydrate on demand)

── orientation (paths open with get) ──
  readme  README.md — Erent
  agents  AGENTS.md — Erent Agent Guide
  No tasks, memories, or constraints are recorded yet, but 41 existing documents are indexed and searchable. Open first: README.md, AGENTS.md, NORTH_STAR.md.

── meta ──
  generated_at: 2026-07-17T20:53:21.205Z
  identity: absent
  counts: active=0 epics=0 knowledge=0 constraints=0 completions=0 activity=0 unfiled=0
```

**Answers (graded as Set B):**

1. Erent is a production bilingual (Georgian/English) car-rental discovery and inquiry website for a rental company in Tbilisi, Georgia, live at https://erent.ge. Phase 1 is deliberately a lead-generation product, not real-time booking: customers browse model-level fleet offerings (Toyota Prius C, RAV4 Hybrid, Camry SE, Hyundai Elantra), compare baseline daily prices in USD/GEL, read rental terms and a FAQ, and convert via tap-to-call (+995 555 22 07 07), WhatsApp, or an inquiry form whose final quote is always human-confirmed. Technically it is one pnpm monorepo with three packages — `client` (Vite + Nisli UI framework), `server` (Hono API on Cloudflare Workers with D1 persistence and Resend email alerts), and `shared` (contracts, validated catalog, pure route definitions) — deployed as a single Cloudflare Worker serving both the site and `/api/*` from one origin.

2. The shaping decisions: a four-phase north star (Phase 1 discovery/lead-gen → Phase 2 admin/fleet ops → Phase 3 availability/assisted booking → Phase 4 full booking), with a hard rule that an inquiry is never a booking and no availability/price guarantees appear anywhere. Architecture: one operational monolith, one Worker, one origin (no CORS, no second deployment); strict dependency direction client→shared←server with a single narrow exception letting shared import the DOM-free `@nisli/router/catalog` (ADR 013); a static, Zod-validated model catalog in `shared` with reviewed USD and GEL display prices and no runtime currency conversion (ADR 008), designed as a seam for later D1 replacement. UI is source-copied `@nisli/ui` primitives (shadcn philosophy, no React/Radix runtime; Basecoat/elec-ui retired — ADR 011 supersedes ADR 002). Other keystones: bilingual `/ka` `/en` SEO routes with meaningful Worker-rendered initial HTML (ADR 010), Georgian as default locale, tourist-first economy brand positioning (ADR 014) with an explicit ban on marketing Erent as electric-only, a conversion-ready SEO acquisition funnel plan (ADR 015), Resend as notification transport superseding Cloudflare Email Service (ADR 016), and PII-free observability for inquiry operations (ADR 012).

3. The most recent release (2026-07-15) was the inquiry-notification path: D1 migration `0002` added a notification outbox, every accepted inquiry atomically creates an outbox row, the Worker sends an internal operator email via the Resend SDK with a `*/5` cron retry, and this was verified through a disposable preview Worker before production. ADR 015 Slices A (notification readiness) and B (on-page SEO plus the bilingual `/faq` destination) are implemented and deployed. Actively next/in flight per the roadmap: Slice C — Search Console verification, sitemap submission, Cloudflare Web Analytics, and a weekly acquisition baseline; then privacy/consent groundwork before Google measurement, operator lead-outcome states (`contacted`/`qualified`/`confirmed_rental`/`lost`/`spam`), real-device accessibility and Georgian typography verification, and the tourist guide. Phase 2 admin/inventory work is explicitly not started. The last recorded implementation increment was prompt 0003 (configurable fleet terms and inquiry-first vehicle details, 2026-07-11).

4. Contributors must read NORTH_STAR.md, BRANDING.md, DESIGN.md, AGENTS.md, and the relevant ADRs before meaningful changes, and update or supersede ADRs after substantial work (never erase accepted history). Hard rules: respect package boundaries and dependency direction; no new packages, frameworks, UI runtimes (no React/Svelte/shadcn runtime), or infrastructure without demonstrated need; one component per named file with collocated CSS; acquire reusable UI only by source-copying via `nisli-ui add`. Operational rules: logs are strict PII-free allowlists (never log customer data, email bodies, provider messages, or stack traces); secrets live only in Worker secret storage and untracked `.dev.vars`; PR CI never deploys but every push to `main` (even docs-only) is a production release; the deploy workflow never runs D1 migrations — remote migrations are separately authorized and applied before pushing dependent code; `pnpm run deploy` is a manual fallback only and the same commit is never deployed twice; production smoke checks stay read-only; email tests use disposable preview resources, never production D1. Content rules: internal strategy docs must never leak into public copy, public wording changes require product-owner acceptance, and no booking/availability/electric-fleet claims. Always run `pnpm check`, `pnpm test`, `pnpm build`, report failures honestly, and verify responsiveness, keyboard/screen-reader access, and both Georgian and English before handoff.

5. Prerequisites: Node 22+ (mise is recommended — `mise.toml` pins Node 24) and pnpm 10.21.0. Setup: `mise trust && mise install`, `npm install --global pnpm@10.21.0`, then `pnpm install`. Run locally with `pnpm db:migrate:local` (applies local D1 migrations) followed by `pnpm dev`, which starts the Vite client and the local Wrangler Worker together: the website is at http://localhost:5173 and the Worker API directly at http://localhost:8787 (health check `GET /api/health`); Vite proxies `/api/*` to the Worker so requests match production's same-origin shape. Quality gates are `pnpm check` (format + TypeScript), `pnpm test`, and `pnpm build`; other useful commands include `pnpm cf:types`, `pnpm logs`, and `pnpm inquiries:status`. Cloudflare and Resend accounts are only needed for deployment and live email — normal releases go through a reviewed push to `main`, with `pnpm run deploy` reserved as an authorized manual fallback.

## Appendix B — Session 2 transcript

**Calls (7 of 8):**

1. `... wakeup`
2. `... get README.md AGENTS.md NORTH_STAR.md`
3. `... list`
4. `... get "PROMPT 0001" "PROMPT 0002" "PROMPT 0003"`
5. `... search "ADR architecture decision"`
6. `... recall "how to run locally: dev commands, ports, prerequisites, wrangler"`
7. `... get "mcp://backlog/README.md" "mcp://backlog/AGENTS.md" "mcp://backlog/NORTH_STAR.md" "mcp://backlog/docs/adr/001-initial-architecture.md" "mcp://backlog/docs/adr/015-conversion-ready-tourist-seo-acquisition.md" "mcp://backlog/docs/adr/016-use-resend-for-inquiry-notifications.md"`

**Wakeup output (verbatim):** identical shape to Session 1 (fresh cold index;
`generated_at: 2026-07-17T20:55:41.779Z`), including the same vision pointer
to `NORTH_STAR.md`, README/AGENTS orientation stubs, and the
41-documents-indexed line.

**Answers (graded as Set A):**

1. Erent is a production bilingual (Georgian/English) car-rental discovery and inquiry website for a rental company in Tbilisi, Georgia, live at https://erent.ge. Customers browse a small model-level fleet (Toyota Prius C, RAV4 Hybrid, Camry SE, Hyundai Elantra), compare baseline daily prices in USD/GEL, read rental terms and a FAQ, and then call, WhatsApp, or submit an inquiry form for a human-confirmed quote. It is deliberately a Phase 1 lead-generation product, not a booking system: no real-time availability, guaranteed pricing, payments, accounts, or admin UI. Inquiries persist to Cloudflare D1 and trigger an automatic internal email alert to the operator; the Erent team confirms vehicle, dates, and final price by direct contact.

2. Key decisions, recorded in 16 ADRs: (a) one pnpm monorepo with three packages — client (Vite + Nisli Web Components), server (Hono on Cloudflare Workers), shared (Zod contracts, catalog, pure logic) — with strict dependency direction client→shared and server→shared, never client↔server; (b) a single origin — one Worker serves both the static client and `/api/*` at erent.ge, avoiding CORS and a second deployment; (c) the fleet is a static, Zod-validated, source-attributed catalog in shared code with fixed USD and GEL display prices (no runtime currency conversion; ADR 008), deferring D1 fleet tables and R2 to Phase 2; (d) bilingual SEO via one render-less shared route registry consumed by both Worker (meaningful initial HTML, canonicals, hreflang) and client (ADRs 010/013), with Georgian as the default locale; (e) the inquiry-is-not-a-booking boundary is architectural: fail-closed D1 persistence (503 if the DB is down), no "book/reserve/available" language, human confirmation always authoritative; (f) internal alerts use a durable D1 notification outbox with cron retry, sent via Resend (ADR 016, which superseded ADR 015's Cloudflare Email Service choice); (g) UI primitives are source-copied from the @nisli/ui registry into the repo (superseding the earlier Basecoat/"Elec UI" boundary), with no React/Vue/Svelte runtime allowed; (h) tourist-first, economy-led brand positioning (ADR 014) with a conversion-oriented SEO acquisition funnel (ADR 015), and a strict rule never to market the fleet as electric-only.

3. The most recent shipped work (released 2026-07-15) is the inquiry-notification path: D1 migration 0002 added a notification outbox, the Worker now sends an internal alert through the Resend SDK after each persisted inquiry, with a */5 cron retry, PII-free logging, and a disposable-preview verification process; ADR 016 recording the Resend switch is the newest architecture decision. Alongside it, ADR 015's Slice B shipped: bilingual `/ka/faq` and `/en/faq` pages, an accordion FAQ, homepage FAQ preview, and SEO-intent copy on home/fleet/vehicle pages (with a same-day correction keeping keyword phrasing out of fleet UI controls). Actively in flight next is ADR 015 Slice C — Search Console verification, sitemap submission, Cloudflare Web Analytics, and a weekly acquisition baseline — followed by operator lead-outcome states (contacted/qualified/confirmed_rental/lost/spam), a privacy/consent review before any Google analytics or ads, and real-device accessibility and Georgian typography verification. Phase 2 (admin/inventory) is explicitly not started.

4. Contributors must read NORTH_STAR.md, BRANDING.md, DESIGN.md, AGENTS.md, and the relevant ADRs before meaningful changes, and update ADRs after substantial work (superseding, never rewriting history). Hard boundaries: keep the client→shared / server→shared dependency direction (shared may import only the DOM-free `@nisli/router/catalog` surface); no new packages, frameworks, runtimes (React etc.), or infrastructure without demonstrated need; reusable UI comes source-copied from @nisli/ui, one component per file with collocated CSS, and the source-owned SVG icon system (no emoji or icon fonts). Operational rules: logs are strict PII-free allowlists (never log customer data, email bodies, or exception text); secrets live only in Worker secret storage and untracked `.dev.vars`; every push to main deploys to production (even docs-only), PR CI never deploys; D1 migrations are a separately authorized manual step that the deploy workflow never runs; `pnpm run deploy` is a fallback only, and never deploy the same commit twice. Content rules: public copy must never use booking/availability/guaranteed-price language, internal `docs/internal` strategy material is never a content source, and public wording changes require product-owner acceptance; run checks and report failures honestly, leaving the repo in a working state.

5. Prerequisites: Node 22+ (mise is recommended and `mise.toml` pins Node 24) and pnpm 10.21.0; Cloudflare/Resend accounts are needed only for remote deployment and live email. Setup: `mise trust && mise install`, `npm install --global pnpm@10.21.0`, then `pnpm install`. Run locally with `pnpm db:migrate:local` (applies local D1 migrations) followed by `pnpm dev`, which starts the Vite client and the local Wrangler Worker together: the website is at http://localhost:5173 and the Worker API at http://localhost:8787 (e.g. `/api/health`), with Vite proxying `/api/*` to match production's same-origin shape; local D1 data lives under `packages/server/.wrangler`. Other core commands: `pnpm check` (format + TypeScript), `pnpm test`, `pnpm build`, `pnpm cf:types` (regenerate Cloudflare binding types), and `pnpm logs` for production logs. Useful routes: `/ka`, `/en`, `/{locale}/cars`, `/{locale}/cars/:slug`, `/{locale}/faq`, plus `GET /api/cars` and `POST /api/inquiries`.

## Appendix C — Grader justifications (verbatim, blind)

Set A (= Session 2): Q1 2, Q2 2, Q3 2, Q4 2, Q5 2 — total 10/10.
Set B (= Session 1): Q1 2, Q2 2, Q3 2, Q4 2, Q5 2 — total 10/10.

Selected justifications: "Q3 [Set A]: Matches git ground truth precisely:
2026-07-15 notification release (migration 0002, Resend SDK, cron retry,
preview verification), Slice B FAQ/accordion/homepage preview plus the
same-day SEO-copy correction commits, Slice C next, Phase 2 not started."
"Q5 [Set B]: Correct prerequisites, setup, `db:migrate:local` + `pnpm dev`,
ports 5173/8787, proxy behavior … and command list." Grader's closing note:
"Both candidates are essentially fully accurate against the repository;
nothing in either set contradicts the code, git history, or governing docs."
