# Adopt an existing docs tree

Read when the user wants backlog to bolt onto an existing project's documentation,
including a deliberate conversion to canonical YAML frontmatter. Native read support
alone does not complete a request for canonical, managed documents.

## Inventory before defining the contract

Inspect the project's instructions and actual documents: paths, existing YAML,
filename identities, duplicate numbers, decision states, links, and frozen evidence.
Preserve unrelated edits and in-progress relocations. Choose concepts by the role
of the document, not by putting every Markdown file into the task substrate.

- Decisions belong to an ADR or another declared decision type.
- Intended work belongs to task/epic/milestone records.
- Reusable learned knowledge belongs to memory, with sources and correction lineage.
- Guides, specifications, and research evidence can remain indexed resources unless
  they need declared entity actions and identity.
- Index pages remain navigation, rather than becoming extra copies of source records.

Agree on the concrete target vocabulary from the user's direction and existing
project convention. A requested canonical adoption authorizes the corresponding
frontmatter conversion; do not ask again for each reversible document edit.
Flag a material conflict with hash-bound historical evidence before changing it.

## Define, convert, and verify

1. Reuse packaged declarations where they fit; otherwise author project JSON
   definitions with explicit ownership, identity, fields, relations, and actions.
2. Prepare the mapping from each source path to its concept and canonical identity.
   A schema adds no filename identity strategy that the engine does not support.
3. Add coherent YAML frontmatter to the chosen documents: canonical `id`, `type`,
   and `title` for entities, plus the actual fields required by their declaration.
   Keep Markdown content in the body, not duplicated in a frontmatter `content` key.
4. Normalize a lifecycle state only from evidence or explicit user direction.
   Keep authored annotations separately when useful; do not turn execution progress
   into decision ratification. Preserve existing fields by declaring them or mapping
   them explicitly; strict schemas reject arbitrary additional properties.
5. Preserve prose and record relationship/legacy-identity mappings. Do not fabricate
   authored dates from filesystem time or classify every document as accepted.
6. Verify schemas, claimed IDs, uniqueness, preserved bodies, links, representative
   list/search/get results, and the declared actions in the selected home.
7. Record what became canonical, what remains a resource, and any unsupported
   requirement. Successful lossless reads do not prove canonical write eligibility.

## Important current limits

The current entity claim path requires a matching numbered or prefixed-number
**filename**, plus its declared folder. Adding `id` to an arbitrarily named guide
does not by itself make that guide a managed entity. A fully managed conversion
may require deliberate filename/link changes or an engine capability change.
Resources are still part of the docs-native corpus and searchable by path.

Folders claimed by active substrates must not overlap. A broad `adr` claim cannot
coexist with narrower claims for `adr/api` and `adr/web`. Also, separate
series reusing `ADR-0001` need distinct display IDs; folder separation alone does
not give get an unambiguous ID. Display templates can differ from filename prefixes:
for example, a scoped prefixed-number claim can retain `ADR-0001-...md` with
`prefix: ADR` and expose `API ADR {key}` as its canonical display ID.
