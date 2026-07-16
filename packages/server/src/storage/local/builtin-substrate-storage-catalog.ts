import { EntityType, TYPE_PREFIXES } from '@backlog-mcp/shared';
import type {
  SubstrateStorageCatalog,
  SubstrateStorageClaim,
} from '../substrate-storage-catalog.contract.js';

function createStorageClaim(
  type: EntityType,
  folder: string,
): Readonly<SubstrateStorageClaim> {
  const prefix = TYPE_PREFIXES[type];

  return {
    type,
    folder,
    identity: {
      strategy: 'prefixed-number',
      prefix,
      minimumDigits: 4,
      displayTemplate: `${prefix}-{number}`,
    },
  };
}

const BUILTIN_STORAGE_CLAIMS = {
  task: createStorageClaim(EntityType.Task, 'tasks'),
  epic: createStorageClaim(EntityType.Epic, 'epics'),
  folder: createStorageClaim(EntityType.Folder, 'folders'),
  artifact: createStorageClaim(EntityType.Artifact, 'artifacts'),
  milestone: createStorageClaim(EntityType.Milestone, 'milestones'),
  cron: createStorageClaim(EntityType.Cron, 'crons'),
  memory: createStorageClaim(EntityType.Memory, 'memories'),
} satisfies Record<EntityType, Readonly<SubstrateStorageClaim>>;

const STORAGE_CLAIMS_BY_TYPE: Readonly<
  Record<string, Readonly<SubstrateStorageClaim>>
> = BUILTIN_STORAGE_CLAIMS;

/** Storage catalog for the built-in backlog substrates. */
export class BuiltinSubstrateStorageCatalog implements SubstrateStorageCatalog {
  getStorageClaim(type: string): Readonly<SubstrateStorageClaim> | undefined {
    return STORAGE_CLAIMS_BY_TYPE[type];
  }
}
