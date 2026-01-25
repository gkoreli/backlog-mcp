# HTTP MCP Server Architecture - Design Summary

**Date**: 2026-01-24
**ADR**: [0013-http-mcp-server-architecture.md](./docs/adr/0013-http-mcp-server-architecture.md)

## Executive Summary

Transition backlog-mcp to HTTP-first architecture with built-in stdio bridge to enable:
- ✅ Cloud deployment (AWS, GCP, Azure)
- ✅ Persistent viewer across all sessions
- ✅ Multi-client support
- ✅ Backward compatibility (zero breaking changes)

## The Problem

Current architecture (PR #32 - detached viewer) has critical bugs:
- Storage duplication (separate processes)
- Race conditions on port binding
- Data inconsistency (stale cache)
- Not cloud-ready

## The Solution

**HTTP-First with Built-in Bridge**

```
┌─────────────────────────────────────────────────────────────┐
│  Core: HTTP MCP Server (SSE transport) + Viewer             │
│  ├─ Single process                                          │
│  ├─ Single storage instance                                 │
│  └─ Persistent daemon                                       │
└─────────────────────────────────────────────────────────────┘
                           ↑
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   stdio bridge       stdio bridge       stdio bridge
   (kiro-cli 1)      (kiro-cli 2)      (kiro-cli 3)
```

## User Experience

### Local Usage (No Change)
```bash
# Existing users - works exactly as before
npx backlog-mcp  # Auto-spawns HTTP server, bridges stdio
```

### Cloud Deployment (New)
```bash
# Deploy to cloud
docker run backlog-mcp serve --port 3030

# Or AWS Lambda, ECS, etc.
```

### Direct HTTP Access (New)
```bash
# Start server manually
npx backlog-mcp serve --daemon

# Connect from any HTTP client
curl http://localhost:3030/mcp
```

## Architecture

### Commands

| Command | Purpose | Use Case |
|---------|---------|----------|
| `npx backlog-mcp` | Auto-bridge (default) | kiro-cli, local dev |
| `npx backlog-mcp serve` | HTTP server | Cloud deployment |
| `npx backlog-mcp connect` | Explicit bridge | Advanced users |

### Auto-Bridge Flow

```
1. kiro-cli spawns: npx backlog-mcp
2. Check: Is HTTP server running on port 3030?
   ├─ NO  → Spawn server as daemon
   └─ YES → Check version
       ├─ Match    → Connect
       └─ Mismatch → Shutdown old, spawn new
3. Bridge stdio ↔ HTTP
4. kiro-cli session ends → Bridge exits, server persists
```

### Version Upgrades (Automatic)

```
User publishes v0.20.0

New kiro-cli session starts
  ↓
Bridge (v0.20.0) checks server version
  ↓
GET /version → "0.19.0" (mismatch!)
  ↓
POST /shutdown (cooperative)
  ↓
Old server exits gracefully
  ↓
Bridge spawns new server (v0.20.0)
  ↓
Bridge connects to new server
```

## Benefits

### For Users
- ✅ Zero config changes (backward compatible)
- ✅ Persistent viewer (survives agent restarts)
- ✅ Automatic version upgrades
- ✅ Browse tasks even when agent is off

### For Cloud Deployment
- ✅ HTTP-native (no stdio hacks)
- ✅ Multi-client support
- ✅ Horizontal scaling ready
- ✅ Standard deployment (Docker, K8s, Lambda)

### For Developers
- ✅ Single implementation (HTTP only)
- ✅ No storage duplication
- ✅ No race conditions
- ✅ Simpler codebase

## Implementation Plan

### Phase 1: HTTP Server Core
- [ ] Implement SSE transport (`src/transports/sse.ts`)
- [ ] Create HTTP server (`src/http-server.ts`)
- [ ] Integrate viewer into HTTP server
- [ ] Add `/mcp`, `/version`, `/shutdown` endpoints
- [ ] Initialize storage once

### Phase 2: stdio Bridge
- [ ] Implement bridge logic (`src/cli/bridge.ts`)
- [ ] Auto-spawn server if not running
- [ ] Version check and upgrade
- [ ] JSON-RPC forwarding (stdin → HTTP → stdout)

### Phase 3: CLI Commands
- [ ] `serve` command (HTTP server)
- [ ] `connect` command (explicit bridge)
- [ ] Update default command (auto-bridge)

### Phase 4: Testing
- [ ] Unit tests (bridge, SSE transport)
- [ ] Integration tests (full flow)
- [ ] Manual tests (kiro-cli, direct HTTP, cloud)
- [ ] Performance tests (latency, throughput)

### Phase 5: Documentation
- [ ] README: HTTP server usage
- [ ] DEPLOYMENT.md: Cloud deployment guide
- [ ] ARCHITECTURE.md: Design explanation
- [ ] MIGRATION.md: User guide

## Trade-offs

### Accepted
- ⚠️ Bridge adds minimal latency (acceptable)
- ⚠️ Medium implementation effort (worth it)
- ⚠️ HTTP server is single point of failure (mitigated by auto-restart)

### Rejected Alternatives
- ❌ Dual-transport (stdio + HTTP) - Too complex, dual maintenance
- ❌ HTTP-only with external bridge (mcp-remote) - External dependency, breaking change
- ❌ Microservices (MCP + viewer separate) - Over-engineered

## Timeline

- **Week 1**: Phase 1 (HTTP server core)
- **Week 2**: Phase 2 (stdio bridge)
- **Week 3**: Phase 3 (CLI commands) + Phase 4 (testing)
- **Week 4**: Phase 5 (documentation) + release

## Success Metrics

- ✅ Existing users see no breaking changes
- ✅ Viewer persists across all agent sessions
- ✅ Version upgrades work automatically
- ✅ Cloud deployment works (test on AWS ECS)
- ✅ No storage duplication bugs
- ✅ No race conditions on restart

## Next Steps

1. Review and approve ADR-0013
2. Create implementation tasks in backlog
3. Start Phase 1 (HTTP server core)
4. Iterate based on feedback

## Questions?

See full design in [ADR-0013](./docs/adr/0013-http-mcp-server-architecture.md)
