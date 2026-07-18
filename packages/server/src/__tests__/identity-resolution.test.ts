/**
 * Implicit identity capture — the attribution ladder (ADR 0119.1).
 *
 * The precedence matrix runs against a REAL git repository with a REAL
 * linked worktree (child_process is not mocked by the memfs setup),
 * because the ladder's git rungs are claims about real repository
 * config scoping — above all R1's deliberate inversion (worktree config
 * beats env) and its extension gate (`extensions.worktreeConfig` absent
 * = rung absent, enforced by git itself). All fixture filesystem work
 * rides execSync — node:fs is memfs in this suite (git-family law).
 *
 * Hermetic by construction: GIT_CONFIG_GLOBAL points every spawned git
 * at a disposable file and GIT_CONFIG_NOSYSTEM blanks the machine
 * scope, so the developer's own `backlog.agent` can never leak in.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entity } from '@backlog-mcp/shared';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  probeAgentIdentityGitRungs,
  resolveAgentIdentity,
  type AgentIdentitySource,
} from '../core/identity-resolution.js';
import {
  ambientAgentIdentity,
  resetAmbientAgentIdentityCacheForTests,
} from '../storage/local/agent-identity.js';
import { runGitCommand, type GitRunner } from '../storage/local/git-runner.js';
import { envActor } from '../operations/logger.js';
import { wakeup } from '../core/wakeup.js';
import { serializeBriefing } from '../core/wakeup-wire.js';
import { formatWakeupBriefing } from '../cli/commands/wakeup.js';
import {
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
} from '../core/backlog-home.js';
import { createLocalNodeApp } from '../server/local-node-app.js';
import type {
  DocsTreeReconcileCallback,
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
  DocsTreeWatcherSubscription,
} from '../storage/local/docs-tree-watcher.contract.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';

// git reports canonical absolute paths; on macOS tmpdir() is itself a
// symlink (/var → /private/var), so anchor the fixture at the REAL path.
const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const BASE = realFs.mkdtempSync(join(
  realFs.realpathSync(tmpdir()),
  'identity-ladder-fixture-',
));
const REPO = join(BASE, 'repo');
const WORKTREE = join(BASE, 'wt');
const NON_REPO = join(BASE, 'plain-directory');
const GLOBAL_CONFIG = join(BASE, 'global.gitconfig');
const WORKTREE_CONFIG_FILE = join(REPO, '.git', 'worktrees', 'wt', 'config.worktree');

const savedEnv: Record<string, string | undefined> = {};

class FakeDocsTreeWatcher implements DocsTreeWatcher {
  async subscribe(
    _documentsDir: string,
    _onReconcile: DocsTreeReconcileCallback,
    _onError?: DocsTreeWatcherErrorCallback,
  ): Promise<DocsTreeWatcherSubscription> {
    return {
      unsubscribe: async function unsubscribe(): Promise<void> {},
    };
  }
}

function git(command: string, cwd = REPO): string {
  return execSync(`git ${command}`, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@test',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@test',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function gitQuiet(command: string, cwd = REPO): void {
  try {
    git(command, cwd);
  } catch {
    // unset on an absent key exits non-zero — absence is the goal.
  }
}

/**
 * Reset every ladder-relevant knob to absent, then apply exactly what
 * the case declares. Each matrix row states its whole world.
 */
function configureRungs(state: {
  user?: string;
  checkout?: string;
  worktreeStamp?: string;
  extension?: boolean;
} = {}): void {
  realFs.writeFileSync(GLOBAL_CONFIG, '');
  gitQuiet('config --unset-all backlog.agent');
  gitQuiet('config --unset extensions.worktreeConfig');
  realFs.rmSync(WORKTREE_CONFIG_FILE, { force: true });
  if (state.user !== undefined) git(`config --global backlog.agent '${state.user}'`);
  if (state.checkout !== undefined) git(`config --local backlog.agent '${state.checkout}'`);
  if (state.extension === true) git('config extensions.worktreeConfig true');
  if (state.worktreeStamp !== undefined) {
    // Written to the file directly so the extension-absent case can
    // exist at all: `git config --worktree` refuses without the
    // extension, but a stale/ungated file must STILL not become rung 2.
    execFileSync('git', [
      'config',
      '--file',
      WORKTREE_CONFIG_FILE,
      'backlog.agent',
      state.worktreeStamp,
    ]);
  }
}

beforeAll(() => {
  for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'BACKLOG_AGENT']) {
    savedEnv[key] = process.env[key];
  }
  realFs.mkdirSync(REPO, { recursive: true });
  realFs.mkdirSync(NON_REPO, { recursive: true });
  process.env.GIT_CONFIG_GLOBAL = GLOBAL_CONFIG;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  delete process.env.BACKLOG_AGENT;
  realFs.writeFileSync(GLOBAL_CONFIG, '');
  git('init -q -b main');
  git('commit -q --allow-empty -m init');
  git(`worktree add -q '${WORKTREE}' -b feat/wt`);
  resetAmbientAgentIdentityCacheForTests();
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAmbientAgentIdentityCacheForTests();
  realFs.rmSync(BASE, { recursive: true, force: true });
});

describe('the precedence matrix (real git fixture)', () => {
  it('rung 1: explicit --as beats a fully populated ladder', () => {
    configureRungs({
      user: 'user-agent',
      checkout: 'checkout-agent',
      extension: true,
      worktreeStamp: 'wt-agent',
    });
    const resolved = resolveAgentIdentity({
      explicit: 'cli-agent',
      gitRungs: probeAgentIdentityGitRungs(WORKTREE, runGitCommand),
      env: { BACKLOG_AGENT: 'env-agent' },
    });
    expect(resolved).toEqual({ value: 'cli-agent', source: '--as' });
  });

  it('R1 inversion: the worktree stamp beats BACKLOG_AGENT (and every lower rung)', () => {
    configureRungs({
      user: 'user-agent',
      checkout: 'checkout-agent',
      extension: true,
      worktreeStamp: 'wt-agent',
    });
    const resolved = resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(WORKTREE, runGitCommand),
      env: { BACKLOG_AGENT: 'env-agent' },
    });
    expect(resolved).toEqual({ value: 'wt-agent', source: 'worktree config' });
  });

  it('extensions.worktreeConfig absent: rung 2 is skipped even with a stamp file present — env wins', () => {
    configureRungs({
      user: 'user-agent',
      checkout: 'checkout-agent',
      worktreeStamp: 'wt-agent',
      extension: false,
    });
    const rungs = probeAgentIdentityGitRungs(WORKTREE, runGitCommand);
    expect(rungs.worktree).toBeUndefined();
    const resolved = resolveAgentIdentity({
      gitRungs: rungs,
      env: { BACKLOG_AGENT: 'env-agent' },
    });
    expect(resolved).toEqual({ value: 'env-agent', source: 'env' });
  });

  it('rung 3: env beats checkout and user config', () => {
    configureRungs({ user: 'user-agent', checkout: 'checkout-agent' });
    const resolved = resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(REPO, runGitCommand),
      env: { BACKLOG_AGENT: 'env-agent' },
    });
    expect(resolved).toEqual({ value: 'env-agent', source: 'env' });
  });

  it('rung 4: checkout config beats user config', () => {
    configureRungs({ user: 'user-agent', checkout: 'checkout-agent' });
    const resolved = resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(REPO, runGitCommand),
      env: {},
    });
    expect(resolved).toEqual({ value: 'checkout-agent', source: 'checkout config' });
  });

  it('rung 5: user config is the last present rung', () => {
    configureRungs({ user: 'user-agent' });
    const resolved = resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(REPO, runGitCommand),
      env: {},
    });
    expect(resolved).toEqual({ value: 'user-agent', source: 'user config' });
  });

  it('rung 6: nothing anywhere resolves absent, not an error', () => {
    configureRungs({});
    expect(probeAgentIdentityGitRungs(REPO, runGitCommand)).toEqual({});
    expect(resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(REPO, runGitCommand),
      env: {},
    })).toBeUndefined();
  });

  it('non-git home: repo rungs are absent; user config still reaches (like git identity itself)', () => {
    configureRungs({ user: 'user-agent', checkout: 'checkout-agent' });
    const rungs = probeAgentIdentityGitRungs(NON_REPO, runGitCommand);
    expect(rungs).toEqual({ user: 'user-agent' });
    expect(resolveAgentIdentity({ gitRungs: rungs, env: {} }))
      .toEqual({ value: 'user-agent', source: 'user config' });

    configureRungs({});
    expect(resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(NON_REPO, runGitCommand),
      env: {},
    })).toBeUndefined();
  });

  it('empty values are absent rungs, and whitespace explicit/env never wins', () => {
    configureRungs({});
    git("config --local backlog.agent ''");
    expect(probeAgentIdentityGitRungs(REPO, runGitCommand)).toEqual({});
    configureRungs({ checkout: 'checkout-agent' });
    expect(resolveAgentIdentity({
      explicit: '   ',
      gitRungs: probeAgentIdentityGitRungs(REPO, runGitCommand),
      env: { BACKLOG_AGENT: '   ' },
    })).toEqual({
      value: 'checkout-agent',
      source: 'checkout config',
    });
    gitQuiet('config --unset-all backlog.agent');
  });

  it('a failing runner (git missing, pre-2.26 git, any error) yields absent rungs', () => {
    const noGit: GitRunner = () => undefined;
    expect(probeAgentIdentityGitRungs(REPO, noGit)).toEqual({});
    expect(resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(REPO, noGit),
      env: {},
    })).toBeUndefined();
  });

  it('one subprocess probes all three git rungs', () => {
    configureRungs({
      user: 'user-agent',
      checkout: 'checkout-agent',
      extension: true,
      worktreeStamp: 'wt-agent',
    });
    let spawns = 0;
    const counting: GitRunner = (cwd, args) => {
      spawns += 1;
      return runGitCommand(cwd, args);
    };
    expect(probeAgentIdentityGitRungs(WORKTREE, counting)).toEqual({
      worktree: 'wt-agent',
      checkout: 'checkout-agent',
      user: 'user-agent',
    });
    expect(spawns).toBe(1);
  });
});

describe('the ambient binding and envActor (one resolution site)', () => {
  it('git rungs are probed once per directory and cached; env is read live', () => {
    configureRungs({ checkout: 'checkout-agent' });
    resetAmbientAgentIdentityCacheForTests();
    let spawns = 0;
    const counting: GitRunner = (cwd, args) => {
      spawns += 1;
      return runGitCommand(cwd, args);
    };
    expect(ambientAgentIdentity({ cwd: REPO, runGit: counting, env: {} }))
      .toEqual({ value: 'checkout-agent', source: 'checkout config' });
    expect(ambientAgentIdentity({ cwd: REPO, runGit: counting, env: {} }))
      .toEqual({ value: 'checkout-agent', source: 'checkout config' });
    expect(spawns).toBe(1);
    // Env stays live against the cached git rungs — but never outranks
    // rung 2 (that is the whole point of R1).
    expect(ambientAgentIdentity({
      cwd: REPO,
      runGit: counting,
      env: { BACKLOG_AGENT: 'env-agent' },
    }))
      .toEqual({ value: 'env-agent', source: 'env' });
    expect(spawns).toBe(1);
    resetAmbientAgentIdentityCacheForTests();
  });

  it('probes once per distinct canonical directory', () => {
    configureRungs({
      checkout: 'checkout-agent',
      extension: true,
      worktreeStamp: 'wt-agent',
    });
    resetAmbientAgentIdentityCacheForTests();
    let spawns = 0;
    const counting: GitRunner = (cwd, args) => {
      spawns += 1;
      return runGitCommand(cwd, args);
    };

    expect(ambientAgentIdentity({ cwd: REPO, runGit: counting, env: {} }))
      .toEqual({ value: 'checkout-agent', source: 'checkout config' });
    expect(ambientAgentIdentity({ cwd: WORKTREE, runGit: counting, env: {} }))
      .toEqual({ value: 'wt-agent', source: 'worktree config' });
    expect(ambientAgentIdentity({ cwd: REPO, runGit: counting, env: {} }))
      .toEqual({ value: 'checkout-agent', source: 'checkout config' });
    expect(ambientAgentIdentity({ cwd: WORKTREE, runGit: counting, env: {} }))
      .toEqual({ value: 'wt-agent', source: 'worktree config' });
    expect(spawns).toBe(2);
    resetAmbientAgentIdentityCacheForTests();
  });

  it('envActor resolves through the ladder: the worktree stamp beats BACKLOG_AGENT end-to-end', () => {
    const saved = {
      BACKLOG_AGENT: process.env.BACKLOG_AGENT,
      BACKLOG_ACTOR_TYPE: process.env.BACKLOG_ACTOR_TYPE,
      BACKLOG_ACTOR_NAME: process.env.BACKLOG_ACTOR_NAME,
      BACKLOG_DELEGATED_BY: process.env.BACKLOG_DELEGATED_BY,
      BACKLOG_TASK_CONTEXT: process.env.BACKLOG_TASK_CONTEXT,
    };
    try {
      delete process.env.BACKLOG_ACTOR_TYPE;
      delete process.env.BACKLOG_DELEGATED_BY;
      delete process.env.BACKLOG_TASK_CONTEXT;
      process.env.BACKLOG_ACTOR_NAME = 'goga';
      process.env.BACKLOG_AGENT = 'env-agent';

      configureRungs({ extension: true, worktreeStamp: 'wt-agent' });
      resetAmbientAgentIdentityCacheForTests();
      expect(envActor({ cwd: WORKTREE })).toEqual({
        type: 'agent',
        name: 'wt-agent',
        delegatedBy: undefined,
        taskContext: undefined,
      });

      // Without the stamp the same env lands on rung 3, unchanged.
      configureRungs({});
      resetAmbientAgentIdentityCacheForTests();
      expect(envActor({ cwd: WORKTREE })).toEqual({
        type: 'agent',
        name: 'env-agent',
        delegatedBy: undefined,
        taskContext: undefined,
      });

      // Every rung absent: byte-identical to the pre-0119 actor.
      delete process.env.BACKLOG_AGENT;
      expect(envActor({ cwd: WORKTREE })).toEqual({
        type: 'user',
        name: 'goga',
        delegatedBy: undefined,
        taskContext: undefined,
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetAmbientAgentIdentityCacheForTests();
    }
  });
});

describe('request-selected runtime identity', () => {
  it('resolves the selected worktree stamp instead of the detached boot identity', async () => {
    const originalAgent = process.env.BACKLOG_AGENT;
    configureRungs({ extension: true, worktreeStamp: 'wt-agent' });
    process.env.BACKLOG_AGENT = 'detached-agent';
    resetAmbientAgentIdentityCacheForTests();
    mkdirSync(join(WORKTREE, 'docs'), { recursive: true });
    const registry = new LocalRuntimeRegistry(function createRuntime(home) {
      return createLocalRuntime(home, {
        watcher: new FakeDocsTreeWatcher(),
        createSearch: function createSearch(selectedHome) {
          return new OramaSearchService({
            cachePath: join(
              selectedHome.controlDir,
              'cache',
              'search-index.json',
            ),
            hybridSearch: false,
          });
        },
      });
    });

    try {
      const composition = await createLocalNodeApp({
        globalRoot: join(BASE, 'global-home'),
        registry,
      });
      const response = await composition.app.request('/mcp', {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/event-stream',
          'content-type': 'application/json',
          [BACKLOG_HOME_HEADER]: 'project',
          [BACKLOG_PROJECT_ROOT_HEADER]: WORKTREE,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'backlog_wakeup',
            arguments: { home: 'project', project_root: WORKTREE },
          },
        }),
      });
      const payload = await response.json() as {
        result?: { content?: Array<{ text?: string }> };
      };
      const briefing = payload.result?.content?.[0]?.text;

      expect(response.status).toBe(200);
      expect(briefing).toContain('"identity": "wt-agent (worktree config)"');
      expect(briefing).not.toContain('detached-agent');

      const writeResponse = await composition.app.request('/mcp', {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/event-stream',
          'content-type': 'application/json',
          [BACKLOG_HOME_HEADER]: 'project',
          [BACKLOG_PROJECT_ROOT_HEADER]: WORKTREE,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'backlog_create_work',
            arguments: {
              title: 'Selected-home attribution probe',
            },
          },
        }),
      });
      expect(writeResponse.status).toBe(200);
      const operationsResponse = await composition.app.request('/operations', {
        headers: {
          [BACKLOG_HOME_HEADER]: 'project',
          [BACKLOG_PROJECT_ROOT_HEADER]: WORKTREE,
        },
      });
      const operations = await operationsResponse.json() as Array<{
        actor?: { type?: string; name?: string };
      }>;
      expect(operations[0]?.actor).toEqual({
        type: 'agent',
        name: 'wt-agent',
      });
    } finally {
      await registry.closeAll();
      if (originalAgent === undefined) delete process.env.BACKLOG_AGENT;
      else process.env.BACKLOG_AGENT = originalAgent;
      resetAmbientAgentIdentityCacheForTests();
    }
  });
});

// ── wakeup disclosure (R2): exact text, every source, absent case ────

function makeEntity(overrides: Partial<Entity> & { id: string; title: string }): Entity {
  return {
    type: 'task',
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Entity;
}

function mockService(entities: Entity[] = []): IBacklogService {
  const store = new Map(entities.map(e => [e.id, { ...e }]));
  return {
    get: async (id: string) => store.get(id),
    getMarkdown: async () => null,
    list: async (filter?: { status?: string[]; type?: string; parent_id?: string }) => {
      let result = [...store.values()];
      if (filter?.status) result = result.filter(e => filter.status?.includes(e.status ?? ''));
      if (filter?.type) result = result.filter(e => (e.type ?? 'task') === filter.type);
      if (filter?.parent_id) result = result.filter(e => e.parent_id === filter.parent_id);
      return result;
    },
    add: async () => {},
    save: async () => {},
    delete: async () => true,
    counts: async () => ({ total_tasks: 0, total_epics: 0, by_status: {}, by_type: {} }),
    getMaxId: async () => 0,
    searchUnified: async () => [],
  } as unknown as IBacklogService;
}

const GRANITE_AGENT_DOC = makeEntity({
  id: 'AGENT-0001',
  title: 'granite',
  type: 'agent',
  status: undefined,
  principal: 'aime:granite',
} as Partial<Entity> & { id: string; title: string });

describe('wakeup meta discloses the winning rung (ADR 0119.1 R2)', () => {
  const SOURCES: AgentIdentitySource[] = [
    '--as',
    'worktree config',
    'env',
    'checkout config',
    'user config',
  ];

  it.each(SOURCES)('source "%s": exact meta line, display resolved through the agent doc', async (source) => {
    const result = await wakeup(mockService([GRANITE_AGENT_DOC]), {
      agentIdentity: { value: 'aime:granite', source },
    });
    expect(result.metadata.identity).toBe(`granite (${source})`);
    expect(formatWakeupBriefing(result).split('\n'))
      .toContain(`  identity: granite (${source})`);
  });

  it('an undeclared value renders raw (fail-open read side, ADR 0119 R3)', async () => {
    const result = await wakeup(mockService([]), {
      agentIdentity: { value: 'feat/adr-0119', source: 'env' },
    });
    expect(result.metadata.identity).toBe('feat/adr-0119 (env)');
    expect(formatWakeupBriefing(result).split('\n'))
      .toContain('  identity: feat/adr-0119 (env)');
  });

  it('a failing agent-substrate list still discloses the raw value (never an error)', async () => {
    const service = mockService([]);
    const originalList = service.list.bind(service);
    service.list = (async (filter?: { type?: string }) => {
      if (filter?.type === 'agent') throw new Error('no agent substrate');
      return originalList(filter as never);
    }) as IBacklogService['list'];
    const result = await wakeup(service, {
      agentIdentity: { value: 'aime:granite', source: 'worktree config' },
    });
    expect(result.metadata.identity).toBe('aime:granite (worktree config)');
  });

  it('absent: the meta line stays exactly "identity: absent" and the wire gains no key', async () => {
    const result = await wakeup(mockService([]));
    expect(result.metadata.identity).toBeUndefined();
    expect(formatWakeupBriefing(result).split('\n'))
      .toContain('  identity: absent');
    expect(serializeBriefing(result)).not.toContain('"identity"');
  });

  it('the store-era identity.md fallback is intact, and the ladder wins over it when both exist', async () => {
    const withFileOnly = await wakeup(mockService([]), {
      readIdentity: () => 'I am the store.',
    });
    expect(formatWakeupBriefing(withFileOnly).split('\n'))
      .toContain('  identity: present');

    const withBoth = await wakeup(mockService([GRANITE_AGENT_DOC]), {
      readIdentity: () => 'I am the store.',
      agentIdentity: { value: 'aime:granite', source: 'env' },
    });
    expect(formatWakeupBriefing(withBoth).split('\n'))
      .toContain('  identity: granite (env)');
  });

  it('non-git home, nothing configured: the whole meta block is byte-identical to pre-0119.1', async () => {
    configureRungs({});
    const resolved = resolveAgentIdentity({
      gitRungs: probeAgentIdentityGitRungs(NON_REPO, runGitCommand),
      env: {},
    });
    expect(resolved).toBeUndefined();
    // Absent resolution ⇒ the params key is never set ⇒ core emits no
    // disclosure ⇒ the CLI meta block renders exactly as before 0119.1.
    const result = await wakeup(mockService([]), {
      ...(resolved === undefined ? {} : { agentIdentity: resolved }),
    });
    expect(formatWakeupBriefing(result)).toContain([
      '── meta ──',
      '  identity: absent',
      '  counts: active=0 epics=0 knowledge=0 constraints=0 completions=0 activity=0 unfiled=0',
    ].join('\n'));
  });
});
