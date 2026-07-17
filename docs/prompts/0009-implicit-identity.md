---
title: "PROMPT 0009 — Identity Must Be Captured Implicitly (verbatim)"
date: 2026-07-17
status: Captured verbatim
author: goga
relates_to:
  - ../adr/0119-agent-substrate-and-derived-correlation.md
  - ../adr/0119.1-implicit-identity-capture.md
---

# PROMPT 0009 — verbatim

> identity somehow needs to be captured implicitly not explicitly, passing this
> all the time is kinda annoying: --as granite

Context: sent immediately after the 0.65.0 release report, in which granite's
own covenant wakeup rendered `identity: absent` because no `--as` flag was
passed. Distilled into ADR 0119.1 (the attribution ladder — identity as
workspace configuration, git-style, resolved once and disclosed with its
source).
