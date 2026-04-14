import type { OAuthClientRegistration } from './oauth-store.js';

export const DEFAULT_REFRESH_TOKEN_INACTIVITY_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_REFRESH_TOKEN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export interface RefreshTokenPolicy {
  inactivitySeconds: number;
  maxAgeSeconds: number;
}

export interface RefreshEligibilityInput {
  hasStore: boolean;
  authMethod?: string;
  requestedScope?: string;
  client?: OAuthClientRegistration | null;
  offlineAccessAdvertised: boolean;
}

export function createRefreshTokenPolicy(
  inactivitySeconds = DEFAULT_REFRESH_TOKEN_INACTIVITY_SECONDS,
  maxAgeSeconds = DEFAULT_REFRESH_TOKEN_MAX_AGE_SECONDS,
): RefreshTokenPolicy {
  return { inactivitySeconds, maxAgeSeconds };
}

export function supportsRefreshTokens(hasStore: boolean): boolean {
  return hasStore;
}

export function canIssueRefreshToken(input: RefreshEligibilityInput): boolean {
  if (!input.hasStore) return false;
  if (input.authMethod !== 'github') return false;

  if (!input.client) return false;
  const grantTypes = input.client?.grantTypes ?? [];
  if (grantTypes.includes('refresh_token')) return true;

  const scopes = new Set((input.requestedScope ?? '').split(/\s+/).filter(Boolean));
  return input.offlineAccessAdvertised && scopes.has('offline_access');
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
