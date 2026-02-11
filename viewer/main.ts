import './styles.css';
import './github-markdown.css';
import 'diff2html/bundles/css/diff2html.min.css';
import './components/svg-icon.js';
import './components/md-block.js';
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
import './components/backlog-app.js';
import { backlogEvents } from './services/event-source-client.js';
import { inject } from './framework/injector.js';
import { AppState } from './services/app-state.js';
import { SplitPaneState } from './services/split-pane-state.js';

// Bootstrap singletons (di-bootstrap-eager)
inject(AppState);
const splitState = inject(SplitPaneState);

// Connect to SSE for real-time updates
backlogEvents.connect();

// ── Document-level events ───────────────────────────────────────────
// HACK:DOC_EVENT — resource-open is still dispatched by md-block link
// clicks (md-block is a third-party wrapper, not migrated) and by
// task-detail resource links.
// All other event bridges (resource-close, activity-open, activity-close,
// activity-clear-filter, resource-loaded) have been removed — resource-viewer,
// activity-panel, and spotlight-search now inject(SplitPaneState) directly.

document.addEventListener('resource-open', ((e: CustomEvent) => {
  if (e.detail.uri) {
    splitState.openMcpResource(e.detail.uri);
  } else if (e.detail.path) {
    splitState.openResource(e.detail.path);
  }
}) as EventListener);

// HACK:DOC_EVENT — activity-open is still dispatched by task-detail
// (for the "View Activity" button). Remove when task-detail uses
// inject(SplitPaneState) directly.
document.addEventListener('activity-open', ((e: CustomEvent) => {
  splitState.openActivity(e.detail?.taskId);
}) as EventListener);
