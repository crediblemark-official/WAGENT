import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramBot, TelegramGatewayAdapter } from './telegram-bot.js';
import { OpenCSConfig } from './types.js';
import { ApprovalQueue } from './approval-queue.js';
import { Agent } from './agent.js';
import { Database } from './storage.js';

// ── Mocks ───────────────────────────────────────────────────────

function createMockGateway(): TelegramGatewayAdapter {
  let paused = false;
  return {
    getStatus: () => 'connected',
    isPaused: () => paused,
    setPaused: (p: boolean) => { paused = p; },
    getAgent: () => ({
      getProviderName: () => 'openai',
    }) as unknown as Agent,
    getApprovalQueue: () => ({
      enqueue: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      getPending: vi.fn().mockReturnValue([]),
      getAll: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      cancel: vi.fn(),
      getStats: vi.fn().mockReturnValue({ total: 0, pending: 0, approved: 0, rejected: 0, expired: 0, cancelled: 0 }),
      getResolvedForExecution: vi.fn(),
      getRecentlyResolved: vi.fn().mockReturnValue([]),
      clearOld: vi.fn().mockReturnValue(0),
      destroy: vi.fn(),
      startExpireCheck: vi.fn(),
      stopExpireCheck: vi.fn(),
    }) as unknown as ApprovalQueue,
  };
}

function createMockDb(): Partial<Database> {
  return {
    getAllContacts: vi.fn().mockReturnValue([]),
    getAllChats: vi.fn().mockReturnValue([]),
  } as unknown as Database;
}

function createConfig(overrides?: Partial<OpenCSConfig>): OpenCSConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'Test',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
    telegramBotToken: 'test:token',
    telegramChatId: '12345',
    ...overrides,
  };
}

describe('TelegramBot', () => {
  let bot: TelegramBot;
  let gateway: TelegramGatewayAdapter;
  let db: Partial<Database>;

  beforeEach(() => {
    gateway = createMockGateway();
    db = createMockDb();
  });

  afterEach(() => {
    bot.stop();
  });

  describe('constructor', () => {
    it('should be enabled when token and chatId are provided', () => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
      expect(bot.isEnabled).toBe(true);
    });

    it('should be disabled when token is missing', () => {
      bot = new TelegramBot(
        createConfig({ telegramBotToken: '' }),
        gateway,
        db as Database
      );
      expect(bot.isEnabled).toBe(false);
    });

    it('should be disabled when chatId is missing', () => {
      bot = new TelegramBot(
        createConfig({ telegramChatId: '' }),
        gateway,
        db as Database
      );
      expect(bot.isEnabled).toBe(false);
    });
  });

  describe('parseCommand', () => {
    beforeEach(() => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
    });

    it('should parse /status command', () => {
      // Access private method via bracket notation for testing
      const result = (bot as any).parseCommand('/status');
      expect(result.command).toBe('status');
      expect(result.args).toEqual([]);
    });

    it('should parse /approve with ID', () => {
      const result = (bot as any).parseCommand('/approve apr_123_test');
      expect(result.command).toBe('approve');
      expect(result.args).toEqual(['apr_123_test']);
    });

    it('should parse /reject with ID and reason', () => {
      const result = (bot as any).parseCommand('/reject apr_456 "Not needed"');
      expect(result.command).toBe('reject');
      // Note: simple space-split doesn't handle quotes
      expect(result.args[0]).toBe('apr_456');
    });

    it('should parse command with @botname suffix', () => {
      const result = (bot as any).parseCommand('/status@my_bot');
      expect(result.command).toBe('status');
    });

    it('should return empty for non-command text', () => {
      const result = (bot as any).parseCommand('just a message');
      expect(result.command).toBe('');
      expect(result.args).toEqual([]);
    });

    it('should handle command with multiple args', () => {
      const result = (bot as any).parseCommand('/approve abc123 yes please');
      expect(result.command).toBe('approve');
      expect(result.args).toEqual(['abc123', 'yes', 'please']);
    });
  });

  describe('pause/resume', () => {
    beforeEach(() => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
    });

    it('should pause and resume via gateway', () => {
      expect(gateway.isPaused()).toBe(false);

      gateway.setPaused(true);
      expect(gateway.isPaused()).toBe(true);

      gateway.setPaused(false);
      expect(gateway.isPaused()).toBe(false);
    });
  });

  describe('pending approvals', () => {
    it('should show message when no pending requests', async () => {
      const mockGateway = createMockGateway();
      // Already returns empty array from mock
      bot = new TelegramBot(createConfig(), mockGateway, db as Database);

      // Direct call to handler
      const result = await (bot as any).handlePending();
      expect(result).toContain('No pending approval requests');
    });

    it('should list pending requests when present', async () => {
      const mockGateway = createMockGateway();
      const mockApprove = {
        enqueue: vi.fn(),
        approve: vi.fn(),
        reject: vi.fn(),
        getPending: vi.fn().mockReturnValue([
          {
            id: 'apr_001',
            type: 'send_message',
            title: 'Send message to Budi',
            description: 'AI wants to send a greeting',
            status: 'pending',
            source: 'agent',
            contactName: 'Budi',
            expiresAt: new Date(Date.now() + 3600000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        getAll: vi.fn(),
        get: vi.fn(),
        cancel: vi.fn(),
        getStats: vi.fn().mockReturnValue({ total: 1, pending: 1, approved: 0, rejected: 0, expired: 0, cancelled: 0 }),
        getResolvedForExecution: vi.fn(),
        getRecentlyResolved: vi.fn(),
        clearOld: vi.fn(),
        destroy: vi.fn(),
        startExpireCheck: vi.fn(),
        stopExpireCheck: vi.fn(),
      };
      Object.assign(mockGateway, { getApprovalQueue: () => mockApprove });

      bot = new TelegramBot(createConfig(), mockGateway, db as Database);
      const result = await (bot as any).handlePending();
      expect(result).toContain('Pending Approvals');
      expect(result).toContain('apr_001');
      expect(result).toContain('Budi');
    });
  });

  describe('contacts', () => {
    it('should show empty contacts message', async () => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
      const result = await (bot as any).handleContacts([]);
      expect(result).toContain('No contacts yet');
    });
  });

  describe('logs', () => {
    it('should show empty logs message', async () => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
      const result = await (bot as any).handleLogs([]);
      expect(result).toContain('No recent activity');
    });
  });

  describe('help', () => {
    beforeEach(() => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
    });

    it('should show general help', async () => {
      const result = await (bot as any).handleHelp([]);
      expect(result).toContain('WAGENT Bot Commands');
      expect(result).toContain('/status');
      expect(result).toContain('/pause');
      expect(result).toContain('/pending');
      expect(result).toContain('/approve');
      expect(result).toContain('/reject');
      expect(result).toContain('/contacts');
      expect(result).toContain('/logs');
      expect(result).toContain('/help');
    });

    it('should show specific command help', async () => {
      const result = await (bot as any).handleHelp(['status']);
      expect(result).toContain('/status');
      expect(result).toContain('Show agent status');
    });

    it('should show error for unknown command', async () => {
      const result = await (bot as any).handleHelp(['nonexistent']);
      expect(result).toContain('Unknown command');
    });
  });

  describe('approve/reject', () => {
    beforeEach(() => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
    });

    it('should require request ID for approve', async () => {
      const result = await (bot as any).handleApprove([]);
      expect(result).toContain('Usage');
    });

    it('should require request ID for reject', async () => {
      const result = await (bot as any).handleReject([]);
      expect(result).toContain('Usage');
    });
  });

  describe('notifyApprovalRequest', () => {
    beforeEach(() => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
    });

    it('should generate notification message for send_message type', async () => {
      // Mock sendMessage to avoid actual HTTP call
      const sendSpy = vi.spyOn(bot, 'sendMessage').mockResolvedValue(true);

      await bot.notifyApprovalRequest({
        id: 'apr_001',
        title: 'Send greeting',
        description: 'AI wants to say hello',
        type: 'send_message',
        contactName: 'Budi',
      });

      expect(sendSpy).toHaveBeenCalledOnce();
      const message = sendSpy.mock.calls[0][0];
      expect(message).toContain('Approval Required');
      expect(message).toContain('apr_001');
      expect(message).toContain('/approve apr_001');
      expect(message).toContain('/reject apr_001');

      sendSpy.mockRestore();
    });
  });

  describe('escapeHtml', () => {
    beforeEach(() => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
    });

    it('should escape HTML special characters', () => {
      const result = (bot as any).escapeHtml('<b>test & "quote"</b>');
      expect(result).toBe('&lt;b&gt;test &amp; &quot;quote&quot;&lt;/b&gt;');
    });
  });

  describe('status', () => {
    it('should show paused status', async () => {
      gateway.setPaused(true);
      bot = new TelegramBot(createConfig(), gateway, db as Database);
      const result = await (bot as any).handleStatus();
      expect(result).toContain('PAUSED');
    });

    it('should show active status', async () => {
      gateway.setPaused(false);
      bot = new TelegramBot(createConfig(), gateway, db as Database);
      const result = await (bot as any).handleStatus();
      expect(result).toContain('ACTIVE');
    });
  });

  describe('lifecycle', () => {
    it('should not start when disabled', () => {
      bot = new TelegramBot(
        createConfig({ telegramBotToken: '' }),
        gateway,
        db as Database
      );
      bot.start();
      // Should not throw — just no-op
      expect(true).toBe(true);
    });

    it('should stop without errors when not started', () => {
      bot = new TelegramBot(createConfig(), gateway, db as Database);
      bot.stop();
      expect(true).toBe(true);
    });
  });
});
