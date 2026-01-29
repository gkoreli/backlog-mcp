# 0035. Logging Infrastructure for Debugging and Visibility

**Date**: 2026-01-28
**Status**: Accepted
**Backlog Item**: TASK-0121

## Context

Currently the backlog-mcp server has zero visibility into runtime behavior:
- Malformed YAML task files are silently skipped with only `console.warn`
- `console.warn` goes to stdout, which is lost in MCP stdio mode
- No request/response logging
- No error tracking
- No way to diagnose issues in production

### Current State

The only logging is in `src/storage/backlog.ts`:
```typescript
console.warn(`Skipping malformed task file: ${file}`);
```

This logs only the filename, not the actual error, and the output is lost in stdio mode.

### Research Findings

- `paths.backlogDataDir` already provides the data directory path
- Fastify has `logger: false` - no built-in logging enabled
- The codebase uses functional patterns (not heavy OOP)
- Low-volume logging expected (errors, startup/shutdown, not every request)

## Proposed Solutions

### Option 1: Minimal Logger Module

**Description**: Simple functional logger module with async file writes.

**Pros**:
- Zero dependencies
- Simple to understand and maintain
- Fits codebase style
- ~50 lines of code
- Easy to test

**Cons**:
- No buffering (each log = 1 file write)
- Manual date-based file rotation

**Implementation Complexity**: Low

### Option 2: Singleton Logger Class with Buffering

**Description**: Logger class with singleton pattern and buffered writes.

**Pros**:
- Better performance with buffering
- Consistent with BacklogStorage pattern

**Cons**:
- More complex than needed
- Buffer management adds complexity (flush on shutdown, size limits)
- Overkill for low-volume logging

**Implementation Complexity**: Medium

### Option 3: Pino Logging Library

**Description**: Use the `pino` library for structured logging.

**Pros**:
- Battle-tested, fast
- Built-in rotation, async writes
- Rich features

**Cons**:
- Adds dependency (violates "keep it simple")
- Overkill for simple needs
- Configuration complexity

**Implementation Complexity**: Low (but adds dependency)

## Decision

**Selected**: Option 1 - Minimal Logger Module

**Rationale**: 
- Meets all requirements with minimal code
- No dependencies aligns with "keep it simple" requirement
- Async writes via callback-based `appendFile` are sufficient for low-volume logging
- Date-based files provide natural rotation without complexity

**Trade-offs Accepted**:
- No buffering (acceptable for low-volume logging)
- No automatic log rotation beyond date-based files
- Fire-and-forget writes (log failures don't crash the app)

## Consequences

**Positive**:
- Visibility into malformed task files with full error details
- Server startup/shutdown tracking
- Foundation for future debug logging
- No new dependencies

**Negative**:
- Users must manually clean up old log files
- No buffering may cause slight I/O overhead under heavy logging

**Risks**:
- Disk space if logs accumulate → Mitigated by date-based files (easy to delete old)
- Circular dependency with paths module → Mitigated by lazy initialization

## Implementation Notes

### Logger API

```typescript
import { logger } from '@/utils/logger.js';

logger.debug('message', { data });  // Only if LOG_LEVEL=debug
logger.info('message', { data });   // Default level
logger.warn('message', { data });
logger.error('message', { data });
```

### Log Format

JSON lines in `$BACKLOG_DATA_DIR/logs/backlog-YYYY-MM-DD.log`:

```json
{"timestamp":"2026-01-28T16:30:00.000Z","level":"warn","message":"Malformed task file","file":"TASK-0001.md","error":"Invalid YAML"}
```

### Environment Variables

- `LOG_LEVEL`: debug | info | warn | error (default: info)

### Integration Points

1. `src/storage/backlog.ts` - Replace `console.warn` with `logger.warn`
2. `src/server/fastify-server.ts` - Log startup/shutdown
3. Tool handlers (optional) - Debug-level logging for MCP calls
