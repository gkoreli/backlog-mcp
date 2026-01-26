# 0023. Migrate to StreamableHTTPServerTransport - BLOCKED

**Date**: 2026-01-25
**Status**: Rejected - Blocked by mcp-remote incompatibility
**Backlog Item**: TASK-0090

## Critical Finding

**StreamableHTTPServerTransport is NOT backward compatible with mcp-remote (stdio bridge).**

After implementation and testing, discovered that:
1. ✅ StreamableHTTPServerTransport exists in MCP SDK
2. ✅ SSEServerTransport is deprecated
3. ❌ **mcp-remote does not support StreamableHTTPServerTransport protocol**
4. ❌ **Migrating breaks the stdio bridge (core feature)**

### Test Results

**Stateless mode** (`sessionIdGenerator: undefined`):
```
Connection error: SseError: SSE error: TypeError: terminated: Body Timeout Error
```

**Stateful mode** (`sessionIdGenerator: () => randomUUID()`):
```
Connection error: SseError: SSE error: Non-200 status code (400)
```

Both modes fail because mcp-remote expects the legacy SSE protocol, not the new Streamable HTTP protocol.

## Context

The current implementation uses **SSEServerTransport**, which is now deprecated in the MCP SDK. The SDK documentation explicitly states: "@deprecated SSEServerTransport is deprecated. Use StreamableHTTPServerTransport instead."

### Current State

**File**: `src/server/mcp-handler.ts` (52 lines)

```typescript
const sessions = new Map<string, SSEServerTransport>();

export function registerMcpHandler(app: FastifyInstance) {
  // GET /mcp - Establish SSE connection
  app.get('/mcp', async (request, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
    registerTools(server);
    registerResources(server);
    
    const transport = new SSEServerTransport('/mcp/message', reply.raw);
    sessions.set(transport.sessionId, transport);
    transport.onclose = () => sessions.delete(transport.sessionId);
    
    await server.connect(transport);
    return reply;
  });
  
  // POST /mcp/message - Handle MCP messages
  app.post('/mcp/message', async (request, reply) => {
    const sessionId = request.query.sessionId as string;
    if (!sessionId) return reply.code(400).send({ error: 'Missing sessionId' });
    
    const transport = sessions.get(sessionId);
    if (!transport) return reply.code(404).send({ error: 'Session not found' });
    
    await transport.handlePostMessage(request.raw, reply.raw, request.body);
    return reply;
  });
}
```

**Issues**:
- ❌ Uses deprecated API (will be removed in future SDK versions)
- ❌ Session-based architecture (not serverless-ready)
- ❌ Manual session management with Map
- ❌ Two routes to maintain
- ❌ Memory leak risk if sessions aren't cleaned up properly

### Research Findings

1. **StreamableHTTPServerTransport exists**: Available in current MCP SDK (`@modelcontextprotocol/sdk/server/streamableHttp.js`)
2. **Supports stateless mode**: `sessionIdGenerator: undefined` enables stateless operation
3. **Single route design**: `handleRequest()` method handles all HTTP methods (GET, POST)
4. **McpServer ownership**: SDK docs state "The server object assumes ownership of the Transport... and expects that it is the only user of the Transport instance" - meaning one server per transport
5. **No breaking changes**: Transport layer is abstracted from MCP clients

## Proposed Solutions

### Option 1: Stateless Per-Request Architecture (SELECTED)

**Description**: Create fresh McpServer + StreamableHTTPServerTransport per request. No session Map, no global state. Single route handles all methods.

**Implementation**:
```typescript
export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    // Fresh server per request
    const server = new McpServer({
      name: 'backlog-mcp',
      version: pkg.version
    });

    registerTools(server);
    registerResources(server);

    // Stateless transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true,
    });

    // Cleanup on connection close
    reply.raw.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw);
  });
}
```

**Pros**:
- ✅ Uses recommended SDK API (not deprecated)
- ✅ Stateless - serverless-ready
- ✅ No session management complexity
- ✅ Single route (simpler)
- ✅ No memory leaks (no global state)
- ✅ Clean architecture (each request is isolated)
- ✅ Concurrent requests are fully isolated
- ✅ ~22 lines less code (52 → 30 lines)

**Cons**:
- ⚠️ Creates McpServer per request (minimal overhead - just object instantiation)

**Implementation Complexity**: Low (30 minutes)

### Option 2: Stateful with Session Map

**Description**: Keep session Map architecture but swap SSEServerTransport for StreamableHTTPServerTransport.

**Implementation**:
```typescript
const sessions = new Map<string, { server: McpServer, transport: StreamableHTTPServerTransport }>();

export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (request, reply) => {
    const sessionId = request.query.sessionId as string;
    
    if (!sessionId) {
      // Create new session
      const server = new McpServer({ name: 'backlog-mcp', version: pkg.version });
      registerTools(server);
      registerResources(server);
      
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      
      sessions.set(transport.sessionId, { server, transport });
      transport.onclose = () => sessions.delete(transport.sessionId);
      
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw);
    } else {
      // Use existing session
      const session = sessions.get(sessionId);
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      
      await session.transport.handleRequest(request.raw, reply.raw);
    }
  });
}
```

**Pros**:
- ✅ Uses non-deprecated API

**Cons**:
- ❌ Still session-based (not serverless-ready)
- ❌ Manual session management
- ❌ Memory leak risk
- ❌ More complex code
- ❌ Doesn't solve architectural problems
- ❌ No real benefits over current implementation

**Implementation Complexity**: Medium (1 hour)

**Critique**: This is a half-measure. We'd be refactoring just to use a non-deprecated API without fixing the underlying architectural issues. There's no compelling reason to choose this approach.

### Option 3: Singleton Server with Per-Request Transport

**Description**: Reuse one global McpServer instance, create transport per request.

**Critique**: This violates SDK design. The MCP SDK documentation explicitly states that McpServer "assumes ownership of the Transport" and "expects that it is the only user of the Transport instance going forward." This means one server per transport, not one server with multiple transports. This approach would be unsafe for concurrent requests and could cause state corruption.

**Implementation Complexity**: N/A (architecturally unsound)

## Decision

**Selected**: NONE - Migration is BLOCKED

**Rationale**: 
1. **Breaking change**: StreamableHTTPServerTransport breaks stdio bridge (mcp-remote)
2. **Core feature impact**: stdio bridge is the primary way users interact with backlog-mcp
3. **No migration path**: mcp-remote doesn't support the new protocol yet
4. **SDK ecosystem not ready**: Need to wait for mcp-remote to add StreamableHTTPServerTransport support

**Trade-offs Accepted**:
- **Continue using deprecated API**: SSEServerTransport will remain until mcp-remote supports the new protocol
- **Technical debt**: Accept deprecation warnings for now

## Consequences

**Positive**:
- ✅ stdio bridge continues to work
- ✅ No breaking changes for users
- ✅ Stable, tested implementation

**Negative**:
- ❌ Using deprecated API (SSEServerTransport)
- ❌ Not serverless-ready
- ❌ Session management complexity remains

**Risks**:
- **Future SDK versions**: SSEServerTransport might be removed. Mitigation: Pin SDK version until mcp-remote is updated.
- **Deprecation warnings**: Build warnings about deprecated API. Mitigation: Document why we can't migrate yet.

## Blocking Issues

1. **mcp-remote compatibility**: The `mcp-remote` package (v0.1.37) only supports SSE protocol, not Streamable HTTP
2. **No dual-transport solution**: Supporting both SSE and Streamable HTTP would add significant complexity
3. **Ecosystem timing**: Need to wait for mcp-remote maintainers to add support

## Future Work

**When to revisit**:
- ✅ mcp-remote adds StreamableHTTPServerTransport support
- ✅ MCP SDK provides backward-compatible dual-transport solution
- ✅ Alternative stdio bridge emerges that supports new protocol

**Recommended approach when unblocked**:
- Use Option 1 from this ADR (Stateless Per-Request Architecture)
- Test thoroughly with both direct HTTP clients and stdio bridge
- Consider phased rollout (opt-in flag for new transport)

## Implementation Notes

**DO NOT**:
- ❌ Migrate to StreamableHTTPServerTransport until mcp-remote supports it
- ❌ Remove SSEServerTransport code
- ❌ Suppress deprecation warnings (they remind us to check for updates)

**DO**:
- ✅ Monitor mcp-remote releases for StreamableHTTPServerTransport support
- ✅ Keep this ADR updated with ecosystem changes
- ✅ Test new mcp-remote versions when released

## Related ADRs

- **ADR-0022**: Current SSEServerTransport implementation (remains active)
- **ADR-0020**: Mentioned stateless mode as a goal (deferred until ecosystem ready)

## Lessons Learned

1. **SDK deprecation ≠ immediate migration**: Deprecated APIs may still be necessary for ecosystem compatibility
2. **Test with real clients**: Integration testing revealed incompatibility that wasn't obvious from SDK docs
3. **Ecosystem dependencies matter**: Can't migrate server transport without client support
4. **Document blocking issues**: Clear ADR prevents future attempts to migrate prematurely

## Update to ADR-0022

ADR-0022 should be marked as "Superseded by ADR-0023" since this refactor replaces the temporary SSEServerTransport solution with the long-term StreamableHTTPServerTransport architecture.
