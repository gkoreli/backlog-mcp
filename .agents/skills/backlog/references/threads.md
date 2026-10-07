# Threads: focused documents, explicit authority

Read when joining a numbered document family, writing an ADR amendment, or deciding
which related documents to load. This convention applies beyond ADRs to any
declared substrate whose identity and create action support threads.

## Why split a document into a thread?

A decision family could be one huge ADR. Keeping every investigation, amendment,
and reversal in that file makes agents load unrelated history on every read.
Instead, keep the root decision and focused follow-ups as independently readable
documents. Aim for a few hundred lines or fewer when practical; split by decision
or question, rather than cutting prose arbitrarily to meet a line count.

`0106-compiled-process.md`, `0106.6-one-substrate-operation-path.md`, and
`0106.7-revise-operation-contracts.md` share a family and sit close together in a
directory listing. Their slugs tell a reader what to expect before opening them.
The numeric key is identity; the semantic slug is a navigation cue. Renaming a
title does not automatically rename the frozen creation-time slug.

## Join a thread through a declared action

First select the intended home and inspect its action contract. In versions that
support thread allocation, the native `backlog_propose_adr` accepts:

```json
{
  "thread": "ADR 0106",
  "title": "Revise operation contracts",
  "description": "Revise common operation contracts; read before changing managed write guarantees.",
  "content": "## Decision\n...\n\n## Effect on earlier rulings\n...",
  "extends": ["ADR 0106"]
}
```

`thread` selects a document; it is neither a requested ID nor `parent_id`.
Core validates the selected document in this home and generates the next child,
such as `ADR 0106.7`. The atomic write uses fresh filename claims, including
quarantined documents, so an occupied number cannot be reused. Children live in
the selected document's actual directory. Omitting an optional thread creates a
new root. Selecting `ADR 0106.7` can create `ADR 0106.7.1`.

CLI spelling uses the same declared action as MCP:

```bash
backlog --home project --project-root /absolute/repo --json actions adr
backlog --home project --project-root /absolute/repo --json act adr.propose \
  --input '{"thread":"ADR 0106","title":"Revise operation contracts","description":"Revise managed write guarantees.","content":"...","extends":["ADR 0106"]}'
```

Read the receipt's generated ID and source path. Missing, ambiguous, wrong-type,
or unreadable thread documents fail closed. Native Markdown remains available
for human-authored IDs; managed actions generate their own automatically.

## Thread membership does not decide what is authoritative

Joining a thread does not automatically add `extends`, supersede its root, or
overrule a decision. Declare semantic relations explicitly when supported.
`extends` adds to an earlier decision. Whole-document `supersedes` means that
the earlier document is replaced; use the declared supersede action when that is
the intended lifecycle change. A higher child number alone proves neither.

For a partial amendment, write an explicit scope in Markdown, for example:

> Overrides ADR 0106 R3's permission for generic managed updates. All managed
> operations must now use the declared action executor. R1, R2, and R4 remain
> in force. This amendment does not replace ADR 0106 as a whole.

Use stable ruling labels (`R1`, `R2`, ...) and link the exact predecessor.
Distinguish a proposed change from an accepted ruling and from its implementation
status. Preserve prior reasoning and record why the new evidence changes it.
The current engine does not compute authority at the individual-ruling level;
agents must read these scope statements. Do not mark an entire ADR superseded
when only one ruling changed.

## Read selectively while retaining the decision chain

1. Locate the relevant family and inspect titles, slugs, statuses, and links.
2. Read the document matching the question, then its explicit amendment scope.
3. Retrieve the cited earlier rulings and relevant successors. Get with context
   provides relation stubs; hydrate only neighbors needed for the decision.
4. Follow accepted amendments until the applicable ruling is clear. Do not treat
   bounded search results as a complete family or assume the newest proposal wins.
5. Cite the ruling and amendment that support your conclusion. If the lineage is
   contradictory or incomplete, report that uncertainty before depending on it.

An index can summarize the family and link its focused documents. Keep the index
small; it should guide retrieval rather than reproduce every document's body.

## Enable threads for another substrate

In a complete [custom substrate definition](custom-substrates.md), select an
identity supporting dotted keys (`numbered-threaded`, or `prefixed-number`) and
declare this policy on a create action:

```json
{
  "verb": "propose",
  "operation": "create",
  "description": "Propose a focused document, optionally in an existing thread.",
  "requiredInputs": ["title", "content"],
  "optionalInputs": ["thread"],
  "allocation": { "strategy": "thread-child", "threadInput": "thread" }
}
```

`thread` is a synthetic selector, so omit it from canonical schema properties.
Make it required for a child-only action; keep it optional to allow roots and
children. Do not give it a default. Add relation fields and lifecycle actions
separately according to the substrate's actual domain. See [ADRs](adrs.md) for
the compiled decision vocabulary and native frontmatter example.
