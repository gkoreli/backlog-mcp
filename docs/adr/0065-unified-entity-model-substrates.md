# 0065. Unified Entity Model with Substrates Architecture

**Date**: 2025-02-05
**Status**: Accepted
**Backlog Item**: TASK-0243

## Problem Statement

backlog-mcp currently has an informal, inconsistent data model. Tasks and epics are first-class entities with IDs, but resources (artifacts, documents, files) are second-class citizens without formal identity. Users need:

1. **Subtasks** - Break down tasks without heavyweight epics
2. **Folders** - Organize work hierarchically  
3. **Artifacts as first-class entities** - Resources should have IDs, be queryable, and be referenceable just like tasks
4. **Milestones** - Target dates that tasks/epics can belong to
5. **Universal referenceability** - Everything gets a stable MCP URI: `mcp://backlog/{type}/{id}`

The core problem: **How do we formalize multiple entity types (substrates) into a unified, referenceable system without exploding tool complexity or overwhelming agents?**

## Problem Space

### Why This Problem Exists

- Current model is two-level: Epic → Task. No middle ground for multi-step tasks.
- **Resources are informal**: Files in `resources/` directory have no IDs, no schema, no queryability. They're just files.
- Adding new entity types naively would mean new tools per type (backlog_create_folder, backlog_create_artifact, etc.) - tool explosion.
- Tool descriptions grow linearly with capabilities, diluting agent attention.
- The `epic_id` field is too specific - it only handles one relationship type.
- **No universal addressing**: Tasks have IDs (`TASK-0001`), but resources are addressed by path. Inconsistent.

### Who Is Affected

- **Users**: Managing backlogs with medium-complexity tasks that need subtasks
- **LLM agents**: Trying to use tools coherently without being overwhelmed
- **Developers**: Extending the system with new entity types

### Problem Boundaries

**In scope**:
- Unified entity model supporting multiple types
- Subtask capability (task → task relationship)
- New entity types: folder, artifact, milestone
- **Formalizing resources as first-class entities with IDs**
- **Universal MCP URI scheme**: `mcp://backlog/{type}/{id}`
- Agent-friendly tool design

**Out of scope**:
- Deep nesting validation (allow it, don't enforce limits)
- Complex dependency graphs between tasks
- Third-party plugin system (future)
- External file storage (artifacts store metadata, not file contents)

### Problem-Space Map

**Dominant cause**: The `epic_id` field creates a rigid two-level hierarchy. Adding new relationship types would require new fields (folder_id, milestone_id, etc.).

**Alternative root cause**: Maybe the real issue is that epics feel "too formal" - could we just make epics lighter? (Rejected: doesn't solve the extensibility problem)

**What if we're wrong**: Maybe users don't actually need subtasks - maybe better task descriptions or checklists would suffice. (Rejected: subtasks provide trackable status per step)

### Adjacent Problems

1. **Agent coherence with many entity types**: How does an agent know what types exist and how to use them?
2. **Tool description bloat**: As capabilities grow, descriptions become walls of text.
3. **Resource discoverability**: Currently resources are hidden files. With IDs, they become listable, searchable, linkable.

## Context

### Current State

```typescript
interface Task {
  id: string;           // TASK-0001 or EPIC-0001
  type?: 'task' | 'epic';
  epic_id?: string;     // Only links to epics
  // ...
}
```

- Two entity types: task, epic
- One relationship field: `epic_id`
- 5 MCP tools: create, get, list, update, delete

### Research Findings

1. **Subtask is a relationship, not a type**: A subtask is just a task whose parent is another task. No new type needed.

2. **Two orthogonal concepts**:
   - Entity Type: What kind of thing? (task, epic, folder, artifact, milestone)
   - Relationships: How does it relate? (parent_id)

3. **Agent coherence comes from uniformity**: Agents don't explore. They use what they're told. Schema resources don't help if agents don't know to look. What helps is making all types behave identically.

4. **First-encounter learning**: Instead of upfront documentation, teach agents contextually by including schema hints on first interaction with each type.

5. **Tools + Resources are complementary**: Tools for ID generation, queries, validation. `write_resource` for raw updates. No tool explosion.

### Prior Art

- **Jira/Linear**: Hierarchical issues with parent relationships
- **File systems**: Folders containing items of various types
- **GraphQL**: Schema introspection for capability discovery

## Proposed Solutions

### Option 1: Add `parent_id` Alongside `epic_id` `[SHORT-TERM]` `[LOW]`

**Description**: Keep `epic_id` for epic membership, add `parent_id` for subtask relationship.

**Differs from others by**:
- vs Option 2: Keeps backward compatibility, but two fields for hierarchy
- vs Option 3: No migration needed, but confusing dual-field model

**Pros**:
- Zero migration
- Backward compatible

**Cons**:
- Confusing: which field to use when?
- Doesn't solve extensibility (still need folder_id, milestone_id, etc.)
- Two fields for conceptually one thing

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 5 | Additive change, no migration |
| Risk | 3 | Confusion about which field to use |
| Testability | 4 | Easy to test both fields |
| Future flexibility | 2 | Doesn't solve extensibility |
| Operational complexity | 4 | Simple addition |
| Blast radius | 4 | Existing code unchanged |

### Option 2: Unified `parent_id` Replacing `epic_id` `[MEDIUM-TERM]` `[MEDIUM]`

**Description**: Single `parent_id` field for all relationships. Semantics derived from parent's type. Add `type` field to distinguish entity types.

**Differs from others by**:
- vs Option 1: Single field instead of two, requires migration
- vs Option 3: Types defined in code, not config files

**Pros**:
- Clean unified model
- Extensible: new types don't need new fields
- Subtasks are free (task with task parent)
- Single mental model for agents

**Cons**:
- Requires migration of existing `epic_id` data
- Breaking change for API consumers

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 3 | Migration needed |
| Risk | 3 | Migration could have edge cases |
| Testability | 5 | Uniform model easier to test |
| Future flexibility | 5 | Any new type works automatically |
| Operational complexity | 4 | Simpler than dual-field |
| Blast radius | 3 | Existing data needs migration |

### Option 3: Config-Driven Substrates with YAML `[LONG-TERM]` `[HIGH]`

**Description**: Define entity types in YAML config files with separate Zod schemas. Dynamic loading at startup.

**Differs from others by**:
- vs Option 1: Complete redesign vs. incremental
- vs Option 2: External config vs. code-defined types

**Pros**:
- Maximum extensibility
- Non-developers could add types (theoretically)
- Plugin-ready architecture

**Cons**:
- Overkill for known set of types
- Two files per type (YAML + Zod)
- Added complexity without clear benefit today
- Zod alone is already declarative

**Rubric Scores**:
| Anchor | Score (1-5) | Justification |
|--------|-------------|---------------|
| Time-to-ship | 2 | Significant architecture change |
| Risk | 2 | More moving parts |
| Testability | 3 | Config loading adds test surface |
| Future flexibility | 5 | Maximum extensibility |
| Operational complexity | 2 | Config + code to maintain |
| Blast radius | 2 | Touches everything |

## Decision

**Selected**: Option 2 - Unified `parent_id` with Zod-based substrate registry

**Rationale**: 
- Option 1 doesn't solve extensibility - we'd still need folder_id, milestone_id, etc.
- Option 3 is overengineering - Zod is already declarative, YAML adds no value for our use case.
- Option 2 gives us a clean, extensible model with reasonable migration effort.

**For this decision to be correct, the following must be true**:
1. Migration from `epic_id` to `parent_id` is straightforward (it is - simple field rename)
2. Agents can work effectively with a uniform entity model (they can - same pattern for all types)
3. 5 entity types are sufficient for foreseeable needs (task, epic, folder, artifact, milestone)

**Trade-offs Accepted**:
- One-time migration effort for existing data
- Breaking change for any external API consumers (acceptable - internal tool)

## Consequences

**Positive**:
- Subtasks work without new types or tools
- New entity types (folder, artifact, milestone) use same tools
- Tool surface stays at 5 tools regardless of entity count
- Agents learn one pattern that works everywhere
- First-encounter hints teach agents contextually
- **Everything is referenceable**: `mcp://backlog/task/TASK-0001`, `mcp://backlog/artifact/ARTF-0001`
- **Resources become queryable**: `backlog_list(type: 'artifact')` works
- **Cross-references work uniformly**: Any entity can reference any other via `references` field

**Negative**:
- Migration required for existing tasks with `epic_id`
- Slightly more complex type checking (need to validate parent relationships)

**Risks**:
- Migration misses edge cases → Mitigation: comprehensive test coverage
- Agents confused by multiple types → Mitigation: uniform interface, schema hints

## Implementation Notes

### Substrate Registry

```typescript
const SUBSTRATES: Record<EntityType, SubstrateConfig> = {
  task:      { prefix: 'TASK', hasStatus: true,  validParents: ['task', 'epic', 'folder', 'milestone'], hint: '...' },
  epic:      { prefix: 'EPIC', hasStatus: true,  validParents: ['folder', 'milestone'], hint: '...' },
  folder:    { prefix: 'FLDR', hasStatus: false, validParents: ['folder'], hint: '...' },
  artifact:  { prefix: 'ARTF', hasStatus: false, validParents: ['task', 'epic', 'folder'], hint: '...' },
  milestone: { prefix: 'MLST', hasStatus: true,  validParents: ['folder'], hint: '...' },
};
```

### First-Encounter Schema Hints

```typescript
const seenTypes = new Set<EntityType>();

function getSchemaHintOnce(type: EntityType): string {
  if (seenTypes.has(type)) return '';
  seenTypes.add(type);
  return `\n\n_Schema: **${type}** - ${SUBSTRATES[type].hint}_`;
}
```

### Minimal Create, Type-Specific Update

Create tool accepts only common fields:
- type, title, parent_id, description, references

Type-specific fields (due_date, content_type, blocked_reason, evidence) via update after agent learns schema from first-encounter hint.

### ID Format

All prefixes are 4 characters for consistency:
- TASK-0001, EPIC-0001, FLDR-0001, ARTF-0001, MLST-0001

### Universal URI Scheme

Every entity gets a stable MCP URI:
```
mcp://backlog/task/TASK-0001
mcp://backlog/epic/EPIC-0001
mcp://backlog/folder/FLDR-0001
mcp://backlog/artifact/ARTF-0001
mcp://backlog/milestone/MLST-0001
```

These URIs:
- Can be used in `references` field of any entity
- Work with `read_resource` / `write_resource`
- Are stable (ID-based, not path-based)
- Enable cross-entity linking

### Migration

```typescript
// One-time migration
for (const task of tasks) {
  if (task.epic_id) {
    task.parent_id = task.epic_id;
    delete task.epic_id;
  }
}
```
