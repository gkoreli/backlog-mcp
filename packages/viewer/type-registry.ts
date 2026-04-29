/**
 * type-registry.ts — Viewer UI extension on top of shared SUBSTRATES.
 *
 * The canonical substrate registry lives in `@backlog-mcp/shared`. This module
 * augments it with viewer-only concerns (icon assets, which require esbuild's
 * file loader and can't live in shared).
 *
 * Prefix, label, gradient, isContainer, hasStatus, extraFields, opensInPane
 * all come from the shared substrate — single source of truth.
 */
import { EntityType, SUBSTRATES } from '@backlog-mcp/shared';
import { taskIcon, epicIcon, folderIcon, artifactIcon, milestoneIcon, cronIcon } from './icons/index.js';

const ICONS: Record<EntityType, string> = {
  [EntityType.Task]: taskIcon,
  [EntityType.Epic]: epicIcon,
  [EntityType.Folder]: folderIcon,
  [EntityType.Artifact]: artifactIcon,
  [EntityType.Milestone]: milestoneIcon,
  [EntityType.Cron]: cronIcon,
};

export interface TypeConfig {
  prefix: string;
  label: string;
  icon: string;
  gradient: string;
  isContainer: boolean;
  hasStatus: boolean;
  opensInPane?: boolean;
  extraFields?: string[];
}

/** Build the viewer-local registry by composing shared substrate data with icons. */
export const TYPE_REGISTRY: Record<EntityType, TypeConfig> = Object.fromEntries(
  (Object.keys(SUBSTRATES) as EntityType[]).map(type => {
    const s = SUBSTRATES[type];
    const ui = s.ui as { gradient: string; opensInPane?: boolean };
    const config: TypeConfig = {
      prefix: s.prefix,
      label: s.label,
      icon: ICONS[type],
      gradient: ui.gradient,
      isContainer: s.structure.isContainer,
      hasStatus: s.structure.hasStatus,
      extraFields: [...s.extraFields],
    };
    if (ui.opensInPane) config.opensInPane = true;
    return [type, config];
  }),
) as Record<EntityType, TypeConfig>;

function isEntityType(value: string): value is EntityType {
  return value in TYPE_REGISTRY;
}

export function getTypeConfig(type: string): TypeConfig {
  if (isEntityType(type)) return TYPE_REGISTRY[type];
  return TYPE_REGISTRY[EntityType.Task];
}

/** Get parent_id with epic_id fallback for migration compatibility */
export function getParentId(item: { parent_id?: string; epic_id?: string }): string | undefined {
  return item.parent_id || item.epic_id;
}
