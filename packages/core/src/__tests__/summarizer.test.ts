import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Summarizer, SummarizerConfig } from '../agent/summarizer.js';
import { MemoryEntry } from '../types.js';

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

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getSummarizerPrompt: () => 'Summarize in ${maxLength} words',
    getSummarizerProviderInstruction: (provider: string) => `You are a ${provider} summarizer`,
  },
}));

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    contactId: 'test',
    role: 'user',
    content: 'Hello, this is a test message.',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeEntries(n: number): MemoryEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeEntry({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'x'.repeat(50)}`,
    }),
  );
}

describe('Summarizer', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Constructor and getConfig ──────────────────────────────

  describe('constructor and getConfig', () => {
    it('should use default config when no options given', () => {
      const s = new Summarizer();
      const config = s.getConfig();
      expect(config.maxSummaryLength).toBe(500);
      expect(config.minEntriesForSummary).toBe(20);
      expect(config.useAbstractive).toBe(true);
    });

    it('should merge custom config with defaults', () => {
      const s = new Summarizer({
        config: { maxSummaryLength: 200, useAbstractive: false },
      });
      const config = s.getConfig();
      expect(config.maxSummaryLength).toBe(200);
      expect(config.useAbstractive).toBe(false);
      expect(config.minEntriesForSummary).toBe(20);
    });

    it('should accept all custom config values', () => {
      const s = new Summarizer({
        config: {
          maxSummaryLength: 1000,
          minEntriesForSummary: 5,
          useAbstractive: false,
        },
      });
      const config = s.getConfig();
      expect(config.maxSummaryLength).toBe(1000);
      expect(config.minEntriesForSummary).toBe(5);
      expect(config.useAbstractive).toBe(false);
    });

    it('should accept aiConfig', () => {
      const aiConfig = {
        resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
      } as any;
      const s = new Summarizer({ aiConfig });
      expect(s).toBeDefined();
    });

    it('getConfig returns a copy', () => {
      const s = new Summarizer();
      const config1 = s.getConfig();
      config1.maxSummaryLength = 999;
      expect(s.getConfig().maxSummaryLength).toBe(500);
    });
  });

  // ── shouldSummarize ────────────────────────────────────────

  describe('shouldSummarize', () => {
    it('should return false below threshold', () => {
      const s = new Summarizer({ config: { minEntriesForSummary: 10 } });
      expect(s.shouldSummarize(9)).toBe(false);
    });

    it('should return true at exact threshold', () => {
      const s = new Summarizer({ config: { minEntriesForSummary: 10 } });
      expect(s.shouldSummarize(10)).toBe(true);
    });

    it('should return true above threshold', () => {
      const s = new Summarizer({ config: { minEntriesForSummary: 10 } });
      expect(s.shouldSummarize(50)).toBe(true);
    });

    it('should return false for zero entries', () => {
      const s = new Summarizer();
      expect(s.shouldSummarize(0)).toBe(false);
    });
  });

  // ── generateExtractiveSummary ──────────────────────────────

  describe('generateExtractiveSummary', () => {
    it('should return empty string for empty entries', () => {
      expect(Summarizer.generateExtractiveSummary([], 500)).toBe('');
    });

    it('should handle single entry', () => {
      const entries = [makeEntry({ content: 'Hello world' })];
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).toContain('Pesan terbaru');
      expect(result).toContain('Hello world');
    });

    it('should show stats for 3 entries', () => {
      const entries = [
        makeEntry({ role: 'user', content: 'Q1' }),
        makeEntry({ role: 'assistant', content: 'A1' }),
        makeEntry({ role: 'user', content: 'Q2' }),
      ];
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).toContain('2 pesan dari customer');
      expect(result).toContain('1 dari agent');
    });

    it('should include opening context for >6 entries', () => {
      const entries = makeEntries(10);
      const result = Summarizer.generateExtractiveSummary(entries, 2000);
      expect(result).toContain('Percakapan dimulai');
    });

    it('should not include opening context for <=6 entries', () => {
      const entries = makeEntries(6);
      const result = Summarizer.generateExtractiveSummary(entries, 2000);
      expect(result).not.toContain('Percakapan dimulai');
    });

    it('should include at most 5 recent entries', () => {
      const entries = makeEntries(20);
      const result = Summarizer.generateExtractiveSummary(entries, 5000);
      expect(result).toContain('Message 19');
      expect(result).toContain('Message 18');
      expect(result).toContain('Message 15');
    });

    it('should truncate at maxLength', () => {
      const entries = makeEntries(10);
      const result = Summarizer.generateExtractiveSummary(entries, 50);
      expect(result.length).toBeLessThanOrEqual(120);
    });

    it('should handle all assistant entries', () => {
      const entries = Array.from({ length: 3 }, () =>
        makeEntry({ role: 'assistant', content: 'reply' }),
      );
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).toContain('0 pesan dari customer');
      expect(result).toContain('3 dari agent');
    });

    it('should handle exactly 6 entries (no opening context)', () => {
      const entries = makeEntries(6);
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).not.toContain('Percakapan dimulai');
      expect(result).toContain('Pesan terbaru');
    });

    it('should handle 7 entries (with opening context)', () => {
      const entries = makeEntries(7);
      const result = Summarizer.generateExtractiveSummary(entries, 500);
      expect(result).toContain('Percakapan dimulai');
    });

    it('should handle 10+ entries', () => {
      const entries = makeEntries(15);
      const result = Summarizer.generateExtractiveSummary(entries, 2000);
      expect(result).toContain('Percakapan dimulai');
      expect(result).toContain('Pesan terbaru');
      expect(result).toContain('8 pesan dari customer');
      expect(result).toContain('7 dari agent');
    });

    it('should handle 20+ entries', () => {
      const entries = makeEntries(25);
      const result = Summarizer.generateExtractiveSummary(entries, 3000);
      expect(result).toContain('Percakapan dimulai');
      expect(result).toContain('Pesan terbaru');
    });
  });

  // ── summarize (core) ───────────────────────────────────────

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

    it('should use extractive when no aiConfig provided', async () => {
      const s = new Summarizer({ config: { useAbstractive: true } });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should fall back to extractive on fetch failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should fall back to extractive when AI returns empty string', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should respect maxLength override', async () => {
      const s = new Summarizer({ config: { useAbstractive: false } });
      const result = await s.summarize(makeEntries(5), 20);
      expect(result.length).toBeLessThan(200);
    });
  });

  // ── Abstractive: OpenAI provider ──────────────────────────

  describe('abstractive summary with OpenAI', () => {
    it('should return AI-generated summary on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Summary from OpenAI' } }],
        }),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toBe('Summary from OpenAI');
    });

    it('should fall back to extractive on API error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'bad-key' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should call correct OpenAI endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      });
      globalThis.fetch = mockFetch;
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' },
        } as any,
      });
      await s.summarize(makeEntries(3));
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test',
          }),
        }),
      );
    });

    it('should use default base URL when not provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      });
      globalThis.fetch = mockFetch;
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
        } as any,
      });
      await s.summarize(makeEntries(3));
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.anything(),
      );
    });
  });

  // ── Abstractive: Gemini provider ──────────────────────────

  describe('abstractive summary with Gemini', () => {
    it('should return AI-generated summary on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Summary from Gemini' }] } }],
        }),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'google', model: 'gemini-pro', apiKey: 'ai-key' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toBe('Summary from Gemini');
    });

    it('should call correct Gemini endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
      });
      globalThis.fetch = mockFetch;
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'gemini', model: 'gemini-1.5', apiKey: 'g-key' },
        } as any,
      });
      await s.summarize(makeEntries(3));
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should fall back to extractive on API error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'gemini', model: 'gemini-pro', apiKey: 'bad' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });
  });

  // ── Abstractive: Claude provider ──────────────────────────

  describe('abstractive summary with Claude', () => {
    it('should return AI-generated summary on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'Summary from Claude' }],
        }),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'anthropic', model: 'claude-3', apiKey: 'claude-key' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toBe('Summary from Claude');
    });

    it('should call correct Claude endpoint with headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: 'ok' }] }),
      });
      globalThis.fetch = mockFetch;
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'claude', model: 'claude-3-opus', apiKey: 'ck' },
        } as any,
      });
      await s.summarize(makeEntries(3));
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'ck',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
    });

    it('should fall back to extractive on API error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'anthropic', model: 'claude-3', apiKey: 'bad' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });
  });

  // ── Abstractive: Ollama provider ──────────────────────────

  describe('abstractive summary with Ollama', () => {
    it('should return AI-generated summary on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: 'Summary from Ollama' },
        }),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'ollama', model: 'llama3' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toBe('Summary from Ollama');
    });

    it('should call correct Ollama endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: 'ok' } }),
      });
      globalThis.fetch = mockFetch;
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'ollama', model: 'llama3' },
        } as any,
      });
      await s.summarize(makeEntries(3));
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should fall back to extractive on API error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'ollama', model: 'llama3' },
        } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });
  });

  // ── callAI edge cases ─────────────────────────────────────

  describe('callAI edge cases', () => {
    it('should throw when resolvedModel is missing', async () => {
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: { resolvedModel: undefined } as any,
      });
      const result = await s.summarize(makeEntries(5));
      expect(result).toContain('Pesan terbaru');
    });

    it('should handle OpenAI response with missing choices', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk' },
        } as any,
      });
      const result = await s.summarize(makeEntries(3));
      expect(result).toContain('Pesan terbaru');
    });

    it('should handle Gemini response with missing candidates', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [] }),
      });
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'google', model: 'gemini-pro', apiKey: 'k' },
        } as any,
      });
      const result = await s.summarize(makeEntries(3));
      expect(result).toContain('Pesan terbaru');
    });

    it('should handle network timeout gracefully', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() =>
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 50)),
      );
      const s = new Summarizer({
        config: { useAbstractive: true },
        aiConfig: {
          resolvedModel: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk' },
        } as any,
      });
      const result = await s.summarize(makeEntries(3));
      expect(result).toContain('Pesan terbaru');
    });
  });
});
