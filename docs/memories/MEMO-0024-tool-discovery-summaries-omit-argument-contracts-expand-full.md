---
id: MEMO-0024
title: >-
  Tool discovery summaries omit argument contracts; expand full metadata before
  invoking
parent_id: FLDR-0001
created_at: '2026-09-09T02:05:46.459Z'
updated_at: '2026-09-09T02:05:46.459Z'
type: memory
layer: procedural
source: 'aime:granite'
tags:
  - tool-discovery
  - schema
  - compaction
kind: current
---
Cross-validation of a blog-session backlog_create_work failure on 2026-09-09 UTC found the live tool declaration correctly advertised content (session rollout 01a0743e-3475-70d2-a6a4-58772d6c746a, line 2829). After two compactions, discovery used description.slice(0,95) (line 3956), dropping the embedded exec argument declaration; the subsequent call supplied the unsupported description key (3964–3965). Expand the complete ALL_TOOLS entry for a selected tool before constructing arguments; a name/description preview is only discovery. Current README and built-in schema agree on content. Historical ADRs 0085 and 0090 retain description-era examples, but this audit did not establish they caused this call. This is evidence for testing schema rediscovery after compaction, not for treating a smaller manifest alone as a usability improvement.
