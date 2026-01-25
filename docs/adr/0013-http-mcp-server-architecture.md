# 0013. HTTP MCP Server Architecture with Built-in stdio Bridge

**Date**: 2026-01-24
**Status**: Accepted
**Backlog Item**: TASK-0072

## Context

backlog-mcp currently operates as a stdio MCP server with an embedded or detached viewer. This architecture has several limitations:

1. **Local-only usage**: stdio transport ties the server to local process execution
2. **Viewer lifecycle issues**: Detached viewer (PR #32) introduced bugs:
   - Storage not initialized (separate process)
   - Race conditions on port binding
   - Data inconsistency (separate storage instances)
3. **Cloud deployment**: Cannot host as a service for remote access
4. **Multi-client support**: Each kiro-cli session spawns separate MCP server

### User's Long-term Vision

"I wanna transition to http mcp servers and host it on the cloud and start using it in more places"

This requires:
- HTTP-based MCP transport (SSE or Streamable HTTP)
- Persistent server that survives client disconnects
- Ability to deploy to cloud infrastructure
- Support for multiple concurrent clients

### Current State

**Architecture (PR #32 - Detached Viewer)**:
```
kiro-cli session → MCP server (stdio) → spawns detached viewer
                                         ├─ Separate process
                                         ├─ Separate storage instance
                                         └─ Race conditions on restart
```

**Problems**:
- Storage duplication across processes
- Viewer doesn't initialize storage correctly
- Complex lifecycle management
- Not cloud-ready

### Research Findings

**MCP Transport Options**:
- stdio: Process-based, local only
- SSE (Server-Sent Events): HTTP-based, established
- Streamable HTTP: HTTP-based, newer spec

**Existing Patterns**:
- mcp-remote: External stdio-to-HTTP bridge (proof-of-concept)
- Microsoft Learn MCP: HTTP server with mcp-remote for kiro-cli
- Most production MCP servers use stdio for simplicity

**kiro-cli Limitations**:
- Only supports stdio transport natively
- No built-in HTTP/SSE support
- Requires bridge for HTTP servers

## Proposed Solutions

### Option 1: Dual-Transport Implementation

**Description**: Implement both stdio and HTTP transports in the same codebase.

```
backlog-mcp
├─ npx backlog-mcp              → stdio mode (embedded viewer)
├─ npx backlog-mcp serve        → HTTP mode (SSE transport)
```

**Pros**:
- Backward compatible
- Flexible deployment options
- Single package

**Cons**:
- Dual implementation burden (every feature needs both transports)
- Larger bundle size
- More testing surface area
- stdio mode is dead weight in cloud deployment

**Implementation Complexity**: High

### Option 2: HTTP-Only with External Bridge

**Description**: Convert to pure HTTP server, rely on mcp-remote for stdio.

```
backlog-mcp → HTTP server only
mcp-remote → External stdio bridge
```

**Pros**:
- Clean, single transport implementation
- Cloud-first architecture
- Leverage existing tool

**Cons**:
- Breaking change for existing users
- External dependency (out of our control)
- Users must install and configure mcp-remote manually
- Complex setup (two packages)

**Implementation Complexity**: Low

### Option 3: HTTP-First with Built-in Bridge (RECOMMENDED)

**Description**: HTTP server is the only real implementation. stdio mode is a thin wrapper that auto-spawns HTTP server and bridges to it.

```
Core: HTTP MCP Server (SSE transport) + Viewer

├─ npx backlog-mcp              → Auto-bridge mode (default)
│   ├─ Check if HTTP server running
│   ├─ Spawn server if needed (daemon)
│   └─ Bridge stdio ↔ HTTP
│
├─ npx backlog-mcp serve        → HTTP server mode
│   ├─ SSE transport on /mcp
│   ├─ Web viewer on /
│   └─ Run as daemon
│
└─ npx backlog-mcp connect      → Explicit bridge mode (alias)
```

**Pros**:
- Single source of truth (HTTP server)
- Backward compatible (stdio via auto-bridge)
- Zero config change for existing users
- Cloud-ready (HTTP server)
- Persistent viewer (survives sessions)
- No storage duplication (single process)
- No external dependencies
- Automatic version upgrades

**Cons**:
- Bridge adds minimal latency (acceptable trade-off)
- Medium implementation complexity

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 3 - HTTP-First with Built-in Bridge

**Rationale**:

1. **Product Merit**: Aligns with long-term vision (cloud hosting) while maintaining backward compatibility
2. **User Experience**: Existing users see no breaking changes, power users get persistent viewer
3. **Technical Merit**: Single implementation (HTTP) with thin bridge wrapper
4. **Architecture**: Clean separation between server and bridge, no duplication
5. **Future-Proof**: Ready for cloud deployment, multi-client support, authentication

**Trade-offs Accepted**:
- Bridge adds minimal latency (stdio → HTTP → stdio)
- Medium implementation effort (worth it for long-term benefits)
- HTTP server must be robust (single point of failure)

## Consequences

**Positive**:
- ✅ Cloud-ready architecture (deploy to AWS, GCP, Azure)
- ✅ Persistent viewer across all agent sessions
- ✅ Single storage instance (no duplication, no stale cache)
- ✅ Automatic version management (cooperative shutdown)
- ✅ Backward compatible (existing users don't break)
- ✅ Multi-client support (multiple kiro-cli sessions share one server)
- ✅ Simpler codebase (one transport implementation)

**Negative**:
- ⚠️ Bridge adds latency (minimal, acceptable)
- ⚠️ HTTP server crash affects all clients (mitigated by auto-restart)
- ⚠️ Port conflicts possible (mitigated by configurable port)

**Risks**:
- **Risk**: Bridge implementation bugs
  - **Mitigation**: Thorough testing, fallback to direct HTTP if bridge fails
- **Risk**: HTTP server becomes bottleneck
  - **Mitigation**: Async I/O, connection pooling, horizontal scaling (cloud)
- **Risk**: Breaking changes in MCP SSE spec
  - **Mitigation**: Follow spec closely, add Streamable HTTP later

## Implementation Notes

### Phase 1: HTTP Server (Core)

**Files to create**:
- `src/http-server.ts` - HTTP server with SSE transport
- `src/transports/sse.ts` - SSE transport implementation
- `src/cli/serve.ts` - `serve` command entry point

**Changes**:
- Integrate viewer into HTTP server (same process)
- Add `/mcp` endpoint for SSE transport
- Add `/version` endpoint for version checking
- Add `/shutdown` endpoint for cooperative shutdown
- Initialize storage once in HTTP server

### Phase 2: stdio Bridge

**Files to create**:
- `src/cli/bridge.ts` - stdio-to-HTTP bridge
- `src/cli/connect.ts` - `connect` command (alias)

**Bridge Logic**:
```typescript
1. Check if HTTP server running (port 3030)
2. If not running:
   - Spawn: npx backlog-mcp serve --daemon
   - Wait for server ready
3. Check version mismatch:
   - GET /version
   - If mismatch, POST /shutdown, wait, spawn new
4. Start bridge:
   - Read JSON-RPC from stdin
   - POST to http://localhost:3030/mcp
   - Stream response to stdout
```

### Phase 3: Default Behavior

**Update `src/index.ts`**:
- Default command: auto-bridge mode
- Detect if running as stdio (check if stdin is TTY)
- If stdio, run bridge logic
- If not, show help

### Phase 4: Version Management

**Cooperative Shutdown**:
```typescript
// In HTTP server
if (req.url === '/shutdown' && req.method === 'POST') {
  res.writeHead(200);
  res.end('Shutting down...');
  server.close(() => {
    setTimeout(() => process.exit(0), 500);
  });
}
```

### Phase 5: Cloud Deployment

**Future considerations**:
- Authentication (API keys, OAuth)
- Database storage (replace file-based)
- Horizontal scaling (multiple instances)
- Load balancing
- Monitoring and logging

### Testing Strategy

1. **Unit tests**: Bridge logic, SSE transport
2. **Integration tests**: Full flow (bridge → server → response)
3. **Manual tests**: 
   - kiro-cli with auto-bridge
   - Direct HTTP client
   - Cloud deployment (ECS/Lambda)
4. **Performance tests**: Latency, throughput, concurrent clients

### Migration Path

**For existing users**:
- No config change needed
- `npx backlog-mcp` works as before (auto-bridge)
- Viewer persists across sessions (improvement)

**For cloud deployment**:
- Run `backlog-mcp serve` in container
- Configure port via `BACKLOG_VIEWER_PORT`
- Add authentication layer (future)

### Configuration

**Environment Variables**:
- `BACKLOG_DATA_DIR` - Data directory path
- `BACKLOG_VIEWER_PORT` - HTTP server port (default: 3030)
- `BACKLOG_HTTP_HOST` - HTTP server host (default: localhost)
- `BACKLOG_AUTH_TOKEN` - Authentication token (future)

### Documentation Updates

- README: Add HTTP server usage
- DEPLOYMENT.md: Cloud deployment guide
- ARCHITECTURE.md: Explain HTTP-first design
- MIGRATION.md: Guide for existing users

## Related ADRs

- [0011. Viewer Version Management](./0011-viewer-version-management.md) - Superseded by this ADR
- [0007. MCP Resource URI Implementation](./0007-mcp-resource-uri-implementation.md) - Compatible with HTTP transport

## References

- [MCP Specification - Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [mcp-remote](https://github.com/geelen/mcp-remote) - Inspiration for bridge design
- [SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
