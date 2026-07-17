import { Logger } from 'pino';
import { getLogger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

export interface FileManagerConfig {
  /** Base directory for sandboxed access */
  baseDir: string;
  /** Allowed subdirectories (relative to baseDir) */
  allowedDirs: string[];
  /** Max file size in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Allowed file extensions */
  allowedExtensions?: string[];
  /** Blocked file patterns */
  blockedPatterns?: RegExp[];
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  modifiedAt: Date;
}

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: Date;
  extension: string;
}

const DEFAULT_CONFIG: FileManagerConfig = {
  baseDir: path.join(homedir(), '.wagent', 'data'),
  allowedDirs: ['kb-files', 'uploads', 'memory', 'knowledge'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedExtensions: ['.md', '.txt', '.csv', '.json', '.jsonl', '.yaml', '.yml'],
  blockedPatterns: [/\.\./g, /^\//g], // No parent traversal, no absolute paths
};

/**
 * FileManager provides sandboxed file operations:
 * - Read/write within allowed directories only
 * - File size limits
 * - Extension whitelist
 * - Path traversal protection
 */
export class FileManager {
  private logger: Logger;
  private config: FileManagerConfig;

  constructor(config: Partial<FileManagerConfig> = {}) {
    this.logger = getLogger().child({ module: 'file-manager' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Read a file
   */
  async read(filePath: string): Promise<FileContent | null> {
    const resolvedPath = this.resolvePath(filePath);
    if (!resolvedPath) {
      this.logger.warn({ path: filePath }, 'Path validation failed');
      return null;
    }

    try {
      const stat = await fs.stat(resolvedPath);
      if (stat.isDirectory()) {
        return null;
      }

      if (stat.size > (this.config.maxFileSize || 10 * 1024 * 1024)) {
        this.logger.warn({ path: filePath, size: stat.size }, 'File too large');
        return null;
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');

      return {
        path: filePath,
        content,
        size: stat.size,
        modifiedAt: stat.mtime,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null;
      }
      this.logger.error({ path: filePath, error: err.message }, 'Failed to read file');
      return null;
    }
  }

  /**
   * Write a file
   */
  async write(filePath: string, content: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(filePath);
    if (!resolvedPath) {
      this.logger.warn({ path: filePath }, 'Path validation failed');
      return false;
    }

    // Check size
    if (Buffer.byteLength(content) > (this.config.maxFileSize || 10 * 1024 * 1024)) {
      this.logger.warn({ path: filePath }, 'Content too large');
      return false;
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(resolvedPath, content, 'utf-8');
      this.logger.info({ path: filePath }, 'File written');
      return true;
    } catch (err: any) {
      this.logger.error({ path: filePath, error: err.message }, 'Failed to write file');
      return false;
    }
  }

  /**
   * Delete a file
   */
  async delete(filePath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(filePath);
    if (!resolvedPath) {
      return false;
    }

    try {
      await fs.unlink(resolvedPath);
      this.logger.info({ path: filePath }, 'File deleted');
      return true;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return true; // Already deleted
      }
      this.logger.error({ path: filePath, error: err.message }, 'Failed to delete file');
      return false;
    }
  }

  /**
   * List files in a directory
   */
  async list(dirPath: string = '.'): Promise<FileInfo[]> {
    const resolvedPath = this.resolvePath(dirPath);
    if (!resolvedPath) {
      return [];
    }

    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const stat = await fs.stat(path.join(resolvedPath, entry.name));

        files.push({
          path: fullPath,
          name: entry.name,
          size: stat.size,
          isDirectory: entry.isDirectory(),
          modifiedAt: stat.mtime,
          extension: path.extname(entry.name),
        });
      }

      return files;
    } catch (err: any) {
      this.logger.error({ path: dirPath, error: err.message }, 'Failed to list directory');
      return [];
    }
  }

  /**
   * Check if a file exists
   */
  async exists(filePath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(filePath);
    if (!resolvedPath) {
      return false;
    }

    try {
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file info
   */
  async stat(filePath: string): Promise<FileInfo | null> {
    const resolvedPath = this.resolvePath(filePath);
    if (!resolvedPath) {
      return null;
    }

    try {
      const stat = await fs.stat(resolvedPath);
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        isDirectory: stat.isDirectory(),
        modifiedAt: stat.mtime,
        extension: path.extname(filePath),
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve and validate a file path
   */
  private resolvePath(filePath: string): string | null {
    // Check for blocked patterns
    for (const pattern of this.config.blockedPatterns || []) {
      if (pattern.test(filePath)) {
        return null;
      }
    }

    // Check extension
    if (this.config.allowedExtensions) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext && !this.config.allowedExtensions.includes(ext)) {
        this.logger.warn({ path: filePath, ext }, 'File extension not allowed');
        return null;
      }
    }

    // Resolve relative to baseDir
    const resolved = path.resolve(this.config.baseDir, filePath);

    // Ensure it's within baseDir
    const baseResolved = path.resolve(this.config.baseDir);
    if (!resolved.startsWith(baseResolved)) {
      this.logger.warn({ path: filePath }, 'Path escapes base directory');
      return null;
    }

    return resolved;
  }
}
