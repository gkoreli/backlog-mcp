/**
 * home-selector.ts — Which backlog home am I looking at? (ADR 0112.4)
 *
 * Primary role: the provenance badge. It renders what the SERVER resolved
 * (`HomeProvenance` off /api/status), not what the URL asked for — before
 * the Phase E cutover a `?home=project` URL may still resolve to the global
 * store, and the badge's whole job is that a human never mistakes global
 * work for project work (ADR 0112 R-9).
 *
 * Secondary role: switching. The active home lives in the URL and the app
 * is a pure function of it — the menu only rewrites the URL (via
 * AppState.setHomeSelection → history.pushState). HARD LAW (R-9): the menu
 * never triggers a disk scan. It offers global (always) + every project home
 * the agent has already worked against, read from the server's use-declared
 * recent-homes manifest (ADR 0128) — a declared list, not a filesystem walk.
 * The project the URL currently carries is always included even if the
 * manifest fetch has not landed yet.
 */
import { signal, computed, component, html, effect, inject, each, when } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import {
  buildApiUrl,
  fetchRecentHomes,
  forgetRecentHome,
  type HomeProvenance,
  type RecentHome,
} from '../utils/api.js';

export const HomeSelector = component('home-selector', () => {
  const app = inject(AppState);
  const provenance = signal<Partial<HomeProvenance> | undefined>(undefined);
  const recentHomes = signal<RecentHome[]>([]);
  const open = signal(false);

  // Recent-homes manifest (ADR 0128): the switcher's project entries. Fetched
  // on mount and whenever the active home changes (a fresh switch may have
  // just registered a new project). Failure leaves the list empty — the URL's
  // own project (below) still renders, so the chrome never regresses.
  effect(() => {
    // Re-run on home switches so a newly-declared project appears promptly.
    void app.requestHomeSelection.value;
    void (async () => {
      recentHomes.value = await fetchRecentHomes();
    })();
  });

  // Server truth, refreshed per home switch. Failure leaves the badge on the
  // recent-homes fallback — never blocks the chrome. All display strings
  // (label, display_path) are server-computed; this component renders them.
  effect(() => {
    const selection = app.requestHomeSelection.value;
    void (async () => {
      try {
        const res = await fetch(buildApiUrl('/api/status', {}, selection));
        const status = await res.json() as Partial<HomeProvenance>;
        provenance.value = status.home ? status : undefined;
      } catch {
        provenance.value = undefined;
      }
    })();
  });

  // The active home root, straight from server provenance (falls back to the
  // URL's project root before /api/status answers). Used to key the ✓.
  const activeRoot = computed(() =>
    provenance.value?.home === 'project'
      ? provenance.value.root ?? provenance.value.home_id ?? app.projectRoot.value
      : provenance.value?.home === 'global'
        ? provenance.value.root
        : app.projectRoot.value,
  );
  const isProject = computed(() =>
    (provenance.value?.home ?? (app.projectRoot.value ? 'project' : 'global')) === 'project',
  );

  const icon = computed(() => isProject.value ? '📁' : '🌐');
  // Badge label: server-provided when resolved; else the recent-homes entry
  // matching the URL's project; else 'global'. No client path parsing.
  const label = computed(() => {
    if (provenance.value?.label) return provenance.value.label;
    const urlRoot = app.projectRoot.value;
    if (urlRoot) {
      const match = recentHomes.value.find(
        (h) => h.home === 'project' && h.root === urlRoot,
      );
      if (match) return match.label;
    }
    return 'global';
  });
  const title = computed(() =>
    provenance.value?.root
      ? `${isProject.value ? 'Project' : 'Global'} home: ${provenance.value.root}`
      : isProject.value ? 'Project home' : 'Global home',
  );

  // The global entry, straight from the manifest (server-presented).
  const globalEntry = computed(() =>
    recentHomes.value.find((h) => h.home === 'global'),
  );
  const globalPath = computed(() => globalEntry.value?.display_path ?? '');

  // Project entries: the recent-homes manifest, most-recent-first (ADR 0128
  // R1 order preserved). The URL's current project is pinned to the top if the
  // manifest hasn't recorded it yet — but even then its label/path come from
  // provenance (server-computed), never from client string ops.
  const projectEntries = computed(() => {
    const entries: { root: string; label: string; display_path: string }[] = [];
    const seen = new Set<string>();
    const urlRoot = app.projectRoot.value;
    if (urlRoot && !recentHomes.value.some((h) => h.home === 'project' && h.root === urlRoot)) {
      const p = provenance.value;
      // Only render the pinned project once the server has presented it.
      if (p?.home === 'project' && p.root === urlRoot && p.label && p.display_path) {
        entries.push({ root: urlRoot, label: p.label, display_path: p.display_path });
        seen.add(urlRoot);
      }
    }
    for (const home of recentHomes.value) {
      if (home.home === 'project' && !seen.has(home.root)) {
        entries.push({ root: home.root, label: home.label, display_path: home.display_path });
        seen.add(home.root);
      }
    }
    return entries;
  });
  const hasProjects = computed(() => projectEntries.value.length > 0);
  const globalActive = computed(() => !isProject.value);

  const toggleMenu = () => { open.value = !open.value; };
  const closeMenu = () => { open.value = false; };
  const pickGlobal = () => {
    app.setHomeSelection({ home: 'global' });
    closeMenu();
  };
  const pickProject = (root: string) => {
    app.setHomeSelection({ home: 'project', projectRoot: root });
    closeMenu();
  };
  const forget = async (root: string, e: Event) => {
    // Don't let the click bubble to the row's pick handler.
    e.stopPropagation();
    await forgetRecentHome(root);
    recentHomes.value = await fetchRecentHomes();
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMenu();
  };
  const menuDisplay = computed(() => open.value ? 'block' : 'none');
  const backdropDisplay = computed(() => open.value ? 'block' : 'none');

  return html`
    <div class="home-selector" @keydown=${onKeydown}>
      <button class="btn-outline home-badge" title="${title}" @click=${toggleMenu} aria-haspopup="menu" aria-expanded=${open}>
        <span class="home-icon">${icon}</span>
        <span class="home-label">${label}</span>
        <span class="home-caret" aria-hidden="true">▾</span>
      </button>
      <div class="home-menu-backdrop" style="display:${backdropDisplay}" @click=${closeMenu}></div>
      <div class="home-menu" role="menu" style="display:${menuDisplay}">
        <button class="home-menu-item ${globalActive.value ? 'active' : ''}" role="menuitem" @click=${pickGlobal}>
          <span class="home-icon">🌐</span>
          <span class="home-item-text">
            <span class="home-item-label">global</span>
            <span class="home-item-path">${globalPath}</span>
          </span>
          ${when(globalActive, html`<span class="home-check" aria-hidden="true">✓</span>`)}
        </button>

        <div class="home-menu-section" role="presentation">Recent projects</div>

        ${when(hasProjects,
          html`${each(projectEntries, (entry) => entry.root, (entry) => html`
            <div class="home-menu-row ${activeRoot.value === entry.value.root ? 'active' : ''}">
              <button
                class="home-menu-item home-menu-item--project"
                role="menuitem"
                title="${entry.value.root}"
                @click=${() => pickProject(entry.value.root)}
              >
                <span class="home-icon">📁</span>
                <span class="home-item-text">
                  <span class="home-item-label">${entry.value.label}</span>
                  <span class="home-item-path">${entry.value.display_path}</span>
                </span>
                ${when(
                  computed(() => activeRoot.value === entry.value.root),
                  html`<span class="home-check" aria-hidden="true">✓</span>`,
                )}
              </button>
              <button
                class="home-forget"
                title="Remove from recent projects"
                aria-label="Remove ${entry.value.label} from recent projects"
                @click=${(e: Event) => forget(entry.value.root, e)}
              >✕</button>
            </div>
          `)}`,
        )}
        ${when(computed(() => !hasProjects.value),
          html`<div class="home-menu-empty">
            Open a project with the CLI or bridge — it appears here automatically.
          </div>`,
        )}
      </div>
    </div>
    <style>
      .home-selector {
        position: relative;
        display: inline-flex;
      }
      .home-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 200px;
        border-radius: var(--t-radius-pill);
      }
      .home-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .home-caret {
        font-size: 10px;
        opacity: 0.6;
        margin-left: 1px;
      }
      .home-menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 90;
      }
      .home-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 91;
        min-width: 260px;
        max-width: 340px;
        max-height: min(60vh, 420px);
        overflow-y: auto;
        padding: 5px;
        background: var(--t-bg-elevated);
        border: 1px solid var(--t-border-default);
        border-radius: var(--t-radius-md);
        box-shadow: var(--t-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.25));
      }
      .home-menu-section {
        padding: 8px 10px 4px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--t-fg-subtle, var(--t-fg-muted));
      }
      .home-menu-row {
        display: flex;
        align-items: stretch;
        border-radius: var(--t-radius-sm);
      }
      .home-menu-row:hover {
        background: var(--t-bg-hover, rgba(128, 128, 128, 0.15));
      }
      .home-menu-row.active {
        background: var(--t-bg-selected, var(--t-accent-bg));
      }
      .home-menu-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 7px 10px;
        border: none;
        background: transparent;
        color: var(--t-fg-default);
        border-radius: var(--t-radius-sm);
        cursor: pointer;
        text-align: left;
        font-size: 13px;
      }
      /* Standalone items (global) keep their own hover; row-wrapped ones
         inherit the row's hover so the forget button shares the highlight. */
      .home-menu-item:not(.home-menu-item--project):hover {
        background: var(--t-bg-hover, rgba(128, 128, 128, 0.15));
      }
      .home-icon {
        flex: 0 0 auto;
        line-height: 1;
      }
      .home-item-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .home-item-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .home-item-path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;              /* keep the meaningful tail visible */
        text-align: left;
        font-size: 11px;
        color: var(--t-fg-muted);
      }
      .home-menu-row.active .home-item-label,
      .home-menu-item.active .home-item-label {
        color: var(--t-accent-primary);
        font-weight: 600;
      }
      .home-check {
        flex: 0 0 auto;
        color: var(--t-accent-primary);
        font-size: 12px;
      }
      .home-forget {
        flex: 0 0 auto;
        width: 26px;
        border: none;
        background: transparent;
        color: var(--t-fg-subtle, var(--t-fg-muted));
        cursor: pointer;
        font-size: 12px;
        border-radius: var(--t-radius-sm);
        opacity: 0;
        transition: opacity 0.12s ease, color 0.12s ease;
      }
      .home-menu-row:hover .home-forget,
      .home-menu-row:focus-within .home-forget {
        opacity: 1;
      }
      .home-forget:hover {
        color: var(--t-red, #e5484d);
        background: var(--t-red-bg, rgba(229, 72, 77, 0.12));
      }
      .home-menu-empty {
        padding: 8px 10px 10px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--t-fg-muted);
      }
    </style>
  `;
});
