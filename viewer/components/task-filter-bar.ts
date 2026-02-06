import { TYPE_REGISTRY } from '../type-registry.js';

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const SORT_OPTIONS = [
  { key: 'updated', label: 'Updated' },
  { key: 'created_desc', label: 'Created (newest)' },
  { key: 'created_asc', label: 'Created (oldest)' },
];

const SORT_STORAGE_KEY = 'backlog:sort';

export class TaskFilterBar extends HTMLElement {
  private currentFilter = 'active';
  private currentSort = 'updated';
  private currentType = 'all';

  connectedCallback() {
    const savedSort = localStorage.getItem(SORT_STORAGE_KEY);
    if (savedSort && SORT_OPTIONS.some(o => o.key === savedSort)) {
      this.currentSort = savedSort;
    }
    this.render();
    this.attachListeners();
  }

  render() {
    const statusButtons = FILTERS.map(f => 
      `<button class="filter-btn ${this.currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`
    ).join('');
    
    const typeButtons = [
      { key: 'all', label: 'All' },
      ...Object.entries(TYPE_REGISTRY).map(([key, config]) => ({ key, label: config.label }))
    ].map(t =>
      `<button class="filter-btn ${this.currentType === t.key ? 'active' : ''}" data-type-filter="${t.key}">${t.label}</button>`
    ).join('');
    
    const sortOptions = SORT_OPTIONS.map(s =>
      `<option value="${s.key}" ${this.currentSort === s.key ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    
    this.innerHTML = `
      <div class="filter-bar">
        ${statusButtons}
        <div class="filter-sort">
          <label class="filter-sort-label">Sort:</label>
          <select class="filter-sort-select">${sortOptions}</select>
        </div>
      </div>
      <div class="filter-bar type-filter">
        <span class="filter-label">Type</span>
        ${typeButtons}
      </div>
    `;
  }

  attachListeners() {
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = (e.target as HTMLElement).dataset.filter;
        if (filter) this.setFilter(filter);
      });
    });
    
    this.querySelectorAll('[data-type-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = (e.target as HTMLElement).dataset.typeFilter;
        if (type) this.setType(type);
      });
    });
    
    this.querySelector('.filter-sort-select')?.addEventListener('change', (e) => {
      const sort = (e.target as HTMLSelectElement).value;
      this.setSort(sort);
    });
  }

  setFilter(filter: string) {
    this.currentFilter = filter;
    this.updateActiveStates();
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter, type: this.currentType, sort: this.currentSort } }));
  }

  setType(type: string) {
    this.currentType = type;
    this.updateActiveStates();
    document.dispatchEvent(new CustomEvent('filter-change', { detail: { filter: this.currentFilter, type, sort: this.currentSort } }));
  }

  setSort(sort: string) {
    this.currentSort = sort;
    localStorage.setItem(SORT_STORAGE_KEY, sort);
    document.dispatchEvent(new CustomEvent('sort-change', { detail: { sort } }));
  }

  private updateActiveStates() {
    this.querySelectorAll('[data-filter]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.filter === this.currentFilter);
    });
    this.querySelectorAll('[data-type-filter]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.typeFilter === this.currentType);
    });
  }

  setState(filter: string, _type: string, _query: string | null) {
    this.currentFilter = filter;
    this.updateActiveStates();
  }
  
  getSort(): string {
    return this.currentSort;
  }
}

customElements.define('task-filter-bar', TaskFilterBar);
