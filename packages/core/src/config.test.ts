import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// Mock external modules before importing config
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(),
  },
}));

// We'll mock crypto functions per test via vi.mocked
import * as crypto from './crypto.js';
vi.mock('./crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return {
    ...actual,
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    getEncryptionKey: vi.fn().mockReturnValue(null),
    decryptEnvFile: vi.fn().mockReturnValue(null),
    decryptString: vi.fn().mockReturnValue(''),
  };
});

// Now import the module under test (vi.mock is hoisted)
import { loadConfig, ensureDirectories, loadAndDecryptEnv } from './config.js';
import type { OpenCSConfig } from './types.js';
import dotenv from 'dotenv';

// ── Helpers ────────────────────────────────────────────────────

/** Save/restore env vars */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }
}

/** Create temp dir + cleanup */
function tempDir(): { path: string; cleanup: () => void } {
  const p = mkdtempSync(join(tmpdir(), 'config-test-'));
  return {
    path: p,
    cleanup: () => { try { rmdirSync(p, { recursive: true }); } catch { /* */ } },
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('loadConfig — defaults', () => {
  const PREV: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'WHATSAPP_SESSION_NAME', 'WHATSAPP_SESSION_DIR',
    'AI_PROVIDER', 'AGENT_SYSTEM_PROMPT', 'WELCOME_MESSAGE',
    'WELCOME_MESSAGE_ENABLED', 'CONVERSATION_TIMEOUT_HOURS',
    'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_SECONDS', 'RATE_LIMIT_MESSAGE',
    'WORKING_HOURS_ENABLED', 'WORKING_HOURS_START', 'WORKING_HOURS_END',
    'WORKING_HOURS_TIMEZONE', 'OFFLINE_MESSAGE',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
    'HUMAN_TAKEOVER_COOLDOWN_MINUTES',
    'GROUP_CHAT_ENABLED', 'GROUP_CHAT_REPLY_IF_MENTIONED',
    'OPENAI_API_KEY', 'OPENAI_MODEL',
    'GEMINI_API_KEY', 'GEMINI_MODEL',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
    'OLLAMA_BASE_URL', 'OLLAMA_MODEL',
    'DASHBOARD_PORT', 'DASHBOARD_HOST',
    'DATABASE_TYPE', 'DATABASE_URL',
  ];

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      PREV[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(PREV)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('should return default values when no env vars are set', () => {
    const config = loadConfig();
    expect(config.whatsappSessionName).toBe('wagent-session');
    expect(config.whatsappSessionDir).toContain('.sessions');
    expect(config.aiProvider).toBe('openai');
    expect(config.systemPrompt).toContain('Kamu adalah customer service AI');
    expect(config.welcomeMessage).toContain('Halo');
    expect(config.welcomeMessageEnabled).toBe(true);
    expect(config.conversationTimeoutHours).toBe(24);
    expect(config.rateLimitMax).toBe(10);
    expect(config.rateLimitWindowSeconds).toBe(10);
    expect(config.rateLimitMessage).toContain('Mohon tunggu');
    expect(config.workingHoursEnabled).toBe(false);
    expect(config.workingHoursStart).toBe('08:00');
    expect(config.workingHoursEnd).toBe('17:00');
    expect(config.workingHoursTimezone).toBe('Asia/Jakarta');
    expect(config.offlineMessage).toContain('jam operasional');
    expect(config.telegramBotToken).toBeUndefined();
    expect(config.telegramChatId).toBeUndefined();
    expect(config.humanTakeoverCooldownMinutes).toBe(30);
    expect(config.groupChatEnabled).toBe(false);
    expect(config.groupChatReplyIfMentioned).toBe(true); // default !== 'false'
    expect(config.openai).toBeUndefined();
    expect(config.gemini).toBeUndefined();
    expect(config.anthropic).toBeUndefined();
    expect(config.ollama).toBeUndefined();
    expect(config.dashboardPort).toBe(3030);
    expect(config.dashboardHost).toBe('localhost');
    expect(config.databaseType).toBe('sqlite');
    expect(config.databaseUrl).toBe('./data/wagent.db');
  });
});

describe('loadConfig — env vars override', () => {
  const PREV: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save all possible config env vars
    for (const key of [
      'WHATSAPP_SESSION_NAME', 'AI_PROVIDER', 'AGENT_SYSTEM_PROMPT',
      'WELCOME_MESSAGE', 'WELCOME_MESSAGE_ENABLED', 'CONVERSATION_TIMEOUT_HOURS',
      'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_SECONDS', 'RATE_LIMIT_MESSAGE',
      'WORKING_HOURS_ENABLED', 'WORKING_HOURS_START', 'WORKING_HOURS_END',
      'WORKING_HOURS_TIMEZONE', 'OFFLINE_MESSAGE',
      'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
      'HUMAN_TAKEOVER_COOLDOWN_MINUTES',
      'GROUP_CHAT_ENABLED', 'GROUP_CHAT_REPLY_IF_MENTIONED',
      'OPENAI_API_KEY', 'OPENAI_MODEL',
      'GEMINI_API_KEY', 'GEMINI_MODEL',
      'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
      'OLLAMA_BASE_URL', 'OLLAMA_MODEL',
      'DASHBOARD_PORT', 'DASHBOARD_HOST',
      'DATABASE_TYPE', 'DATABASE_URL',
    ]) {
      PREV[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(PREV)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('should use OPENAI_API_KEY when set', () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    const config = loadConfig();
    expect(config.openai).toBeDefined();
    expect(config.openai!.apiKey).toBe('sk-test123');
    expect(config.openai!.model).toBe('gpt-4o-mini');
  });

  it('should use GEMINI_API_KEY when set', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash-lite';
    const config = loadConfig();
    expect(config.gemini).toBeDefined();
    expect(config.gemini!.apiKey).toBe('gemini-key');
    expect(config.gemini!.model).toBe('gemini-2.0-flash-lite');
  });

  it('should use ANTHROPIC_API_KEY when set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
    const config = loadConfig();
    expect(config.anthropic).toBeDefined();
    expect(config.anthropic!.apiKey).toBe('sk-ant-test');
    expect(config.anthropic!.model).toBe('claude-sonnet-4-20250514');
  });

  it('should use OLLAMA_BASE_URL when set', () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_MODEL = 'llama3.2';
    const config = loadConfig();
    expect(config.ollama).toBeDefined();
    expect(config.ollama!.baseUrl).toBe('http://localhost:11434');
    expect(config.ollama!.model).toBe('llama3.2');
  });

  it('should use AI_PROVIDER env var', () => {
    process.env.AI_PROVIDER = 'gemini';
    const config = loadConfig();
    expect(config.aiProvider).toBe('gemini');
  });

  it('should parse WELCOME_MESSAGE_ENABLED as boolean', () => {
    process.env.WELCOME_MESSAGE_ENABLED = 'false';
    const config = loadConfig();
    expect(config.welcomeMessageEnabled).toBe(false);
  });

  it('should parse WORKING_HOURS_ENABLED as boolean', () => {
    process.env.WORKING_HOURS_ENABLED = 'true';
    const config = loadConfig();
    expect(config.workingHoursEnabled).toBe(true);
  });

  it('should parse GROUP_CHAT_ENABLED as boolean', () => {
    process.env.GROUP_CHAT_ENABLED = 'true';
    const config = loadConfig();
    expect(config.groupChatEnabled).toBe(true);
  });

  it('should parse GROUP_CHAT_REPLY_IF_MENTIONED as boolean', () => {
    process.env.GROUP_CHAT_REPLY_IF_MENTIONED = 'false';
    const config = loadConfig();
    expect(config.groupChatReplyIfMentioned).toBe(false);
  });

  it('should parse numeric env vars correctly', () => {
    process.env.RATE_LIMIT_MAX = '50';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '30';
    process.env.CONVERSATION_TIMEOUT_HOURS = '48';
    process.env.HUMAN_TAKEOVER_COOLDOWN_MINUTES = '60';
    process.env.DASHBOARD_PORT = '9090';
    const config = loadConfig();
    expect(config.rateLimitMax).toBe(50);
    expect(config.rateLimitWindowSeconds).toBe(30);
    expect(config.conversationTimeoutHours).toBe(48);
    expect(config.humanTakeoverCooldownMinutes).toBe(60);
    expect(config.dashboardPort).toBe(9090);
  });

  it('should set Telegram config when env vars provided', () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    process.env.TELEGRAM_CHAT_ID = '-100group';
    const config = loadConfig();
    expect(config.telegramBotToken).toBe('123:abc');
    expect(config.telegramChatId).toBe('-100group');
  });

  it('should use custom session name and dir', () => {
    process.env.WHATSAPP_SESSION_NAME = 'my-session';
    process.env.WHATSAPP_SESSION_DIR = '/custom/sessions';
    const config = loadConfig();
    expect(config.whatsappSessionName).toBe('my-session');
    expect(config.whatsappSessionDir).toBe('/custom/sessions');
  });

  it('should use custom system prompt', () => {
    process.env.AGENT_SYSTEM_PROMPT = 'Kamu adalah CS yang super ramah!';
    const config = loadConfig();
    expect(config.systemPrompt).toBe('Kamu adalah CS yang super ramah!');
  });

  it('should use custom database config', () => {
    process.env.DATABASE_TYPE = 'postgres';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/wagent';
    const config = loadConfig();
    expect(config.databaseType).toBe('postgres');
    expect(config.databaseUrl).toBe('postgres://user:pass@localhost:5432/wagent');
  });

  it('should use custom dashboard host', () => {
    process.env.DASHBOARD_HOST = 'dashboard.myapp.com';
    const config = loadConfig();
    expect(config.dashboardHost).toBe('dashboard.myapp.com');
  });
});

describe('loadConfig — .env file loading', () => {
  let tmp: { path: string; cleanup: () => void };
  let originalCwd: string;

  beforeEach(() => {
    tmp = tempDir();
    originalCwd = process.cwd();
    process.chdir(tmp.path);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
  });

  it('should load from .env file when it exists', () => {
    writeFileSync(join(tmp.path, '.env'), 'WHATSAPP_SESSION_NAME=from-dotenv\nAI_PROVIDER=gemini');
    // dotenv.config is mocked, but we can still verify the file detection
    const config = loadConfig();
    // Without actual dotenv loading, env vars won't be set from the file
    // So config will use defaults - but dotenv.config should have been called
    expect(dotenv.config).toHaveBeenCalled();
  });
});

describe('loadConfig — auto-decrypt path', () => {
  let tmp: { path: string; cleanup: () => void };
  let originalCwd: string;

  beforeEach(() => {
    tmp = tempDir();
    originalCwd = process.cwd();
    process.chdir(tmp.path);
    // Reset crypto mocks for this suite
    vi.mocked(crypto.isEncryptionAvailable).mockReset();
    vi.mocked(crypto.getEncryptionKey).mockReset();
    vi.mocked(crypto.decryptEnvFile).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
  });

  it('should auto-decrypt .env.encrypted when key is available and .env not found', () => {
    // Create .env.encrypted but no .env
    writeFileSync(join(tmp.path, '.env.encrypted'), 'encrypted-data');
    vi.mocked(crypto.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(crypto.getEncryptionKey).mockReturnValue('aa'.repeat(32));
    vi.mocked(crypto.decryptEnvFile).mockReturnValue(join(tmp.path, '.env'));

    const config = loadConfig();

    // decryptEnvFile should have been called
    expect(crypto.decryptEnvFile).toHaveBeenCalled();
    // Since we mocked decryptEnvFile AND dotenv, env vars still come from process.env
    expect(config.whatsappSessionName).toBe('wagent-session');
  });

  it('should NOT auto-decrypt when .env already exists', () => {
    writeFileSync(join(tmp.path, '.env'), 'EXISTING=1');
    writeFileSync(join(tmp.path, '.env.encrypted'), 'encrypted-data');
    vi.mocked(crypto.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(crypto.getEncryptionKey).mockReturnValue('aa'.repeat(32));

    loadConfig();

    // decryptEnvFile should NOT be called because .env already exists
    expect(crypto.decryptEnvFile).not.toHaveBeenCalled();
  });

  it('should NOT auto-decrypt when encryption key is not available', () => {
    writeFileSync(join(tmp.path, '.env.encrypted'), 'encrypted-data');
    vi.mocked(crypto.isEncryptionAvailable).mockReturnValue(false);

    loadConfig();

    expect(crypto.decryptEnvFile).not.toHaveBeenCalled();
  });
});

describe('ensureDirectories', () => {
  let tmp: { path: string; cleanup: () => void };

  beforeEach(() => {
    tmp = tempDir();
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('should create non-existent directories', () => {
    const sessionDir = join(tmp.path, 'sessions');
    const dataDir = join(tmp.path, 'data');
    const dbPath = join(tmp.path, 'data', 'wagent.db');

    const config: OpenCSConfig = {
      whatsappSessionName: 'test',
      whatsappSessionDir: sessionDir,
      aiProvider: 'openai',
      systemPrompt: 'Test',
      databaseType: 'sqlite',
      databaseUrl: dbPath,
      dashboardPort: 3030,
      dashboardHost: 'localhost',
    };

    expect(existsSync(sessionDir)).toBe(false);
    expect(existsSync(dataDir)).toBe(false);

    ensureDirectories(config);

    expect(existsSync(sessionDir)).toBe(true);
    expect(existsSync(dataDir)).toBe(true);
  });

  it('should not throw when directories already exist', () => {
    const sessionDir = join(tmp.path, 'sessions');
    mkdirSync(sessionDir, { recursive: true });

    const config: OpenCSConfig = {
      whatsappSessionName: 'test',
      whatsappSessionDir: sessionDir,
      aiProvider: 'openai',
      systemPrompt: 'Test',
      databaseType: 'sqlite',
      databaseUrl: join(tmp.path, 'data.db'),
      dashboardPort: 3030,
      dashboardHost: 'localhost',
    };

    expect(() => ensureDirectories(config)).not.toThrow();
    expect(existsSync(sessionDir)).toBe(true);
  });

  it('should handle undefined session dir gracefully', () => {
    const config: OpenCSConfig = {
      whatsappSessionName: 'test',
      whatsappSessionDir: undefined,
      aiProvider: 'openai',
      systemPrompt: 'Test',
      databaseType: 'sqlite',
      databaseUrl: join(tmp.path, 'data', 'wagent.db'),
      dashboardPort: 3030,
      dashboardHost: 'localhost',
    };

    // Should not throw when sessionDir is undefined
    expect(() => ensureDirectories(config)).not.toThrow();
  });
});

describe('loadAndDecryptEnv', () => {
  let tmp: { path: string; cleanup: () => void };
  let originalCwd: string;

  beforeEach(() => {
    tmp = tempDir();
    originalCwd = process.cwd();
    process.chdir(tmp.path);
    vi.mocked(crypto.isEncryptionAvailable).mockReset();
    vi.mocked(crypto.getEncryptionKey).mockReset();
    vi.mocked(crypto.decryptEnvFile).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
  });

  it('should decrypt .env.encrypted when key is available', () => {
    writeFileSync(join(tmp.path, '.env.encrypted'), 'encrypted-data');
    vi.mocked(crypto.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(crypto.getEncryptionKey).mockReturnValue('aa'.repeat(32));
    vi.mocked(crypto.decryptEnvFile).mockReturnValue(join(tmp.path, '.env'));

    loadAndDecryptEnv();

    expect(crypto.decryptEnvFile).toHaveBeenCalled();
  });

  it('should do nothing when encryption is not available', () => {
    vi.mocked(crypto.isEncryptionAvailable).mockReturnValue(false);
    loadAndDecryptEnv();
    expect(crypto.decryptEnvFile).not.toHaveBeenCalled();
  });
});
