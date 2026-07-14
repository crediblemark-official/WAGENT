import { Logger } from 'pino';
import { ContextConfig, StyleDirective, AIMessage, MemoryEntry } from './types.js';
import { getLogger } from './logger.js';
import { TONE_INSTRUCTIONS, EMOJI_INSTRUCTIONS } from './style-descriptions.js';
import { Summarizer } from './summarizer.js';

/**
 * ContextBuilder composes the system prompt and full LLM context
 * from multiple sources:
 * 1. Base system prompt (from config)
 * 2. Contact profile style (from StyleRouter)
 * 3. Skill/system prompt additions
 * 4. Conversation history (from DB + Memory)
 * 5. Conversation summary (long-term context)
 * 6. Global facts & patterns
 */
export class ContextBuilder {
  private logger: Logger;
  private summarizer?: Summarizer;
  /** Max characters for the combined system prompt (~4K tokens) */
  private maxSystemPromptLength = 8000;

  constructor(options?: { summarizer?: Summarizer; maxSystemPromptLength?: number }) {
    this.logger = getLogger().child({ module: 'context-builder' });
    this.summarizer = options?.summarizer;
    if (options?.maxSystemPromptLength) {
      this.maxSystemPromptLength = options.maxSystemPromptLength;
    }
  }

  /**
   * Build the full system prompt with all context enrichments.
   */
  buildSystemPrompt(config: ContextConfig): string {
    const parts: string[] = [];

    // 1. Base system prompt (required)
    parts.push(config.baseSystemPrompt);

    // 2. Contact relationship context
    if (config.profile?.relationship) {
      parts.push(`\n## Hubungan dengan Kontak Ini\nHubungan: ${config.profile.relationship}`);
    }

    // 3. Style directive from StyleRouter
    if (config.profile) {
      const style = this.buildStyleInstructions(config.profile);
      if (style) {
        parts.push(`\n## Gaya Komunikasi\n${style}`);
      }
    }

    // 4. Contact name for personalization
    if (config.contactName) {
      parts.push(`\n## Informasi Kontak\nKontak saat ini: ${config.contactName}`);
    }

    // 5. New conversation context
    if (config.isNewConversation) {
      parts.push(`\n## Konteks\nIni adalah awal percakapan dengan kontak ini. Sambut dengan hangat.`);
    }

    // 6. Conversation summary (long-term context)
    if (config.conversationSummary) {
      parts.push(`\n## Ringkasan Percakapan Sebelumnya\n${config.conversationSummary}`);
    }

    // 7. Skill/system prompt additions
    if (config.systemPromptAdditions && config.systemPromptAdditions.length > 0) {
      parts.push(`\n## Panduan Tambahan\n${config.systemPromptAdditions.join('\n')}`);
    }

    const prompt = parts.join('\n');

    // Enforce length budget — truncate from the end if too long
    if (prompt.length > this.maxSystemPromptLength) {
      this.logger.warn(
        { length: prompt.length, max: this.maxSystemPromptLength },
        'System prompt exceeds budget, truncating',
      );
      return prompt.substring(0, this.maxSystemPromptLength);
    }

    return prompt;
  }

  /**
   * Build style instructions from a contact profile for the system prompt.
   */
  private buildStyleInstructions(profile: NonNullable<ContextConfig['profile']>): string {
    const instructions: string[] = [];

    // Tone mapping
    instructions.push(TONE_INSTRUCTIONS[profile.tone] || TONE_INSTRUCTIONS.casual);

    if (profile.language) {
      instructions.push(`Bahasa: ${profile.language}`);
    }

    if (profile.greetings && profile.greetings.length > 0) {
      instructions.push(`Sapaan yang biasa digunakan: ${profile.greetings.join(', ')}`);
    }

    if (profile.emojiUsage && EMOJI_INSTRUCTIONS[profile.emojiUsage]) {
      instructions.push(EMOJI_INSTRUCTIONS[profile.emojiUsage]);
    }

    if (profile.topics && profile.topics.length > 0) {
      instructions.push(`Topik yang sering dibahas: ${profile.topics.join(', ')}`);
    }

    if (profile.exampleResponses && profile.exampleResponses.length > 0) {
      instructions.push('\nContoh gaya respon:');
      for (const example of profile.exampleResponses.slice(0, 3)) {
        instructions.push(`> ${example}`);
      }
    }

    return instructions.join('\n');
  }

  /**
   * Build the complete messages array for LLM chat completion.
   * This includes system prompt + conversation history + user message.
   */
  buildMessages(
    contextConfig: ContextConfig,
    history: AIMessage[],
    userMessage: string,
  ): AIMessage[] {
    const systemPrompt = this.buildSystemPrompt(contextConfig);

    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    return messages;
  }

  /**
   * Create a ContextConfig from available data sources.
   * This is a factory method that assembles all the pieces.
   */
  createConfig(params: {
    baseSystemPrompt: string;
    profile?: ContextConfig['profile'];
    systemPromptAdditions?: string[];
    conversationSummary?: string | null;
    contactName?: string;
    isNewConversation?: boolean;
  }): ContextConfig {
    return {
      baseSystemPrompt: params.baseSystemPrompt,
      profile: params.profile || null,
      systemPromptAdditions: params.systemPromptAdditions || [],
      conversationSummary: params.conversationSummary || undefined,
      contactName: params.contactName,
      isNewConversation: params.isNewConversation,
    };
  }

  /**
   * Generate a summary from recent memory entries.
   * Uses abstractive (LLM) summarizer if available, falls back to extractive.
   */
  async generateQuickSummary(entries: MemoryEntry[], maxLength = 300): Promise<string> {
    if (entries.length === 0) return '';

    // Abstractive summary via Summarizer if available
    if (this.summarizer) {
      try {
        const summary = await this.summarizer.summarize(entries, maxLength);
        if (summary) return summary;
      } catch (err: any) {
        this.logger.warn({ error: err.message }, 'Quick summary via Summarizer failed, using extractive');
      }
    }

    // Extractive fallback via shared Summarizer utility
    return Summarizer.generateExtractiveSummary(entries, maxLength);
  }
}
