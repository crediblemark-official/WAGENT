/**
 * Config Loader - Loads configuration from config.jsonc
 * 
 * Supports:
 * - config.jsonc (project root)
 * - ~/.wagent/config.jsonc (global)
 * 
 * Auto-detects model from config or environment.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from './logger.js';
import { WAgentConfig } from './types.js';
import { resolveModel, ResolvedModel } from './model-catalog.js';
import { decode } from '@toon-format/toon';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Default Prompts ─────────────────────────────────────────────

const DEFAULT_WELCOME_MESSAGE = 'Halo! 👋 Ada yang bisa saya bantu hari ini?';

function loadDefaultSystemPrompt(): string {
  const candidates = [
    join(__dirname, '../prompts/system.md'),
    join(__dirname, '../../prompts/system.md'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf-8').trim();
    }
  }
  return 'Kamu adalah customer service yang ramah dan membantu.';
}

const DEFAULT_SYSTEM_PROMPT = loadDefaultSystemPrompt();

// ── Config Interface ────────────────────────────────────────────

export interface WAgentJsonConfig {
  $schema?: string;
  session?: string;
  model?: string;
  providers?: {
    [provider: string]: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };
  };
  agent?: {
    welcomeMessage?: string;
    conversationTimeoutHours?: number;
  };
  rateLimit?: {
    max?: number;
    windowSeconds?: number;
    message?: string;
  };
  workingHours?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    timezone?: string;
    offlineMessage?: string;
  };
  escalation?: {
    telegramBotToken?: string;
    telegramChatId?: string;
  };
  humanTakeover?: {
    cooldownMinutes?: number;
  };
  groupChat?: {
    enabled?: boolean;
    replyIfMentioned?: boolean;
  };
  dashboard?: {
    port?: number;
    host?: string;
  };
  database?: {
    type?: 'sqlite' | 'postgres';
    url?: string;
  };
}

// ── Config Finder ───────────────────────────────────────────────

function findConfigFile(): string | null {
  const candidates = [
    // Project root
    join(process.cwd(), 'config.jsonc'),
    join(process.cwd(), 'config.json'),
    // .opencode directory
    join(process.cwd(), '.opencode', 'config.jsonc'),
    join(process.cwd(), '.opencode', 'config.json'),
    // Global config
    join(process.env.HOME || '~', '.wagent', 'config.jsonc'),
    join(process.env.HOME || '~', '.wagent', 'config.json'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  
  return null;
}

// ── JSONC Parser ────────────────────────────────────────────────

function parseJsonc(content: string): WAgentJsonConfig {
  // Remove single-line comments (// ...) but not inside strings
  let cleaned = content.replace(/\/\/.*$/gm, (match) => {
    // Check if the match is inside a string by counting quotes before it
    const idx = content.indexOf(match);
    const before = content.substring(0, idx);
    const openQuotes = (before.match(/"/g) || []).length;
    // If odd number of quotes, it's inside a string, don't remove
    return openQuotes % 2 === 0 ? '' : match;
  });
  
  // Remove multi-line comments (/* ... */)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  
  return JSON.parse(cleaned);
}

// ── Config Loader ───────────────────────────────────────────────

/**
 * Load configuration from config.jsonc
 */
export async function loadConfig(): Promise<WAgentConfig> {
  const logger = getLogger();
  
  // Find config file
  const configFile = findConfigFile();
  
  let jsonConfig: WAgentJsonConfig = {};
  
  if (configFile) {
    logger.info(`Loading config from ${configFile}`);
    const content = readFileSync(configFile, 'utf-8');
    jsonConfig = parseJsonc(content);
  } else {
    logger.info('No config.jsonc found, using defaults');
  }
  
  // Resolve model from config or auto-detect
  const resolved = await resolveModelFromConfig(jsonConfig);
  
  logger.info(`Using model: ${resolved.provider}/${resolved.model}`);
  
  // Build WAgentConfig
  return buildConfig(jsonConfig, resolved);
}

/**
 * Resolve model from config
 */
async function resolveModelFromConfig(config: WAgentJsonConfig): Promise<ResolvedModel> {
  // Get model ID from config
  const modelId = config.model || 'openai/gpt-4o';
  
  // Get provider config
  const providerConfig = config.providers?.[modelId.split('/')[0]] || {};
  
  // If API key is in config, use it
  if (providerConfig.apiKey) {
    // Set environment variable for the provider
    const provider = modelId.split('/')[0];
    const envKey = getEnvKeyForProvider(provider);
    if (envKey) {
      process.env[envKey] = providerConfig.apiKey;
    }
  }
  
  // Resolve from catalog
  return resolveModel(modelId);
}

/**
 * Get environment key for provider
 */
function getEnvKeyForProvider(provider: string): string | null {
  const mapping: { [key: string]: string } = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    xai: 'XAI_API_KEY',
    cohere: 'COHERE_API_KEY',
    fireworks: 'FIREWORKS_API_KEY',
    together: 'TOGETHER_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
  };
  
  return mapping[provider] || null;
}

/**
 * Build WAgentConfig from JSON config
 */
function buildConfig(jsonConfig: WAgentJsonConfig, resolved: ResolvedModel): WAgentConfig {
  // Load system prompt from file (convention: prompts/system.toon or prompts/system.md)
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  
  const promptPaths = [
    join(process.cwd(), 'prompts/system.toon'),
    join(process.cwd(), 'prompts/system.md'),
    join(__dirname, '../prompts/system.toon'),
    join(__dirname, '../prompts/system.md'),
    join(__dirname, '../../prompts/system.toon'),
    join(__dirname, '../../prompts/system.md'),
  ];
  
  for (const promptPath of promptPaths) {
    if (existsSync(promptPath)) {
      const content = readFileSync(promptPath, 'utf-8').trim();
      
      // Parse based on file extension
      if (promptPath.endsWith('.toon')) {
        try {
          const parsed = decode(content);
          // Convert TOON object to readable prompt
          systemPrompt = convertToonToPrompt(parsed);
        } catch (error) {
          getLogger().warn(`Failed to parse TOON prompt: ${error}, using raw content`);
          systemPrompt = content;
        }
      } else {
        systemPrompt = content;
      }
      
      getLogger().info(`Loaded system prompt from ${promptPath}`);
      break;
    }
  }
  
  return {
    // WhatsApp
    whatsappSessionName: jsonConfig.session || 'wagent-session',
    whatsappSessionDir: join(process.cwd(), '.sessions'),
    
    // AI Provider (auto-detected)
    aiProvider: resolved.provider as WAgentConfig['aiProvider'],
    systemPrompt,
    
    // Provider configs
    openai: resolved.provider === 'openai' ? {
      apiKey: resolved.apiKey || '',
      model: resolved.model,
    } : undefined,
    
    gemini: resolved.provider === 'google' ? {
      apiKey: resolved.apiKey || '',
      model: resolved.model,
    } : undefined,
    
    anthropic: resolved.provider === 'anthropic' ? {
      apiKey: resolved.apiKey || '',
      model: resolved.model,
    } : undefined,
    
    ollama: resolved.provider === 'ollama' ? {
      baseUrl: resolved.baseUrl || 'http://localhost:11434/api',
      model: resolved.model,
    } : undefined,
    
    // Store resolved model
    resolvedModel: resolved,
    
    // Welcome Message
    welcomeMessage: jsonConfig.agent?.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
    welcomeMessageEnabled: true,
    
    // Conversation
    conversationTimeoutHours: jsonConfig.agent?.conversationTimeoutHours || 24,
    
    // Rate Limiting
    rateLimitMax: jsonConfig.rateLimit?.max || 10,
    rateLimitWindowSeconds: jsonConfig.rateLimit?.windowSeconds || 10,
    rateLimitMessage: jsonConfig.rateLimit?.message || 'Mohon tunggu sebentar ya.',
    
    // Working Hours
    workingHoursEnabled: jsonConfig.workingHours?.enabled || false,
    workingHoursStart: jsonConfig.workingHours?.start || '08:00',
    workingHoursEnd: jsonConfig.workingHours?.end || '17:00',
    workingHoursTimezone: jsonConfig.workingHours?.timezone || 'Asia/Jakarta',
    offlineMessage: jsonConfig.workingHours?.offlineMessage || 'Di luar jam operasional.',
    
    // Escalation
    telegramBotToken: jsonConfig.escalation?.telegramBotToken,
    telegramChatId: jsonConfig.escalation?.telegramChatId,
    
    // Human Takeover
    humanTakeoverCooldownMinutes: jsonConfig.humanTakeover?.cooldownMinutes || 30,
    
    // Group Chat
    groupChatEnabled: jsonConfig.groupChat?.enabled || false,
    groupChatReplyIfMentioned: jsonConfig.groupChat?.replyIfMentioned !== false,
    
    // Dashboard
    dashboardPort: jsonConfig.dashboard?.port || 3030,
    dashboardHost: jsonConfig.dashboard?.host || 'localhost',
    
    // Database
    databaseType: jsonConfig.database?.type || 'sqlite',
    databaseUrl: jsonConfig.database?.url || './data/wagent.db',
  };
}

/**
 * Create default config file
 */
export function createDefaultConfig(): void {
  const configPath = join(process.cwd(), 'config.jsonc');
  
  if (existsSync(configPath)) {
    getLogger().warn('config.jsonc already exists');
    return;
  }
  
  const defaultConfig = `{
  "$schema": "https://wagent.ai/config.json",
  
  // WhatsApp Session
  "session": "wagent-session",
  
  // AI Model - just set the model ID, everything else is auto-detected
  // Examples:
  //   "openai/gpt-4o"
  //   "anthropic/claude-sonnet-4-20250514"
  //   "google/gemini-2.0-flash"
  //   "groq/llama-3.1-70b-versatile"
  //   "deepseek/deepseek-chat"
  //   "ollama/llama3"
  "model": "openai/gpt-4o",
  
  // API Keys (set here or in environment)
  "providers": {
    "openai": {
      "apiKey": ""
    }
  },
  
  // Agent Settings
  "agent": {
    "systemPrompt": "Kamu adalah customer service AI yang ramah dan profesional.",
    "welcomeMessage": "Halo! 👋 Ada yang bisa saya bantu hari ini?"
  },
  
  // Dashboard
  "dashboard": {
    "port": 3030
  }
}`;
  
  writeFileSync(configPath, defaultConfig);
  getLogger().info(`Created default config at ${configPath}`);
}

/**
 * Convert TOON parsed object to readable prompt
 */
function convertToonToPrompt(toonObj: any): string {
  const lines: string[] = [];
  
  // Add role and language info
  if (toonObj.role) {
    lines.push(`Role: ${toonObj.role}`);
  }
  if (toonObj.language) {
    lines.push(`Language: ${toonObj.language}`);
  }
  if (toonObj.style) {
    lines.push(`Style: ${toonObj.style}`);
  }
  lines.push('');
  
  // Convert arrays to readable sections
  const sections: { [key: string]: string[] } = {
    'personality': toonObj.personality || [],
    'speaking-style': toonObj['speaking-style'] || [],
    'rules': toonObj.rules || [],
    'format': toonObj.format || [],
  };
  
  for (const [sectionName, items] of Object.entries(sections)) {
    if (items.length > 0) {
      const title = sectionName.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      lines.push(`## ${title}`);
      items.forEach((item: string) => {
        lines.push(`- ${item}`);
      });
      lines.push('');
    }
  }
  
  // Add reminder
  if (toonObj.reminder) {
    lines.push(toonObj.reminder);
  }
  
  return lines.join('\n');
}

export function ensureDirectories(config: WAgentConfig): void {
  const dirs = [
    config.whatsappSessionDir!,
    dirname(config.databaseUrl),
    join(process.cwd(), 'data'),
  ];

  for (const dir of dirs) {
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      getLogger().debug(`Created directory: ${dir}`);
    }
  }
}
