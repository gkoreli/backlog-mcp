import type { Hono } from 'hono';
import { verifyJWT } from './jwt.js';

export interface McpAuthOptions {
  apiKey?: string;
  jwtSecret?: string;
}

export function registerMcpAuthMiddleware(app: Hono, options: McpAuthOptions): void {
  const requireMcpAuth = async (c: any, next: any) => {
    if (!options.apiKey && !options.jwtSecret) return next();

    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return unauthorized(c);

    if (options.jwtSecret) {
      const payload = await verifyJWT(token, options.jwtSecret);
      if (payload) return next();
    }
    if (options.apiKey && token === options.apiKey) return next();

    return unauthorized(c);
  };

  app.use('/mcp', requireMcpAuth);
  app.use('/mcp/*', requireMcpAuth);
}

function unauthorized(c: any) {
  const origin = new URL(c.req.url).origin;
  c.header('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
  return c.json({ error: 'Unauthorized' }, 401);
}
