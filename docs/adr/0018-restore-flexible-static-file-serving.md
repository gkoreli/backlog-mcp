# 0018. Restore Flexible Static File Serving

**Date**: 2026-01-24
**Status**: Accepted
**Backlog Item**: TASK-0081

## Context

The web viewer is broken with 404 errors for static resources (`github-markdown.css`, `logo.svg`). This is a regression introduced during the HTTP server refactoring (commits 35b2ffb → fbb1de3).

### Current State

The HTTP server uses a hardcoded whitelist for static files:

```typescript
const staticPaths: Record<string, string> = {
  '/main.js': join(__dirname, 'viewer', 'main.js'),
  '/styles.css': join(__dirname, '..', 'viewer', 'styles.css'),
  '/gradient-icons.svg': join(__dirname, '..', 'viewer', 'gradient-icons.svg'),
};
```

This approach only serves 3 specific files. Any other static asset (CSS, SVG, images) returns 404.

### Research Findings

The original `viewer.ts` implementation (before HTTP refactor) used flexible pattern-based serving:

```typescript
if (req.url?.match(/\.(js|css|svg|png|ico)$/)) {
  const urlPath = req.url.split('?')[0] || '';
  let filePath = join(projectRoot, 'dist', 'viewer', urlPath);
  if (!existsSync(filePath)) {
    filePath = join(projectRoot, 'viewer', urlPath);
  }
  // Serves ANY file matching the extension pattern
}
```

This worked reliably and handled all viewer assets automatically.

## Proposed Solutions

### Option 1: Quick Fix - Add Missing Files to Whitelist

**Description**: Add `/github-markdown.css` and `/logo.svg` to the `staticPaths` map.

**Pros**:
- Minimal code change
- Explicit control over served files
- Fast to implement (2 lines)

**Cons**:
- Brittle - breaks again when new assets are added
- Requires code change for every new static file
- Doesn't scale
- Violates DRY principle
- Hardcoding is an anti-pattern

**Implementation Complexity**: Low

### Option 2: Restore Flexible Pattern-Based Serving

**Description**: Bring back the original logic - match file extensions, check `dist/viewer/` then `viewer/` directories.

**Pros**:
- Flexible - handles any static file automatically
- Prevents this class of bug from recurring
- Simpler code than current implementation
- Proven working design (it worked before)
- No maintenance burden for new assets

**Cons**:
- Less explicit than whitelist
- Requires extension whitelist validation for security

**Implementation Complexity**: Low

### Option 3: Hybrid - Whitelist with Fallback Pattern

**Description**: Keep explicit paths for critical files (main.js, styles.css), add pattern-based fallback for other viewer assets.

**Pros**:
- Explicit for important files
- Flexible for secondary assets
- "Best of both worlds"

**Cons**:
- More complex logic
- Two code paths to maintain
- Over-engineered for the problem
- YAGNI violation - no clear benefit over Option 2

**Implementation Complexity**: Medium

## Decision

**Selected**: Option 2 - Restore Flexible Pattern-Based Serving

**Rationale**: 

1. **Product merit**: Restores working state and prevents future breakage
2. **User impact**: Seamless - any viewer asset just works
3. **Technical merit**: Simpler than current implementation, proven design
4. **Maintainability**: Zero maintenance for new assets
5. **Security**: Extension whitelist (`js|css|svg|png|ico`) is safe - doesn't expose source files (`.ts`, `.json`, `.md`)

Option 1 is a band-aid that doesn't address the root cause. Option 3 adds unnecessary complexity without clear benefit. Option 2 is objectively the best solution.

**Trade-offs Accepted**:
- Less explicit than whitelist (but this is actually a benefit - less code to maintain)
- Relies on extension whitelist for security (but this is proven safe)

## Consequences

**Positive**:
- Viewer works immediately
- Future assets (favicons, images, fonts) work automatically
- Simpler code than current implementation
- Prevents entire class of "forgot to add file to whitelist" bugs
- Restores proven working behavior

**Negative**:
- Slightly less explicit about which files are served
- Developers must ensure new asset types are safe before adding to extension pattern

**Risks**:
- **Risk**: Extension pattern could be modified to include unsafe types (`.ts`, `.json`)
  - **Mitigation**: Document safe extensions in code comment, add test to verify only safe extensions are served
- **Risk**: Could serve unintended files from viewer directory
  - **Mitigation**: Extension whitelist prevents this - only specific file types are served

## Implementation Notes

1. Replace hardcoded `staticPaths` map with pattern-based logic
2. Check `dist/viewer/` first (compiled assets), fallback to `viewer/` (source assets)
3. Use extension whitelist: `/\.(js|css|svg|png|ico)$/`
4. Add comment documenting safe extensions
5. Test with all current assets: `main.js`, `styles.css`, `github-markdown.css`, `logo.svg`, `gradient-icons.svg`
6. Verify `.ts` files are NOT served (security test)
