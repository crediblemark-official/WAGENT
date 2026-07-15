import { Logger } from 'pino';
import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import { getLogger } from '../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────

export interface FileChunk {
  /** Source file path */
  sourceFile: string;
  /** Source file name (just filename, no path) */
  sourceName: string;
  /** Chunk index within the file (0-based) */
  chunkIndex: number;
  /** Total chunks from this file */
  totalChunks: number;
  /** The text content of this chunk */
  content: string;
  /** Section heading (for Markdown) */
  sectionHeading?: string;
  /** Line number range (for text files) */
  lineRange?: { start: number; end: number };
  /** CSV row number (for CSV files) */
  rowNumber?: number;
}

export interface ProcessedFile {
  /** Absolute path to the source file */
  filePath: string;
  /** Filename only */
  fileName: string;
  /** File extension */
  extension: string;
  /** Total chunks produced */
  totalChunks: number;
  /** All chunks */
  chunks: FileChunk[];
  /** Raw file size in bytes */
  sizeBytes: number;
}

// ── Config ──────────────────────────────────────────────────────

export interface FileProcessorConfig {
  /** Max characters per chunk (default: 1500) */
  maxChunkSize: number;
  /** Overlap between chunks in characters (default: 200) */
  chunkOverlap: number;
  /** Supported extensions */
  supportedExtensions: string[];
}

const DEFAULT_CONFIG: FileProcessorConfig = {
  maxChunkSize: 1500,
  chunkOverlap: 200,
  supportedExtensions: ['.md', '.txt', '.csv', '.json'],
};

// ── File Processor ──────────────────────────────────────────────

/**
 * FileProcessor handles parsing different file types into
 * searchable text chunks for the Flexible RAG system.
 *
 * Supported formats:
 * - .md: Split by ## headings, then by paragraphs
 * - .txt: Split by paragraphs/newlines
 * - .csv: Each row → one chunk (columns joined as text)
 * - .json: Pretty-printed, split by top-level keys
 */
export class FileProcessor {
  private logger: Logger;
  private config: FileProcessorConfig;

  constructor(config?: Partial<FileProcessorConfig>) {
    this.logger = getLogger().child({ module: 'file-processor' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a file into chunks.
   */
  processFile(filePath: string): ProcessedFile {
    const fileName = basename(filePath);
    const extension = extname(filePath).toLowerCase();

    if (!this.config.supportedExtensions.includes(extension)) {
      throw new Error(`Unsupported file type: ${extension}. Supported: ${this.config.supportedExtensions.join(', ')}`);
    }

    const content = readFileSync(filePath, 'utf-8');
    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    let chunks: FileChunk[];

    switch (extension) {
      case '.md':
        chunks = this.processMarkdown(filePath, fileName, content);
        break;
      case '.csv':
        chunks = this.processCsv(filePath, fileName, content);
        break;
      case '.json':
        chunks = this.processJson(filePath, fileName, content);
        break;
      default:
        chunks = this.processPlainText(filePath, fileName, content);
        break;
    }

    // Enforce max chunk size by splitting oversized chunks
    const finalChunks: FileChunk[] = [];
    let chunkIndex = 0;

    for (const chunk of chunks) {
      if (chunk.content.length > this.config.maxChunkSize) {
        const subChunks = this.splitOversizedChunk(chunk, chunkIndex);
        for (const sub of subChunks) {
          finalChunks.push({ ...sub, chunkIndex, totalChunks: 0 }); // temp totalChunks
          chunkIndex++;
        }
      } else {
        finalChunks.push({ ...chunk, chunkIndex, totalChunks: 0 }); // temp totalChunks
        chunkIndex++;
      }
    }

    // Fix totalChunks
    for (const chunk of finalChunks) {
      chunk.totalChunks = finalChunks.length;
    }

    this.logger.info({ fileName, chunks: finalChunks.length }, 'File processed');

    return {
      filePath,
      fileName,
      extension,
      totalChunks: finalChunks.length,
      chunks: finalChunks,
      sizeBytes,
    };
  }

  /**
   * Process a raw string content into chunks (for testing or in-memory use).
   */
  processContent(filePath: string, content: string): ProcessedFile {
    const fileName = basename(filePath);
    const extension = extname(filePath).toLowerCase();
    const sizeBytes = Buffer.byteLength(content, 'utf-8');

    let chunks: FileChunk[];

    switch (extension) {
      case '.md':
        chunks = this.processMarkdown(filePath, fileName, content);
        break;
      case '.csv':
        chunks = this.processCsv(filePath, fileName, content);
        break;
      case '.json':
        chunks = this.processJson(filePath, fileName, content);
        break;
      default:
        chunks = this.processPlainText(filePath, fileName, content);
        break;
    }

    const finalChunks: FileChunk[] = [];
    let chunkIndex = 0;

    for (const chunk of chunks) {
      if (chunk.content.length > this.config.maxChunkSize) {
        const subChunks = this.splitOversizedChunk(chunk, chunkIndex);
        for (const sub of subChunks) {
          finalChunks.push({ ...sub, chunkIndex, totalChunks: 0 });
          chunkIndex++;
        }
      } else {
        finalChunks.push({ ...chunk, chunkIndex, totalChunks: 0 });
        chunkIndex++;
      }
    }

    for (const chunk of finalChunks) {
      chunk.totalChunks = finalChunks.length;
    }

    return {
      filePath,
      fileName,
      extension,
      totalChunks: finalChunks.length,
      chunks: finalChunks,
      sizeBytes,
    };
  }

  /**
   * Check if a file extension is supported.
   */
  isSupported(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return this.config.supportedExtensions.includes(ext);
  }

  /**
   * Get supported extensions.
   */
  getSupportedExtensions(): string[] {
    return [...this.config.supportedExtensions];
  }

  // ── Markdown Parser ──────────────────────────────────────────

  private processMarkdown(filePath: string, fileName: string, content: string): FileChunk[] {
    const chunks: FileChunk[] = [];
    const lines = content.split('\n');

    let currentHeading = '';
    let currentSection: string[] = [];
    let lineStart = 1;

    const flushSection = () => {
      const text = currentSection.join('\n').trim();
      if (!text) return;

      chunks.push({
        sourceFile: filePath,
        sourceName: fileName,
        chunkIndex: chunks.length,
        totalChunks: 0,
        content: text,
        sectionHeading: currentHeading || undefined,
        lineRange: { start: lineStart, end: lineStart + currentSection.length },
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,4})\s+(.+)/);

      if (headingMatch) {
        // Flush previous section
        flushSection();
        currentHeading = headingMatch[2].trim();
        currentSection = [line];
        lineStart = i + 1;
      } else {
        currentSection.push(line);

        // Split by blank lines (paragraphs) if section is getting large
        if (line.trim() === '' && currentSection.join('\n').length > this.config.maxChunkSize * 0.7) {
          flushSection();
          currentSection = [];
          lineStart = i + 2;
        }
      }
    }

    // Flush remaining
    flushSection();

    return chunks;
  }

  // ── Plain Text Parser ────────────────────────────────────────

  private processPlainText(filePath: string, fileName: string, content: string): FileChunk[] {
    const chunks: FileChunk[] = [];
    const lines = content.split('\n');

    let currentChunk: string[] = [];
    let lineStart = 1;

    const flushChunk = () => {
      const text = currentChunk.join('\n').trim();
      if (!text) return;

      chunks.push({
        sourceFile: filePath,
        sourceName: fileName,
        chunkIndex: chunks.length,
        totalChunks: 0,
        content: text,
        lineRange: { start: lineStart, end: lineStart + currentChunk.length },
      });
    };

    for (let i = 0; i < lines.length; i++) {
      currentChunk.push(lines[i]);

      const currentText = currentChunk.join('\n');

      // Split on blank lines or when exceeding size
      if (lines[i].trim() === '' || currentText.length >= this.config.maxChunkSize * 0.8) {
        flushChunk();
        currentChunk = [];
        lineStart = i + 2;
      }
    }

    flushChunk();
    return chunks;
  }

  // ── CSV Parser ───────────────────────────────────────────────

  private processCsv(filePath: string, fileName: string, content: string): FileChunk[] {
    const chunks: FileChunk[] = [];
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length === 0) return chunks;

    // Parse header
    const header = this.parseCsvLine(lines[0]);
    const headerText = header.join(', ');

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      if (values.length === 0) continue;

      // Create readable text from row
      const parts: string[] = [];
      for (let j = 0; j < header.length; j++) {
        const value = values[j] || '';
        if (value) {
          parts.push(`${header[j]}: ${value}`);
        }
      }

      const text = parts.join('\n');
      if (!text.trim()) continue;

      chunks.push({
        sourceFile: filePath,
        sourceName: fileName,
        chunkIndex: chunks.length,
        totalChunks: 0,
        content: text,
        rowNumber: i,
      });
    }

    return chunks;
  }

  /**
   * Simple CSV line parser (handles quoted values).
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  // ── JSON Parser ──────────────────────────────────────────────

  private processJson(filePath: string, fileName: string, content: string): FileChunk[] {
    const chunks: FileChunk[] = [];

    try {
      const parsed = JSON.parse(content);

      if (typeof parsed !== 'object' || parsed === null) {
        // Simple value — single chunk
        chunks.push({
          sourceFile: filePath,
          sourceName: fileName,
          chunkIndex: 0,
          totalChunks: 1,
          content: JSON.stringify(parsed, null, 2),
        });
        return chunks;
      }

      if (Array.isArray(parsed)) {
        // Array — each item is a chunk
        for (let i = 0; i < parsed.length; i++) {
          const text = JSON.stringify(parsed[i], null, 2);
          chunks.push({
            sourceFile: filePath,
            sourceName: fileName,
            chunkIndex: i,
            totalChunks: parsed.length,
            content: text,
          });
        }
      } else {
        // Object — each top-level key is a chunk
        const keys = Object.keys(parsed);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const value = parsed[key];
          const text = `${key}: ${JSON.stringify(value, null, 2)}`;
          chunks.push({
            sourceFile: filePath,
            sourceName: fileName,
            chunkIndex: i,
            totalChunks: keys.length,
            content: text,
            sectionHeading: key,
          });
        }
      }
    } catch {
      // Invalid JSON — treat as plain text
      return this.processPlainText(filePath, fileName, content);
    }

    return chunks;
  }

  // ── Helpers ──────────────────────────────────────────────────

  private splitOversizedChunk(chunk: FileChunk, startIndex: number): FileChunk[] {
    const subChunks: FileChunk[] = [];
    const text = chunk.content;
    let remaining = text;
    let idx = 0;

    while (remaining.length > 0) {
      const splitPoint = this.findSplitPoint(remaining, this.config.maxChunkSize);
      const part = remaining.substring(0, splitPoint).trim();

      if (part) {
        subChunks.push({
          ...chunk,
          chunkIndex: startIndex + idx,
          totalChunks: 0,
          content: part,
          lineRange: undefined, // Can't reliably track line ranges after split
        });
        idx++;
      }

      remaining = remaining.substring(splitPoint).trim();
    }

    return subChunks;
  }

  /**
   * Find a good split point (at paragraph/line boundary) within the text.
   */
  private findSplitPoint(text: string, maxLen: number): number {
    if (text.length <= maxLen) return text.length;

    // Try to split at paragraph break
    const paraBreak = text.lastIndexOf('\n\n', maxLen);
    if (paraBreak > maxLen * 0.5) return paraBreak;

    // Try to split at line break
    const lineBreak = text.lastIndexOf('\n', maxLen);
    if (lineBreak > maxLen * 0.3) return lineBreak;

    // Try to split at sentence end
    const sentenceEnd = text.lastIndexOf('. ', maxLen);
    if (sentenceEnd > maxLen * 0.3) return sentenceEnd + 1;

    // Hard split
    return maxLen;
  }
}
