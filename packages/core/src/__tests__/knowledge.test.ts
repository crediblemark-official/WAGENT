import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { unlinkSync, existsSync, mkdirSync } from 'fs';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

import { Database } from '../storage/index.js';
import {
  rowToKnowledgeEntry,
  cosineSimilarity,
  createKnowledgeEntry,
  getKnowledgeEntry,
  getAllKnowledgeEntries,
  searchKnowledge,
  searchKnowledgeSemantic,
  setKnowledgeEmbedding,
  getKnowledgeEntriesWithoutEmbedding,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeCategories,
  getKnowledgeCount,
  createKbFile,
  updateKbFileStatus,
  getKbFile,
  getKbFileByName,
  getAllKbFiles,
  deleteKbFile,
  createKbChunk,
  setKbChunkEmbedding,
  getKbChunksByFileId,
  getKbChunksWithoutEmbedding,
  searchKbChunksSemantic,
  searchKbChunksKeyword,
  searchKbChunksKeywordFallback,
  searchKbChunks,
  getKbChunkCount,
} from '../storage/knowledge.js';

let db: Database;
let rawDb: any;
let dbPath: string;

beforeEach(() => {
  dbPath = join(process.cwd(), 'tmp', `test-knowledge-${randomUUID()}.db`);
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  db = new Database(dbPath);
  rawDb = (db as any).db;
});

afterEach(() => {
  db.close();
  const resolved = join(process.cwd(), dbPath);
  for (const suffix of ['', '.db-journal', '.db-wal', '.db-shm']) {
    const f = resolved + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

function makeEntry(overrides: Partial<any> = {}) {
  const now = new Date();
  return {
    id: randomUUID(),
    category: 'faq',
    question: 'What is your price?',
    answer: 'Our price is Rp 50.000',
    keywords: ['price', 'cost', 'pricing'],
    tags: ['pricing'],
    priority: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeKbFile(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    fileName: 'doc.pdf',
    filePath: '/files/doc.pdf',
    fileExtension: '.pdf',
    fileSize: 1024,
    chunkCount: 3,
    ...overrides,
  };
}

function makeKbChunk(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    fileId: 'nonexistent',
    chunkIndex: 0,
    content: 'Some content about pricing and products',
    ...overrides,
  };
}

// ── rowToKnowledgeEntry ───────────────────────────────────────

describe('rowToKnowledgeEntry', () => {
  it('converts a full row with embedding', () => {
    const row = {
      id: 'k1',
      category: 'faq',
      question: 'Q?',
      answer: 'A',
      keywords: '["a","b"]',
      tags: '["t1"]',
      priority: 2,
      embedding: '[0.1,0.2,0.3]',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-06-01T00:00:00.000Z',
    };
    const entry = rowToKnowledgeEntry(row);
    expect(entry.id).toBe('k1');
    expect(entry.category).toBe('faq');
    expect(entry.question).toBe('Q?');
    expect(entry.answer).toBe('A');
    expect(entry.keywords).toEqual(['a', 'b']);
    expect(entry.tags).toEqual(['t1']);
    expect(entry.priority).toBe(2);
    expect(entry.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.updatedAt).toBeInstanceOf(Date);
  });

  it('handles row without embedding', () => {
    const row = {
      id: 'k2', category: 'gen', question: 'Q', answer: 'A',
      keywords: '[]', tags: '[]', priority: 0,
      embedding: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    const entry = rowToKnowledgeEntry(row);
    expect(entry.embedding).toBeUndefined();
  });

  it('handles empty keywords and tags strings', () => {
    const row = {
      id: 'k3', category: 'gen', question: 'Q', answer: 'A',
      keywords: '', tags: '', priority: 0,
      embedding: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    const entry = rowToKnowledgeEntry(row);
    expect(entry.keywords).toEqual([]);
    expect(entry.tags).toEqual([]);
  });
});

// ── cosineSimilarity ──────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns 0 for different length vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('computes correct similarity for non-trivial vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.9746, 3);
  });
});

// ── createKnowledgeEntry / getKnowledgeEntry ──────────────────

describe('createKnowledgeEntry', () => {
  it('creates and retrieves an entry with embedding', () => {
    const entry = makeEntry({ embedding: [0.1, 0.2, 0.3] });
    createKnowledgeEntry(rawDb, entry);
    const got = getKnowledgeEntry(rawDb, entry.id);
    expect(got).toBeDefined();
    expect(got!.id).toBe(entry.id);
    expect(got!.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(got!.keywords).toEqual(entry.keywords);
  });

  it('creates an entry without embedding', () => {
    const entry = makeEntry();
    createKnowledgeEntry(rawDb, entry);
    const got = getKnowledgeEntry(rawDb, entry.id);
    expect(got).toBeDefined();
    expect(got!.embedding).toBeUndefined();
  });
});

describe('getKnowledgeEntry', () => {
  it('returns undefined for nonexistent id', () => {
    expect(getKnowledgeEntry(rawDb, 'nonexistent')).toBeUndefined();
  });
});

// ── getAllKnowledgeEntries ────────────────────────────────────

describe('getAllKnowledgeEntries', () => {
  it('returns all entries without category filter', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', category: 'faq' }));
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k2', category: 'pricing' }));
    const all = getAllKnowledgeEntries(rawDb);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by category', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', category: 'faq' }));
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k2', category: 'pricing' }));
    const faqOnly = getAllKnowledgeEntries(rawDb, 'faq');
    expect(faqOnly.length).toBe(1);
    expect(faqOnly[0].category).toBe('faq');
  });

  it('returns empty array for nonexistent category', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', category: 'faq' }));
    const results = getAllKnowledgeEntries(rawDb, 'nonexistent');
    expect(results).toEqual([]);
  });
});

// ── searchKnowledge ───────────────────────────────────────────

describe('searchKnowledge', () => {
  beforeEach(() => {
    createKnowledgeEntry(rawDb, makeEntry({
      id: 'k1', category: 'pricing', question: 'How much does it cost?',
      answer: 'Our price is Rp 50.000 per month.', keywords: ['price', 'cost'],
      tags: ['pricing'], priority: 1,
    }));
    createKnowledgeEntry(rawDb, makeEntry({
      id: 'k2', category: 'support', question: 'How to contact support?',
      answer: 'Email us at support@example.com', keywords: ['support', 'contact'],
      tags: ['support'], priority: 0,
    }));
  });

  it('matches by keyword', () => {
    const results = searchKnowledge(rawDb, 'price');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.id).toBe('k1');
    expect(results[0].matchedOn).toBe('keyword');
  });

  it('matches by question words', () => {
    const results = searchKnowledge(rawDb, 'contact support');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.id).toBe('k2');
  });

  it('matches by answer words', () => {
    const results = searchKnowledge(rawDb, 'email');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.id).toBe('k2');
    expect(results[0].matchedOn).toBe('answer');
  });

  it('boosts priority entries', () => {
    createKnowledgeEntry(rawDb, makeEntry({
      id: 'k3', category: 'pricing', question: 'What is the price?',
      answer: 'Rp 100.000', keywords: ['price'],
      tags: [], priority: 10,
    }));
    const results = searchKnowledge(rawDb, 'price');
    expect(results[0].entry.id).toBe('k3');
  });

  it('returns empty for no match', () => {
    const results = searchKnowledge(rawDb, 'zzzznonexistent');
    expect(results).toEqual([]);
  });

  it('respects maxResults limit', () => {
    for (let i = 0; i < 10; i++) {
      createKnowledgeEntry(rawDb, makeEntry({
        id: `extra-${i}`, question: `Question ${i} about price`,
        answer: `Answer ${i}`, keywords: ['price'],
      }));
    }
    const results = searchKnowledge(rawDb, 'price', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ── searchKnowledgeSemantic ───────────────────────────────────

describe('searchKnowledgeSemantic', () => {
  it('returns empty when no entries have embeddings', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1' }));
    const results = searchKnowledgeSemantic(rawDb, [0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
  });

  it('finds similar entries with embeddings', () => {
    createKnowledgeEntry(rawDb, makeEntry({
      id: 'k1', embedding: [1, 0, 0],
    }));
    createKnowledgeEntry(rawDb, makeEntry({
      id: 'k2', embedding: [0.9, 0.1, 0],
    }));
    const results = searchKnowledgeSemantic(rawDb, [1, 0, 0], 5, 0.5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchedOn).toBe('semantic');
  });

  it('filters by minScore', () => {
    createKnowledgeEntry(rawDb, makeEntry({
      id: 'k1', embedding: [0, 1, 0],
    }));
    const results = searchKnowledgeSemantic(rawDb, [1, 0, 0], 5, 0.9);
    expect(results).toEqual([]);
  });

  it('respects maxResults', () => {
    for (let i = 0; i < 5; i++) {
      createKnowledgeEntry(rawDb, makeEntry({
        id: `k${i}`, embedding: [0.9, 0.1, i * 0.01],
      }));
    }
    const results = searchKnowledgeSemantic(rawDb, [1, 0, 0], 2, 0.1);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ── setKnowledgeEmbedding ─────────────────────────────────────

describe('setKnowledgeEmbedding', () => {
  it('sets embedding on an entry', () => {
    const entry = makeEntry({ id: 'k1' });
    createKnowledgeEntry(rawDb, entry);
    setKnowledgeEmbedding(rawDb, 'k1', [0.5, 0.6, 0.7]);
    const got = getKnowledgeEntry(rawDb, 'k1');
    expect(got!.embedding).toEqual([0.5, 0.6, 0.7]);
  });
});

// ── getKnowledgeEntriesWithoutEmbedding ───────────────────────

describe('getKnowledgeEntriesWithoutEmbedding', () => {
  it('returns only entries without embeddings', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', embedding: [0.1] }));
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k2' }));
    const without = getKnowledgeEntriesWithoutEmbedding(rawDb);
    expect(without.length).toBe(1);
    expect(without[0].id).toBe('k2');
  });

  it('returns empty when all have embeddings', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', embedding: [0.1] }));
    expect(getKnowledgeEntriesWithoutEmbedding(rawDb)).toEqual([]);
  });
});

// ── updateKnowledgeEntry ──────────────────────────────────────

describe('updateKnowledgeEntry', () => {
  it('updates question only', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', question: 'Old Q' }));
    updateKnowledgeEntry(rawDb, 'k1', { question: 'New Q' });
    expect(getKnowledgeEntry(rawDb, 'k1')!.question).toBe('New Q');
  });

  it('updates answer only', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', answer: 'Old A' }));
    updateKnowledgeEntry(rawDb, 'k1', { answer: 'New A' });
    expect(getKnowledgeEntry(rawDb, 'k1')!.answer).toBe('New A');
  });

  it('updates keywords', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', keywords: ['old'] }));
    updateKnowledgeEntry(rawDb, 'k1', { keywords: ['new', 'fresh'] });
    expect(getKnowledgeEntry(rawDb, 'k1')!.keywords).toEqual(['new', 'fresh']);
  });

  it('updates tags', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', tags: ['a'] }));
    updateKnowledgeEntry(rawDb, 'k1', { tags: ['b', 'c'] });
    expect(getKnowledgeEntry(rawDb, 'k1')!.tags).toEqual(['b', 'c']);
  });

  it('updates priority', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', priority: 0 }));
    updateKnowledgeEntry(rawDb, 'k1', { priority: 5 });
    expect(getKnowledgeEntry(rawDb, 'k1')!.priority).toBe(5);
  });

  it('updates category', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', category: 'old' }));
    updateKnowledgeEntry(rawDb, 'k1', { category: 'new' });
    expect(getKnowledgeEntry(rawDb, 'k1')!.category).toBe('new');
  });

  it('updates embedding', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1' }));
    updateKnowledgeEntry(rawDb, 'k1', { embedding: [1, 2, 3] });
    expect(getKnowledgeEntry(rawDb, 'k1')!.embedding).toEqual([1, 2, 3]);
  });

  it('updates multiple fields at once', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', question: 'Q', answer: 'A', priority: 0 }));
    updateKnowledgeEntry(rawDb, 'k1', { question: 'New Q', answer: 'New A', priority: 9 });
    const got = getKnowledgeEntry(rawDb, 'k1')!;
    expect(got.question).toBe('New Q');
    expect(got.answer).toBe('New A');
    expect(got.priority).toBe(9);
  });
});

// ── deleteKnowledgeEntry ──────────────────────────────────────

describe('deleteKnowledgeEntry', () => {
  it('deletes an entry', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1' }));
    expect(getKnowledgeEntry(rawDb, 'k1')).toBeDefined();
    deleteKnowledgeEntry(rawDb, 'k1');
    expect(getKnowledgeEntry(rawDb, 'k1')).toBeUndefined();
  });
});

// ── getKnowledgeCategories ────────────────────────────────────

describe('getKnowledgeCategories', () => {
  it('returns distinct sorted categories', () => {
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1', category: 'pricing' }));
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k2', category: 'faq' }));
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k3', category: 'pricing' }));
    const cats = getKnowledgeCategories(rawDb);
    expect(cats).toContain('faq');
    expect(cats).toContain('pricing');
    expect(cats).toEqual([...cats].sort());
  });
});

// ── getKnowledgeCount ─────────────────────────────────────────

describe('getKnowledgeCount', () => {
  it('returns correct count', () => {
    expect(getKnowledgeCount(rawDb)).toBe(0);
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k1' }));
    createKnowledgeEntry(rawDb, makeEntry({ id: 'k2' }));
    expect(getKnowledgeCount(rawDb)).toBe(2);
  });
});

// ── KB Files ──────────────────────────────────────────────────

describe('KB Files', () => {
  it('createKbFile and getKbFile', () => {
    const file = makeKbFile({ id: 'f1', fileName: 'test.pdf' });
    createKbFile(rawDb, file);
    const got = getKbFile(rawDb, 'f1');
    expect(got).toBeDefined();
    expect(got!.fileName).toBe('test.pdf');
    expect(got!.filePath).toBe('/files/doc.pdf');
    expect(got!.status).toBe('uploaded');
    expect(got!.createdAt).toBeInstanceOf(Date);
  });

  it('createKbFile with custom status', () => {
    const file = makeKbFile({ id: 'f2', status: 'processing' });
    createKbFile(rawDb, file);
    expect(getKbFile(rawDb, 'f2')!.status).toBe('processing');
  });

  it('updateKbFileStatus without error', () => {
    createKbFile(rawDb, makeKbFile({ id: 'f1' }));
    updateKbFileStatus(rawDb, 'f1', 'completed');
    const got = getKbFile(rawDb, 'f1')!;
    expect(got.status).toBe('completed');
    expect(got.error).toBeUndefined();
  });

  it('updateKbFileStatus with error', () => {
    createKbFile(rawDb, makeKbFile({ id: 'f1' }));
    updateKbFileStatus(rawDb, 'f1', 'failed', 'Parse error');
    const got = getKbFile(rawDb, 'f1')!;
    expect(got.status).toBe('failed');
    expect(got.error).toBe('Parse error');
  });

  it('getKbFile returns undefined for nonexistent', () => {
    expect(getKbFile(rawDb, 'nonexistent')).toBeUndefined();
  });

  it('getKbFileByName', () => {
    createKbFile(rawDb, makeKbFile({ id: 'f1', fileName: 'report.xlsx' }));
    const got = getKbFileByName(rawDb, 'report.xlsx');
    expect(got).toBeDefined();
    expect(got!.id).toBe('f1');
    expect(got!.fileName).toBe('report.xlsx');
  });

  it('getKbFileByName returns undefined for nonexistent', () => {
    expect(getKbFileByName(rawDb, 'nope.pdf')).toBeUndefined();
  });

  it('getAllKbFiles returns all files', () => {
    createKbFile(rawDb, makeKbFile({ id: 'f1', fileName: 'a.pdf' }));
    createKbFile(rawDb, makeKbFile({ id: 'f2', fileName: 'b.pdf' }));
    const all = getAllKbFiles(rawDb);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('deleteKbFile removes file', () => {
    createKbFile(rawDb, makeKbFile({ id: 'f1' }));
    expect(getKbFile(rawDb, 'f1')).toBeDefined();
    deleteKbFile(rawDb, 'f1');
    expect(getKbFile(rawDb, 'f1')).toBeUndefined();
  });
});

// ── FK Cascade: deleteKbFile cascades chunks ──────────────────

describe('FK cascade', () => {
  it('deleting kb_file cascades to kb_chunks', () => {
    const fileId = 'file-cascade-test';
    createKbFile(rawDb, makeKbFile({ id: fileId, chunkCount: 2 }));
    createKbChunk(rawDb, makeKbChunk({ id: 'chunk1', fileId, chunkIndex: 0, content: 'Part 1' }));
    createKbChunk(rawDb, makeKbChunk({ id: 'chunk2', fileId, chunkIndex: 1, content: 'Part 2' }));
    expect(getKbChunksByFileId(rawDb, fileId).length).toBe(2);

    deleteKbFile(rawDb, fileId);
    expect(getKbFile(rawDb, fileId)).toBeUndefined();
    expect(getKbChunksByFileId(rawDb, fileId).length).toBe(0);
  });
});

// ── KB Chunks ─────────────────────────────────────────────────

describe('KB Chunks', () => {
  const fileId = 'file-chunk-test';

  beforeEach(() => {
    createKbFile(rawDb, makeKbFile({ id: fileId, chunkCount: 3 }));
  });

  it('createKbChunk with optional fields', () => {
    createKbChunk(rawDb, makeKbChunk({
      id: 'c1', fileId, chunkIndex: 0, content: 'Content A',
      sectionHeading: 'Intro', rowNumber: 1, lineStart: 0, lineEnd: 10,
    }));
    const chunks = getKbChunksByFileId(rawDb, fileId);
    expect(chunks.length).toBe(1);
    expect(chunks[0].sectionHeading).toBe('Intro');
  });

  it('createKbChunk without optional fields', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'Basic' }));
    const chunks = getKbChunksByFileId(rawDb, fileId);
    expect(chunks.length).toBe(1);
    expect(chunks[0].sectionHeading).toBeUndefined();
  });

  it('createKbChunk with embedding', () => {
    createKbChunk(rawDb, makeKbChunk({
      id: 'c1', fileId, chunkIndex: 0, content: 'Embed', embedding: [0.1, 0.2],
    }));
    const chunks = getKbChunksByFileId(rawDb, fileId);
    expect(chunks[0].embedding).toEqual([0.1, 0.2]);
  });

  it('setKbChunkEmbedding', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'X' }));
    setKbChunkEmbedding(rawDb, 'c1', [0.5, 0.6, 0.7]);
    const chunks = getKbChunksByFileId(rawDb, fileId);
    expect(chunks[0].embedding).toEqual([0.5, 0.6, 0.7]);
  });

  it('getKbChunksWithoutEmbedding', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'No emb', embedding: [0.1] }));
    createKbChunk(rawDb, makeKbChunk({ id: 'c2', fileId, chunkIndex: 1, content: 'Has emb', embedding: undefined }));
    const without = getKbChunksWithoutEmbedding(rawDb);
    expect(without.some(c => c.id === 'c2')).toBe(true);
  });

  it('searchKbChunksSemantic finds similar chunks', () => {
    createKbChunk(rawDb, makeKbChunk({
      id: 'c1', fileId, chunkIndex: 0, content: 'About cats', embedding: [1, 0, 0],
    }));
    createKbChunk(rawDb, makeKbChunk({
      id: 'c2', fileId, chunkIndex: 1, content: 'About dogs', embedding: [0, 1, 0],
    }));
    const results = searchKbChunksSemantic(rawDb, [1, 0, 0], 5, 0.5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chunkId).toBe('c1');
  });

  it('searchKbChunksSemantic returns empty when no embeddings', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'Plain' }));
    expect(searchKbChunksSemantic(rawDb, [1, 0, 0])).toEqual([]);
  });

  it('searchKbChunksSemantic filters by minScore', () => {
    createKbChunk(rawDb, makeKbChunk({
      id: 'c1', fileId, chunkIndex: 0, content: 'X', embedding: [0, 1, 0],
    }));
    expect(searchKbChunksSemantic(rawDb, [1, 0, 0], 5, 0.9)).toEqual([]);
  });

  it('searchKbChunksSemantic respects maxResults', () => {
    for (let i = 0; i < 5; i++) {
      createKbChunk(rawDb, makeKbChunk({
        id: `c${i}`, fileId, chunkIndex: i, content: `Chunk ${i}`,
        embedding: [0.9, 0.1, i * 0.01],
      }));
    }
    const results = searchKbChunksSemantic(rawDb, [1, 0, 0], 2, 0.1);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('searchKbChunksKeyword via FTS', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'pricing information here' }));
    createKbChunk(rawDb, makeKbChunk({ id: 'c2', fileId, chunkIndex: 1, content: 'support contact info' }));
    const results = searchKbChunksKeyword(rawDb, 'pricing', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('pricing');
  });

  it('searchKbChunksKeywordFallback via substring', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'hello world testing' }));
    createKbChunk(rawDb, makeKbChunk({ id: 'c2', fileId, chunkIndex: 1, content: 'something else' }));
    const results = searchKbChunksKeywordFallback(rawDb, 'hello', 5);
    expect(results.length).toBe(1);
    expect(results[0].chunkId).toBe('c1');
  });

  it('searchKbChunksKeywordFallback returns empty for no match', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'abc' }));
    expect(searchKbChunksKeywordFallback(rawDb, 'zzz', 5)).toEqual([]);
  });

  it('searchKbChunksKeywordFallback ignores short words', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'a b c' }));
    expect(searchKbChunksKeywordFallback(rawDb, 'a', 5)).toEqual([]);
  });

  it('searchKbChunksKeywordFallback respects maxResults', () => {
    for (let i = 0; i < 5; i++) {
      createKbChunk(rawDb, makeKbChunk({
        id: `c${i}`, fileId, chunkIndex: i, content: `pricing chunk number ${i}`,
      }));
    }
    const results = searchKbChunksKeywordFallback(rawDb, 'pricing', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('searchKbChunks combined with semantic + keyword', () => {
    createKbChunk(rawDb, makeKbChunk({
      id: 'c1', fileId, chunkIndex: 0, content: 'pricing details', embedding: [1, 0, 0],
    }));
    createKbChunk(rawDb, makeKbChunk({
      id: 'c2', fileId, chunkIndex: 1, content: 'other stuff', embedding: [0, 1, 0],
    }));
    const results = searchKbChunks(rawDb, 'pricing', [1, 0, 0], 5, 0.3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchedOn).toBeDefined();
  });

  it('searchKbChunks keyword-only (no embedding)', () => {
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'pricing page info' }));
    const results = searchKbChunks(rawDb, 'pricing', null, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchedOn).toBe('keyword');
  });

  it('getKbChunkCount', () => {
    expect(getKbChunkCount(rawDb)).toBe(0);
    createKbChunk(rawDb, makeKbChunk({ id: 'c1', fileId, chunkIndex: 0, content: 'A' }));
    createKbChunk(rawDb, makeKbChunk({ id: 'c2', fileId, chunkIndex: 1, content: 'B' }));
    expect(getKbChunkCount(rawDb)).toBe(2);
  });
});
