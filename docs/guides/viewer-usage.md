# Viewer usage

Open `http://localhost:3030` — always available when the server is running.

**The Desk** — `http://localhost:3030/desk` — is the viewer's attention page: one server-composed briefing answering *"what should I look at, read, review and judge right now."* At most 7 items above the fold, worst-first, across four classes (JUDGE / REVIEW / READ / HEALTH); every item says why it surfaced, carries provenance chips (home, author, worktree), and offers a copy-ready instruction to hand your agent. Read-only by law — verdicts flow through your agent, never through the UI.

[Hosted viewer demo](https://backlog-mcp-viewer.pages.dev/).

Features:
- Split pane layout with task list and detail view
- Spotlight search with hybrid text + semantic matching
- Real-time updates via SSE
- Activity timeline
- Filter by status, type, epic
- Dark/light theme toggle (Tsa design system)
- Syntax highlighting via [Shiki](https://shiki.style) (VS Code-quality, dual-theme CSS variables)
- GitHub-flavored markdown rendering with Mermaid diagrams
- URL state persistence

The viewer UI is built with [Nisli](https://github.com/gkoreli/nisli) (`@nisli/core`) and styled with **Tsa** (ცა, Georgian for "sky") — our design system that pairs with Nisli.

The home switcher uses homes recorded by prior use. Forgetting a recent project
removes its switcher entry without deleting its documents. Entity detail shows
raw Markdown, relations and available memory analysis. Read contradictions as
signals to investigate; hand corrections to your agent with the source IDs.

See [Installation](installation.md) for server lifecycle and
[Viewer engineering](viewer.md) for component, theme and rendering changes.
