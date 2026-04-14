export function bodyString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function bodyStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

export function formString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string') ?? null;
  return null;
}

export function claimString(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' ? value : undefined;
}

export function combineScopes(...values: Array<string | undefined>): string | undefined {
  const scopes = new Set<string>();
  for (const value of values) {
    for (const scope of (value ?? '').split(/\s+/)) {
      if (scope) scopes.add(scope);
    }
  }
  return scopes.size > 0 ? [...scopes].join(' ') : undefined;
}
