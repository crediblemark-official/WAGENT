import { Logger } from 'pino';
import { WAgentConfig, MemoryEntry } from '../types.js';
import { getLogger } from '../utils/logger.js';
import { promptLoader } from './prompt-loader.js';

// ── Summarization Configuration ─────────────────────────────────

export interface SummarizerConfig {
  /** Max tokens for the generated summary */
  maxSummaryLength: number;
  /** Min conversation entries before auto-summary triggers */
  minEntriesForSummary: number;
  /** Enable LLM-based abstractive summarization */
  useAbstractive: boolean;
}

const DEFAULT_CONFIG: SummarizerConfig = {
  maxSummaryLength: 500,
  minEntriesForSummary: 20,
  useAbstractive: true,
};

// ── Summarizer Class ────────────────────────────────────────────

/**
 * Summarizer generates abstractive (LLM-based) or extractive
 * summaries of conversation history for long-term context.
 *
 * Abstractive summary uses the configured AI provider to generate
 * a concise, context-aware summary with key topics, decisions,
 * action items, and sentiment.
 *
 * Extractive fallback simply picks the most recent and most
 * important entries when AI is not available.
 */
export class Summarizer {
  private logger: Logger;
  private config: SummarizerConfig;
  private aiConfig?: WAgentConfig;

  constructor(options?: {
    config?: Partial<SummarizerConfig>;
    aiConfig?: WAgentConfig;
  }) {
    this.logger = getLogger().child({ module: 'summarizer' });
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.aiConfig = options?.aiConfig;
  }

  getConfig(): SummarizerConfig {
    return { ...this.config };
  }

  /**
   * Generate a summary from conversation entries.
   * Uses abstractive (LLM) if configured and available,
   * falls back to extractive otherwise.
   */
  async summarize(entries: MemoryEntry[], maxLength?: number): Promise<string> {
    if (entries.length === 0) return '';

    const limit = maxLength || this.config.maxSummaryLength;

    // Try abstractive summarization if enabled and AI is configured
    if (this.config.useAbstractive && this.aiConfig) {
      try {
        const abstractive = await this.generateAbstractiveSummary(entries, limit);
        if (abstractive) return abstractive;
      } catch (err: any) {
        this.logger.warn({ error: err.message }, 'Abstractive summary failed, falling back to extractive');
      }
    }

    // Fall back to extractive summary
    return Summarizer.generateExtractiveSummary(entries, limit);
  }

  /**
   * Generate an abstractive (LLM-based) summary.
   * Calls the configured AI provider with a summarization prompt.
   */
  private async generateAbstractiveSummary(
    entries: MemoryEntry[],
    maxLength: number,
  ): Promise<string | null> {
    const conversationText = entries
      .map(e => {
        const speaker = e.role === 'user' ? 'Customer' : e.role === 'assistant' ? 'Agent' : 'System';
        return `[${speaker}]: ${e.content}`;
      })
      .join('\n')
      .substring(0, 8000); // Truncate to avoid huge prompts

    if (!conversationText.trim()) return null;

    const systemPrompt = promptLoader.getSummarizerPrompt().replace('${maxLength}', String(Math.floor(maxLength / 2)));

    const prompt = `${systemPrompt}\n\nConversation:\n${conversationText}`;

    try {
      const result = await this.callAI(this.aiConfig!, prompt, maxLength);
      return result || null;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'AI summarization failed');
      return null;
    }
  }

  /**
   * Call the configured AI provider for summarization.
   * Supports OpenAI, Gemini, Claude, and Ollama.
   */
  private async callAI(config: WAgentConfig, prompt: string, maxTokens: number): Promise<string> {
    const resolved = config.resolvedModel;
    if (!resolved) throw new Error('AI Model belum dikonfigurasi (resolvedModel missing)');
    
    const providerConfig = {
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
    };

    switch (resolved.provider) {
      case 'google':
      case 'gemini':
        return this.callGemini(providerConfig, prompt, maxTokens);
      case 'anthropic':
      case 'claude':
        return this.callClaude(providerConfig, prompt, maxTokens);
      case 'ollama':
        return this.callOllama(providerConfig, prompt, maxTokens);
      case 'openai':
      default:
        return this.callOpenAI(providerConfig, prompt, maxTokens);
    }
  }

  private async callOpenAI(
    config: { apiKey?: string; baseUrl?: string; model: string },
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: promptLoader.getSummarizerProviderInstruction('openai') },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${err}`);
      }

      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callGemini(
    config: { apiKey?: string; baseUrl?: string; model: string },
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      const response = await fetch(
        `${baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }],
            }],
            generationConfig: {
              maxOutputTokens: maxTokens,
            },
            systemInstruction: {
              parts: [{ text: promptLoader.getSummarizerProviderInstruction('gemini') }],
            },
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${err}`);
      }

      const data = await response.json() as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callClaude(
    config: { apiKey?: string; baseUrl?: string; model: string },
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const endpoint = config.baseUrl || 'https://api.anthropic.com/v1/messages';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens,
          system: promptLoader.getSummarizerProviderInstruction('claude'),
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${err}`);
      }

      const data = await response.json() as any;
      return data.content?.[0]?.text || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callOllama(
    config: { apiKey?: string; baseUrl?: string; model: string },
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${config.baseUrl || 'http://localhost:11434'}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: promptLoader.getSummarizerProviderInstruction('ollama') },
            { role: 'user', content: prompt },
          ],
          options: { num_predict: maxTokens },
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${err}`);
      }

      const data = await response.json() as any;
      return data.message?.content || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generate an extractive summary (fallback when AI not available).
   * Picks the first entry context, stats, and last ~5 entries.
   * Static so it can be used by both Summarizer and ContextBuilder.
   */
  static generateExtractiveSummary(entries: MemoryEntry[], maxLength: number): string {
    if (entries.length === 0) return '';

    const parts: string[] = [];
    let totalLength = 0;

    // Opening context
    if (entries.length > 6) {
      const first = entries[0];
      const context = `Percakapan dimulai dengan: "${first.content.substring(0, 100)}"`;
      parts.push(context);
      totalLength += context.length;
    }

    // Count messages per role for stats
    const userCount = entries.filter(e => e.role === 'user').length;
    const agentCount = entries.filter(e => e.role === 'assistant').length;

    if (userCount + agentCount > 0) {
      const stats = `\nStatistik: ${userCount} pesan dari customer, ${agentCount} dari agent.`;
      parts.push(stats);
      totalLength += stats.length;
    }

    // Recent messages
    const recentCount = Math.min(5, entries.length);
    const recent = entries.slice(-recentCount);
    parts.push('\nPesan terbaru:');
    totalLength += '\nPesan terbaru:'.length;

    for (const entry of recent) {
      const prefix = entry.role === 'user' ? '👤 Customer' : '🤖 Agent';
      const line = `  ${prefix}: "${entry.content.substring(0, 80)}"`;
      if (totalLength + line.length > maxLength) break;
      parts.push(line);
      totalLength += line.length;
    }

    return parts.join('\n');
  }

  /**
   * Check if a conversation has enough entries to warrant summarization.
   */
  shouldSummarize(entryCount: number): boolean {
    return entryCount >= this.config.minEntriesForSummary;
  }
}
