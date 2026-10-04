/** Shared projection preserves selected readers and strips write authority (ADR 0136). */
import { describe, expect, it, vi } from 'vitest';
import { createHomeReadRuntime } from '../composition/home-read-runtime.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';

const home: BacklogHome = { kind: 'project', root: '/selected', id: '/selected', documentsDir: '/selected/docs', controlDir: '/selected/.backlog' };
const service = {} as IBacklogService;

describe('home read capability projection', function readProjection() {
  it('uses explicit readers even when their result is absent', function retainsCallerReaders() {
    const readIdentity = vi.fn(function empty() { return undefined; });
    const readVision = vi.fn(function vision() { return 'Explicit vision'; });
    const readLocalFile = vi.fn(function other() { return 'Another identity'; });
    const runtime = createHomeReadRuntime({ home, service, readIdentity, readVision, readLocalFile, identityPath: '/selected/docs/identity.md', visionPath: '/selected/docs/NORTH-STAR.md' });
    expect(runtime.readIdentity?.()).toBeUndefined();
    expect(runtime.readVision?.()).toBe('Explicit vision');
    expect(readLocalFile).not.toHaveBeenCalled();
  });
  it('only reads explicit paths through the provided capability and preserves receiver binding', function projectsLocalReaders() {
    const readLocalFile = vi.fn(function read(path: string) { return path.endsWith('identity.md') ? '  Selected identity\n' : ' \n'; });
    const registry = { allowed: 'review', acceptsParent(type: string) { return type === this.allowed; } };
    const logger = { entries: [], read() { return this.entries; } };
    const source = { home, service, readLocalFile, identityPath: '/selected/docs/identity.md', visionPath: '/selected/docs/NORTH-STAR.md', substrateRegistry: registry, operationLogger: logger, actor: { type: 'agent' as const, name: 'writer' }, scopeRoot: 'FOLDER-1' };
    const runtime = createHomeReadRuntime(source);
    expect(runtime.readIdentity?.()).toBe('Selected identity');
    expect(runtime.readVision?.()).toBeUndefined();
    expect(readLocalFile.mock.calls).toEqual([['/selected/docs/identity.md'], ['/selected/docs/NORTH-STAR.md']]);
    expect(runtime.acceptsParent?.('review')).toBe(true);
    expect(runtime.readOperations?.({ limit: 2 })).toBe(logger.entries);
    expect(runtime).not.toHaveProperty('actor');
    expect(runtime).not.toHaveProperty('scopeRoot');
    expect(createHomeReadRuntime({ home, service, readLocalFile }).readIdentity).toBeUndefined();
  });
  it('requires the already-selected home', function noAmbientHome() {
    expect(function missingHome() { createHomeReadRuntime({ service }); }).toThrow('Cross-home reads require a docs-native local runtime');
  });
});
