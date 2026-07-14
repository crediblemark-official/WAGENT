import { getLogger } from './logger.js';
import { WAgentConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════
// Embedding Model Definitions
// ═══════════════════════════════════════════════════════════════

export type EmbeddingProvider = 'gemini' | 'openai' | 'voyage' | 'cohere' | 'mistral' | 'nvidia' | 'alibaba' | 'microsoft' | 'salesforce' | 'jina' | 'nomic' | 'huggingface';

export type ModelCategory = 'commercial' | 'open-source' | 'lightweight';

export interface EmbeddingModelConfig {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  description: string;
  category: ModelCategory;
  maxTokens?: number;
  supportsMultimodal?: boolean;
  costPer1kTokens?: number; // USD
  apiEnvKey?: string;
  apiEndpoint?: string;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelConfig> = {
  // ═══════════════════════════════════════════════════════════════
  // 1. KOMERSIAL & API BERBAYAR (Terpopuler)
  // ═══════════════════════════════════════════════════════════════

  // Google Gemini
  'gemini-embedding-2': {
    provider: 'gemini',
    model: 'gemini-embedding-2',
    dimensions: 768,
    description: 'Google Gemini Embedding 2 - Multimodal (Teks, gambar, video, audio)',
    category: 'commercial',
    supportsMultimodal: true,
    costPer1kTokens: 0.00002,
    apiEnvKey: 'GEMINI_API_KEY',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
  },
  'text-embedding-004': {
    provider: 'gemini',
    model: 'text-embedding-004',
    dimensions: 768,
    description: 'Google Text-Embedding-004 - Standar API Google Cloud',
    category: 'commercial',
    costPer1kTokens: 0.00002,
    apiEnvKey: 'GEMINI_API_KEY',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
  },

  // OpenAI
  'text-embedding-3-large': {
    provider: 'openai',
    model: 'text-embedding-3-large',
    dimensions: 3072,
    description: 'OpenAI Text-Embedding-3-Large - Akurasi tinggi, mendukung Matryoshka/dimensi pruning',
    category: 'commercial',
    costPer1kTokens: 0.00013,
    apiEnvKey: 'OPENAI_API_KEY',
    apiEndpoint: 'https://api.openai.com/v1',
  },
  'text-embedding-3-small': {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    description: 'OpenAI Text-Embedding-3-Small - Cepat dan hemat biaya',
    category: 'commercial',
    costPer1kTokens: 0.00002,
    apiEnvKey: 'OPENAI_API_KEY',
    apiEndpoint: 'https://api.openai.com/v1',
  },
  'text-embedding-ada-002': {
    provider: 'openai',
    model: 'text-embedding-ada-002',
    dimensions: 1536,
    description: 'OpenAI Text-Embedding-Ada-002 - Model generasi sebelumnya',
    category: 'commercial',
    costPer1kTokens: 0.0001,
    apiEnvKey: 'OPENAI_API_KEY',
    apiEndpoint: 'https://api.openai.com/v1',
  },

  // Voyage AI
  'voyage-3-large': {
    provider: 'voyage',
    model: 'voyage-3-large',
    dimensions: 1024,
    description: 'Voyage AI voyage-3-large - Merajai akurasi pencarian teks & dokumen spesifik (finansial/hukum)',
    category: 'commercial',
    costPer1kTokens: 0.0001,
    apiEnvKey: 'VOYAGE_API_KEY',
    apiEndpoint: 'https://api.voyageai.com/v1',
  },
  'voyage-multimodal-3.5': {
    provider: 'voyage',
    model: 'voyage-multimodal-3.5',
    dimensions: 1024,
    description: 'Voyage Multimodal 3.5 - Unggul kompresi dimensi data visual dan teks',
    category: 'commercial',
    supportsMultimodal: true,
    costPer1kTokens: 0.0001,
    apiEnvKey: 'VOYAGE_API_KEY',
    apiEndpoint: 'https://api.voyageai.com/v1',
  },

  // Cohere
  'cohere-embed-v4': {
    provider: 'cohere',
    model: 'embed-english-v3.0',
    dimensions: 1024,
    description: 'Cohere Embed v4 - Sangat kuat untuk pencarian multibahasa skala enterprise',
    category: 'commercial',
    costPer1kTokens: 0.0001,
    apiEnvKey: 'COHERE_API_KEY',
    apiEndpoint: 'https://api.cohere.ai/v1',
  },

  // Mistral
  'mistral-embed': {
    provider: 'mistral',
    model: 'mistral-embed',
    dimensions: 1024,
    description: 'Mistral Embed - Dari pembuat Mistral AI',
    category: 'commercial',
    costPer1kTokens: 0.0001,
    apiEnvKey: 'MISTRAL_API_KEY',
    apiEndpoint: 'https://api.mistral.ai/v1',
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. OPEN-SOURCE / LOKAL (Performa Tertinggi)
  // ═══════════════════════════════════════════════════════════════

  // NVIDIA
  'nv-embed-v2': {
    provider: 'nvidia',
    model: 'nvidia/NV-Embed-v2',
    dimensions: 4096,
    description: 'NVIDIA NV-Embed-v2 - Peringkat teratas MTEB Leaderboard untuk akurasi bahasa Inggris',
    category: 'open-source',
    maxTokens: 32768,
    costPer1kTokens: 0,
    apiEnvKey: 'NVIDIA_API_KEY',
    apiEndpoint: 'https://integrate.api.nvidia.com/v1',
  },

  // Alibaba Qwen
  'qwen3-embedding-8b': {
    provider: 'alibaba',
    model: 'Alibaba-NLP/gte-Qwen2-7B-instruct',
    dimensions: 3584,
    description: 'Alibaba Qwen3-Embedding-8B - Unggul multibahasa termasuk Bahasa Indonesia',
    category: 'open-source',
    maxTokens: 8192,
    costPer1kTokens: 0,
  },
  'qwen3-vl-2b': {
    provider: 'alibaba',
    model: 'Qwen/Qwen2-VL-2B-Instruct',
    dimensions: 1536,
    description: 'Alibaba Qwen3-VL-2B - Terbaik untuk pencarian lintas modal (gambar ↔ teks)',
    category: 'open-source',
    supportsMultimodal: true,
    costPer1kTokens: 0,
  },

  // ModernBERT
  'modernbert-embed': {
    provider: 'huggingface',
    model: 'answerdotai/ModernBERT-embed-base',
    dimensions: 768,
    description: 'ModernBERT - Arsitektur BERT generasi baru, lebih cepat dan efisien',
    category: 'open-source',
    maxTokens: 8192,
    costPer1kTokens: 0,
  },

  // Microsoft
  'harrier-oss-v1': {
    provider: 'microsoft',
    model: 'microsoft/harrier-oss-v1-0.6b',
    dimensions: 1024,
    description: 'Microsoft Harrier-OSS - Model kecil efisien, lisensi MIT',
    category: 'open-source',
    costPer1kTokens: 0,
  },

  // Salesforce
  'sfr-embedding-2-r': {
    provider: 'salesforce',
    model: 'Salesforce/SFR-Embedding-2_R',
    dimensions: 4096,
    description: 'Salesforce SFR-Embedding-2_R - 7B parameter, akurasi pencarian dokumen kuat',
    category: 'open-source',
    costPer1kTokens: 0,
  },

  // BAAI (Benchmark)
  'bge-large-en-v1.5': {
    provider: 'huggingface',
    model: 'BAAI/bge-large-en-v1.5',
    dimensions: 1024,
    description: 'BGE-Large-EN - Performa papan atas dari BAAI',
    category: 'open-source',
    costPer1kTokens: 0,
  },
  'gte-large': {
    provider: 'huggingface',
    model: 'thenlper/gte-large',
    dimensions: 1024,
    description: 'GTE-Large - Sangat baik untuk pencarian dokumen',
    category: 'open-source',
    costPer1kTokens: 0,
  },

  // ═══════════════════════════════════════════════════════════════
  // 3. MODEL RINGAN (Edge / Lokal Kecil)
  // ═══════════════════════════════════════════════════════════════

  // Google
  'embeddinggemma-300m': {
    provider: 'gemini',
    model: 'embeddinggemma-300m',
    dimensions: 768,
    description: 'Google EmbeddingGemma-300m - Hanya 300M parameter, hemat biaya namun akurat',
    category: 'lightweight',
    costPer1kTokens: 0.00001,
    apiEnvKey: 'GEMINI_API_KEY',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
  },

  // Jina
  'jina-embeddings-v5-small': {
    provider: 'jina',
    model: 'jinaai/jina-embeddings-v5-text-small',
    dimensions: 512,
    description: 'Jina Embeddings v5-small - Konteks 32k token dalam ukuran minimalis',
    category: 'lightweight',
    maxTokens: 32768,
    costPer1kTokens: 0,
    apiEnvKey: 'JINA_API_KEY',
    apiEndpoint: 'https://api.jina.ai/v1',
  },

  // Nomic
  'nomic-embed-text-v1.5': {
    provider: 'nomic',
    model: 'nomic-ai/nomic-embed-text-v1.5',
    dimensions: 768,
    description: 'Nomic Embed Text v1.5 - Fleksibilitas dimensi vektor, hemat penyimpanan',
    category: 'lightweight',
    costPer1kTokens: 0,
  },

  // MiniLM
  'all-MiniLM-L6-v2': {
    provider: 'huggingface',
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    dimensions: 384,
    description: 'All-MiniLM-L6-v2 - Super kecil, masih sering dipakai untuk eksperimen cepat',
    category: 'lightweight',
    costPer1kTokens: 0,
  },

  // Sentence-BERT
  'sentence-bert-base': {
    provider: 'huggingface',
    model: 'sentence-transformers/all-mpnet-base-v2',
    dimensions: 768,
    description: 'Sentence-BERT (SBERT) - Pelopor pemetaan kalimat',
    category: 'lightweight',
    costPer1kTokens: 0,
  },
};

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

export function getModelsByCategory(category: ModelCategory): Record<string, EmbeddingModelConfig> {
  return Object.fromEntries(
    Object.entries(EMBEDDING_MODELS).filter(([_, config]) => config.category === category)
  );
}

export function getModelsByProvider(provider: EmbeddingProvider): Record<string, EmbeddingModelConfig> {
  return Object.fromEntries(
    Object.entries(EMBEDDING_MODELS).filter(([_, config]) => config.provider === provider)
  );
}

export function getDefaultModel(category?: ModelCategory): string {
  if (category === 'commercial') return 'text-embedding-3-small';
  if (category === 'open-source') return 'bge-large-en-v1.5';
  if (category === 'lightweight') return 'all-MiniLM-L6-v2';
  return 'text-embedding-004'; // Default to Gemini (free tier)
}

// ═══════════════════════════════════════════════════════════════
// Embedding Service
// ═══════════════════════════════════════════════════════════════

/**
 * Multi-provider embedding service.
 * Supports: Gemini, OpenAI, Voyage, Cohere, Mistral, Hugging Face, NVIDIA, Alibaba, etc.
 */
export class EmbeddingService {
  private logger = getLogger().child({ module: 'embedding' });
  private modelConfig: EmbeddingModelConfig;

  constructor(
    private config: Pick<WAgentConfig, 'resolvedModel' | 'embedding'>,
  ) {
    const modelName = (config as any).embedding?.model || 'text-embedding-004';
    this.modelConfig = EMBEDDING_MODELS[modelName] || EMBEDDING_MODELS['text-embedding-004'];
    this.logger.info({ model: modelName, provider: this.modelConfig.provider, category: this.modelConfig.category }, 'Embedding service initialized');
  }

  /**
   * Get current model info
   */
  getModelInfo(): EmbeddingModelConfig {
    return this.modelConfig;
  }

  /**
   * Get available models
   */
  static getAvailableModels(): Record<string, EmbeddingModelConfig> {
    return EMBEDDING_MODELS;
  }

  /**
   * Get models by category
   */
  static getModelsByCategory(category: ModelCategory): Record<string, EmbeddingModelConfig> {
    return getModelsByCategory(category);
  }

  /**
   * Generate embedding vector for a single text string.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    switch (this.modelConfig.provider) {
      case 'gemini':
        return this.generateGemini(text);
      case 'openai':
        return this.generateOpenAI(text);
      case 'voyage':
        return this.generateVoyage(text);
      case 'cohere':
        return this.generateCohere(text);
      case 'mistral':
        return this.generateMistral(text);
      case 'nvidia':
        return this.generateNVIDIA(text);
      case 'huggingface':
        return this.generateHuggingFace(text);
      case 'jina':
        return this.generateJina(text);
      default:
        this.logger.error({ provider: this.modelConfig.provider }, 'Unsupported embedding provider');
        return null;
    }
  }

  /**
   * Generate embedding for a combined text from a knowledge entry
   */
  async generateKbEmbedding(
    question: string,
    answer: string,
    keywords: string[],
  ): Promise<number[] | null> {
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
    if (magnitude === 0) return 0;
    return dotProduct / magnitude;
  }

  // ═══════════════════════════════════════════════════════════════
  // Provider Implementations
  // ═══════════════════════════════════════════════════════════════

  private async generateGemini(text: string): Promise<number[] | null> {
    const apiKey = process.env[this.modelConfig.apiEnvKey || 'GEMINI_API_KEY'] || (this.config.resolvedModel?.provider === 'google' || this.config.resolvedModel?.provider === 'gemini' ? this.config.resolvedModel?.apiKey : undefined);
    if (!apiKey) {
      this.logger.warn('Gemini API key not configured');
      return null;
    }

    try {
      const url = `${this.modelConfig.apiEndpoint}/models/${this.modelConfig.model}:embedContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.modelConfig.model}`,
          content: { parts: [{ text }] },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Gemini embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.embedding?.values as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected Gemini response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate Gemini embedding');
      return null;
    }
  }

  private async generateOpenAI(text: string): Promise<number[] | null> {
    const apiKey = process.env[this.modelConfig.apiEnvKey || 'OPENAI_API_KEY'] || (this.config.resolvedModel?.provider === 'openai' ? this.config.resolvedModel?.apiKey : undefined);
    if (!apiKey) {
      this.logger.warn('OpenAI API key not configured');
      return null;
    }

    try {
      const response = await fetch(`${this.modelConfig.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelConfig.model,
          input: text,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'OpenAI embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.data?.[0]?.embedding as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected OpenAI response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate OpenAI embedding');
      return null;
    }
  }

  private async generateVoyage(text: string): Promise<number[] | null> {
    const apiKey = process.env[`${this.modelConfig.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      this.logger.warn(`${this.modelConfig.provider} API key not configured`);
      return null;
    }

    try {
      const response = await fetch(`${this.modelConfig.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelConfig.model,
          input: [text],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Voyage embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.data?.[0]?.embedding as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected Voyage response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate Voyage embedding');
      return null;
    }
  }

  private async generateCohere(text: string): Promise<number[] | null> {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      this.logger.warn('Cohere API key not configured (COHERE_API_KEY)');
      return null;
    }

    try {
      const response = await fetch(`${this.modelConfig.apiEndpoint}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelConfig.model,
          texts: [text],
          input_type: 'search_document',
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Cohere embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.embeddings?.[0] as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected Cohere response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate Cohere embedding');
      return null;
    }
  }

  private async generateMistral(text: string): Promise<number[] | null> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      this.logger.warn('Mistral API key not configured (MISTRAL_API_KEY)');
      return null;
    }

    try {
      const response = await fetch(`${this.modelConfig.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelConfig.model,
          input: [text],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Mistral embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.data?.[0]?.embedding as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected Mistral response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate Mistral embedding');
      return null;
    }
  }

  private async generateNVIDIA(text: string): Promise<number[] | null> {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      this.logger.warn('NVIDIA API key not configured (NVIDIA_API_KEY)');
      return null;
    }

    try {
      const response = await fetch(`${this.modelConfig.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelConfig.model,
          input: [text],
          input_type: 'query',
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'NVIDIA embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.data?.[0]?.embedding as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected NVIDIA response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate NVIDIA embedding');
      return null;
    }
  }

  private async generateHuggingFace(text: string): Promise<number[] | null> {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      this.logger.warn('Hugging Face API key not configured (HUGGINGFACE_API_KEY)');
      return null;
    }

    try {
      const response = await fetch(
        `https://api-inference.huggingface.co/pipeline/feature-extraction/${this.modelConfig.model}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ inputs: text }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Hugging Face embedding error');
        return null;
      }

      const data = await response.json() as any;

      // Handle mean pooling for token-level embeddings
      let values: number[];
      if (Array.isArray(data[0]) && Array.isArray(data[0][0])) {
        values = data[0].reduce((acc: number[], val: number[]) => {
          return acc.map((v, i) => v + val[i]);
        }, new Array(data[0][0].length).fill(0));
        values = values.map((v: number) => v / data[0].length);
      } else {
        values = data;
      }

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected Hugging Face response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate Hugging Face embedding');
      return null;
    }
  }

  private async generateJina(text: string): Promise<number[] | null> {
    const apiKey = process.env.JINA_API_KEY;
    if (!apiKey) {
      this.logger.warn('Jina API key not configured (JINA_API_KEY)');
      return null;
    }

    try {
      const response = await fetch(`${this.modelConfig.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelConfig.model,
          input: [text],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error({ status: response.status, error: err }, 'Jina embedding error');
        return null;
      }

      const data = await response.json() as any;
      const values = data?.data?.[0]?.embedding as number[] | undefined;

      if (!values || !Array.isArray(values)) {
        this.logger.error({ data }, 'Unexpected Jina response format');
        return null;
      }

      this.logger.debug({ model: this.modelConfig.model, dimensions: values.length }, 'Embedding generated');
      return values;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to generate Jina embedding');
      return null;
    }
  }
}
