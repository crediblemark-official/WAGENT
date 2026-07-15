import BetterSqlite3 from 'better-sqlite3';
import { KnowledgeEntry, KnowledgeSearchResult } from '../types.js';
import { getLogger } from '../logger.js';

// ── Helper Row Converter ──────────────────────────────────────────

export function rowToKnowledgeEntry(row: any): KnowledgeEntry {
  return {
    id: row.id,
    category: row.category,
    question: row.question,
    answer: row.answer,
    keywords: JSON.parse(row.keywords || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    priority: row.priority,
    embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ── Cosine Similarity ─────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// ── Knowledge Base ────────────────────────────────────────────

export function createKnowledgeEntry(db: BetterSqlite3.Database, entry: KnowledgeEntry): void {
  db.prepare(`
    INSERT INTO knowledge_base (id, category, question, answer, keywords, tags, priority, embedding, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id, entry.category, entry.question, entry.answer,
    JSON.stringify(entry.keywords), JSON.stringify(entry.tags),
    entry.priority,
    entry.embedding ? JSON.stringify(entry.embedding) : null,
    entry.createdAt.toISOString(), entry.updatedAt.toISOString()
  );
}

export function getKnowledgeEntry(db: BetterSqlite3.Database, id: string): KnowledgeEntry | undefined {
  const row = db.prepare('SELECT * FROM knowledge_base WHERE id = ?').get(id) as any;
  return row ? rowToKnowledgeEntry(row) : undefined;
}

export function getAllKnowledgeEntries(db: BetterSqlite3.Database, category?: string): KnowledgeEntry[] {
  let rows: any[];
  if (category) {
    rows = db.prepare(
      'SELECT * FROM knowledge_base WHERE category = ? ORDER BY priority DESC, created_at DESC'
    ).all(category) as any[];
  } else {
    rows = db.prepare(
      'SELECT * FROM knowledge_base ORDER BY priority DESC, created_at DESC'
    ).all() as any[];
  }
  return rows.map(rowToKnowledgeEntry);
}

export function searchKnowledge(db: BetterSqlite3.Database, query: string, maxResults = 5): KnowledgeSearchResult[] {
  const results: KnowledgeSearchResult[] = [];
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

  const allEntries = db.prepare(
    'SELECT * FROM knowledge_base ORDER BY priority DESC'
  ).all() as any[];

  for (const row of allEntries) {
    const entry = rowToKnowledgeEntry(row);
    let bestScore = 0;
    let matchedOn: 'keyword' | 'question' | 'answer' = 'keyword';

    const entryKeywords = entry.keywords.map(k => k.toLowerCase());
    const keywordMatches = entryKeywords.filter(k =>
      queryWords.some(qw => k.includes(qw) || qw.includes(k))
    ).length;
    if (keywordMatches > 0) {
      const score = keywordMatches / Math.max(entryKeywords.length, 1);
      if (score > bestScore) {
        bestScore = score;
        matchedOn = 'keyword';
      }
    }

    const questionLower = entry.question.toLowerCase();
    const questionWordMatches = queryWords.filter(qw => questionLower.includes(qw)).length;
    if (questionWordMatches > 0) {
      const score = questionWordMatches / Math.max(queryWords.length, 1) * 0.8;
      if (score > bestScore) {
        bestScore = score;
        matchedOn = 'question';
      }
    }

    const answerLower = entry.answer.toLowerCase();
    const answerWordMatches = queryWords.filter(qw => answerLower.includes(qw)).length;
    if (answerWordMatches > 0) {
      const score = answerWordMatches / Math.max(queryWords.length, 1) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        matchedOn = 'answer';
      }
    }

    if (entry.priority > 0) {
      bestScore = bestScore * (1 + entry.priority * 0.1);
    }

    if (bestScore > 0) {
      results.push({ entry, score: Math.min(bestScore, 1), matchedOn });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function searchKnowledgeSemantic(
  db: BetterSqlite3.Database,
  queryEmbedding: number[],
  maxResults = 5,
  minScore = 0.3,
): KnowledgeSearchResult[] {
  const results: KnowledgeSearchResult[] = [];

  const allEntries = db.prepare(
    'SELECT id, embedding FROM knowledge_base WHERE embedding IS NOT NULL'
  ).all() as any[];

  if (allEntries.length === 0) {
    return [];
  }

  for (const row of allEntries) {
    const storedEmbedding: number[] = JSON.parse(row.embedding);
    if (!Array.isArray(storedEmbedding) || storedEmbedding.length === 0) continue;

    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);

    if (similarity >= minScore) {
      const entry = getKnowledgeEntry(db, row.id);
      if (entry) {
        results.push({ entry, score: similarity, matchedOn: 'semantic' });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function setKnowledgeEmbedding(db: BetterSqlite3.Database, id: string, embedding: number[]): void {
  db.prepare('UPDATE knowledge_base SET embedding = ? WHERE id = ?')
    .run(JSON.stringify(embedding), id);
}

export function getKnowledgeEntriesWithoutEmbedding(db: BetterSqlite3.Database): KnowledgeEntry[] {
  const rows = db.prepare(
    'SELECT * FROM knowledge_base WHERE embedding IS NULL'
  ).all() as any[];
  return rows.map(rowToKnowledgeEntry);
}

export function updateKnowledgeEntry(db: BetterSqlite3.Database, id: string, updates: Partial<KnowledgeEntry>): void {
  const fields: string[] = [];
  const params: any[] = [];

  if (updates.category !== undefined) { fields.push('category = ?'); params.push(updates.category); }
  if (updates.question !== undefined) { fields.push('question = ?'); params.push(updates.question); }
  if (updates.answer !== undefined) { fields.push('answer = ?'); params.push(updates.answer); }
  if (updates.keywords !== undefined) { fields.push('keywords = ?'); params.push(JSON.stringify(updates.keywords)); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); params.push(updates.priority); }
  if (updates.embedding !== undefined) { fields.push('embedding = ?'); params.push(JSON.stringify(updates.embedding)); }

  fields.push("updated_at = datetime('now')");
  params.push(id);

  if (fields.length > 1) {
    db.prepare(`UPDATE knowledge_base SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }
}

export function deleteKnowledgeEntry(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(id);
}

export function getKnowledgeCategories(db: BetterSqlite3.Database): string[] {
  const rows = db.prepare(
    'SELECT DISTINCT category FROM knowledge_base ORDER BY category'
  ).all() as any[];
  return rows.map(r => r.category);
}

export function getKnowledgeCount(db: BetterSqlite3.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get() as any;
  return row.count;
}

// ── KB Files ──────────────────────────────────────────────────

export function createKbFile(db: BetterSqlite3.Database, file: { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status?: string }): void {
  db.prepare(`
    INSERT INTO kb_files (id, file_name, file_path, file_extension, file_size, chunk_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(file.id, file.fileName, file.filePath, file.fileExtension, file.fileSize, file.chunkCount, file.status || 'uploaded');
}

export function updateKbFileStatus(db: BetterSqlite3.Database, id: string, status: string, error?: string): void {
  const fields = ['status = ?', "updated_at = datetime('now')"];
  const params: any[] = [status];
  if (error !== undefined) { fields.push('error = ?'); params.push(error); }
  params.push(id);
  db.prepare(`UPDATE kb_files SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function getKbFile(db: BetterSqlite3.Database, id: string): { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string; error?: string; createdAt: Date; updatedAt: Date } | undefined {
  const row = db.prepare('SELECT * FROM kb_files WHERE id = ?').get(id) as any;
  return row ? {
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileExtension: row.file_extension,
    fileSize: row.file_size,
    chunkCount: row.chunk_count,
    status: row.status,
    error: row.error || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  } : undefined;
}

export function getKbFileByName(db: BetterSqlite3.Database, fileName: string): { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string } | undefined {
  const row = db.prepare('SELECT * FROM kb_files WHERE file_name = ?').get(fileName) as any;
  return row ? {
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileExtension: row.file_extension,
    fileSize: row.file_size,
    chunkCount: row.chunk_count,
    status: row.status,
  } : undefined;
}

export function getAllKbFiles(db: BetterSqlite3.Database): Array<{ id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string; createdAt: Date }> {
  const rows = db.prepare('SELECT * FROM kb_files ORDER BY created_at DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    fileName: r.file_name,
    filePath: r.file_path,
    fileExtension: r.file_extension,
    fileSize: r.file_size,
    chunkCount: r.chunk_count,
    status: r.status,
    createdAt: new Date(r.created_at),
  }));
}

export function deleteKbFile(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM kb_files WHERE id = ?').run(id);
}

// ── KB Chunks ────────────────────────────────────────────────

export function createKbChunk(db: BetterSqlite3.Database, chunk: { id: string; fileId: string; chunkIndex: number; content: string; sectionHeading?: string; rowNumber?: number; lineStart?: number; lineEnd?: number; embedding?: number[] }): void {
  db.prepare(`
    INSERT INTO kb_chunks (id, file_id, chunk_index, content, section_heading, row_number, line_start, line_end, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chunk.id, chunk.fileId, chunk.chunkIndex, chunk.content,
    chunk.sectionHeading || null, chunk.rowNumber || null,
    chunk.lineStart || null, chunk.lineEnd || null,
    chunk.embedding ? JSON.stringify(chunk.embedding) : null,
  );
}

export function setKbChunkEmbedding(db: BetterSqlite3.Database, id: string, embedding: number[]): void {
  db.prepare('UPDATE kb_chunks SET embedding = ? WHERE id = ?')
    .run(JSON.stringify(embedding), id);
}

export function getKbChunksByFileId(db: BetterSqlite3.Database, fileId: string): Array<{ id: string; fileId: string; chunkIndex: number; content: string; sectionHeading?: string; embedding?: number[] }> {
  const rows = db.prepare('SELECT * FROM kb_chunks WHERE file_id = ? ORDER BY chunk_index').all(fileId) as any[];
  return rows.map(r => ({
    id: r.id,
    fileId: r.file_id,
    chunkIndex: r.chunk_index,
    content: r.content,
    sectionHeading: r.section_heading || undefined,
    embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
  }));
}

export function getKbChunksWithoutEmbedding(db: BetterSqlite3.Database): Array<{ id: string; fileId: string; content: string }> {
  const rows = db.prepare('SELECT id, file_id, content FROM kb_chunks WHERE embedding IS NULL').all() as any[];
  return rows.map(r => ({ id: r.id, fileId: r.file_id, content: r.content }));
}

export function searchKbChunksSemantic(db: BetterSqlite3.Database, queryEmbedding: number[], maxResults = 5, minScore = 0.3): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
  const results: Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> = [];

  const rows = db.prepare(
    `SELECT c.id, c.file_id, c.content, c.section_heading, c.embedding, f.file_name
     FROM kb_chunks c
     LEFT JOIN kb_files f ON c.file_id = f.id
     WHERE c.embedding IS NOT NULL`
  ).all() as any[];

  if (rows.length === 0) return results;

  for (const row of rows) {
    const storedEmbedding: number[] = JSON.parse(row.embedding);
    if (!Array.isArray(storedEmbedding) || storedEmbedding.length === 0) continue;

    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
    if (similarity >= minScore) {
      results.push({
        chunkId: row.id,
        fileId: row.file_id,
        content: row.content,
        sectionHeading: row.section_heading || undefined,
        score: similarity,
        fileName: row.file_name || undefined,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function searchKbChunksKeyword(db: BetterSqlite3.Database, query: string, maxResults = 5): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
  const results: Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> = [];
  
  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  
  if (queryWords.length === 0) return results;

  const ftsQuery = queryWords.join(' AND ');

  try {
    const rows = db.prepare(`
      SELECT 
        fts.rowid,
        fts.rank,
        c.id,
        c.file_id,
        c.content,
        c.section_heading,
        f.file_name
      FROM kb_chunks_fts fts
      JOIN kb_chunks c ON c.rowid = fts.rowid
      LEFT JOIN kb_files f ON c.file_id = f.id
      WHERE kb_chunks_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(ftsQuery, maxResults) as any[];

    for (const row of rows) {
      const score = Math.min(1, Math.max(0, 1 + row.rank / 10));
      results.push({
        chunkId: row.id,
        fileId: row.file_id,
        content: row.content,
        sectionHeading: row.section_heading || undefined,
        score,
        fileName: row.file_name || undefined,
      });
    }
  } catch (err: any) {
    getLogger().warn({ error: err.message }, 'FTS5 search failed, falling back to substring');
    return searchKbChunksKeywordFallback(db, query, maxResults);
  }

  return results;
}

export function searchKbChunksKeywordFallback(db: BetterSqlite3.Database, query: string, maxResults: number): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
  const results: Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> = [];
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);

  if (queryWords.length === 0) return results;

  const rows = db.prepare(
    `SELECT c.id, c.file_id, c.content, c.section_heading, f.file_name
     FROM kb_chunks c
     LEFT JOIN kb_files f ON c.file_id = f.id`
  ).all() as any[];

  for (const row of rows) {
    const contentLower = row.content.toLowerCase();
    let matches = 0;

    for (const word of queryWords) {
      if (contentLower.includes(word)) matches++;
    }

    if (matches > 0) {
      const score = matches / queryWords.length;
      results.push({
        chunkId: row.id,
        fileId: row.file_id,
        content: row.content,
        sectionHeading: row.section_heading || undefined,
        score,
        fileName: row.file_name || undefined,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function searchKbChunks(
  db: BetterSqlite3.Database,
  query: string,
  queryEmbedding: number[] | null,
  maxResults = 5,
  minScore = 0.3,
): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; matchedOn: 'semantic' | 'keyword' | 'combined'; fileName?: string }> {
  const resultMap = new Map<string, { chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; matchedOn: 'semantic' | 'keyword' | 'combined'; fileName?: string }>();

  if (queryEmbedding) {
    const semanticResults = searchKbChunksSemantic(db, queryEmbedding, maxResults * 2, minScore);
    for (const r of semanticResults) {
      resultMap.set(r.chunkId, {
        ...r,
        score: r.score * 0.7,
        matchedOn: 'semantic',
      });
    }
  }

  const keywordResults = searchKbChunksKeyword(db, query, maxResults * 2);
  for (const r of keywordResults) {
    const existing = resultMap.get(r.chunkId);
    if (existing) {
      existing.score += r.score * 0.3;
      existing.matchedOn = 'combined';
    } else {
      resultMap.set(r.chunkId, {
        ...r,
        score: r.score * 0.3,
        matchedOn: 'keyword',
      });
    }
  }

  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export function getKbChunkCount(db: BetterSqlite3.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM kb_chunks').get() as any;
  return row.count;
}
