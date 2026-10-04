import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveWorkspaceHome } from '../storage/local/backlog-home.js';

function project(root: string): void {
  mkdirSync(`${root}/.git`, { recursive: true });
}

describe('CLI wakeup workspace selection', function describeWorkspaceSelection() {
  it('selects a project without docs and ignores inherited global/root defaults', function selectsEmptyWorkspace() {
    const cwd = '/wakeup-workspace/empty';
    project(cwd);
    const env = { BACKLOG_HOME: 'global', BACKLOG_PROJECT_ROOT: '/other-project' };
    const selected = resolveWorkspaceHome({ cwd, env });

    expect(selected).toMatchObject({
      kind: 'project', root: cwd, documentsDir: `${cwd}/docs`,
    });
  });

  it('uses the nearest boundary from a subdirectory and ignores repository home:global', function ignoresGlobalConfig() {
    const root = '/wakeup-workspace/configured';
    project(root);
    mkdirSync(`${root}/.backlog`, { recursive: true });
    writeFileSync(`${root}/.backlog/config.json`, JSON.stringify({
      home: 'global', documentsDir: 'notes',
    }));
    const cwd = `${root}/packages/app/src`;
    mkdirSync(cwd, { recursive: true });
    const selected = resolveWorkspaceHome({ cwd });

    expect(selected).toMatchObject({
      kind: 'project', root, documentsDir: `${root}/notes`,
    });
  });

  it('does not cross a nested VCS boundary to enclosing home configuration', function respectsNestedBoundary() {
    mkdirSync('/wakeup-workspace/outer/.backlog', { recursive: true });
    const root = '/wakeup-workspace/outer/nested';
    project(root);
    mkdirSync(`${root}/src`, { recursive: true });
    expect(resolveWorkspaceHome({ cwd: `${root}/src` }).root).toBe(root);
  });

  it('accepts a linked-worktree marker file without requiring docs', function selectsWorktree() {
    const root = '/wakeup-workspace/linked';
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}/.git`, 'gitdir: /family/.git/worktrees/linked');
    expect(resolveWorkspaceHome({ cwd: root }).root).toBe(root);
  });

  it('accepts an explicit existing directory outside a discoverable project', function selectsExplicitRoot() {
    const projectRoot = '/wakeup-workspace/explicit';
    mkdirSync(projectRoot, { recursive: true });
    const selected = resolveWorkspaceHome({
      cwd: '/outside', projectRoot, env: { BACKLOG_HOME: 'global' },
    });
    expect(selected).toMatchObject({ kind: 'project', root: projectRoot });
  });

  it('retains explicitly selected global workflow', function preservesExplicitGlobal() {
    expect(resolveWorkspaceHome({
      home: 'global', cwd: '/outside', env: { BACKLOG_HOME: 'project' },
    })).toMatchObject({ kind: 'global' });
  });

  it('requires a project boundary instead of falling back to global or an environment root', function rejectsNoBoundary() {
    expect(function selectOutside() {
      resolveWorkspaceHome({
        cwd: '/wakeup-workspace/outside',
        env: { BACKLOG_HOME: 'global', BACKLOG_PROJECT_ROOT: '/somewhere' },
      });
    }).toThrow('No project boundary found');
  });

  it.each(['', '   ', '/wakeup-workspace/missing', '/wakeup-workspace/file', 'bad\0root'])(
    'rejects invalid explicit project root %j without falling back', function rejectsInvalidRoot(projectRoot) {
      mkdirSync('/wakeup-workspace', { recursive: true });
      writeFileSync('/wakeup-workspace/file', 'not a directory');
      expect(function selectInvalid() {
        resolveWorkspaceHome({ cwd: '/outside', projectRoot });
      }).toThrow('Project root must be an existing directory');
    },
  );

  it('retains fail-closed documents containment after overriding home:global', function rejectsEscapingDocuments() {
    const root = '/wakeup-workspace/escaping';
    mkdirSync(`${root}/.backlog`, { recursive: true });
    writeFileSync(`${root}/.backlog/config.json`, JSON.stringify({
      home: 'global', documentsDir: '../outside',
    }));
    expect(function resolveEscapingHome() {
      resolveWorkspaceHome({ cwd: root });
    }).toThrow('Backlog home path escapes its root');
  });
});
