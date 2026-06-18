import { describe, it, expect, vi } from 'vitest';
import {
  decidePortCollision,
  createPortCollisionResolver,
  type PortCollisionEffects,
} from '../server/port-collision.js';

/**
 * Port-collision policy: **monotonic newer-wins**. A fresh instance only takes
 * over a strictly-older backlog-mcp; it defers to an equal-or-newer one. This
 * is the invariant that both enables auto-upgrade (newer replaces the
 * long-lived daemon) and prevents the multi-bridge "ping-pong" crash-storm
 * (the loser never fights back).
 */
describe('decidePortCollision', () => {
  it('takes over a strictly older incumbent (the upgrade path)', () => {
    expect(decidePortCollision('0.53.2', '0.53.3', false)).toBe('takeover');
    expect(decidePortCollision('0.53.2', '0.53.3', true)).toBe('takeover');
    expect(decidePortCollision('0.9.0', '1.0.0', false)).toBe('takeover');
  });

  it('defers to an equal-or-newer incumbent (never downgrade, never flap)', () => {
    expect(decidePortCollision('0.53.3', '0.53.3', false)).toBe('defer'); // equal
    expect(decidePortCollision('0.53.3', '0.53.3', true)).toBe('defer');
    expect(decidePortCollision('0.54.0', '0.53.3', false)).toBe('defer'); // newer incumbent
  });

  it('handles an unidentified holder per environment', () => {
    // null = nothing answered /version (not our server, or already dying)
    expect(decidePortCollision(null, '0.53.3', true)).toBe('kill-holder'); // dev: reclaim
    expect(decidePortCollision(null, '0.53.3', false)).toBe('defer');      // prod: stay safe
  });

  it('is anti-symmetric for distinct versions ⇒ no ping-pong', () => {
    const versions = ['0.53.2', '0.53.3', '0.54.0', '1.0.0'];
    for (const a of versions) {
      for (const b of versions) {
        if (a === b) continue;
        const ab = decidePortCollision(a, b, false); // incumbent a, ours b
        const ba = decidePortCollision(b, a, false); // incumbent b, ours a
        // Exactly one orientation takes over; the reverse defers. The loser
        // never retaliates, so two instances can never kill each other's server.
        expect([ab, ba].filter(x => x === 'takeover')).toHaveLength(1);
        expect([ab, ba].filter(x => x === 'defer')).toHaveLength(1);
      }
    }
  });
});

/**
 * The resolver maps a decision to concrete effects. Injected fakes let us
 * assert the orchestration (shutdown→rebind, exit codes, retry budget) with no
 * real process, socket, or filesystem.
 */
function makeEffects(overrides: Partial<PortCollisionEffects> = {}): PortCollisionEffects {
  return {
    getIncumbentVersion: vi.fn(async () => null),
    shutdownIncumbent: vi.fn(async () => {}),
    killPortHolder: vi.fn(async () => false),
    rebind: vi.fn(),
    exit: vi.fn(),
    log: vi.fn(),
    errorLog: vi.fn(),
    fatalSync: vi.fn(),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

const cfg = (over = {}) => ({ port: 3030, ourVersion: '0.53.3', isDevelopment: false, ...over });

describe('createPortCollisionResolver', () => {
  it('takes over an older incumbent: shuts it down and rebinds, never exits', async () => {
    const effects = makeEffects({ getIncumbentVersion: vi.fn(async () => '0.53.2') });
    await createPortCollisionResolver(cfg(), effects)();

    expect(effects.shutdownIncumbent).toHaveBeenCalledWith(3030);
    expect(effects.rebind).toHaveBeenCalledTimes(1);
    expect(effects.exit).not.toHaveBeenCalled();
  });

  it('defers to an equal-or-newer incumbent: exits 0, never rebinds', async () => {
    const effects = makeEffects({ getIncumbentVersion: vi.fn(async () => '0.54.0') });
    await createPortCollisionResolver(cfg(), effects)();

    expect(effects.rebind).not.toHaveBeenCalled();
    expect(effects.shutdownIncumbent).not.toHaveBeenCalled();
    expect(effects.exit).toHaveBeenCalledWith(0);
  });

  it('dev + unidentified holder killed: rebinds', async () => {
    const effects = makeEffects({ killPortHolder: vi.fn(async () => true) });
    await createPortCollisionResolver(cfg({ isDevelopment: true }), effects)();

    expect(effects.killPortHolder).toHaveBeenCalledWith(3030);
    expect(effects.rebind).toHaveBeenCalledTimes(1);
    expect(effects.exit).not.toHaveBeenCalled();
  });

  it('dev + unidentified holder NOT killed: exits 1', async () => {
    const effects = makeEffects({ killPortHolder: vi.fn(async () => false) });
    await createPortCollisionResolver(cfg({ isDevelopment: true }), effects)();

    expect(effects.rebind).not.toHaveBeenCalled();
    expect(effects.exit).toHaveBeenCalledWith(1);
  });

  it('prod + unidentified holder: defers (exit 0), never kills', async () => {
    const effects = makeEffects(); // getIncumbentVersion → null, isDevelopment false
    await createPortCollisionResolver(cfg(), effects)();

    expect(effects.killPortHolder).not.toHaveBeenCalled();
    expect(effects.rebind).not.toHaveBeenCalled();
    expect(effects.exit).toHaveBeenCalledWith(0);
  });

  it('bounds takeover retries: exits 1 once the budget is exhausted', async () => {
    const effects = makeEffects({ getIncumbentVersion: vi.fn(async () => '0.53.2') });
    const resolve = createPortCollisionResolver(cfg({ maxTakeoverAttempts: 2 }), effects);

    await resolve(); // attempt 0 → rebind
    await resolve(); // attempt 1 → rebind
    await resolve(); // attempt 2 → budget exhausted

    expect(effects.rebind).toHaveBeenCalledTimes(2);
    expect(effects.exit).toHaveBeenCalledWith(1);
  });

  it('never goes silent — the takeover and defer branches emit a console line', async () => {
    const older = makeEffects({ getIncumbentVersion: vi.fn(async () => '0.53.2') });
    await createPortCollisionResolver(cfg(), older)();
    expect((older.log as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

    const defer = makeEffects({ getIncumbentVersion: vi.fn(async () => '0.54.0') });
    await createPortCollisionResolver(cfg(), defer)();
    expect((defer.log as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
