import { existsSync, readFileSync, realpathSync } from 'node:fs';
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import matter from 'gray-matter';
import { paths } from '@server/utils/paths.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Resource } from '@backlog-mcp/memory/search';
import { discoverDocuments } from '../core/document-discovery.js';

export interface ResourceContent {
  content: string;
  frontmatter?: Record<string, any>;
  mimeType: string;
}

/**
 * Extract title from markdown content.
 * Returns first # heading or filename without extension.
 */
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  const extension = extname(filename);
  const fallback = extension === ''
    ? filename
    : filename.slice(0, -extension.length);
  return match?.[1]?.trim() || fallback;
}

function normalizeRelativePath(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).split(sep).join('/');
}

function isPathContained(rootDir: string, filePath: string): boolean {
  const relativePath = relative(rootDir, filePath);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    );
}

function isCanonicalPathContained(rootDir: string, filePath: string): boolean {
  try {
    return isPathContained(realpathSync(rootDir), realpathSync(filePath));
  } catch {
    return false;
  }
}

function hasParentPathSegment(uri: string): boolean {
  const pathStart = uri.indexOf('/', 'mcp://'.length);
  if (pathStart < 0) {
    return false;
  }

  const rawPath = uri.slice(pathStart).split(/[?#]/u)[0] ?? '';
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new Error(`Invalid URI encoding: ${uri}`);
  }
  return decodedPath.split(/[\\/]/u).includes('..');
}

/**
 * ResourceManager - Single point of responsibility for MCP resource operations.
 * 
 * Pure catch-all design: mcp://backlog/{+path} → {rootDir}/{path}
 * No special cases, no magic behavior.
 */
export class ResourceManager {
  private readonly rootDir: string;
  private readonly scanDir: string;

  constructor(rootDir: string, scanDir: string = rootDir) {
    this.rootDir = resolve(rootDir);
    this.scanDir = resolve(scanDir);
  }

  /**
   * List all supported documents beneath the configured scan directory.
   * Returns Resource objects ready for search indexing.
   */
  list(): Resource[] {
    const discovery = discoverDocuments({ documentsDir: this.scanDir });
    const resources: Resource[] = [];
    for (const document of discovery.documents) {
      if (document.content === undefined) {
        continue;
      }

      const uri = this.toUri(document.absolutePath);
      if (uri === null) {
        continue;
      }

      resources.push({
        id: uri,
        path: normalizeRelativePath(this.rootDir, document.absolutePath),
        title: extractTitle(document.content, basename(document.absolutePath)),
        content: document.content,
      });
    }
    return resources;
  }

  /**
   * Resolve MCP URI to absolute file path.
   * Pure catch-all: mcp://backlog/path/file.md → {rootDir}/path/file.md
   * 
   * @param uri MCP URI (must start with mcp://backlog/)
   * @returns Absolute file path
   * @throws Error if URI is invalid or contains path traversal
   */
  resolve(uri: string): string {
    if (!uri.startsWith('mcp://')) {
      throw new Error(`Not an MCP URI: ${uri}`);
    }

    // Check before URL parsing because URL normalizes parent path segments.
    if (hasParentPathSegment(uri)) {
      throw new Error(`Path traversal not allowed: ${uri}`);
    }

    const url = new URL(uri);
    
    if (url.hostname !== 'backlog') {
      throw new Error(`Invalid hostname: ${url.hostname}. Expected 'backlog'`);
    }
    
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      throw new Error(`Invalid URI encoding: ${uri}`);
    }

    const filePath = resolve(this.rootDir, `.${decodedPath}`);
    if (!isPathContained(this.rootDir, filePath)) {
      throw new Error(`Path traversal not allowed: ${uri}`);
    }
    return filePath;
  }

  /**
   * Read resource content from MCP URI.
   * Parses frontmatter for markdown files and detects MIME type.
   * 
   * @param uri MCP URI
   * @returns Resource content with frontmatter and MIME type
   * @throws Error if file not found
   */
  read(uri: string): ResourceContent {
    const filePath = this.resolve(uri);
    
    if (!existsSync(filePath)) {
      // Helpful error for common mistake: extension-less task URIs
      if (/^mcp:\/\/backlog\/tasks\/(TASK|EPIC)-\d+$/.test(uri)) {
        throw new Error(
          `Task URIs must include .md extension. Did you mean: ${uri}.md?`
        );
      }
      throw new Error(`Resource not found: ${uri} (resolved to ${filePath})`);
    }
    if (!isCanonicalPathContained(this.rootDir, filePath)) {
      throw new Error(`Resource resolves outside root: ${uri}`);
    }
    
    const content = readFileSync(filePath, 'utf-8');
    const ext = filePath.split('.').pop()?.toLowerCase() || 'txt';
    const mimeType = this.getMimeType(ext);
    
    // Parse frontmatter for markdown files
    if (ext === 'md' || ext === 'markdown') {
      const parsed = matter(content);
      return {
        content: parsed.content,
        frontmatter: Object.keys(parsed.data).length > 0 ? parsed.data : undefined,
        mimeType,
      };
    }
    
    return {
      content,
      mimeType,
    };
  }

  /**
   * Convert file path to MCP URI.
   * Pure mapping: {rootDir}/path/file.md → mcp://backlog/path/file.md
   * 
   * @param filePath Absolute file path
   * @returns MCP URI or null if file is outside the configured root
   */
  toUri(filePath: string): string | null {
    const absolutePath = resolve(filePath);
    if (!isPathContained(this.rootDir, absolutePath)) {
      return null;
    }
    if (existsSync(absolutePath) && !isCanonicalPathContained(this.rootDir, absolutePath)) {
      return null;
    }

    const relativePath = normalizeRelativePath(this.rootDir, absolutePath);
    return `mcp://backlog/${relativePath}`;
  }

  /**
   * Register MCP resource handler (catch-all pattern).
   */
  registerResource(server: McpServer): void {
    const template = new ResourceTemplate(
      'mcp://backlog/{+path}',
      { list: undefined }
    );
    
    server.registerResource(
      'Data Directory Resource',
      template,
      { description: 'Any file in the backlog data directory' },
      async (uri) => {
        const resource = this.read(uri.toString());
        return { 
          contents: [{ 
            uri: uri.toString(), 
            mimeType: resource.mimeType, 
            text: resource.content 
          }] 
        };
      }
    );
  }

  private getMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
      md: 'text/markdown',
      markdown: 'text/markdown',
      json: 'application/json',
      yaml: 'application/yaml',
      yml: 'application/yaml',
      ts: 'text/typescript',
      js: 'application/javascript',
      txt: 'text/plain',
    };
    
    return mimeMap[ext] || 'text/plain';
  }
}

/**
 * Singleton instance for dependency injection.
 * Preserves the legacy resources-only search scan while URI operations remain
 * rooted at the configured backlog data directory.
 */
const legacyRootDir = paths.backlogDataDir;
export const resourceManager: ResourceManager = new ResourceManager(
  legacyRootDir,
  join(legacyRootDir, 'resources'),
);
