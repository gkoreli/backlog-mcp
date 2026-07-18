---
title: "PROMPT 0011 — Schema Evolution: Version First, Then Diagnostics and Migration Are Easy (verbatim)"
date: 2026-07-18
status: Captured verbatim
author: goga
relates_to:
  - ../adr/0122-substrate-schema-evolution.md
  - ../adr/0113-user-defined-substrates.md
---

# PROMPT 0011 — verbatim

> we need to write ADR on this, explore the codebase and write the proposal:
> 3. Schema evolution
> Substrates will change after thousands of documents exist:
> Fields get renamed.
> States become obsolete.
> Relations change cardinality.
> A workflow gains or loses transitions.
> A project-defined substrate definition changes.
> Different branches contain different schema versions.
> The store should be able to say:
> I can read this document.
> I know which definition interpreted it.
> It does not satisfy today's canonical write schema.
> Here are diagnostics.
> I have not modified it.
> Versioned definitions and explicit diagnostics are more valuable than
> automatic migrations. Your data should age gracefully rather than requiring
> synchronized upgrades.. I agree that we need versioning of the schemas and
> then diagnostics/migration will be piece of cake, if we mutate the schemas
> without versioning properly, we are going to lose entire lineage and
> migrations will become impossible throughout the versions, dont you agree?

Distilled into ADR 0122 (substrate schema evolution: named versions, frozen
history, instance stamps, read-never-blocks, migration as a deliberate verb).
