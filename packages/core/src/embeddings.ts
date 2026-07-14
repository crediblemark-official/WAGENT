import { getLogger } from './logger.js';
import { WAgentConfig } from './types.js';

const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;

/**
 * Service to generate text embeddings using Gemini API
 * and compute cosine similarity for semantic search.
 */
export class EmbeddingService {
  private logger = getLogger().child({ module: 'embedding' });

  constructor(private config: Pick<WAgentConfig, 'gemini'>) {}

  /**
   * Generate embedding vector for a single text string.
   * Returns null if embedding fails (e.g. API key not configured).
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.config.gemini?.apiKey) {
      this.logger.warn('Gemini API key not configured, skipping embedding');
      return null;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${this.config.gemini.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: {
            parts: [{ text }],
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Embedding API error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.embedding?.values as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected embedding response format');
        return null;
      }

      this.logger.debug({ dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate embedding');
      return null;
    }
  }

  /**
   * Generate embedding for a combined text from a knowledge entry
   * (question + answer + keywords combined for better representation)
   */
  async generateKbEmbedding(
    question: string,
    answer: string,
    keywords: string[],
  ): Promise<number[] | null> {
    // Combine question, answer, and keywords for richer representation
    const text = [
      `Pertanyaan: ${question}`,
      `Jawaban: ${answer}`,
      keywords.length > 0 ? `Kata kunci: ${keywords.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return this.generateEmbedding(text);
  }

  /**
   * Compute cosine similarity between two embedding vectors.
   * Returns a value between -1 and 1 (higher = more similar).
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      this.logger.warn(
        { lenA: a.length, lenB: b.length },
        'Embedding dimension mismatch, returning 0',
      );
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }
}
