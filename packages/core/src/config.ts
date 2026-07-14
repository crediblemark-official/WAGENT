import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WAgentConfig } from './types.js';
import { getLogger } from './logger.js';
import { isEncryptionAvailable, getEncryptionKey, decryptEnvFile, decryptString } from './crypto.js';
import { resolveModel, ResolvedModel } from './model-catalog.js';

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
  // Fallback if file not found
  return 'Kamu adalah customer service yang ramah dan membantu.';
}

const DEFAULT_SYSTEM_PROMPT = loadDefaultSystemPrompt();

function findEnvFile(): string {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), '.env.local'),
    join(__dirname, '../../../.env'),
    join(__dirname, '../../../.env.local'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return join(process.cwd(), '.env');
}

/**
 * Load config, auto-decrypting .env.encrypted if encryption key is available.
 * Automatically detects model from available API keys.
 */
export async function loadConfig(): Promise<WAgentConfig> {
  const envPath = findEnvFile();

  // Auto-decrypt .env.encrypted → .env if encryption key is set
  if (!existsSync(envPath) && isEncryptionAvailable()) {
    const logger = getLogger();
    const keyHex = getEncryptionKey()!;
    const key = Buffer.from(keyHex, 'hex');

    const encPath = envPath + '.encrypted';
    if (existsSync(encPath)) {
      logger.info('Auto-decrypting: %s → %s', encPath, envPath);
      decryptEnvFile(envPath, key);
    }
  }

  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    getLogger().info(`Loaded config from ${envPath}`);
  }

  // Auto-detect model from available API keys
  const resolved = await autoDetectModel();
  
  getLogger().info(`Auto-detected model: ${resolved.provider}/${resolved.model}`);

  return {
    whatsappSessionName: process.env.WHATSAPP_SESSION_NAME || 'wagent-session',
    whatsappSessionDir: process.env.WHATSAPP_SESSION_DIR || join(process.cwd(), '.sessions'),

    aiProvider: resolved.provider as WAgentConfig['aiProvider'],
    systemPrompt: process.env.AGENT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
    welcomeMessage: process.env.WELCOME_MESSAGE || DEFAULT_WELCOME_MESSAGE,
    welcomeMessageEnabled: process.env.WELCOME_MESSAGE_ENABLED !== 'false',
    conversationTimeoutHours: parseInt(process.env.CONVERSATION_TIMEOUT_HOURS || '24', 10),

    // Rate Limiting
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
    rateLimitWindowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '10', 10),
    rateLimitMessage: process.env.RATE_LIMIT_MESSAGE || 'Mohon tunggu sebentar ya, Anda terlalu cepat mengirim pesan. 😊 Saya akan proses satu per satu.',

    // Working Hours
    workingHoursEnabled: process.env.WORKING_HOURS_ENABLED === 'true',
    workingHoursStart: process.env.WORKING_HOURS_START || '08:00',
    workingHoursEnd: process.env.WORKING_HOURS_END || '17:00',
    workingHoursTimezone: process.env.WORKING_HOURS_TIMEZONE || 'Asia/Jakarta',
    offlineMessage: process.env.OFFLINE_MESSAGE || 'Mohon maaf, saat ini di luar jam operasional 🙏. Jam kerja kami Senin-Jumat pukul 08:00-17:00. Silakan tinggalkan pesan, nanti akan kami balas saat jam kerja. Terima kasih! 😊',

    // Escalation
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,

    // Human Takeover
    humanTakeoverCooldownMinutes: parseInt(process.env.HUMAN_TAKEOVER_COOLDOWN_MINUTES || '30', 10),

    // Group Chat
    groupChatEnabled: process.env.GROUP_CHAT_ENABLED === 'true',
    groupChatReplyIfMentioned: process.env.GROUP_CHAT_REPLY_IF_MENTIONED !== 'false',

    // Auto-resolved provider config
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

    // Store resolved model info for agent use
    resolvedModel: resolved,

    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3030', 10),
    dashboardHost: process.env.DASHBOARD_HOST || 'localhost',

    databaseType: (process.env.DATABASE_TYPE as WAgentConfig['databaseType']) || 'sqlite',
    databaseUrl: process.env.DATABASE_URL || './data/wagent.db',
  };
}

/**
 * Auto-detect model based on available API keys
 */
async function autoDetectModel(): Promise<ResolvedModel> {
  // Priority order for auto-detection
  const detectionOrder = [
    { provider: 'openai', envKey: 'OPENAI_API_KEY', model: 'gpt-4o' },
    { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-20250514' },
    { provider: 'google', envKey: 'GEMINI_API_KEY', model: 'gemini-2.0-flash' },
    { provider: 'google', envKey: 'GOOGLE_API_KEY', model: 'gemini-2.0-flash' },
    { provider: 'groq', envKey: 'GROQ_API_KEY', model: 'llama-3.1-70b-versatile' },
    { provider: 'deepseek', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
    { provider: 'mistral', envKey: 'MISTRAL_API_KEY', model: 'mistral-large-latest' },
    { provider: 'xai', envKey: 'XAI_API_KEY', model: 'grok-3' },
    { provider: 'cohere', envKey: 'COHERE_API_KEY', model: 'command-r-plus' },
    { provider: 'fireworks', envKey: 'FIREWORKS_API_KEY', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct' },
    { provider: 'together', envKey: 'TOGETHER_API_KEY', model: 'meta-llama/Llama-3-70b-chat-hf' },
    { provider: 'perplexity', envKey: 'PERPLEXITY_API_KEY', model: 'llama-3.1-sonar-large-128k-online' },
    { provider: 'ollama', envKey: '', model: 'llama3' },
  ];

  // Find first available API key
  for (const detection of detectionOrder) {
    const apiKey = process.env[detection.envKey];
    
    // For Ollama, check if base URL is accessible
    if (detection.provider === 'ollama') {
      try {
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
        if (response.ok) {
          return {
            input: `ollama/${detection.model}`,
            provider: 'ollama',
            model: detection.model,
            baseUrl: `${baseUrl}/api`,
          };
        }
      } catch {
        // Ollama not available, continue
      }
      continue;
    }
    
    // For other providers, check if API key exists
    if (apiKey) {
      return {
        input: `${detection.provider}/${detection.model}`,
        provider: detection.provider,
        model: detection.model,
        apiKey,
        envKey: detection.envKey,
      };
    }
  }

  // Fallback to OpenAI with empty key (will fail at runtime)
  getLogger().warn('No API keys found. Set OPENAI_API_KEY or other provider keys.');
  return {
    input: 'openai/gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
  };
}

export function loadAndDecryptEnv(): void {
  // For explicit crypto init — decrypts the .env.encrypted without loading full config
  if (isEncryptionAvailable()) {
    const keyHex = getEncryptionKey()!;
    const key = Buffer.from(keyHex, 'hex');
    const envPath = findEnvFile();
    if (existsSync(envPath + '.encrypted')) {
      decryptEnvFile(envPath, key);
      getLogger().info('Decrypted %s.encrypted → %s', envPath, envPath);
    }
  }
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
