---
title: "Naming and Positioning for the Docs-Native Agent Memory Engine"
date: 2026-07-16
status: Proposed
---

# Naming and Positioning

## Decision sought

Rename the product from **backlog-mcp** to a name that can carry its actual
category: a local-first, docs-native memory and context engine for agents.

The recommendation is **Kvali** (Georgian: **კვალი**, “trace”), introduced first
as the product brand while retaining the `backlog_*` tool prefix and the
`backlog-mcp` npm package as compatibility surfaces.

## What is being named

The current public framing—“a task backlog MCP server for LLM agents” in
[`README.md`](../../README.md)—describes the original entry point, not the
system that now exists:

- The substrate registry is the single declaration point from which validation,
  entity typing, identifiers, viewer metadata, and tool hints derive
  (`packages/shared/src/substrates/registry.ts:1-17`, `:30-58`).
- Memory is a first-class substrate in that registry
  (`packages/shared/src/substrates/registry.ts:27-38`, `:47-55`).
- A session begins with a time-oriented briefing, not a focal task
  (`packages/server/src/core/wakeup.ts:1-16`), and that briefing includes
  semantic and procedural knowledge (`packages/server/src/core/wakeup.ts:171-180`).
- Recall returns a progressively disclosed menu of memory stubs within a token
  budget, with `backlog_get` as the explicit expansion step
  (`packages/server/src/tools/backlog-recall.ts:35-52`;
  `packages/server/src/tools/backlog-get.ts:37-45`).
- The package, executable, MCP server identity, repo config, and tool vocabulary
  all still encode “backlog” (`packages/server/package.json:2-24`;
  `packages/server/src/server/hono-app.ts:94-97`;
  `packages/server/src/core/config.ts:29-32`).

ADR 0097 calls this an **agentic context storage engine**. ADR 0092.3 completes
the stronger thesis: **the backlog is the memory**. ADR 0098 supplies the
architectural unit: substrates. The docs-native direction expands the stored
corpus beyond work items into decisions, requirements, memories, and any other
frontmatter-markdown substrate a project declares.

The name therefore must not imply that tasks are the product, that MCP is the
product category, or that memory is a hidden vector database. The product is the
durable, human-readable trace of what agents and humans need to know.

## Positioning candidates

Each line below should make sense to an agent-era developer and to someone who
has never heard of MCP.

1. **The docs-native memory and context engine for agents.**
   Direct, category-forming, and independent of transport. It says where the
   truth lives, what the engine provides, and who uses it.

2. **Turn your project docs into durable, shared memory for every agent that
   works on the codebase.**
   The clearest benefit statement for day-zero adoption. It understates
   substrates and progressive disclosure, but requires no prior vocabulary.

3. **A local-first storage engine that turns frontmatter Markdown into agent
   memory, live context, and shared project state.**
   The most architecturally exact line. It is slightly dense for a homepage
   headline but strong as the README's second sentence.

4. **Your project's memory layer: agents wake up with what matters, recall what
   was learned, and expand details only when needed.**
   Makes progressive disclosure concrete without naming the mechanism. It
   presents an experience rather than a list of features.

5. **Your backlog is your agent's memory—tasks, decisions, requirements, and
   knowledge, kept as readable documents in the repo.**
   Preserves the defining thesis and bridges existing users into the larger
   vision. It remains transition copy rather than the permanent category line
   because “backlog” still leads the explanation.

### Recommended positioning stack

Use the lines together rather than forcing one sentence to do every job:

> **Kvali is the docs-native memory and context engine for agents.**
>
> It turns frontmatter Markdown into durable shared memory—tasks, decisions,
> requirements, and knowledge that agents recall progressively and humans can
> read directly in the repository.

The short line passes the no-MCP test. The supporting line introduces the
product's differentiators: open documents, multiple substrates, shared
human/agent legibility, and progressive recall.

## Name candidates

Availability was checked on 2026-07-16 with `npm view <name> name version`.
“Free” means the bare npm name returned 404 at that time, not that a trademark
or future registration is guaranteed. Collision notes are a quick GitHub/web
sanity check, not legal clearance.

Georgian meanings were checked against dictionary sources: **კვალი** is
“trace” ([Dictionary.ge](https://dictionary.ge/en/word/trace%C2%B9%2BI/?h=trace&o=e));
**მატიანე** is a historical record or chronicle
([Georgian Encyclopedia](https://georgianencyclopedia.ge/ka/form/30064));
**ფენა** is “layer”
([Wiktionary](https://en.wiktionary.org/wiki/%E1%83%A4%E1%83%94%E1%83%9C%E1%83%90));
and **ფესვი** is “root”
([Wiktionary](https://ka.wiktionary.org/wiki/%E1%83%A4%E1%83%94%E1%83%A1%E1%83%95%E1%83%98)).
The ASCII forms below favor typeability over scholarly diacritics.

| Candidate | Lane | Fit and ergonomics | npm | Collision sanity |
|---|---|---|---|---|
| **Kvali** | Georgian | “Trace.” Two syllables; `kvali_recall` and `kvali_wakeup` read cleanly. A trace is durable evidence left by work, memory, and decisions. | Free | One small .NET audit-trail repo uses the name; no material agent-memory product found. `kvali.dev` resolves; `kvali.io` and `kvali.ai` had no A record, which is not an availability claim. |
| **Matiane** | Georgian | “Chronicle” / historical record. Strong for ADR threads and docs-native history; four syllables and a longer CLI. | Free | Several small GitHub repos, including a mini VCS, but no established agent-memory product found. |
| **Pena** | Georgian | “Layer.” Excellent substrate metaphor and two syllables, but English readers may pronounce it inconsistently and Spanish associations dominate. | Taken (`1.0.0-dev`) | Broad personal-name and multilingual collision surface. |
| **Pesvi** | Georgian | “Root.” Suggests foundation, project scope, and truth anchored in the repo. `pesvi_recall` works, but the memory meaning is indirect. | Free | No exact-name GitHub software result in the first page; low discoverability without a descriptor. |
| **Goni** | Georgian | Mind/intellect root. Short and warm; directly memory-adjacent, but less tied to documents and durable records. | Taken (`1.0.0`) | Used in Georgian titles and other software; broad collision risk. |
| **Nakvali** | Georgian | Footprint/trace left behind. More explicitly “a resulting trace” than Kvali, but three syllables and less immediately pronounceable. | Free | No exact-name GitHub repository found in the quick search. |
| **Memdocs** | Says what it is | Immediately signals memory + documents; good MCP-list discoverability. Sounds like a feature or file format rather than an extensible engine. | Free | Direct collision with an existing git-native AI memory system and MCP server, so reject despite npm availability. |
| **Agentmem** | Says what it is | Maximum category clarity, weak distinctiveness, awkward spoken form. | Taken (`2.4.0`) | Existing agent-memory package/category collision. |
| **Docmind** | Says what it is | Compact docs + mind metaphor. `docmind_recall` is acceptable; substrate story is weak. | Taken (`0.2.2`) | Existing package. |
| **Lorebase** | Says what it is | Durable knowledge base is close to the value; “lore” undersells tasks, requirements, and current state. | Free | Strong collision with local-first worldbuilding apps and an Obsidian plugin. |
| **Contexture** | Says what it is | Elegant “context + texture/structure” blend; context-heavy and memory-light. | Taken (`0.13.1`) | Existing package and dictionary word. |
| **Contextbank** | Says what it is | Clear agent-context store; `contextbank_recall` is long and the bank metaphor feels passive. | Free | Exact collision with a local-first Markdown context MCP server. |
| **Agentlore** | Says what it is | Discoverable and personable; narrows durable project state into “lore.” | Free | Multiple existing agent-related repositories, including team visibility and agent cultural memory. |
| **Docsubstrate** | Says what it is | Architecturally literal and npm-free, but too technical and six spoken syllables. | Free | No exact-name GitHub repository found; likely ownable but not lovable. |
| **Memoryloom** | Metaphor | Weaves episodes into knowledge; warm, memorable, and `memoryloom_recall` is redundant. | Free | Multiple existing memory projects, including an MCP-compatible memory server. |
| **Strata** | Geology | The clearest layered-substrate metaphor; short and strong. Memory is implied as accumulation over time. | Taken (`0.20.1`) | Heavy software collision, including OpenGamma Strata and multiple protocols/filesystems. |
| **Stratum** | Geology | Singular substrate layer; precise but clinical, and tool names sound mechanical. | Taken (`0.2.4`) | Existing package and broad technical use. |
| **Bedrock** | Geology | Durable foundation and source of truth. Does not communicate recall or docs, and is strongly associated with AWS. | Taken (`4.5.1`) | Severe cloud/AI category collision. |
| **Loam** | Geology | A living substrate in which knowledge grows. Excellent metaphor, weak discoverability. | Taken (`1.2.0`) | Existing package and several products. |
| **Substrate** | Architecture | Says exactly how the system generalizes. Too generic to own and nearly opaque to newcomers. | Taken (`120240617.1.9`) | Dominated by the blockchain ecosystem and the general technical term. |
| **Mneme** | Memory | Classical personification of memory; compact and credible. Pronunciation/spelling are not obvious. | Taken (`0.1.1-alpha.2`) | Existing memory and research uses. |
| **Engram** | Memory | A physical memory trace—semantically almost perfect. Strong scientific and software collisions. | Taken (`0.0.1`) | Existing products, libraries, and Destiny terminology. |
| **Scribe** | Record | Human-readable recording and authored documents. Implies writing more than recall, indexing, or state. | Taken (`0.0.9`) | Extremely crowded software name. |
| **Chronicle** | Record | Durable ordered history; excellent for ADRs, weaker for active state and programmable substrates. | Taken (`1.0.0`) | Extremely crowded in databases, observability, media, and games. |
| **Backlog** | Continuity | Retains muscle memory and installed identity. Now actively mis-scopes the category to queued work. | Taken (`1.4.56`) | Generic product term; current `backlog-mcp` remains ownable but cannot carry the larger vision alone. |

## Shortlist scoring

Scores are 1–5. Availability scores the bare npm name as checked above.
Collision scores reward a clean field. Discoverability asks whether the name
alone helps in an MCP server list; every coined brand needs a descriptor.

| Name | Meaning fit | CLI | Tool prefix | npm | Collision | MCP discoverability | Total / 30 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Kvali** | 5 | 5 | 5 | 5 | 4 | 2 | **26** |
| **Matiane** | 5 | 3 | 4 | 5 | 3 | 2 | **22** |
| **Pesvi** | 4 | 4 | 4 | 5 | 5 | 1 | **23** |
| **Docsubstrate** | 4 | 2 | 2 | 5 | 5 | 5 | **23** |
| **Strata** | 5 | 5 | 5 | 1 | 1 | 3 | **20** |

### Shortlist interpretation

- **Kvali** has the best balance. It connects memory (“the trace retained from
  prior work”), context (“follow the trace back to sources”), open documents
  (“the trace is readable”), and auditability (“the trace remains inspectable”).
- **Matiane** is the strongest alternative if the product should feel like a
  project chronicle. It is especially resonant with ADR-driven engineering, but
  it overweights history relative to active tasks and requirements.
- **Pesvi** is the cleanest collision field and fits “the foundational layer,”
  but users cannot infer memory or records from it without explanation.
- **Docsubstrate** wins literal discoverability and loses brand quality. It is a
  useful category phrase, not a product name.
- **Strata** is the best English metaphor and the worst ownership choice.

## Recommendation: Kvali

Adopt **Kvali** as the product name.

> **Kvali — the docs-native memory and context engine for agents.**

The name is short, lowercase-friendly, pronounceable as roughly
“KVAH-lee,” and available as a bare npm package at the time of research. It
belongs beside Georgian names already used in the product family—Tsa and
Nisli—without sounding like a subcomponent of either.

More importantly, “trace” unifies the product without flattening it:

- a task is a trace of intended work;
- an ADR is a trace of a decision and its lineage;
- a requirement is a trace of human intent;
- a memory is a distilled trace of what was learned;
- an operation log is a trace of mutation;
- progressive disclosure follows lightweight traces to full source documents;
- a substrate defines the shape in which each kind of trace is recorded.

“Kvali” does not explain itself in an MCP server list, so the descriptor is not
optional. Registry and README appearances should use **“Kvali — docs-native
memory and context for agents”**, never the bare name alone until awareness
exists.

Before final adoption, perform trademark review and registrar checks for the
chosen web properties. The quick collision search is encouraging but not a
substitute for either.

## Why not keep “backlog” as the product name?

There is real equity in “backlog”:

- Goga already uses `backlog_wakeup`, `backlog_recall`, `backlog_remember`, and
  `backlog_forget` as habitual verbs.
- Existing MCP configurations install `backlog-mcp`.
- The statement “your backlog is your agent's memory” is an effective bridge
  from work tracking to durable memory.

But equity in a command prefix is not the same as a viable category name.
“Backlog” tells a new user to expect queued tasks. It makes ADRs, requirements,
project knowledge, custom substrates, and progressive recall look like scope
creep. The architecture has crossed the point where the old name can stretch
without distorting the product.

The right split is:

- **Kvali** is the product and category brand.
- **backlog-mcp** remains the initial distribution and compatibility package.
- **`backlog_*`** remains the initial tool vocabulary.
- “Your backlog is your agent's memory” remains migration copy and product
  lineage, not the permanent definition.

## Migration and compatibility

### Phase 1 — brand without breakage

1. Rename the README, viewer chrome, docs, MCP server display name, and website
   to **Kvali**.
2. Keep `npx backlog-mcp`, the `backlog-mcp` npm package, and the existing
   executable working unchanged.
3. Keep all `backlog_*` tool names. Do not duplicate every tool as `kvali_*`;
   duplicate tools enlarge the discovery surface and split learned behavior.
4. Recommend `"kvali"` as the MCP config key in new examples, while explicitly
   documenting that the key is user-chosen and existing `"backlog"` keys keep
   working.
5. Keep existing storage paths, `.backlog-mcp`, `BACKLOG_*` environment
   variables, entity IDs, resource URIs, and persisted Markdown untouched.
   A brand migration must not become a data migration.

This phase makes the rename nearly zero-risk: users see a new product identity
without losing commands, configs, tool-selection priors, or muscle memory.

### Phase 2 — additive distribution alias

If the name is accepted and the bare package remains available:

1. Publish `kvali` as the preferred npm package.
2. Make `backlog-mcp` a compatibility package or equivalent entry point that
   installs/runs the same implementation.
3. Ship both `kvali` and `backlog-mcp` executable names from the preferred
   package where npm packaging permits.
4. Update new install docs to `npx -y kvali`; retain a prominent legacy
   example and a tested compatibility path.
5. Do not deprecate `backlog-mcp` until at least two stable release cycles have
   proven the alias in local MCP clients, remote deployments, and auto-update
   behavior.

Package aliases must not create two independently versioned products. One
release pipeline should publish the same artifact under both entry points.

### Phase 3 — reconsider the tool prefix separately

Tool names are a protocol and behavioral compatibility surface, not merely
branding. Rename them only after measuring whether `backlog_*` materially harms
discovery under the Kvali brand.

The default recommendation is to retain `backlog_*` long-term, much as a
product can preserve a stable command language after its category expands.
If a future rename is justified, use one announced compatibility window with
server-side aliases and explicit removal criteria; do not maintain two complete
prefixes indefinitely.

### Concrete compatibility matrix

| Surface | New default | Compatibility posture |
|---|---|---|
| Product name | Kvali | “formerly backlog-mcp” during transition |
| Positioning | Docs-native memory and context engine for agents | Keep “your backlog is your agent's memory” as bridge copy |
| npm install | Phase 1: `backlog-mcp`; Phase 2: `kvali` | Keep `backlog-mcp` runnable |
| CLI executable | Phase 2: `kvali` | Keep `backlog-mcp` alias |
| MCP config key | `kvali` in new docs | Existing `backlog` key is unchanged |
| MCP server info name | `kvali` after client compatibility audit | No stored-data impact; test clients that display/cache it |
| MCP tools | `backlog_*` | No immediate rename |
| Repo config/env | Existing `.backlog-mcp`, `BACKLOG_*` | Do not migrate in the naming release |
| Data and document IDs | Unchanged | Never rewrite persisted artifacts for branding |

## Acceptance criteria

The rename is successful when:

1. A newcomer can explain Kvali without knowing MCP: “it makes project docs the
   durable memory and context layer for agents.”
2. An existing user upgrades without editing their MCP config or relearning
   `backlog_recall`.
3. ADRs, requirements, memories, tasks, and future substrates all sound native
   to the product rather than bolted onto a task tracker.
4. Search results and MCP registries always pair the coined name with the
   descriptive category.
5. The name survives trademark and domain review before repositories or
   packages are irreversibly moved.
