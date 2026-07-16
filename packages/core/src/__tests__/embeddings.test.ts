import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  EmbeddingService,
  EMBEDDING_MODELS,
  getModelsByCategory,
  getModelsByProvider,
  getDefaultModel,
} from '../rag/embeddings.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  delete process.env.COHERE_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.HUGGINGFACE_API_KEY;
  delete process.env.JINA_API_KEY;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  delete process.env.COHERE_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.HUGGINGFACE_API_KEY;
  delete process.env.JINA_API_KEY;
});

// ── EMBEDDING_MODELS ──────────────────────────────────────────

describe('EMBEDDING_MODELS', () => {
  it('has expected models', () => {
    expect(EMBEDDING_MODELS['text-embedding-004']).toBeDefined();
    expect(EMBEDDING_MODELS['text-embedding-3-small']).toBeDefined();
    expect(EMBEDDING_MODELS['text-embedding-3-large']).toBeDefined();
    expect(EMBEDDING_MODELS['voyage-3-large']).toBeDefined();
    expect(EMBEDDING_MODELS['cohere-embed-v4']).toBeDefined();
    expect(EMBEDDING_MODELS['mistral-embed']).toBeDefined();
    expect(EMBEDDING_MODELS['nv-embed-v2']).toBeDefined();
    expect(EMBEDDING_MODELS['all-MiniLM-L6-v2']).toBeDefined();
    expect(EMBEDDING_MODELS['jina-embeddings-v5-small']).toBeDefined();
  });

  it('each model has valid config', () => {
    for (const [name, config] of Object.entries(EMBEDDING_MODELS)) {
      expect(config.provider).toBeTruthy();
      expect(config.model).toBeTruthy();
      expect(config.dimensions).toBeGreaterThan(0);
      expect(config.description).toBeTruthy();
      expect(['commercial', 'open-source', 'lightweight']).toContain(config.category);
    }
  });
});

// ── getModelsByCategory ───────────────────────────────────────

describe('getModelsByCategory', () => {
  it('returns only commercial models', () => {
    const result = getModelsByCategory('commercial');
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const config of Object.values(result)) {
      expect(config.category).toBe('commercial');
    }
  });

  it('returns only open-source models', () => {
    const result = getModelsByCategory('open-source');
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const config of Object.values(result)) {
      expect(config.category).toBe('open-source');
    }
  });

  it('returns only lightweight models', () => {
    const result = getModelsByCategory('lightweight');
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const config of Object.values(result)) {
      expect(config.category).toBe('lightweight');
    }
  });
});

// ── getModelsByProvider ───────────────────────────────────────

describe('getModelsByProvider', () => {
  it('returns only gemini models', () => {
    const result = getModelsByProvider('gemini');
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const config of Object.values(result)) {
      expect(config.provider).toBe('gemini');
    }
  });

  it('returns only openai models', () => {
    const result = getModelsByProvider('openai');
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const config of Object.values(result)) {
      expect(config.provider).toBe('openai');
    }
  });

  it('returns empty for nonexistent provider', () => {
    expect(Object.keys(getModelsByProvider('nonexistent' as any))).toHaveLength(0);
  });
});

// ── getDefaultModel ───────────────────────────────────────────

describe('getDefaultModel', () => {
  it('returns gemini default with no category', () => {
    expect(getDefaultModel()).toBe('text-embedding-004');
  });

  it('returns commercial default', () => {
    expect(getDefaultModel('commercial')).toBe('text-embedding-3-small');
  });

  it('returns open-source default', () => {
    expect(getDefaultModel('open-source')).toBe('bge-large-en-v1.5');
  });

  it('returns lightweight default', () => {
    expect(getDefaultModel('lightweight')).toBe('all-MiniLM-L6-v2');
  });
});

// ── EmbeddingService.constructor ──────────────────────────────

describe('EmbeddingService', () => {
  describe('constructor and getModelInfo', () => {
    it('creates service with valid model', () => {
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-3-small' },
      } as any);
      const info = service.getModelInfo();
      expect(info.model).toBe('text-embedding-3-small');
      expect(info.provider).toBe('openai');
      expect(info.dimensions).toBe(1536);
    });

    it('falls back to default for unknown model', () => {
      const service = new EmbeddingService({
        embedding: { model: 'nonexistent-model-xyz' },
      } as any);
      expect(service.getModelInfo().model).toBe('text-embedding-004');
    });

    it('defaults to text-embedding-004 when no embedding config', () => {
      const service = new EmbeddingService({} as any);
      expect(service.getModelInfo().model).toBe('text-embedding-004');
    });
  });

  describe('getAvailableModels (static)', () => {
    it('returns all models', () => {
      const models = EmbeddingService.getAvailableModels();
      expect(Object.keys(models).length).toBeGreaterThan(10);
      expect(models).toBe(EMBEDDING_MODELS);
    });
  });

  describe('getModelsByCategory (static)', () => {
    it('delegates to helper function', () => {
      const commercial = EmbeddingService.getModelsByCategory('commercial');
      for (const config of Object.values(commercial)) {
        expect(config.category).toBe('commercial');
      }
    });
  });

  describe('cosineSimilarity', () => {
    const service = new EmbeddingService({ embedding: {} } as any);

    it('returns 1 for identical vectors', () => {
      expect(service.cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(service.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it('returns 0 for different lengths', () => {
      expect(service.cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    });

    it('returns 0 for zero vectors', () => {
      expect(service.cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it('returns -1 for opposite vectors', () => {
      expect(service.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });
  });

  describe('generateKbEmbedding', () => {
    it('constructs combined text and calls generateEmbedding', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-004' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
      });

      const result = await service.generateKbEmbedding('What is X?', 'Answer Y', ['key1', 'key2']);
      expect(result).toEqual([0.1, 0.2, 0.3]);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.content.parts[0].text).toContain('Pertanyaan: What is X?');
      expect(callBody.content.parts[0].text).toContain('Jawaban: Answer Y');
      expect(callBody.content.parts[0].text).toContain('Kata kunci: key1, key2');
    });

    it('omits keywords line when keywords is empty', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-004' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: [0.1] } }),
      });

      await service.generateKbEmbedding('Q', 'A', []);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.content.parts[0].text).not.toContain('Kata kunci');
    });
  });

  // ── Provider: Gemini ──────────────────────────────────────

  describe('Gemini provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-004' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-004' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('returns null on non-ok response', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-004' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false, status: 403, text: async () => 'Forbidden',
      });

      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('returns null on unexpected response format', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-004' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unexpected: 'format' }),
      });

      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: OpenAI ──────────────────────────────────────

  describe('OpenAI provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.1, 0.2]);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-3-small' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('returns null on error response', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'text-embedding-3-small' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false, status: 500, text: async () => 'Server Error',
      });

      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: Voyage ──────────────────────────────────────

  describe('Voyage provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.VOYAGE_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'voyage-3-large' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.5, 0.6] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.5, 0.6]);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'voyage-3-large' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: Cohere ──────────────────────────────────────

  describe('Cohere provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.COHERE_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'cohere-embed-v4' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.7, 0.8]] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.7, 0.8]);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'cohere-embed-v4' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: Mistral ─────────────────────────────────────

  describe('Mistral provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.MISTRAL_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'mistral-embed' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.3, 0.4] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.3, 0.4]);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'mistral-embed' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: NVIDIA ──────────────────────────────────────

  describe('NVIDIA provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.NVIDIA_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'nv-embed-v2' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.9, 1.0] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.9, 1.0]);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'nv-embed-v2' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: HuggingFace ─────────────────────────────────

  describe('HuggingFace provider', () => {
    it('generates embedding with API key in env (flat array)', async () => {
      process.env.HUGGINGFACE_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [0.1, 0.2, 0.3],
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('generates embedding with token-level (mean pooling)', async () => {
      process.env.HUGGINGFACE_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [[[0.1, 0.2], [0.3, 0.4]]],
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toHaveLength(2);
      expect(result![0]).toBeCloseTo(0.2);
      expect(result![1]).toBeCloseTo(0.3);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('returns null on error response', async () => {
      process.env.HUGGINGFACE_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false, status: 503, text: async () => 'Model loading',
      });

      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });

  // ── Provider: Jina ────────────────────────────────────────

  describe('Jina provider', () => {
    it('generates embedding with API key in env', async () => {
      process.env.JINA_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'jina-embeddings-v5-small' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.4, 0.5, 0.6] }] }),
      });

      const result = await service.generateEmbedding('hello');
      expect(result).toEqual([0.4, 0.5, 0.6]);
    });

    it('returns null when API key missing', async () => {
      const service = new EmbeddingService({
        embedding: { model: 'jina-embeddings-v5-small' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('returns null on bad response format', async () => {
      process.env.JINA_API_KEY = 'test-key';
      const service = new EmbeddingService({
        embedding: { model: 'jina-embeddings-v5-small' },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{}] }),
      });

      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });
});
