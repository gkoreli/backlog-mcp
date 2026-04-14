-- ============================================================================
-- backlog-mcp OAuth refresh-token schema
-- ADR-0092 amendment: rotating refresh tokens with replay detection.
-- ============================================================================

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  grant_types TEXT NOT NULL,
  response_types TEXT,
  scope TEXT,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  scope TEXT,
  resource TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT NOT NULL,
  family_expires_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  replaced_by_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_hash
  ON oauth_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family
  ON oauth_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_client
  ON oauth_refresh_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_subject
  ON oauth_refresh_tokens(subject);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires
  ON oauth_refresh_tokens(expires_at);
