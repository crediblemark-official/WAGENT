import { describe, it, expect, beforeEach } from 'vitest';
import { Summarizer } from './summarizer.js';
import { MemoryEntry, WAgentConfig } from './types.js';

function makeEntry(role: MemoryEntry['role'], content: string, contactId = 'test@c.us'): MemoryEntry {
  return { contactId, role, content, timestamp: new Date().toISOString() };
}

describe('Summarizer', () => {
  let summarizer: Summarizer;

  beforeEach(() => {
    summarizer = new Summarizer();
  });

  // Helper: call the static generateExtractiveSummary from Summarizer
  const extractive = (entries: MemoryEntry[], maxLength = 200) =>
    Summarizer.generateExtractiveSummary(entries, maxLength);

  describe('constructor', () => {
    it('should use default config when no options provided', () => {
      const config = summarizer.getConfig();
      expect(config.maxSummaryLength).toBe(500);
      expect(config.minEntriesForSummary).toBe(20);
      expect(config.useAbstractive).toBe(true);
    });

    it('should merge custom config with defaults', () => {
      const custom = new Summarizer({
        config: { minEntriesForSummary: 10, useAbstractive: false },
      });
      const config = custom.getConfig();
      expect(config.minEntriesForSummary).toBe(10);
      expect(config.useAbstractive).toBe(false);
      expect(config.maxSummaryLength).toBe(500); // default
    });
  });

  describe('generateExtractiveSummary', () => {
    it('should return empty string for empty entries', () => {
      const result = extractive([], 200);
      expect(result).toBe('');
    });

    it('should include stats and recent messages for multiple entries', () => {
      const entries = [
        makeEntry('user', 'Halo, selamat pagi!'),
        makeEntry('assistant', 'Selamat pagi! Ada yang bisa dibantu?'),
        makeEntry('user', 'Saya ingin order produk A'),
        makeEntry('assistant', 'Baik, produk A tersedia'),
        makeEntry('user', 'Berapa harganya?'),
        makeEntry('assistant', 'Rp 150.000'),
      ];
      const result = extractive(entries, 500);
      expect(result).toContain('Statistik');
      expect(result).toContain('Pesan terbaru');
    });

    it('should include stats when entries have user/assistant roles', () => {
      const entries = [
        makeEntry('user', 'Halo'),
        makeEntry('assistant', 'Halo juga'),
        makeEntry('system', 'System message'),
      ];
      const result = extractive(entries, 500);
      expect(result).toContain('Statistik');
    });

    it('should include only recent messages when under maxLength', () => {
      const entries = [makeEntry('user', 'A'), makeEntry('assistant', 'B')];
      const result = extractive(entries, 100);
      expect(result).toContain('Pesan terbaru');
    });

    it('should respect maxLength limit', () => {
      const manyEntries: MemoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        manyEntries.push(makeEntry('user', `Pesan panjang nomor ${i} dengan banyak teks tambahan untuk dijadikan contoh`));
        manyEntries.push(makeEntry('assistant', `Respon untuk pesan ${i} yang juga cukup panjang`));
      }
      const result = extractive(manyEntries, 150);
      // Should respect the limit (allow some buffer for prefix text)
      expect(result.length).toBeLessThanOrEqual(300);
    });
  });

  describe('shouldSummarize', () => {
    it('should return false for empty conversation', () => {
      expect(summarizer.shouldSummarize(0)).toBe(false);
    });

    it('should return false for small conversations', () => {
      expect(summarizer.shouldSummarize(5)).toBe(false);
      expect(summarizer.shouldSummarize(19)).toBe(false);
    });

    it('should return true at threshold', () => {
      expect(summarizer.shouldSummarize(20)).toBe(true);
    });

    it('should return true above threshold', () => {
      expect(summarizer.shouldSummarize(50)).toBe(true);
    });

    it('should use custom threshold', () => {
      const custom = new Summarizer({
        config: { minEntriesForSummary: 10 },
      });
      expect(custom.shouldSummarize(9)).toBe(false);
      expect(custom.shouldSummarize(10)).toBe(true);
    });
  });

  describe('summarize (with abstractive disabled)', () => {
    it('should fall back to extractive when abstractive is disabled', async () => {
      const extractive = new Summarizer({
        config: { useAbstractive: false },
      });
      const entries = [makeEntry('user', 'Halo'), makeEntry('assistant', 'Halo juga')];
      const result = await extractive.summarize(entries);
      expect(result).toContain('Pesan terbaru');
    });
  });

  describe('edge cases', () => {
    it('should handle empty entries gracefully', async () => {
      const result = await summarizer.summarize([]);
      expect(result).toBe('');
    });

    it('should handle single entry', () => {
      const entries = [makeEntry('user', 'Pesan tunggal')];
      const result = extractive(entries, 200);
      expect(result).toContain('Pesan terbaru');
    });

    it('should handle entries with only system role', () => {
      const entries = [
        makeEntry('system', 'System config'),
        makeEntry('system', 'More config'),
      ];
      const result = extractive(entries, 200);
      expect(result).toBeTruthy();
    });
  });
});
