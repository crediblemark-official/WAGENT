import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Transcriber } from './transcriber.js';
import { OpenCSConfig, AudioMessageData } from './types.js';

// Mock global fetch
const mockFetch = vi.fn();

function createMockConfig(overrides?: Partial<OpenCSConfig>): OpenCSConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'test',
    dashboardPort: 3030,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
    openai: { apiKey: 'sk-test123', model: 'whisper-1' },
    ...overrides,
  };
}

describe('Transcriber', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // @ts-ignore — mock global fetch
    globalThis.fetch = mockFetch;
  });

  describe('OpenAI provider', () => {
    it('should detect OpenAI provider when API key is set', () => {
      const config = createMockConfig();
      const transcriber = new Transcriber(config);
      expect(transcriber.getProvider()).toBe('openai');
      expect(transcriber.isAvailable()).toBe(true);
    });

    it('should detect Gemini provider when only Gemini is configured', () => {
      const config = createMockConfig({ openai: undefined, gemini: { apiKey: 'gemini-key', model: 'gemini-2.0-flash' } });
      const transcriber = new Transcriber(config);
      expect(transcriber.getProvider()).toBe('gemini');
    });

    it('should detect none when no API key is configured', () => {
      const config = createMockConfig({ openai: undefined, gemini: undefined });
      const transcriber = new Transcriber(config);
      expect(transcriber.getProvider()).toBe('none');
      expect(transcriber.isAvailable()).toBe(false);
    });

    it('should call OpenAI Whisper API and return transcribed text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Halo, apa kabar?' }),
      });

      const transcriber = new Transcriber(createMockConfig());
      const audio: AudioMessageData = {
        buffer: Buffer.from('fake-audio-data'),
        mimetype: 'audio/ogg',
        duration: 5,
      };

      const result = await transcriber.transcribe(audio);

      expect(result.text).toBe('Halo, apa kabar?');
      expect(result.provider).toBe('openai');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer sk-test123' },
        })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      });

      const transcriber = new Transcriber(createMockConfig());
      const audio: AudioMessageData = { buffer: Buffer.from('x'), mimetype: 'audio/ogg' };

      await expect(transcriber.transcribe(audio)).rejects.toThrow('OpenAI Whisper API error: 401');
    });

    it('should throw when no OpenAI API key', async () => {
      const config = createMockConfig({ openai: undefined });
      const transcriber = new Transcriber(config);
      const audio: AudioMessageData = { buffer: Buffer.from('x'), mimetype: 'audio/ogg' };
      await expect(transcriber.transcribe(audio)).rejects.toThrow('No transcription provider configured');
    });
  });

  describe('Gemini provider', () => {
    it('should call Gemini API for transcription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Halo, ini dari Gemini' }] } }] }),
      });

      const config = createMockConfig({ openai: undefined, gemini: { apiKey: 'gemini-key', model: 'gemini-2.0-flash' } });
      const transcriber = new Transcriber(config);
      const audio: AudioMessageData = { buffer: Buffer.from('fake'), mimetype: 'audio/ogg' };

      const result = await transcriber.transcribe(audio);
      expect(result.text).toBe('Halo, ini dari Gemini');
      expect(result.provider).toBe('gemini');
    });
  });

  describe('MIME type extension mapping', () => {
    it('should map ogg to .ogg', () => {
      const config = createMockConfig();
      const transcriber = new Transcriber(config);
      // Access private method via prototype
      const ext = (Transcriber.prototype as any).getExtensionFromMime.call(transcriber, 'audio/ogg');
      expect(ext).toBe('.ogg');
    });

    it('should default to .ogg for unknown mime types', () => {
      const config = createMockConfig();
      const transcriber = new Transcriber(config);
      const ext = (Transcriber.prototype as any).getExtensionFromMime.call(transcriber, 'audio/flac');
      expect(ext).toBe('.ogg');
    });
  });
});
