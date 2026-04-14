import {
  createRefreshTokenPolicy,
  DEFAULT_REFRESH_TOKEN_INACTIVITY_SECONDS,
  DEFAULT_REFRESH_TOKEN_MAX_AGE_SECONDS,
  type RefreshTokenPolicy,
} from './policy.js';
import { generateOpaqueToken } from './tokens.js';
import type { OAuthStore } from './oauth-store.js';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  create(): string;
}

export interface TokenGenerator {
  create(prefix?: string): string;
}

export interface AuthRuntime {
  store?: OAuthStore;
  policy: RefreshTokenPolicy;
  clock: Clock;
  ids: IdGenerator;
  tokens: TokenGenerator;
}

export interface AuthRuntimeOptions {
  store?: OAuthStore;
  inactivitySeconds?: number;
  maxAgeSeconds?: number;
  now?: () => Date;
  generateId?: () => string;
  generateToken?: (prefix?: string) => string;
}

export function createAuthRuntime(options: AuthRuntimeOptions = {}): AuthRuntime {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  const generateToken = options.generateToken ?? ((prefix?: string) => generateOpaqueToken(prefix));

  return {
    store: options.store,
    policy: createRefreshTokenPolicy(
      options.inactivitySeconds ?? DEFAULT_REFRESH_TOKEN_INACTIVITY_SECONDS,
      options.maxAgeSeconds ?? DEFAULT_REFRESH_TOKEN_MAX_AGE_SECONDS,
    ),
    clock: { now },
    ids: { create: generateId },
    tokens: { create: generateToken },
  };
}
