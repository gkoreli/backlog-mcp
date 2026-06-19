---
title: "0111: Tsa Design System and Shiki Migration"
date: 2026-06-19
status: accepted
---

# 0111. Tsa Design System and Shiki Migration

**Date**: 2026-06-19
**Status**: Accepted

## Context

The viewer had no theming support. All 334 colors were hardcoded hex values scattered across `styles.css` and component files. Syntax highlighting used highlight.js with regex-based tokenization and two separate scoped CSS theme files. There was no way to switch between dark and light modes.

## Decisions

### 1. Tsa (ცა) Design System

Named "Tsa" (Georgian for "sky") as a companion to Nisli (ნისლი, "fog") — the rendering framework. The sky is the canvas that holds both night (dark) and day (light).

- **All hardcoded colors extracted into CSS custom properties** (`--t-*` prefix)
- **Tokens organized by role**: `bg`, `fg`, `border`, `accent`, `status`, `type`, `shadow`
- **Brand gradient is theme-invariant**: `#00d4ff → #7b2dff → #ff2d7b` (the tri-color identity from our logo and icon system)
- **Theme switching via `data-theme` attribute on `<html>`**, persisted to localStorage
- **Entity type gradients are theme-invariant** — they're brand identity, not surface colors

File structure:
```
packages/viewer/theme/
├── index.css      # Barrel import
├── tokens.css     # Shared invariants (fonts, radius, brand gradients)
├── dark.css       # Dark theme values (default)
└── light.css      # Light theme values
```

### 2. Shiki over highlight.js

Migrated syntax highlighting from highlight.js to [Shiki](https://shiki.style).

**Why:**
- **VS Code-quality tokenization** — TextMate grammars, not regex approximations
- **Dual-theme via CSS variables** — one HTML render, instant theme switch. Shiki outputs `--shiki-light` and `--shiki-dark` on every token. One CSS rule picks which wins. Zero extra theme files.
- **Better ecosystem alignment** — Shiki is the default for Astro, Nuxt, VitePress, Vercel's ai-elements. highlight.js is in maintenance mode.
- **10x rendering perf** in code-heavy views (per Vercel's benchmarks on M1 Pro)
- **Eliminated 172 lines of scoped hljs CSS** (hljs-dark.css + hljs-light.css)

**Integration:**
- `marked-shiki` as the bridge (async `walkTokens`)
- `md-block` uses `effect()` + `signal` to handle async `marked.parse()` — async code is a side effect, belongs in effects
- `resource-viewer` uses the sync `highlight()` function directly (highlighter pre-initialized at startup)

### 3. Markdown Module Colocation

All markdown concerns collocated into `packages/viewer/markdown/`:
```
packages/viewer/markdown/
├── index.ts         # Barrel export
├── renderer.ts      # marked + shiki config + custom plugins
├── shiki.css        # Dual-theme CSS variable switching (29 lines)
├── github-dark.css  # GitHub markdown prose (dark)
└── github-light.css # GitHub markdown prose (light)
```

### 4. GitHub Markdown and diff2html

- GitHub markdown CSS (from `sindresorhus/github-markdown-css`) scoped to `[data-theme]`
- diff2html already has built-in `.d2h-dark` support — made `colorScheme` option dynamic

## Preserved Capabilities

All custom marked plugins carried over intact:
- **Autolink extension** — auto-links bare http/file/mcp URLs
- **Mermaid code blocks** → `<pre class="mermaid">`
- **Heading slugs** — `id` attributes for anchor linking
- **External links** — `target="_blank" rel="noopener"`

## Packages

| Removed | Added |
|---------|-------|
| `highlight.js` | `shiki` |
| `marked-highlight` (briefly) | `marked-shiki` |
| `hljs-dark.css` (86 lines) | `shiki.css` (29 lines) |
| `hljs-light.css` (86 lines) | — |

## Philosophy

- **One render, both themes** — shiki's CSS variable approach means we never render code twice or maintain parallel theme stylesheets
- **Async is a side effect** — `marked-shiki` makes `marked.parse()` async; we handle that with Nisli's `effect()` pattern, not by pretending async code is sync
- **Colocation over scattering** — everything about markdown rendering lives in `markdown/`, everything about theming lives in `theme/`
- **Brand identity is invariant** — the tri-color gradient and entity type colors don't change between themes; only surface/text/border colors adapt
