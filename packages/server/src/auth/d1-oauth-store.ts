import type {
  NewRefreshTokenRecord,
  OAuthClientRegistration,
  OAuthStore,
  RefreshTokenRecord,
  RotateRefreshTokenInput,
  RotateRefreshTokenResult,
} from './oauth-store.js';

interface D1Result {
  success: boolean;
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface OAuthClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  grant_types: string;
  response_types: string | null;
  scope: string | null;
  token_endpoint_auth_method: string;
  created_at: string;
  expires_at: string | null;
}

interface RefreshTokenRow {
  id: string;
  family_id: string;
  client_id: string;
  subject: string;
  auth_method: string;
  scope: string | null;
  resource: string | null;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  family_expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  replaced_by_id: string | null;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function clientFromRow(row: OAuthClientRow): OAuthClientRegistration {
  return {
    clientId: row.client_id,
    clientName: row.client_name ?? undefined,
    redirectUris: parseJsonArray(row.redirect_uris),
    grantTypes: parseJsonArray(row.grant_types),
    responseTypes: parseJsonArray(row.response_types),
    scope: row.scope ?? undefined,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function refreshFromRow(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    clientId: row.client_id,
    subject: row.subject,
    authMethod: row.auth_method,
    scope: row.scope ?? undefined,
    resource: row.resource ?? undefined,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
    expiresAt: row.expires_at,
    familyExpiresAt: row.family_expires_at,
    rotatedAt: row.rotated_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedReason: row.revoked_reason ?? undefined,
    replacedById: row.replaced_by_id ?? undefined,
  };
}

export class D1OAuthStore implements OAuthStore {
  constructor(private readonly db: D1Database) {}

  async saveClient(registration: OAuthClientRegistration): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_clients
          (client_id, client_name, redirect_uris, grant_types, response_types, scope,
           token_endpoint_auth_method, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        registration.clientId,
        registration.clientName ?? null,
        JSON.stringify(registration.redirectUris),
        JSON.stringify(registration.grantTypes),
        JSON.stringify(registration.responseTypes),
        registration.scope ?? null,
        registration.tokenEndpointAuthMethod,
        registration.createdAt,
        registration.expiresAt ?? null,
      )
      .run();
  }

  async getClient(clientId: string): Promise<OAuthClientRegistration | null> {
    const row = await this.db
      .prepare('SELECT * FROM oauth_clients WHERE client_id = ? LIMIT 1')
      .bind(clientId)
      .first<OAuthClientRow>();
    return row ? clientFromRow(row) : null;
  }

  async createRefreshToken(record: NewRefreshTokenRecord): Promise<void> {
    await this.insertRefreshToken(record);
  }

  async getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ? LIMIT 1')
      .bind(tokenHash)
      .first<RefreshTokenRow>();
    return row ? refreshFromRow(row) : null;
  }

  async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult> {
    const record = await this.getRefreshTokenByHash(input.tokenHash);
    if (!record) return { status: 'not_found' };
    if (record.revokedAt) return { status: 'revoked', record };
    if (record.rotatedAt) {
      await this.revokeRefreshTokenFamily(record.familyId, 'replay_detected', input.now);
      return { status: 'replayed', record };
    }
    if (record.expiresAt <= input.now || record.familyExpiresAt <= input.now) {
      return { status: 'expired', record };
    }

    const update = await this.db
      .prepare(
        `UPDATE oauth_refresh_tokens
         SET rotated_at = ?, last_used_at = ?, replaced_by_id = ?
         WHERE id = ? AND rotated_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(input.now, input.now, input.replacement.id, record.id)
      .run();

    if (typeof update.meta?.changes === 'number' && update.meta.changes < 1) {
      return { status: 'failed', record };
    }

    await this.insertRefreshToken(input.replacement);
    return { status: 'rotated', previous: record, current: input.replacement };
  }

  async revokeRefreshTokenFamily(familyId: string, reason: string, revokedAt: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE oauth_refresh_tokens
         SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, ?)
         WHERE family_id = ?`,
      )
      .bind(revokedAt, reason, familyId)
      .run();
  }

  private async insertRefreshToken(record: NewRefreshTokenRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_refresh_tokens
          (id, family_id, client_id, subject, auth_method, scope, resource, token_hash,
           created_at, last_used_at, expires_at, family_expires_at, rotated_at, revoked_at,
           revoked_reason, replaced_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.familyId,
        record.clientId,
        record.subject,
        record.authMethod,
        record.scope ?? null,
        record.resource ?? null,
        record.tokenHash,
        record.createdAt,
        record.lastUsedAt ?? null,
        record.expiresAt,
        record.familyExpiresAt,
        record.rotatedAt ?? null,
        record.revokedAt ?? null,
        record.revokedReason ?? null,
        record.replacedById ?? null,
      )
      .run();
  }
}
