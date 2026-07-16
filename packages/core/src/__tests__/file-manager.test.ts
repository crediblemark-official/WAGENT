import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

import { FileManager } from '../rag/file-manager.js';

let baseDir: string;
let fm: FileManager;

beforeEach(() => {
  baseDir = join(process.cwd(), 'tmp', `fm-test-${randomUUID()}`);
  mkdirSync(baseDir, { recursive: true });
  fm = new FileManager({ baseDir });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('FileManager', () => {
  describe('read', () => {
    it('reads an existing file', async () => {
      const filePath = join(baseDir, 'test.txt');
      writeFileSync(filePath, 'hello world', 'utf-8');

      const result = await fm.read('test.txt');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('hello world');
      expect(result!.path).toBe('test.txt');
      expect(result!.size).toBe(Buffer.byteLength('hello world'));
      expect(result!.modifiedAt).toBeInstanceOf(Date);
    });

    it('returns null for non-existent file', async () => {
      const result = await fm.read('nope.txt');
      expect(result).toBeNull();
    });

    it('returns null for directory', async () => {
      mkdirSync(join(baseDir, 'subdir'));
      const result = await fm.read('subdir');
      expect(result).toBeNull();
    });
  });

  describe('write', () => {
    it('creates a new file', async () => {
      const ok = await fm.write('output.txt', 'data');
      expect(ok).toBe(true);

      const result = await fm.read('output.txt');
      expect(result!.content).toBe('data');
    });

    it('overwrites an existing file', async () => {
      await fm.write('file.txt', 'old');
      await fm.write('file.txt', 'new');

      const result = await fm.read('file.txt');
      expect(result!.content).toBe('new');
    });

    it('creates nested directories automatically', async () => {
      const ok = await fm.write(join('deep', 'nested', 'file.txt'), 'content');
      expect(ok).toBe(true);

      const result = await fm.read(join('deep', 'nested', 'file.txt'));
      expect(result!.content).toBe('content');
    });

    it('returns false for content exceeding max file size', async () => {
      const smallFm = new FileManager({ baseDir, maxFileSize: 10 });
      const ok = await smallFm.write('big.txt', 'a'.repeat(11));
      expect(ok).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes an existing file', async () => {
      writeFileSync(join(baseDir, 'to-delete.txt'), 'bye', 'utf-8');

      const ok = await fm.delete('to-delete.txt');
      expect(ok).toBe(true);
      expect(existsSync(join(baseDir, 'to-delete.txt'))).toBe(false);
    });

    it('returns true for non-existent file (already deleted)', async () => {
      const ok = await fm.delete('never-existed.txt');
      expect(ok).toBe(true);
    });
  });

  describe('list', () => {
    it('lists all files in a directory', async () => {
      writeFileSync(join(baseDir, 'a.md'), 'a');
      writeFileSync(join(baseDir, 'b.txt'), 'b');
      writeFileSync(join(baseDir, 'c.json'), '{}');
      mkdirSync(join(baseDir, 'subdir'));

      const files = await fm.list('.');
      expect(files).toHaveLength(4);

      const names = files.map((f) => f.name).sort();
      expect(names).toEqual(['a.md', 'b.txt', 'c.json', 'subdir']);
    });

    it('returns extension for each file', async () => {
      writeFileSync(join(baseDir, 'doc.md'), '');

      const files = await fm.list('.');
      const md = files.find((f) => f.name === 'doc.md');
      expect(md!.extension).toBe('.md');
    });

    it('marks directories correctly', async () => {
      mkdirSync(join(baseDir, 'folder'));
      writeFileSync(join(baseDir, 'file.txt'), '');

      const files = await fm.list('.');
      const folder = files.find((f) => f.name === 'folder');
      const file = files.find((f) => f.name === 'file.txt');
      expect(folder!.isDirectory).toBe(true);
      expect(file!.isDirectory).toBe(false);
    });

    it('returns empty array for non-existent directory', async () => {
      const files = await fm.list('does-not-exist');
      expect(files).toEqual([]);
    });

    it('lists files in a subdirectory', async () => {
      mkdirSync(join(baseDir, 'kb-files'));
      writeFileSync(join(baseDir, 'kb-files', 'doc.md'), 'content');

      const files = await fm.list('kb-files');
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('doc.md');
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      writeFileSync(join(baseDir, 'here.txt'), '');
      expect(await fm.exists('here.txt')).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await fm.exists('gone.txt')).toBe(false);
    });

    it('returns false for invalid path', async () => {
      expect(await fm.exists('../escape.txt')).toBe(false);
    });
  });

  describe('stat', () => {
    it('returns file metadata', async () => {
      writeFileSync(join(baseDir, 'meta.txt'), 'hello');

      const info = await fm.stat('meta.txt');
      expect(info).not.toBeNull();
      expect(info!.name).toBe('meta.txt');
      expect(info!.path).toBe('meta.txt');
      expect(info!.extension).toBe('.txt');
      expect(info!.isDirectory).toBe(false);
      expect(info!.size).toBe(5);
      expect(info!.modifiedAt).toBeInstanceOf(Date);
    });

    it('returns null for non-existent file', async () => {
      expect(await fm.stat('nope.txt')).toBeNull();
    });

    it('returns directory info', async () => {
      mkdirSync(join(baseDir, 'mydir'));

      const info = await fm.stat('mydir');
      expect(info!.isDirectory).toBe(true);
      expect(info!.name).toBe('mydir');
      expect(info!.extension).toBe('');
    });
  });

  describe('path validation', () => {
    it('blocks path traversal with ../', async () => {
      const result = await fm.read('../escape.txt');
      expect(result).toBeNull();
    });

    it('blocks absolute paths starting with /', async () => {
      const result = await fm.read('/etc/passwd');
      expect(result).toBeNull();
    });

    it('resolves valid relative paths within base directory', async () => {
      writeFileSync(join(baseDir, 'valid.txt'), 'ok');
      const result = await fm.read('valid.txt');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('ok');
    });

    it('blocks paths that escape baseDir via resolve', async () => {
      const result = await fm.read(join('..', '..', 'etc', 'passwd'));
      expect(result).toBeNull();
    });

    it('allows files in allowed subdirectories', async () => {
      mkdirSync(join(baseDir, 'kb-files'));
      writeFileSync(join(baseDir, 'kb-files', 'doc.md'), 'content');

      const result = await fm.read(join('kb-files', 'doc.md'));
      expect(result).not.toBeNull();
      expect(result!.content).toBe('content');
    });
  });

  describe('extension filtering', () => {
    it('rejects disallowed file extensions on read', async () => {
      const strictFm = new FileManager({
        baseDir,
        allowedExtensions: ['.md', '.txt'],
      });

      writeFileSync(join(baseDir, 'script.js'), 'malicious');
      const result = await strictFm.read('script.js');
      expect(result).toBeNull();
    });

    it('rejects disallowed file extensions on write', async () => {
      const strictFm = new FileManager({
        baseDir,
        allowedExtensions: ['.md'],
      });

      const ok = await strictFm.write('file.exe', 'bad');
      expect(ok).toBe(false);
    });

    it('allows files with no extension when allowedExtensions is set', async () => {
      const strictFm = new FileManager({
        baseDir,
        allowedExtensions: ['.txt'],
      });

      const ok = await strictFm.write('noext', 'data');
      expect(ok).toBe(true);
    });
  });

  describe('constructor defaults', () => {
    it('uses default config when none provided', async () => {
      const defaultFm = new FileManager();
      mkdirSync('data', { recursive: true });
      writeFileSync(join('data', 'test-default.txt'), 'test');
      try {
        const result = await defaultFm.read('test-default.txt');
        expect(result).not.toBeNull();
      } finally {
        rmSync(join('data'), { recursive: true, force: true });
      }
    });
  });
});
