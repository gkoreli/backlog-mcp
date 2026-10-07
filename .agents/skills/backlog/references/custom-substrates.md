# Custom substrates

Read when the project needs a type not in its active catalog. If the subject is
an ADR, first read the ADR reference: `adr` is already a compiled built-in entity.

## Where and what to declare

Create `<project-root>/docs/substrates/<type>.json`. The filename is conventional;
the declaration's `type` is authoritative. The loader discovers JSON under
`docs/substrates/`, excluding `history/` from the active catalog. This is data:
no TypeScript changes, server plugins, callbacks, or compiled enum additions.

| Part | Meaning |
|---|---|
| `$schema` | Version of the definition envelope, currently URN ending `:1` |
| `definitionVersion` | Positive integer version of this particular substrate |
| `type`, `label` | Stable lowercase machine key and human singular/plural labels |
| `folder`, `identity` | Docs-relative storage folder and filename/display-ID policy |
| `schema` | Canonical entity fields, including the Markdown body as `content` |
| `workflow`, `relations` | Named transitions and typed relation fields |
| `intents` | Supported action names, inputs, defaults, and executable mechanics |
| `disclosure` | Search fields, relation expansion, and optional wakeup projection |
| `replaces` | Explicit replacement of an active packaged declarative definition |

Choose a nonoverlapping folder and unambiguous identity. Supported strategies are
`numbered`, `numbered-threaded`, and `prefixed-number`. Numbered ADR filenames can
carry thread keys like `0106.6`; a prefixed type can use `RFC-0001`.
Use bounded Draft 2020-12 JSON Schema. No remote references or arbitrary custom
keywords; the compiler, not the full JSON Schema universe, defines support.
Do not copy unimplemented fields such as `readPolicy`, `ui`, or `extendsDefinition`
from historical ADR proposals. `permitted` is reserved and not enforced as authorization.

## Complete example: a new RFC type

Save this JSON as `docs/substrates/rfc.json`. It defines proposal and acceptance,
plus links to the work addressed by the proposal:

```json
{
  "$schema": "urn:backlog-mcp:schema:substrate-definition:1",
  "definitionVersion": 1,
  "type": "rfc",
  "label": { "singular": "RFC", "plural": "RFCs" },
  "folder": "rfcs",
  "identity": {
    "strategy": "prefixed-number",
    "prefix": "RFC",
    "minimumDigits": 4,
    "displayTemplate": "RFC-{key}"
  },
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "id": { "type": "string", "minLength": 1, "maxLength": 200 },
      "type": { "const": "rfc" },
      "title": { "type": "string", "minLength": 1, "maxLength": 300 },
      "content": { "type": "string", "maxLength": 2000000 },
      "status": { "type": "string", "enum": ["proposed", "accepted"] },
      "addresses": {
        "type": "array",
        "items": { "type": "string", "minLength": 1, "maxLength": 200 },
        "maxItems": 100,
        "uniqueItems": true
      }
    },
    "required": ["id", "type", "title", "content", "status"],
    "additionalProperties": false
  },
  "workflow": {
    "field": "status",
    "initial": ["proposed"],
    "terminal": ["accepted"],
    "transitions": [
      { "name": "accept", "from": ["proposed"], "to": "accepted" }
    ]
  },
  "relations": {
    "addresses": { "targets": ["task", "epic"], "cardinality": "many" }
  },
  "intents": [
    {
      "verb": "propose",
      "operation": "create",
      "description": "Record an RFC proposal and the work it addresses.",
      "requiredInputs": ["title", "content"],
      "optionalInputs": ["addresses"],
      "defaults": { "status": "proposed" }
    },
    {
      "verb": "accept",
      "operation": "transition",
      "description": "Ratify a proposed RFC.",
      "requiredInputs": ["id"],
      "transition": "accept"
    }
  ],
  "disclosure": {
    "search": { "enabled": true, "fields": ["title", "content", "status"] },
    "get": { "context": true, "groupByRole": true, "relations": ["addresses"] },
    "wakeup": {
      "section": "rfcs",
      "includeStatuses": ["proposed"],
      "limit": 3,
      "projection": ["id", "title", "status"]
    }
  }
}
```

Default tool names are `backlog_<verb>_<type>`: this declares
`backlog_propose_rfc` and `backlog_accept_rfc`. An explicit `toolName` can override
that spelling, subject to reserved-name and collision checks. Required/optional
inputs project canonical fields; synthetic entity IDs support transition/relation
mechanics. Create defaults on exposed optional fields remain overridable; defaults
on unexposed fields are fixed. Do not expose `status` on proposal if callers must
not choose an accepted initial state.

Executable mechanics today are `create`, `transition`, `set-field`, and
`relate-and-transition`. Standalone `relate` and `append-relation` can compile but
are quarantined from MCP execution. They are not functioning actions. Relation
metadata also supports context disclosure; declaring a relation does not mean
generic field writes or every create input validate existing target entities.
Get referenced IDs when the operation relies on their existence or type.

## Verify registration and use

Start with a fresh CLI invocation in the intended home:

```bash
backlog --home project --project-root /absolute/repo --json list --type rfc
backlog --home project --project-root /absolute/repo search 'proposal' --types rfc
```

An empty list alone is not proof of successful registration. Inspect declaration
diagnostics and the selected MCP tool catalog; both declared tool names must appear
with the expected schemas. Home runtimes compile definitions at creation. A daemon
that already loaded the home can retain the old registry; recreate that runtime
(or restart the daemon when appropriate), then refresh/reconnect the MCP client.
Reconnecting a client alone does not guarantee a cached home runtime is rebuilt.

Exercise proposal, get, and acceptance on an authorized example or disposable
home. Verify wrong-substrate IDs and malformed inputs fail without a write.
Use the declared CLI catalog and dispatcher when installed:

```bash
backlog --home project --project-root /absolute/repo --json actions rfc
backlog --home project --project-root /absolute/repo --json act rfc.propose \
  --input '{"title":"Caching strategy","content":"Decision context"}'
backlog --home project --project-root /absolute/repo --json act rfc.accept \
  --input '{"id":"RFC-0001"}'
```

Use the actual returned ID/path. Older installations may lack `act`; use their
available MCP actions for equivalent lifecycle guarantees. Generic updates do not
substitute for declared acceptance. An invalid declaration is diagnosed and excluded rather
than partly activated. Unknown fields, duplicate type/tool claims, unsafe folder
paths, and unsupported schema features need a declaration fix, not a generic bypass.

## Evolve without rewriting the corpus

Freeze the outgoing definition before a breaking bump into
`docs/substrates/history/<type>@<version>.json`, then increase `definitionVersion`.
Keep the meta-schema URN separate. Missing frozen history produces diagnostics;
it does not automatically deactivate an otherwise valid declaration.
Existing native Markdown remains readable with diagnostics; canonical managed
writes must satisfy the current schema. Do not assume a general substrate
migration command exists or perform an automatic corpus rewrite.
