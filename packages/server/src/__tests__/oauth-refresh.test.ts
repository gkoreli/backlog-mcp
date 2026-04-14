import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../server/hono-app.js';
import { b64url, canIssueRefreshToken, signJWT, type NewRefreshTokenRecord, type OAuthClientRegistration, type OAuthStore, type RefreshTokenRecord, type RotateRefreshTokenInput, type RotateRefreshTokenResult } from '../auth/index.js';
import type { IBacklogService } from '../storage/service-types.js';

function makeService(overrides: Partial<IBacklogService> = {}): IBacklogService {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    getMarkdown: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    counts: vi.fn().mockResolvedValue({ total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} }),
    getMaxId: vi.fn().mockResolvedValue(0),
    searchUnified: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

class InMemoryOAuthStore implements OAuthStore {
  readonly clients = new Map<string, OAuthClientRegistration>();
  readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  async saveClient(registration: OAuthClientRegistration): Promise<void> {
    this.clients.set(registration.clientId, structuredClone(registration));
  }

  async getClient(clientId: string): Promise<OAuthClientRegistration | null> {
    const client = this.clients.get(clientId);
    return client ? structuredClone(client) : null;
  }

  async createRefreshToken(record: NewRefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.tokenHash, structuredClone(record));
  }

  async getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const record = this.refreshTokens.get(tokenHash);
    return record ? structuredClone(record) : null;
  }

  async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult> {
    const record = this.refreshTokens.get(input.tokenHash);
    if (!record) return { status: 'not_found' };
    if (record.revokedAt) return { status: 'revoked', record: structuredClone(record) };
    if (record.rotatedAt) {
      await this.revokeRefreshTokenFamily(record.familyId, 'replay_detected', input.now);
      return { status: 'replayed', record: structuredClone(record) };
    }
    if (record.expiresAt <= input.now || record.familyExpiresAt <= input.now) {
      return { status: 'expired', record: structuredClone(record) };
    }

    record.rotatedAt = input.now;
    record.lastUsedAt = input.now;
    record.replacedById = input.replacement.id;
    this.refreshTokens.set(input.replacement.tokenHash, structuredClone(input.replacement));
    return {
      status: 'rotated',
      previous: structuredClone(record),
      current: structuredClone(input.replacement),
    };
  }

  async revokeRefreshTokenFamily(familyId: string, reason: string, revokedAt: string): Promise<void> {
    for (const record of this.refreshTokens.values()) {
      if (record.familyId === familyId) {
        record.revokedAt ??= revokedAt;
        record.revokedReason ??= reason;
      }
    }
  }
}

function makeIdGenerator(): () => string {
  let id = 0;
  return () => `id-${++id}`;
}

function makeTokenGenerator(): (prefix?: string) => string {
  let id = 0;
  return (prefix = 'tok') => `${prefix}_test-${++id}`;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(hash);
}

async function makeAuthCode(input: {
  jwtSecret: string;
  clientId: string;
  verifier: string;
  redirectUri?: string;
  authMethod?: string;
  authSubject?: string;
  scope?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({
    type: 'auth_code',
    iss: 'http://localhost',
    redirect_uri: input.redirectUri ?? 'https://client.example/callback',
    code_challenge: await pkceChallenge(input.verifier),
    code_challenge_method: 'S256',
    client_id: input.clientId,
    scope: input.scope ?? '',
    auth_subject: input.authSubject ?? 'github:gkoreli',
    auth_method: input.authMethod ?? 'github',
    iat: now,
    exp: now + 300,
  }, input.jwtSecret);
}

async function postToken(app: ReturnType<typeof createApp>, params: Record<string, string>) {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
}

describe('OAuth refresh-token policy', () => {
  it('requires store, GitHub auth, and a refresh-capable signal', () => {
    expect(canIssueRefreshToken({
      hasStore: true,
      authMethod: 'github',
      client: {
        clientId: 'client-1',
        redirectUris: [],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        tokenEndpointAuthMethod: 'none',
        createdAt: new Date().toISOString(),
      },
      offlineAccessAdvertised: false,
    })).toBe(true);

    expect(canIssueRefreshToken({
      hasStore: true,
      authMethod: 'api_key',
      client: null,
      requestedScope: 'offline_access',
      offlineAccessAdvertised: true,
    })).toBe(false);
  });
});

describe('OAuth refresh-token routes', () => {
  const jwtSecret = 'test-jwt-secret';
  const fixedNow = new Date('2026-04-14T12:00:00.000Z');

  it('advertises refresh_token only when an OAuth store is injected', async () => {
    const withoutStore = createApp(makeService(), { jwtSecret });
    const withoutResponse = await withoutStore.request('/.well-known/oauth-authorization-server');
    expect((await withoutResponse.json()).grant_types_supported).not.toContain('refresh_token');

    const withStore = createApp(makeService(), { jwtSecret, oauthStore: new InMemoryOAuthStore() });
    const withResponse = await withStore.request('/.well-known/oauth-authorization-server');
    const metadata = await withResponse.json();
    expect(metadata.grant_types_supported).toContain('refresh_token');
    expect(metadata.scopes_supported).toContain('offline_access');

    const protectedResource = await withStore.request('/.well-known/oauth-protected-resource');
    expect(await protectedResource.json()).not.toHaveProperty('scopes_supported');
  });

  it('persists dynamic client registration and returns requested refresh_token support', async () => {
    const store = new InMemoryOAuthStore();
    const app = createApp(makeService(), {
      jwtSecret,
      oauthStore: store,
      now: () => fixedNow,
      generateId: makeIdGenerator(),
    });

    const response = await app.request('/oauth/register', {
      method: 'POST',
      body: JSON.stringify({
        client_name: 'Test Client',
        redirect_uris: ['https://client.example/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.client_id).toBe('id-1');
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(await store.getClient('id-1')).toMatchObject({
      clientName: 'Test Client',
      grantTypes: ['authorization_code', 'refresh_token'],
    });
  });

  it('issues and rotates refresh tokens for refresh-capable GitHub authorization grants', async () => {
    const store = new InMemoryOAuthStore();
    await store.saveClient({
      clientId: 'client-1',
      redirectUris: ['https://client.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      createdAt: fixedNow.toISOString(),
    });

    const app = createApp(makeService(), {
      jwtSecret,
      oauthStore: store,
      now: () => fixedNow,
      generateId: makeIdGenerator(),
      generateToken: makeTokenGenerator(),
    });

    const verifier = 'verifier-1';
    const code = await makeAuthCode({ jwtSecret, clientId: 'client-1', verifier });
    const tokenResponse = await postToken(app, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'https://client.example/callback',
      client_id: 'client-1',
    });

    expect(tokenResponse.status).toBe(200);
    const tokenBody = await tokenResponse.json();
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.refresh_token).toBe('rt_test-1');

    const refreshResponse = await postToken(app, {
      grant_type: 'refresh_token',
      refresh_token: 'rt_test-1',
      client_id: 'client-1',
    });

    expect(refreshResponse.status).toBe(200);
    const refreshBody = await refreshResponse.json();
    expect(refreshBody.access_token).toBeTruthy();
    expect(refreshBody.refresh_token).toBe('rt_test-2');
  });

  it('does not issue refresh tokens to unregistered clients', async () => {
    const app = createApp(makeService(), {
      jwtSecret,
      oauthStore: new InMemoryOAuthStore(),
      now: () => fixedNow,
      generateId: makeIdGenerator(),
      generateToken: makeTokenGenerator(),
    });

    const verifier = 'verifier-2';
    const code = await makeAuthCode({ jwtSecret, clientId: 'unknown-client', verifier });
    const response = await postToken(app, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'https://client.example/callback',
      client_id: 'unknown-client',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('refresh_token');
  });

  it('revokes the token family when a rotated refresh token is replayed', async () => {
    const store = new InMemoryOAuthStore();
    await store.saveClient({
      clientId: 'client-1',
      redirectUris: ['https://client.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      createdAt: fixedNow.toISOString(),
    });
    const app = createApp(makeService(), {
      jwtSecret,
      oauthStore: store,
      now: () => fixedNow,
      generateId: makeIdGenerator(),
      generateToken: makeTokenGenerator(),
    });

    const verifier = 'verifier-3';
    const code = await makeAuthCode({ jwtSecret, clientId: 'client-1', verifier });
    const tokenResponse = await postToken(app, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'https://client.example/callback',
      client_id: 'client-1',
    });
    const tokenBody = await tokenResponse.json();

    const rotated = await postToken(app, {
      grant_type: 'refresh_token',
      refresh_token: tokenBody.refresh_token,
      client_id: 'client-1',
    });
    const rotatedBody = await rotated.json();

    const replay = await postToken(app, {
      grant_type: 'refresh_token',
      refresh_token: tokenBody.refresh_token,
      client_id: 'client-1',
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: 'invalid_grant' });

    const replacementAfterReplay = await postToken(app, {
      grant_type: 'refresh_token',
      refresh_token: rotatedBody.refresh_token,
      client_id: 'client-1',
    });
    expect(replacementAfterReplay.status).toBe(400);
  });

  it('rejects expired refresh tokens and client-id mismatches', async () => {
    let now = fixedNow;
    const store = new InMemoryOAuthStore();
    await store.saveClient({
      clientId: 'client-1',
      redirectUris: ['https://client.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      createdAt: fixedNow.toISOString(),
    });
    const app = createApp(makeService(), {
      jwtSecret,
      oauthStore: store,
      refreshTokenInactivitySeconds: 1,
      now: () => now,
      generateId: makeIdGenerator(),
      generateToken: makeTokenGenerator(),
    });

    const verifier = 'verifier-4';
    const code = await makeAuthCode({ jwtSecret, clientId: 'client-1', verifier });
    const tokenResponse = await postToken(app, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'https://client.example/callback',
      client_id: 'client-1',
    });
    const tokenBody = await tokenResponse.json();

    const mismatch = await postToken(app, {
      grant_type: 'refresh_token',
      refresh_token: tokenBody.refresh_token,
      client_id: 'other-client',
    });
    expect(mismatch.status).toBe(400);

    now = new Date(fixedNow.getTime() + 2000);
    const expired = await postToken(app, {
      grant_type: 'refresh_token',
      refresh_token: tokenBody.refresh_token,
      client_id: 'client-1',
    });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: 'invalid_grant' });
  });

  it('keeps client_credentials responses unchanged', async () => {
    const app = createApp(makeService(), {
      jwtSecret,
      clientSecret: 'client-secret',
      oauthStore: new InMemoryOAuthStore(),
    });

    const response = await postToken(app, {
      grant_type: 'client_credentials',
      client_id: 'machine-client',
      client_secret: 'client-secret',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access_token).toBeTruthy();
    expect(body).not.toHaveProperty('refresh_token');
  });
});
