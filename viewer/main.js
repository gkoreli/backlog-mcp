import './components/task-filter-bar.js';
import './components/task-list.js';
import './components/task-item.js';
import './components/task-detail.js';
// URL state management
const params = new URLSearchParams(window.location.search);
const initialFilter = params.get('filter') || 'active';
const initialTask = params.get('task');
// Set initial filter
document.addEventListener('DOMContentLoaded', () => {
    const filterBar = document.querySelector('task-filter-bar');
    if (filterBar?.setFilter)
        filterBar.setFilter(initialFilter);
    if (initialTask) {
        const detail = document.querySelector('task-detail');
        if (detail?.loadTask)
            detail.loadTask(initialTask);
    }
});
// Update URL on filter change
document.addEventListener('filter-change', ((e) => {
    const url = new URL(window.location.href);
    url.searchParams.set('filter', e.detail.filter);
    history.replaceState(null, '', url);
}));
// Update URL on task selection
document.addEventListener('task-selected', ((e) => {
    const url = new URL(window.location.href);
    url.searchParams.set('task', e.detail.taskId);
    history.replaceState(null, '', url);
}));
