import { taskIcon, epicIcon, folderIcon, artifactIcon, milestoneIcon } from './icons/index.js';

export interface TypeConfig {
  prefix: string;
  label: string;
  icon: string;
  gradient: string;
  isContainer: boolean;
  hasStatus: boolean;
  extraFields?: string[];
}

export const TYPE_REGISTRY: Record<string, TypeConfig> = {
  task:      { prefix: 'TASK', label: 'Task',      icon: taskIcon,      gradient: 'linear-gradient(135deg, #00d4ff, #7b2dff)', isContainer: false, hasStatus: true,  extraFields: ['blocked_reason', 'evidence'] },
  epic:      { prefix: 'EPIC', label: 'Epic',      icon: epicIcon,      gradient: 'linear-gradient(135deg, #f0b429, #ff6b2d)', isContainer: true,  hasStatus: true },
  folder:    { prefix: 'FLDR', label: 'Folder',    icon: folderIcon,    gradient: 'linear-gradient(135deg, #3fb950, #1f883d)', isContainer: true,  hasStatus: false },
  artifact:  { prefix: 'ARTF', label: 'Artifact',  icon: artifactIcon,  gradient: 'linear-gradient(135deg, #a371f7, #ff2d7b)', isContainer: false, hasStatus: false, extraFields: ['content_type', 'path'] },
  milestone: { prefix: 'MLST', label: 'Milestone', icon: milestoneIcon, gradient: 'linear-gradient(135deg, #f85149, #ff8c00)', isContainer: true,  hasStatus: true,  extraFields: ['due_date'] },
};

export const ENTITY_TYPES = Object.keys(TYPE_REGISTRY);

export function getTypeFromId(id: string): string {
  for (const [type, config] of Object.entries(TYPE_REGISTRY)) {
    if (id.startsWith(config.prefix + '-')) return type;
  }
  return 'task';
}

export function getTypeConfig(type: string): TypeConfig {
  return TYPE_REGISTRY[type] || TYPE_REGISTRY.task;
}

/** Get parent_id with epic_id fallback for migration compatibility */
export function getParentId(item: { parent_id?: string; epic_id?: string }): string | undefined {
  return item.parent_id || item.epic_id;
}
