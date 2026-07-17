---
title: "Validated external mining: epistemic claim typing"
date: 2026-07-16
status: Proposed — EXP-4 reproduction complete
author: chert
external_candidate: Hindsight claim networks
---

# Epistemic claim typing: keep the evidence hierarchy, reject the enum

## The experiment

The garden proposed a record-level `fact | experience | belief` enum with
confidence, inspired by Hindsight's original four-network model. Before looking
at results, the annotation rubric was frozen:

- **fact:** asserted world/project condition used as evidence;
- **experience:** the memory owner's action or observation at an event boundary;
- **belief:** inference, evaluation, preference, prediction, or normative rule;
- **mixed:** one claim unit irreducibly spans types;
- **ambiguous:** two labels remain plausible without speaker/provenance context.

This follows Hindsight's important current rule: world versus experience depends
on who spoke, not merely on sentence grammar
([retain documentation](https://hindsight.vectorize.io/developer/retain)).

I annotated 48 minimal propositions from two live post-garden memories plus real
memory-like claims in ADRs 0092.5, 0092.9, 0092.13, 0118.1, and the semantic
contradiction proposal. A deterministic linguistic proxy then relabeled the same
set as a reproducibility/disagreement check; it was not treated as a second
human assessor.

| Human label | Count | Share |
| --- | ---: | ---: |
| Fact | 25 | 52.1% |
| Belief | 16 | 33.3% |
| Experience | 5 | 10.4% |
| Mixed/unencodable | 2 | 4.2% |

Six of 48 units (12.5%) were ambiguous. The deterministic proxy agreed on 35/48
(72.9%), or 35/46 (76.1%) after excluding mixed claims, and missed all five
experiences because ownership is provenance metadata rather than syntax.

The two genuine memory records were the sharpest test. One was cleanly
experiential. The other combined two observed failures with a normative rule
about avoiding unapproved migration; one record-level enum necessarily lies
about part of it. On those real records, claim typing improved **0/2 recall
decisions** and **0 contradiction decisions**. Existing metadata already says
what the experiment needed: `layer`, `kind`, `source`, `derived`, evidence refs,
validity, `state_key`, and supersession
([memory substrate](../../packages/shared/src/substrates/memory.ts)).

### Upstream changed underneath the garden

The original Hindsight paper remains useful evidence for separating raw claims
from inference ([paper](https://arxiv.org/abs/2512.12818)), but the current
product no longer presents confidence-bearing opinions as its active model.
Hindsight 0.4 removed opinions and entity summaries in favor of evidence-linked
observations ([primary release](https://hindsight.vectorize.io/blog/learning-capabilities)).
Its current hierarchy is raw world/experience memories, derived observations,
and curated mental models; stale derived layers route back to raw evidence
([recall API](https://hindsight.vectorize.io/developer/api/recall),
[mental models](https://hindsight.vectorize.io/blog/2026/06/05/mental-models-deep-dive),
[freshness design](https://hindsight.vectorize.io/blog/2026/06/17/freshness-aware-memory)).

That correction matters. "Facts are not revisable" is wrong for backlog-mcp:
current facts are exactly what `state_key`, validity, supersession, and
contradiction review revise. Claim type also does not express evidence strength;
weak universal claims remain fact-shaped.

### Cost measured

The current serialized memory Zod JSON schema measured 1,437 bytes. Adding
optional `claim_type` and `confidence` produced 1,561 bytes: +124 bytes (+8.6%).
Frontmatter costs 17–23 bytes for claim type plus about 16 for confidence. A
recall stub would spend about 4.2 tokens per encodable result, roughly 42 tokens
for ten hits. The raw cost is modest; the experiment found no decision benefit
to buy with it.

### Dogfood friction and limits

The released project-home memory loop was blocked by the migration gate. Only
two genuine post-garden memories existed in the usable global store, so 46/48
samples are memory-like ADR/proposal statements. One annotator plus a rule is
not inter-annotator validation, and no ranking experiment was run or claimed.

## Impact

The enum changes no observed retrieval or contradiction decision, duplicates
metadata already shipped, and is ambiguous on 12.5% of claim units. The useful
external lesson is already present: expose raw evidence, provenance, derived
status, and staleness clearly enough that a human can inspect why a claim exists.

## Excitement

Low for the enum. "Memory that knows belief from fact" demos beautifully until
the first real mixed memory makes the label dishonest. Evidence-linked derived
claims are the stronger story—and backlog-mcp already has the bones.

## Trunk or branch

Human-visible trust is **TRUNK** under the North Star's "memory you can see"
claim. This proposed enum is **BRANCH and rejected**: it is a second vocabulary
for distinctions already expressed by provenance, layer, kind, derived status,
lineage, and validity.

## Cost and falsifiability

**Cost: S for schema alone, M honestly** after semantic tool schemas, viewer,
migration, context surfaces, and contradiction fixtures.

Reverse this rejection only if at least 40 real atomic memories achieve at least
90% independent annotator agreement, fewer than 5% mixed records, and the new
field correctly changes at least 20% of reviewed recall or contradiction
decisions beyond existing metadata. Until then, the smallest answer is to make
`derived`, source evidence, and staleness more legible—not add another enum.
