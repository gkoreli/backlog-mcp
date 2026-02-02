# 0049. Keep Orama Over Algolia for Search

**Date**: 2026-02-02  
**Status**: Accepted  
**Master Epic**: EPIC-0019 (Search & RAG)  
**Backlog Items**: TASK-0163, TASK-0162  
**Related ADRs**: 0038 (Comprehensive Search Capability)

## Context

We have a nearly complete search implementation using Orama (BM25 + vector hybrid search, custom Spotlight UI, local embeddings). Current issues:
- Ranking problems: description matches outrank title matches (TASK-0162)
- Resources not appearing in search results (implementation bug)

Algolia is a battle-tested cloud search service used by major companies (Slack, Stripe, LVMH). We evaluated whether migrating to Algolia would provide significant benefits over fixing our current Orama implementation.

## Decision

**Keep Orama. Fix the ranking issues.**

## Rationale

### 1. Local-First Architecture is Non-Negotiable

backlog-mcp's core value propositions:
- Tasks stored as markdown files on local disk
- No external services required for core functionality
- Data privacy: task content never leaves machine
- Works offline (plane, poor connectivity)

**Algolia fundamentally breaks this:**
- Requires uploading all task data to Algolia's cloud servers
- Tasks contain potentially sensitive information (project details, internal URLs, employee names)
- Requires internet connection for every search
- Data residency controlled by Algolia

This architectural conflict is a **dealbreaker**. Migrating to Algolia would change the product's trust model and core philosophy.

### 2. Ranking Issues Are Configuration Problems, Not Orama Limitations

Current problem: "backlog" query ranks TASK-0145 (description match) above EPIC-0002 "Backlog MCP" (title match).

**Root cause**: BM25 term frequency overwhelms low boost values.

Current config:
```typescript
boost: { id: 10, title: 2 }
```

**Solution**: Increase title boost significantly:
```typescript
boost: { id: 10, title: 20, description: 1 }
```

Or add post-search re-ranking to prioritize exact title matches.

**Estimated fix time**: 1-2 days vs 2-3 weeks to migrate to Algolia.

### 3. Algolia's Advanced Features Don't Match Our Use Case

Algolia's strengths are designed for **e-commerce at scale**:

| Feature | Algolia Benefit | backlog-mcp Need |
|---------|----------------|------------------|
| Query categorization | "red dress size 8" → category detection | Simple queries: "authentication", "TASK-0042" |
| Dynamic re-ranking | Learns from user behavior | Single-user tool, no query volume to learn from |
| A/B testing | Test ranking algorithms | No users to test on |
| Analytics dashboard | Search metrics, conversion tracking | Simple logging suffices |
| Merchandising | Business rules for product placement | Not an e-commerce use case |

**We don't need these features.** What we need:
- Better ranking (title > description) → **Fixable with config**
- Typo tolerance → **Already have** (tolerance: 1)
- Semantic search → **Already have** (hybrid mode with local embeddings)

### 4. Performance: Local is 10-20x Faster

| Operation | Orama (Local) | Algolia (Cloud) |
|-----------|--------------|----------------|
| BM25 search | <5ms | ~50-100ms |
| Semantic search | <50ms | ~100-200ms |
| Offline | ✅ Works | ❌ Fails |

In-memory local search with no network latency is fundamentally faster than cloud search. For backlog-mcp's use case (single user, ~1K tasks), this performance advantage matters.

### 5. UI: Spotlight vs InstantSearch

Our **Spotlight** component:
- Command palette UX (Cmd+J modal)
- Keyboard-driven navigation
- Purpose-built for discovery
- ~200 lines of custom code

Algolia's **InstantSearch**:
- Widget-based UI library
- Designed for e-commerce (product listings, facets, filters)
- Would require heavy customization to match Spotlight UX

**Verdict**: InstantSearch is the wrong abstraction. We'd lose our purpose-built command palette UX or spend weeks customizing InstantSearch to match it.

### 6. Migration Effort Not Justified

**Migration work**:
- Replace OramaSearchService with AlgoliaSearchService
- Add API key management
- Implement data sync (upload on change)
- Handle network errors, retry logic
- Rewrite or heavily customize UI
- Update 161 tests

**Estimated effort**: 2-3 weeks

**Current issue fix**: 1-2 days

**We're 95% done with Orama implementation.** Migrating now would delay other features by weeks for no architectural benefit.

### 7. Future RAG Path Aligns with Local-First

Both Orama and Algolia support RAG (Phase 4 of ADR-0038):

**Orama**:
- AnswerSession API
- Can run entirely local (LLM via local model or API)
- Data stays on machine

**Algolia**:
- Generative Experiences, Ask AI
- Requires cloud, data on Algolia servers

For backlog-mcp's vision (context hydration for agents), **local-first RAG is crucial**. We want agents to query backlog context without sending task data to external services.

## Consequences

### Positive
- Maintains local-first architecture and data privacy
- Preserves offline capability
- Keeps 10-20x performance advantage
- Avoids 2-3 weeks of migration work
- No vendor lock-in or ongoing costs
- Custom Spotlight UX remains intact
- Clear path to local-first RAG

### Negative
- Ranking issues require our effort to fix (1-2 days)
- Maintenance burden on us (minimal for stable library)
- Don't get Algolia's advanced features (but don't need them)

### Trade-offs Accepted
- **Control over convenience**: We maintain search config vs Algolia maintains infrastructure
- **Simplicity over sophistication**: BM25+boost vs 8 ranking criteria (sufficient for our scale)
- **Privacy over features**: Local-only vs cloud analytics/merchandising

## Implementation Plan

### Immediate (TASK-0162)
1. Increase title boost from 2 to 20
2. Verify resource indexing on startup
3. Add post-search re-ranking if boost alone insufficient
4. Add golden tests for ranking expectations

### Future (Phase 4)
- Implement RAG using Orama's AnswerSession API
- Keep data local, use local LLM or API with user's key
- Context hydration for agents without cloud dependency

## When to Reconsider

Algolia would make sense if backlog-mcp's requirements fundamentally change:

1. **Multi-user SaaS product** - Users explicitly want cloud sync
2. **Scale exceeds 10K+ tasks** - Beyond Orama's practical in-memory limit
3. **E-commerce features needed** - Faceted search, merchandising, A/B testing
4. **Users accept cloud dependency** - Offline capability no longer required

**None of these apply to current vision.**

## Architecture Principles Reinforced

This decision reinforces backlog-mcp's core principles:

1. **Local-first**: Data stays on user's machine
2. **Privacy**: No external services see task content
3. **Offline-capable**: Core functionality works without internet
4. **Zero external dependencies**: No API keys, no cloud accounts
5. **User control**: Users own their data, not a service

These principles are more important than having the "best" search technology. Orama is **good enough** for our use case while preserving these principles.

## References

- Research artifact: `mcp://backlog/research-agent/task-task-0163-2026-02-02/artifact.md`
- ADR-0038: Comprehensive Search Capability
- TASK-0162: Search Ranking Issues
- TASK-0163: Algolia vs Orama Evaluation
- Algolia Documentation: https://www.algolia.com/doc/
- Orama Documentation: https://docs.orama.com/
