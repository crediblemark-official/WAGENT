/**
 * OpenRouter Adapter - Unified access to 400+ AI models
 * 
 * Features:
 * - Single API key for all providers
 * - BYOK (Bring Your Own Key) support
 * - Auto-fallbacks when provider is down
 * - Cost optimization (auto cheapest route)
 * - Real-time model availability
 * 
 * Usage:
 *   import { OpenRouterAdapter } from './openrouter';
 *   const adapter = new OpenRouterAdapter('sk-or-xxx');
 *   const models = await adapter.listModels();
 *   const response = await adapter.chat('openai/gpt-4o', 'Hello');
 */

import { OpenRouter } from '@openrouter/sdk';

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  per_request_limits?: {
    max_prompt_tokens?: number;
    max_completion_tokens?: number;
  };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterAdapter {
  private client: OpenRouter;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new OpenRouter({
      apiKey,
    });
  }

  /**
   * List all available models
   */
  async listModels(): Promise<OpenRouterModel[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { data: OpenRouterModel[] };
      return data.data || [];
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }

  /**
   * Get model by ID
   */
  async getModel(modelId: string): Promise<OpenRouterModel | null> {
    const models = await this.listModels();
    return models.find(m => m.id === modelId) || null;
  }

  /**
   * Search models by query
   */
  async searchModels(query: string): Promise<OpenRouterModel[]> {
    const models = await this.listModels();
    const queryLower = query.toLowerCase();
    
    return models.filter(m =>
      m.id.toLowerCase().includes(queryLower) ||
      m.name.toLowerCase().includes(queryLower) ||
      m.description?.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Chat completion
   */
  async chat(
    model: string,
    messages: OpenRouterMessage[] | string,
    options?: {
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
      frequency_penalty?: number;
      presence_penalty?: number;
      stop?: string[];
    }
  ): Promise<OpenRouterResponse> {
    // Convert string to messages format
    const msgArray = typeof messages === 'string'
      ? [{ role: 'user' as const, content: messages }]
      : messages;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wagent.dev',
        'X-Title': 'WAGENT',
      },
      body: JSON.stringify({
        model,
        messages: msgArray,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        top_p: options?.top_p,
        frequency_penalty: options?.frequency_penalty,
        presence_penalty: options?.presence_penalty,
        stop: options?.stop,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenRouter error: ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<OpenRouterResponse>;
  }

  /**
   * Chat with streaming
   */
  async *chatStream(
    model: string,
    messages: OpenRouterMessage[] | string,
    options?: {
      temperature?: number;
      max_tokens?: number;
    }
  ): AsyncGenerator<string, void, unknown> {
    const msgArray = typeof messages === 'string'
      ? [{ role: 'user' as const, content: messages }]
      : messages;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wagent.dev',
        'X-Title': 'WAGENT',
      },
      body: JSON.stringify({
        model,
        messages: msgArray,
        stream: true,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenRouter error: ${JSON.stringify(error)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * Get pricing for a model
   */
  async getPricing(modelId: string): Promise<{
    input: number;
    output: number;
  } | null> {
    const model = await this.getModel(modelId);
    if (!model?.pricing) return null;

    return {
      input: parseFloat(model.pricing.prompt || '0') * 1_000_000,
      output: parseFloat(model.pricing.completion || '0') * 1_000_000,
    };
  }

  /**
   * Get recommended models by use case
   */
  async getRecommended(useCase: 'chat' | 'code' | 'vision' | 'fast' | 'cheap'): Promise<OpenRouterModel[]> {
    const models = await this.listModels();
    
    return models.filter(m => {
      switch (useCase) {
        case 'chat':
          return m.context_length && m.context_length >= 4000 &&
                 !m.architecture?.modality?.includes('image');
        case 'code':
          return m.name.toLowerCase().includes('code') ||
                 m.description?.toLowerCase().includes('code');
        case 'vision':
          return m.architecture?.modality?.includes('image');
        case 'fast':
          return m.name.toLowerCase().includes('fast') ||
                 m.name.toLowerCase().includes('mini') ||
                 m.name.toLowerCase().includes('flash');
        case 'cheap':
          return parseFloat(m.pricing?.prompt || '1') < 0.000001;
        default:
          return true;
      }
    }).slice(0, 10);
  }

  /**
   * Generate API key info
   */
  async getApiKeyInfo(): Promise<{
    label: string;
    usage: number;
    limit: number;
    rate_limit: {
      requests: number;
      interval: string;
    };
  } | null> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as any;
      return data.data;
    } catch {
      return null;
    }
  }
}

/**
 * Create OpenRouter adapter from environment
 */
export function createOpenRouterAdapter(): OpenRouterAdapter | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenRouterAdapter(apiKey);
}
