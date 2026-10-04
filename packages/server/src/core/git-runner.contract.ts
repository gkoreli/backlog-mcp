/** Git stdout on success, undefined on any failure. Implemented by local subprocess adapters. */
export type GitRunner = (cwd: string, args: readonly string[]) => string | undefined;
