/**
 * Model Catalog - Integration with models.dev
 * 
 * Provides access to 166+ providers and 5600+ AI models
 * with automatic caching and fallback to local catalog.
 * 
 * Usage:
 *   import { ModelCatalog } from './model-catalog';
 *   const catalog = new ModelCatalog();
 *   await catalog.init();
 *   const models = catalog.search('gpt');
 *   const model = catalog.get('openai/gpt-4o');
 */

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  family?: string;
  context?: number;
  input?: number;
  cost?: {
    input?: number;
    output?: number;
    unit?: string;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  features?: string[];
  provider?: ProviderInfo;
}

export interface ProviderInfo {
  id: string;
  name: string;
  npm?: string;
  env?: string[];
  api?: string;
  doc?: string;
}

export interface CatalogResponse {
  [providerId: string]: {
    id: string;
    name: string;
    npm?: string;
    env?: string[];
    api?: string;
    doc?: string;
    models?: {
      [modelId: string]: ModelInfo;
    };
  };
}

export class ModelCatalog {
  private providers: Map<string, ProviderInfo> = new Map();
  private models: Map<string, ModelInfo> = new Map();
  private modelsByProvider: Map<string, ModelInfo[]> = new Map();
  private cacheFile: string;
  private lastFetch: number = 0;
  private cacheDuration: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(cacheDir?: string) {
    const dir = cacheDir || `${process.env.HOME}/.wagent`;
    this.cacheFile = `${dir}/models-cache.json`;
  }

  /**
   * Initialize catalog - fetch from models.dev or load cache
   */
  async init(options?: { forceRefresh?: boolean }): Promise<void> {
    const { forceRefresh = false } = options || {};

    // Try to load from cache first
    if (!forceRefresh) {
      const loaded = await this.loadFromCache();
      if (loaded) {
        console.log(`Loaded ${this.models.size} models from cache`);
        return;
      }
    }

    // Fetch from models.dev
    await this.fetchFromModelsDev();
  }

  /**
   * Fetch models from models.dev API
   */
  private async fetchFromModelsDev(): Promise<void> {
    try {
      console.log('Fetching models from models.dev...');
      const response = await fetch('https://models.dev/api.json');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as CatalogResponse;
      this.parseCatalog(data);
      
      // Save to cache
      await this.saveToCache();
      
      console.log(`Fetched ${this.models.size} models from ${this.providers.size} providers`);
    } catch (error) {
      console.error('Failed to fetch from models.dev:', error);
      
      // Try to load from cache even if expired
      const loaded = await this.loadFromCache();
      if (!loaded) {
        // Use local catalog as last resort
        this.loadLocalCatalog();
      }
    }
  }

  /**
   * Parse catalog data
   */
  private parseCatalog(data: CatalogResponse): void {
    this.providers.clear();
    this.models.clear();
    this.modelsByProvider.clear();

    for (const [providerId, providerData] of Object.entries(data)) {
      // Store provider info
      const providerInfo: ProviderInfo = {
        id: providerId,
        name: providerData.name || providerId,
        npm: providerData.npm,
        env: providerData.env,
        api: providerData.api,
        doc: providerData.doc,
      };
      this.providers.set(providerId, providerInfo);

      // Store models
      const providerModels: ModelInfo[] = [];
      if (providerData.models) {
        for (const [modelId, modelData] of Object.entries(providerData.models)) {
          const modelInfo: ModelInfo = {
            id: modelId,
            name: modelData.name || modelId,
            description: modelData.description,
            family: modelData.family,
            context: modelData.context,
            input: modelData.input,
            cost: modelData.cost,
            modalities: modelData.modalities,
            features: modelData.features,
            provider: providerInfo,
          };
          
          this.models.set(modelId, modelInfo);
          providerModels.push(modelInfo);
        }
      }
      
      this.modelsByProvider.set(providerId, providerModels);
    }

    this.lastFetch = Date.now();
  }

  /**
   * Search models by query
   */
  search(query: string, options?: { provider?: string; limit?: number }): ModelInfo[] {
    const { provider, limit = 20 } = options || {};
    const queryLower = query.toLowerCase();
    
    let results: ModelInfo[] = [];
    
    if (provider) {
      // Search within specific provider
      const providerModels = this.modelsByProvider.get(provider) || [];
      results = providerModels.filter(m => 
        m.id.toLowerCase().includes(queryLower) ||
        m.name.toLowerCase().includes(queryLower) ||
        m.description?.toLowerCase().includes(queryLower)
      );
    } else {
      // Search all models
      results = Array.from(this.models.values()).filter(m =>
        m.id.toLowerCase().includes(queryLower) ||
        m.name.toLowerCase().includes(queryLower) ||
        m.description?.toLowerCase().includes(queryLower)
      );
    }
    
    return results.slice(0, limit);
  }

  /**
   * Get model by ID
   */
  get(modelId: string): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get provider by ID
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
   * List all models for a provider
   */
  listModels(providerId?: string): ModelInfo[] {
    if (providerId) {
      return this.modelsByProvider.get(providerId) || [];
    }
    return Array.from(this.models.values());
  }

  /**
   * Get recommended models by use case
   */
  getRecommended(useCase: 'chat' | 'code' | 'vision' | 'embedding' | 'fast' | 'cheap'): ModelInfo[] {
    const recommendations: ModelInfo[] = [];
    
    for (const model of this.models.values()) {
      let match = false;
      
      switch (useCase) {
        case 'chat':
          // Models good for general chat
          match = (!model.modalities?.output?.includes('image') &&
                   (model.context || 0) >= 4000) || false;
          break;
          
        case 'code':
          // Models good for coding
          match = (model.description?.toLowerCase().includes('code') ||
                   model.description?.toLowerCase().includes('coding') ||
                   model.family?.includes('code')) || false;
          break;
          
        case 'vision':
          // Models with image input
          match = model.modalities?.input?.includes('image') || false;
          break;
          
        case 'embedding':
          // Embedding models
          match = (model.description?.toLowerCase().includes('embedding') ||
                   model.id.includes('embed')) || false;
          break;
          
        case 'fast':
          // Fast models (usually smaller context or "fast" in name)
          match = (model.name.toLowerCase().includes('fast') ||
                   model.name.toLowerCase().includes('mini') ||
                   model.name.toLowerCase().includes('flash')) || false;
          break;
          
        case 'cheap':
          // Cheap models
          match = ((model.cost?.input || 0) < 1) || false;
          break;
      }
      
      if (match) {
        recommendations.push(model);
      }
    }
    
    // Sort by cost (cheapest first)
    return recommendations.sort((a, b) => (a.cost?.input || 0) - (b.cost?.input || 0));
  }

  /**
   * Load from cache file
   */
  private async loadFromCache(): Promise<boolean> {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(this.cacheFile)) {
        return false;
      }
      
      const stat = fs.statSync(this.cacheFile);
      const age = Date.now() - stat.mtimeMs;
      
      if (age > this.cacheDuration) {
        return false; // Cache expired
      }
      
      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
      this.parseCatalog(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save to cache file
   */
  private async saveToCache(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Ensure directory exists
      const dir = path.dirname(this.cacheFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Convert Maps to object for serialization
      const data: CatalogResponse = {};
      for (const [providerId, provider] of this.providers) {
        const providerModels = this.modelsByProvider.get(providerId) || [];
        const models: { [modelId: string]: ModelInfo } = {};
        for (const model of providerModels) {
          models[model.id] = model;
        }
        data[providerId] = {
          id: provider.id,
          name: provider.name,
          npm: provider.npm,
          env: provider.env,
          api: provider.api,
          doc: provider.doc,
          models,
        };
      }
      
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  /**
   * Load local catalog (fallback)
   */
  private loadLocalCatalog(): void {
    console.log('Loading local catalog...');
    
    // Local catalog of popular models
    const localCatalog: CatalogResponse = {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        npm: '@ai-sdk/openai',
        env: ['OPENAI_API_KEY'],
        models: {
          'openai/gpt-4o': {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            description: 'Most capable GPT-4 model',
            context: 128000,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
          'openai/gpt-4o-mini': {
            id: 'openai/gpt-4o-mini',
            name: 'GPT-4o Mini',
            description: 'Fast and affordable',
            context: 128000,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
          'openai/gpt-4-turbo': {
            id: 'openai/gpt-4-turbo',
            name: 'GPT-4 Turbo',
            description: 'Previous generation',
            context: 128000,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
        },
      },
      anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        npm: '@ai-sdk/anthropic',
        env: ['ANTHROPIC_API_KEY'],
        models: {
          'anthropic/claude-3-opus': {
            id: 'anthropic/claude-3-opus',
            name: 'Claude 3 Opus',
            description: 'Most capable Claude model',
            context: 200000,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
          'anthropic/claude-3-sonnet': {
            id: 'anthropic/claude-3-sonnet',
            name: 'Claude 3 Sonnet',
            description: 'Balanced performance',
            context: 200000,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
          'anthropic/claude-3-haiku': {
            id: 'anthropic/claude-3-haiku',
            name: 'Claude 3 Haiku',
            description: 'Fast and affordable',
            context: 200000,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
        },
      },
      google: {
        id: 'google',
        name: 'Google',
        npm: '@ai-sdk/google',
        env: ['GOOGLE_API_KEY'],
        models: {
          'google/gemini-2.0-flash': {
            id: 'google/gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            description: 'Fast and capable',
            context: 1000000,
            modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text'] },
          },
          'google/gemini-2.0-pro': {
            id: 'google/gemini-2.0-pro',
            name: 'Gemini 2.0 Pro',
            description: 'Most capable Gemini',
            context: 2000000,
            modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text'] },
          },
        },
      },
      ollama: {
        id: 'ollama',
        name: 'Ollama',
        npm: '@ai-sdk/ollama',
        env: [],
        api: 'http://localhost:11434/api',
        models: {
          'ollama/llama3.1:8b': {
            id: 'ollama/llama3.1:8b',
            name: 'Llama 3.1 8B',
            description: 'Fast local model',
            context: 128000,
          },
          'ollama/mistral': {
            id: 'ollama/mistral',
            name: 'Mistral 7B',
            description: 'Fast and capable',
            context: 32000,
          },
        },
      },
    };
    
    this.parseCatalog(localCatalog);
  }

  /**
   * Export catalog as JSON
   */
  export(): CatalogResponse {
    const data: CatalogResponse = {};
    for (const [providerId, provider] of this.providers) {
      const providerModels = this.modelsByProvider.get(providerId) || [];
      const models: { [modelId: string]: ModelInfo } = {};
      for (const model of providerModels) {
        models[model.id] = model;
      }
      data[providerId] = {
        id: provider.id,
        name: provider.name,
        npm: provider.npm,
        env: provider.env,
        api: provider.api,
        doc: provider.doc,
        models,
      };
    }
    return data;
  }
}

// Singleton instance
let instance: ModelCatalog | null = null;

/**
 * Get singleton ModelCatalog instance
 */
export function getModelCatalog(): ModelCatalog {
  if (!instance) {
    instance = new ModelCatalog();
  }
  return instance;
}
