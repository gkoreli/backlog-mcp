import {
  getHomeId,
  type HomeSelection,
} from '../utils/api.js';

const STORAGE_KEY = 'backlog:recent-searches';
const MAX_ITEMS = 15;

export interface RecentSearchItem {
  id: string;
  title: string;
  type: 'task' | 'epic' | 'resource';
  home_id: string;
  selection?: HomeSelection;
  timestamp: number;
}

export class RecentSearchesService {
  private items: RecentSearchItem[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        this.items = Array.isArray(parsed)
          ? parsed.filter(isRecentSearchItem)
          : [];
      }
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
  }

  add(
    item: Omit<RecentSearchItem, 'home_id' | 'timestamp'>,
  ): void {
    const homeId = getHomeId(item.selection);
    // The same display id in different homes is a different recent item.
    this.items = this.items.filter(
      existing => existing.id !== item.id || existing.home_id !== homeId,
    );
    // Add to front with current timestamp
    this.items.unshift({
      ...item,
      home_id: homeId,
      timestamp: Date.now(),
    });
    // Limit to MAX_ITEMS
    if (this.items.length > MAX_ITEMS) {
      this.items = this.items.slice(0, MAX_ITEMS);
    }
    this.save();
  }

  getAll(): RecentSearchItem[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
    this.save();
  }
}

function isRecentSearchItem(value: unknown): value is RecentSearchItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<RecentSearchItem>;
  const selectionValid = item.selection === undefined
    ? item.home_id === 'legacy'
    : isHomeSelection(item.selection)
      && getHomeId(item.selection) === item.home_id;
  return selectionValid
    && typeof item.id === 'string'
    && typeof item.title === 'string'
    && (item.type === 'task' || item.type === 'epic' || item.type === 'resource')
    && typeof item.home_id === 'string'
    && typeof item.timestamp === 'number';
}

function isHomeSelection(value: unknown): value is HomeSelection {
  if (typeof value !== 'object' || value === null) return false;
  const selection = value as { home?: unknown; projectRoot?: unknown };
  if (selection.home === 'global') return true;
  return selection.home === 'project'
    && typeof selection.projectRoot === 'string'
    && selection.projectRoot.length > 0;
}

export const recentSearchesService = new RecentSearchesService();
