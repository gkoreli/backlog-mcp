import type { Reference } from './substrates/base.js';
import type { Entity } from './substrates/registry.js';

/** Open substrate key resolved through the active project registry. */
export type SubstrateType = string;

/**
 * Transport-free entity projection for declarative runtime substrates.
 *
 * Known cross-substrate fields stay typed. Definition-specific fields remain
 * serializable data and are validated by the active runtime registry.
 */
export interface RuntimeEntity {
  id: string;
  type: SubstrateType;
  title: string;
  content?: string;
  status?: string;
  parent_id?: string;
  references?: Reference[];
  created_at?: string;
  updated_at?: string;
  [field: string]: unknown;
}

/** Entity accepted by generic local core and storage boundaries. */
export type AnyEntity = Entity | RuntimeEntity;
