import { describe, it, expect } from 'vitest';
import {
  EmbeddingService,
  EMBEDDING_MODELS,
  getModelsByCategory,
  getModelsByProvider,
  getDefaultModel,
} from '../embeddings.js';

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
  describe('constructor and getModelInfo', () => {
    it('should create service with default model', () => {
      const service = new EmbeddingService({
        gemini: { apiKey: 'test' },
        openai: { apiKey: 'test' },
        embedding: {},
      } as any);
      const info = service.getModelInfo();
      expect(info.model).toBe('text-embedding-004');
      expect(info.provider).toBe('gemini');
    });

    it('should create service with specified model', () => {
      const service = new EmbeddingService({
        openai: { apiKey: 'test' },
        embedding: { model: 'text-embedding-3-small' },
      } as any);
      const info = service.getModelInfo();
      expect(info.model).toBe('text-embedding-3-small');
      expect(info.provider).toBe('openai');
      expect(info.dimensions).toBe(1536);
    });

    it('should fallback to default for unknown model', () => {
      const service = new EmbeddingService({
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
    const service = new EmbeddingService({ embedding: {} } as any);

    it('should return 1 for identical vectors', () => {
      expect(service.cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(service.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });

    it('should return -1 for opposite vectors', () => {
      expect(service.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });

    it('should return 0 for zero magnitude vector', () => {
      expect(service.cosineSimilarity([0, 0], [1, 0])).toBe(0);
    });

    it('should return 0 for mismatched dimensions', () => {
      expect(service.cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    });

    it('should compute correct similarity', () => {
      expect(service.cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.9746, 3);
    });
  });

  describe('generateEmbedding', () => {
    it('should return null when OpenAI key missing', async () => {
      const service = new EmbeddingService({
        openai: {},
        embedding: { model: 'text-embedding-3-small' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when Gemini key missing', async () => {
      const service = new EmbeddingService({
        gemini: {},
        embedding: { model: 'text-embedding-004' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when Voyage key missing', async () => {
      delete process.env.VOYAGE_API_KEY;
      const service = new EmbeddingService({
        embedding: { model: 'voyage-3-large' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when Cohere key missing', async () => {
      delete process.env.COHERE_API_KEY;
      const service = new EmbeddingService({
        embedding: { model: 'cohere-embed-v4' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when Mistral key missing', async () => {
      delete process.env.MISTRAL_API_KEY;
      const service = new EmbeddingService({
        embedding: { model: 'mistral-embed' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when NVIDIA key missing', async () => {
      delete process.env.NVIDIA_API_KEY;
      const service = new EmbeddingService({
        embedding: { model: 'nv-embed-v2' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when HuggingFace key missing', async () => {
      delete process.env.HUGGINGFACE_API_KEY;
      const service = new EmbeddingService({
        embedding: { model: 'all-MiniLM-L6-v2' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });

    it('should return null when Jina key missing', async () => {
      delete process.env.JINA_API_KEY;
      const service = new EmbeddingService({
        embedding: { model: 'jina-embeddings-v5-small' },
      } as any);
      expect(await service.generateEmbedding('hello')).toBeNull();
    });
  });
});