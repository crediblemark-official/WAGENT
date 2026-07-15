import { describe, it, expect, vi } from 'vitest';
import { Summarizer, SummarizerConfig } from '../agent/summarizer.js';
import { MemoryEntry } from '../types.js';

vi.mock('../logger.js', () => ({
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

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getSummarizerPrompt: () => 'Summarize in ${maxLength} words.',
    getSummarizerProviderInstruction: (provider: string) => `You are a ${provider} summarizer.`,
  },
}));

function makeEntries(n: number, role: 'user' | 'assistant' = 'user'): MemoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    contactId: 'test',
    role: i % 2 === 0 ? 'user' : role,
    content: `Message ${i}: ${'x'.repeat(50)}`,
    timestamp: new Date().toISOString(),
  }));
}

describe('Summarizer', () => {
  describe('constructor and getConfig', () => {
    it('should use default config', () => {
      const s = new Summarizer();
      const config = s.getConfig();
      expect(config.maxSummaryLength).toBe(500);
      expect(config.minEntriesForSummary).toBe(20);
      expect(config.useAbstractive).toBe(true);
    });

    it('should merge custom config', () => {
      const s = new Summarizer({
        config: { maxSummaryLength: 200, useAbstractive: false },
      });
      const config = s.getConfig();
      expect(config.maxSummaryLength).toBe(200);
      expect(config.useAbstractive).toBe(false);
      expect(config.minEntriesForSummary).toBe(20); // default
    });

    it('should return a copy of config', () => {
      const s = new Summarizer();
      const config = s.getConfig();
      config.maxSummaryLength = 999;
      expect(s.getConfig().maxSummaryLength).toBe(500);
    });
  });

  describe('shouldSummarize', () => {
    it('should return false below threshold', () => {
      const s = new Summarizer({ config: { minEntriesForSummary: 10 } });
      expect(s.shouldSummarize(5)).toBe(false);
    });

    it('should return true at threshold', () => {
      const s = new Summarizer({ config: { minEntriesForSummary: 10 } });
      expect(s.shouldSummarize(10)).toBe(true);
    });

    it('should return true above threshold', () => {
      const s = new Summarizer({ config: { minEntriesForSummary: 10 } });
      expect(s.shouldSummarize(50)).toBe(true);
    });
  });

  describe('generateExtractiveSummary', () => {
    it('should return empty string for empty entries', () => {
      expect(Summarizer.generateExtractiveSummary([], 500)).toBe('');
    });

    it('should generate stats for short conversation', () => {
      const entries = [
        { contactId: 'c', role: 'user' as const, content: 'Hello', timestamp: '' },
        { contactId: 'c', role: 'assistant' as const, content: 'Hi there', timestamp: '' },
      ];
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).toContain('1 pesan dari customer');
      expect(result).toContain('1 dari agent');
      expect(result).toContain('Pesan terbaru:');
    });

    it('should include opening context for long conversation', () => {
      const entries = makeEntries(10);
      const result = Summarizer.generateExtractiveSummary(entries, 2000);
      expect(result).toContain('Percakapan dimulai');
    });

    it('should truncate at maxLength', () => {
      const entries = makeEntries(5);
      const result = Summarizer.generateExtractiveSummary(entries, 30);
      expect(result.length).toBeLessThanOrEqual(100); // some flexibility
    });

    it('should handle all-user entries', () => {
      const entries = Array.from({ length: 3 }, () => ({
        contactId: 'c',
        role: 'user' as const,
        content: 'question',
        timestamp: '',
      }));
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).toContain('3 pesan dari customer');
      expect(result).toContain('0 dari agent');
    });
  });

  describe('summarize', () => {
    it('should return empty for empty entries', async () => {
      const s = new Summarizer();
      expect(await s.summarize([])).toBe('');
    });

    it('should use extractive when abstractive disabled', async () => {
      const s = new Summarizer({ config: { useAbstractive: false } });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should use extractive when no aiConfig', async () => {
      const s = new Summarizer({ config: { useAbstractive: true } });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should fall back to extractive on abstractive failure', async () => {
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o' },
        } as any,
      });
      // Will fail because fetch is not mocked - falls back to extractive
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should use maxLength override', async () => {
      const s = new Summarizer({ config: { useAbstractive: false } });
      const result = await s.summarize(makeEntries(5), 20);
      expect(result.length).toBeLessThan(200);
    });
  });
});
