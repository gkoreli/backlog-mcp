# 0016. Real-time Agent Log Streaming to Viewer UI

**Date**: 2026-01-25
**Status**: Accepted
**Backlog Item**: TASK-0077

## Context

### Problem Statement

When delegating tasks to agents, monitoring their progress requires manually running `tail -f log.md` in a terminal. This creates several pain points:

1. **Manual monitoring required** - Must actively open terminal and run tail command
2. **Poor visual clarity** - Plain text logs are hard to parse visually
3. **No status overview** - Can't quickly see if agent is running, stuck, or completed
4. **Difficult issue detection** - Hard to spot errors or warnings in plain text
5. **No UI-based control** - Can't interact with agents from the viewer interface
6. **Fragmented experience** - Task management in viewer, log monitoring in terminal

### Current State

**Agent execution workflow:**
1. User delegates task to agent (detached background process)
2. Agent writes logs to `{artifact-dir}/log.md` file
3. User manually runs `tail -f {artifact-dir}/log.md` to monitor
4. Logs are plain text markdown with no colors or formatting
5. No real-time visibility in the backlog viewer UI

**Existing viewer architecture:**
- HTTP server (Node.js `http` module) on port 3030
- Request-response REST API pattern
- Web Components for UI (task-list, task-detail, etc.)
- No real-time transport capability (no WebSocket, no SSE)
- Serves static files and JSON endpoints

### Desired State

**Dual output system:**
- **File output (archival)**: Raw logs in `log.md` for historical analysis
- **Stream output (real-time UI)**: Same content streamed to viewer with rich rendering

**Viewer UI features:**
- Real-time log streaming (like watching terminal output)
- Rendered with colors and formatting (terminal-like experience)
- Progress indicators showing which step agent is on
- Status badges (running, stuck, completed, failed)
- Ability to pause/resume/kill agent from UI
- Historical logs viewable in same interface
- Multiple agent monitoring (switch between agents or split screen)

### User Stories

- As a user, I want to see agent logs in the viewer UI so I don't have to switch to terminal
- As a user, I want logs to update in real-time so I can monitor progress without refreshing
- As a user, I want colored/formatted logs so I can quickly spot errors and warnings
- As a user, I want to see agent status at a glance so I know if it's running or stuck
- As a user, I want to view historical logs so I can review past agent executions
- As a user, I want to monitor multiple agents so I can track parallel work
- As a user, I want to control agents from the UI so I can pause/resume/kill them

### Success Criteria

- ✅ Logs appear in viewer UI in real-time (< 1 second latency)
- ✅ ANSI colors and formatting are preserved and rendered correctly
- ✅ No breaking changes to existing agent logging code
- ✅ Historical logs are accessible through the same interface
- ✅ System is lightweight and doesn't impact agent performance
- ✅ Works with existing file-based log storage

## Research Findings

### Terminal Rendering in Browser

**xterm.js** - Full terminal emulator
- Used by VS Code, Hyper, and other professional tools
- Features: GPU acceleration, full ANSI support, mouse events, CJK/emoji support
- Supports interactive terminal apps (bash, vim, tmux)
- Bundle size: ~500KB+ (heavy)
- Complexity: High (full terminal emulation with PTY)
- **Assessment**: Overkill for log streaming - we don't need cursor control or interactive features

**ANSI-to-HTML libraries** (ansi-to-html, ansi_up)
- Lightweight parsers that convert ANSI escape codes to HTML spans
- Bundle size: ~10KB (very light)
- Features: Color codes, bold/italic/underline, background colors
- Complexity: Low (simple parsing and rendering)
- **Assessment**: Perfect fit - provides colors without terminal emulation overhead

**Key insight**: We need ANSI color rendering, not full terminal emulation. ANSI-to-HTML libraries provide 80% of the value at 2% of the complexity.

### Log Streaming Architectures

**WebSocket**
- Bi-directional, full-duplex communication
- Requires WebSocket server and client handshake
- Good for: Interactive applications, chat, real-time collaboration
- Complexity: Medium (connection management, reconnection logic)
- **Assessment**: More complex than needed for one-way log streaming

**Server-Sent Events (SSE)**
- Uni-directional (server → client) over HTTP
- Built into browsers via `EventSource` API
- Automatic reconnection handling
- Lightweight, simple protocol
- Good for: Log streaming, notifications, live updates
- Complexity: Low (simple HTTP endpoint)
- **Assessment**: Ideal for log streaming - simpler than WebSocket, built-in browser support

**HTTP Polling**
- Client repeatedly requests updates
- High latency, inefficient
- **Assessment**: Not suitable for real-time streaming

**Key insight**: SSE is the standard choice for log streaming. Used by CI/CD systems, monitoring tools, and logging platforms. Simpler than WebSocket for one-way data flow.

### Dual Output Mechanisms

**Unix `tee` command pattern**
- Reads stdin, writes to stdout AND files simultaneously
- Classic pattern for dual output
- Can be implemented with Node.js streams

**Winston logger with multiple transports**
- Popular Node.js logging library
- Supports multiple transports: File, Console, HTTP, Stream
- Can write to different destinations with different log levels
- **Assessment**: Good pattern but requires agent code changes

**Custom stream.Writable**
- Implement custom writable stream that writes to multiple destinations
- Flexible, can combine file writing with SSE broadcasting
- **Assessment**: Clean abstraction for dual output

**Key insight**: Dual output is a well-established pattern. Can be implemented at agent level (Winston) or viewer level (file watching).

### File Watching

**chokidar**
- Standard Node.js file watching library
- Normalizes fs.watch/fs.watchFile events across platforms
- Efficient for large directory structures
- Detects changes in milliseconds
- **Assessment**: Reliable, battle-tested solution

**Tail-like implementations**
- Read only new content appended to file
- Track file position, read from last position on change
- Efficient for large log files
- **Assessment**: Essential for streaming only new log lines

**Key insight**: File watching with chokidar + tail-like reading enables passive log streaming without modifying agent code. Latency is negligible (< 100ms).

### Process Monitoring

**Heartbeat mechanisms**
- Periodic "alive" signals from process
- Detect stuck processes by missing heartbeats
- Requires agent code changes

**Log-based detection**
- Monitor log file for new content
- "No new lines in X minutes" = potentially stuck
- No agent code changes needed
- **Assessment**: Simple heuristic for stuck detection

**Process status monitoring**
- Check if process is still running (PID exists)
- Requires tracking agent PIDs
- **Assessment**: Useful for "running" vs "completed" status

**Key insight**: Basic stuck detection can be done by monitoring log activity. More sophisticated monitoring requires agent instrumentation.

### Multi-Agent Monitoring

**UI patterns**
- Tabs: Simple, familiar, one agent at a time
- Split screen: View multiple agents simultaneously
- Dropdown/sidebar: Quick switching between agents
- **Assessment**: Start with tabs, add split screen later

**Agent discovery**
- Scan artifact directories for log files
- Parse directory structure to identify agents
- Watch for new agent directories
- **Assessment**: File-based discovery works with existing structure

**Key insight**: Multi-agent support can be built incrementally. Start with single agent streaming, add discovery and switching later.

## Proposed Solutions

### Option 1: File Watching + SSE + ANSI Parsing (Recommended)

**Architecture:**
```
Agent Process (unchanged)
    ↓ writes
log.md file
    ↓ watches (chokidar)
Viewer HTTP Server
    ↓ streams (SSE)
Browser EventSource
    ↓ renders (ansi-to-html)
Web Component UI
```

**Data flow:**
1. Agent writes logs to `log.md` (no changes to agent code)
2. Viewer server watches `log.md` with chokidar
3. On file change, read new lines (tail-like behavior)
4. Stream new lines to browser via SSE endpoint
5. Browser receives events, parses ANSI codes, renders as HTML
6. Web Component displays formatted logs in real-time

**Components needed:**
- **Server-side**: 
  - SSE endpoint `/logs/stream?path={log-file-path}`
  - File watcher using chokidar
  - Tail-like reader to get only new content
- **Client-side**:
  - `<agent-log-viewer>` Web Component
  - EventSource connection to SSE endpoint
  - ANSI-to-HTML parser (ansi_up library)
  - Auto-scroll and pause functionality

**Pros:**
- ✅ **Zero breaking changes** - Works with existing agents
- ✅ **Lightweight** - Small bundle size (~10KB for ANSI parser)
- ✅ **Simple** - No complex WebSocket management
- ✅ **Reliable** - SSE has built-in reconnection
- ✅ **Low latency** - File changes detected in milliseconds
- ✅ **Backward compatible** - File logs still work as before
- ✅ **Easy to test** - Can test with any log file

**Cons:**
- ❌ Slight latency from file I/O (< 100ms, acceptable)
- ❌ No structured progress data (just log parsing)
- ❌ Limited to what's in log files

**Implementation Complexity**: Low
- Server: ~100 lines (SSE endpoint + file watching)
- Client: ~150 lines (Web Component + ANSI rendering)
- No agent changes required

**Performance:**
- Latency: < 100ms (file watch + SSE)
- Bundle size: +10KB (ansi_up)
- Server overhead: Minimal (one watcher per active stream)

### Option 2: Agent Dual-Output + WebSocket + xterm.js

**Architecture:**
```
Agent Process (modified with Winston)
    ↓ writes (File transport)
log.md file
    ↓ writes (WebSocket transport)
Viewer WebSocket Server
    ↓ streams (WebSocket)
Browser WebSocket Client
    ↓ renders (xterm.js)
Terminal Emulator UI
```

**Data flow:**
1. Agent uses Winston logger with two transports: File + WebSocket
2. Logs written to `log.md` AND sent to WebSocket server
3. Viewer WebSocket server broadcasts to connected clients
4. Browser receives log data via WebSocket
5. xterm.js renders as full terminal emulation
6. Rich terminal features: colors, cursor control, scrollback

**Components needed:**
- **Agent-side**:
  - Winston logger configuration
  - Custom WebSocket transport
  - Connection management and retry logic
- **Server-side**:
  - WebSocket server (ws library)
  - Client connection management
  - Broadcast to multiple viewers
- **Client-side**:
  - xterm.js terminal emulator
  - WebSocket client connection
  - Terminal addon for fit, search, etc.

**Pros:**
- ✅ **Rich terminal experience** - Full ANSI support, cursor control
- ✅ **True real-time** - No file I/O latency
- ✅ **Structured logging** - Can send JSON metadata alongside logs
- ✅ **Interactive potential** - Could support agent input in future

**Cons:**
- ❌ **Breaking changes** - Requires modifying all agent logging code
- ❌ **Heavy bundle** - xterm.js is ~500KB+
- ❌ **Complex** - WebSocket server, connection management, reconnection
- ❌ **Overkill** - Full terminal emulation for simple log viewing
- ❌ **Agent dependency** - Agents must connect to viewer server
- ❌ **Harder to test** - Requires running WebSocket server

**Implementation Complexity**: High
- Agent changes: ~200 lines (Winston setup + WebSocket transport)
- Server: ~300 lines (WebSocket server + broadcast logic)
- Client: ~200 lines (xterm.js integration + connection management)
- Total: ~700 lines + refactoring all agent logging

**Performance:**
- Latency: < 10ms (direct WebSocket)
- Bundle size: +500KB (xterm.js + addons)
- Server overhead: WebSocket connections (more resource intensive)

**Assessment**: Over-engineered for the use case. We don't need full terminal emulation, just log viewing with colors. The complexity and breaking changes aren't justified by the marginal UX improvement.

### Option 3: Hybrid - Agent Metadata + File Watching + SSE

**Architecture:**
```
Agent Process (modified)
    ↓ writes
log.md file (logs)
metadata.json file (structured data)
    ↓ watches (chokidar)
Viewer HTTP Server
    ↓ streams (SSE)
Browser EventSource
    ↓ renders (custom React components)
Rich UI with progress bars, status badges
```

**Data flow:**
1. Agent writes logs to `log.md` AND structured metadata to `metadata.json`
2. Metadata includes: current step, progress %, status, timestamps
3. Viewer watches both files with chokidar
4. Streams log lines + metadata updates via SSE
5. Browser renders logs with ANSI parsing
6. Custom UI components show progress bars, status badges based on metadata

**Components needed:**
- **Agent-side**:
  - Metadata writer utility
  - Structured logging format
- **Server-side**:
  - SSE endpoint with dual file watching
  - Metadata parser
  - Combined stream of logs + metadata
- **Client-side**:
  - Custom Web Components for rich UI
  - ANSI parser for logs
  - Progress bar and status badge components

**Pros:**
- ✅ **Rich UX** - Progress bars, status indicators, structured data
- ✅ **Lightweight transport** - SSE, not WebSocket
- ✅ **Flexible** - Can add more metadata fields over time
- ✅ **Graceful degradation** - Falls back to plain logs if no metadata

**Cons:**
- ❌ **Agent changes required** - Must write metadata alongside logs
- ❌ **More complex** - Two files to watch and parse
- ❌ **Metadata format** - Need to define and maintain schema
- ❌ **Not backward compatible** - Old agents won't have metadata

**Implementation Complexity**: Medium
- Agent changes: ~100 lines (metadata writer)
- Server: ~200 lines (dual file watching + metadata parsing)
- Client: ~250 lines (rich UI components + metadata rendering)
- Total: ~550 lines + agent refactoring

**Performance:**
- Latency: < 100ms (file watching)
- Bundle size: +10KB (ANSI parser) + custom components
- Server overhead: Two watchers per agent (acceptable)

**Assessment**: Good balance of features and complexity. Provides structured data for rich UI without the overhead of WebSocket/xterm.js. However, requires agent changes which breaks backward compatibility. Better suited as Phase 2 enhancement after MVP.

## Evaluation

### Comparison Matrix

| Criteria | Option 1: File + SSE | Option 2: WebSocket + xterm.js | Option 3: Hybrid Metadata |
|----------|---------------------|--------------------------------|---------------------------|
| **UX Quality** | Good (colors, real-time) | Excellent (full terminal) | Excellent (structured UI) |
| **Performance** | Excellent (lightweight) | Heavy (500KB+ bundle) | Good (lightweight) |
| **Latency** | < 100ms | < 10ms | < 100ms |
| **Implementation Complexity** | Low (~250 lines) | High (~700 lines) | Medium (~550 lines) |
| **Agent Changes** | None ✅ | Major refactor ❌ | Moderate changes ❌ |
| **Backward Compatibility** | Perfect ✅ | Breaking ❌ | Breaking (graceful) ⚠️ |
| **Maintainability** | High (simple) | Medium (complex) | Medium (two files) |
| **Testing** | Easy | Complex | Medium |
| **Bundle Size** | +10KB | +500KB | +10KB |
| **Server Overhead** | Minimal | Higher (WebSocket) | Minimal |
| **Future Extensibility** | Good | Excellent | Excellent |

### Recommendation

**Selected Approach**: **Option 1 - File Watching + SSE + ANSI Parsing**

**Rationale:**

1. **Delivers core value with minimal complexity** - Provides real-time log streaming with colors, which solves 80% of the user's pain points, with only 250 lines of code.

2. **Zero breaking changes** - Works with existing agents immediately. No refactoring required. This is critical for rapid deployment and testing.

3. **Lightweight and performant** - 10KB bundle size vs 500KB for xterm.js. < 100ms latency is imperceptible to users.

4. **Simple to implement and test** - Can be built and tested in a few hours. Easy to debug and maintain.

5. **Provides foundation for future enhancements** - Can add Option 3 (metadata) later as incremental enhancement without breaking existing functionality.

6. **Aligns with Unix philosophy** - Do one thing well. File watching + SSE is a proven pattern for log streaming.

7. **Battle-tested technologies** - chokidar and SSE are mature, reliable technologies used by major platforms (GitHub Actions, CI/CD systems).

**Why not Option 2?**
- Over-engineered: Full terminal emulation is overkill for log viewing
- Heavy bundle: 500KB is too much for a feature that can be done with 10KB
- Breaking changes: Requires refactoring all agent logging code
- Complex: WebSocket management, connection handling, reconnection logic
- Marginal benefit: The UX improvement doesn't justify the 3x complexity increase

**Why not Option 3?**
- Premature optimization: Structured metadata is nice-to-have, not must-have
- Breaking changes: Requires agent modifications
- Can be added later: Once Option 1 is working, we can incrementally add metadata support
- YAGNI principle: Build what's needed now, not what might be useful later

### Trade-offs Accepted

**Accepting:**
- ✅ Slight latency from file I/O (< 100ms) - imperceptible to users
- ✅ No structured progress data initially - can parse logs or add metadata later
- ✅ Limited to log file content - sufficient for MVP

**Gaining:**
- ✅ Zero breaking changes - immediate deployment
- ✅ Simple implementation - fast to build and test
- ✅ Lightweight bundle - better performance
- ✅ Easy maintenance - fewer moving parts
- ✅ Incremental enhancement path - can add features later

## Decision

### Selected Approach

**Option 1: File Watching + SSE + ANSI Parsing**

Implement real-time log streaming using file watching (chokidar), Server-Sent Events (SSE) for transport, and ANSI-to-HTML parsing for rendering. No changes to agent logging code.

### Implementation Plan

#### Phase 1: MVP - Single Agent Log Streaming (Week 1)

**Goal**: Stream logs from one agent to viewer UI with colors

**Server-side** (`src/viewer.ts`):
1. Add SSE endpoint: `GET /logs/stream?path={log-file-path}`
2. Implement file watcher with chokidar
3. Implement tail-like reader (track file position, read only new content)
4. Stream new lines as SSE events
5. Handle client disconnection and cleanup

**Client-side** (`viewer/components/agent-log-viewer.ts`):
1. Create `<agent-log-viewer>` Web Component
2. Connect to SSE endpoint with EventSource
3. Integrate ansi_up library for ANSI-to-HTML parsing
4. Render log lines with auto-scroll
5. Add pause/resume auto-scroll functionality
6. Add "Open in Editor" button

**Dependencies**:
- Server: `chokidar` (~100KB)
- Client: `ansi_up` (~10KB)

**Estimated effort**: 6-8 hours

#### Phase 2: Multi-Agent Discovery and Switching (Week 2)

**Goal**: View logs from multiple agents, switch between them

**Server-side**:
1. Add endpoint: `GET /agents` - list all agent artifact directories
2. Scan `.backlog/backlog-mcp-engineer/` for directories with `log.md`
3. Return agent metadata: name, path, last modified, status

**Client-side**:
1. Add agent selector dropdown/tabs
2. Fetch agent list on load
3. Switch log stream when selecting different agent
4. Show agent status badges (running, completed, stuck)

**Estimated effort**: 4-6 hours

#### Phase 3: Process Status and Control (Week 3)

**Goal**: Show agent status, detect stuck agents, kill agents

**Server-side**:
1. Track agent PIDs (read from `.pid` file or process list)
2. Add endpoint: `POST /agents/{id}/kill` - terminate agent process
3. Implement stuck detection (no log activity in X minutes)
4. Add endpoint: `GET /agents/{id}/status` - running/stuck/completed

**Client-side**:
1. Display agent status badge (running/stuck/completed/failed)
2. Add "Kill Agent" button with confirmation
3. Show last activity timestamp
4. Add warning indicator for stuck agents

**Estimated effort**: 6-8 hours

#### Phase 4: Historical Logs and Polish (Week 4)

**Goal**: View past agent executions, improve UX

**Server-side**:
1. Add endpoint: `GET /logs/historical?path={log-file-path}` - return full log file
2. Implement pagination for large log files
3. Add search/filter capability

**Client-side**:
1. Add "Load Historical Logs" button
2. Implement search/filter UI
3. Add log export functionality (download as .txt)
4. Improve styling and responsiveness
5. Add keyboard shortcuts (pause, clear, search)

**Estimated effort**: 6-8 hours

**Total estimated effort**: 22-30 hours (3-4 weeks)


## UX Considerations

### Mockup: Agent Log Viewer Component

```
┌─────────────────────────────────────────────────────────────┐
│ Backlog Viewer                                    [Settings] │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Tasks  │  Agents  │  Resources                              │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Agent: log-streaming-research-2026-01-25  [●Running] [Kill] │
│  Last activity: 2 seconds ago                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ [Pause] [Clear] [Search] [Export] [Open in Editor]  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │                                                      │    │
│  │ [12:34:56] Starting research task...                │    │
│  │ [12:34:57] Loading product design workflow...       │    │
│  │ [12:34:58] ✓ Workflow loaded successfully           │    │
│  │ [12:35:00] Analyzing codebase...                    │    │
│  │ [12:35:05] Found 15 relevant files                  │    │
│  │ [12:35:10] Generating design proposals...           │    │
│  │ [12:35:15] ⚠ Warning: Large file detected           │    │
│  │ [12:35:20] ✗ Error: Failed to parse schema.ts       │    │
│  │ [12:35:25] Retrying with fallback parser...         │    │
│  │ [12:35:30] ✓ Proposal 1 complete                    │    │
│  │ [12:35:35] Working on Proposal 2...                 │    │
│  │                                                      │    │
│  │ ▼ Auto-scrolling (click to pause)                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Color scheme:**
- Timestamps: Gray (#6e7781)
- Success (✓): Green (#1a7f37)
- Warning (⚠): Yellow (#d97706)
- Error (✗): Red (#cf222e)
- Info: Blue (#0969da)
- Running badge: Green with pulse animation
- Stuck badge: Orange with warning icon

### User Flows

**Flow 1: Monitor running agent**
1. User delegates task to agent
2. User opens backlog viewer
3. User clicks "Agents" tab
4. User sees list of agents with status badges
5. User clicks on running agent
6. Log viewer opens with real-time streaming
7. User watches logs update in real-time
8. User sees colored output (errors in red, success in green)
9. User can pause auto-scroll to read specific section
10. User can resume auto-scroll to continue monitoring

**Flow 2: Detect stuck agent**
1. User opens viewer, sees agent with "Stuck" badge (orange)
2. User clicks on stuck agent
3. Log viewer shows last activity timestamp: "15 minutes ago"
4. User reviews last log entries to understand issue
5. User clicks "Kill Agent" button
6. Confirmation dialog appears
7. User confirms, agent process terminates
8. Status updates to "Cancelled"

**Flow 3: Review historical logs**
1. User opens viewer, clicks "Agents" tab
2. User sees list including completed agents
3. User clicks on completed agent
4. Log viewer loads full historical log
5. User can search for specific errors or events
6. User can export log as .txt file for sharing

**Flow 4: Multi-agent monitoring**
1. User has 3 agents running in parallel
2. User opens viewer, sees all 3 in agent list
3. User clicks Agent 1, views logs
4. User switches to Agent 2 via dropdown
5. Log viewer disconnects from Agent 1 stream
6. Log viewer connects to Agent 2 stream
7. User can quickly switch between agents to check progress

### Accessibility

**Keyboard shortcuts:**
- `Space`: Pause/resume auto-scroll
- `Cmd/Ctrl + F`: Search logs
- `Cmd/Ctrl + K`: Clear visible logs (keeps history)
- `Cmd/Ctrl + E`: Open log file in editor
- `Esc`: Close search, clear selection

**Screen reader support:**
- ARIA labels for all buttons and controls
- Live region for new log entries (aria-live="polite")
- Status announcements for agent state changes
- Semantic HTML (nav, main, section, article)

**Visual accessibility:**
- High contrast colors (WCAG AA compliant)
- Configurable font size
- Option to disable auto-scroll
- Clear focus indicators
- Color is not the only indicator (icons + text)

### Responsive Design

**Desktop (> 1024px):**
- Split pane: Agent list on left, log viewer on right
- Full-width log viewer with comfortable line length

**Tablet (768px - 1024px):**
- Tabs: Switch between agent list and log viewer
- Full-width log viewer when viewing logs

**Mobile (< 768px):**
- Stack layout: Agent list → select agent → full-screen log viewer
- Simplified controls (fewer buttons, dropdown menu)
- Touch-friendly tap targets (44px minimum)

## Technical Considerations

### Performance

**Latency analysis:**
- File change detection (chokidar): 10-50ms
- File read (new lines only): 5-20ms
- SSE transmission: 10-30ms
- Browser rendering: 5-15ms
- **Total latency**: 30-115ms (average ~70ms)

**Verdict**: Imperceptible to users. Human perception threshold is ~100ms.

**Scalability:**
- One file watcher per active log stream
- SSE connections are lightweight (HTTP long-polling)
- Memory: ~1MB per active stream (watcher + buffer)
- CPU: Negligible (event-driven, no polling)

**Limits:**
- Recommended: < 10 concurrent log streams
- Maximum: ~50 concurrent streams (depends on server resources)

**Large log files:**
- Only read new content (tail-like behavior)
- Don't load entire file into memory
- Pagination for historical logs (load in chunks)

### Security

**Path traversal prevention:**
- Validate log file paths against allowed directories
- Only allow paths within `.backlog/` directory
- Reject paths with `..` or absolute paths outside allowed dirs

**Access control:**
- Viewer is local-only (localhost:3030)
- No authentication needed (single-user tool)
- CORS allows all origins (local dev tool)

**Process control:**
- Validate agent PIDs before killing
- Only allow killing processes owned by current user
- Confirm before terminating processes

### Backward Compatibility

**Existing agents:**
- ✅ No changes required - agents continue writing to log.md
- ✅ File-based logs still work as before
- ✅ `tail -f` still works for users who prefer terminal

**Existing workflows:**
- ✅ No breaking changes to task management
- ✅ Viewer still works without log streaming
- ✅ Log files remain human-readable markdown

**Migration path:**
- Phase 1: Add log streaming (no breaking changes)
- Phase 2: Add multi-agent support (no breaking changes)
- Phase 3: Add process control (no breaking changes)
- Phase 4: (Optional) Add agent metadata for rich UI (opt-in)

### Dependencies

**New dependencies:**

**Server-side:**
- `chokidar` (^4.0.0) - File watching
  - Size: ~100KB
  - License: MIT
  - Maturity: Stable, widely used (50M+ downloads/week)

**Client-side:**
- `ansi_up` (^6.0.0) - ANSI to HTML conversion
  - Size: ~10KB
  - License: MIT
  - Maturity: Stable, widely used (500K+ downloads/week)

**Total bundle size increase**: ~110KB (acceptable)

### Error Handling

**File watching errors:**
- File doesn't exist: Return 404, show "Log file not found"
- Permission denied: Return 403, show "Cannot read log file"
- File deleted during streaming: Detect, close stream, notify client

**SSE connection errors:**
- Client disconnects: Clean up watcher, free resources
- Network error: Browser auto-reconnects (built-in SSE feature)
- Server restart: Clients reconnect automatically

**ANSI parsing errors:**
- Invalid ANSI codes: Render as plain text (graceful degradation)
- Malformed escape sequences: Strip and continue

**Process control errors:**
- PID not found: Show "Agent already stopped"
- Permission denied: Show "Cannot kill agent (permission denied)"
- Kill failed: Show error message, suggest manual intervention

## Future Enhancements

### Phase 5: Structured Metadata (Option 3)

Once MVP is stable, add optional metadata support:
- Agents can write `metadata.json` alongside `log.md`
- Metadata includes: current step, progress %, status, timestamps
- Viewer parses metadata and shows progress bars, step indicators
- Graceful degradation: Falls back to plain logs if no metadata

**Benefits:**
- Rich UI with progress indicators
- Better stuck detection (based on step progress)
- Structured data for analytics

**Effort**: 2-3 weeks

### Phase 6: Log Aggregation and Search

- Full-text search across all agent logs
- Filter by date range, status, error level
- Aggregate view: See all errors across all agents
- Export search results

**Effort**: 2-3 weeks

### Phase 7: Agent Collaboration

- Multiple agents working on same task
- Shared log view with agent identification
- Coordination signals between agents

**Effort**: 3-4 weeks

### Phase 8: Performance Metrics

- Track agent execution time
- Identify slow steps
- Compare performance across runs
- Optimization suggestions

**Effort**: 2-3 weeks

## References

**Research sources:**
- [xterm.js GitHub](https://github.com/xtermjs/xterm.js) - Terminal emulator
- [ansi_up npm](https://www.npmjs.com/package/ansi_up) - ANSI to HTML parser
- [chokidar GitHub](https://github.com/paulmillr/chokidar) - File watching
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) - SSE documentation
- [How to Build a Logging Web App with SSE](https://www.freecodecamp.org/news/build-a-logging-web-app-with-server-sent-events-rxjs-and-express/) - SSE log streaming pattern
- [Winston Logger](https://github.com/winstonjs/winston) - Multi-transport logging

**Similar implementations:**
- GitHub Actions log streaming (SSE-based)
- Docker Desktop container logs (SSE-based)
- Vercel deployment logs (SSE-based)
- Heroku log streaming (SSE-based)

**Architecture patterns:**
- Unix `tee` command (dual output)
- Tail -f implementation (incremental file reading)
- Pub/sub pattern (SSE broadcasting)

---

**Next Steps:**
1. Review and approve this ADR
2. Create implementation tasks in backlog
3. Set up development branch
4. Implement Phase 1 (MVP)
5. Test with real agent logs
6. Gather user feedback
7. Iterate and improve

**Questions for review:**
- Is the phased approach acceptable?
- Should we prioritize any Phase 2+ features for MVP?
- Are there any security concerns with the proposed approach?
- Should we add rate limiting for SSE connections?
