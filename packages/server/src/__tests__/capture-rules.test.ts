/**
 * Tests for memory capture rules (ADR 0092.2 §D6).
 *
 * The predicates are trivial; the test table is the documentation.
 * Every transition is covered so a future refactor can't regress the
 * rule without tripping a test.
 */
import { describe, it, expect } from 'vitest';
import type { Entity, Status } from '@backlog-mcp/shared';
import { shouldCaptureCompletion, shouldCaptureArtifact } from '../memory/capture-rules.js';

function task(status: Status, type: 'task' | 'epic' = 'task'): Entity {
  return {
    id: 'TASK-0001',
    title: 't',
    type,
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Entity;
}

function artifact(): Entity {
  return {
    id: 'ARTF-0001',
    title: 'a',
    type: 'artifact',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Entity;
}

describe('shouldCaptureCompletion', () => {
  const statuses: Status[] = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];

  for (const prev of statuses) {
    for (const next of statuses) {
      const expected = next === 'done' && prev !== 'done';
      it(`${prev} → ${next}: ${expected ? 'capture' : 'skip'}`, () => {
        expect(shouldCaptureCompletion(task(prev), task(next))).toBe(expected);
      });
    }
  }

  it('captures regardless of entity type (an epic marked done is still a completion)', () => {
    expect(shouldCaptureCompletion(task('in_progress', 'epic'), task('done', 'epic'))).toBe(true);
  });
});

describe('shouldCaptureArtifact', () => {
  it('captures when type is artifact', () => {
    expect(shouldCaptureArtifact(artifact())).toBe(true);
  });

  it('does not capture for tasks, epics, folders, etc.', () => {
    expect(shouldCaptureArtifact(task('open'))).toBe(false);
    expect(shouldCaptureArtifact(task('open', 'epic'))).toBe(false);
  });
});
