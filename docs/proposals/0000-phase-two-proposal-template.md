---
title: "Phase Two Proposal Template — Validated, Distilled, Trunk-Judged"
date: 2026-07-16
status: Accepted (goga directive — the phase-two proposal standard)
author: granite
---

# Phase Two Proposal Standard

Goga's directive, verbatim spine: *"proper experimentation and validated proposals
… proper distilled doc with impact, excitement and if its a trunk to our north
star vision."* Every Phase Two proposal uses this shape. A pitch without a run
experiment is garden material, not a proposal.

## Required sections

1. **The experiment** — what was actually RUN (dogfood trial, A/B, prototype,
   corpus measurement, external-tool reproduction), with the data it produced.
   Evidence beats argument. "We tried it on N real repos and here is what broke"
   is worth fifty paragraphs of theory.
2. **Impact** — who gets what, measured or honestly estimated. Prefer data points
   from the experiment (tokens saved, orientation time, recall hit-rate, adoption
   friction count).
3. **Excitement** — the honest energy test: would Goga demo this? Does it make
   the product feel inevitable, or is it homework? One paragraph, no hedging.
4. **Trunk or branch** — the north-star verdict: TRUNK (on the critical path of
   "your backlog is your agent's memory" / Cold-Open / Amnesia / docs-native
   bolt-on) or BRANCH (valuable but peripheral). Cite the tenet or scenario it
   serves. Beryl/shale may overrule the self-assessment in review.
5. **Cost & falsifiability** — S/M/L, and what evidence would kill it.

## The data-points doctrine (how we measure usefulness)

The product's value evidence comes from four instruments, in preference order:
1. **Dogfood usage** — the fleet and Goga using the released tool on real repos;
   the operations journal + usage overlay record every real interaction.
2. **Bolt-on trials** — day-0 adoption runs on repos that never saw the tool;
   friction counts and time-to-oriented are the metrics.
3. **A/B orientation runs** — same task, with-tool vs without-tool agents;
   correctness, tokens, and wall-clock measured.
4. **Journal mining** — implicit qrels, recall hit-rates, section usage — the
   store measuring itself (read-only, R1-compliant).
