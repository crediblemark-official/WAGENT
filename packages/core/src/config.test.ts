import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// Mock getLogger to avoid side effects
vi.mock('./logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

// Mock promptLoader
vi.mock('./prompt-loader.js', () => ({
  promptLoader: {
    getWelcomeMessage: () => 'Selamat datang!',
    getRateLimitMessage: () => 'Mohon tunggu sebentar.',
    getOfflineMessage: () => 'Di luar jam operasional.',
  },
}));

// Mock resolveModel
vi.mock('./model-catalog.js', () => ({
  resolveModel: vi.fn().mockResolvedValue({
    input: 'openai/gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'test-key',
  }),
}));

import {
  loadConfig,
  createDefaultConfig,
  ensureDirectories,
  type WAgentJsonConfig,
} from './config.js';
import { resolveModel } from './model-catalog.js';

const TMP = join(import.meta.dirname, '_config_test_tmp');

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('config', () => {
  describe('loadConfig', () => {
    it('should return defaults when no config file exists', async () => {
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('wagent-session');
        expect(config.welcomeMessage).toContain('Selamat datang');
        expect(config.rateLimitMessage).toContain('tunggu');
        expect(config.offlineMessage).toContain('jam operasional');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should load from config.jsonc with comments', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        "session": "test-session",
        "model": "openai/gpt-4o"
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('test-session');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should load from config.json', async () => {
      writeFileSync(join(TMP, 'config.json'), '{"session": "json-session"}');
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('json-session');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle JSONC with single-line comments', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        // This is a comment
        "session": "commented-session"
        // Another comment
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('commented-session');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle JSONC with multi-line comments', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        /* multi-line
           comment */
        "session": "ml-session"
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('ml-session');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should handle JSONC with trailing commas', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        "session": "trailing-session",
        "agent": {
          "welcomeMessage": "Hello!"
        },
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('trailing-session');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should set provider API key from config', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        "providers": {
          "openai": { "apiKey": "from-config" }
        }
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        await loadConfig();
        expect(process.env.OPENAI_API_KEY).toBe('from-config');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should set unknown provider env key', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        "model": "custom-provider/my-model",
        "providers": {
          "custom-provider": { "apiKey": "custom-key" }
        }
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        await loadConfig();
        // Unknown provider gets a generated env key
        const key = 'CUSTOM-PROVIDER_API_KEY';
        expect(process.env[key]).toBe('custom-key');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should use all config.jsonc values when provided', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        "session": "my-session",
        "agent": {
          "welcomeMessage": "Custom welcome!",
          "conversationTimeoutHours": 48
        },
        "rateLimit": {
          "max": 20,
          "windowSeconds": 60
        },
        "workingHours": {
          "enabled": true,
          "start": "09:00",
          "end": "18:00",
          "timezone": "Asia/Makassar"
        },
        "humanTakeover": {
          "cooldownMinutes": 60
        },
        "groupChat": {
          "enabled": true,
          "replyIfMentioned": false
        },
        "dashboard": {
          "port": 8080,
          "host": "0.0.0.0"
        },
        "database": {
          "type": "postgres",
          "url": "postgres://localhost/wagent"
        }
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.whatsappSessionName).toBe('my-session');
        expect(config.welcomeMessage).toBe('Custom welcome!');
        expect(config.conversationTimeoutHours).toBe(48);
        expect(config.rateLimitMax).toBe(20);
        expect(config.rateLimitWindowSeconds).toBe(60);
        expect(config.workingHoursEnabled).toBe(true);
        expect(config.workingHoursStart).toBe('09:00');
        expect(config.workingHoursEnd).toBe('18:00');
        expect(config.workingHoursTimezone).toBe('Asia/Makassar');
        expect(config.humanTakeoverCooldownMinutes).toBe(60);
        expect(config.groupChatEnabled).toBe(true);
        expect(config.groupChatReplyIfMentioned).toBe(false);
        expect(config.dashboardPort).toBe(8080);
        expect(config.dashboardHost).toBe('0.0.0.0');
        expect(config.databaseType).toBe('postgres');
        expect(config.databaseUrl).toBe('postgres://localhost/wagent');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should set telegram escalation config', async () => {
      writeFileSync(join(TMP, 'config.jsonc'), `{
        "escalation": {
          "telegramBotToken": "bot-token",
          "telegramChatId": "chat-id"
        }
      }`);
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.telegramBotToken).toBe('bot-token');
        expect(config.telegramChatId).toBe('chat-id');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should use MODEL env var when available', async () => {
      const originalEnv = process.env.MODEL;
      process.env.MODEL = 'anthropic/claude-3-haiku';
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        const config = await loadConfig();
        expect(config.resolvedModel).toBeDefined();
      } finally {
        process.cwd = originalCwd;
        if (originalEnv) process.env.MODEL = originalEnv;
        else delete process.env.MODEL;
      }
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config.jsonc if not exists', () => {
      const configPath = join(TMP, 'config.jsonc');
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        createDefaultConfig();
        expect(existsSync(configPath)).toBe(true);
        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('$schema');
        expect(content).toContain('wagent.ai/config.json');
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should not overwrite existing config', () => {
      const configPath = join(TMP, 'config.jsonc');
      writeFileSync(configPath, 'existing');
      const originalCwd = process.cwd;
      process.cwd = () => TMP;
      try {
        createDefaultConfig();
        expect(readFileSync(configPath, 'utf-8')).toBe('existing');
      } finally {
        process.cwd = originalCwd;
      }
    });
  });

  describe('ensureDirectories', () => {
    it('should create directories if not exist', () => {
      const sessionDir = join(TMP, 'sessions');
      const dataDir = join(TMP, 'data');
      ensureDirectories({
        whatsappSessionDir: sessionDir,
        databaseUrl: join(dataDir, 'test.db'),
      } as any);
      expect(existsSync(sessionDir)).toBe(true);
      expect(existsSync(dataDir)).toBe(true);
    });

    it('should not fail if directories already exist', () => {
      mkdirSync(join(TMP, 'sessions'), { recursive: true });
      expect(() => {
        ensureDirectories({
          whatsappSessionDir: join(TMP, 'sessions'),
          databaseUrl: join(TMP, 'test.db'),
        } as any);
      }).not.toThrow();
    });
  });
});
