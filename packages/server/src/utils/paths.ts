import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
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
 * Centralized path resolution for the entire application.
 * All file paths and directory references should go through this singleton.
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
  public readonly packageJson: { name: string; version: string; [key: string]: any };
  
  private constructor() {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    
    this.environment = this.detectEnvironment();
    const paths = this.resolvePaths(currentDir, this.environment);
    
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
   * Get backlog data directory path.
   *
   * Reads from BACKLOG_DATA_DIR environment variable, defaults to '~/.backlog'
   * — a user-global store so memory and tasks persist across projects and
   * sessions (the cross-session-continuity posture), not trapped in one repo.
   * Relative paths are resolved against project root; absolute paths (and a
   * leading `~`, which expands to home) are returned as-is.
   *
   * @example
   * // BACKLOG_DATA_DIR not set → '/home/user/.backlog'
   * // BACKLOG_DATA_DIR='./my-data' → '/path/to/project/my-data'
   * // BACKLOG_DATA_DIR='/absolute/path' → '/absolute/path'
   * // BACKLOG_DATA_DIR='~/Documents/data' → '/home/user/Documents/data'
   */
  public get backlogDataDir(): string {
    const dataDir = this.expandTilde(process.env.BACKLOG_DATA_DIR ?? '~/.backlog');

    const isAbsolutePath = dataDir.startsWith('/');
    return isAbsolutePath ? dataDir : join(this.projectRoot, dataDir);
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
  public expandTilde(path: string): string {
    if (path === '~') return homedir();
    if (path.startsWith('~/')) return join(homedir(), path.slice(2));
    return path;
  }

  /**
   * Resolve a user-supplied path to an absolute path: expand a leading `~`,
   * then resolve relative paths against the CWD.
   * @example paths.resolveUserPath('~/notes.md') → '/home/user/notes.md'
   */
  public resolveUserPath(path: string): string {
    return resolve(this.expandTilde(path));
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
   * Resolve all paths based on current directory and environment
   * @param currentDir - Directory where this file is located
   * @param environment - Current runtime environment
   * @returns Object containing all resolved paths
   */
  /**
   * Resolve all directory paths based on current location and environment
   * @param currentDir - Directory containing this file (src/utils or dist/utils)
   * @param environment - Current runtime environment
   * @returns Resolved paths for project root, dist, and viewer
   */
  private resolvePaths(currentDir: string, environment: RuntimeEnvironment): {
    projectRoot: string;
    distRoot: string;
    viewerDist: string;
  } {
    const isRunningFromSource = currentDir.includes('/src/');

    if (isRunningFromSource) {
      // Source mode via tsx: this file is at packages/server/src/utils/paths.ts.
      const srcIndex = currentDir.indexOf('/src/');
      const projectRoot = currentDir.substring(0, srcIndex);
      const distRoot = join(projectRoot, 'dist');
      const viewerDist = environment === RuntimeEnvironment.Development
        ? join(projectRoot, '../viewer/dist')
        : join(distRoot, 'viewer');
      return { projectRoot, distRoot, viewerDist };
    }

    // Production OR built CLI with NODE_ENV=development:
    // this file is at dist/utils/paths.mjs — go up two levels to reach project root
    const distRoot = dirname(currentDir);
    const projectRoot = dirname(distRoot);
    const viewerDist = environment === RuntimeEnvironment.Development
      ? join(projectRoot, '../viewer/dist')
      : join(distRoot, 'viewer');
    return { projectRoot, distRoot, viewerDist };
  }
}

// Export singleton instance
export const paths: PathResolver = PathResolver.getInstance();
