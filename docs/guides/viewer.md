# Viewer styling and markdown

Read this when changing viewer components, themes, styles, markdown rendering, syntax highlighting, or viewer bundle size.
These are active contributor instructions, reached from [AGENTS.md](../../AGENTS.md).

## Viewer Architecture

### Design System: Tsa (ცა)

The viewer is styled with **Tsa** ("sky" in Georgian) — our design system paired with Nisli.

- All colors are CSS custom properties (`--t-*` prefix), defined in `packages/viewer/theme/`
- Theme switching via `data-theme="dark"|"light"` on `<html>`, persisted to localStorage
- Brand gradient (`#00d4ff → #7b2dff → #ff2d7b`) and entity type gradients are theme-invariant
- Never add hardcoded color values — always use `var(--t-*)` tokens

```
packages/viewer/theme/
├── index.css      # Barrel import
├── tokens.css     # Invariants (fonts, radius, brand gradients)
├── dark.css       # Dark values (default)
└── light.css      # Light values
```

### Markdown & Syntax Highlighting

All markdown concerns live in `packages/viewer/markdown/`:

```
packages/viewer/markdown/
├── index.ts         # Barrel: { marked, highlight, initHighlighter }
├── renderer.ts      # marked + shiki config + custom plugins
├── shiki.css        # Dual-theme CSS variable switching
├── github-dark.css  # GitHub markdown prose (dark, scoped)
└── github-light.css # GitHub markdown prose (light, scoped)
```

**Key decisions ([ADR 0111](../adr/0111-tsa-design-system-and-shiki-migration.md)):**

- **Shiki** for syntax highlighting (not highlight.js) — TextMate grammars, VS Code-quality, dual-theme via CSS variables
- **`marked-shiki`** as the bridge — makes `marked.parse()` async
- **Async markdown is a resource** — consumers use `resource(source, loader)` for parsing; imperative DOM post-processing remains an effect
- **One render, both themes** — shiki outputs `--shiki-light`/`--shiki-dark` per token; CSS picks the active one

**Shiki bundle rules (critical for dist size):**

- **Never import `shiki` directly** — it bundles ALL 350+ grammars as async chunks even if unused
- **Use fine-grained imports**: `shiki/core` + `@shikijs/langs/<name>` + `@shikijs/themes/<name>`
- **Use `shiki/engine/javascript`** (`createJavaScriptRegexEngine`) — pure JS, no WASM binary
- **Only add grammars you need** — each `import('@shikijs/langs/x')` becomes one lazy chunk

## Web Viewer Patterns


### Icons

- No emojis — use SVG icons from `packages/viewer/icons/index.ts`
- Futuristic gradient style matching `logo.svg`

### Styling

- Components inherit colors from parent elements
- Selection states must be consistent across all item types
- Tree connectors use `::before`/`::after` pseudo-elements

### Filters

- "All" option goes last in filter lists
- Child tasks without visible parent show as orphans (not hidden)
