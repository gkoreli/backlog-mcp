import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

/**
 * Runtime environment modes
 */
export enum RuntimeEnvironment {
  Development = 'development',
  Production = 'production',
}

/**
 * Centralized runtime/package paths and reusable local path mechanics.
 * The singleton's projectRoot is the installed package root, never a caller's
 * workspace. User path bases and home selection are supplied per invocation;
 * this resolver never stores an active BacklogHome (ADRs 0026, 0105, 0112).
 */
export class PathResolver {
  private static instance: PathResolver;
  
  /** Current runtime environment */
  public readonly environment: RuntimeEnvironment;
  
  /** Root directory of the npm package (where package.json lives) */
  public readonly projectRoot: string;
  
  /** Root directory of compiled output (dist/) */
  public readonly distRoot: string;
  
  /** Directory containing built viewer assets (dist/viewer/) */
  public readonly viewerDist: string;
  
  /** Parsed package.json metadata */
  public readonly packageJson: { name: string; version: string; [key: string]: unknown };
  
  private constructor() {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    
    this.environment = this.detectEnvironment();
    const paths = PathResolver.resolveRuntimePaths(currentDir, this.environment);
    
    this.projectRoot = paths.projectRoot;
    this.distRoot = paths.distRoot;
    this.viewerDist = paths.viewerDist;
    
    // Load package.json once
    const pkgPath = join(this.projectRoot, 'package.json');
    this.packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  }
  
  public static getInstance(): PathResolver {
    if (!PathResolver.instance) {
      PathResolver.instance = new PathResolver();
    }
    return PathResolver.instance;
  }
  
  /**
   * Get the application version from package.json
   */
  public getVersion(): string {
    return this.packageJson.version;
  }
  
  /**
   * Expand a leading `~` to the user's home directory.
   *
   * `~` is a shell convention — the OS treats it as a literal path segment, so an
   * unexpanded `~/foo` resolves against the CWD (e.g. `/cwd/~/foo`) the moment it
   * hits join()/resolve(). Values arriving from MCP config `env` blocks never pass
   * through a shell, so we expand here.
   *
   * Only a leading `~` or `~/` is expanded; `~user/...` is left untouched
   * (homedir() can't resolve another user's home anyway).
   */
  public expandTilde(path: string, userHome: string = homedir()): string {
    if (path === '~') return userHome;
    if (path.startsWith('~/')) return join(userHome, path.slice(2));
    return path;
  }

  /**
   * Resolve a user-supplied path to an absolute path: expand a leading `~`,
   * then resolve relative paths against the supplied base (default: live CWD).
   * @example paths.resolveUserPath('~/notes.md') → '/home/user/notes.md'
   */
  public resolveUserPath(path: string, baseDir: string = process.cwd(), userHome: string = homedir()): string {
    return resolve(baseDir, this.expandTilde(path, userHome));
  }

  /** Strict canonical lookup: the complete path must exist; IO failures propagate. */
  public canonicalizeExistingPath(path: string): string {
    return realpathSync(path);
  }

  /**
   * Canonicalize existing ancestors of a possibly new local path. Missing
   * suffixes are appended after realpath; failures from an existing ancestor
   * propagate. This is not an existence check, tilde expansion or containment
   * policy. Strict reads and lock-directory validation keep their own checks.
   */
  public canonicalizeThroughExistingAncestor(path: string, deps: {
    exists(path: string): boolean;
    canonicalize(path: string): string;
  } = { exists: existsSync, canonicalize: this.canonicalizeExistingPath.bind(this) }): string {
    const absolutePath = resolve(path);
    const missingSegments: string[] = [];
    let existingPath = absolutePath;
    while (!deps.exists(existingPath)) {
      const parent = dirname(existingPath);
      if (parent === existingPath) return absolutePath;
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
    return resolve(deps.canonicalize(existingPath), ...missingSegments);
  }
  
  /**
   * Resolve a path relative to project root
   * @example paths.fromRoot('data', 'tasks') → '/path/to/package/data/tasks'
   */
  public fromRoot(...paths: string[]): string {
    return join(this.projectRoot, ...paths);
  }
  
  /**
   * Resolve a path relative to dist/
   * @example paths.fromDist('server', 'index.mjs') → '/path/to/package/dist/server/index.mjs'
   */
  public fromDist(...paths: string[]): string {
    return join(this.distRoot, ...paths);
  }
  
  /**
   * Resolve path to a package binary using Node.js module resolution.
   * 
   * Uses require.resolve to find the package wherever npm places it (local node_modules,
   * hoisted to parent, or pnpm virtual store). Reads the bin field from package.json
   * instead of assuming .bin/ symlink location.
   * 
   * @param binName - Package name (e.g., 'mcp-remote')
   * @returns Absolute path to the binary file
   * @throws Error if package not found or has no bin field
   * @example paths.getBinPath('mcp-remote') // → '/path/to/node_modules/mcp-remote/dist/proxy.js'
   */
  public getBinPath(binName: string): string {
    // Create require function from current module context
    const require = createRequire(import.meta.url);
    
    // Let Node.js find the package (handles hoisting automatically)
    const packageJsonPath = require.resolve(`${binName}/package.json`);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    
    // Read bin field from package.json (source of truth)
    if (!packageJson.bin) {
      throw new Error(`Package '${binName}' has no bin field in package.json`);
    }
    
    const binRelativePath = typeof packageJson.bin === 'string' 
      ? packageJson.bin 
      : packageJson.bin[binName];
    
    if (!binRelativePath) {
      const availableBins = Object.keys(packageJson.bin).join(', ');
      throw new Error(`Package '${binName}' has no bin entry for '${binName}'. Available: ${availableBins}`);
    }
    
    // Resolve absolute path to binary
    const packageDir = dirname(packageJsonPath);
    return join(packageDir, binRelativePath);
  }
  
  /**
   * Detect runtime environment based on NODE_ENV.
   * Defaults to production unless NODE_ENV explicitly requests development.
   */
  private detectEnvironment(): RuntimeEnvironment {
    const env = process.env.NODE_ENV;
    if (env === RuntimeEnvironment.Development) return RuntimeEnvironment.Development;
    if (env === RuntimeEnvironment.Production) return RuntimeEnvironment.Production;
    return RuntimeEnvironment.Production;
  }
  
  /**
   * Resolve all directory paths based on current location and environment
   * @param currentDir - Directory containing this file (src/utils or dist/utils)
   * @param environment - Current runtime environment
   * @returns Resolved paths for project root, dist, and viewer
   */
  public static resolveRuntimePaths(currentDir: string, environment: RuntimeEnvironment): {
    projectRoot: string;
    distRoot: string;
    viewerDist: string;
  } {
    const projectRoot = dirname(dirname(currentDir));
    const isRunningFromSource = basename(dirname(currentDir)) === 'src';

    if (isRunningFromSource) {
      // Source mode via Vite SSR: this file is at packages/server/src/utils/paths.ts.
      const distRoot = join(projectRoot, 'dist');
      const viewerDist = environment === RuntimeEnvironment.Development
        ? join(projectRoot, '../viewer/dist')
        : join(distRoot, 'viewer');
      return { projectRoot, distRoot, viewerDist };
    }

    // Production OR built CLI with NODE_ENV=development:
    // this file is at dist/utils/paths.mjs — go up two levels to reach project root
    const distRoot = dirname(currentDir);
    const viewerDist = environment === RuntimeEnvironment.Development
      ? join(projectRoot, '../viewer/dist')
      : join(distRoot, 'viewer');
    return { projectRoot, distRoot, viewerDist };
  }
}

// Export singleton instance
export const paths: PathResolver = PathResolver.getInstance();
