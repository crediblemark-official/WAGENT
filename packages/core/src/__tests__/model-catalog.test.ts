import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveModel, clearCatalogCache } from '../agent/model-catalog.js';

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('model-catalog', () => {
  describe('resolveModel', () => {
    it('should resolve openai/gpt-4o', async () => {
      const result = await resolveModel('openai/gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.npm).toBe('@ai-sdk/openai');
      expect(result.input).toBe('openai/gpt-4o');
    });

    it('should resolve anthropic/claude-3', async () => {
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

    it('should resolve groq/llama', async () => {
      const result = await resolveModel('groq/llama3-70b');
      expect(result.provider).toBe('groq');
    });

    it('should resolve deepseek', async () => {
      const result = await resolveModel('deepseek/deepseek-coder');
      expect(result.provider).toBe('deepseek');
    });

    it('should resolve ollama', async () => {
      const result = await resolveModel('ollama/llama3');
      expect(result.provider).toBe('ollama');
      expect(result.baseUrl).toBe('http://localhost:11434/api');
    });

    it('should resolve mistral', async () => {
      const result = await resolveModel('mistral/mistral-large');
      expect(result.provider).toBe('mistral');
    });

    it('should resolve xai', async () => {
      const result = await resolveModel('xai/grok-2');
      expect(result.provider).toBe('xai');
    });

    it('should find provider without slash prefix', async () => {
      const result = await resolveModel('openai');
      expect(result.provider).toBe('openai');
    });

    it('should create fallback for unknown model', async () => {
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
      const result = await resolveModel('openai/gpt-4o');
      expect(result.apiKey).toBe('sk-test-123');
      expect(result.envKey).toBe('OPENAI_API_KEY');
      delete process.env.OPENAI_API_KEY;
    });

    it('should prefer first matching env key', async () => {
      process.env.GOOGLE_API_KEY = 'google-key';
      process.env.GEMINI_API_KEY = 'gemini-key';
      const result = await resolveModel('google/gemini-pro');
      expect(result.apiKey).toBe('google-key');
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
    });

    it('should return undefined apiKey when env var not set', async () => {
      delete process.env.OPENAI_API_KEY;
      const result = await resolveModel('openai/gpt-4o');
      expect(result.apiKey).toBeUndefined();
    });
  });
});
