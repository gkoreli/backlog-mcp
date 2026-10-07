# Durable memory

Read when capturing knowledge, correcting it, retracting it, or consolidating it.
Use the same selected home throughout the workflow; sample IDs below are illustrative.

## Choose the record and layer

An ADR holds an architectural ruling. A task holds intended work and progress.
A memory holds a reusable fact, lesson, procedure, or preference with provenance.
Point a memory to its decision or evidence instead of creating a competing ruling.
Remember one durable, non-obvious fact per record; omit routine progress and test logs.
Task completions and artifact creation already produce automatic episodic captures.

| Layer | Use |
|---|---|
| semantic | What is true; explicit remember defaults here |
| procedural | How to do something |
| episodic | What happened |

Kinds are `current`, `historical`, `plan`, `preference`, and `timeless`.
Use timeless only when the fact should be exempt from recency decay, not to claim
greater authority. Source, evidence, validity, and current direction still matter.

## Recall, then expand selected evidence

Recall once per topic, not before every tool call. Read age, source, `supersedes`,
and `derived`; relevance and usage do not prove truth. `--full` requests memory
bodies and `--budget` limits approximate recall packing. Recall `--context` currently
matches the memory's exact parent ID, not all descendants. Get `--context` expands
relations; it is a different input meaning.

## Capture and correct

These commands assume the current working directory and defaults select the
intended home; add explicit global flags from the CLI reference when they do not.

```bash
backlog remember 'Release requires the generated viewer assets.' \
  --title 'Release artifact requirement' --layer procedural --refs 'ADR 0134'
backlog remember 'The release command is now pnpm release.' \
  --title 'Release command' --supersedes MEMO-0042 --state-key release.command
backlog remember 'These decisions imply local persistence is required.' \
  --title 'Persistence conclusion' --derived --refs 'ADR 0134,ADR 0135'
```

MCP `backlog_remember` requires `title` and `content`; other inputs include
`layer`, `context`, `entity_refs`, `kind`, `state_key`, `supersedes`, `derived`,
`occurred_at`, and `valid_until`. CLI uses `--refs`, `--state-key`, and corresponding
hyphenated flags. Read the full schema/help first. Dates must be ISO dates or
datetimes; an explicit validity end must follow an explicit occurrence time.

`supersedes` creates a new holder and expires its predecessor; `state_key` closes
previous holders of the same evolving fact. These use coordinated correction,
not ordinary body editing or field assignment. Derived knowledge requires source
references. Use IDs recognized by the selected home's registry and expand their
evidence when the inference depends on it.

The remember receipt's `collision_candidates` is tri-state: absent means the
advisory scan did not run or failed; `[]` means a completed scan found none;
a nonempty array asks for review. A candidate is not an adjudicated contradiction.

## Retract and consolidate

```bash
backlog forget --ids MEMO-0042
backlog consolidation-candidates
backlog contradictions
```

Forget soft-expires a memory so recall excludes it while Markdown history remains.
`--expired` / MCP `expired: true` garbage-collects already-expired memories.
Current forget criteria combine with OR semantics (with special layer handling
when IDs are supplied); use explicit IDs for precise retraction rather than
assuming multiple filters narrow the target set. Permanent delete is different.

For consolidation, inspect the suggested members, write a self-contained derived
semantic/procedural memory citing those members and relevant source entities, then
retract only the redundant members after the replacement is confirmed durable.
Do not retire architectural source records merely because their lessons were summarized.
