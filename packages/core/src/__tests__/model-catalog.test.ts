import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveModel,
  clearCatalogCache,
  refreshModelCatalog,
  getAllModels,
  getCatalogProviders,
  getModelsForProviderCatalog,
} from '../agent/model-catalog.js';

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
  clearCatalogCache();
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('model-catalog', () => {
  // ── resolveModel with local providers ──────────────────────

  describe('resolveModel from local providers', () => {
    it('should resolve openai/gpt-4o', async () => {
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.npm).toBe('@ai-sdk/openai');
      expect(result.input).toBe('openai/gpt-4o');
    });

    it('should resolve anthropic/claude-3-opus', async () => {
      const result = await resolveModel('anthropic/claude-3-opus');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-opus');
      expect(result.npm).toBe('@ai-sdk/anthropic');
    });

    it('should resolve google/gemini-pro', async () => {
      const result = await resolveModel('google/gemini-pro');
      expect(result.provider).toBe('google');
      expect(result.model).toBe('gemini-pro');
    });

    it('should resolve groq/llama3-70b', async () => {
      const result = await resolveModel('groq/llama3-70b');
      expect(result.provider).toBe('groq');
      expect(result.baseUrl).toBe('https://api.groq.com/openai/v1');
    });

    it('should resolve deepseek/deepseek-coder', async () => {
      const result = await resolveModel('deepseek/deepseek-coder');
      expect(result.provider).toBe('deepseek');
      expect(result.baseUrl).toBe('https://api.deepseek.com/v1');
    });

    it('should resolve ollama/llama3 with default baseUrl', async () => {
      const result = await resolveModel('ollama/llama3');
      expect(result.provider).toBe('ollama');
      expect(result.baseUrl).toBe('http://localhost:11434/api');
    });

    it('should resolve mistral/mistral-large', async () => {
      const result = await resolveModel('mistral/mistral-large');
      expect(result.provider).toBe('mistral');
      expect(result.npm).toBe('@ai-sdk/mistral');
    });

    it('should resolve xai/grok-2', async () => {
      const result = await resolveModel('xai/grok-2');
      expect(result.provider).toBe('xai');
      expect(result.baseUrl).toBe('https://api.x.ai/v1');
    });

    it('should resolve cohere/command', async () => {
      const result = await resolveModel('cohere/command');
      expect(result.provider).toBe('cohere');
    });

    it('should resolve fireworks/accounts/fireworks/models/llama', async () => {
      const result = await resolveModel('fireworks/accounts/fireworks/models/llama-v2');
      expect(result.provider).toBe('fireworks');
    });

    it('should resolve together/togethercomputer/llama', async () => {
      const result = await resolveModel('together/togethercomputer/llama-2-70b');
      expect(result.provider).toBe('together');
    });

    it('should resolve perplexity/sonar', async () => {
      const result = await resolveModel('perplexity/sonar');
      expect(result.provider).toBe('perplexity');
    });
  });

  // ── resolveModel edge cases ────────────────────────────────

  describe('resolveModel edge cases', () => {
    it('should find provider without slash prefix', async () => {
      const result = await resolveModel('openai');
      expect(result.provider).toBe('openai');
    });

    it('should create fallback for unknown provider/model', async () => {
      const result = await resolveModel('totallyunknown/some-model');
      expect(result.provider).toBe('totallyunknown');
      expect(result.model).toBe('some-model');
    });

    it('should create fallback for model without slash', async () => {
      const result = await resolveModel('gpt-4');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
    });

    it('should pick up API key from environment', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-123';
      clearCatalogCache();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.apiKey).toBe('sk-test-123');
      expect(result.envKey).toBe('OPENAI_API_KEY');
      delete process.env.OPENAI_API_KEY;
    });

    it('should prefer first matching env key for google', async () => {
      process.env.GOOGLE_API_KEY = 'google-key';
      process.env.GEMINI_API_KEY = 'gemini-key';
      clearCatalogCache();
      const result = await resolveModel('google/gemini-pro');
      expect(result.apiKey).toBe('google-key');
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
    });

    it('should return undefined apiKey when env var not set', async () => {
      delete process.env.OPENAI_API_KEY;
      clearCatalogCache();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.apiKey).toBeUndefined();
    });

    it('fallback for unknown model should set provider from slash', async () => {
      const result = await resolveModel('myprovider/mymodel');
      expect(result.provider).toBe('myprovider');
      expect(result.model).toBe('mymodel');
    });

    it('fallback for no-slash unknown should default to openai provider', async () => {
      const result = await resolveModel('randommodel');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('randommodel');
    });
  });

  // ── clearCatalogCache ──────────────────────────────────────

  describe('clearCatalogCache', () => {
    it('should clear cache and force refresh', async () => {
      clearCatalogCache();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should allow re-resolution after clearing', async () => {
      clearCatalogCache();
      const r1 = await resolveModel('openai/gpt-4o');
      expect(r1.provider).toBe('openai');
      clearCatalogCache();
      const r2 = await resolveModel('anthropic/claude-3');
      expect(r2.provider).toBe('anthropic');
    });
  });

  // ── refreshModelCatalog ────────────────────────────────────

  describe('refreshModelCatalog', () => {
    it('should succeed with valid catalog data from fetch', async () => {
      const validData: Record<string, any> = {};
      for (let i = 0; i < 10; i++) {
        validData[`provider${i}`] = { name: `Provider ${i}`, id: `provider${i}` };
      }
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => validData,
      });
      await refreshModelCatalog();
      const providers = await getCatalogProviders();
      expect(Object.keys(providers).length).toBeGreaterThanOrEqual(5);
    });

    it('should use local fallback when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await refreshModelCatalog();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should use local fallback on HTTP error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      await refreshModelCatalog();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should use local fallback for invalid data (too few providers)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ p1: { name: 'P1' } }),
      });
      await refreshModelCatalog();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should use local fallback for null response data', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => null,
      });
      await refreshModelCatalog();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should skip entries without name property', async () => {
      const data: Record<string, any> = {};
      for (let i = 0; i < 10; i++) {
        data[`p${i}`] = { name: `Provider ${i}` };
      }
      data['invalid'] = { noName: true };
      data['alsoInvalid'] = null;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => data,
      });
      await refreshModelCatalog();
      const providers = await getCatalogProviders();
      expect(providers['invalid']).toBeUndefined();
      expect(providers['alsoInvalid']).toBeUndefined();
      expect(providers['p0']).toBeDefined();
    });
  });

  // ── getAllModels ───────────────────────────────────────────

  describe('getAllModels', () => {
    it('should return models from loaded catalog', async () => {
      clearCatalogCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          const data: Record<string, any> = {};
          for (let i = 0; i < 10; i++) {
            data[`p${i}`] = {
              name: `Provider ${i}`,
              models: {
                model1: { id: 'model1', name: 'Model 1' },
                model2: { id: 'model2', name: 'Model 2' },
              },
            };
          }
          return data;
        },
      });
      const models = await getAllModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('name');
      expect(models[0]).toHaveProperty('provider');
    });

    it('should return empty array when catalog has no models', async () => {
      clearCatalogCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          const data: Record<string, any> = {};
          for (let i = 0; i < 10; i++) {
            data[`p${i}`] = { name: `Provider ${i}` };
          }
          return data;
        },
      });
      const models = await getAllModels();
      expect(models).toEqual([]);
    });
  });

  // ── getCatalogProviders ────────────────────────────────────

  describe('getCatalogProviders', () => {
    it('should return providers object', async () => {
      clearCatalogCache();
      const providers = await getCatalogProviders();
      expect(providers).toBeDefined();
      expect(typeof providers).toBe('object');
      expect(Object.keys(providers).length).toBeGreaterThan(0);
    });

    it('should include known providers', async () => {
      clearCatalogCache();
      const providers = await getCatalogProviders();
      expect(providers['openai']).toBeDefined();
    });
  });

  // ── getModelsForProviderCatalog ────────────────────────────

  describe('getModelsForProviderCatalog', () => {
    it('should return models for a known provider with models', async () => {
      clearCatalogCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          const data: Record<string, any> = {};
          for (let i = 0; i < 10; i++) {
            data[`p${i}`] = {
              name: `Provider ${i}`,
              models: {
                'model-a': { id: 'model-a', name: 'Model A' },
                'model-b': { id: 'model-b', name: 'Model B' },
              },
            };
          }
          return data;
        },
      });
      const models = await getModelsForProviderCatalog('p0');
      expect(models.length).toBe(2);
      expect(models[0]).toEqual({ value: 'model-a', label: 'Model A' });
      expect(models[1]).toEqual({ value: 'model-b', label: 'Model B' });
    });

    it('should return empty array for unknown provider', async () => {
      clearCatalogCache();
      const models = await getModelsForProviderCatalog('nonexistent');
      expect(models).toEqual([]);
    });

    it('should return empty array for provider without models', async () => {
      clearCatalogCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          const data: Record<string, any> = {};
          for (let i = 0; i < 10; i++) {
            data[`p${i}`] = { name: `Provider ${i}` };
          }
          return data;
        },
      });
      const models = await getModelsForProviderCatalog('p0');
      expect(models).toEqual([]);
    });

    it('should use model id as label when name is missing', async () => {
      clearCatalogCache();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          const data: Record<string, any> = {};
          for (let i = 0; i < 10; i++) {
            data[`p${i}`] = {
              name: `Provider ${i}`,
              models: {
                'm1': { id: 'm1' },
              },
            };
          }
          return data;
        },
      });
      const models = await getModelsForProviderCatalog('p0');
      expect(models[0]).toEqual({ value: 'm1', label: 'm1' });
    });
  });

  // ── LOCAL_PROVIDERS structure ──────────────────────────────

  describe('LOCAL_PROVIDERS structure', () => {
    it('should resolve all expected local provider IDs', async () => {
      const providerIds = [
        'openai', 'anthropic', 'google', 'groq', 'deepseek',
        'mistral', 'xai', 'ollama', 'cohere', 'fireworks',
        'together', 'perplexity',
      ];
      for (const pid of providerIds) {
        clearCatalogCache();
        const result = await resolveModel(`${pid}/test-model`);
        expect(result.provider).toBe(pid);
      }
    });
  });
});
