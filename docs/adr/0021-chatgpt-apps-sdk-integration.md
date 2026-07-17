---
attention: awaiting zombie-sweep ruling (report 0009 #7)
---

# ADR-0021: ChatGPT Apps SDK Integration Strategy

**Status**: Proposed  
**Date**: 2026-01-25  
**Deciders**: @gogakoreli  
**Related**: ADR-0020 (Fastify migration), ADR-0013 (HTTP MCP server)

## Context

### Business Opportunity

OpenAI Apps SDK enables building interactive applications that run **inside ChatGPT** as native experiences. Users can interact with custom UIs (rendered in iframes) while ChatGPT orchestrates tool calls and maintains conversation context.

**Market Context (2025-2026):**
- ChatGPT apps launched with partners: Canva, Spotify, Figma, Zillow, Expedia, Coursera, Booking.com
- Developer mode available for immediate testing (no approval needed)
- Public app store submissions now open
- Apps SDK uses Model Context Protocol (MCP) as backbone

### What Apps SDK Provides

**1. Interactive UI in ChatGPT**
- React/HTML components render inline in conversations
- Three display modes: inline, Picture-in-Picture (PiP), fullscreen
- Sandboxed iframe with `window.openai` API bridge

**2. Bidirectional Communication**
```
User ←→ ChatGPT ←→ Your MCP Server ←→ Your UI Component
```

**3. `window.openai` API Capabilities**

| API | Purpose | Use Case |
|-----|---------|----------|
| `callTool(name, args)` | UI triggers MCP tools | "Mark task done" button |
| `sendFollowUpMessage(prompt)` | UI sends messages to ChatGPT | "Suggest next task" |
| `setWidgetState(state)` | Persist UI state | Save filters, selections |
| `requestDisplayMode(mode)` | Request fullscreen/PiP | Expand to full view |
| `requestModal(template)` | Open modals | Task details modal |
| `uploadFile(file)` | Upload images | Attach screenshots |
| `openExternal(href)` | Open external links | Link to GitHub issue |
| `toolOutput` | Read structured data | Display task list |
| `theme` | Dark/light mode | Match ChatGPT theme |
| `locale` | User's language | i18n support |

**4. State Management**
- `structuredContent` - Visible to ChatGPT (can reason about it)
- `widgetState` - Persists across renders (per-widget instance)
- `_meta` - Hidden from ChatGPT (UI-only data)

**5. Authentication**
- OAuth 2.1 with MCP authorization spec
- Dynamic Client Registration (DCR)
- PKCE support
- Per-tool security schemes

**6. Monetization**
- External checkout (redirect to your site)
- Instant Checkout (beta, select partners)
- Stripe/Adyen integration

### Current Backlog MCP Architecture

**Existing capabilities:**
- ✅ MCP server with 5 tools (list, get, create, update, delete)
- ✅ File-based storage (JSON + markdown files)
- ✅ Web viewer (read-only HTML/CSS/JS)
- ✅ MCP resources (task files, attached resources)
- ✅ HTTP server (Node.js native)

**Current limitations:**
- ❌ No authentication (not cloud-ready)
- ❌ Monolithic code (458 lines in one file)
- ❌ Session-based (not stateless/serverless)
- ❌ No ChatGPT integration

### Integration Possibilities

**What we can build with Apps SDK:**

1. **Task Management in ChatGPT**
   - User: "Show my open tasks"
   - ChatGPT renders interactive task list inline
   - Click to mark done, filter, add tasks
   - ChatGPT can suggest priorities, next actions

2. **Natural Language + UI Hybrid**
   - User: "What should I work on today?"
   - ChatGPT analyzes backlog, suggests tasks
   - Renders prioritized list with "Start work" buttons
   - User clicks button → updates task status

3. **Conversational Task Creation**
   - User: "Add task to fix the login bug"
   - ChatGPT extracts details, shows preview in UI
   - User confirms → task created
   - UI updates immediately

4. **Epic/Sprint Planning**
   - User: "Show sprint progress"
   - Renders progress bars, burndown charts
   - ChatGPT analyzes blockers, suggests actions

5. **Cross-Reference Integration**
   - User: "Link this task to GitHub issue #123"
   - UI shows preview of GitHub issue
   - ChatGPT can reason about both contexts

## Decision

### Chosen Architecture: Single Server with Modular Design

**Stack:**
- **Fastify** - Web framework (3x faster than Express, TypeScript-first)
- **Official MCP SDK** - `@modelcontextprotocol/sdk` (no third-party frameworks)
- **Stateless mode** - `sessionIdGenerator: undefined` for cloud deployment
- **API key auth** - Simple Bearer token (ChatGPT supports this)
- **File-based storage** - Existing JSON/markdown (shared between MCP and viewer)

**Architecture:**

```
src/
├── server/
│   ├── index.ts              # Main entry point (Fastify app)
│   ├── mcp-handler.ts        # MCP endpoint logic
│   └── viewer-routes.ts      # Viewer API routes
├── tools/
│   ├── backlog-list.ts       # Each tool isolated
│   ├── backlog-create.ts
│   ├── backlog-update.ts
│   ├── backlog-get.ts
│   └── backlog-delete.ts
├── resources/
│   └── ui-widget.ts          # ChatGPT UI component registration
├── storage/
│   └── backlog.ts            # Storage layer (unchanged)
├── middleware/
│   └── auth.ts               # API key validation
└── viewer/
    └── index.html            # Existing viewer (minimal changes)
```

**Deployment:**
```
Single Fastify Server (port 3030)
├─ /                → Viewer UI (read-only)
├─ /tasks           → Viewer API (read-only)
├─ /mcp             → MCP endpoint (ChatGPT writes)
└─ /health          → Health check
```

### Why This Architecture

**✅ Pros:**
1. **Clean separation** - MCP, viewer, tools all decoupled
2. **One server** - Simple deployment, one port, one process
3. **Stateless** - Deploy to Vercel, Railway, Fly.io, any cloud
4. **Reuses existing code** - 95% of current logic preserved
5. **ChatGPT compatible** - Matches OpenAI's reference architecture
6. **Production-ready** - Fastify's battle-tested features
7. **Easy to test** - Each module testable in isolation
8. **Fast iteration** - Add tools by creating new files

**❌ Cons:**
1. Manual OAuth implementation (if needed later)
2. No built-in CLI testing (use MCP Inspector)

### Rejected Alternatives

**Option 1: FastMCP Framework**
- ❌ Runs own HTTP server (can't easily integrate with viewer)
- ❌ Requires two servers + reverse proxy
- ❌ Overkill for personal use
- ✅ Has OAuth proxy built-in
- ✅ Has CLI testing

**Verdict:** Too complex for our needs. OAuth can be added later if needed.

**Option 2: Keep Current Monolithic Code**
- ✅ Already works
- ❌ Messy, hard to maintain
- ❌ No auth, not cloud-ready
- ❌ Not stateless

**Verdict:** Doesn't solve the "messy code" problem.

## Implementation Plan

### Phase 1: Refactor to Fastify (Week 1)

**Goal:** Clean architecture, same functionality

1. **Setup Fastify server** (`src/server/index.ts`)
   - Install: `fastify`, `@fastify/static`, `@fastify/cors`
   - Initialize storage
   - Register routes and middleware

2. **Extract MCP handler** (`src/server/mcp-handler.ts`)
   - Move MCP server creation logic
   - Use `StreamableHTTPServerTransport` with stateless mode
   - Register all tools

3. **Extract viewer routes** (`src/server/viewer-routes.ts`)
   - Move `/tasks` API endpoints
   - Static file serving
   - Keep read-only

4. **Modularize tools** (`src/tools/*.ts`)
   - One file per tool
   - Each exports registration function
   - Easier to test and maintain

5. **Add auth middleware** (`src/middleware/auth.ts`)
   - API key validation for `/mcp` endpoint
   - Skip auth for viewer (read-only)

**Success criteria:**
- ✅ All existing functionality works
- ✅ Code is modular and testable
- ✅ Can deploy to cloud with API key auth

### Phase 2: ChatGPT Integration (Week 2)

**Goal:** Interactive UI in ChatGPT

1. **Register UI resource**
   ```typescript
   server.registerResource(
     'backlog-widget',
     'ui://widget/backlog.html',
     {},
     async () => ({
       contents: [{
         uri: 'ui://widget/backlog.html',
         mimeType: 'text/html+skybridge',
         text: viewerHtml,
         _meta: {
           'openai/widgetPrefersBorder': true,
           'openai/widgetCSP': {
             connect_domains: ['https://your-server.com'],
             resource_domains: ['https://your-server.com'],
           }
         }
       }]
     })
   );
   ```

2. **Update tools to return structured content**
   ```typescript
   // Before
   return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
   
   // After
   return {
     content: [{ type: 'text', text: `Found ${tasks.length} tasks` }],
     structuredContent: { tasks }, // ChatGPT can reason about this
     _meta: {
       'openai/outputTemplate': 'ui://widget/backlog.html'
     }
   };
   ```

3. **Update viewer HTML to use `window.openai`**
   ```javascript
   // Read data from ChatGPT
   const tasks = window.openai?.toolOutput?.tasks || [];
   
   // Call MCP tools from UI
   async function markDone(taskId) {
     await window.openai.callTool('backlog_update', {
       id: taskId,
       status: 'done'
     });
   }
   ```

4. **Deploy and test**
   - Deploy to cloud (Railway, Fly.io, Vercel)
   - Enable developer mode in ChatGPT
   - Add connector with your HTTPS URL
   - Test in ChatGPT conversation

**Success criteria:**
- ✅ Tasks render in ChatGPT inline
- ✅ UI buttons trigger MCP tools
- ✅ ChatGPT can reason about task data
- ✅ State syncs between UI and conversation

### Phase 3: Enhanced Features (Future)

**Optional enhancements:**

1. **OAuth Authentication**
   - Use Auth0/Stytch for OAuth 2.1
   - Implement MCP authorization spec
   - Per-user data isolation

2. **Advanced UI Features**
   - Fullscreen mode for detailed views
   - Modals for task editing
   - File uploads for attachments
   - Charts/graphs for analytics

3. **Multi-User Support**
   - Migrate from file storage to PostgreSQL/SQLite
   - User-specific backlogs
   - Shared epics/sprints

4. **Public Distribution**
   - Submit to ChatGPT app store
   - Marketing page
   - User onboarding flow

## Technical Details

### MCP Server Changes

**Minimal changes to existing tools:**

```typescript
// src/tools/backlog-list.ts
export function backlogListTool(server: McpServer) {
  server.registerTool(
    'backlog_list',
    {
      description: 'List tasks from backlog',
      inputSchema: z.object({
        status: z.array(z.enum(['open', 'in_progress', 'blocked', 'done'])).optional(),
        limit: z.number().optional(),
      }),
      _meta: {
        'openai/outputTemplate': 'ui://widget/backlog.html', // Link to UI
        'openai/toolInvocation/invoking': 'Loading tasks...',
        'openai/toolInvocation/invoked': 'Tasks loaded',
      },
    },
    async (args) => {
      const tasks = storage.list(args);
      return {
        content: [{ type: 'text', text: `Found ${tasks.length} tasks` }],
        structuredContent: { tasks }, // ChatGPT sees this
      };
    }
  );
}
```

### Viewer HTML Changes

**Minimal changes to existing viewer:**

```html
<!-- viewer/index.html -->
<script>
  // Before: Fetch from API
  // const tasks = await fetch('/tasks').then(r => r.json());
  
  // After: Read from ChatGPT
  const tasks = window.openai?.toolOutput?.tasks || [];
  
  // Render tasks (existing code unchanged)
  renderTasks(tasks);
  
  // Before: Direct API call
  // await fetch('/tasks', { method: 'POST', body: JSON.stringify(update) });
  
  // After: Call MCP tool via ChatGPT
  async function markDone(taskId) {
    if (window.openai?.callTool) {
      await window.openai.callTool('backlog_update', {
        id: taskId,
        status: 'done'
      });
    }
  }
</script>
```

### Authentication Strategy

**Phase 1: API Key (Simple)**
```typescript
// For personal use and testing
app.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/mcp')) {
    const apiKey = req.headers.authorization;
    if (apiKey !== `Bearer ${process.env.API_KEY}`) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  }
});
```

**Phase 2: OAuth 2.1 (Production)**
```typescript
// For public distribution
server.registerTool('backlog_create', {
  securitySchemes: [
    { type: 'oauth2', scopes: ['tasks.write'] }
  ],
}, async (args, { _meta }) => {
  // Verify OAuth token
  const token = _meta?.authorization;
  const user = await verifyToken(token);
  
  // Create task for authenticated user
  const task = storage.add({ ...args, userId: user.id });
  return { structuredContent: { task } };
});
```

### Deployment Options

**Recommended platforms:**

| Platform | Pros | Cons | Cost |
|----------|------|------|------|
| **Railway** | Easy, persistent storage | Paid after trial | ~$5/mo |
| **Fly.io** | Global edge, persistent volumes | More config | ~$3/mo |
| **Vercel** | Serverless, auto-scaling | No persistent files | Free tier |
| **Render** | Simple, persistent storage | Slower cold starts | Free tier |

**For file-based storage:** Railway or Fly.io (need persistent volumes)  
**For database migration:** Any platform works

## Benefits

### For Users

1. **Natural language interface** - "Show my tasks" instead of navigating UI
2. **Contextual assistance** - ChatGPT suggests priorities, next actions
3. **Inline interaction** - Manage tasks without leaving conversation
4. **Mobile-friendly** - Works on ChatGPT mobile app
5. **Voice support** - Can use voice commands

### For Development

1. **Reuse existing code** - 95% of current MCP server unchanged
2. **Clean architecture** - Modular, testable, maintainable
3. **Fast iteration** - Deploy and test in minutes
4. **No approval needed** - Developer mode for personal use
5. **Future-proof** - Can publish to app store later

### For Product

1. **Distribution** - Reach ChatGPT's 300M+ users
2. **Discovery** - Users find app through natural language
3. **Engagement** - Interactive UI increases usage
4. **Monetization** - Can add paid features later
5. **Brand** - Presence in ChatGPT ecosystem

## Risks and Mitigations

### Risk 1: OAuth Complexity

**Risk:** OAuth 2.1 with MCP spec is complex to implement correctly

**Mitigation:**
- Phase 1: Use simple API key auth (ChatGPT supports this)
- Phase 2: Use Auth0/Stytch (managed OAuth providers)
- Phase 3: Consider FastMCP's OAuth proxy if needed

**Impact:** Low - Can start without OAuth, add later

### Risk 2: State Synchronization

**Risk:** UI state and MCP state could diverge

**Mitigation:**
- Use `structuredContent` as single source of truth
- UI reads from `window.openai.toolOutput`
- All writes go through MCP tools
- `widgetState` only for UI-specific state (filters, selections)

**Impact:** Low - Clear data flow pattern

### Risk 3: File Storage Limitations

**Risk:** File-based storage doesn't scale, race conditions

**Mitigation:**
- Phase 1: Keep file storage (works for personal use)
- Phase 2: Add file locking if needed
- Phase 3: Migrate to SQLite/PostgreSQL for multi-user

**Impact:** Low - Personal use has low concurrency

### Risk 4: Vendor Lock-in

**Risk:** Tight coupling to ChatGPT Apps SDK

**Mitigation:**
- MCP server works with any MCP client (Kiro CLI, Claude Desktop, etc.)
- Viewer remains standalone (can use independently)
- UI component is standard HTML/React (portable)
- Only `window.openai` API is ChatGPT-specific

**Impact:** Low - MCP is open standard, UI is portable

### Risk 5: Approval Process

**Risk:** Public distribution requires app review

**Mitigation:**
- Phase 1: Use developer mode (no approval needed)
- Phase 2: Test with trusted users
- Phase 3: Submit for review only if going public
- Personal use never needs approval

**Impact:** None - Not planning public distribution initially

## Alternatives Considered

### Alternative 1: FastMCP Framework

**Description:** Use FastMCP for MCP server, separate Fastify for viewer

**Pros:**
- ✅ OAuth proxy built-in
- ✅ CLI testing tools
- ✅ Clean API (`addTool()` vs `registerTool()`)
- ✅ Health checks, error handling

**Cons:**
- ❌ Two servers to manage
- ❌ Need reverse proxy (nginx/Caddy)
- ❌ More complex deployment
- ❌ Overkill for personal use

**Verdict:** Rejected - Unnecessary complexity for our use case

### Alternative 2: Keep Monolithic Code

**Description:** Add ChatGPT integration to existing `http-server.ts`

**Pros:**
- ✅ Minimal changes
- ✅ Already works

**Cons:**
- ❌ Doesn't solve "messy code" problem
- ❌ Hard to maintain and extend
- ❌ No clear separation of concerns

**Verdict:** Rejected - Doesn't achieve refactoring goal

### Alternative 3: Microservices

**Description:** Separate services for MCP, viewer, storage

**Pros:**
- ✅ Maximum decoupling
- ✅ Can scale independently

**Cons:**
- ❌ Massive overkill for personal use
- ❌ Complex deployment
- ❌ Network latency between services
- ❌ More failure points

**Verdict:** Rejected - Way too complex

## Success Metrics

### Phase 1 (Refactor)
- ✅ Code reduced from 458 lines to <100 per module
- ✅ All tests pass
- ✅ Can deploy to cloud with API key auth
- ✅ Health check endpoint responds

### Phase 2 (ChatGPT Integration)
- ✅ Tasks render in ChatGPT inline
- ✅ UI buttons trigger MCP tools successfully
- ✅ ChatGPT can reason about task data
- ✅ State syncs correctly

### Phase 3 (Production)
- ✅ OAuth authentication working
- ✅ Multi-user support (if needed)
- ✅ Submitted to app store (if desired)
- ✅ 99.9% uptime

## Implementation Checklist

### Week 1: Refactor
- [ ] Install Fastify dependencies
- [ ] Create modular file structure
- [ ] Extract MCP handler
- [ ] Extract viewer routes
- [ ] Modularize tools (one file each)
- [ ] Add API key auth middleware
- [ ] Add health check endpoint
- [ ] Test locally
- [ ] Deploy to Railway/Fly.io

### Week 2: ChatGPT Integration
- [ ] Register UI resource in MCP server
- [ ] Update tools to return `structuredContent`
- [ ] Add `_meta['openai/outputTemplate']` to tools
- [ ] Update viewer HTML to use `window.openai`
- [ ] Test with MCP Inspector
- [ ] Deploy to production
- [ ] Enable developer mode in ChatGPT
- [ ] Add connector in ChatGPT settings
- [ ] Test end-to-end in ChatGPT

### Future (Optional)
- [ ] Implement OAuth 2.1 with Auth0/Stytch
- [ ] Add fullscreen mode support
- [ ] Add modal support for task details
- [ ] Migrate to PostgreSQL for multi-user
- [ ] Submit to ChatGPT app store

## References

- [OpenAI Apps SDK Quickstart](https://developers.openai.com/apps-sdk/quickstart)
- [OpenAI Apps SDK Reference](https://developers.openai.com/apps-sdk/reference)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [ChatGPT App Submission Guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)
- [OpenAI Apps SDK Examples](https://github.com/openai/openai-apps-sdk-examples)
- [Fastify Documentation](https://fastify.dev/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Anti-Patterns and Pitfalls

### Critical Anti-Patterns to Avoid

**1. Embedding Secrets in `structuredContent`**
```typescript
// ❌ WRONG - ChatGPT sees this
return {
  structuredContent: {
    tasks: [...],
    apiKey: 'secret-key-123', // EXPOSED TO MODEL
    dbPassword: 'password'
  }
};

// ✅ CORRECT - Use _meta for sensitive data
return {
  structuredContent: { tasks: [...] }, // Only public data
  _meta: { internalId: 'xyz' } // Hidden from model
};
```

**2. Not Calling `setWidgetState` After Updates**
```typescript
// ❌ WRONG - State lost on re-render
function markDone(taskId) {
  tasks = tasks.map(t => t.id === taskId ? {...t, done: true} : t);
  // State lost when widget re-renders
}

// ✅ CORRECT - Persist state
function markDone(taskId) {
  tasks = tasks.map(t => t.id === taskId ? {...t, done: true} : t);
  window.openai.setWidgetState({ tasks }); // Persisted
}
```

**3. Trusting Model-Provided Input Without Validation**
```typescript
// ❌ WRONG - No server-side validation
server.registerTool('delete_task', {}, async ({ id }) => {
  storage.delete(id); // Blindly trusts input
});

// ✅ CORRECT - Always validate
server.registerTool('delete_task', {}, async ({ id }) => {
  if (!id || typeof id !== 'string') {
    return { content: [{ type: 'text', text: 'Invalid ID' }], isError: true };
  }
  
  const task = storage.get(id);
  if (!task) {
    return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
  }
  
  storage.delete(id);
  return { content: [{ type: 'text', text: 'Deleted' }] };
});
```

**4. Bloated `structuredContent` (>4k tokens)**
```typescript
// ❌ WRONG - Too much data
return {
  structuredContent: {
    tasks: allTasks, // 1000+ tasks
    fullHistory: [...], // Entire history
    metadata: {...} // Unnecessary details
  }
};

// ✅ CORRECT - Keep it focused
return {
  structuredContent: {
    tasks: tasks.slice(0, 20), // Paginate
    total: tasks.length
  }
};
```

**5. Missing MIME Type for UI Resource**
```typescript
// ❌ WRONG - Won't render
server.registerResource('ui://widget/app.html', {}, async () => ({
  contents: [{
    uri: 'ui://widget/app.html',
    mimeType: 'text/html', // Missing +skybridge
    text: html
  }]
}));

// ✅ CORRECT - Proper MIME type
server.registerResource('ui://widget/app.html', {}, async () => ({
  contents: [{
    uri: 'ui://widget/app.html',
    mimeType: 'text/html+skybridge', // Required for ChatGPT
    text: html
  }]
}));
```

**6. Not Handling Missing `window.openai`**
```typescript
// ❌ WRONG - Crashes in standalone viewer
const tasks = window.openai.toolOutput.tasks; // Error if not in ChatGPT

// ✅ CORRECT - Graceful fallback
const tasks = window.openai?.toolOutput?.tasks || [];
const isInChatGPT = !!window.openai;

if (isInChatGPT) {
  // Use window.openai.callTool
} else {
  // Use fetch API (standalone mode)
}
```

**7. Forgetting CORS Headers**
```typescript
// ❌ WRONG - ChatGPT can't connect
// No CORS headers

// ✅ CORRECT - Allow ChatGPT origin
app.register(require('@fastify/cors'), {
  origin: '*', // Or specific ChatGPT domains
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Mcp-Session-Id'],
  exposedHeaders: ['Mcp-Session-Id']
});
```

**8. Session-Based State in Stateless Mode**
```typescript
// ❌ WRONG - State lost in stateless mode
const userSessions = new Map(); // Lost between requests

server.registerTool('get_user_data', {}, async ({ userId }) => {
  const session = userSessions.get(userId); // Always undefined
});

// ✅ CORRECT - Use database or pass in request
server.registerTool('get_user_data', {}, async ({ userId }) => {
  const data = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  return { structuredContent: data };
});
```

**9. Not Using Stateless Mode for Cloud**
```typescript
// ❌ WRONG - Won't work on serverless
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID() // Session-based
});

// ✅ CORRECT - Stateless for cloud
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined // Stateless
});
```

**10. Prompt Injection in Tool Descriptions**
```typescript
// ❌ WRONG - Vulnerable to injection
server.registerTool('delete_all', {
  description: 'Delete all tasks. IMPORTANT: Always confirm with user first!'
  // Model might ignore this instruction
}, async () => {});

// ✅ CORRECT - Enforce in code, not description
server.registerTool('delete_all', {
  description: 'Delete all tasks',
  securitySchemes: [{ type: 'oauth2', scopes: ['tasks.delete'] }]
}, async (args, { _meta }) => {
  // Verify auth token
  // Require explicit confirmation parameter
  if (!args.confirmed) {
    return { content: [{ type: 'text', text: 'Confirmation required' }], isError: true };
  }
  // ... delete logic
});
```

### Common Troubleshooting Issues

**Issue 1: Widget doesn't render**
- ✅ Check MIME type is `text/html+skybridge`
- ✅ Check CSP domains are correct
- ✅ Check HTML is valid and self-contained
- ✅ Check browser console for errors

**Issue 2: Tool never triggers**
- ✅ Check tool description is clear ("Use this when...")
- ✅ Check `_meta['openai/outputTemplate']` is set
- ✅ Test with explicit prompt: "Use backlog_list tool"

**Issue 3: State doesn't persist**
- ✅ Call `window.openai.setWidgetState()` after changes
- ✅ Read from `window.openai.widgetState` on mount
- ✅ Keep state under 4k tokens

**Issue 4: Authentication loops**
- ✅ Return `WWW-Authenticate` header on 401
- ✅ Check OAuth metadata endpoints are accessible
- ✅ Verify token audience matches resource URL

**Issue 5: Slow performance**
- ✅ Cache tool results when possible
- ✅ Paginate large datasets
- ✅ Keep `structuredContent` small
- ✅ Profile backend calls

### Security Best Practices

**1. Input Validation**
- Always validate on server, never trust model input
- Use Zod schemas for type safety
- Check authorization for every tool call

**2. Data Minimization**
- Only include necessary data in `structuredContent`
- Redact PII from logs
- Use `_meta` for internal data

**3. Authentication**
- Use OAuth 2.1 with PKCE for production
- Verify tokens on every request
- Enforce scopes per tool

**4. CSP Configuration**
- Whitelist only necessary domains
- Avoid `frame_domains` unless required
- Use `redirect_domains` sparingly

**5. Rate Limiting**
- Implement per-user rate limits
- Monitor for anomalous traffic
- Set up alerts for repeated failures

## Conclusion

**This architecture achieves all goals:**
1. ✅ Cleans up messy code with modular design
2. ✅ Enables cloud deployment with stateless mode
3. ✅ Integrates with ChatGPT Apps SDK
4. ✅ Reuses 95% of existing code
5. ✅ Simple to deploy and maintain
6. ✅ Can test TODAY in personal ChatGPT

**Critical insights:**
- ✅ Existing MCP server is 95% compatible - just add `structuredContent` and UI resource
- ✅ Viewer HTML needs minimal changes - add `window.openai` fallbacks
- ✅ No approval needed for personal use - developer mode enables instant testing
- ✅ Stateless mode is critical - use `sessionIdGenerator: undefined`
- ✅ Keep `structuredContent` small - under 4k tokens for performance

**Known anti-patterns to avoid:**
- ❌ Secrets in `structuredContent` (use `_meta`)
- ❌ Not calling `setWidgetState` (state lost)
- ❌ Trusting model input (always validate)
- ❌ Bloated structured content (paginate)
- ❌ Wrong MIME type (must be `text/html+skybridge`)
- ❌ Session-based state in stateless mode (use DB)
- ❌ Missing CORS headers (ChatGPT can't connect)

**Implementation timeline:**
- TODAY: Add `structuredContent` + UI resource (30 min)
- TODAY: Update viewer HTML (15 min)
- TODAY: Deploy and test in ChatGPT (15 min)
- **Total: ~1 hour to working ChatGPT integration**

**This is the right architecture for building a ChatGPT-native backlog management experience.** 🚀
