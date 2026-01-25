# 0017. Agent 4 Production Hardening and Testing

**Date**: 2026-01-25
**Status**: Accepted
**Backlog Item**: TASK-0079

## Context

After Phases 1-3 of the HTTP MCP server architecture, we have a functionally correct implementation with:
- HTTP server with SSE transport (http-server.ts)
- stdio-to-HTTP bridge with auto-spawn (bridge.ts)
- Critical bug fixes (initialize handshake, notifications, body size limit)

However, the implementation has critical gaps:
- **Zero test coverage** for new code (bridge.ts, http-server.ts)
- **One failing test** (resource path resolution bug)
- **No graceful shutdown** (SIGTERM/SIGINT not handled)
- **No production hardening** (reconnection, observability, error handling)

Agent 4's mission is to polish the implementation for production readiness while adhering to the "ABSOLUTE MINIMAL code" constraint.

### Current State

**Test Status**: 28/29 passing (96.5%)
- 1 failing: Resource path resolution (pre-existing bug)
- 0% coverage: bridge.ts, http-server.ts

**Production Readiness**:
- ✅ Core functionality works
- ✅ Protocol compliance
- ✅ Security baseline (body size limit)
- ❌ No automated tests
- ❌ No graceful shutdown
- ❌ No reconnection logic
- ❌ No observability

### Research Findings

**From holistic review**:
1. Architecture is solid (clean separation, good SDK usage)
2. Auto-spawn logic is robust
3. Manual JSON-RPC routing is a design smell (but works)
4. Resource path bug is straightforward to fix
5. Testing is the critical gap (0% coverage for new code)

**Constraint**: "ABSOLUTE MINIMAL code" - avoid over-engineering, focus on high-impact changes.

## Proposed Solutions

### Option 1: Comprehensive Approach (Full Production Hardening)

**Description**: Implement all production features: tests, graceful shutdown, reconnection, observability, utilities.

**Implementation**:
1. Fix resource path bug
2. Add comprehensive test suite (80%+ coverage)
3. Extract utilities (HTTP client, server manager)
4. Add graceful shutdown (SIGTERM/SIGINT)
5. Add reconnection logic
6. Add observability (debug logging, /health endpoint, metrics)
7. Update documentation

**Pros**:
- Fully production-ready
- High confidence (comprehensive tests)
- Robust (reconnection, graceful shutdown)
- Observable (logging, metrics)

**Cons**:
- High effort (8-12 hours)
- Violates "ABSOLUTE MINIMAL code" constraint
- Over-engineering for local use case
- Adds complexity

**Implementation Complexity**: HIGH

---

### Option 2: Minimal Critical Path (Tests + Bug Fix + Graceful Shutdown)

**Description**: Focus on critical gaps only: fix bug, add tests, add graceful shutdown. Skip utilities, reconnection, and observability.

**Implementation**:
1. Fix resource path bug (30 min)
2. Add comprehensive test suite (4-6 hours)
   - Unit tests for bridge.ts
   - Unit tests for http-server.ts
   - Integration tests for critical flows
3. Add graceful shutdown (15 min)
   - SIGTERM/SIGINT handlers
   - Clean connection close

**Pros**:
- Addresses critical gaps (tests, bug, shutdown)
- Minimal code (no unnecessary abstractions)
- High impact (100% test pass rate, 80%+ coverage)
- Production-ready for local use
- Aligns with "ABSOLUTE MINIMAL code" constraint

**Cons**:
- No reconnection logic (acceptable for stable server)
- No observability (acceptable for local use)
- No utilities extracted (acceptable - YAGNI)

**Implementation Complexity**: MEDIUM

---

### Option 3: Ultra-Minimal (Bug Fix + Basic Tests Only)

**Description**: Fix bug and add minimal tests. Skip graceful shutdown, reconnection, observability.

**Implementation**:
1. Fix resource path bug (30 min)
2. Add basic tests (2-3 hours)
   - Unit tests for critical functions only
   - No integration tests
   - Target: 50-60% coverage

**Pros**:
- Minimal effort (3-4 hours)
- Fixes failing test
- Some test coverage (better than zero)

**Cons**:
- Insufficient test coverage (50-60% vs 80% target)
- No graceful shutdown (poor UX)
- Not production-ready
- Doesn't meet task requirements (80%+ coverage)

**Implementation Complexity**: LOW

---

## Decision

**Selected**: Option 2 - Minimal Critical Path (Tests + Bug Fix + Graceful Shutdown)

**Rationale**:

1. **Addresses critical gaps**: Fixes failing test, adds comprehensive tests, adds graceful shutdown
2. **Aligns with constraints**: "ABSOLUTE MINIMAL code" - no unnecessary abstractions or features
3. **High impact**: 100% test pass rate, 80%+ coverage, better UX
4. **Production-ready**: Sufficient for local use (stable server, unlikely to crash)
5. **Meets task requirements**: 80%+ coverage, bug fixed, 1 significant improvement (graceful shutdown)

**Why not Option 1**:
- Over-engineering for local use case
- Violates "ABSOLUTE MINIMAL code" constraint
- Reconnection logic is nice-to-have (server is stable)
- Observability is nice-to-have (local use, easy to debug)
- Utilities are YAGNI (only one server, no reuse needed)

**Why not Option 3**:
- Doesn't meet task requirements (80%+ coverage)
- Insufficient confidence (50-60% coverage too low)
- No graceful shutdown (poor UX, easy to add)

**Trade-offs Accepted**:
- No reconnection logic (acceptable - server is stable, unlikely to crash)
- No observability (acceptable - local use, easy to debug with console.error)
- No utilities extracted (acceptable - YAGNI, no reuse needed)
- No /health endpoint (acceptable - /version serves similar purpose)

## Consequences

**Positive**:
- ✅ 100% test pass rate (bug fixed)
- ✅ 80%+ test coverage (confidence in correctness)
- ✅ Graceful shutdown (better UX, cleaner restarts)
- ✅ Production-ready for local use
- ✅ Minimal code (no over-engineering)
- ✅ Safe refactoring (comprehensive tests)

**Negative**:
- ❌ No reconnection logic (users must restart bridge if server crashes)
- ❌ No observability (no debug logging, metrics, /health endpoint)
- ❌ No utilities extracted (HTTP helpers, server manager remain inline)

**Risks**:
- **Risk**: Server crashes during operation, bridge doesn't reconnect
  - **Mitigation**: Server is stable (unlikely to crash), users can restart bridge
  - **Future**: Add reconnection logic if crashes become common
- **Risk**: Hard to debug issues in production
  - **Mitigation**: console.error logging is sufficient for local use
  - **Future**: Add DEBUG=backlog-mcp logging if needed

## Implementation Notes

### 1. Fix Resource Path Bug

**File**: `src/uri-resolver.ts`

**Current logic**:
```typescript
// Everything else: direct mapping to dataDir/{path}
return join(dataDir, path);
```

**Fixed logic**:
```typescript
// Check if path starts with resources/{TASK-XXXX} or resources/{EPIC-XXXX}
if (path.startsWith('resources/')) {
  const match = path.match(/^resources\/(TASK-\d+|EPIC-\d+)\//);
  if (match) {
    // Task-attached resource: dataDir/resources/{taskId}/{file}
    return join(dataDir, path);
  } else {
    // Repository resource: repoRoot/{path after resources/}
    const repoPath = path.substring('resources/'.length);
    return join(getRepoRoot(), repoPath);
  }
}

// Everything else: direct mapping to dataDir/{path}
return join(dataDir, path);
```

**Test validation**: Existing test should pass after fix.

---

### 2. Add Comprehensive Tests

**Test files to create**:
- `src/cli/bridge.test.ts` - Unit tests for bridge functions
- `src/http-server.test.ts` - Unit tests for HTTP server
- `src/integration.test.ts` - Integration tests for full flow

**Bridge tests** (src/cli/bridge.test.ts):
```typescript
describe('Bridge', () => {
  describe('isServerRunning', () => {
    it('should return true if server responds with 200');
    it('should return false if server is not reachable');
  });
  
  describe('getServerVersion', () => {
    it('should return version string if server responds');
    it('should return null if server is not reachable');
  });
  
  describe('spawnServer', () => {
    it('should spawn detached process with correct args');
  });
  
  describe('shutdownServer', () => {
    it('should POST to /shutdown endpoint');
  });
  
  describe('waitForServer', () => {
    it('should poll until server is ready');
    it('should timeout if server does not start');
  });
  
  describe('ensureServer', () => {
    it('should spawn server if not running');
    it('should reuse server if version matches');
    it('should upgrade server if version mismatches');
  });
});
```

**HTTP server tests** (src/http-server.test.ts):
```typescript
describe('HTTP Server', () => {
  describe('GET /version', () => {
    it('should return package version');
  });
  
  describe('POST /shutdown', () => {
    it('should shutdown server gracefully');
  });
  
  describe('POST /mcp/message', () => {
    it('should reject payloads > 10MB with 413');
    it('should return 400 for missing sessionId');
    it('should return 404 for invalid sessionId');
  });
  
  describe('GET /mcp', () => {
    it('should create SSE transport and session');
  });
});
```

**Integration tests** (src/integration.test.ts):
```typescript
describe('Integration', () => {
  it('should auto-spawn server if not running');
  it('should reuse existing server');
  it('should upgrade server on version mismatch');
  it('should forward JSON-RPC messages correctly');
});
```

**Target**: 80%+ code coverage for bridge.ts and http-server.ts.

---

### 3. Add Graceful Shutdown

**File**: `src/http-server.ts`

**Implementation**:
```typescript
// Add at end of startHttpServer function
process.on('SIGTERM', () => {
  console.error('SIGTERM received, shutting down gracefully...');
  httpServer.close(() => {
    console.error('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.error('SIGINT received, shutting down gracefully...');
  httpServer.close(() => {
    console.error('Server closed');
    process.exit(0);
  });
});
```

**Behavior**:
- Ctrl+C (SIGINT) triggers graceful shutdown
- SIGTERM (from process manager) triggers graceful shutdown
- Server closes connections cleanly before exiting
- In-flight requests complete before shutdown

**Test**: Manual test with Ctrl+C, verify clean shutdown.

---

## Testing Strategy

**Unit tests**: Mock HTTP requests, child_process.spawn, file system
**Integration tests**: Spawn real server, test full flow
**Manual tests**: Smoke test before release

**Coverage target**: 80%+ for bridge.ts and http-server.ts

---

## Future Enhancements (Out of Scope)

These are explicitly NOT implemented in this ADR (can be added later if needed):

1. **Reconnection logic**: Auto-recover from server crashes
2. **Debug logging**: DEBUG=backlog-mcp env var
3. **Metrics**: Request count, latency, errors
4. **Health check**: /health endpoint
5. **Utilities**: HTTP client, server manager classes
6. **Request timeouts**: Timeout for long-running requests
7. **Rate limiting**: Prevent abuse

**Rationale**: YAGNI - these are nice-to-have but not critical for local use. Add only if real need emerges.

---

## Success Criteria

- ✅ Resource path bug fixed (100% test pass rate)
- ✅ Comprehensive test suite added (80%+ coverage)
- ✅ Graceful shutdown implemented (SIGTERM/SIGINT)
- ✅ Holistic review document created
- ✅ ADR documented
- ✅ All tests passing
- ✅ Production-ready for local use

---

## Conclusion

Option 2 (Minimal Critical Path) strikes the right balance between production readiness and minimal code. It addresses critical gaps (tests, bug, shutdown) without over-engineering. The implementation is sufficient for local use and can be extended later if needed.

**Estimated effort**: 5-7 hours
**Production readiness**: 9/10 for local use
