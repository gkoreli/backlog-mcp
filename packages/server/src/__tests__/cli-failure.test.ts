import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportCliFailure } from '../cli/cli-failure.js';
import { WorkspaceHomeResolutionError } from '../core/backlog-home.errors.js';
import { SubstrateWriteError } from '../core/substrates/substrate-write-error.js';
import { NotFoundError, ValidationError } from '../core/types.js';

describe('reportCliFailure (ADR 0130 R5)', function describeCliFailure() {
  const originalExitCode = process.exitCode;

  afterEach(function restoreExitCode() {
    process.exitCode = originalExitCode;
  });

  it('prints only the message for domain errors and requests exit 1', function reportsDomainErrors() {
    const io = { error: vi.fn() };

    reportCliFailure(new NotFoundError('TASK-0001'), io);
    reportCliFailure(new ValidationError('title is required'), io);
    reportCliFailure(
      new SubstrateWriteError('memory', [{ code: 'shape', path: '/id', message: 'duplicate document identities' }]),
      io,
    );

    expect(io.error.mock.calls.map(function firstArg(call) { return call[0]; })).toEqual([
      new NotFoundError('TASK-0001').message,
      'title is required',
      new SubstrateWriteError('memory', [{ code: 'shape', path: '/id', message: 'duplicate document identities' }]).message,
    ]);
    for (const [message] of io.error.mock.calls) {
      expect(message).not.toMatch(/\n\s+at /u);
    }
    expect(process.exitCode).toBe(1);
  });

  it('prints the stack for unexpected errors and never calls process.exit', function reportsUnexpectedErrors() {
    const io = { error: vi.fn() };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(function neverExit() {
      throw new Error('process.exit must not be called');
    });

    reportCliFailure(new Error('boom'), io);
    reportCliFailure('plain string', io);

    expect(io.error.mock.calls[0]?.[0]).toMatch(/^Error: boom\n\s+at /u);
    expect(io.error.mock.calls[1]?.[0]).toBe('plain string');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    exitSpy.mockRestore();
  });

  it('adds actionable CLI hints to typed workspace failures', function reportsWorkspaceFailures() {
    const io = { error: vi.fn() };
    reportCliFailure(new WorkspaceHomeResolutionError('missing-boundary'), io);
    reportCliFailure(new WorkspaceHomeResolutionError('invalid-root', '/missing'), io);
    expect(io.error.mock.calls).toEqual([
      ['No project boundary found for wakeup; run inside a project, pass --project-root <path>, or explicitly select --home global'],
      ['Project root must be an existing directory: /missing; pass --project-root <path>'],
    ]);
    expect(process.exitCode).toBe(1);
  });
});
