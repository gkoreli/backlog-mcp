# 0045. Fix Spotlight Snippet Display

**Date**: 2026-01-31
**Status**: Accepted
**Backlog Item**: TASK-0150

## Context

The `.spotlight-result-snippet` element in Spotlight search never displays content. Users report snippets are not visible in search results.

### Root Cause Analysis

The `renderResults()` method passes snippet HTML via a `content` attribute:
```html
<md-block content="${this.escapeAttr(r.snippet.html)}"></md-block>
```

However, `md-block` component only observes `src`, `hmin`, and `hlinks` attributes. The `content` attribute is never read, resulting in an empty element.

Additionally, `md-block` is a markdown renderer that expects markdown input, but the snippet is already HTML from `@orama/highlight` (text with `<mark>` tags).

## Proposed Solutions

### Option 1: Use innerHTML directly

Replace `<md-block>` with a plain `<span>` and render the HTML directly.

**Pros**:
- Minimal change (1 line)
- Semantically correct - snippets are HTML, not markdown
- No new components needed

**Cons**:
- None significant - the HTML from @orama/highlight is safe (just text + mark tags)

**Implementation Complexity**: Low

### Option 2: Add content attribute to md-block

Add "content" to `observedAttributes` and handle it in `attributeChangedCallback`.

**Pros**:
- Reusable pattern for other use cases

**Cons**:
- Semantically wrong - md-block parses markdown, but we're passing HTML
- More code changes
- Potential for double-escaping issues

**Implementation Complexity**: Medium

### Option 3: Create highlight-snippet component

New component specifically for rendering highlighted HTML snippets.

**Pros**:
- Clean abstraction

**Cons**:
- Over-engineering for this simple case
- More code to maintain

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 1 - Use innerHTML directly

**Rationale**: The simplest fix that's also semantically correct. The snippet HTML from `@orama/highlight` is safe (just text with `<mark class="spotlight-match">` tags). Using `md-block` for HTML content was the wrong abstraction.

## Consequences

**Positive**:
- Snippets display correctly with highlighted matches
- Minimal code change
- No new dependencies or components

**Negative**:
- None

## Implementation Notes

Change in `spotlight-search.ts` `renderResults()`:
```html
<!-- Before -->
<md-block content="${this.escapeAttr(r.snippet.html)}"></md-block>

<!-- After -->
<span class="snippet-text">${r.snippet.html}</span>
```

Update CSS selector from `.spotlight-result-snippet md-block` to `.spotlight-result-snippet .snippet-text`.
