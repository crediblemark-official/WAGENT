import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileProcessor } from './file-processor.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

const TEST_DIR = join(process.cwd(), '.test-file-processor');

describe('FileProcessor', () => {
  let processor: FileProcessor;

  beforeEach(() => {
    processor = new FileProcessor();
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('isSupported', () => {
    it('should support .md files', () => {
      expect(processor.isSupported('test.md')).toBe(true);
    });

    it('should support .txt files', () => {
      expect(processor.isSupported('test.txt')).toBe(true);
    });

    it('should support .csv files', () => {
      expect(processor.isSupported('test.csv')).toBe(true);
    });

    it('should support .json files', () => {
      expect(processor.isSupported('test.json')).toBe(true);
    });

    it('should not support .exe files', () => {
      expect(processor.isSupported('test.exe')).toBe(false);
    });

    it('should not support .pdf files', () => {
      expect(processor.isSupported('test.pdf')).toBe(false);
    });
  });

  describe('processMarkdown', () => {
    it('should split markdown by headings', () => {
      const md = `# Title

Some intro text.

## Section 1

Content for section 1.

## Section 2

Content for section 2.
More content here.`;

      const result = processor.processContent('/test/products.md', md);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      expect(result.extension).toBe('.md');
      expect(result.fileName).toBe('products.md');

      // Should have section headings
      const headings = result.chunks.filter(c => c.sectionHeading);
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle markdown with no headings', () => {
      const md = 'Just some plain text without any headings.\n\nAnother paragraph here.';

      const result = processor.processContent('/test/notes.md', md);
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.chunks[0].content).toContain('plain text');
    });

    it('should respect max chunk size', () => {
      const processor2 = new FileProcessor({ maxChunkSize: 100 });
      const md = '## Big Section\n\n' + 'word '.repeat(100);

      const result = processor2.processContent('/test/big.md', md);
      for (const chunk of result.chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(150); // small tolerance for split point finding
      }
    });
  });

  describe('processCsv', () => {
    it('should parse CSV rows into chunks', () => {
      const csv = `Name,Price,Stock
Kaos Polos,89000,150
Hoodie Premium,199000,50
Celana Jogger,129000,80`;

      const result = processor.processContent('/test/products.csv', csv);

      expect(result.chunks.length).toBe(3); // 3 data rows
      expect(result.chunks[0].content).toContain('Kaos Polos');
      expect(result.chunks[0].content).toContain('89000');
      expect(result.chunks[0].rowNumber).toBe(1);
      expect(result.chunks[1].content).toContain('Hoodie Premium');
    });

    it('should handle empty CSV', () => {
      const csv = '';
      const result = processor.processContent('/test/empty.csv', csv);
      expect(result.chunks.length).toBe(0);
    });

    it('should handle CSV with quoted values', () => {
      const csv = `Name,Description
Product A,"This is a, description with comma"
Product B,"Another ""quoted"" value"`;

      const result = processor.processContent('/test/quoted.csv', csv);
      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0].content).toContain('Product A');
    });
  });

  describe('processJson', () => {
    it('should parse JSON array items as chunks', () => {
      const json = JSON.stringify([
        { name: 'Item 1', price: 100 },
        { name: 'Item 2', price: 200 },
      ]);

      const result = processor.processContent('/test/data.json', json);
      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0].content).toContain('Item 1');
      expect(result.chunks[1].content).toContain('Item 2');
    });

    it('should parse JSON object keys as chunks', () => {
      const json = JSON.stringify({
        products: [{ name: 'A' }],
        pricing: { discount: '10%' },
      });

      const result = processor.processContent('/test/config.json', json);
      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0].sectionHeading).toBe('products');
      expect(result.chunks[1].sectionHeading).toBe('pricing');
    });

    it('should handle invalid JSON as plain text', () => {
      const result = processor.processContent('/test/bad.json', 'not valid json {{{');
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('processPlainText', () => {
    it('should split by blank lines', () => {
      const txt = `First paragraph about topic A.

Second paragraph about topic B.

Third paragraph about topic C.`;

      const result = processor.processContent('/test/notes.txt', txt);
      expect(result.chunks.length).toBe(3);
      expect(result.chunks[0].content).toContain('topic A');
      expect(result.chunks[1].content).toContain('topic B');
    });

    it('should track line ranges', () => {
      const txt = 'Line 1\nLine 2\n\nLine 3\nLine 4';

      const result = processor.processContent('/test/lines.txt', txt);
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.chunks[0].lineRange).toBeDefined();
    });
  });

  describe('chunk metadata', () => {
    it('should set correct chunk indices and totalChunks', () => {
      const md = '## A\nContent A\n\n## B\nContent B\n\n## C\nContent C';

      const result = processor.processContent('/test/meta.md', md);
      expect(result.chunks.length).toBeGreaterThanOrEqual(3);

      for (let i = 0; i < result.chunks.length; i++) {
        expect(result.chunks[i].chunkIndex).toBe(i);
        expect(result.chunks[i].totalChunks).toBe(result.chunks.length);
      }
    });

    it('should set sourceFile and sourceName correctly', () => {
      const result = processor.processContent('/path/to/products.md', '# Test');
      expect(result.chunks[0].sourceFile).toBe('/path/to/products.md');
      expect(result.chunks[0].sourceName).toBe('products.md');
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return list of supported extensions', () => {
      const exts = processor.getSupportedExtensions();
      expect(exts).toContain('.md');
      expect(exts).toContain('.txt');
      expect(exts).toContain('.csv');
      expect(exts).toContain('.json');
    });
  });
});
