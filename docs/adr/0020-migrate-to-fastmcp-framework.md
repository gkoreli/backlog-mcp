# ADR-0020: Refactor to Fastify with Clean Architecture

**Status**: Accepted  
**Date**: 2026-01-25  
**Deciders**: @gogakoreli  
**Related**: TASK-0090, ADR-0013.2 (stdio bridge)

## Context

The current `http-server.ts` implementation (458 lines) is a monolithic file that tightly couples:
- MCP server creation and tool registration
- HTTP routing and request handling
- Viewer UI serving and API endpoints
- Session management
- Static file serving

### Current Architecture Problems

1. **Tight coupling**: MCP protocol logic mixed with HTTP routing and viewer logic
2. **No authentication**: Cannot secure for cloud deployment
3. **Session-based**: Not serverless-ready (uses in-memory Map)
4. **Manual everything**: CORS, error handling, session cleanup all custom
5. **Not production-ready**: Missing health checks, proper logging, OAuth

### Business Driver: ChatGPT Integration

Goal is to deploy backlog-mcp to the cloud and integrate with ChatGPT using OpenAI Apps SDK, which requires:
- HTTPS endpoint (cloud deployment)
- OAuth authentication (optional but recommended)
- Stateless mode (for serverless platforms)
- CORS handling
- Health check endpoint

## Decision

**Selected**: Option 2 - Refactor to Fastify with Official MCP SDK

**Rationale**:

The simplest solution that achieves all goals:

1. **Solves "messy code"**: Clean separation into focused modules
2. **Cloud-ready**: Stateless mode via `sessionIdGenerator: undefined`
3. **Auth ready**: Simple API key auth (ChatGPT supports this)
4. **One server**: Fastify handles everything on one port
5. **Official SDK**: No third-party MCP frameworks needed
6. **Maintainable**: Each tool in own file, easy to test and extend

**Why not FastMCP (Option 1)?**
- Overkill for our needs
- Adds unnecessary abstraction
- Official SDK is sufficient
- We were overthinking the problem

**Why not keep current (Option 3)?**
- 458 lines of mixed concerns
- Hard to test and extend
- Doesn't solve the problem

**Trade-offs Accepted**:
- ⚠️ No OAuth (but API key auth is sufficient for ChatGPT)
- ⚠️ Manual tool registration (but gives us full control and clarity)

**Why these trade-offs are worth it**:
- API key auth is simpler and ChatGPT supports it
- Manual registration means no magic, easy to understand
- Official SDK is stable and well-documented
- Less dependencies = less maintenance

## Alternatives Considered

### Option 1: Use FastMCP Framework

**Description**: Use FastMCP (third-party framework) to handle MCP protocol.

**Pros**:
- ✅ OAuth built-in
- ✅ Stateless mode built-in
- ✅ Less boilerplate

**Cons**:
- ❌ External dependency (2.9k stars but still third-party)
- ❌ Overkill for our needs
- ❌ Adds abstraction layer we don't need
- ❌ Still need to integrate with Fastify for viewer
- ❌ Learning curve for FastMCP API

**Verdict**: ❌ **Rejected** - Overthinking the problem. Official SDK is sufficient.

### Option 2: Refactor to Fastify with Official SDK (CHOSEN)

**Description**: Use Fastify as main server, official MCP SDK for protocol handling, clean separation of concerns.

```typescript
// One Fastify server
const app = Fastify();

// MCP endpoint using official SDK
app.all('/mcp', async (req, reply) => {
  const server = new McpServer({ name: 'backlog-mcp', version: '1.0.0' });
  // Register tools
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw);
});

// Viewer routes
app.get('/tasks', async () => storage.list());
app.register(fastifyStatic, { root: './viewer' });
```

**Structure**:
```
src/
├── server/
│   ├── index.ts           # Main entry point
│   ├── mcp-handler.ts     # MCP logic (isolated)
│   └── viewer-routes.ts   # Viewer routes (isolated)
├── tools/
│   ├── backlog-list.ts    # Each tool in own file
│   ├── backlog-create.ts
│   └── ...
├── middleware/
│   └── auth.ts            # API key auth
└── storage/
    └── backlog.ts         # Existing storage
```

**Pros**:
- ✅ **Clean separation**: MCP handler, viewer routes, tools all isolated
- ✅ **One server**: Simple deployment, one port
- ✅ **Official SDK**: No third-party dependencies for MCP
- ✅ **Stateless**: `sessionIdGenerator: undefined` enables stateless mode
- ✅ **API key auth**: Simple, ChatGPT supports it
- ✅ **Easy to test**: Each module testable independently
- ✅ **Easy to extend**: Add tools by creating new files
- ✅ **Minimal code**: ~50 lines per file, clean and focused

**Cons**:
- ⚠️ No OAuth (but API key auth is sufficient for ChatGPT)
- ⚠️ Manual tool registration (but gives us full control)

**Verdict**: ✅ **CHOSEN** - Simple, clean, maintainable, uses official SDK.

### Option 3: Keep Current Monolithic Implementation

**Description**: Keep existing 458-line `http-server.ts` as-is.

**Pros**:
- ✅ No migration effort
- ✅ Already works

**Cons**:
- ❌ 458 lines of mixed concerns
- ❌ Hard to test
- ❌ Hard to extend
- ❌ No auth
- ❌ Not cloud-ready

**Verdict**: ❌ **Rejected** - Doesn't solve the "messy code" problem.

## Architecture

### Before (Current)

```
src/server/http-server.ts (458 lines)
├── MCP server creation
├── Tool registration (6 tools)
├── Resource registration (3 resources)
├── HTTP routing
├── Session management
├── Viewer API endpoints
├── Static file serving
└── CORS handling
```

### After (Clean Fastify + Official SDK)

```
src/
├── server/
│   ├── index.ts           # Main entry (~50 lines)
│   ├── mcp-handler.ts     # MCP logic (~40 lines)
│   └── viewer-routes.ts   # Viewer routes (~30 lines)
├── tools/
│   ├── backlog-list.ts    # ~20 lines each
│   ├── backlog-get.ts
│   ├── backlog-create.ts
│   ├── backlog-update.ts
│   ├── backlog-delete.ts
│   └── write-resource.ts
├── resources/
│   ├── tasks.ts           # ~15 lines each
│   ├── task-by-id.ts
│   └── resource-file.ts
├── middleware/
│   └── auth.ts            # ~20 lines
└── storage/
    └── backlog.ts         # Existing (unchanged)
```

**Total**: ~300 lines (vs 458), but clean and focused

### Implementation

#### 1. Main Server (Entry Point)

```typescript
// src/server/index.ts
import Fastify from 'fastify';
import { registerViewerRoutes } from './viewer-routes.js';
import { registerMcpHandler } from './mcp-handler.js';
import { authMiddleware } from '../middleware/auth.js';
import { storage } from '../storage/backlog.js';

const app = Fastify({ logger: true });

storage.init(process.env.BACKLOG_DATA_DIR ?? './data');

app.addHook('preHandler', authMiddleware);
registerViewerRoutes(app);
registerMcpHandler(app);

app.get('/health', async () => ({ status: 'ok' }));

const port = parseInt(process.env.PORT || '3030');
app.listen({ port, host: '0.0.0.0' });
```

#### 2. MCP Handler (Isolated)

```typescript
// src/server/mcp-handler.ts
import { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index.js';

export function registerMcpHandler(app: FastifyInstance) {
  app.all('/mcp', async (req, reply) => {
    const server = new McpServer({ name: 'backlog-mcp', version: '1.0.0' });
    
    registerTools(server);
    registerResources(server);
    
    // Stateless transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true,
    });
    
    reply.raw.on('close', () => {
      transport.close();
      server.close();
    });
    
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw);
  });
}
```

#### 3. Tools (One File Per Tool)

```typescript
// src/tools/backlog-list.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog.js';

export function registerBacklogListTool(server: McpServer) {
  server.registerTool('backlog_list', {
    description: 'List tasks from backlog',
    inputSchema: z.object({
      status: z.array(z.string()).optional(),
      limit: z.number().optional(),
    }),
  }, async (args) => {
    const tasks = storage.list(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }],
    };
  });
}
```

#### 4. Auth Middleware

```typescript
// src/middleware/auth.ts
import { FastifyRequest, FastifyReply } from 'fastify';

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  if (req.url === '/health') return;
  
  if (req.url.startsWith('/mcp')) {
    const apiKey = req.headers.authorization;
    if (apiKey !== `Bearer ${process.env.API_KEY}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  }
}
```

### Why This Architecture?

1. **Clean Separation**: Each concern in its own file
2. **One Server**: Fastify handles everything on port 3030
3. **Official SDK**: No third-party MCP frameworks
4. **Stateless**: `sessionIdGenerator: undefined` enables cloud deployment
5. **Simple Auth**: API key (ChatGPT supports this)
6. **Easy to Test**: Each module testable independently
7. **Easy to Extend**: Add tools by creating new files

## Migration Plan

### Phase 1: Setup (30 min)
1. Install FastMCP: `pnpm add fastmcp`
2. Create `src/server/fastmcp-server.ts`
3. Create `src/server/viewer-server.ts`

### Phase 2: Migrate MCP Tools (1 hour)
1. Convert 6 tools to FastMCP API:
   - `backlog_list`
   - `backlog_get`
   - `backlog_create`
   - `backlog_update`
   - `backlog_delete`
   - `write_resource`

### Phase 3: Migrate MCP Resources (30 min)
1. Convert 3 resources to FastMCP API:
   - `mcp://backlog/tasks`
   - `mcp://backlog/tasks/{id}`
   - `mcp://backlog/resources/{path}`

### Phase 4: Viewer Routes (30 min)
1. Extract viewer routes to Fastify app
2. Keep existing API endpoints
3. Static file serving

### Phase 5: Testing (30 min)
1. Update tests for new structure
2. Test all tools and resources
3. Test viewer UI
4. Test stateless mode

### Phase 6: Documentation (30 min)
1. Update README with FastMCP setup
2. Document OAuth configuration
3. Document cloud deployment options
4. Document ChatGPT integration

**Total estimated effort**: 2-3 hours

## Consequences

### Positive

- ✅ **Clean separation of concerns**: MCP logic vs viewer logic
- ✅ **OAuth ready**: Can secure cloud deployment immediately
- ✅ **Stateless mode**: Deploy to Vercel, Railway, Fly.io, Cloudflare Workers
- ✅ **ChatGPT integration**: Ready for OpenAI Apps SDK
- ✅ **Production-ready**: Health checks, logging, error handling built-in
- ✅ **Maintainable**: Framework handles boilerplate, we focus on business logic
- ✅ **Future-proof**: Active development, large community

### Negative

- ⚠️ **Migration effort**: 2-3 hours of refactoring
- ⚠️ **External dependency**: Relying on FastMCP maintenance
- ⚠️ **Learning curve**: Need to learn FastMCP API (minimal)
- ⚠️ **Testing**: Need to verify all functionality works after migration

### Neutral

- 🔄 **API changes**: Tool implementations stay same, just wrapped differently
- 🔄 **Viewer unchanged**: UI and API endpoints remain the same
- 🔄 **Storage unchanged**: Backlog storage layer untouched

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| FastMCP breaking changes | High | Pin version, monitor releases |
| Migration bugs | Medium | Comprehensive testing, gradual rollout |
| Performance regression | Low | Benchmark before/after |
| OAuth complexity | Medium | Start without OAuth, add later |
| Stateless mode issues | Medium | Test thoroughly, keep session mode as fallback |

## Success Criteria

- [ ] All 6 MCP tools working with FastMCP
- [ ] All 3 MCP resources working
- [ ] Viewer UI accessible and functional
- [ ] All tests passing (45+ tests)
- [ ] Stateless mode enabled and tested
- [ ] OAuth configuration documented
- [ ] Can deploy to cloud platform (Vercel/Railway)
- [ ] ChatGPT integration documented
- [ ] Performance equal or better than current
- [ ] Code reduced from 458 lines to <200 lines

## References

- [FastMCP GitHub](https://github.com/punkpeye/fastmcp) - 2.9k stars
- [FastMCP npm](https://www.npmjs.com/package/fastmcp)
- [OpenAI Apps SDK Quickstart](https://developers.openai.com/apps-sdk/quickstart)
- [FastMCP Showcase](https://github.com/punkpeye/fastmcp#showcase) - 15+ production examples
- [MCP Specification](https://modelcontextprotocol.io/)

## Notes

- FastMCP is the most popular TypeScript MCP framework (2.9k stars vs alternatives)
- Stateless mode is critical for serverless deployment
- OAuth can be added incrementally (start without, add when deploying to cloud)
- Viewer can remain on Fastify or be integrated into FastMCP's HTTP server
- Migration is low-risk: can keep old implementation as fallback during transition
