/**
 * Model Catalog - Auto-detect provider from models.dev
 * 
 * Automatically resolves model ID to provider info.
 * Caches to ~/.wagent/models.json for offline usage.
 * Auto-refreshes when model not found.
 * 
 * Usage:
 *   const info = await resolveModel('openai/gpt-4o');
 *   // => { provider: 'openai', apiKey: '...', baseUrl: '...', model: 'gpt-4o' }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface ResolvedModel {
  /** Original model ID input */
  input: string;
  /** Provider ID (e.g., 'openai') */
  provider: string;
  /** Model ID for API calls (e.g., 'gpt-4o') */
  model: string;
  /** API key from environment */
  apiKey?: string;
  /** Base URL for API calls */
  baseUrl?: string;
  /** npm package for AI SDK */
  npm?: string;
  /** Environment variable name for API key */
  envKey?: string;
  /** Provider display name */
  name?: string;
}

export interface ProviderData {
  id: string;
  name: string;
  npm?: string;
  env?: string[];
  api?: string;
  doc?: string;
  models?: { [modelId: string]: ModelData };
}

export interface ModelData {
  id: string;
  name: string;
  description?: string;
  family?: string;
}

interface CatalogCache {
  timestamp: number;
  providers: { [id: string]: ProviderData };
}

const CACHE_DIR = join(process.env.HOME || '~', '.wagent');
const CACHE_FILE = join(CACHE_DIR, 'models.json');
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

// Local fallback for popular providers
const LOCAL_PROVIDERS: { [id: string]: ProviderData } = {
  openai: { id: 'openai', name: 'OpenAI', npm: '@ai-sdk/openai', env: ['OPENAI_API_KEY'] },
  anthropic: { id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic', env: ['ANTHROPIC_API_KEY'] },
  google: { id: 'google', name: 'Google', npm: '@ai-sdk/google', env: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
  groq: { id: 'groq', name: 'Groq', npm: '@ai-sdk/groq', env: ['GROQ_API_KEY'], api: 'https://api.groq.com/openai/v1' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', npm: '@ai-sdk/openai-compatible', env: ['DEEPSEEK_API_KEY'], api: 'https://api.deepseek.com/v1' },
  mistral: { id: 'mistral', name: 'Mistral', npm: '@ai-sdk/mistral', env: ['MISTRAL_API_KEY'] },
  xai: { id: 'xai', name: 'xAI', npm: '@ai-sdk/openai-compatible', env: ['XAI_API_KEY'], api: 'https://api.x.ai/v1' },
  ollama: { id: 'ollama', name: 'Ollama', npm: '@ai-sdk/ollama', env: [], api: 'http://localhost:11434/api' },
  cohere: { id: 'cohere', name: 'Cohere', npm: '@ai-sdk/cohere', env: ['COHERE_API_KEY'] },
  fireworks: { id: 'fireworks', name: 'Fireworks', npm: '@ai-sdk/openai-compatible', env: ['FIREWORKS_API_KEY'], api: 'https://api.fireworks.ai/inference/v1' },
  together: { id: 'together', name: 'Together', npm: '@ai-sdk/openai-compatible', env: ['TOGETHER_API_KEY'], api: 'https://api.together.xyz/v1' },
  perplexity: { id: 'perplexity', name: 'Perplexity', npm: '@ai-sdk/openai-compatible', env: ['PERPLEXITY_API_KEY'], api: 'https://api.perplexity.ai' },
};

let cache: CatalogCache | null = null;

/**
 * Resolve model ID to provider info
 * 
 * @example
 * const info = await resolveModel('openai/gpt-4o');
 * // => { provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o' }
 */
export async function resolveModel(modelId: string): Promise<ResolvedModel> {
  // Load catalog
  const catalog = await loadCatalog();
  
  // Try to resolve
  const result = tryResolve(modelId, catalog);
  if (result) return result;
  
  // Not found in cache, refresh from models.dev
  await refreshCatalog();
  const updatedCatalog = await loadCatalog();
  const retryResult = tryResolve(modelId, updatedCatalog);
  if (retryResult) return retryResult;
  
  // Still not found, try local fallback
  const localResult = tryResolveLocal(modelId);
  if (localResult) return localResult;
  
  // Give up with best effort
  return createFallback(modelId);
}

/**
 * Try to resolve from catalog
 */
function tryResolve(modelId: string, catalog: CatalogCache): ResolvedModel | null {
  const slashIndex = modelId.indexOf('/');
  
  if (slashIndex > 0) {
    const providerId = modelId.substring(0, slashIndex);
    const modelName = modelId.substring(slashIndex + 1);
    
    const provider = catalog.providers[providerId];
    if (provider) {
      return buildResult(modelId, provider, modelName);
    }
  }
  
  // Try without prefix
  for (const [providerId, provider] of Object.entries(catalog.providers)) {
    if (modelId.startsWith(providerId + '/') || modelId === providerId) {
      const modelName = modelId.replace(providerId + '/', '');
      return buildResult(modelId, provider, modelName);
    }
  }
  
  return null;
}

/**
 * Try to resolve from local fallback
 */
function tryResolveLocal(modelId: string): ResolvedModel | null {
  const slashIndex = modelId.indexOf('/');
  
  if (slashIndex > 0) {
    const providerId = modelId.substring(0, slashIndex);
    const modelName = modelId.substring(slashIndex + 1);
    
    const provider = LOCAL_PROVIDERS[providerId];
    if (provider) {
      return buildResult(modelId, provider, modelName);
    }
  }
  
  return null;
}

/**
 * Build result from provider and model name
 */
function buildResult(input: string, provider: ProviderData, modelName: string): ResolvedModel {
  // Find API key from environment
  let apiKey: string | undefined;
  let envKey: string | undefined;
  
  if (provider.env) {
    for (const key of provider.env) {
      const value = process.env[key];
      if (value) {
        apiKey = value;
        envKey = key;
        break;
      }
    }
  }
  
  return {
    input,
    provider: provider.id,
    model: modelName,
    apiKey,
    baseUrl: provider.api,
    npm: provider.npm,
    envKey,
    name: provider.name,
  };
}

/**
 * Create fallback for unknown model
 */
function createFallback(modelId: string): ResolvedModel {
  const slashIndex = modelId.indexOf('/');
  const providerId = slashIndex > 0 ? modelId.substring(0, slashIndex) : 'openai';
  const modelName = slashIndex > 0 ? modelId.substring(slashIndex + 1) : modelId;
  
  return {
    input: modelId,
    provider: providerId,
    model: modelName,
    apiKey: process.env[`${providerId.toUpperCase()}_API_KEY`],
  };
}

/**
 * Load catalog from cache or fetch
 */
async function loadCatalog(): Promise<CatalogCache> {
  if (cache) return cache;
  
  // Try to load from file
  if (existsSync(CACHE_FILE)) {
    try {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as CatalogCache;
      if (Date.now() - data.timestamp < CACHE_DURATION) {
        cache = data;
        return cache;
      }
    } catch {
      // Invalid cache, will refresh
    }
  }
  
  // Fetch from models.dev
  await refreshCatalog();
  return cache || { timestamp: 0, providers: LOCAL_PROVIDERS };
}

/**
 * Refresh catalog from models.dev
 */
async function refreshCatalog(): Promise<void> {
  try {
    const response = await fetch('https://models.dev/api.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json() as { [providerId: string]: any };
    
    const providers: { [id: string]: ProviderData } = {};
    for (const [id, providerData] of Object.entries(data)) {
      providers[id] = {
        id,
        name: providerData.name || id,
        npm: providerData.npm,
        env: providerData.env,
        api: providerData.api,
        doc: providerData.doc,
        models: providerData.models,
      };
    }
    
    cache = { timestamp: Date.now(), providers };
    saveCache(cache);
  } catch (error) {
    console.error('Failed to fetch from models.dev:', error);
    // Use local fallback
    if (!cache) {
      cache = { timestamp: Date.now(), providers: LOCAL_PROVIDERS };
    }
  }
}

/**
 * Save cache to file
 */
function saveCache(data: CatalogCache): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save cache:', error);
  }
}

/**
 * Force refresh catalog
 */
export async function refreshModelCatalog(): Promise<void> {
  cache = null;
  await refreshCatalog();
}

/**
 * Dapatkan semua model yang tersedia di catalog
 */
export async function getAllModels(): Promise<{ id: string; name: string; provider: string }[]> {
  const catalog = await loadCatalog();
  const result: { id: string; name: string; provider: string }[] = [];
  
  for (const [providerId, provider] of Object.entries(catalog.providers)) {
    if (provider.models) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        result.push({
          id: `${providerId}/${modelId}`,
          name: model.name || modelId,
          provider: providerId,
        });
      }
    }
  }
  
  return result;
}

/**
 * Dapatkan semua provider yang ada di catalog
 */
export async function getCatalogProviders(): Promise<{ [id: string]: ProviderData }> {
  const catalog = await loadCatalog();
  return catalog.providers;
}

/**
 * Dapatkan model yang tersedia untuk provider tertentu di catalog
 */
export async function getModelsForProviderCatalog(providerId: string): Promise<{ value: string; label: string }[]> {
  const catalog = await loadCatalog();
  const provider = catalog.providers[providerId];
  if (!provider || !provider.models) return [];
  
  return Object.entries(provider.models).map(([id, model]) => ({
    value: id,
    label: model.name || id,
  }));
}

