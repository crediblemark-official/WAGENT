import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KnowledgeStore } from './knowledge-store.js';
import { Database } from './storage.js';
import { loadConfig } from './config.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'wagent-kb-test-' + Date.now());
const TEST_FILES_DIR = join(TEST_DIR, 'files');

// Mock EmbeddingService to avoid real API calls
vi.mock('./embeddings.js', () => {
  return {
    EmbeddingService: class MockEmbeddingService {
      async generateEmbedding(text: string): Promise<number[]> {
        const dim = 768;
        const embedding = new Array(dim).fill(0).map((_, i) => Math.sin(text.length + i) * 0.1);
        return embedding;
      }
    },
  };
});

describe('KnowledgeStore', () => {
  let db: Database;
  let store: KnowledgeStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(TEST_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new Database(dbPath);
    const config = loadConfig();
    store = new KnowledgeStore(db, config);
  });

  afterEach(() => {
    try { db.close(); } catch {}
    // cleanup temp DB file
    try {
      const resolved = join(process.cwd(), dbPath);
      if (existsSync(resolved)) unlinkSync(resolved);
      // Also check WAL/SHM files
      if (existsSync(resolved + '-wal')) unlinkSync(resolved + '-wal');
      if (existsSync(resolved + '-shm')) unlinkSync(resolved + '-shm');
    } catch {}
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('uploadFile', () => {
    it('should upload a markdown file and create chunks', async () => {
      const mdPath = join(TEST_FILES_DIR, 'products.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Products\n\nKaos Polos - 89000\n\nHoodie - 199000\n\nCelana - 129000');

      const result = await store.uploadFile(mdPath);

      expect(result.status).toBe('success');
      expect(result.totalChunks).toBeGreaterThanOrEqual(1);
      expect(result.fileName).toBe('products.md');
      expect(result.fileId).toBeDefined();
      expect(result.embeddedChunks).toBe(result.totalChunks);
    });

    it('should upload a CSV file', async () => {
      const csvPath = join(TEST_FILES_DIR, 'products.csv');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(csvPath, 'Name,Price\nKaos,89000\nHoodie,199000');

      const result = await store.uploadFile(csvPath);

      expect(result.status).toBe('success');
      expect(result.totalChunks).toBe(2);
    });

    it('should upload a JSON file', async () => {
      const jsonPath = join(TEST_FILES_DIR, 'products.json');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(jsonPath, JSON.stringify([
        { name: 'Kaos', price: 89000 },
        { name: 'Hoodie', price: 199000 },
      ]));

      const result = await store.uploadFile(jsonPath);

      expect(result.status).toBe('success');
      expect(result.totalChunks).toBe(2);
    });

    it('should return failed status for unsupported file types', async () => {
      const binPath = join(TEST_FILES_DIR, 'image.png');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(binPath, 'binary data');

      const result = await store.uploadFile(binPath);
      expect(result.status).toBe('failed');
    });
  });

  describe('listFiles', () => {
    it('should list uploaded files', async () => {
      const mdPath = join(TEST_FILES_DIR, 'test.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Test\n\nSome content');

      await store.uploadFile(mdPath);
      const files = store.listFiles();

      expect(files.length).toBe(1);
      expect(files[0].fileName).toBe('test.md');
    });

    it('should return empty array when no files', () => {
      const files = store.listFiles();
      expect(files.length).toBe(0);
    });
  });

  describe('deleteFile', () => {
    it('should delete a file and its chunks', async () => {
      const mdPath = join(TEST_FILES_DIR, 'delete-me.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Delete Me\n\nContent here');

      const result = await store.uploadFile(mdPath);
      expect(result.status).toBe('success');

      const deleted = store.deleteFile(result.fileId);
      expect(deleted).toBe(true);

      const files = store.listFiles();
      expect(files.length).toBe(0);
    });

    it('should return false for non-existent file', () => {
      const deleted = store.deleteFile('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteFileByName', () => {
    it('should delete file by name', async () => {
      const mdPath = join(TEST_FILES_DIR, 'named.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Named\n\nContent');

      await store.uploadFile(mdPath);
      const deleted = store.deleteFileByName('named.md');
      expect(deleted).toBe(true);
    });

    it('should return false for non-existent name', () => {
      const deleted = store.deleteFileByName('no-such-file.md');
      expect(deleted).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      const mdPath = join(TEST_FILES_DIR, 'stats-test.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Stats\n\nContent A\n\nContent B');

      await store.uploadFile(mdPath);
      const stats = store.getStats();

      expect(stats.totalFiles).toBe(1);
      expect(stats.totalChunks).toBeGreaterThanOrEqual(1);
    });

    it('should return zero stats when empty', () => {
      const stats = store.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalChunks).toBe(0);
    });
  });

  describe('searchChunks', () => {
    it('should search chunks by keyword', async () => {
      const mdPath = join(TEST_FILES_DIR, 'search-test.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Product\n\nKaos polos bahan katun premium\n\nHoodie rajut tebal');

      await store.uploadFile(mdPath);
      const results = await store.search('katun');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('katun');
    });

    it('should return empty array for no matches', async () => {
      const mdPath = join(TEST_FILES_DIR, 'no-match.md');
      mkdirSync(TEST_FILES_DIR, { recursive: true });
      writeFileSync(mdPath, '# Simple\n\nBasic content');

      await store.uploadFile(mdPath);
      const results = await store.search('xyznonexistent');
      expect(results.length).toBe(0);
    });
  });
});
