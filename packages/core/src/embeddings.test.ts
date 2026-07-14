import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EmbeddingService,
  EMBEDDING_MODELS,
  getModelsByCategory,
  getModelsByProvider,
  getDefaultModel,
  type EmbeddingModelConfig,
} from './embeddings.js';

describe('embeddings helpers', () => {
  describe('getModelsByCategory', () => {
    it('should filter commercial models', () => {
      const commercial = getModelsByCategory('commercial');
      expect(Object.keys(commercial).length).toBeGreaterThan(0);
      for (const config of Object.values(commercial)) {
        expect(config.category).toBe('commercial');
      }
    });

    it('should filter open-source models', () => {
      const openSource = getModelsByCategory('open-source');
      expect(Object.keys(openSource).length).toBeGreaterThan(0);
      for (const config of Object.values(openSource)) {
        expect(config.category).toBe('open-source');
      }
    });

    it('should filter lightweight models', () => {
      const lightweight = getModelsByCategory('lightweight');
      expect(Object.keys(lightweight).length).toBeGreaterThan(0);
      for (const config of Object.values(lightweight)) {
        expect(config.category).toBe('lightweight');
      }
    });
  });

  describe('getModelsByProvider', () => {
    it('should filter openai models', () => {
      const openai = getModelsByProvider('openai');
      expect(Object.keys(openai).length).toBeGreaterThan(0);
      for (const config of Object.values(openai)) {
        expect(config.provider).toBe('openai');
      }
    });

    it('should filter gemini models', () => {
      const gemini = getModelsByProvider('gemini');
      expect(Object.keys(gemini).length).toBeGreaterThan(0);
      for (const config of Object.values(gemini)) {
        expect(config.provider).toBe('gemini');
      }
    });

    it('should return empty for nonexistent provider', () => {
      const result = getModelsByProvider('nonexistent' as any);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('getDefaultModel', () => {
    it('should return commercial default', () => {
      expect(getDefaultModel('commercial')).toBe('text-embedding-3-small');
    });

    it('should return open-source default', () => {
      expect(getDefaultModel('open-source')).toBe('bge-large-en-v1.5');
    });

    it('should return lightweight default', () => {
      expect(getDefaultModel('lightweight')).toBe('all-MiniLM-L6-v2');
    });

    it('should return gemini default with no category', () => {
      expect(getDefaultModel()).toBe('text-embedding-004');
    });
  });

  describe('EMBEDDING_MODELS', () => {
    it('should have all expected models', () => {
      expect(EMBEDDING_MODELS['text-embedding-3-small']).toBeDefined();
      expect(EMBEDDING_MODELS['text-embedding-004']).toBeDefined();
      expect(EMBEDDING_MODELS['voyage-3-large']).toBeDefined();
      expect(EMBEDDING_MODELS['cohere-embed-v4']).toBeDefined();
      expect(EMBEDDING_MODELS['mistral-embed']).toBeDefined();
      expect(EMBEDDING_MODELS['all-MiniLM-L6-v2']).toBeDefined();
    });

    it('should have valid config for each model', () => {
      for (const [name, config] of Object.entries(EMBEDDING_MODELS)) {
        expect(config.provider).toBeTruthy();
        expect(config.model).toBeTruthy();
        expect(config.dimensions).toBeGreaterThan(0);
        expect(config.description).toBeTruthy();
        expect(['commercial', 'open-source', 'lightweight']).toContain(config.category);
      }
    });
  });
});

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  describe('constructor and getModelInfo', () => {
    it('should create service with default model', () => {
      service = new EmbeddingService({
        gemini: { apiKey: 'test' },
        openai: { apiKey: 'test' },
        embedding: {},
      } as any);
      const info = service.getModelInfo();
      expect(info.model).toBe('text-embedding-004');
      expect(info.provider).toBe('gemini');
    });

    it('should create service with specified model', () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);
      const info = service.getModelInfo();
      expect(info.model).toBe('text-embedding-3-small');
      expect(info.provider).toBe('openai');
      expect(info.dimensions).toBe(1536);
    });

    it('should fallback to default for unknown model', () => {
      service = new EmbeddingService({
        embedding: { model: 'nonexistent-model' },
      } as any);
      const info = service.getModelInfo();
      expect(info.model).toBe('text-embedding-004');
    });
  });

  describe('getAvailableModels', () => {
    it('should return all models', () => {
      const models = EmbeddingService.getAvailableModels();
      expect(Object.keys(models).length).toBeGreaterThan(10);
    });
  });

  describe('getModelsByCategory', () => {
    it('should filter by category', () => {
      const commercial = EmbeddingService.getModelsByCategory('commercial');
      for (const config of Object.values(commercial)) {
        expect(config.category).toBe('commercial');
      }
    });
  });

  describe('cosineSimilarity', () => {
    beforeEach(() => {
      service = new EmbeddingService({
        embedding: {},
      } as any);
    });

    it('should return 1 for identical vectors', () => {
      const similarity = service.cosineSimilarity([1, 0, 0], [1, 0, 0]);
      expect(similarity).toBeCloseTo(1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      const similarity = service.cosineSimilarity([1, 0], [0, 1]);
      expect(similarity).toBeCloseTo(0.0);
    });

    it('should return -1 for opposite vectors', () => {
      const similarity = service.cosineSimilarity([1, 0], [-1, 0]);
      expect(similarity).toBeCloseTo(-1.0);
    });

    it('should return 0 for zero magnitude vector', () => {
      const similarity = service.cosineSimilarity([0, 0], [1, 0]);
      expect(similarity).toBe(0);
    });

    it('should return 0 for mismatched dimensions', () => {
      const similarity = service.cosineSimilarity([1, 0], [1, 0, 0]);
      expect(similarity).toBe(0);
    });

    it('should compute correct similarity', () => {
      const similarity = service.cosineSimilarity([1, 2, 3], [4, 5, 6]);
      // cos = (4+10+18) / (sqrt(14)*sqrt(77)) = 32 / (3.742 * 8.775) ≈ 0.9746
      expect(similarity).toBeCloseTo(0.9746, 3);
    });
  });

  describe('generateEmbedding', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should generate embedding with OpenAI', async () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('embeddings'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return null when OpenAI key missing', async () => {
      service = new EmbeddingService({
        openai: {},
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should return null on OpenAI API error', async () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });
      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should return null on unexpected OpenAI response format', async () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ bad: 'format' }) });
      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should return null on OpenAI fetch error', async () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      fetchSpy.mockRejectedValue(new Error('network error'));
      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with Gemini', async () => {
      service = new EmbeddingService({
        gemini: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-004' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: [0.4, 0.5, 0.6] } }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.4, 0.5, 0.6]);
    });

    it('should return null when Gemini key missing', async () => {
      service = new EmbeddingService({
        gemini: {},
        embedding: { model: 'text-embedding-004' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should return null on Gemini API error', async () => {
      service = new EmbeddingService({
        gemini: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-004' },
      } as any);

      fetchSpy.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should return null on unexpected Gemini response', async () => {
      service = new EmbeddingService({
        gemini: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-004' },
      } as any);

      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ bad: 'format' }) });
      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with Voyage (env key)', async () => {
      process.env.VOYAGE_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'voyage-3-large' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.7, 0.8] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.7, 0.8]);
      delete process.env.VOYAGE_API_KEY;
    });

    it('should return null when Voyage key missing', async () => {
      delete process.env.VOYAGE_API_KEY;
      service = new EmbeddingService({
        embedding: { model: 'voyage-3-large' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with Cohere', async () => {
      process.env.COHERE_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'cohere-embed-v4' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2]] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.1, 0.2]);
      delete process.env.COHERE_API_KEY;
    });

    it('should return null when Cohere key missing', async () => {
      delete process.env.COHERE_API_KEY;
      service = new EmbeddingService({
        embedding: { model: 'cohere-embed-v4' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with Mistral', async () => {
      process.env.MISTRAL_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'mistral-embed' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.3, 0.4] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.3, 0.4]);
      delete process.env.MISTRAL_API_KEY;
    });

    it('should return null when Mistral key missing', async () => {
      delete process.env.MISTRAL_API_KEY;
      service = new EmbeddingService({
        embedding: { model: 'mistral-embed' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with NVIDIA', async () => {
      process.env.NVIDIA_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'nv-embed-v2' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.5, 0.6] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.5, 0.6]);
      delete process.env.NVIDIA_API_KEY;
    });

    it('should return null when NVIDIA key missing', async () => {
      delete process.env.NVIDIA_API_KEY;
      service = new EmbeddingService({
        embedding: { model: 'nv-embed-v2' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with HuggingFace', async () => {
      process.env.HUGGINGFACE_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [0.1, 0.2, 0.3],
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.1, 0.2, 0.3]);
      delete process.env.HUGGINGFACE_API_KEY;
    });

    it('should handle HuggingFace token-level response (mean pooling)', async () => {
      process.env.HUGGINGFACE_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);

      // Token-level response: 3D array (batch of token embeddings)
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [[[0.2, 0.4], [0.6, 0.8]]],
      });

      const result = await service.generateEmbedding('hello');
      // Mean pooling: [(0.2+0.6)/2, (0.4+0.8)/2] = [0.4, 0.6]
      expect(result).toHaveLength(2);
      expect(result![0]).toBeCloseTo(0.4);
      expect(result![1]).toBeCloseTo(0.6);
      delete process.env.HUGGINGFACE_API_KEY;
    });

    it('should return null when HuggingFace key missing', async () => {
      delete process.env.HUGGINGFACE_API_KEY;
      service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });

    it('should generate embedding with Jina', async () => {
      process.env.JINA_API_KEY = 'test-key';
      service = new EmbeddingService({
        embedding: { model: 'jina-embeddings-v5-small' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.9, 0.1] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.9, 0.1]);
      delete process.env.JINA_API_KEY;
    });

    it('should return null when Jina key missing', async () => {
      delete process.env.JINA_API_KEY;
      service = new EmbeddingService({
        embedding: { model: 'jina-embeddings-v5-small' },
      } as any);

      const result = await service.generateEmbedding('hello');
      expect(result).toBeNull();
    });
  });

  describe('generateKbEmbedding', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should combine question, answer, and keywords', async () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
      });

      await service.generateKbEmbedding('question', 'answer', ['kw1', 'kw2']);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.input).toContain('Pertanyaan: question');
      expect(body.input).toContain('Jawaban: answer');
      expect(body.input).toContain('Kata kunci: kw1, kw2');
    });

    it('should omit empty keywords', async () => {
      service = new EmbeddingService({
        openai: { apiKey: 'test-key' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
      });

      await service.generateKbEmbedding('q', 'a', []);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.input).not.toContain('Kata kunci');
    });
  });
});