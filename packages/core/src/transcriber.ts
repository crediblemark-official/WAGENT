import { Logger } from 'pino';
import {
  WAgentConfig,
  TranscriptionResult,
  TranscriptionProvider,
  AudioMessageData,
} from './types.js';
import { getLogger } from './logger.js';
import { promptLoader } from './prompt-loader.js';

export class Transcriber {
  private logger: Logger;
  private provider: TranscriptionProvider;

  constructor(private config: WAgentConfig) {
    this.logger = getLogger().child({ module: 'transcriber' });

    // Auto-detect provider: prefer OpenAI if available, else Gemini, else none
    if (config.openai?.apiKey) {
      this.provider = 'openai';
    } else if (config.gemini?.apiKey) {
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

  // ── OpenAI Whisper API ────────────────────────────────────────

  private async transcribeWithOpenAI(audio: AudioMessageData): Promise<TranscriptionResult> {
    this.logger.info('Transcribing audio with OpenAI Whisper...');

    const apiKey = this.config.openai?.apiKey;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    // Convert buffer to Blob-like FormData
    const formData = new FormData();
    const extension = this.getExtensionFromMime(audio.mimetype);
    const audioFile = new Blob([audio.buffer], { type: audio.mimetype });
    formData.append('file', audioFile, `audio${extension}`);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
    formData.append('language', 'id'); // Prefer Indonesian

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
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

    const apiKey = this.config.gemini?.apiKey;
    if (!apiKey) throw new Error('Gemini API key not configured');

    // Convert audio to base64
    const base64Audio = audio.buffer.toString('base64');

    const body = {
      contents: [{
        parts: [
          { text: promptLoader.getTranscriberInstruction('gemini') },
          {
            inlineData: {
              mimeType: audio.mimetype,
              data: base64Audio,
            },
          },
        ],
      }],
    };

    const model = this.config.gemini?.model || 'gemini-2.0-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
