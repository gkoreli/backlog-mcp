import './theme/index.css';
import './markdown/shiki.css';
import './markdown/github-dark.css';
import './markdown/github-light.css';
import './styles.css';
import './diff/diff.css';
import './components/svg-icon.js';
import './components/task-filter-bar.js';
import './components/task-list.js';
import './components/task-item.js';
import './components/task-detail.js';
import './components/task-badge.js';
import './components/resource-viewer.js';
import './components/system-info-modal.js';
import './components/copy-button.js';
import './components/spotlight-search.js';
import './components/activity-panel.js';
import './components/collision-candidates.js';
import './components/desk-page.js';
import './components/theme-toggle.js';
import './components/backlog-app.js';
import { backlogEvents } from './services/event-source-client.js';
import { initHighlighter } from './markdown/index.js';
import { effect, inject } from '@nisli/core';
import { AppState } from './services/app-state.js';
import { SplitPaneState } from './services/split-pane-state.js';

// Bootstrap singletons (di-bootstrap-eager)
const appState = inject(AppState);
inject(SplitPaneState);

// Initialize shiki highlighter (async, non-blocking)
initHighlighter();

// Keep one SSE connection scoped to the active home.
effect(() => {
  backlogEvents.connect(appState.requestHomeSelection.value);
});

// All document-level event bridges have been removed.
// Components inject AppState / SplitPaneState directly.
// md-block link interception uses event delegation on click.
// See ADR 0013.
