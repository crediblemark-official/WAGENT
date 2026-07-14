/**
 * Model Catalog - Integration with models.dev
 * 
 * Detect provider, API key env var, and model ID from models.dev
 * 
 * Usage:
 *   import { ModelCatalog } from './model-catalog';
 *   const catalog = new ModelCatalog();
 *   await catalog.init();
 *   
 *   // Resolve model ID to provider info
 *   const info = catalog.resolve('openai/gpt-4o');
 *   // { provider: 'openai', envKey: 'OPENAI_API_KEY', npm: '@ai-sdk/openai', ... }
 *   
 *   // Auto-detect provider from model ID
 *   const provider = catalog.detectProvider('anthropic/claude-3-opus');
 *   // 'anthropic'
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface ProviderInfo {
  id: string;
  name: string;
  npm?: string;
  env?: string[];
  api?: string;
  doc?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider?: ProviderInfo;
}

export interface ResolvedModel {
  /** Model ID (e.g., 'openai/gpt-4o') */
  modelId: string;
  /** Provider ID (e.g., 'openai') */
  provider: string;
  /** Environment variable keys for API key (e.g., ['OPENAI_API_KEY']) */
  envKeys: string[];
  /** npm package for AI SDK (e.g., '@ai-sdk/openai') */
  npm?: string;
  /** Base URL for OpenAI-compatible providers */
  api?: string;
  /** Provider documentation URL */
  doc?: string;
  /** Model display name */
  name?: string;
}

interface CatalogData {
  [providerId: string]: {
    id: string;
    name: string;
    npm?: string;
    env?: string[];
    api?: string;
    doc?: string;
    models?: {
      [modelId: string]: {
        id: string;
        name?: string;
      };
    };
  };
}

export class ModelCatalog {
  private providers: Map<string, ProviderInfo> = new Map();
  private models: Map<string, ModelInfo> = new Map();
  private cacheDir: string;
  private cacheFile: string;
  private cacheDuration = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || join(process.env.HOME || '~', '.wagent');
    this.cacheFile = join(this.cacheDir, 'models-catalog.json');
  }

  /**
   * Initialize catalog - load from cache or fetch from models.dev
   */
  async init(options?: { forceRefresh?: boolean }): Promise<void> {
    const { forceRefresh = false } = options || {};

    if (!forceRefresh && this.loadFromCache()) {
      return;
    }

    await this.fetchFromModelsDev();
  }

  /**
   * Resolve model ID to provider info
   * 
   * Supports two formats:
   * 1. "provider/model-name" (e.g., "openai/gpt-4o") - extracts provider from ID
   * 2. "model-name" (e.g., "gpt-4o") - searches across all providers
   * 
   * @example
   * catalog.resolve('openai/gpt-4o')
   * // => { modelId: 'openai/gpt-4o', provider: 'openai', envKeys: ['OPENAI_API_KEY'], ... }
   */
  resolve(modelId: string): ResolvedModel | null {
    // Try to extract provider from model ID (format: provider/model-name)
    // This should be tried FIRST before exact match
    const slashIndex = modelId.indexOf('/');
    if (slashIndex > 0) {
      const providerId = modelId.substring(0, slashIndex);
      const modelName = modelId.substring(slashIndex + 1);
      
      // Check if provider exists
      const provider = this.providers.get(providerId);
      if (provider) {
        // Try to find the model within the provider (without the provider prefix)
        const modelWithoutPrefix = this.models.get(modelName);
        if (modelWithoutPrefix?.provider?.id === providerId) {
          return {
            modelId,
            provider: provider.id,
            envKeys: provider.env || [],
            npm: provider.npm,
            api: provider.api,
            doc: provider.doc,
            name: modelWithoutPrefix.name,
          };
        }
        
        // Provider exists but model not found - still return provider info
        return {
          modelId,
          provider: provider.id,
          envKeys: provider.env || [],
          npm: provider.npm,
          api: provider.api,
          doc: provider.doc,
        };
      }
    }

    // Try exact match (for models without provider prefix)
    const model = this.models.get(modelId);
    if (model?.provider) {
      return {
        modelId,
        provider: model.provider.id,
        envKeys: model.provider.env || [],
        npm: model.provider.npm,
        api: model.provider.api,
        doc: model.provider.doc,
        name: model.name,
      };
    }

    return null;
  }

  /**
   * Detect provider from model ID
   * 
   * @example
   * catalog.detectProvider('anthropic/claude-3-opus')
   * // => 'anthropic'
   */
  detectProvider(modelId: string): string | null {
    const slashIndex = modelId.indexOf('/');
    if (slashIndex > 0) {
      return modelId.substring(0, slashIndex);
    }
    return null;
  }

  /**
   * Get provider info by ID
   */
  getProvider(providerId: string): ProviderInfo | undefined {
    return this.providers.get(providerId);
  }

  /**
   * List all providers
   */
  listProviders(): ProviderInfo[] {
    return Array.from(this.providers.values());
  }

  /**
   * Search providers by query
   */
  searchProviders(query: string): ProviderInfo[] {
    const q = query.toLowerCase();
    return Array.from(this.providers.values()).filter(
      p => p.id.toLowerCase().includes(q) ||
           p.name.toLowerCase().includes(q)
    );
  }

  /**
   * Fetch catalog from models.dev
   */
  private async fetchFromModelsDev(): Promise<void> {
    try {
      const response = await fetch('https://models.dev/api.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as CatalogData;
      this.parseCatalog(data);
      this.saveToCache();
    } catch (error) {
      console.error('Failed to fetch from models.dev:', error);
      this.loadLocalFallback();
    }
  }

  /**
   * Parse catalog data
   */
  private parseCatalog(data: CatalogData): void {
    this.providers.clear();
    this.models.clear();

    for (const [providerId, providerData] of Object.entries(data)) {
      const provider: ProviderInfo = {
        id: providerId,
        name: providerData.name || providerId,
        npm: providerData.npm,
        env: providerData.env,
        api: providerData.api,
        doc: providerData.doc,
      };
      this.providers.set(providerId, provider);

      if (providerData.models) {
        for (const [modelId, modelData] of Object.entries(providerData.models)) {
          this.models.set(modelId, {
            id: modelId,
            name: modelData.name || modelId,
            provider,
          });
        }
      }
    }
  }

  /**
   * Load from cache
   */
  private loadFromCache(): boolean {
    try {
      if (!existsSync(this.cacheFile)) return false;

      const stat = require('fs').statSync(this.cacheFile);
      if (Date.now() - stat.mtimeMs > this.cacheDuration) return false;

      const data = JSON.parse(readFileSync(this.cacheFile, 'utf-8'));
      this.parseCatalog(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save to cache
   */
  private saveToCache(): void {
    try {
      const dir = dirname(this.cacheFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: CatalogData = {};
      for (const [id, provider] of this.providers) {
        const providerModels: { [modelId: string]: { id: string; name?: string } } = {};
        for (const [modelId, model] of this.models) {
          if (model.provider?.id === id) {
            providerModels[modelId] = { id: modelId, name: model.name };
          }
        }
        data[id] = {
          id,
          name: provider.name,
          npm: provider.npm,
          env: provider.env,
          api: provider.api,
          doc: provider.doc,
          models: providerModels,
        };
      }

      writeFileSync(this.cacheFile, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  /**
   * Local fallback catalog (popular providers only)
   */
  private loadLocalFallback(): void {
    const fallback: CatalogData = {
      openai: {
        id: 'openai', name: 'OpenAI',
        npm: '@ai-sdk/openai', env: ['OPENAI_API_KEY'],
      },
      anthropic: {
        id: 'anthropic', name: 'Anthropic',
        npm: '@ai-sdk/anthropic', env: ['ANTHROPIC_API_KEY'],
      },
      google: {
        id: 'google', name: 'Google',
        npm: '@ai-sdk/google', env: ['GOOGLE_API_KEY'],
      },
      ollama: {
        id: 'ollama', name: 'Ollama',
        npm: '@ai-sdk/ollama', env: [],
        api: 'http://localhost:11434/api',
      },
      groq: {
        id: 'groq', name: 'Groq',
        npm: '@ai-sdk/openai-compatible', env: ['GROQ_API_KEY'],
        api: 'https://api.groq.com/openai/v1',
      },
      deepseek: {
        id: 'deepseek', name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible', env: ['DEEPSEEK_API_KEY'],
        api: 'https://api.deepseek.com/v1',
      },
      mistral: {
        id: 'mistral', name: 'Mistral',
        npm: '@ai-sdk/mistral', env: ['MISTRAL_API_KEY'],
      },
      xai: {
        id: 'xai', name: 'xAI',
        npm: '@ai-sdk/openai-compatible', env: ['XAI_API_KEY'],
        api: 'https://api.x.ai/v1',
      },
    };
    this.parseCatalog(fallback);
  }
}

// Singleton
let instance: ModelCatalog | null = null;

export function getModelCatalog(): ModelCatalog {
  if (!instance) {
    instance = new ModelCatalog();
  }
  return instance;
}
