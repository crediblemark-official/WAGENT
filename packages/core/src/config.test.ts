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
import { loadConfig, ensureDirectories } from './config.js';
import type { WAgentConfig } from './types.js';
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

  it('should return default values when no env vars are set', async () => {
    const config = await loadConfig();
    expect(config.whatsappSessionName).toBe('wagent-session');
    expect(config.whatsappSessionDir).toContain('.sessions');
    expect(config.aiProvider).toBe('openai');
    expect(config.systemPrompt).toContain('customer-service-ai');
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
    expect(config.openai).toBeDefined();
    expect(config.openai!.model).toBe('gpt-4o');
    expect(config.gemini).toBeUndefined();
    expect(config.anthropic).toBeUndefined();
    expect(config.ollama).toBeUndefined();
    expect(config.dashboardPort).toBe(3030);
    expect(config.dashboardHost).toBe('localhost');
    expect(config.databaseType).toBe('sqlite');
    expect(config.databaseUrl).toBe('./data/wagent.db');
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

    const config: WAgentConfig = {
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

    const config: WAgentConfig = {
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
    const config: WAgentConfig = {
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
