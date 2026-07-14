/**
 * Shared style descriptions for ContextBuilder and StyleRouter.
 * Extracted to avoid code duplication between the two classes.
 */

export const TONE_DESCRIPTIONS: Record<string, string> = {
  casual: 'santai dan natural',
  formal: 'formal dan sopan',
  professional: 'profesional dan ramah',
  friendly: 'ramah dan hangat',
  mixed: 'adaptif mengikuti lawan bicara',
};

export const TONE_INSTRUCTIONS: Record<string, string> = {
  casual: 'Gunakan bahasa yang santai dan natural. Boleh pakai slang dan bahasa sehari-hari.',
  formal: 'Gunakan bahasa yang formal dan sopan. Hindari slang dan singkatan.',
  professional: 'Gunakan bahasa profesional namun tetap ramah. Seimbang antara formal dan santai.',
  friendly: 'Gunakan bahasa yang ramah dan hangat. Gunakan emoji secukupnya.',
  mixed: 'Sesuaikan gaya dengan konteks percakapan. Ikuti gaya dari lawan bicara.',
};

export const EMOJI_INSTRUCTIONS: Record<string, string> = {
  rare: 'Hindari emoji.',
  moderate: 'Gunakan emoji sesekali.',
  frequent: 'Boleh sering menggunakan emoji.',
};

export const VALID_TONES = ['casual', 'formal', 'professional', 'friendly', 'mixed'];
