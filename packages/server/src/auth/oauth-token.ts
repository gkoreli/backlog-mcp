import type { AuthRuntime } from './runtime.js';
import type { AuthEventLogger } from './events.js';
import { b64url, signJWT, verifyJWT } from './jwt.js';
import { canIssueRefreshToken } from './policy.js';
import { hashToken } from './tokens.js';
import { createRefreshRecord, createRefreshRecordFromExisting } from './refresh-records.js';
import { emitAuthEvent } from './events.js';
import { claimString, combineScopes, formString } from './http-params.js';

export interface OAuthTokenDeps {
  clientSecret?: string;
  jwtSecret?: string;
  logAuthEvent?: AuthEventLogger;
}

interface TokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  refresh_token?: string;
}

export async function handleOAuthToken(c: any, deps: OAuthTokenDeps, authRuntime: AuthRuntime) {
  const body = await c.req.parseBody();
  const grantType = formString(body['grant_type']);
  if (!deps.jwtSecret) {
    return c.json({ error: 'server_error', error_description: 'OAuth not configured' }, 500);
  }

  const nowDate = authRuntime.clock.now();
  const now = Math.floor(nowDate.getTime() / 1000);
  const expiresIn = 3600;
  const origin = new URL(c.req.url).origin;

  if (grantType === 'authorization_code') {
    return exchangeAuthorizationCode(c, { authRuntime, body, deps, expiresIn, now, nowDate, origin });
  }

  if (grantType === 'refresh_token') {
    return exchangeRefreshToken(c, { authRuntime, body, deps, expiresIn, now, nowDate, origin });
  }

  if (grantType === 'client_credentials') {
    if (!deps.clientSecret || formString(body['client_secret']) !== deps.clientSecret) {
      return c.json({ error: 'invalid_client' }, 401);
    }
    const accessToken = await signJWT({
      iss: origin, aud: 'backlog-mcp', sub: formString(body['client_id']) || 'backlog-mcp-client',
      iat: now, exp: now + expiresIn, scope: 'mcp',
    }, deps.jwtSecret);
    return c.json({ access_token: accessToken, token_type: 'bearer', expires_in: expiresIn });
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
}

async function exchangeAuthorizationCode(c: any, input: {
  authRuntime: AuthRuntime;
  body: Record<string, unknown>;
  deps: OAuthTokenDeps;
  expiresIn: number;
  now: number;
  nowDate: Date;
  origin: string;
}) {
  const code = formString(input.body['code']);
  const codeVerifier = formString(input.body['code_verifier']);
  const redirectUri = formString(input.body['redirect_uri']);
  const clientId = formString(input.body['client_id']) ?? '';

  if (!code || !codeVerifier || !input.deps.jwtSecret) return c.json({ error: 'invalid_request' }, 400);

  const authCodePayload = await verifyJWT(code, input.deps.jwtSecret);
  if (!authCodePayload || authCodePayload['type'] !== 'auth_code') {
    return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, 400);
  }
  if (authCodePayload['redirect_uri'] !== redirectUri) {
    return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  if (b64url(hash) !== authCodePayload['code_challenge']) {
    return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }

  const authSubject = claimString(authCodePayload, 'auth_subject') ?? (clientId || 'claude');
  const authMethod = claimString(authCodePayload, 'auth_method');
  const requestedScope = claimString(authCodePayload, 'scope');
  const codeClientId = claimString(authCodePayload, 'client_id') ?? clientId;
  if (codeClientId && clientId && codeClientId !== clientId) {
    return c.json({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
  }

  const accessToken = await signJWT({
    iss: input.origin, aud: 'backlog-mcp', sub: authSubject, client_id: codeClientId,
    iat: input.now, exp: input.now + input.expiresIn, scope: 'mcp',
  }, input.deps.jwtSecret);

  const response: TokenResponse = { access_token: accessToken, token_type: 'bearer', expires_in: input.expiresIn };
  if (input.authRuntime.store && codeClientId) {
    const client = await input.authRuntime.store.getClient(codeClientId);
    const eligibilityScope = combineScopes(requestedScope, client?.scope);
    const eligible = canIssueRefreshToken({
      hasStore: true,
      authMethod,
      requestedScope: eligibilityScope,
      client,
      offlineAccessAdvertised: true,
    });
    if (eligible) {
      const rawRefreshToken = input.authRuntime.tokens.create('rt');
      await input.authRuntime.store.createRefreshToken(await createRefreshRecord({
        authRuntime: input.authRuntime,
        clientId: codeClientId,
        subject: authSubject,
        authMethod: authMethod ?? 'unknown',
        scope: eligibilityScope,
        resource: input.origin,
        tokenHash: await hashToken(rawRefreshToken),
        now: input.nowDate,
      }));
      response.refresh_token = rawRefreshToken;
    }
  }

  await emitAuthEvent(input.deps.logAuthEvent, {
    event: 'oauth_token_authorization_code',
    client_id: codeClientId,
    auth_method: authMethod,
    scope: requestedScope ?? null,
    refresh_issued: !!response.refresh_token,
  });

  return c.json(response);
}

async function exchangeRefreshToken(c: any, input: {
  authRuntime: AuthRuntime;
  body: Record<string, unknown>;
  deps: OAuthTokenDeps;
  expiresIn: number;
  now: number;
  nowDate: Date;
  origin: string;
}) {
  if (!input.authRuntime.store) return c.json({ error: 'unsupported_grant_type' }, 400);

  const refreshToken = formString(input.body['refresh_token']);
  const clientId = formString(input.body['client_id']);
  if (!refreshToken || !input.deps.jwtSecret) return c.json({ error: 'invalid_request' }, 400);

  const tokenHash = await hashToken(refreshToken);
  const current = await input.authRuntime.store.getRefreshTokenByHash(tokenHash);
  if (!current || (clientId && current.clientId !== clientId)) {
    await emitAuthEvent(input.deps.logAuthEvent, {
      event: 'oauth_token_refresh',
      client_id_present: !!clientId,
      result: 'invalid_grant',
    });
    return c.json({ error: 'invalid_grant' }, 400);
  }

  const rawReplacement = input.authRuntime.tokens.create('rt');
  const replacement = await createRefreshRecordFromExisting({
    authRuntime: input.authRuntime,
    current,
    tokenHash: await hashToken(rawReplacement),
    now: input.nowDate,
  });
  const rotation = await input.authRuntime.store.rotateRefreshToken({
    tokenHash,
    replacement,
    now: input.nowDate.toISOString(),
  });

  if (rotation.status !== 'rotated') {
    await emitAuthEvent(input.deps.logAuthEvent, {
      event: 'oauth_token_refresh',
      client_id: current.clientId,
      client_id_present: !!clientId,
      result: rotation.status,
    });
    return c.json({ error: 'invalid_grant' }, 400);
  }

  const accessToken = await signJWT({
    iss: input.origin, aud: 'backlog-mcp', sub: rotation.current.subject, client_id: rotation.current.clientId,
    iat: input.now, exp: input.now + input.expiresIn, scope: 'mcp',
  }, input.deps.jwtSecret);

  await emitAuthEvent(input.deps.logAuthEvent, {
    event: 'oauth_token_refresh',
    client_id: rotation.current.clientId,
    client_id_present: !!clientId,
    result: 'rotated',
  });

  return c.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: input.expiresIn,
    refresh_token: rawReplacement,
  });
}
