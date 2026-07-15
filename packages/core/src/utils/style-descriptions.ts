import { promptLoader } from '../agent/prompt-loader.js';

/**
 * Shared style descriptions for ContextBuilder and StyleRouter.
 * Now loaded from prompts/personality.toon
 */

// Lazy-load from TOON file
let _toneDescriptions: Record<string, string> | null = null;
let _toneInstructions: Record<string, string> | null = null;
let _emojiInstructions: Record<string, string> | null = null;

function getToneDescriptions(): Record<string, string> {
  if (!_toneDescriptions) {
    const personality = promptLoader.load('personality.toon');
    if (personality?.tones) {
      _toneDescriptions = {};
      for (const [tone, data] of Object.entries(personality.tones) as any) {
        _toneDescriptions[tone] = data.description;
      }
    } else {
      _toneDescriptions = {
        casual: 'santai dan natural',
        formal: 'formal dan sopan',
        professional: 'profesional dan ramah',
        friendly: 'ramah dan hangat',
        mixed: 'adaptif mengikuti lawan bicara',
      };
    }
  }
  return _toneDescriptions;
}

export const TONE_DESCRIPTIONS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, key: string) => getToneDescriptions()[key] || '',
});

export const TONE_INSTRUCTIONS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, key: string) => {
    if (!_toneInstructions) {
      _toneInstructions = promptLoader.getToneInstructions();
    }
    return _toneInstructions?.[key] || '';
  },
});

export const EMOJI_INSTRUCTIONS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, key: string) => {
    if (!_emojiInstructions) {
      _emojiInstructions = promptLoader.getEmojiInstructions();
    }
    return _emojiInstructions?.[key] || '';
  },
});

export const VALID_TONES = ['casual', 'formal', 'professional', 'friendly', 'mixed'];