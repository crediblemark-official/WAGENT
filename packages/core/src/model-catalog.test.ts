import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveModel, refreshModelCatalog } from './model-catalog.js';

// Reset module-level cache between tests
beforeEach(async () => {
  await refreshModelCatalog();
  vi.restoreAllMocks();
});

describe('model-catalog', () => {
  describe('resolveModel', () => {
    it('should resolve openai/gpt-4o from local fallback', async () => {
      // Mock fetch to simulate models.dev failure (use local fallback)
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
      expect(result.npm).toBe('@ai-sdk/google');
    });

    it('should resolve groq/llama from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('groq/llama3-70b');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama3-70b');
      expect(result.baseUrl).toBe('https://api.groq.com/openai/v1');
    });

    it('should resolve deepseek/deepseek-coder from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('deepseek/deepseek-coder');
      expect(result.provider).toBe('deepseek');
      expect(result.baseUrl).toBe('https://api.deepseek.com/v1');
    });

    it('should resolve ollama/llama3 from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('ollama/llama3');
      expect(result.provider).toBe('ollama');
      expect(result.baseUrl).toBe('http://localhost:11434/api');
    });

    it('should resolve mistral/mistral-large from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('mistral/mistral-large');
      expect(result.provider).toBe('mistral');
      expect(result.npm).toBe('@ai-sdk/mistral');
    });

    it('should resolve xai/grok from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('xai/grok-2');
      expect(result.provider).toBe('xai');
      expect(result.baseUrl).toBe('https://api.x.ai/v1');
    });

    it('should resolve cohere/command from local fallback', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('cohere/command-r');
      expect(result.provider).toBe('cohere');
      expect(result.npm).toBe('@ai-sdk/cohere');
    });

    it('should use models.dev catalog when available', async () => {
      const mockCatalog = {
        openai: {
          name: 'OpenAI',
          npm: '@ai-sdk/openai',
          env: ['OPENAI_API_KEY'],
          api: 'https://api.openai.com/v1',
        },
        customprovider: {
          name: 'Custom Provider',
          npm: '@ai-sdk/custom',
          env: ['CUSTOM_API_KEY'],
          api: 'https://api.custom.com/v1',
        },
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

      // "openai" without /model should still resolve
      const result = await resolveModel('openai');
      expect(result.provider).toBe('openai');
    });

    it('should create fallback for completely unknown model', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('totallyunknown/some-model');
      expect(result.provider).toBe('totallyunknown');
      expect(result.model).toBe('some-model');
      expect(result.input).toBe('totallyunknown/some-model');
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
      expect(result.envKey).toBe('GOOGLE_API_KEY');
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
      const mockCatalog = {
        newprovider: {
          name: 'New Provider',
          npm: '@ai-sdk/newprovider',
          env: ['NEW_API_KEY'],
          api: 'https://api.new.com/v1',
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCatalog,
      }));

      await refreshModelCatalog();

      const result = await resolveModel('newprovider/test-model');
      expect(result.provider).toBe('newprovider');
      expect(result.baseUrl).toBe('https://api.new.com/v1');
    });

    it('should handle models.dev fetch failure gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      // Should not throw
      await refreshModelCatalog();

      // Should still resolve from local fallback
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

      // Should still resolve from local fallback
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
    });
  });

  describe('model parsing', () => {
    it('should parse provider/model format correctly', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('anthropic/claude-3.5-sonnet');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3.5-sonnet');
    });

    it('should handle model ID with multiple slashes', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('openai/gpt-4o-mini-2024-07-18');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini-2024-07-18');
    });

    it('should handle fireworks provider', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('fireworks/llama-v2-70b');
      expect(result.provider).toBe('fireworks');
      expect(result.baseUrl).toBe('https://api.fireworks.ai/inference/v1');
    });

    it('should handle together provider', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('together/llama-3-70b');
      expect(result.provider).toBe('together');
      expect(result.baseUrl).toBe('https://api.together.xyz/v1');
    });

    it('should handle perplexity provider', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await resolveModel('perplexity/sonar-medium');
      expect(result.provider).toBe('perplexity');
      expect(result.baseUrl).toBe('https://api.perplexity.ai');
    });
  });
});