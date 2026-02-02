# 0050. Search Ranking: Title Match Bonus

**Date**: 2026-02-02
**Status**: Accepted
**Backlog Item**: TASK-0162

## Problem Statement

Search results rank documents with high term frequency in descriptions above documents with the search term in their title. Users expect title matches to rank highest.

## Problem Space

### Why This Problem Exists

BM25 (the algorithm Orama uses) optimizes for document relevance based on term frequency and document length normalization. It doesn't inherently understand that titles are more important than body text. The current `boost: { title: 2 }` multiplies the title field's BM25 score, but this is insufficient when:

1. A document has many term occurrences in its description (high TF)
2. A document is shorter (BM25 penalizes longer documents)

Example: Searching "backlog" returns TASK-0145 (score: 16.97) above EPIC-0002 (score: 8.52), even though EPIC-0002 has "Backlog" directly in its title.

### Who Is Affected

- Users searching for specific topics in Spotlight
- Users expecting title matches to be most relevant
- The overall search UX quality

### Problem Boundaries

**In scope**: Ranking algorithm for text search results
**Out of scope**: Vector/semantic search ranking, filter functionality

### Problem-Space Map

**Dominant cause**: BM25 term frequency in descriptions overwhelms title boost multiplier

**Alternative root causes**:
- Boost value too low (2x not enough) - tested, even 100x doesn't fix it
- Custom tokenizer splits compound words, creating unexpected title matches

**What if we're wrong**: If the issue isn't BM25 TF dominance, it could be hybrid search weights affecting ranking (verified: hybrid search is disabled in production cache)

## Context

### Current State

- Orama search with BM25 algorithm
- Boost config: `{ id: 10, title: 2 }`
- Custom tokenizer expands hyphenated/compound words
- Hybrid search available but not always active

### Research Findings

1. **Boost multiplier is insufficient**: Even `title: 100` doesn't guarantee title matches rank first when description has high term frequency
2. **Tokenizer works correctly**: "BacklogStorage" → ["backlogstorage", "backlog", "storage"] is expected behavior
3. **Document length matters**: BM25 penalizes longer documents, so a 6KB task with 23 mentions beats a 13KB epic with 28 mentions
4. **Resources ARE indexed**: Contrary to initial report, resources appear in search results

## Proposed Solutions

### Option 1: Post-Search Re-ranking with Multiplier `[SHORT-TERM]` `[LOW]`

**Description**: After Orama search, multiply scores for documents where query appears in title.

**Differs from others by**:
- vs Option 2: Uses multiplier, not fixed bonus
- vs Option 3: Single search, not multiple searches

**Pros**:
- Minimal code change (~10 lines)
- Preserves Orama's BM25 ranking

**Cons**:
- Doesn't distinguish exact word match from compound word match
- Multiplier effect varies with base score

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 5 | ~30 minutes |
| Risk | 4 | Low risk, easy to revert |
| Testability | 5 | Easy unit tests |
| Future flexibility | 3 | Limited - just a multiplier |
| Operational complexity | 5 | No new systems |
| Blast radius | 5 | Only affects ranking |

### Option 2: Custom Scoring with Fixed Title Bonus `[SHORT-TERM]` `[LOW]`

**Description**: After Orama search, add fixed bonus points for title matches. Distinguish exact word matches from compound word matches.

**Differs from others by**:
- vs Option 1: Fixed bonus, not multiplier (more predictable)
- vs Option 3: Still single search, but with explicit bonus logic

**Implementation**:
```typescript
function rerankWithTitleBonus(results, query) {
  const queryLower = query.toLowerCase();
  return results.map(r => {
    const title = r.item.title?.toLowerCase() || '';
    const titleWords = title.split(/\W+/);
    
    // Exact word match: "Backlog" in "Backlog MCP"
    const hasExactMatch = titleWords.includes(queryLower);
    
    // Partial match: "backlog" in "BacklogStorage"
    const hasPartialMatch = !hasExactMatch && title.includes(queryLower);
    
    const bonus = hasExactMatch ? 10 : hasPartialMatch ? 3 : 0;
    return { ...r, score: r.score + bonus };
  }).sort((a, b) => b.score - a.score);
}
```

**Pros**:
- Distinguishes exact ("Backlog") from partial ("BacklogStorage") matches
- Fixed bonus is predictable and tunable
- Leverages Orama's BM25 for base ranking

**Cons**:
- Bonus values are somewhat arbitrary
- Adds ~20 lines to search path

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 4 | ~1-2 hours |
| Risk | 4 | Low risk, easy to tune |
| Testability | 5 | Easy unit tests |
| Future flexibility | 4 | Can add more bonus types |
| Operational complexity | 5 | No new systems |
| Blast radius | 5 | Only affects ranking |

### Option 3: Two-Phase Search with Title Priority `[MEDIUM-TERM]` `[HIGH]`

**Description**: Execute title-only search first, then full-text search, merge with title matches always first.

**Differs from others by**:
- vs Option 1: Multiple searches, not post-processing
- vs Option 2: Structural change to search flow

**Pros**:
- Guarantees title matches rank first
- Clean separation of concerns

**Cons**:
- Two searches = 2x latency
- Complex merge logic
- Orama may not support field-specific search well

**Rubric Scores**:
| Anchor | Score | Justification |
|--------|-------|---------------|
| Time-to-ship | 2 | ~4-6 hours |
| Risk | 2 | Changes search flow |
| Testability | 3 | Complex scenarios |
| Future flexibility | 3 | Locked into two-phase |
| Operational complexity | 3 | Two searches to monitor |
| Blast radius | 4 | Could affect latency |

## Decision

**Selected**: Option 2 - Custom Scoring with Fixed Title Bonus

**Rationale**: 
- Distinguishes exact word matches from compound word matches (addresses the actual user complaint)
- Fixed bonus is more predictable than multiplier
- Minimal code change with clear semantics
- Easy to tune based on user feedback

**For this decision to be correct, the following must be true**:
- Users primarily search for words that appear in titles
- Exact word matches in titles are more valuable than partial/compound matches
- The bonus values (10 for exact, 3 for partial) are reasonable starting points

**Trade-offs Accepted**:
- Bonus values are somewhat arbitrary (can tune based on feedback)
- Adds ~20 lines of code to search path

## Consequences

**Positive**:
- Title matches rank higher as users expect
- "Backlog MCP" will rank above "BacklogStorage" for query "backlog"
- Predictable ranking behavior

**Negative**:
- Additional post-processing step (negligible performance impact)
- Bonus values may need tuning

**Risks**:
- Bonus values may not be optimal for all queries (mitigation: make configurable)

## Implementation Notes

1. Add `rerankWithTitleBonus()` function to `orama-search-service.ts`
2. Apply in `search()`, `searchAll()`, and `searchResources()` methods
3. Handle multi-word queries by checking if ANY query word matches
4. Add golden tests for ranking expectations
