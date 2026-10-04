/** Lossless read policy: malformed expiry stays visible and is diagnosable. */
export interface MemoryValidity {
  state: 'unbounded' | 'live' | 'expired' | 'invalid';
  expiresAt?: number;
}

/** An expiry at the operation time is expired; invalid dates never become NaN entries. */
export function memoryValidity(value: string | null | undefined, now: number): MemoryValidity {
  if (value === undefined || value === null || value === '') return { state: 'unbounded' };
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt)) return { state: 'invalid' };
  return { state: expiresAt > now ? 'live' : 'expired', expiresAt };
}

/** Invalid native frontmatter remains discoverable, like unbounded memory. */
export function isMemoryLive(memory: { valid_until?: string | null }, now: number): boolean {
  return memoryValidity(memory.valid_until, now).state !== 'expired';
}
