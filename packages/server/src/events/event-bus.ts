import type { MutationNotice } from '../core/operation-log.contract.js';
/**
 * EventBus interface and event types for real-time viewer updates.
 *
 * The interface is designed to be pluggable: start with in-process
 * EventEmitter (LocalEventBus), swap to Redis Pub/Sub or NATS
 * for cloud deployment without changing consumers.
 */

export type BacklogEventType = MutationNotice['type'];

export interface BacklogEvent extends MutationNotice {
  seq: number;
}

export type BacklogEventCallback = (event: BacklogEvent) => void;

export interface EventBus {
  emit(event: Omit<BacklogEvent, 'seq'>): void;
  subscribe(callback: BacklogEventCallback): void;
  unsubscribe(callback: BacklogEventCallback): void;
  replaySince(seq: number): BacklogEvent[];
}
