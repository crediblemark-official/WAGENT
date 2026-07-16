import { Logger } from 'pino';
import {
  WAgentConfig,
  TranscriptionResult,
  TranscriptionProvider,
  AudioMessageData,
  ImageMessageData,
} from '../types.js';
import { getLogger } from '../utils/logger.js';
import { promptLoader } from '../agent/prompt-loader.js';

export class Transcriber {
  private logger: Logger;
  private provider: TranscriptionProvider;

  constructor(private config: WAgentConfig) {
    this.logger = getLogger().child({ module: 'transcriber' });

    // Auto-detect provider: Gemini uses specific logic, others default to OpenAI-compatible
    if ((config.resolvedModel?.provider === 'google' || config.resolvedModel?.provider === 'gemini') && config.resolvedModel?.apiKey) {
      this.provider = 'gemini';
    } else if (config.resolvedModel?.apiKey) {
      // Default to OpenAI compatible for all others (OpenAI, Groq, DeepSeek, etc.)
      this.provider = 'openai';
    } else if (process.env.OPENAI_API_KEY) {
      this.provider = 'openai';
    } else if (process.env.GEMINI_API_KEY) {
      this.provider = 'gemini';
    } else {
      this.provider = 'none';
    }
  }

  getProvider(): TranscriptionProvider {
    return this.provider;
  }

  isAvailable(): boolean {
    return this.provider !== 'none';
  }

  async transcribe(audio: AudioMessageData): Promise<TranscriptionResult> {
    switch (this.provider) {
      case 'openai':
        return this.transcribeWithOpenAI(audio);
      case 'gemini':
        return this.transcribeWithGemini(audio);
      default:
        throw new Error('No transcription provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY');
    }
  }

  async describeImage(image: ImageMessageData): Promise<string> {
    switch (this.provider) {
      case 'openai':
        return this.describeImageWithOpenAI(image);
      case 'gemini':
        return this.describeImageWithGemini(image);
      default:
        throw new Error('No vision provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY');
    }
  }

  // ── OpenAI Whisper API ────────────────────────────────────────

  private async transcribeWithOpenAI(audio: AudioMessageData): Promise<TranscriptionResult> {
    this.logger.info('Transcribing audio with OpenAI Whisper...');

    const apiKey = (this.provider === 'openai' && this.config.resolvedModel?.apiKey) ? this.config.resolvedModel?.apiKey : process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    // Convert buffer to Blob-like FormData
    const formData = new FormData();
    const extension = this.getExtensionFromMime(audio.mimetype);
    const audioFile = new Blob([audio.buffer], { type: audio.mimetype });
    formData.append('file', audioFile, `audio${extension}`);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
    formData.append('language', 'id'); // Prefer Indonesian

    let baseUrl = this.config.resolvedModel?.baseUrl || 'https://api.openai.com/v1';
    baseUrl = baseUrl.endsWith('/chat/completions') ? baseUrl.replace('/chat/completions', '') : baseUrl;
    const endpoint = `${baseUrl.replace(/\/$/, '')}/audio/transcriptions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI Whisper API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;

    this.logger.info('Transcription successful: %s', data.text?.substring(0, 60));
    return {
      text: data.text || '',
      duration: audio.duration,
      provider: 'openai',
    };
  }

  // ── Google Gemini API ─────────────────────────────────────────

  private async transcribeWithGemini(audio: AudioMessageData): Promise<TranscriptionResult> {
    this.logger.info('Transcribing audio with Gemini...');

    const apiKey = (this.config.resolvedModel?.provider === 'google' || this.config.resolvedModel?.provider === 'gemini') ? this.config.resolvedModel?.apiKey : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');

    // Convert audio to base64
    const base64Audio = audio.buffer.toString('base64');

    const body = {
      contents: [{
        parts: [
          { text: promptLoader.getTranscriberInstruction() },
          {
            inlineData: {
              mimeType: audio.mimetype,
              data: base64Audio,
            },
          },
        ],
      }],
    };

    const model = (this.config.resolvedModel?.provider === 'google' || this.config.resolvedModel?.provider === 'gemini') ? this.config.resolvedModel?.model : 'gemini-2.0-flash';
    const baseUrl = this.config.resolvedModel?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    this.logger.info('Gemini transcription successful: %s', text.substring(0, 60));
    return {
      text,
      duration: audio.duration,
      provider: 'gemini',
    };
  }

  // ── Image Description ─────────────────────────────────────────

  private async describeImageWithOpenAI(image: ImageMessageData): Promise<string> {
    this.logger.info('Describing image with OpenAI...');

    const apiKey = (this.provider === 'openai' && this.config.resolvedModel?.apiKey) ? this.config.resolvedModel?.apiKey : process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const base64Image = image.buffer.toString('base64');

    const visionModel = this.resolveVisionModel('gpt-4o');
    let baseUrl = this.config.resolvedModel?.baseUrl || 'https://api.openai.com/v1';
    baseUrl = baseUrl.endsWith('/chat/completions') ? baseUrl.replace('/chat/completions', '') : baseUrl;
    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Deskripsikan gambar ini secara detail dalam Bahasa Indonesia. Fokus pada objek, teks, warna, dan konteks yang relevan.' },
            {
              type: 'image_url',
              image_url: { url: `data:${image.mimetype};base64,${base64Image}` },
            },
          ],
        }],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI Vision API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const text = data?.choices?.[0]?.message?.content || '';

    this.logger.info('Image description successful: %s', text.substring(0, 60));
    return text;
  }

  private resolveVisionModel(fallback: string): string {
    const model = this.config.resolvedModel?.model;
    if (!model) return fallback;
    const visionModels = ['gpt-4o', 'gpt-4', 'gpt-4-turbo', 'gpt-4.1', 'o1', 'o3', 'vision'];
    const lower = model.toLowerCase();
    const isVision = visionModels.some((v) => lower.includes(v));
    return isVision ? model : fallback;
  }

  private async describeImageWithGemini(image: ImageMessageData): Promise<string> {
    this.logger.info('Describing image with Gemini...');

    const apiKey = (this.config.resolvedModel?.provider === 'google' || this.config.resolvedModel?.provider === 'gemini') ? this.config.resolvedModel?.apiKey : process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');

    const base64Image = image.buffer.toString('base64');

    const body = {
      contents: [{
        parts: [
          { text: 'Deskripsikan gambar ini secara detail dalam Bahasa Indonesia. Fokus pada objek, teks, warna, dan konteks yang relevan.' },
          {
            inlineData: {
              mimeType: image.mimetype,
              data: base64Image,
            },
          },
        ],
      }],
    };

    const model = (this.config.resolvedModel?.provider === 'google' || this.config.resolvedModel?.provider === 'gemini') ? this.config.resolvedModel?.model : 'gemini-2.0-flash';
    const baseUrl = this.config.resolvedModel?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    this.logger.info('Gemini image description successful: %s', text.substring(0, 60));
    return text;
  }

  private getExtensionFromMime(mimetype: string): string {
    const map: Record<string, string> = {
      'audio/ogg': '.ogg',
      'audio/opus': '.opus',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.mp4',
      'audio/wav': '.wav',
      'audio/webm': '.webm',
      'audio/aac': '.aac',
      'audio/x-m4a': '.m4a',
    };
    return map[mimetype] || '.ogg';
  }
}
