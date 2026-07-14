import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WAgentConfig } from './types.js';
import { getLogger } from './logger.js';
import { isEncryptionAvailable, getEncryptionKey, decryptEnvFile, decryptString } from './crypto.js';

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
 */
export function loadConfig(): WAgentConfig {
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
  } else {
    getLogger().warn('No .env file found, using environment variables');
  }

  return {
    whatsappSessionName: process.env.WHATSAPP_SESSION_NAME || 'wagent-session',
    whatsappSessionDir: process.env.WHATSAPP_SESSION_DIR || join(process.cwd(), '.sessions'),

    aiProvider: (process.env.AI_PROVIDER as WAgentConfig['aiProvider']) || 'openai',
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

    openai: process.env.OPENAI_API_KEY ? {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    } : undefined,

    gemini: process.env.GEMINI_API_KEY ? {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    } : undefined,

    anthropic: process.env.ANTHROPIC_API_KEY ? {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    } : undefined,

    ollama: process.env.OLLAMA_BASE_URL ? {
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL || 'llama3',
    } : undefined,

    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3030', 10),
    dashboardHost: process.env.DASHBOARD_HOST || 'localhost',

    databaseType: (process.env.DATABASE_TYPE as WAgentConfig['databaseType']) || 'sqlite',
    databaseUrl: process.env.DATABASE_URL || './data/wagent.db',
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
