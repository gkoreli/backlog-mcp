# 0019. Complete HTTP Architecture Migration

**Date**: 2026-01-25
**Status**: Accepted
**Backlog Item**: TASK-0084

## Context

The HTTP architecture migration (ADR-0013, ADR-0014) is **incomplete and broken**. We have duplicate systems running in parallel, with the new HTTP server missing critical functionality that exists in the old viewer.

### Current State

**OLD system (still exists):**
- `src/viewer.ts` - Full viewer with ALL endpoints
- `src/server.ts` - Old stdio server
- `src/viewer-manager.ts` - Spawns old viewer
- `src/viewer-standalone.ts` - Entry point for old viewer

**NEW system (incomplete):**
- `src/http-server.ts` - New HTTP server with SOME endpoints
- `src/cli/bridge.ts` - stdio-to-HTTP bridge

### Research Findings

**Agents 1-5 Migration History:**
- **Agent 1**: Created HTTP server with SSE transport, focused on MCP protocol
- **Agent 2**: Created stdio-to-HTTP bridge, fixed SSE bug
- **Agent 3**: Bug fixes (not detailed)
- **Agent 4**: Production hardening (tests, graceful shutdown, resource path bug fix)
- **Agent 5**: Fixed static file serving regression

**Root Cause:** Nobody copied the viewer-specific HTTP endpoints from `viewer.ts` to `http-server.ts`.

### Missing Functionality

**Endpoint comparison:**

| Endpoint | viewer.ts | http-server.ts | Status |
|----------|-----------|----------------|--------|
| `/version` | ✅ | ✅ | OK |
| `/` (viewer HTML) | ✅ | ✅ | OK |
| Static files | ✅ | ✅ | OK (fixed by Agent 5) |
| `/tasks` | ✅ | ✅ | OK |
| `/tasks/:id` | ✅ | ✅ | OK |
| `/shutdown` | ❌ | ✅ | NEW (Agent 4) |
| `/mcp` (SSE) | ❌ | ✅ | NEW (Agent 1) |
| `/mcp/message` | ❌ | ✅ | NEW (Agent 1) |
| **`/resource?path=...`** | ✅ | ❌ | **MISSING** |
| **`/mcp/resource?uri=...`** | ✅ | ❌ | **MISSING** |
| **`/open/:id`** | ✅ | ❌ | **MISSING** |

### User Impact

- ❌ Can't view file resources in browser (404 errors)
- ❌ Can't view MCP resources (404 errors)
- ❌ Can't open task files in editor from viewer
- ❌ Viewer UI is broken
- ❌ Features that worked before are now broken

## Proposed Solutions

### Option 1: Direct Copy (Minimal Migration)

**Description**: Copy the 3 missing endpoints from `viewer.ts` to `http-server.ts`, test each one, then delete old files.

**Pros**:
- Fastest approach (2-3 hours)
- Lowest risk (just copying working code)
- Achieves 100% feature parity immediately
- Aligns with "ABSOLUTE MINIMAL code" constraint
- Simple to test (copy, test, delete)
- Product perspective: Users get working features ASAP
- UX perspective: No broken 404 errors
- Architecture: Clean enough - http-server.ts already has similar patterns

**Cons**:
- Some code duplication (acceptable for self-contained endpoints)
- Doesn't improve code quality
- No refactoring or cleanup

**Implementation Complexity**: Low (2-3 hours)

### Option 2: Refactor-First Migration

**Description**: Extract shared logic (file reading, MCP resource handling) into utilities, then implement endpoints using clean abstractions, then delete old files.

**Pros**:
- Better code quality (DRY principle)
- Easier to maintain long-term
- Testable utilities
- Cleaner http-server.ts

**Cons**:
- Higher risk (refactoring introduces bugs)
- Much longer timeline (1-2 days)
- Over-engineering for current needs
- Violates "ABSOLUTE MINIMAL code" constraint
- YAGNI violation - we don't need utilities yet
- Delays fixing user-facing bugs

**Implementation Complexity**: High (1-2 days)

### Option 3: Hybrid Approach (Copy + Minimal Cleanup)

**Description**: Copy the 3 missing endpoints, test them, delete old files, THEN do minimal cleanup (extract only if duplication is painful).

**Pros**:
- Balances speed and quality
- Achieves feature parity quickly
- Allows for future refactoring
- Lower risk than Option 2

**Cons**:
- Still some code duplication
- Two-phase approach (more steps)
- Cleanup phase might get skipped (technical debt)
- Doesn't provide significant benefits over Option 1

**Implementation Complexity**: Medium (4-6 hours)

## Decision

**Selected**: Option 1 - Direct Copy (Minimal Migration)

**Rationale**:
1. **Fixes user-facing bugs fastest** - Users are experiencing broken features NOW
2. **Lowest risk** - Just copying working code, no refactoring
3. **Aligns with constraints** - "ABSOLUTE MINIMAL code" means avoid over-engineering
4. **Code duplication is acceptable** - The endpoints are self-contained and don't share logic
5. **YAGNI principle** - Can refactor later IF duplication becomes painful (it won't)
6. **Product-first** - Shipping working features is more important than perfect code
7. **Architecture is clean enough** - http-server.ts already has similar endpoint patterns

**Trade-offs Accepted**:
- Some code duplication (acceptable for self-contained endpoints)
- No immediate refactoring (can do later if needed)
- No utility extraction (YAGNI)

## Consequences

**Positive**:
- ✅ Users get working features immediately
- ✅ 100% feature parity with old viewer
- ✅ No more 404 errors
- ✅ Can delete old code (viewer.ts, viewer-manager.ts, viewer-standalone.ts)
- ✅ Single HTTP server (no more duplicate systems)
- ✅ Migration is COMPLETE

**Negative**:
- ⚠️ Some code duplication (acceptable)
- ⚠️ No refactoring (can do later if needed)

**Risks**:
- **Risk**: Copying code might introduce bugs
  - **Mitigation**: Test each endpoint after copying, commit after each step
- **Risk**: Might miss some dependencies (imports, utilities)
  - **Mitigation**: Check imports carefully, run tests after each change

## Implementation Notes

### Step-by-Step Plan

**Step 1: Copy `/resource?path=...` endpoint** (lines 144-199 from viewer.ts)
- Copy the entire endpoint logic
- Adapt imports if needed (gray-matter, filePathToMcpUri)
- Test with curl: `curl "http://localhost:3030/resource?path=/path/to/file"`
- Commit: `git commit -m "feat: add /resource endpoint to http-server"`

**Step 2: Copy `/mcp/resource?uri=...` endpoint** (lines 200-237 from viewer.ts)
- Copy the entire endpoint logic
- Uses readMcpResource and resolveMcpUri (already imported in http-server.ts)
- Test with curl: `curl "http://localhost:3030/mcp/resource?uri=mcp://backlog/..."`
- Commit: `git commit -m "feat: add /mcp/resource endpoint to http-server"`

**Step 3: Copy `/open/:id` endpoint** (lines 128-142 from viewer.ts)
- Copy the entire endpoint logic
- Uses storage.getFilePath (already available)
- Test with curl: `curl "http://localhost:3030/open/TASK-0001"`
- Commit: `git commit -m "feat: add /open/:id endpoint to http-server"`

**Step 4: Verify 100% feature parity**
- Test all endpoints (/, /tasks, /resource, /mcp/resource, /open, static files)
- Test viewer UI end-to-end
- Ensure no 404 errors
- Run all tests: `pnpm test`

**Step 5: Delete old code**
- Delete `src/viewer.ts`
- Delete `src/viewer-standalone.ts`
- Delete `src/viewer-manager.ts`
- Update any imports (check `src/server.ts`, `src/index.ts`)
- Run tests to ensure nothing broke
- Commit: `git commit -m "refactor: remove old viewer code after migration"`

**Step 6: Update tests**
- Add tests for new endpoints in `src/http-server.test.ts`
- Ensure all tests pass (100%)
- Commit: `git commit -m "test: add tests for migrated endpoints"`

**Step 7: Update documentation**
- Update README if needed
- Update this ADR with final results
- Commit: `git commit -m "docs: update after migration completion"`

### Testing Strategy

**Manual testing for each endpoint:**
```bash
# Test /resource endpoint
curl "http://localhost:3030/resource?path=/Users/gkoreli/Documents/goga/backlog-mcp/README.md"

# Test /mcp/resource endpoint
curl "http://localhost:3030/mcp/resource?uri=mcp://backlog/resources/src/server.ts"

# Test /open/:id endpoint
curl "http://localhost:3030/open/TASK-0001"

# Test viewer UI
open http://localhost:3030/
```

**Automated testing:**
- Add test cases for each endpoint
- Verify response format matches expected structure
- Test error cases (missing params, invalid paths, etc.)

### Dependencies to Check

**Imports needed:**
- `gray-matter` - Already imported in http-server.ts ✅
- `filePathToMcpUri` - Need to import from `./uri-resolver.js` ✅
- `readMcpResource` - Already imported in http-server.ts ✅
- `resolveMcpUri` - Already imported in http-server.ts ✅
- `storage.getFilePath` - Already available ✅

### Rollback Plan

If something breaks:
1. Revert the commit: `git revert HEAD`
2. Investigate the issue
3. Fix and try again

## Success Criteria

- ✅ http-server.ts has 100% feature parity with viewer.ts
- ✅ NO 404 errors (all endpoints work)
- ✅ Old code deleted (viewer.ts, viewer-standalone.ts, viewer-manager.ts)
- ✅ All imports updated
- ✅ All tests pass (100%)
- ✅ Viewer UI works end-to-end
- ✅ NO MORE REGRESSIONS

## Lessons Learned

**For future migrations:**
1. **Migrations must be COMPLETE, not partial** - Don't leave duplicate systems
2. **Old code must be DELETED after migration** - Don't leave dead code
3. **Feature parity must be VERIFIED** - Test every endpoint
4. **Testing is MANDATORY** - Automated tests catch regressions
5. **Documentation must be UPDATED** - ADRs explain decisions
6. **One agent, one complete task** - Don't split migrations across multiple agents

**Why this happened:**
- Agent 1 focused on MCP protocol (SSE transport), not viewer endpoints
- Agents 2-5 focused on their specific tasks (bridge, bugs, hardening, static files)
- Nobody took ownership of COMPLETE migration
- No checklist to verify feature parity

**How to prevent:**
- Create feature parity checklist BEFORE starting migration
- Assign one agent to complete ENTIRE migration
- Test every endpoint after migration
- Delete old code immediately after verification
