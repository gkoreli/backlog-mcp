import type { AuthRuntime } from './runtime.js';
import type { NewRefreshTokenRecord, RefreshTokenRecord } from './oauth-store.js';
import { addSeconds } from './policy.js';

export async function createRefreshRecord(input: {
  authRuntime: AuthRuntime;
  clientId: string;
  subject: string;
  authMethod: string;
  scope?: string;
  resource?: string;
  tokenHash: string;
  now: Date;
}): Promise<NewRefreshTokenRecord> {
  const familyExpiresAt = addSeconds(input.now, input.authRuntime.policy.maxAgeSeconds).toISOString();
  const inactivityExpiresAt = addSeconds(input.now, input.authRuntime.policy.inactivitySeconds).toISOString();
  return {
    id: input.authRuntime.ids.create(),
    familyId: input.authRuntime.ids.create(),
    clientId: input.clientId,
    subject: input.subject,
    authMethod: input.authMethod,
    scope: input.scope,
    resource: input.resource,
    tokenHash: input.tokenHash,
    createdAt: input.now.toISOString(),
    expiresAt: inactivityExpiresAt <= familyExpiresAt ? inactivityExpiresAt : familyExpiresAt,
    familyExpiresAt,
  };
}

export async function createRefreshRecordFromExisting(input: {
  authRuntime: AuthRuntime;
  current: RefreshTokenRecord;
  tokenHash: string;
  now: Date;
}): Promise<NewRefreshTokenRecord> {
  const inactivityExpiry = addSeconds(input.now, input.authRuntime.policy.inactivitySeconds).toISOString();
  return {
    id: input.authRuntime.ids.create(),
    familyId: input.current.familyId,
    clientId: input.current.clientId,
    subject: input.current.subject,
    authMethod: input.current.authMethod,
    scope: input.current.scope,
    resource: input.current.resource,
    tokenHash: input.tokenHash,
    createdAt: input.now.toISOString(),
    expiresAt: inactivityExpiry <= input.current.familyExpiresAt ? inactivityExpiry : input.current.familyExpiresAt,
    familyExpiresAt: input.current.familyExpiresAt,
  };
}
