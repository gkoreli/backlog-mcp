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

export enum EntityType {
  Task = 'task',
  Epic = 'epic',
  Folder = 'folder',
  Artifact = 'artifact',
  Milestone = 'milestone',
}

export const TYPE_REGISTRY: Record<EntityType, TypeConfig> = {
  [EntityType.Task]:      { prefix: 'TASK', label: 'Task',      icon: taskIcon,      gradient: 'linear-gradient(135deg, #00d4ff, #7b2dff)', isContainer: false, hasStatus: true,  extraFields: ['blocked_reason', 'evidence'] },
  [EntityType.Epic]:      { prefix: 'EPIC', label: 'Epic',      icon: epicIcon,      gradient: 'linear-gradient(135deg, #f0b429, #ff6b2d)', isContainer: true,  hasStatus: true },
  [EntityType.Folder]:    { prefix: 'FLDR', label: 'Folder',    icon: folderIcon,    gradient: 'linear-gradient(135deg, #3fb950, #1f883d)', isContainer: true,  hasStatus: false },
  [EntityType.Artifact]:  { prefix: 'ARTF', label: 'Artifact',  icon: artifactIcon,  gradient: 'linear-gradient(135deg, #a371f7, #ff2d7b)', isContainer: false, hasStatus: false, extraFields: ['content_type', 'path'] },
  [EntityType.Milestone]: { prefix: 'MLST', label: 'Milestone', icon: milestoneIcon, gradient: 'linear-gradient(135deg, #f85149, #ff8c00)', isContainer: true,  hasStatus: true,  extraFields: ['due_date'] },
};

export const ENTITY_TYPES = Object.values(EntityType);

function isEntityType(value: string): value is EntityType {
  return value in TYPE_REGISTRY;
}

export function getTypeFromId(id: string): EntityType {
  for (const type of ENTITY_TYPES) {
    if (id.startsWith(TYPE_REGISTRY[type].prefix + '-')) return type;
  }
  return EntityType.Task;
}

export function getTypeConfig(type: string): TypeConfig {
  if (isEntityType(type)) return TYPE_REGISTRY[type];
  return TYPE_REGISTRY[EntityType.Task];
}

/** Get parent_id with epic_id fallback for migration compatibility */
export function getParentId(item: { parent_id?: string; epic_id?: string }): string | undefined {
  return item.parent_id || item.epic_id;
}
