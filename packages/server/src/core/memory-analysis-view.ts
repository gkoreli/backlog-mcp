/** Derived complete-corpus observation for one selected home; never a second store. */
import { EntityType, type AnyEntity, type Memory } from '@backlog-mcp/shared';
import { isMemoryLive } from './memory-validity.js';

/** Copied payloads, frozen ordinary records/arrays and private shared indexes at one explicitly supplied time. */
export interface MemoryAnalysisView {
  readonly now: number;
  readonly memories: readonly Readonly<Memory>[];
  readonly live: readonly Readonly<Memory>[];
  readonly stateKeys: readonly string[];
  get(id: string): Readonly<Memory> | undefined;
  holders(stateKey: string): readonly Readonly<Memory>[];
}

function freezePayload(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  // Native YAML dates/binary are detached by structuredClone. Freezing typed
  // arrays throws, and freezing Date/Map would not prevent their mutations.
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezePayload(child);
}

/** Detach native payloads, including dates/binary; later reader mutations cannot alter the observation. */
export function createMemoryAnalysisView(corpus: readonly AnyEntity[], now: number): MemoryAnalysisView {
  const memories = corpus.filter(function isMemory(entity): entity is Memory {
    return entity.type === EntityType.Memory;
  }).map(function observe(memory) {
    const copy = structuredClone(memory);
    freezePayload(copy);
    return copy;
  });
  const byId = new Map(memories.map(function reference(memory) { return [memory.id, memory] as const; }));
  const live = memories.filter(function liveAtObservation(memory) { return isMemoryLive(memory, now); });
  const byKey = new Map<string, Memory[]>();
  for (const memory of live) {
    if (!memory.state_key) continue;
    const holders = byKey.get(memory.state_key);
    if (holders === undefined) byKey.set(memory.state_key, [memory]);
    else holders.push(memory);
  }
  for (const holders of byKey.values()) Object.freeze(holders);
  const empty = Object.freeze([] as Memory[]);
  return Object.freeze({
    now, memories: Object.freeze(memories), live: Object.freeze(live),
    stateKeys: Object.freeze([...byKey.keys()]),
    get: function getMemory(id: string) { return byId.get(id); },
    holders: function keyedHolders(key: string) { return byKey.get(key) ?? empty; },
  });
}
