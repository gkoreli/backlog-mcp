import type { Hono } from 'hono';
import { GitHub } from 'arctic';
import type { AuthRuntime } from './runtime.js';
import { signJWT, verifyJWT } from './jwt.js';
import { authErrorPage, renderAuthorizePage } from './oauth-pages.js';
import { emitAuthEvent, redirectOrigin, type AuthEventLogger } from './events.js';
import { bodyString, bodyStringArray } from './http-params.js';
import { handleOAuthToken } from './oauth-token.js';

export interface OAuthRouteDeps {
  apiKey?: string;
  clientSecret?: string;
  jwtSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  allowedGithubUsernames?: string;
  logAuthEvent?: AuthEventLogger;
}

export function registerOAuthRoutes(app: Hono, deps: OAuthRouteDeps, authRuntime: AuthRuntime): void {
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const origin = new URL(c.req.url).origin;
    const refreshSupported = !!authRuntime.store;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      grant_types_supported: refreshSupported
        ? ['authorization_code', 'client_credentials', 'refresh_token']
        : ['authorization_code', 'client_credentials'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      scopes_supported: refreshSupported ? ['mcp', 'offline_access'] : ['mcp'],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      resource: origin,
      authorization_servers: [origin],
    });
  });

  app.post('/oauth/register', async (c) => {
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { /* empty body is fine */ }

    const redirectUris = bodyStringArray(body['redirect_uris']);
    const requestedGrantTypes = bodyStringArray(body['grant_types']);
    const responseTypes = bodyStringArray(body['response_types']);
    const grantTypes = ['authorization_code'];
    if (authRuntime.store && requestedGrantTypes.includes('refresh_token')) {
      grantTypes.push('refresh_token');
    }

    const clientId = authRuntime.ids.create();
    const now = authRuntime.clock.now();
    const tokenEndpointAuthMethod = bodyString(body['token_endpoint_auth_method']) ?? 'none';
    const clientName = bodyString(body['client_name']);
    const scope = bodyString(body['scope']);
    const issuedResponseTypes = responseTypes.length > 0 ? responseTypes : ['code'];

    if (authRuntime.store) {
      await authRuntime.store.saveClient({
        clientId,
        clientName: clientName ?? undefined,
        redirectUris,
        grantTypes,
        responseTypes: issuedResponseTypes,
        scope: scope ?? undefined,
        tokenEndpointAuthMethod,
        createdAt: now.toISOString(),
      });
    }

    await emitAuthEvent(deps.logAuthEvent, {
      event: 'oauth_register',
      client_id: clientId,
      client_name: clientName,
      requested_grant_types: requestedGrantTypes,
      issued_grant_types: grantTypes,
      response_types: issuedResponseTypes,
      scope,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      redirect_origins: redirectUris.map(redirectOrigin),
      refresh_supported: !!authRuntime.store,
    });

    return c.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: issuedResponseTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      code_challenge_method: 'S256',
      ...(scope ? { scope } : {}),
    }, 201);
  });

  app.get('/authorize', async (c) => {
    const githubEnabled = !!(deps.githubClientId && deps.githubClientSecret);
    const q = (name: string) => c.req.query(name) ?? '';

    await emitAuthEvent(deps.logAuthEvent, {
      event: 'oauth_authorize',
      client_id: q('client_id'),
      redirect_origin: redirectOrigin(q('redirect_uri')),
      scope: q('scope') || null,
      code_challenge_method: q('code_challenge_method') || null,
      github_enabled: githubEnabled,
      api_key_enabled: !!deps.apiKey,
    });

    const oauthParams = new URLSearchParams({
      response_type: q('response_type'),
      client_id: q('client_id'),
      redirect_uri: q('redirect_uri'),
      code_challenge: q('code_challenge'),
      code_challenge_method: q('code_challenge_method'),
      state: q('state'),
      scope: q('scope'),
    }).toString();

    return c.html(renderAuthorizePage({
      clientId: q('client_id'),
      error: c.req.query('error'),
      githubEnabled,
      apiKeyEnabled: !!deps.apiKey,
      oauthParams,
      formValues: {
        responseType: q('response_type'),
        clientId: q('client_id'),
        redirectUri: q('redirect_uri'),
        codeChallenge: q('code_challenge'),
        codeChallengeMethod: q('code_challenge_method'),
        state: q('state'),
        scope: q('scope'),
      },
    }));
  });

  app.get('/oauth/github/start', async (c) => {
    if (!deps.githubClientId || !deps.githubClientSecret || !deps.jwtSecret) {
      return c.html(authErrorPage('GitHub OAuth is not configured on this server.'), 500);
    }

    const q = (name: string) => c.req.query(name) ?? '';
    const redirectUri = q('redirect_uri');
    if (!redirectUri) {
      return c.html(authErrorPage('Missing redirect_uri. Please initiate authorization from your MCP client (e.g. Claude.ai) rather than opening this page directly.'), 400);
    }

    const origin = new URL(c.req.url).origin;
    const now = Math.floor(Date.now() / 1000);
    const stateToken = await signJWT({
      type: 'github_state',
      redirect_uri: q('redirect_uri'),
      code_challenge: q('code_challenge'),
      code_challenge_method: q('code_challenge_method'),
      client_state: q('state'),
      client_id: q('client_id'),
      scope: q('scope'),
      iat: now,
      exp: now + 600,
    }, deps.jwtSecret);
    const github = new GitHub(deps.githubClientId, deps.githubClientSecret, `${origin}/oauth/github/callback`);
    return c.redirect(github.createAuthorizationURL(stateToken, []).toString());
  });

  app.get('/oauth/github/callback', async (c) => {
    if (!deps.githubClientId || !deps.githubClientSecret || !deps.jwtSecret) {
      return c.html(authErrorPage('GitHub OAuth is not configured on this server.'), 500);
    }

    const code = c.req.query('code');
    const stateParam = c.req.query('state');
    const errorParam = c.req.query('error');

    if (errorParam) return c.html(authErrorPage(`GitHub denied access: ${errorParam}`), 400);
    if (!code || !stateParam) return c.html(authErrorPage('Missing code or state from GitHub callback.'), 400);

    const statePayload = await verifyJWT(stateParam, deps.jwtSecret);
    if (!statePayload || statePayload['type'] !== 'github_state') {
      return c.html(authErrorPage('Invalid or expired state. Please start the authorization flow again.'), 400);
    }

    const origin = new URL(c.req.url).origin;
    const github = new GitHub(deps.githubClientId, deps.githubClientSecret, `${origin}/oauth/github/callback`);
    let githubAccessToken: string;
    try {
      const tokens = await github.validateAuthorizationCode(code);
      githubAccessToken = tokens.accessToken();
    } catch {
      return c.html(authErrorPage('Failed to exchange authorization code with GitHub. Please try again.'), 400);
    }

    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        'User-Agent': 'backlog-mcp',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!userResp.ok) return c.html(authErrorPage('Failed to fetch GitHub user info. Please try again.'), 502);

    const ghUser = await userResp.json() as { login: string };
    const allowed = (deps.allowedGithubUsernames ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length === 0 || !allowed.includes(ghUser.login.toLowerCase())) {
      return c.html(authErrorPage(`GitHub account "${ghUser.login}" is not authorized to access this server.`), 403);
    }

    const now = Math.floor(Date.now() / 1000);
    const authCode = await signJWT({
      type: 'auth_code',
      iss: origin,
      redirect_uri: statePayload['redirect_uri'] as string,
      code_challenge: statePayload['code_challenge'] as string,
      code_challenge_method: statePayload['code_challenge_method'] as string,
      client_id: statePayload['client_id'] as string,
      scope: statePayload['scope'] as string,
      auth_subject: `github:${ghUser.login.toLowerCase()}`,
      auth_method: 'github',
      iat: now,
      exp: now + 300,
    }, deps.jwtSecret);

    const callbackUrl = new URL(statePayload['redirect_uri'] as string);
    callbackUrl.searchParams.set('code', authCode);
    if (statePayload['client_state']) callbackUrl.searchParams.set('state', statePayload['client_state'] as string);
    return c.redirect(callbackUrl.toString());
  });

  app.post('/authorize', async (c) => {
    const body = await c.req.parseBody();
    if (!deps.apiKey || !deps.jwtSecret) {
      return c.json({ error: 'server_error', error_description: 'Auth not configured' }, 500);
    }

    if (body['password'] !== deps.apiKey) {
      const params = new URLSearchParams({
        response_type: body['response_type'] as string || '',
        client_id: body['client_id'] as string || '',
        redirect_uri: body['redirect_uri'] as string || '',
        code_challenge: body['code_challenge'] as string || '',
        code_challenge_method: body['code_challenge_method'] as string || '',
        state: body['state'] as string || '',
        scope: body['scope'] as string || '',
        error: '1',
      });
      return c.redirect(`/authorize?${params}`);
    }

    const redirectUri = body['redirect_uri'] as string;
    const state = body['state'] as string;
    const now = Math.floor(Date.now() / 1000);
    const authCode = await signJWT({
      type: 'auth_code',
      iss: new URL(c.req.url).origin,
      redirect_uri: redirectUri,
      code_challenge: body['code_challenge'] as string,
      code_challenge_method: body['code_challenge_method'] as string,
      client_id: body['client_id'] as string || '',
      scope: body['scope'] as string || '',
      auth_subject: 'api_key',
      auth_method: 'api_key',
      iat: now,
      exp: now + 300,
    }, deps.jwtSecret);

    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set('code', authCode);
    if (state) callbackUrl.searchParams.set('state', state);
    return c.redirect(callbackUrl.toString());
  });

  app.post('/oauth/token', (c) => handleOAuthToken(c, deps, authRuntime));
}
