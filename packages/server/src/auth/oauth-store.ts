export interface OAuthClientRegistration {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope?: string;
  tokenEndpointAuthMethod: string;
  createdAt: string;
  expiresAt?: string;
}

export interface RefreshTokenRecord {
  id: string;
  familyId: string;
  clientId: string;
  subject: string;
  authMethod: string;
  scope?: string;
  resource?: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
  familyExpiresAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  replacedById?: string;
}

export type NewRefreshTokenRecord = RefreshTokenRecord;

export interface RotateRefreshTokenInput {
  tokenHash: string;
  replacement: NewRefreshTokenRecord;
  now: string;
}

export type RotateRefreshTokenResult =
  | { status: 'rotated'; previous: RefreshTokenRecord; current: RefreshTokenRecord }
  | { status: 'not_found' }
  | { status: 'revoked'; record: RefreshTokenRecord }
  | { status: 'expired'; record: RefreshTokenRecord }
  | { status: 'replayed'; record: RefreshTokenRecord }
  | { status: 'failed'; record: RefreshTokenRecord };

export interface OAuthStore {
  saveClient(registration: OAuthClientRegistration): Promise<void>;
  getClient(clientId: string): Promise<OAuthClientRegistration | null>;
  createRefreshToken(record: NewRefreshTokenRecord): Promise<void>;
  getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult>;
  revokeRefreshTokenFamily(familyId: string, reason: string, revokedAt: string): Promise<void>;
}
