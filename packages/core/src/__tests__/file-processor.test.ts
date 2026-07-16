import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileProcessor } from '../rag/file-processor.js';
import { readFileSync } from 'fs';

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

vi.mock('fs');

function mockFile(content: string) {
  vi.mocked(readFileSync).mockReturnValue(content);
}

describe('FileProcessor', () => {
  let processor: FileProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new FileProcessor();
  });

  describe('processFile', () => {
    it('should process a markdown file into chunks', () => {
      mockFile('# Heading 1\n\nFirst paragraph content here.\n\n## Heading 2\n\nSecond paragraph with more text.');

      const result = processor.processFile('/docs/test.md');

      expect(result.extension).toBe('.md');
      expect(result.fileName).toBe('test.md');
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.chunks.every((c) => c.sourceName === 'test.md')).toBe(true);
      expect(result.chunks.some((c) => c.sectionHeading === 'Heading 1')).toBe(true);
    });

    it('should process a plain text file', () => {
      mockFile('This is the first paragraph.\n\nThis is the second paragraph.');

      const result = processor.processFile('/docs/notes.txt');

      expect(result.extension).toBe('.txt');
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.chunks.some((c) => c.lineRange !== undefined)).toBe(true);
    });

    it('should process a CSV file into row-based chunks', () => {
      mockFile('name,age,city\nAlice,30,Jakarta\nBob,25,Bandung');

      const result = processor.processFile('/data/people.csv');

      expect(result.extension).toBe('.csv');
      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0].content).toContain('Alice');
      expect(result.chunks[0].rowNumber).toBe(1);
      expect(result.chunks[1].content).toContain('Bob');
      expect(result.chunks[1].rowNumber).toBe(2);
    });

    it('should process a JSON object file by top-level keys', () => {
      mockFile(JSON.stringify({ name: 'Test', version: '1.0', description: 'A test file' }));

      const result = processor.processFile('/config/app.json');

      expect(result.extension).toBe('.json');
      expect(result.chunks.length).toBe(3);
      expect(result.chunks.some((c) => c.sectionHeading === 'name')).toBe(true);
      expect(result.chunks.some((c) => c.sectionHeading === 'version')).toBe(true);
      expect(result.chunks.some((c) => c.sectionHeading === 'description')).toBe(true);
    });

    it('should process a JSON array file by items', () => {
      mockFile(JSON.stringify([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]));

      const result = processor.processFile('/data/items.json');

      expect(result.extension).toBe('.json');
      expect(result.chunks.length).toBe(2);
      expect(result.chunks[0].content).toContain('"A"');
      expect(result.chunks[1].content).toContain('"B"');
    });

    it('should throw on unsupported file type', () => {
      expect(() => processor.processFile('/docs/image.png')).toThrow('Unsupported file type: .png');
    });

    it('should set correct totalChunks on all chunks', () => {
      mockFile('name,age\nAlice,30\nBob,25\nCharlie,35');

      const result = processor.processFile('/data/users.csv');

      for (const chunk of result.chunks) {
        expect(chunk.totalChunks).toBe(result.chunks.length);
      }
    });
  });

  describe('processContent - Markdown', () => {
    it('should split markdown by headings', () => {
      const result = processor.processContent('/doc.md', '# Intro\n\nSome text.\n\n## Details\n\nMore info.');

      expect(result.extension).toBe('.md');
      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      expect(result.chunks[0].sectionHeading).toBe('Intro');
      expect(result.chunks[1].sectionHeading).toBe('Details');
    });

    it('should split large sections at paragraph breaks', () => {
      const longParagraph = 'A'.repeat(2000);
      const content = `# Big Section\n\n${longParagraph}\n\n${'B'.repeat(2000)}`;
      const result = processor.processContent('/doc.md', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should track line ranges', () => {
      const result = processor.processContent('/doc.md', '# Title\n\nParagraph one.\n\n## Sub\n\nParagraph two.');

      for (const chunk of result.chunks) {
        expect(chunk.lineRange).toBeDefined();
        expect(chunk.lineRange!.start).toBeGreaterThan(0);
      }
    });
  });

  describe('processContent - Plain Text', () => {
    it('should split on blank lines', () => {
      const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const result = processor.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      expect(result.chunks.some((c) => c.content.includes('First'))).toBe(true);
      expect(result.chunks.some((c) => c.content.includes('Third'))).toBe(true);
    });

    it('should split by size even without blank lines', () => {
      const content = 'A'.repeat(2500);
      const result = processor.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should track line ranges', () => {
      const content = 'Line one.\n\nLine two.';
      const result = processor.processContent('/doc.txt', content);

      for (const chunk of result.chunks) {
        expect(chunk.lineRange).toBeDefined();
      }
    });
  });

  describe('processContent - CSV', () => {
    it('should create one chunk per data row', () => {
      const content = 'col1,col2\nval1,val2\nval3,val4\nval5,val6';
      const result = processor.processContent('/data.csv', content);

      expect(result.chunks.length).toBe(3);
    });

    it('should join header values with row values as label: value', () => {
      const content = 'name,city\nAlice,Jakarta';
      const result = processor.processContent('/data.csv', content);

      expect(result.chunks[0].content).toContain('name: Alice');
      expect(result.chunks[0].content).toContain('city: Jakarta');
    });

    it('should handle empty CSV', () => {
      const result = processor.processContent('/data.csv', '');

      expect(result.chunks.length).toBe(0);
    });

    it('should handle quoted values', () => {
      const content = 'name,bio\nAlice,"Loves coffee, code"';
      const result = processor.processContent('/data.csv', content);

      expect(result.chunks[0].content).toContain('Loves coffee, code');
    });

    it('should set rowNumber correctly', () => {
      const content = 'name,age\nAlice,30\nBob,25';
      const result = processor.processContent('/data.csv', content);

      expect(result.chunks[0].rowNumber).toBe(1);
      expect(result.chunks[1].rowNumber).toBe(2);
    });
  });

  describe('processContent - JSON', () => {
    it('should split object by top-level keys', () => {
      const content = JSON.stringify({ a: 1, b: 2, c: 3 });
      const result = processor.processContent('/doc.json', content);

      expect(result.chunks.length).toBe(3);
      expect(result.chunks[0].sectionHeading).toBe('a');
      expect(result.chunks[0].content).toContain('1');
    });

    it('should split array by items', () => {
      const content = JSON.stringify([10, 20, 30]);
      const result = processor.processContent('/doc.json', content);

      expect(result.chunks.length).toBe(3);
      expect(result.chunks[0].content).toContain('10');
    });

    it('should handle single primitive value', () => {
      const result = processor.processContent('/doc.json', JSON.stringify('hello'));

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].content).toBe('"hello"');
    });

    it('should fall back to plain text for invalid JSON', () => {
      const result = processor.processContent('/doc.json', 'not valid json {{{');

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.chunks[0].content).toContain('not valid json');
    });

    it('should handle null value', () => {
      const result = processor.processContent('/doc.json', 'null');

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].content).toBe('null');
    });
  });

  describe('chunk splitting', () => {
    it('should split oversized markdown chunks', () => {
      const longContent = 'A'.repeat(3000);
      const result = processor.processContent('/doc.md', `# Title\n\n${longContent}`);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      for (const chunk of result.chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(1500);
      }
    });

    it('should split oversized plain text chunks', () => {
      const content = 'A'.repeat(5000);
      const result = processor.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(3);
      for (const chunk of result.chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(1500);
      }
    });

    it('should respect custom maxChunkSize', () => {
      const small = new FileProcessor({ maxChunkSize: 100, chunkOverlap: 20 });
      const content = 'A'.repeat(300);
      const result = small.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(3);
      for (const chunk of result.chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(100);
      }
    });

    it('should not split small chunks', () => {
      const result = processor.processContent('/doc.txt', 'Short content.');
      expect(result.chunks.length).toBe(1);
    });
  });

  describe('isSupported', () => {
    it('should return true for supported extensions', () => {
      expect(processor.isSupported('/doc.md')).toBe(true);
      expect(processor.isSupported('/doc.txt')).toBe(true);
      expect(processor.isSupported('/doc.csv')).toBe(true);
      expect(processor.isSupported('/doc.json')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(processor.isSupported('/image.png')).toBe(false);
      expect(processor.isSupported('/doc.pdf')).toBe(false);
      expect(processor.isSupported('/code.ts')).toBe(false);
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return a copy of supported extensions', () => {
      const exts = processor.getSupportedExtensions();
      expect(exts).toEqual(['.md', '.txt', '.csv', '.json']);

      exts.push('.xyz');
      expect(processor.getSupportedExtensions()).toEqual(['.md', '.txt', '.csv', '.json']);
    });
  });

  describe('metadata', () => {
    it('should return correct fileName and sizeBytes', () => {
      mockFile('hello world');

      const result = processor.processFile('/path/to/file.txt');

      expect(result.fileName).toBe('file.txt');
      expect(result.sizeBytes).toBe(Buffer.byteLength('hello world', 'utf-8'));
    });

    it('should set filePath on result', () => {
      mockFile('data');

      const result = processor.processFile('/abs/path/doc.md');
      expect(result.filePath).toBe('/abs/path/doc.md');
    });

    it('should include correct sourceFile on each chunk', () => {
      const result = processor.processContent('/path/doc.md', '# Title\n\nBody.');

      for (const chunk of result.chunks) {
        expect(chunk.sourceFile).toBe('/path/doc.md');
        expect(chunk.sourceName).toBe('doc.md');
      }
    });
  });

  describe('chunkText splitting', () => {
    it('should produce contiguous sub-chunks from oversized content', () => {
      const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
      const content = words.join(' ');
      const result = processor.processContent('/doc.txt', content);

      const allText = result.chunks.map((c) => c.content).join(' ');
      expect(allText).toContain('word0');
      expect(allText).toContain('word199');
    });

    it('should try to split at paragraph boundaries', () => {
      const content = 'A'.repeat(800) + '\n\n' + 'B'.repeat(800);
      const result = processor.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should try to split at line breaks', () => {
      const content = 'A'.repeat(400) + '\n' + 'B'.repeat(400) + '\n\n' + 'C'.repeat(400);
      const result = processor.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should hard split if no good boundary exists', () => {
      const content = 'X'.repeat(3000);
      const result = processor.processContent('/doc.txt', content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      for (const chunk of result.chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(1500);
      }
    });
  });

  describe('config overrides', () => {
    it('should use custom config values', () => {
      const custom = new FileProcessor({
        maxChunkSize: 50,
        chunkOverlap: 10,
        supportedExtensions: ['.md'],
      });

      expect(custom.getSupportedExtensions()).toEqual(['.md']);
      expect(() => custom.processFile('/file.txt')).toThrow('Unsupported file type: .txt');
    });

    it('should fall back to defaults for unspecified config', () => {
      const partial = new FileProcessor({ maxChunkSize: 500 });
      expect(partial.getSupportedExtensions()).toEqual(['.md', '.txt', '.csv', '.json']);
    });
  });
});
