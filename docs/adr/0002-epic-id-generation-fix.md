# 0002. Fix Epic ID Generation to Prevent Overwrites

**Date**: 2026-01-21
**Status**: Accepted
**Backlog Item**: TASK-0048

## Context

When creating a new epic, the system overwrites existing epics instead of generating unique incremental IDs. For example, creating a third epic (EPIC-0003) would overwrite EPIC-0002.

### Current State

The `backlog_create` tool handler in `src/server.ts` calls:
```typescript
const task = createTask({ title, description, type, epic_id, references }, storage.list());
```

The `storage.list()` method has a default limit of 20 tasks. When calculating the next ID, `nextTaskId()` only considers these 20 most recent tasks. If there are more than 20 tasks total, older epics are not included in the calculation, causing ID collisions.

### Research Findings

1. **Root cause**: `storage.list()` defaults to `limit: 20`, so older tasks/epics are excluded from ID generation
2. **ID generation logic**: `nextTaskId()` in `schema.ts` correctly finds the max ID from the provided array, but it only sees the limited subset
3. **File structure**: Tasks are stored as `{ID}.md` files in `data/tasks/` and `data/archive/` directories

## Proposed Solutions

### Option 1: Pass Unlimited Limit to list()

**Description**: Change `storage.list()` to `storage.list({ limit: Infinity })` in the backlog_create handler.

**Pros**:
- Minimal code change (one line)
- No API changes needed
- Works immediately

**Cons**:
- Performance issue: Parses ALL markdown files just to extract IDs
- Wasteful: Reads and parses full task content when only IDs are needed
- Semantically incorrect: Abuses list() API for ID generation
- Could cause memory issues with thousands of tasks
- Doesn't fix the underlying design flaw

**Implementation Complexity**: Low

### Option 2: Create getAllIds() Method

**Description**: Add a new `getAllIds(): string[]` method to BacklogStorage that only reads filenames from both tasks/ and archive/ directories, without parsing markdown content.

**Pros**:
- Efficient: Only reads filenames, no markdown parsing
- Clean API: Purpose-built for ID generation
- Scalable: Works efficiently with thousands of tasks
- Maintains abstraction: BacklogStorage handles file I/O
- Semantically correct: Dedicated method for its purpose

**Cons**:
- Requires new method in BacklogStorage
- Slightly more code than Option 1
- Need to handle both active and archived directories

**Implementation Complexity**: Low

### Option 3: Make nextTaskId() Read Files Directly

**Description**: Change `nextTaskId()` to accept a dataDir parameter and read files directly from the file system.

**Pros**:
- Most efficient: Reads exactly what's needed
- Self-contained: Doesn't depend on external state

**Cons**:
- **BREAKS ABSTRACTION**: schema.ts would need to import fs and know about file structure
- Violates separation of concerns: schema.ts should be pure logic, not I/O
- Makes testing harder: Would need to mock file system
- Goes against current architecture pattern (BacklogStorage encapsulates all I/O)

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 2 - Create getAllIds() Method

**Rationale**: 
- **Efficiency**: Reading filenames is O(n) vs parsing markdown which is O(n*m). For 1000 tasks, this is 10x-100x faster.
- **Architecture**: Maintains clean separation of concerns - BacklogStorage handles all file I/O, schema.ts remains pure logic.
- **Correctness**: Purpose-built method for ID generation, not abusing the list() API which is designed for filtered task retrieval.
- **Scalability**: Works efficiently even with thousands of tasks.
- **Simplicity**: Minimal code change with clear intent.

**Trade-offs Accepted**:
- Adds one new method to BacklogStorage (acceptable - it's a legitimate use case)
- Slightly more code than Option 1 (but much better design)

## Consequences

**Positive**:
- Epic IDs will never collide, regardless of total task count
- Better performance for task creation
- Cleaner API semantics
- Scalable solution for large backlogs

**Negative**:
- None significant

**Risks**:
- None - this is a straightforward fix with no breaking changes

## Implementation Notes

1. Add `getAllIds()` method to BacklogStorage:
   - Read filenames from `this.tasksPath` directory
   - Read filenames from `this.archivePath` directory
   - Strip `.md` extension to get IDs
   - Return combined array

2. Update `backlog_create` handler in server.ts:
   - Change `storage.list()` to `storage.getAllIds().map(id => ({ id }))`
   - This provides the minimal structure needed by `nextTaskId()`

3. Add test case:
   - Create 25+ tasks including multiple epics
   - Verify epic IDs increment correctly
   - Verify no overwrites occur
