import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeStore } from '../rag/knowledge-store.js';
import { EmbeddingService } from '../rag/embeddings.js';
import { FileProcessor } from '../rag/file-processor.js';
import type { KbFileInfo } from '../rag/knowledge-store.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

vi.mock('../rag/embeddings.js', () => ({
  EmbeddingService: class MockEmbeddingService {
    generateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    getModelInfo = vi.fn().mockReturnValue({ model: 'text-embedding-004', provider: 'gemini', dimensions: 768 });
    cosineSimilarity = vi.fn().mockReturnValue(0.9);
    constructor(_config: any) {}
  },
}));

vi.mock('../rag/file-processor.js', () => ({
  FileProcessor: class MockFileProcessor {
    processFile = vi.fn();
    constructor() {}
  },
}));

function makeDb(overrides?: Record<string, any>) {
  return {
    getKbFileByName: vi.fn().mockReturnValue(undefined),
    deleteKbFile: vi.fn(),
    createKbFile: vi.fn(),
    updateKbFileStatus: vi.fn(),
    createKbChunk: vi.fn(),
    setKbChunkEmbedding: vi.fn(),
    getKbChunksWithoutEmbedding: vi.fn().mockReturnValue([]),
    getAllKbFiles: vi.fn().mockReturnValue([]),
    getKbFile: vi.fn().mockReturnValue(undefined),
    searchKbChunks: vi.fn().mockReturnValue([]),
    searchKbChunksSemantic: vi.fn().mockReturnValue([]),
    getKbChunkCount: vi.fn().mockReturnValue(0),
    ...overrides,
  } as any;
}

function makeConfig() {
  return {
    gemini: { apiKey: 'test-key' },
    embedding: { model: 'text-embedding-004' },
  } as any;
}

function makeProcessedFile(overrides?: Record<string, any>) {
  return {
    filePath: '/tmp/test.md',
    fileName: 'test.md',
    extension: '.md',
    totalChunks: 2,
    sizeBytes: 1024,
    chunks: [
      {
        sourceFile: '/tmp/test.md',
        sourceName: 'test.md',
        chunkIndex: 0,
        totalChunks: 2,
        content: 'First chunk content',
        sectionHeading: 'Intro',
      },
      {
        sourceFile: '/tmp/test.md',
        sourceName: 'test.md',
        chunkIndex: 1,
        totalChunks: 2,
        content: 'Second chunk content',
        sectionHeading: 'Body',
      },
    ],
    ...overrides,
  };
}

describe('KnowledgeStore', () => {
  let db: ReturnType<typeof makeDb>;
  let store: KnowledgeStore;
  let embeddingImpl: Extract<InstanceType<typeof EmbeddingService>, { generateEmbedding: any }>;
  let fpImpl: Extract<InstanceType<typeof FileProcessor>, { processFile: any }>;

  beforeEach(() => {
    db = makeDb();
    store = new KnowledgeStore(db, makeConfig());
    embeddingImpl = (store as any).embeddingService;
    fpImpl = (store as any).fileProcessor;
  });

  // ── uploadFile ─────────────────────────────────────────────

  describe('uploadFile', () => {
    it('should process file and store chunks with embeddings', async () => {
      fpImpl.processFile.mockReturnValue(makeProcessedFile());

      const result = await store.uploadFile('/tmp/test.md');

      expect(fpImpl.processFile).toHaveBeenCalledWith('/tmp/test.md');
      expect(db.createKbFile).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'test.md',
          fileExtension: '.md',
          fileSize: 1024,
          chunkCount: 2,
          status: 'processing',
        })
      );
      expect(db.createKbChunk).toHaveBeenCalledTimes(2);
      expect(db.createKbChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkIndex: 0,
          content: 'First chunk content',
          sectionHeading: 'Intro',
        })
      );
      expect(db.updateKbFileStatus).toHaveBeenCalledWith(
        expect.any(String),
        'ready'
      );
      expect(result.status).toBe('success');
      expect(result.totalChunks).toBe(2);
      expect(result.embeddedChunks).toBe(2);
    });

    it('should delete existing file with same name before re-upload', async () => {
      db.getKbFileByName.mockReturnValue({ id: 'existing-id', fileName: 'test.md' });
      fpImpl.processFile.mockReturnValue(makeProcessedFile());

      await store.uploadFile('/tmp/test.md');

      expect(db.deleteKbFile).toHaveBeenCalledWith('existing-id');
    });

    it('should return partial status when some embeddings fail', async () => {
      embeddingImpl.generateEmbedding
        .mockResolvedValueOnce([0.1, 0.2, 0.3])
        .mockResolvedValueOnce(null);
      fpImpl.processFile.mockReturnValue(makeProcessedFile());

      const result = await store.uploadFile('/tmp/test.md');

      expect(result.status).toBe('partial');
      expect(result.embeddedChunks).toBe(1);
    });

    it('should return failed status when no embeddings succeed', async () => {
      embeddingImpl.generateEmbedding.mockResolvedValue(null);
      fpImpl.processFile.mockReturnValue(makeProcessedFile());

      const result = await store.uploadFile('/tmp/test.md');

      expect(result.status).toBe('failed');
      expect(result.embeddedChunks).toBe(0);
    });

    it('should handle fileProcessor throwing an error', async () => {
      fpImpl.processFile.mockImplementation(() => { throw new Error('File not found'); });

      const result = await store.uploadFile('/tmp/missing.md');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('File not found');
      expect(result.totalChunks).toBe(0);
    });

    it('should handle embedding generation throwing an error gracefully', async () => {
      embeddingImpl.generateEmbedding
        .mockResolvedValueOnce([0.1])
        .mockRejectedValueOnce(new Error('API timeout'));
      fpImpl.processFile.mockReturnValue(makeProcessedFile());

      const result = await store.uploadFile('/tmp/test.md');

      expect(result.status).toBe('partial');
      expect(result.embeddedChunks).toBe(1);
      expect(db.createKbChunk).toHaveBeenCalledTimes(2);
    });

    it('should store chunks with line range info when present', async () => {
      fpImpl.processFile.mockReturnValue(makeProcessedFile({
        chunks: [
          {
            sourceFile: '/tmp/test.md',
            sourceName: 'test.md',
            chunkIndex: 0,
            totalChunks: 1,
            content: 'Chunk with lines',
            lineRange: { start: 1, end: 20 },
          },
        ],
        totalChunks: 1,
      }));

      await store.uploadFile('/tmp/test.md');

      expect(db.createKbChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          lineStart: 1,
          lineEnd: 20,
        })
      );
    });

    it('should generate a unique fileId', async () => {
      fpImpl.processFile.mockReturnValue(makeProcessedFile());

      const result1 = await store.uploadFile('/tmp/test.md');
      const result2 = await store.uploadFile('/tmp/test.md');

      expect(result1.fileId).not.toBe(result2.fileId);
      expect(result1.fileId).toMatch(/^kf_/);
    });
  });

  // ── search ─────────────────────────────────────────────────

  describe('search', () => {
    it('should return mapped search results', async () => {
      db.searchKbChunks.mockReturnValue([
        {
          chunkId: 'c1',
          fileId: 'f1',
          fileName: 'doc.md',
          sectionHeading: 'Intro',
          content: 'Some content',
          score: 0.85,
          matchedOn: 'semantic',
        },
      ]);

      const results = await store.search('what is AI');

      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe('c1');
      expect(results[0].score).toBe(0.85);
      expect(results[0].matchedOn).toBe('semantic');
      expect(db.searchKbChunks).toHaveBeenCalledWith('what is AI', expect.any(Array), 5, 0.3);
    });

    it('should pass custom maxResults and minScore', async () => {
      await store.search('query', 10, 0.5);

      expect(db.searchKbChunks).toHaveBeenCalledWith('query', expect.any(Array), 10, 0.5);
    });

    it('should fallback to keyword-only when embedding fails', async () => {
      embeddingImpl.generateEmbedding.mockRejectedValue(new Error('API down'));

      await store.search('query');

      expect(db.searchKbChunks).toHaveBeenCalledWith('query', null, 5, 0.3);
    });

    it('should return empty when no results', async () => {
      db.searchKbChunks.mockReturnValue([]);

      const results = await store.search('nonexistent');

      expect(results).toEqual([]);
    });
  });

  // ── searchSemantic ─────────────────────────────────────────

  describe('searchSemantic', () => {
    it('should call searchKbChunksSemantic and map results', async () => {
      db.searchKbChunksSemantic.mockReturnValue([
        {
          chunkId: 'sc1',
          fileId: 'f1',
          fileName: 'doc.md',
          sectionHeading: 'Section',
          content: 'Semantic match',
          score: 0.92,
        },
      ]);

      const results = await store.searchSemantic('machine learning');

      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe('sc1');
      expect(results[0].matchedOn).toBe('semantic');
      expect(results[0].score).toBe(0.92);
      expect(db.searchKbChunksSemantic).toHaveBeenCalledWith(
        expect.any(Array),
        5,
        0.3
      );
    });

    it('should pass custom parameters', async () => {
      await store.searchSemantic('query', 8, 0.4);

      expect(db.searchKbChunksSemantic).toHaveBeenCalledWith(
        expect.any(Array),
        8,
        0.4
      );
    });

    it('should return empty array when embedding returns null', async () => {
      embeddingImpl.generateEmbedding.mockResolvedValue(null);

      const results = await store.searchSemantic('query');

      expect(results).toEqual([]);
    });

    it('should return empty when no semantic matches', async () => {
      db.searchKbChunksSemantic.mockReturnValue([]);

      const results = await store.searchSemantic('query');

      expect(results).toEqual([]);
    });
  });

  // ── listFiles ──────────────────────────────────────────────

  describe('listFiles', () => {
    it('should return all files from db', () => {
      const mockFiles: KbFileInfo[] = [
        {
          id: 'f1',
          fileName: 'doc1.md',
          fileExtension: '.md',
          fileSize: 1024,
          chunkCount: 5,
          status: 'ready',
          createdAt: new Date(),
        },
        {
          id: 'f2',
          fileName: 'doc2.txt',
          fileExtension: '.txt',
          fileSize: 2048,
          chunkCount: 10,
          status: 'ready',
          createdAt: new Date(),
        },
      ];
      db.getAllKbFiles.mockReturnValue(mockFiles);

      const files = store.listFiles();

      expect(files).toHaveLength(2);
      expect(files[0].fileName).toBe('doc1.md');
      expect(files[1].fileName).toBe('doc2.txt');
    });

    it('should return empty array when no files', () => {
      db.getAllKbFiles.mockReturnValue([]);

      const files = store.listFiles();

      expect(files).toEqual([]);
    });
  });

  // ── getFile ────────────────────────────────────────────────

  describe('getFile', () => {
    it('should return file info by ID', () => {
      const mockFile = {
        id: 'f1',
        fileName: 'doc.md',
        fileExtension: '.md',
        fileSize: 1024,
        chunkCount: 3,
        status: 'ready',
        createdAt: new Date('2026-07-15'),
      };
      db.getKbFile.mockReturnValue(mockFile);

      const file = store.getFile('f1');

      expect(file).toEqual(
        expect.objectContaining({
          id: 'f1',
          fileName: 'doc.md',
          fileExtension: '.md',
          chunkCount: 3,
        })
      );
      expect(db.getKbFile).toHaveBeenCalledWith('f1');
    });

    it('should return undefined for non-existent file', () => {
      db.getKbFile.mockReturnValue(undefined);

      const file = store.getFile('nonexistent');

      expect(file).toBeUndefined();
    });
  });

  // ── deleteFile ─────────────────────────────────────────────

  describe('deleteFile', () => {
    it('should delete file and return true', () => {
      db.getKbFile.mockReturnValue({ id: 'f1', fileName: 'doc.md' });

      const deleted = store.deleteFile('f1');

      expect(deleted).toBe(true);
      expect(db.deleteKbFile).toHaveBeenCalledWith('f1');
    });

    it('should return false for non-existent file', () => {
      db.getKbFile.mockReturnValue(undefined);

      const deleted = store.deleteFile('nonexistent');

      expect(deleted).toBe(false);
      expect(db.deleteKbFile).not.toHaveBeenCalled();
    });
  });

  // ── deleteFileByName ───────────────────────────────────────

  describe('deleteFileByName', () => {
    it('should delete file by name and return true', () => {
      db.getKbFileByName.mockReturnValue({ id: 'f1', fileName: 'doc.md' });

      const deleted = store.deleteFileByName('doc.md');

      expect(deleted).toBe(true);
      expect(db.deleteKbFile).toHaveBeenCalledWith('f1');
    });

    it('should return false for non-existent file name', () => {
      db.getKbFileByName.mockReturnValue(undefined);

      const deleted = store.deleteFileByName('missing.md');

      expect(deleted).toBe(false);
      expect(db.deleteKbFile).not.toHaveBeenCalled();
    });
  });

  // ── getStats ───────────────────────────────────────────────

  describe('getStats', () => {
    it('should return file and chunk counts', () => {
      db.getAllKbFiles.mockReturnValue([{ id: 'f1' }, { id: 'f2' }]);
      db.getKbChunkCount.mockReturnValue(15);

      const stats = store.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalChunks).toBe(15);
    });

    it('should return zeros when empty', () => {
      db.getAllKbFiles.mockReturnValue([]);
      db.getKbChunkCount.mockReturnValue(0);

      const stats = store.getStats();

      expect(stats.totalFiles).toBe(0);
      expect(stats.totalChunks).toBe(0);
    });
  });

  // ── embedPendingChunks ─────────────────────────────────────

  describe('embedPendingChunks', () => {
    it('should embed all pending chunks', async () => {
      db.getKbChunksWithoutEmbedding.mockReturnValue([
        { id: 'c1', fileId: 'f1', content: 'chunk one' },
        { id: 'c2', fileId: 'f1', content: 'chunk two' },
      ]);

      const result = await store.embedPendingChunks();

      expect(result.total).toBe(2);
      expect(result.embedded).toBe(2);
      expect(result.failed).toBe(0);
      expect(db.setKbChunkEmbedding).toHaveBeenCalledTimes(2);
      expect(db.setKbChunkEmbedding).toHaveBeenCalledWith('c1', expect.any(Array));
      expect(db.setKbChunkEmbedding).toHaveBeenCalledWith('c2', expect.any(Array));
    });

    it('should return zeros when no pending chunks', async () => {
      db.getKbChunksWithoutEmbedding.mockReturnValue([]);

      const result = await store.embedPendingChunks();

      expect(result.total).toBe(0);
      expect(result.embedded).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should count failed embeddings', async () => {
      embeddingImpl.generateEmbedding
        .mockResolvedValueOnce([0.1])
        .mockRejectedValueOnce(new Error('fail'));

      db.getKbChunksWithoutEmbedding.mockReturnValue([
        { id: 'c1', fileId: 'f1', content: 'ok' },
        { id: 'c2', fileId: 'f1', content: 'fail' },
      ]);

      const result = await store.embedPendingChunks();

      expect(result.embedded).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('should count null embedding results as failed', async () => {
      embeddingImpl.generateEmbedding.mockResolvedValue(null);

      db.getKbChunksWithoutEmbedding.mockReturnValue([
        { id: 'c1', fileId: 'f1', content: 'text' },
      ]);

      const result = await store.embedPendingChunks();

      expect(result.embedded).toBe(0);
      expect(result.failed).toBe(1);
      expect(db.setKbChunkEmbedding).not.toHaveBeenCalled();
    });
  });
});
