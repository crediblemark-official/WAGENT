import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileManager } from './file-manager.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('FileManager', () => {
  let manager: FileManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `fm-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    manager = new FileManager({
      baseDir: testDir,
      allowedDirs: ['subdir'],
      allowedExtensions: ['.md', '.txt', '.json'],
    });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('write', () => {
    it('writes file successfully', async () => {
      const result = await manager.write('test.md', 'Hello World');
      expect(result).toBe(true);

      const content = await fs.readFile(path.join(testDir, 'test.md'), 'utf-8');
      expect(content).toBe('Hello World');
    });

    it('creates directories automatically', async () => {
      const result = await manager.write('subdir/nested/file.md', 'content');
      expect(result).toBe(true);

      const content = await fs.readFile(
        path.join(testDir, 'subdir/nested/file.md'),
        'utf-8'
      );
      expect(content).toBe('content');
    });

    it('blocks disallowed extensions', async () => {
      const result = await manager.write('script.js', 'malicious code');
      expect(result).toBe(false);
    });

    it('blocks path traversal', async () => {
      const result = await manager.write('../etc/passwd', 'content');
      expect(result).toBe(false);
    });
  });

  describe('read', () => {
    it('reads file successfully', async () => {
      await fs.writeFile(path.join(testDir, 'test.md'), 'content');

      const file = await manager.read('test.md');
      expect(file).not.toBeNull();
      expect(file!.content).toBe('content');
    });

    it('returns null for non-existent file', async () => {
      const file = await manager.read('nonexistent.md');
      expect(file).toBeNull();
    });

    it('blocks disallowed extensions', async () => {
      await fs.writeFile(path.join(testDir, 'script.js'), 'code');

      const file = await manager.read('script.js');
      expect(file).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes file successfully', async () => {
      await fs.writeFile(path.join(testDir, 'to-delete.md'), 'content');

      const result = await manager.delete('to-delete.md');
      expect(result).toBe(true);

      const exists = await fs.access(path.join(testDir, 'to-delete.md')).then(() => true, () => false);
      expect(exists).toBe(false);
    });

    it('returns true for non-existent file', async () => {
      const result = await manager.delete('nonexistent.md');
      expect(result).toBe(true);
    });
  });

  describe('list', () => {
    it('lists files in directory', async () => {
      await fs.writeFile(path.join(testDir, 'a.md'), 'a');
      await fs.writeFile(path.join(testDir, 'b.txt'), 'b');
      await fs.mkdir(path.join(testDir, 'subdir'));

      const files = await manager.list('.');
      expect(files).toHaveLength(3);
      expect(files.map((f) => f.name)).toContain('a.md');
      expect(files.map((f) => f.name)).toContain('b.txt');
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      await fs.writeFile(path.join(testDir, 'exists.md'), 'content');

      expect(await manager.exists('exists.md')).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await manager.exists('nope.md')).toBe(false);
    });
  });

  describe('stat', () => {
    it('returns FileInfo for existing file', async () => {
      await fs.writeFile(path.join(testDir, 'info.md'), 'hello');

      const info = await manager.stat('info.md');
      expect(info).not.toBeNull();
      expect(info!.name).toBe('info.md');
      expect(info!.isDirectory).toBe(false);
      expect(info!.size).toBe(5);
      expect(info!.extension).toBe('.md');
      expect(info!.modifiedAt).toBeInstanceOf(Date);
    });

    it('returns FileInfo for directory', async () => {
      await fs.mkdir(path.join(testDir, 'mydir'));

      const info = await manager.stat('mydir');
      expect(info).not.toBeNull();
      expect(info!.isDirectory).toBe(true);
      expect(info!.name).toBe('mydir');
    });

    it('returns null for non-existent file', async () => {
      const info = await manager.stat('ghost.md');
      expect(info).toBeNull();
    });

    it('returns null for path traversal', async () => {
      const info = await manager.stat('../etc/passwd');
      expect(info).toBeNull();
    });

    it('returns null for absolute path', async () => {
      const info = await manager.stat('/etc/passwd');
      expect(info).toBeNull();
    });

    it('returns null for disallowed extension', async () => {
      const info = await manager.stat('script.js');
      expect(info).toBeNull();
    });
  });

  describe('read edge cases', () => {
    it('returns null for path traversal', async () => {
      const file = await manager.read('../etc/passwd');
      expect(file).toBeNull();
    });

    it('returns null for absolute path', async () => {
      const file = await manager.read('/etc/passwd');
      expect(file).toBeNull();
    });

    it('returns null for directory', async () => {
      await fs.mkdir(path.join(testDir, 'adir'));
      const file = await manager.read('adir');
      expect(file).toBeNull();
    });

    it('returns FileContent with correct metadata', async () => {
      await fs.writeFile(path.join(testDir, 'meta.md'), 'data');
      const file = await manager.read('meta.md');
      expect(file).not.toBeNull();
      expect(file!.path).toBe('meta.md');
      expect(file!.content).toBe('data');
      expect(file!.size).toBe(4);
      expect(file!.modifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('write edge cases', () => {
    it('blocks absolute path', async () => {
      const result = await manager.write('/tmp/evil.md', 'hacked');
      expect(result).toBe(false);
    });

    it('blocks content exceeding maxFileSize', async () => {
      const large = new FileManager({ baseDir: testDir, maxFileSize: 100 });
      const result = await large.write('big.md', 'x'.repeat(200));
      expect(result).toBe(false);
    });
  });

  describe('delete edge cases', () => {
    it('blocks path traversal', async () => {
      const result = await manager.delete('../etc/passwd');
      expect(result).toBe(false);
    });

    it('blocks disallowed extension', async () => {
      await fs.writeFile(path.join(testDir, 'script.js'), 'code');
      const result = await manager.delete('script.js');
      expect(result).toBe(false);
    });
  });

  describe('list edge cases', () => {
    it('returns empty for non-existent directory', async () => {
      const files = await manager.list('nonexistent');
      expect(files).toEqual([]);
    });

    it('returns empty for path traversal', async () => {
      const files = await manager.list('../');
      expect(files).toEqual([]);
    });

    it('returns empty for empty directory', async () => {
      await fs.mkdir(path.join(testDir, 'empty'));
      const files = await manager.list('empty');
      expect(files).toEqual([]);
    });

    it('returns correct FileInfo fields', async () => {
      await fs.mkdir(path.join(testDir, 'sub'));
      await fs.writeFile(path.join(testDir, 'sub', 'doc.md'), 'content');
      const files = await manager.list('sub');
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('doc.md');
      expect(files[0].size).toBe(7);
      expect(files[0].extension).toBe('.md');
      expect(files[0].isDirectory).toBe(false);
    });
  });
});
