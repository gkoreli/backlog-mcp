export type AuthEvent = Record<string, string | number | boolean | null | undefined | Array<string | null>>;

export type AuthEventLogger = (event: AuthEvent) => void | Promise<void>;

export async function emitAuthEvent(logger: AuthEventLogger | undefined, event: AuthEvent): Promise<void> {
  if (!logger) return;
  await logger(event);
}

export function redirectOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
