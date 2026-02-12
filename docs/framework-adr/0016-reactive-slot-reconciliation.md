# 0016. Reactive slot reconciliation — eliminate nuke-and-rebuild

**Date**: 2026-02-11
**Status**: Proposed

## Problem

The template engine destroys and recreates all DOM nodes every time a computed signal returns a new `TemplateResult`. There is no reconciliation — structurally identical templates are treated as completely new content.

This means the signal system's fine-grained dependency tracking is wasted at the rendering layer. Signals correctly narrow invalidation to the exact computed that changed, but the template engine responds by tearing down the entire slot and rebuilding from scratch.

### How it works today

When a computed/signal is embedded in a template (`${someComputed}`), the engine creates a "reactive slot" bounded by comment markers (`slot-start` / `slot-end`). When the signal re-evaluates, `template.ts` lines 400-410 execute:

```ts
// Remove previous content
for (const r of currentResults) {
  try { r.dispose(); } catch (_) {}
}
for (const node of currentNodes) {
  node.parentNode?.removeChild(node);
}
currentNodes = [];
currentResults = [];

// ... then mount the new TemplateResult from scratch
```

Every `html\`...\`` call produces a new `TemplateResult` object. The slot handler has no way to know whether the new result has the same template shape as the old one. It nukes everything and starts over.

### Concrete impact

Toggling between task-scoped and global activity in the viewer triggers 4 separate nuke-and-rebuild cycles from a single user action:

1. `mainContent` computed — entire activity operation list destroyed and recreated (every day group, task group, operation card)
2. `filterHeader` computed — filter badge destroyed and recreated
3. `modeToggle` computed — toggle buttons destroyed and recreated
4. `paneHeaderContent` in backlog-app — pane title destroyed and recreated

The `each()` primitive exists for keyed list diffing, but there is no equivalent for computed template slots — which is how most conditional/branching UI is structured.

### What gets lost on rebuild

- Scroll position within the activity list
- CSS transition/animation state
- Expanded/collapsed state of DOM elements (e.g. `<details>`)
- Browser-managed state (input focus, text selection)
- Any imperative DOM state set by effects

### Scale of the problem

Every `computed(() => html\`...\`)` pattern in the codebase has this behavior. A grep for `computed.*html` across viewer components shows this is the primary rendering pattern — it's not an edge case, it's the default way the framework renders conditional content.

## Problem space

The core tension: `html` tagged templates use a **template cache** (keyed by the strings array) for parse-time efficiency, but the rendering layer doesn't use template identity for **update-time diffing**.

The `html` function already caches parsed templates:

```ts
// template.ts — template cache
const templateCache = new Map<TemplateStringsArray, HTMLTemplateElement>();
```

Same tagged template literal → same `TemplateStringsArray` reference → same cached `HTMLTemplateElement`. This means the framework already knows when two `TemplateResult`s came from the same template shape. It just doesn't use that information during slot updates.

### Design dimensions

1. **Template identity** — If the old and new `TemplateResult` share the same `TemplateStringsArray`, the DOM structure is identical. Only the dynamic values (the `${...}` holes) differ. The framework could patch values in-place instead of rebuilding.

2. **Scope of change** — This affects the reactive slot handler in `processChildNode()`. The `each()` keyed-list path already does incremental updates. The gap is in the single-value slot path (computed returning one `TemplateResult`).

3. **Nested computeds** — A template may embed other computeds (`${paneHeaderContent}` inside `${splitPaneView}`). Reconciliation must handle the case where the outer template is the same shape but an inner computed changed independently (this already works today via the inner computed's own slot — the fix should preserve this).

4. **Null transitions** — Computeds often return `null` for "hidden" and `html\`...\`` for "visible" (the `when()` pattern). The reconciler must handle shape transitions: null→template, template→null, templateA→templateB (different shapes).

5. **Disposal semantics** — Today, `dispose()` is called on every rebuild, which cleans up effects and event listeners inside the old template. A patch-in-place approach must NOT call dispose — it must update bindings without tearing down the effect graph.

### What other frameworks do

- **Lit**: Same `TemplateStringsArray` = same template. On re-render, Lit walks the parts list and patches only changed values. DOM structure is never rebuilt for same-shape templates.
- **Solid**: Compiled output. `<Show>` / `<Switch>` components manage conditional DOM. Signals update text/attribute nodes directly — no template diffing needed.
- **Preact/React**: Virtual DOM diff. Different tradeoff (full tree diff vs targeted updates), but same-shape JSX produces same virtual nodes that get patched.

All three preserve DOM when the template structure hasn't changed. The nuke-and-rebuild approach is unique to this framework.
