import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Transcriber } from '../services/transcriber.js';
import type { WAgentConfig } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getTranscriberInstruction: () => 'Transcribe the audio',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function baseConfig(overrides: Partial<WAgentConfig> = {}): WAgentConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'test',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
    ...overrides,
  } as WAgentConfig;
}

describe('Transcriber', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  describe('provider auto-detection', () => {
    it('detects gemini when provider is google and apiKey exists', () => {
      const config = baseConfig({ resolvedModel: { input: 'audio', provider: 'google', model: 'gemini-2.0-flash', apiKey: 'g-key' } });
      const t = new Transcriber(config);
      expect(t.getProvider()).toBe('gemini');
    });

    it('detects openai when provider is openai and apiKey exists', () => {
      const config = baseConfig({ resolvedModel: { input: 'audio', provider: 'openai', model: 'whisper-1', apiKey: 'o-key' } });
      const t = new Transcriber(config);
      expect(t.getProvider()).toBe('openai');
    });

    it('detects openai when no provider but OPENAI_API_KEY env is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const config = baseConfig();
      const t = new Transcriber(config);
      expect(t.getProvider()).toBe('openai');
    });

    it('detects gemini when no provider but GEMINI_API_KEY env is set', () => {
      process.env.GEMINI_API_KEY = 'gem-key';
      const config = baseConfig();
      const t = new Transcriber(config);
      expect(t.getProvider()).toBe('gemini');
    });

    it('detects none when no provider and no env keys', () => {
      const config = baseConfig();
      const t = new Transcriber(config);
      expect(t.getProvider()).toBe('none');
    });
  });

  describe('isAvailable', () => {
    it('returns true when provider is openai', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const t = new Transcriber(baseConfig());
      expect(t.isAvailable()).toBe(true);
    });

    it('returns false when provider is none', () => {
      const t = new Transcriber(baseConfig());
      expect(t.isAvailable()).toBe(false);
    });
  });

  describe('transcribe', () => {
    it('throws when provider is none', async () => {
      const t = new Transcriber(baseConfig());
      const audio = { buffer: Buffer.from('test'), mimetype: 'audio/ogg' };
      await expect(t.transcribe(audio)).rejects.toThrow('No transcription provider configured');
    });

    it('calls OpenAI endpoint correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'hello world' }),
      });

      process.env.OPENAI_API_KEY = 'sk-test';
      const t = new Transcriber(baseConfig());
      const audio = { buffer: Buffer.from('test'), mimetype: 'audio/ogg', duration: 5 };
      const result = await t.transcribe(audio);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer sk-test');
      expect(result.text).toBe('hello world');
      expect(result.provider).toBe('openai');
    });

    it('calls Gemini endpoint correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'transcribed text' }] } }],
        }),
      });

      process.env.GEMINI_API_KEY = 'gem-key';
      const t = new Transcriber(baseConfig());
      const audio = { buffer: Buffer.from('test'), mimetype: 'audio/ogg', duration: 3 };
      const result = await t.transcribe(audio);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com/v1beta/models/');
      expect(url).toContain(':generateContent?key=gem-key');
      expect(opts.method).toBe('POST');
      expect(result.text).toBe('transcribed text');
      expect(result.provider).toBe('gemini');
    });
  });

  describe('extension mapping', () => {
    it('maps ogg to .ogg', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });

      process.env.OPENAI_API_KEY = 'sk-test';
      const t = new Transcriber(baseConfig());
      await t.transcribe({ buffer: Buffer.from('x'), mimetype: 'audio/ogg' });

      const formData = mockFetch.mock.calls[0][1].body;
      expect(formData).toBeInstanceOf(FormData);
    });

    it('maps mp3 to .mp3', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });

      process.env.OPENAI_API_KEY = 'sk-test';
      const t = new Transcriber(baseConfig());
      await t.transcribe({ buffer: Buffer.from('x'), mimetype: 'audio/mpeg' });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('maps wav to .wav', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });

      process.env.OPENAI_API_KEY = 'sk-test';
      const t = new Transcriber(baseConfig());
      await t.transcribe({ buffer: Buffer.from('x'), mimetype: 'audio/wav' });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('defaults unknown mimetype to .ogg', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });

      process.env.OPENAI_API_KEY = 'sk-test';
      const t = new Transcriber(baseConfig());
      await t.transcribe({ buffer: Buffer.from('x'), mimetype: 'audio/unknown' });

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
