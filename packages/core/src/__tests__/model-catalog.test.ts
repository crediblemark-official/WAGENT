import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveModel, refreshModelCatalog, clearCatalogCache } from '../model-catalog.js';

beforeEach(async () => {
  clearCatalogCache();
  vi.restoreAllMocks();
});

describe('model-catalog', () => {
  describe('resolveModel', () => {
    it('should resolve openai/gpt-4o from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.npm).toBe('@ai-sdk/openai');
      expect(result.input).toBe('openai/gpt-4o');
    });

    it('should resolve anthropic/claude-3 from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('anthropic/claude-3-opus');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-opus');
      expect(result.npm).toBe('@ai-sdk/anthropic');
    });

    it('should resolve google/gemini-pro from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('google/gemini-pro');
      expect(result.provider).toBe('google');
      expect(result.model).toBe('gemini-pro');
    });

    it('should resolve groq/llama from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('groq/llama3-70b');
      expect(result.provider).toBe('groq');
      expect(result.baseUrl).toBe('https://api.groq.com/openai/v1');
    });

    it('should resolve deepseek from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('deepseek/deepseek-coder');
      expect(result.provider).toBe('deepseek');
      expect(result.baseUrl).toBe('https://api.deepseek.com/v1');
    });

    it('should resolve ollama from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('ollama/llama3');
      expect(result.provider).toBe('ollama');
      expect(result.baseUrl).toBe('http://localhost:11434/api');
    });

    it('should resolve mistral from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('mistral/mistral-large');
      expect(result.provider).toBe('mistral');
    });

    it('should resolve xai from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('xai/grok-2');
      expect(result.provider).toBe('xai');
      expect(result.baseUrl).toBe('https://api.x.ai/v1');
    });

    it('should use models.dev catalog when available', async () => {
      // Clear cache so resolveModel calls refreshCatalog() which uses our mock
      clearCatalogCache();

      const mockCatalog = {
        customprovider: { name: 'Custom Provider', npm: '@ai-sdk/custom', env: ['CUSTOM_API_KEY'], api: 'https://api.custom.com/v1' },
        openai: { name: 'OpenAI', npm: '@ai-sdk/openai', env: ['OPENAI_API_KEY'] },
        anthropic: { name: 'Anthropic', npm: '@ai-sdk/anthropic', env: ['ANTHROPIC_API_KEY'] },
        google: { name: 'Google', npm: '@ai-sdk/google', env: ['GOOGLE_API_KEY'] },
        groq: { name: 'Groq', npm: '@ai-sdk/groq', env: ['GROQ_API_KEY'] },
        deepseek: { name: 'DeepSeek', npm: '@ai-sdk/openai-compatible', env: ['DEEPSEEK_API_KEY'] },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCatalog,
      }));

      const result = await resolveModel('customprovider/my-model');
      expect(result.provider).toBe('customprovider');
      expect(result.model).toBe('my-model');
      expect(result.baseUrl).toBe('https://api.custom.com/v1');
    });

    it('should find provider without slash prefix', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('openai');
      expect(result.provider).toBe('openai');
    });

    it('should create fallback for unknown model', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('totallyunknown/some-model');
      expect(result.provider).toBe('totallyunknown');
      expect(result.model).toBe('some-model');
    });

    it('should create fallback for model without slash', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('gpt-4');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
    });

    it('should pick up API key from environment', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-123';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('openai/gpt-4o');
      expect(result.apiKey).toBe('sk-test-123');
      expect(result.envKey).toBe('OPENAI_API_KEY');
      delete process.env.OPENAI_API_KEY;
    });

    it('should prefer first matching env key', async () => {
      process.env.GOOGLE_API_KEY = 'google-key';
      process.env.GEMINI_API_KEY = 'gemini-key';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('google/gemini-pro');
      expect(result.apiKey).toBe('google-key');
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
    });

    it('should return undefined apiKey when env var not set', async () => {
      delete process.env.OPENAI_API_KEY;
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const result = await resolveModel('openai/gpt-4o');
      expect(result.apiKey).toBeUndefined();
    });
  });

  describe('refreshModelCatalog', () => {
    it('should refresh cache from models.dev', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          newprovider: { name: 'New Provider', api: 'https://api.new.com/v1' },
        }),
      }));

      await refreshModelCatalog();
      const result = await resolveModel('newprovider/test-model');
      expect(result.provider).toBe('newprovider');
    });

    it('should handle models.dev fetch failure gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      await refreshModelCatalog();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should handle non-ok response from models.dev', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }));
      await refreshModelCatalog();
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });
  });
});