import { Logger } from 'pino';
import { existsSync, unlinkSync } from 'fs';
import { basename } from 'path';
import { Database } from './storage.js';
import { EmbeddingService } from './embeddings.js';
import { FileProcessor, type ProcessedFile } from './file-processor.js';
import { WAgentConfig } from './types.js';
import { getLogger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────

export interface KbUploadResult {
  fileId: string;
  fileName: string;
  totalChunks: number;
  embeddedChunks: number;
  status: 'success' | 'partial' | 'failed';
  error?: string;
}

export interface KbSearchResult {
  chunkId: string;
  fileId: string;
  fileName?: string;
  sectionHeading?: string;
  content: string;
  score: number;
  matchedOn: 'semantic' | 'keyword' | 'combined';
}

export interface KbFileInfo {
  id: string;
  fileName: string;
  fileExtension: string;
  fileSize: number;
  chunkCount: number;
  status: string;
  createdAt: Date;
}

// ── Knowledge Store ─────────────────────────────────────────────

/**
 * KnowledgeStore manages file-based knowledge for the Flexible RAG system.
 *
 * Workflow:
 * 1. Upload file → FileProcessor splits into chunks
 * 2. Chunks stored in SQLite (kb_chunks table)
 * 3. Each chunk embedded via Gemini text-embedding-004
 * 4. Search: query → embed → cosine similarity → top-K results
 */
export class KnowledgeStore {
  private logger: Logger;
  private db: Database;
  private embeddingService: EmbeddingService;
  private fileProcessor: FileProcessor;

  constructor(db: Database, config: WAgentConfig, fileProcessor?: FileProcessor) {
    this.logger = getLogger().child({ module: 'knowledge-store' });
    this.db = db;
    this.embeddingService = new EmbeddingService(config);
    this.fileProcessor = fileProcessor || new FileProcessor();
  }

  // ── Upload ───────────────────────────────────────────────────

  /**
   * Upload a file to the knowledge store.
   * 1. Parse file into chunks
   * 2. Store chunks in DB
   * 3. Embed each chunk
   */
  async uploadFile(filePath: string): Promise<KbUploadResult> {
    const fileName = basename(filePath);

    // Check if file already exists
    const existing = this.db.getKbFileByName(fileName);
    if (existing) {
      // Delete old version
      this.db.deleteKbFile(existing.id);
      this.logger.info({ fileName }, 'Re-uploading existing file');
    }

    try {
      // 1. Process file into chunks
      const processed = this.fileProcessor.processFile(filePath);

      // 2. Create kb_files entry
      const fileId = `kf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      this.db.createKbFile({
        id: fileId,
        fileName: processed.fileName,
        filePath: processed.filePath,
        fileExtension: processed.extension,
        fileSize: processed.sizeBytes,
        chunkCount: processed.totalChunks,
        status: 'processing',
      });

      // 3. Store chunks and embed
      let embeddedCount = 0;

      for (const chunk of processed.chunks) {
        const chunkId = `${fileId}_c${chunk.chunkIndex}`;

        // Generate embedding
        let embedding: number[] | null = null;
        try {
          embedding = await this.embeddingService.generateEmbedding(chunk.content);
        } catch (err: any) {
          this.logger.warn({ chunkId, error: err.message }, 'Failed to generate embedding');
        }

        // Store chunk
        this.db.createKbChunk({
          id: chunkId,
          fileId,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          sectionHeading: chunk.sectionHeading,
          rowNumber: chunk.rowNumber,
          lineStart: chunk.lineRange?.start,
          lineEnd: chunk.lineRange?.end,
          embedding: embedding || undefined,
        });

        if (embedding) embeddedCount++;
      }

      // Update file status
      const status = embeddedCount === processed.totalChunks ? 'ready' : 'partial';
      this.db.updateKbFileStatus(fileId, status);

      this.logger.info({
        fileName,
        chunks: processed.totalChunks,
        embedded: embeddedCount,
      }, 'File uploaded to knowledge store');

      return {
        fileId,
        fileName: processed.fileName,
        totalChunks: processed.totalChunks,
        embeddedChunks: embeddedCount,
        status: embeddedCount > 0 ? (embeddedCount === processed.totalChunks ? 'success' : 'partial') : 'failed',
      };
    } catch (err: any) {
      this.logger.error({ fileName, error: err.message }, 'Failed to upload file');
      return {
        fileId: '',
        fileName,
        totalChunks: 0,
        embeddedChunks: 0,
        status: 'failed',
        error: err.message,
      };
    }
  }

  /**
   * Embed all unembedded chunks in the database.
   * Useful for batch processing after migration or API key setup.
   */
  async embedPendingChunks(): Promise<{ total: number; embedded: number; failed: number }> {
    const chunks = this.db.getKbChunksWithoutEmbedding();
    let embedded = 0;
    let failed = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await this.embeddingService.generateEmbedding(chunk.content);
        if (embedding) {
          this.db.setKbChunkEmbedding(chunk.id, embedding);
          embedded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    this.logger.info({ total: chunks.length, embedded, failed }, 'Batch embedding completed');
    return { total: chunks.length, embedded, failed };
  }

  // ── Search ───────────────────────────────────────────────────

  /**
   * Search across all uploaded knowledge files.
   * Uses combined semantic + keyword search.
   */
  async search(query: string, maxResults = 5, minScore = 0.3): Promise<KbSearchResult[]> {
    // Generate query embedding
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.embeddingService.generateEmbedding(query);
    } catch {
      // Fallback to keyword-only
    }

    // Combined search
    const results = this.db.searchKbChunks(query, queryEmbedding, maxResults, minScore);

    return results.map(r => ({
      chunkId: r.chunkId,
      fileId: r.fileId,
      fileName: r.fileName,
      sectionHeading: r.sectionHeading,
      content: r.content,
      score: r.score,
      matchedOn: r.matchedOn,
    }));
  }

  /**
   * Semantic-only search.
   */
  async searchSemantic(query: string, maxResults = 5, minScore = 0.3): Promise<KbSearchResult[]> {
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    if (!queryEmbedding) return [];

    return this.db.searchKbChunksSemantic(queryEmbedding, maxResults, minScore).map(r => ({
      chunkId: r.chunkId,
      fileId: r.fileId,
      fileName: r.fileName,
      sectionHeading: r.sectionHeading,
      content: r.content,
      score: r.score,
      matchedOn: 'semantic' as const,
    }));
  }

  // ── Management ───────────────────────────────────────────────

  /**
   * List all uploaded files.
   */
  listFiles(): KbFileInfo[] {
    return this.db.getAllKbFiles();
  }

  /**
   * Get info about a specific file.
   */
  getFile(fileId: string): KbFileInfo | undefined {
    const file = this.db.getKbFile(fileId);
    return file ? {
      id: file.id,
      fileName: file.fileName,
      fileExtension: file.fileExtension,
      fileSize: file.fileSize,
      chunkCount: file.chunkCount,
      status: file.status,
      createdAt: file.createdAt,
    } : undefined;
  }

  /**
   * Delete a file and all its chunks.
   * Returns true if deleted.
   */
  deleteFile(fileId: string): boolean {
    const file = this.db.getKbFile(fileId);
    if (!file) return false;

    this.db.deleteKbFile(fileId);
    this.logger.info({ fileId, fileName: file.fileName }, 'File deleted from knowledge store');
    return true;
  }

  /**
   * Delete a file by name.
   */
  deleteFileByName(fileName: string): boolean {
    const file = this.db.getKbFileByName(fileName);
    if (!file) return false;

    this.db.deleteKbFile(file.id);
    this.logger.info({ fileName }, 'File deleted from knowledge store');
    return true;
  }

  /**
   * Get total stats.
   */
  getStats(): { totalFiles: number; totalChunks: number } {
    return {
      totalFiles: this.db.getAllKbFiles().length,
      totalChunks: this.db.getKbChunkCount(),
    };
  }
}
