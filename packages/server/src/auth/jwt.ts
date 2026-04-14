// Web Crypto JWT helpers. Portable across Node.js, Workers, Bun, and Deno.

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function b64urlDecode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const key = await hmacKey(secret, 'sign');
  const sig = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(input)));
  return `${input}.${sig}`;
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [h, p, s] = parts as [string, string, string];
  const key = await hmacKey(secret, 'verify');
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
