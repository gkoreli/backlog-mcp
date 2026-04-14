import { b64url } from './jwt.js';

export function generateOpaqueToken(prefix = 'rt'): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}_${b64url(bytes)}`;
}

export async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return b64url(hash);
}
