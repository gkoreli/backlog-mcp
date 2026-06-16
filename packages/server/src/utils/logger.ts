import { appendFile, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const levelPriority: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getLogLevel(): Level {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  return LEVELS.includes(env as Level) ? (env as Level) : 'info';
}

function getLogFile(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(paths.backlogDataDir, 'logs', `backlog-${date}.log`);
}

function ensureLogDir(): void {
  const logDir = join(paths.backlogDataDir, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function buildEntry(level: Level, message: string, data?: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  }) + '\n';
}

function write(level: Level, message: string, data?: Record<string, unknown>): void {
  if (levelPriority[level] < levelPriority[getLogLevel()]) return;
  ensureLogDir();
  appendFile(getLogFile(), buildEntry(level, message, data), (err) => {
    if (err) {
      process.stderr.write(`Logger error: ${err.message}\n`);
    }
  });
}

/**
 * Synchronous write for pre-exit paths (uncaughtException, EADDRINUSE defer,
 * fatal server errors). The async `write` buffers behind libuv and is dropped
 * when `process.exit()` runs before the callback fires — so crash/defer
 * records would silently vanish, which is the exact failure this logging was
 * added to prevent. Sync append guarantees the record lands before exit.
 */
function writeSync(level: Level, message: string, data?: Record<string, unknown>): void {
  try {
    ensureLogDir();
    appendFileSync(getLogFile(), buildEntry(level, message, data));
  } catch (err) {
    process.stderr.write(`Logger error: ${(err as Error).message}\n`);
  }
}

export const logger: {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  /** Synchronous error log — use immediately before process.exit so the record isn't lost. */
  fatalSync: (message: string, data?: Record<string, unknown>) => void;
} = {
  debug: (message: string, data?: Record<string, unknown>): void => write('debug', message, data),
  info: (message: string, data?: Record<string, unknown>): void => write('info', message, data),
  warn: (message: string, data?: Record<string, unknown>): void => write('warn', message, data),
  error: (message: string, data?: Record<string, unknown>): void => write('error', message, data),
  fatalSync: (message: string, data?: Record<string, unknown>): void => writeSync('error', message, data),
};
