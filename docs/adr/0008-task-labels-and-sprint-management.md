# 0008. Task Labels and Sprint Management

**Date**: 2026-01-22
**Status**: Accepted

## Context

Users need to organize tasks across multiple dimensions beyond the current single-dimension epic hierarchy. Specifically, engineers managing both sprint work and oncall rotations need to:

1. Separate work types (oncall vs sprint work)
2. Track time-boxed sprints (2-week boundaries)
3. Answer "what did I do in sprint X?" for retrospectives
4. Handle carryover tasks without manual migration
5. Track velocity over time

### Current State

Backlog-mcp supports only one organizational dimension:
- `epic_id` field for hierarchy (e.g., "SageMaker Studio Sprint Work")
- `backlog_list` filters by: `status`, `epic_id`, `type`, `limit`

This forces users to choose between:
- Time-based epics (EPIC: Sprint [01/14-01/28]) → requires manual task migration every 2 weeks
- Persistent epics (EPIC: Sprint Work) → loses time boundaries for retrospectives

### Research Findings

Modern task systems separate three concepts:
1. **Hierarchy** (projects, epics) - organizational grouping
2. **Time-boxing** (sprints, cycles) - temporal boundaries
3. **Categorization** (labels, tags) - flexible metadata

Examples:
- Jira: Epics + Sprints (first-class) + Labels
- Linear: Projects + Cycles + Labels
- GitHub Projects: Milestones + Iterations + Labels

## Proposed Solutions

### Option 1: Pure Labels System

**Description**: Add flexible `labels?: string[]` field with no validation.

**Pros**:
- Maximum flexibility
- Simple implementation
- Backward compatible

**Cons**:
- No validation (typos break filtering)
- Requires discipline
- Convention-based only

**Implementation Complexity**: Low

### Option 2: Structured Sprint Field

**Description**: Add domain-specific `sprint?: string` field (ISO date).

**Pros**:
- Type-safe and validated
- Clear semantics
- Easy to query (epic + sprint)

**Cons**:
- Not extensible (hardcodes "sprint")
- Doesn't support other time periods
- Still manual

**Implementation Complexity**: Low

### Option 3: Sprint as First-Class Entity

**Description**: Make sprints like epics with their own entity type and lifecycle tools.

**Pros**:
- Rich operations
- Automated lifecycle
- Clear boundaries

**Cons**:
- High complexity (new entity, tools, storage)
- Overkill for personal backlog
- Not extensible to other time periods

**Implementation Complexity**: High

### Option 4: Structured Labels with Validation

**Description**: Combine flexible labels with validation schemas and helper tools.

```typescript
interface Task {
  labels?: string[];  // ["sprint:2026-01-14", "type:oncall", "priority:p0"]
}

// Label schemas
const LABEL_SCHEMAS = {
  sprint: /^sprint:\d{4}-\d{2}-\d{2}$/,
  type: /^type:(oncall|sprint-work|personal)$/,
  priority: /^priority:(p0|p1|p2)$/
};

// Helper tools
sprint_start(date)   // Creates sprint label, tags tasks
sprint_end()         // Reports completion, handles carryover
sprint_current()     // Returns active sprint label
```

**Pros**:
- Flexibility + structure
- Agent automation via helpers
- Extensible (add schemas without breaking changes)
- Backward compatible

**Cons**:
- Medium complexity (labels + validation + tools)
- Agent must enforce conventions

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 4 - Structured Labels with Validation

**Rationale**: 
- Provides flexibility for multiple dimensions (sprint, type, priority, etc.)
- Validation prevents typos and inconsistency
- Helper tools enable agent automation of sprint lifecycle
- Extensible without schema changes
- Balances simplicity with power

**Trade-offs Accepted**:
- Medium implementation complexity vs pure labels
- Agent must validate labels vs pure flexibility
- More code to maintain vs minimal approach

## Consequences

**Positive**:
- Users can organize tasks by work type AND time period
- No manual task migration between sprints
- Rich queries: filter by any label combination
- Extensible to future dimensions (quarters, milestones, etc.)
- Agent can automate sprint management

**Negative**:
- More complex than single-field approach
- Requires label validation logic
- Agent must enforce conventions

**Risks**:
- Label proliferation if not managed → Mitigation: Define clear schemas, agent validates
- Inconsistent labeling → Mitigation: Helper tools enforce conventions
- Performance with many labels → Mitigation: Index labels if needed

## Implementation Notes

### Phase 1: Core Labels
1. Add `labels?: string[]` to Task schema
2. Add `labels?: string[]` filter to backlog_list (AND logic)
3. Update storage to persist labels in frontmatter
4. Add label validation helpers

### Phase 2: Sprint Helpers
1. Implement `sprint_start(date)` tool
2. Implement `sprint_end()` tool  
3. Implement `sprint_current()` tool
4. Add sprint label schema validation

### Phase 3: Viewer
1. Display labels as badges in task list
2. Add label filter UI
3. Show sprint timeline/calendar view

### Label Schema Format
- `sprint:YYYY-MM-DD` - Sprint start date (ISO 8601)
- `type:value` - Work type (oncall, sprint-work, personal)
- `priority:value` - Priority (p0, p1, p2)
- Extensible: Add new schemas as needed

### Backward Compatibility
- `labels` field is optional
- Existing tasks without labels work unchanged
- Filtering without labels returns all tasks
