---
title: "Remote Auth Architecture — GitHub OAuth + PKCE + JWT Access Tokens"
date: 2026-04-03
status: Accepted, amended 2026-04-14
---

# 0092. Remote Auth Architecture — GitHub OAuth + PKCE + JWT Access Tokens

## Context

The cloud deployment (`backlog-mcp.gogakoreli.workers.dev`) is a real product endpoint,
not a personal tool. Any MCP client that can reach the URL can attempt to connect.
Three distinct client types need to authenticate:

| Client | Flow |
|--------|------|
| Claude.ai web connector | OAuth 2.0 Authorization Code + PKCE |
| Claude Desktop | Direct Bearer token (API key) |
| ChatGPT | OAuth 2.0 Authorization Code + PKCE + Dynamic Client Registration |

The server runs on Cloudflare Workers — stateless, no persistent memory between requests,
no Redis, no KV (free tier). Any auth mechanism must work without server-side session storage.

---

## Decision

### 1. Two auth paths, unified token format

**GitHub OAuth** (primary): the user authenticates with GitHub; the server checks their
username against a hardcoded allowlist (`gkoreli`, `gogakoreli`). Any unauthorized GitHub
account is rejected at the callback before a token is ever issued.

**API key** (fallback): a shared secret set via the `API_KEY` env var. Accepted as a direct
`Bearer <key>` header. Shown as a form on the auth page alongside the GitHub button.

Both paths issue the same access token format — a signed HS256 JWT — so the MCP middleware
has a single verification path.

### 2. Stateless JWT everywhere — no storage needed

Three token types, all signed with `JWT_SECRET` via Web Crypto API (`crypto.subtle`):

| Token | `type` claim | TTL | Purpose |
|-------|-------------|-----|---------|
| GitHub state | `github_state` | 10 min | CSRF protection + carry OAuth params across GitHub redirect |
| Auth code | `auth_code` | 5 min | Short-lived code exchanged at `/oauth/token` |
| Access token | (standard) | 1 hr | Bearer token accepted by `/mcp/*` middleware |

The state JWT is the key insight: GitHub redirects back with the state param intact, so we
recover the original `redirect_uri`, `code_challenge`, and `client_state` without any
server-side storage. Works perfectly on stateless Workers.

### 3. PKCE (S256) — replaces client_secret for public clients

All OAuth flows use `code_challenge` / `code_verifier` (SHA-256, base64url). The token
endpoint verifies `SHA256(verifier) == challenge` before issuing an access token. This
proves the entity exchanging the code is the same one that started the flow, without
needing a stored client secret.

### 4. Auth landing page — user chooses, not auto-redirect

`GET /authorize` always renders an HTML page with:
- "Sign in with GitHub" button (links to `/oauth/github/start?<oauth-params>`)
- API key form (if `API_KEY` is configured)

The GitHub redirect is at `/oauth/github/start` (separate route). This preserves the
option for API key auth and avoids surprising users with an immediate GitHub redirect.

### 5. arctic v3 — battle-tested GitHub OAuth client

`arctic` (v3.7.0) handles the GitHub authorization URL construction and authorization code
exchange. It uses Web Crypto + fetch internally — works on Cloudflare Workers without
Node.js polyfills. We do not implement the OAuth client exchange ourselves.

### 6. ChatGPT compliance — DCR + protected resource metadata

Two additional endpoints for RFC compliance:

**`GET /.well-known/oauth-protected-resource`** (RFC 9728): required by ChatGPT to discover
which authorization server protects the MCP resource. Returns:
```json
{ "resource": "<origin>", "authorization_servers": ["<origin>"] }
```

**`POST /oauth/register`** (RFC 7591 Dynamic Client Registration): ChatGPT registers a
client before starting OAuth. Returns a random `client_id` UUID. Stateless — the `client_id`
is not stored or validated later. Security comes from PKCE + GitHub username allowlist, not
client identity.

**`registration_endpoint`** added to `/.well-known/oauth-authorization-server` so clients
that read discovery first also find DCR.

Without these, ChatGPT falls back to "User-Defined OAuth Client" mode, requiring the user
to manually supply credentials — an unacceptable UX for a product.

---

## Why not full DCR storage?

Storing client registrations in D1 and validating `client_id` on `/authorize` would add:

- A D1 schema migration
- A write on every registration
- A read on every authorization request
- A cleanup job for stale registrations

Security gain: blocks auth flows from unknown `client_id`s. In practice, the only entity
hitting `/authorize` is a MCP client controlled by you. Even if a rogue party obtained a
`client_id`, they still must pass PKCE verification (they don't have the `code_verifier`)
and the GitHub username check (they're not in the allowlist). Zero marginal security gain.

Full DCR storage is the right call if this becomes multi-tenant (different users, different
access scopes). Until then, stateless DCR is correct.

---

## Why not refresh tokens?

Access tokens expire in 1 hour. Refresh tokens were discussed but not implemented. The
tradeoff: refresh tokens require a revocation story (storage + lookup), otherwise a stolen
refresh token is valid indefinitely. On a stateless Worker with no KV, revocation means D1
writes on every refresh — more complexity than the 1-hour forced re-auth is worth for a
single-owner tool. Revisit if users report frequent session interruptions.

This section is preserved as the original 2026-04-03 decision. The 2026-04-14 amendment
below supersedes it because the daily re-authentication cost became the larger product and
operational problem.

---

## Amendment 2026-04-14: Refresh Token Gap

### Problem

Users now report the exact failure mode this ADR deferred: once the MCP client's access
token expires, the server has no refresh-token grant, no durable grant record, and no way
to mint a new access token without sending the user through GitHub OAuth again. In practice,
this makes remote MCP auth feel like a daily re-authentication chore even though the user
has already granted access.

The original "stateless JWT everywhere" decision solved Workers deployment simplicity, but
it also made the authorization grant ephemeral. The access token is a 1-hour JWT and the
token response contains only:

```json
{ "access_token": "...", "token_type": "bearer", "expires_in": 3600 }
```

There is no `refresh_token`, `/oauth/token` does not accept `grant_type=refresh_token`,
and OAuth metadata does not advertise refresh-token support.

### Current Implementation Findings

- `hono-app.ts` sets `expiresIn = 3600` for both authorization-code and client-credentials
  access tokens.
- `/oauth/token` supports only `authorization_code` and `client_credentials`.
- `/.well-known/oauth-authorization-server` advertises only those two grants.
- `/oauth/register` always returns `grant_types: ['authorization_code']` and discards the
  client metadata immediately, so the server cannot later tell whether a client registered
  refresh-token capability.
- GitHub OAuth proves the allowed GitHub username at callback time, but the issued
  `auth_code` JWT does not carry the GitHub subject forward. The final access token uses
  the client id as `sub`, not `github:<login>`. A refresh implementation needs a durable
  grant subject.
- D1 is already available in cloud mode and already stores tasks plus operations, so the
  previous "no persistence" constraint is no longer absolute. The right persistence scope
  is a narrow auth table, not a general session store.

### Source Code Research

Current auth is concentrated in one file:

| File | Current behavior | Refresh-token implication |
|------|------------------|---------------------------|
| `packages/server/src/server/hono-app.ts` | Owns auth middleware, OAuth metadata, DCR, authorize page, GitHub start/callback, API-key authorize POST, token endpoint, and private JWT helpers | This file is the route owner, but adding refresh grants directly here would make it too large. Extract token helpers and persistence behind small auth modules. |
| `packages/server/src/worker-entry.ts` | Creates `D1BacklogService` and `D1OperationLog`, injects env secrets and `db` into `createApp()` | Cloud mode is the right place to construct a `D1OAuthStore` and pass it as an explicit dependency. |
| `packages/server/src/node-server.ts` | Calls `createApp()` without auth deps; `hono-app.ts` falls back to `process.env` | Local mode can keep existing behavior. Refresh-token support should be optional and enabled only when an auth store is injected. |
| `packages/server/migrations/0001_initial.sql` | Defines only `tasks`, `tasks_fts`, and `operations` | Add a new migration for OAuth clients and refresh-token grants; do not mix auth state into task or operation tables. |
| `packages/server/src/storage/d1-adapter.ts` and `packages/server/src/operations/d1-operation-log.ts` | Each defines a minimal local D1 interface to avoid Workers type dependencies | Follow the same pattern for `D1OAuthStore`; do not add `@cloudflare/workers-types` just for auth. |
| `packages/server/src/__tests__/viewer-routes.test.ts` | Tests `createApp()` directly with fake `IBacklogService` | Add auth route tests at the `createApp()` boundary with an in-memory auth store. |
| `packages/server/src/__tests__/helpers/setup.ts` | Globally mocks `node:fs` with memfs | Auth tests must stay unit-level and should not use real D1, local files, or network. |

The current `/oauth/token` route has two independent flows:

- `authorization_code`: verifies the signed auth-code JWT, redirect URI, and PKCE, then
  signs a 1-hour access token.
- `client_credentials`: verifies `CLIENT_SECRET`, then signs a 1-hour access token.

Refresh-token support belongs only on the authorization-code branch. The client-credentials
branch can already mint a new access token by presenting the client secret again.

The current GitHub callback validates the allowlist and then discards the GitHub identity
after creating the auth-code JWT. That is acceptable for a one-hour access token, but not
for refresh grants. The auth code must carry `auth_subject` and `auth_method` forward so the
token endpoint can persist a grant for `github:<login>` rather than for an anonymous client.

### Standards And Ecosystem Insights

- OAuth authorization-code responses may include an optional refresh token; the client uses
  that token later to obtain a new access token after expiry.
- MCP's current authorization draft has an explicit Refresh Tokens section. Clients that want
  refresh tokens should keep them secure, advertise `refresh_token` in client metadata, and
  must not assume the authorization server will issue one.
- MCP servers acting as protected resources should not put `offline_access` in protected
  resource metadata or `WWW-Authenticate` scope challenges because refresh tokens are a
  client/authorization-server concern, not a resource permission.
- SEP-2207 documents the interoperability issue directly: major MCP clients may not request
  refresh tokens unless they know whether an authorization server supports or expects
  `offline_access` / `refresh_token` capability signals.
- OAuth security best practice treats refresh tokens as high-value credentials. For public
  clients, the authorization server must detect replay, normally through sender-constrained
  refresh tokens or refresh-token rotation. Rotation is the pragmatic fit here.

Research references:

- [MCP draft authorization spec — Refresh Tokens](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP SEP-2207 — OIDC-Flavored Refresh Token Guidance](https://modelcontextprotocol.io/seps/2207-oidc-refresh-token-guidance)
- [RFC 9700 — OAuth 2.0 Security Best Current Practice, Refresh Token Protection](https://datatracker.ietf.org/doc/html/rfc9700#section-4.14)
- [RFC 6749 — OAuth 2.0 Refresh Token Grant](https://www.rfc-editor.org/rfc/rfc6749#section-6)

### Distilled Decision

Add refresh-token support with a minimal D1-backed grant store. Keep access tokens stateless
JWTs and short-lived. Make refresh tokens opaque, hashed at rest, rotated on every use, and
revocable as a token family.

This intentionally changes the ADR's original storage boundary:

- Access-token verification remains stateless and fast.
- Authorization codes remain short-lived signed JWTs.
- Refresh grants become durable D1 records because replay detection and revocation require
  server-side state.
- Client-credentials clients do not need refresh tokens; they can request a new access token
  with their client secret. Refresh tokens target user authorization-code sessions.

### Target Architecture Goals

The implementation goal is not just "make the client stop asking the user to log in every
day." The goal is OAuth refresh-token support with security properties that hold up when the
remote endpoint is treated as a real product surface.

Required properties:

- **Best-practice refresh-token handling**: opaque refresh tokens, hashes at rest, rotation
  on every use, replay detection, token-family revocation, inactivity expiry, and absolute
  family expiry.
- **Resilient auth path**: access-token verification stays stateless and fast; refresh-token
  persistence is isolated to a narrow D1 store; failures in refresh persistence fail closed
  without weakening `/mcp` authorization.
- **Compatibility first**: clients that do not register `refresh_token` support keep the
  current authorization-code behavior. Direct `Bearer <API_KEY>` and `client_credentials`
  flows continue unchanged.
- **Runtime capability advertising**: the server advertises `refresh_token` only when a
  refresh-capable store is injected. The metadata must reflect actual runtime capability,
  not just code that exists in the bundle.
- **Composition over inheritance**: auth behavior is assembled from small collaborators
  (`OAuthStore`, token helpers, clock/id/token generators, policy functions) instead of
  subclasses, framework inheritance, or a monolithic auth class.

Composition boundaries:

```typescript
interface AuthRuntime {
  store?: OAuthStore;
  policy: RefreshTokenPolicy;
  clock: Clock;
  ids: IdGenerator;
  tokens: TokenGenerator;
}
```

`createApp()` should compose this runtime from `AppDeps` and pass it to route-local helper
functions. `D1OAuthStore` is one implementation of a storage interface, not a base class.
Tests use an in-memory implementation of the same interface. No route should know whether
refresh-token rows live in D1 or memory.

### Engineering Plan

#### Phase 1: Extract Auth Primitives Without Changing Behavior

Add a new `packages/server/src/auth/` module group:

| File | Responsibility |
|------|----------------|
| `jwt.ts` | Move `b64url`, `b64urlDecode`, `signJWT`, and `verifyJWT` out of `hono-app.ts`; keep Web Crypto implementation unchanged. |
| `tokens.ts` | Add `generateOpaqueToken()` and `hashToken()` using Web Crypto (`crypto.getRandomValues` and SHA-256). |
| `oauth-store.ts` | Define `OAuthStore`, `OAuthClientRegistration`, and `RefreshTokenRecord` interfaces. |
| `d1-oauth-store.ts` | Implement `OAuthStore` against D1 using the same minimal D1 type pattern already used by `D1StorageAdapter` and `D1OperationLog`. |
| `policy.ts` | Define refresh-token eligibility, expiry defaults, and capability-advertising decisions as pure functions. |
| `runtime.ts` | Compose `AuthRuntime` from `AppDeps` without subclassing Hono, stores, or route handlers. |

`index.ts` files remain barrel exports only per repo convention.

`hono-app.ts` keeps route ownership. The extraction should be mechanical first so tests can
prove behavior is unchanged before adding refresh-token semantics.

Keep collaborators as plain objects and functions. Avoid a `BaseOAuthStore`, route
subclasses, or an inherited "auth server" class. The server should be easy to test by
passing different composed dependencies, not by overriding methods.

#### Phase 2: Add D1 Auth Schema

Create `packages/server/migrations/0002_oauth_refresh_tokens.sql`.

`oauth_clients`:

```sql
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
```

`oauth_refresh_tokens`:

```sql
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
```

Indexes:

- `idx_oauth_refresh_tokens_hash` on `token_hash`
- `idx_oauth_refresh_tokens_family` on `family_id`
- `idx_oauth_refresh_tokens_client` on `client_id`
- `idx_oauth_refresh_tokens_subject` on `subject`
- `idx_oauth_refresh_tokens_expires` on `expires_at`

Do not add foreign keys initially. D1 migration and existing schema do not currently use
foreign keys, and refresh-token revocation should still work even if a stale client record
is later cleaned up.

#### Phase 3: Wire Store As An Explicit Dependency

Extend `AppDeps` in `hono-app.ts`:

```typescript
oauthStore?: OAuthStore;
refreshTokenInactivitySeconds?: number; // default 30 days
refreshTokenMaxAgeSeconds?: number;     // default 90 days
now?: () => Date;                       // tests can control time
generateId?: () => string;              // tests can control IDs
generateToken?: () => string;           // tests can control opaque token values
```

Update `worker-entry.ts`:

```typescript
const oauthStore = new D1OAuthStore(env.DB);
createApp(service, {
  // existing deps...
  oauthStore,
});
```

Keep `node-server.ts` unchanged for now. Local mode will continue to support direct bearer
API keys and current OAuth testing, but it will not advertise refresh-token support unless
a future local auth store is injected.

`hono-app.ts` should compose an `AuthRuntime` once inside `createApp()`:

```typescript
const auth = createAuthRuntime({
  store: deps?.oauthStore,
  inactivitySeconds: deps?.refreshTokenInactivitySeconds,
  maxAgeSeconds: deps?.refreshTokenMaxAgeSeconds,
  now: deps?.now,
  generateId: deps?.generateId,
  generateToken: deps?.generateToken,
});
```

Route handlers use `auth.policy`, `auth.store`, `auth.clock`, and `auth.tokens`. They do not
instantiate stores or reach directly into D1.

#### Phase 4: Persist Dynamic Client Registration

In `/oauth/register`:

- Parse submitted `redirect_uris`, `grant_types`, `response_types`, `scope`,
  `client_name`, and `token_endpoint_auth_method`.
- Generate `client_id` as today.
- If `deps.oauthStore` exists, persist the registration.
- Return `refresh_token` in `grant_types` only when the client requested it and
  `deps.oauthStore` exists.
- If no store exists, preserve current stateless behavior and return only
  `authorization_code`.

Do not require all clients to be registered before authorization. Claude-style clients may
not always use DCR. For compatibility, unknown clients can still complete the current
authorization-code flow, but they are not eligible for refresh tokens.

#### Phase 5: Carry Identity And Scope Through The Auth Code

Update both auth-code producers in `hono-app.ts`:

- GitHub callback auth code:
  - `auth_subject: github:<ghUser.login.toLowerCase()>`
  - `auth_method: github`
  - `client_id` from the original state JWT
  - `scope` from the original authorization request
- API-key form auth code:
  - `auth_subject: api_key`
  - `auth_method: api_key`
  - `client_id` from the submitted form
  - `scope` from the submitted form

Also add `scope` to the GitHub state JWT in `/oauth/github/start`; it is currently preserved
in the URL but not signed into the state payload.

When the token endpoint signs an access token for `authorization_code`, set `sub` from
`auth_subject` rather than from `client_id`. Resource authorization does not currently use
`sub`, so this is a low-risk semantic improvement that makes future audit/debugging sane.

#### Phase 6: Issue Refresh Tokens Selectively

In the `authorization_code` branch of `/oauth/token`:

- Look up the registered client by `client_id` when `deps.oauthStore` exists.
- Determine eligibility:
  - Client registration includes `refresh_token` in `grant_types`, or
  - Authorization request includes `offline_access` and authorization-server metadata
    advertises that scope.
- Initially issue refresh tokens only for `auth_method === 'github'`. API-key and
  client-credentials flows already have durable secrets and do not need new long-lived
  bearer material.
- Generate an opaque token, hash it, persist the hash plus grant metadata, and return the
  opaque token once.

Eligibility should be a pure policy function, for example:

```typescript
function canIssueRefreshToken(input: RefreshEligibilityInput): boolean
```

The route provides facts; the policy decides. This keeps the OAuth rules testable without
HTTP setup and avoids burying security decisions in inline callbacks.

Response shape when eligible:

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "rt_<opaque-random-token>"
}
```

Response shape when not eligible remains unchanged.

#### Phase 7: Implement Refresh Grant

Add `grant_type=refresh_token` to `/oauth/token`:

- Require `refresh_token`.
- Require `client_id` when present in the original grant; reject mismatches with
  `invalid_grant`.
- Hash the presented token and load the matching record, including rotated/revoked records.
- If no record exists, return `invalid_grant`.
- If the record is revoked, expired, or past family expiry, return `invalid_grant`.
- If the record was already rotated, treat it as replay: revoke the full `family_id` and
  return `invalid_grant`.
- Otherwise, rotate:
  - Generate replacement refresh token and hash.
  - Insert replacement row with the same `family_id`, `client_id`, `subject`, `auth_method`,
    `scope`, and `resource`.
  - Mark the old row with `rotated_at`, `last_used_at`, and `replaced_by_id`.
  - Issue a fresh 1-hour access JWT plus the replacement refresh token.

`D1OAuthStore` should own the multi-statement rotation operation so route code does not
spread SQL details through `hono-app.ts`.

Store API shape:

```typescript
interface OAuthStore {
  saveClient(registration: OAuthClientRegistration): Promise<void>;
  getClient(clientId: string): Promise<OAuthClientRegistration | null>;
  createRefreshToken(record: NewRefreshTokenRecord): Promise<void>;
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult>;
  revokeRefreshTokenFamily(familyId: string, reason: string): Promise<void>;
}
```

`rotateRefreshToken()` should be atomic from the route's perspective. For D1, implement it
with an explicit sequence that verifies the current row state immediately before writing the
replacement row. If D1 cannot provide a clean transaction primitive in this codebase, the
store should fail closed on ambiguous write failures rather than issuing an access token
without recording the replacement refresh token.

#### Phase 8: Advertise Capabilities From Runtime Dependencies

When `deps.oauthStore` exists:

- Add `refresh_token` to `/.well-known/oauth-authorization-server`
  `grant_types_supported`.
- Add `offline_access` to authorization-server `scopes_supported` only if we choose to use
  the OIDC compatibility signal.

Never add `offline_access` to `/.well-known/oauth-protected-resource`; SEP-2207 is explicit
that it is not a resource-specific scope.

#### Phase 9: Unit Tests

Add `packages/server/src/__tests__/oauth-refresh.test.ts`.

Use:

- `createApp(makeService(), { jwtSecret: 'test-secret', githubClientId: 'gh-client',
  githubClientSecret: 'gh-secret', allowedGithubUsernames: 'gkoreli', oauthStore:
  new InMemoryOAuthStore() })`
- A mocked `arctic` GitHub client or direct API-key authorization path for tests that do
  not need GitHub network behavior.
- `app.request()` for all HTTP assertions.
- No real filesystem, no real D1, no network.

Required tests:

- Pure policy tests for refresh-token eligibility and metadata capability decisions.
- Pure token tests for opaque-token generation format and SHA-256 hashing determinism.
- Store-contract tests run against `InMemoryOAuthStore` to prove rotation, replay detection,
  and family revocation semantics independent of HTTP.
- Metadata omits `refresh_token` when no `oauthStore` is injected.
- Metadata includes `refresh_token` when `oauthStore` is injected.
- `/oauth/register` persists `grant_types` and returns `refresh_token` only when requested.
- Authorization-code exchange for a refresh-capable GitHub grant returns `refresh_token`.
- Authorization-code exchange for an unregistered or non-refresh-capable client does not
  return `refresh_token`.
- Refresh-token grant returns a new access token and replacement refresh token.
- Reusing a rotated refresh token revokes the token family and fails.
- Expired refresh tokens fail with `invalid_grant`.
- Client-id mismatch fails with `invalid_grant`.
- Client-credentials grant remains unchanged and never returns `refresh_token`.

Run:

```bash
pnpm --filter backlog-mcp test
pnpm --filter backlog-mcp typecheck
```

#### Phase 10: Deployment Notes

- Apply the new D1 migration before deploying code that advertises refresh-token support.
- Rotating `JWT_SECRET` invalidates active access tokens and auth codes, but not stored
  refresh-token hashes. To invalidate long-lived grants, revoke rows by `subject`,
  `client_id`, or `family_id`.
- Add a short README note after implementation: remote OAuth sessions can now refresh, while
  direct `Authorization: Bearer <API_KEY>` remains supported for Claude Desktop and scripts.

### Implementation Record 2026-04-14

ADR 92 refresh-token engineering was implemented in the server package with the planned
composition boundaries:

| Area | Implementation |
|------|----------------|
| Auth primitives | Added `packages/server/src/auth/jwt.ts` for Web Crypto JWT helpers and `packages/server/src/auth/tokens.ts` for opaque refresh-token generation plus SHA-256 token hashing. |
| Runtime composition | Added `packages/server/src/auth/runtime.ts` so `createApp()` receives a composed `AuthRuntime` with optional store, policy, clock, id generator, and token generator. No route subclassing or inherited auth server abstraction was introduced. |
| Policy | Added `packages/server/src/auth/policy.ts` with 30-day inactivity expiry, 90-day family max age, runtime capability checks, and refresh-token eligibility rules. |
| Store contract | Added `packages/server/src/auth/oauth-store.ts` with `OAuthStore`, client-registration records, refresh-token records, rotation inputs, and explicit rotation results. |
| D1 store | Added `packages/server/src/auth/d1-oauth-store.ts`, following the existing local-minimal D1 type pattern from storage and operation logging. |
| Schema | Added `packages/server/migrations/0002_oauth_refresh_tokens.sql` with `oauth_clients`, `oauth_refresh_tokens`, and indexes for hash, family, client, subject, and expiry lookups. |
| Worker wiring | Updated `packages/server/src/worker-entry.ts` to construct `D1OAuthStore(env.DB)` and inject it into `createApp()`. |
| HTTP routes | Updated `packages/server/src/server/hono-app.ts` for refresh-aware metadata, persisted DCR, GitHub/API-key auth-code identity claims, selective refresh-token issuance, and `grant_type=refresh_token` rotation. |
| Tests | Added `packages/server/src/__tests__/oauth-refresh.test.ts` with unit tests around policy, metadata, DCR persistence, refresh issuance, rotation, replay family revocation, expiry, client mismatch, and unchanged client-credentials behavior. |
| Docs | Updated the README cloud setup to run D1 migrations from `packages/server` against the configured `backlog` D1 database. |

Verification completed after implementation:

```bash
pnpm --filter backlog-mcp exec vitest run src/__tests__/oauth-refresh.test.ts
pnpm --filter backlog-mcp test
pnpm --filter backlog-mcp typecheck
pnpm --filter backlog-mcp build
git diff --check
```

All listed checks passed.

### Final Engineering Decisions

- **Refresh-token support is runtime-gated**: `refresh_token` and `offline_access` are
  advertised only when an `OAuthStore` is injected. The bundle can contain refresh-token
  code without claiming support in runtimes that cannot persist grants.
- **Access tokens stay stateless**: `/mcp/*` authorization still verifies only the short-lived
  HS256 JWT or direct `API_KEY`. Refresh-token persistence is not consulted on normal MCP
  requests.
- **Refresh grants are stateful and narrow**: only client registrations and refresh-token
  families are stored in D1. There is no general session table.
- **Dynamic client registration remains compatibility-first**: clients can still complete
  authorization-code auth without a stored registration, but only registered refresh-capable
  clients are eligible to receive refresh tokens.
- **Refresh tokens are opaque bearer credentials**: the raw `rt_...` value is returned once
  to the client, while D1 stores only the SHA-256 base64url hash.
- **Rotation is mandatory**: every refresh-token grant issues a replacement refresh token.
  Reuse of a rotated token is treated as replay and revokes the whole token family.
- **GitHub OAuth is the only refresh-token-eligible user flow**: API-key form auth and
  `client_credentials` already rely on durable secrets and do not receive additional
  long-lived bearer material.
- **Subjects are now durable grant identities**: GitHub grants use `github:<login>` as the
  access-token subject and refresh-token subject. API-key auth codes carry `api_key` but are
  intentionally not refresh-token eligible.
- **Expiry uses both inactivity and absolute limits**: initial and replacement refresh-token
  rows expire at the earlier of the inactivity window and family max age.
- **Local node mode remains unchanged**: `node-server.ts` does not inject an OAuth store, so
  local mode keeps existing OAuth/API-key behavior and does not advertise refresh-token
  support.
- **D1 rotation fails closed**: `D1OAuthStore.rotateRefreshToken()` validates the current
  row, conditionally marks it rotated, inserts the replacement, and the route issues a new
  access token only when the store reports `rotated`. Ambiguous rotation failures return
  `invalid_grant` rather than issuing an unrecorded token.

### Deployment Record 2026-04-14

The intended file-based Wrangler migration command reached the correct remote D1 database
but Cloudflare rejected the import endpoint with `Authentication error [code: 10000]`.
Because direct remote D1 statements were accepted with the same logged-in account, the
idempotent statements from `0002_oauth_refresh_tokens.sql` were applied individually via
`wrangler d1 execute --remote --command`.

Remote schema verification confirmed these objects on D1 database `backlog`
(`a6364201-aa49-42c0-b905-324451bdab43`):

- `oauth_clients`
- `oauth_refresh_tokens`
- `idx_oauth_refresh_tokens_hash`
- `idx_oauth_refresh_tokens_family`
- `idx_oauth_refresh_tokens_client`
- `idx_oauth_refresh_tokens_subject`
- `idx_oauth_refresh_tokens_expires`

### Remaining Work

ADR 92's core implementation is complete in the working tree and the remote D1 schema has
been applied. The remaining work is operational and hardening work:

- Deploy the Worker bundle that includes the `D1OAuthStore` wiring.
- Run a real OAuth smoke test with at least one DCR-capable MCP client after deployment:
  register client, complete GitHub OAuth, receive refresh token, refresh access token, and
  confirm replay of the old refresh token fails.
- Commit and publish the implementation after review.
- Add an operator-facing revocation or cleanup path if this endpoint gains more users:
  revoke by `subject`, `client_id`, or `family_id`, and optionally prune expired rows.
- Consider a D1 transaction/batch refinement for refresh-token rotation. The current store
  fails closed on ambiguous writes, which protects authorization, but a failure after marking
  the old token rotated and before inserting the replacement can strand that session and
  require re-authentication.
- Decide later whether local node mode needs refresh-token support. It currently does not
  advertise refresh tokens because no local `OAuthStore` is injected.

---

## Original Implementation

| File | Role |
|------|------|
| `src/server/hono-app.ts` | All auth routes: discovery, authorize, GitHub start/callback, token, DCR, protected resource |
| `src/worker-entry.ts` | Injects `apiKey`, `clientSecret`, `jwtSecret`, `githubClientId`, `githubClientSecret`, `allowedGithubUsernames` from Workers env bindings |
| `src/node-server.ts` | Same env vars read via `process.env` fallback inside `hono-app.ts` |
| `packages/server/package.json` | `"arctic": "^3.0.0"` — the only new dependency |

### Complete OAuth flow before refresh-token amendment

```
1. Client → GET /authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...
2. Server → renders auth page (GitHub button + API key form)
3. User clicks GitHub → GET /oauth/github/start?<same-params>
4. Server → signs state JWT (carries all OAuth params), redirects to GitHub
5. GitHub → user authenticates, redirects to GET /oauth/github/callback?code=...&state=<jwt>
6. Server → verifies state JWT, exchanges GitHub code via arctic, checks username allowlist
7. Server → issues auth_code JWT, redirects to redirect_uri?code=<jwt>&state=<client_state>
8. Client → POST /oauth/token { grant_type=authorization_code, code=<jwt>, code_verifier=... }
9. Server → verifies auth_code JWT, verifies PKCE, issues access_token JWT
10. Client → GET /mcp with Authorization: Bearer <access_token>
11. Server → verifies JWT signature + expiry, proceeds
```

---

## Consequences

- Original design used no KV, no D1 auth tables, and no session storage. The 2026-04-14
  amendment changes this narrowly: access-token verification remains stateless, but refresh
  grants now use D1 auth tables for rotation and replay detection.
- `JWT_SECRET` is the single secret that must be kept safe; rotation invalidates all active tokens
- GitHub username allowlist is hardcoded via `ALLOWED_GITHUB_USERNAMES` env var — no UI to manage it
- Access tokens remain short-lived. Refresh-capable GitHub OAuth clients can now renew access
  without daily user re-authentication once the updated Worker is deployed.
- Refresh-token rows become high-value auth state. Operational revocation and cleanup tooling
  is now a future concern if the service expands beyond single-owner use.
- ChatGPT can complete OAuth automatically without user-supplied client credentials
