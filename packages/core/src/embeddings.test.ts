import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingService } from './embeddings.js';
import type { OpenCSConfig } from './types.js';

function makeConfig(gemini?: { apiKey: string; model: string }): Pick<OpenCSConfig, 'gemini'> {
  return { gemini };
}

describe('EmbeddingService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('should create instance with gemini config', () => {
      const svc = new EmbeddingService(makeConfig({ apiKey: 'fake-key', model: 'text-embedding-004' }));
      expect(svc).toBeInstanceOf(EmbeddingService);
    });

    it('should create instance without gemini config', () => {
      const svc = new EmbeddingService(makeConfig());
      expect(svc).toBeInstanceOf(EmbeddingService);
    });
  });

  // ── generateEmbedding ─────────────────────────────────────────

  describe('generateEmbedding', () => {
    it('should return null when gemini API key not configured', async () => {
      const svc = new EmbeddingService(makeConfig());
      const result = await svc.generateEmbedding('test');
      expect(result).toBeNull();
    });

    it('should return embedding values on success', async () => {
      const mockEmbedding = Array.from({ length: 768 }, (_, i) => (i % 100) / 100);
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: mockEmbedding } }),
      });

      const svc = new EmbeddingService(makeConfig({ apiKey: 'test-key', model: 'text-embedding-004' }));
      const result = await svc.generateEmbedding('Apa itu OpenCS?');

      expect(result).toEqual(mockEmbedding);
      expect(result).toHaveLength(768);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const callUrl = (globalThis.fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('embedContent');
      expect(callUrl).toContain('key=test-key');

      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody.content.parts[0].text).toBe('Apa itu OpenCS?');
    });

    it('should return null on API error (non-ok response)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'API key invalid',
      });

      const svc = new EmbeddingService(makeConfig({ apiKey: 'bad-key', model: 'text-embedding-004' }));
      const result = await svc.generateEmbedding('test');
      expect(result).toBeNull();
    });

    it('should return null on unexpected response format', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notEmbedding: true }),
      });

      const svc = new EmbeddingService(makeConfig({ apiKey: 'test-key', model: 'text-embedding-004' }));
      const result = await svc.generateEmbedding('test');
      expect(result).toBeNull();
    });

    it('should return null on network error (fetch throws)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network failure'));

      const svc = new EmbeddingService(makeConfig({ apiKey: 'test-key', model: 'text-embedding-004' }));
      const result = await svc.generateEmbedding('test');
      expect(result).toBeNull();
    });

    it('should handle empty text input', async () => {
      const mockEmbedding = Array.from({ length: 768 }, () => 0);
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: mockEmbedding } }),
      });

      const svc = new EmbeddingService(makeConfig({ apiKey: 'test-key', model: 'text-embedding-004' }));
      const result = await svc.generateEmbedding('');
      expect(result).toBeDefined();
      expect(result).toHaveLength(768);

      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody.content.parts[0].text).toBe('');
    });
  });

  // ── generateKbEmbedding ───────────────────────────────────────

  describe('generateKbEmbedding', () => {
    it('should combine question, answer, and keywords', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: Array.from({ length: 768 }, () => 0.5) } }),
      });

      const svc = new EmbeddingService(makeConfig({ apiKey: 'test-key', model: 'text-embedding-004' }));
      const result = await svc.generateKbEmbedding('Berapa harga?', 'Rp 50.000', ['harga', 'produk']);

      expect(result).toBeDefined();
      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody.content.parts[0].text).toContain('Pertanyaan: Berapa harga?');
      expect(callBody.content.parts[0].text).toContain('Jawaban: Rp 50.000');
      expect(callBody.content.parts[0].text).toContain('Kata kunci: harga, produk');
    });

    it('should skip keywords line when keywords empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: Array.from({ length: 768 }, () => 0.5) } }),
      });

      const svc = new EmbeddingService(makeConfig({ apiKey: 'test-key', model: 'text-embedding-004' }));
      await svc.generateKbEmbedding('Test Q', 'Test A', []);

      const callBody = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(callBody.content.parts[0].text).not.toContain('Kata kunci:');
    });

    it('should return null when no API key', async () => {
      const svc = new EmbeddingService(makeConfig());
      const result = await svc.generateKbEmbedding('Q', 'A', []);
      expect(result).toBeNull();
    });
  });

  // ── cosineSimilarity ──────────────────────────────────────────

  describe('cosineSimilarity', () => {
    let svc: EmbeddingService;

    beforeEach(() => {
      svc = new EmbeddingService(makeConfig({ apiKey: 'test', model: 'test' }));
    });

    it('should return 1 for identical vectors', () => {
      const v = [1, 2, 3, 4, 5];
      const sim = svc.cosineSimilarity(v, v);
      expect(sim).toBeCloseTo(1, 5);
    });

    it('should return 0 for perpendicular vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(-1, 5);
    });

    it('should return positive similarity for similar vectors', () => {
      const a = [0.1, 0.2, 0.3, 0.4, 0.5];
      const b = [0.11, 0.21, 0.29, 0.41, 0.49];
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.9);
      expect(sim).toBeLessThan(1);
    });

    it('should return 0 for mismatched dimensions', () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3, 4];
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBe(0);
    });

    it('should return 0 for zero vector', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(0, 5);
    });

    it('should handle 768-dim vectors correctly', () => {
      const a = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1));
      const b = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1 + 0.01));
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.9);
      expect(sim).toBeLessThan(1);
    });

    it('should handle all-zero vectors', () => {
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const sim = svc.cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(0, 5);
    });
  });
});
