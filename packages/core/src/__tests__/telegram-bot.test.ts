import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getTelegramConfig: vi.fn().mockReturnValue({
      status_paused: 'Already paused',
      status_paused_done: 'Paused',
      status_active: 'Already active',
      status_active_done: 'Resumed',
      approve_usage: 'Usage: /approve <id>',
      approve_not_found: 'Not found',
      approve_done: 'Approved',
      reject_usage: 'Usage: /reject <id>',
      reject_not_found: 'Not found',
      reject_done: 'Rejected',
      pending_empty: 'No pending',
      pending_header: 'Pending',
      contacts_empty: 'No contacts',
      contacts_header: 'Contacts',
      logs_empty: 'No logs',
      logs_header: 'Logs',
      help_header: 'Help',
      help_status: 'Status',
      help_approval: 'Approval',
      help_information: 'Information',
      add_contact_usage: 'Usage: /add_contact <name> <relationship>',
      add_contact_example: 'Example: /add_contact John friend',
      unknown_command: 'Unknown command',
    }),
  },
}));

import { TelegramBot, TelegramGatewayAdapter } from '../services/telegram-bot.js';

function createMockGateway(overrides: Partial<TelegramGatewayAdapter> = {}): TelegramGatewayAdapter {
  return {
    getStatus: vi.fn().mockReturnValue('connected'),
    isPaused: vi.fn().mockReturnValue(false),
    setPaused: vi.fn(),
    getAgent: vi.fn().mockReturnValue({
      getProviderName: vi.fn().mockReturnValue('openai'),
      getMemoryManager: vi.fn().mockReturnValue({
        listContactProfiles: vi.fn().mockReturnValue([]),
        loadContactProfile: vi.fn().mockReturnValue(null),
        saveContactProfile: vi.fn(),
      }),
    }),
    getApprovalQueue: vi.fn().mockReturnValue({
      getStats: vi.fn().mockReturnValue({ pending: 0, approved: 0, rejected: 0 }),
      getPending: vi.fn().mockReturnValue([]),
      approve: vi.fn().mockReturnValue(true),
      reject: vi.fn().mockReturnValue(true),
    }),
    ...overrides,
  } as unknown as TelegramGatewayAdapter;
}

function createMockDb(overrides: Record<string, any> = {}) {
  return {
    getAllContacts: vi.fn().mockReturnValue([]),
    getAllChats: vi.fn().mockReturnValue([]),
    ...overrides,
  } as any;
}

function makeUpdate(text: string, chatId = '12345') {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 1, is_bot: false, first_name: 'User' },
      chat: { id: Number(chatId), type: 'private' as const },
      text,
      date: Date.now(),
    },
  };
}

describe('TelegramBot', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createBot(
    config: Record<string, any> = {},
    gateway?: TelegramGatewayAdapter,
    db?: any,
  ) {
    const fullConfig = {
      telegramBotToken: 'tok_abc',
      telegramChatId: '12345',
      ...config,
    };
    return new TelegramBot(
      fullConfig as any,
      gateway ?? createMockGateway(),
      db ?? createMockDb(),
    );
  }

  // ── Constructor and isEnabled ──────────────────────────────

  describe('constructor and isEnabled', () => {
    it('should be enabled when both token and chatId provided', () => {
      const bot = createBot();
      expect(bot.isEnabled).toBe(true);
    });

    it('should be disabled when token is missing', () => {
      const bot = createBot({ telegramBotToken: '' });
      expect(bot.isEnabled).toBe(false);
    });

    it('should be disabled when chatId is missing', () => {
      const bot = createBot({ telegramChatId: '' });
      expect(bot.isEnabled).toBe(false);
    });

    it('should be disabled when both are missing', () => {
      const bot = createBot({ telegramBotToken: '', telegramChatId: '' });
      expect(bot.isEnabled).toBe(false);
    });
  });

  // ── Command parsing ───────────────────────────────────────

  describe('command parsing via processUpdate', () => {
    it('should parse /status correctly', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/status'));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('WAGENT Status');
    });

    it('should parse /pause with args', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/pause arg1'));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Paused');
    });

    it('should strip @botname from command', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/status@mybotname'));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('WAGENT Status');
    });

    it('should ignore non-command messages', async () => {
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('hello there'));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should ignore messages from unauthorized chat', async () => {
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/status', '99999'));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle unknown command', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/foobar'));
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Unknown command');
      expect(body.text).toContain('/foobar');
    });
  });

  // ── /status ───────────────────────────────────────────────

  describe('/status command', () => {
    it('should show ACTIVE when not paused', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/status'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('ACTIVE');
    });

    it('should show PAUSED when paused', async () => {
      const gateway = createMockGateway({
        isPaused: vi.fn().mockReturnValue(true),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/status'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('PAUSED');
    });

    it('should include queue stats', async () => {
      const queue = {
        getStats: vi.fn().mockReturnValue({ pending: 3, approved: 7, rejected: 2 }),
        getPending: vi.fn(),
        approve: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/status'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('3');
      expect(body.text).toContain('7');
      expect(body.text).toContain('2');
    });
  });

  // ── /pause ────────────────────────────────────────────────

  describe('/pause command', () => {
    it('should pause when not already paused', async () => {
      const gateway = createMockGateway({
        isPaused: vi.fn().mockReturnValue(false),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/pause'));
      expect(gateway.setPaused).toHaveBeenCalledWith(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Paused');
    });

    it('should warn when already paused', async () => {
      const gateway = createMockGateway({
        isPaused: vi.fn().mockReturnValue(true),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/pause'));
      expect(gateway.setPaused).not.toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Already paused');
    });
  });

  // ── /resume ───────────────────────────────────────────────

  describe('/resume command', () => {
    it('should resume when paused', async () => {
      const gateway = createMockGateway({
        isPaused: vi.fn().mockReturnValue(true),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/resume'));
      expect(gateway.setPaused).toHaveBeenCalledWith(false);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Resumed');
    });

    it('should warn when not paused', async () => {
      const gateway = createMockGateway({
        isPaused: vi.fn().mockReturnValue(false),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/resume'));
      expect(gateway.setPaused).not.toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Already active');
    });
  });

  // ── /approve ──────────────────────────────────────────────

  describe('/approve command', () => {
    it('should approve request by ID', async () => {
      const queue = {
        approve: vi.fn().mockReturnValue(true),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/approve req-abc'));
      expect(queue.approve).toHaveBeenCalledWith('req-abc', 'telegram', undefined);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Approved');
    });

    it('should approve with note', async () => {
      const queue = {
        approve: vi.fn().mockReturnValue(true),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/approve req-1 looks good'));
      expect(queue.approve).toHaveBeenCalledWith('req-1', 'telegram', 'looks good');
    });

    it('should return usage when no args', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/approve'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Usage: /approve');
    });

    it('should show not found when approve returns false', async () => {
      const queue = {
        approve: vi.fn().mockReturnValue(false),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/approve nonexistent'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Not found');
    });
  });

  // ── /reject ───────────────────────────────────────────────

  describe('/reject command', () => {
    it('should reject request by ID', async () => {
      const queue = {
        reject: vi.fn().mockReturnValue(true),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/reject req-xyz'));
      expect(queue.reject).toHaveBeenCalledWith('req-xyz', 'telegram', undefined);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Rejected');
    });

    it('should reject with reason', async () => {
      const queue = {
        reject: vi.fn().mockReturnValue(true),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/reject req-1 bad idea'));
      expect(queue.reject).toHaveBeenCalledWith('req-1', 'telegram', 'bad idea');
    });

    it('should return usage when no args', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/reject'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Usage: /reject');
    });

    it('should show not found when reject returns false', async () => {
      const queue = {
        reject: vi.fn().mockReturnValue(false),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/reject nonexistent'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Not found');
    });
  });

  // ── /pending ──────────────────────────────────────────────

  describe('/pending command', () => {
    it('should show empty when no pending', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/pending'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('No pending');
    });

    it('should list pending requests', async () => {
      const queue = {
        getPending: vi.fn().mockReturnValue([
          { id: 'r1', title: 'Send msg', type: 'send_message', contactName: 'Alice', expiresAt: new Date('2025-12-31') },
          { id: 'r2', title: 'Create order', type: 'create_order', expiresAt: new Date('2025-12-31') },
        ]),
        getStats: vi.fn(),
        approve: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/pending'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('r1');
      expect(body.text).toContain('Send msg');
      expect(body.text).toContain('Alice');
      expect(body.text).toContain('r2');
    });

    it('should truncate at 10 items', async () => {
      const pending = Array.from({ length: 15 }, (_, i) => ({
        id: `r${i}`,
        title: `Request ${i}`,
        type: 'send_message' as const,
        expiresAt: new Date('2025-12-31'),
      }));
      const queue = {
        getPending: vi.fn().mockReturnValue(pending),
        getStats: vi.fn(),
        approve: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/pending'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('and 5 more');
    });
  });

  // ── /contacts ─────────────────────────────────────────────

  describe('/contacts command', () => {
    it('should show empty when no contacts', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/contacts'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('No contacts');
    });

    it('should list contacts', async () => {
      const db = createMockDb({
        getAllContacts: vi.fn().mockReturnValue([
          { pushName: 'Alice', name: 'Alice', number: '123', tags: ['vip'] },
          { pushName: 'Bob', name: 'Bob', number: '456' },
        ]),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, createMockGateway(), db);
      await (bot as any).processUpdate(makeUpdate('/contacts'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Alice');
      expect(body.text).toContain('Bob');
      expect(body.text).toContain('[vip]');
    });

    it('should respect limit argument', async () => {
      const contacts = Array.from({ length: 10 }, (_, i) => ({
        pushName: `Contact${i}`,
        name: `Contact${i}`,
        number: `${i}`,
      }));
      const db = createMockDb({
        getAllContacts: vi.fn().mockReturnValue(contacts),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, createMockGateway(), db);
      await (bot as any).processUpdate(makeUpdate('/contacts 3'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Contact0');
      expect(body.text).toContain('Contact2');
      expect(body.text).not.toContain('Contact3');
    });
  });

  // ── /logs ─────────────────────────────────────────────────

  describe('/logs command', () => {
    it('should show empty when no chats', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/logs'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('No logs');
    });

    it('should list recent chats', async () => {
      const db = createMockDb({
        getAllChats: vi.fn().mockReturnValue([
          {
            contactId: 'c1',
            contactName: 'Alice',
            lastMessage: 'Hello there!',
            lastMessageAt: new Date('2025-07-15T10:30:00'),
          },
        ]),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, createMockGateway(), db);
      await (bot as any).processUpdate(makeUpdate('/logs'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Alice');
      expect(body.text).toContain('Hello there!');
    });
  });

  // ── /help ─────────────────────────────────────────────────

  describe('/help command', () => {
    it('should show general help with all commands', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/help'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('/status');
      expect(body.text).toContain('/pause');
      expect(body.text).toContain('/resume');
      expect(body.text).toContain('/approve');
      expect(body.text).toContain('/reject');
      expect(body.text).toContain('/pending');
      expect(body.text).toContain('/contacts');
      expect(body.text).toContain('/logs');
      expect(body.text).toContain('/help');
    });

    it('should show specific command help', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/help status'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('/status');
      expect(body.text).toContain('Show agent status');
    });

    it('should show unknown command for help on nonexistent command', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/help nonexistent'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Unknown command');
    });
  });

  // ── /add_contact ──────────────────────────────────────────

  describe('/add_contact command', () => {
    it('should return usage with less than 2 args', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/add_contact'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Usage: /add_contact');
    });

    it('should return usage with only 1 arg', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await (bot as any).processUpdate(makeUpdate('/add_contact John'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Usage: /add_contact');
    });

    it('should add new contact successfully', async () => {
      const mm = {
        listContactProfiles: vi.fn().mockReturnValue([]),
        loadContactProfile: vi.fn().mockReturnValue(null),
        saveContactProfile: vi.fn(),
      };
      const agent = {
        getProviderName: vi.fn().mockReturnValue('openai'),
        getMemoryManager: vi.fn().mockReturnValue(mm),
      };
      const gateway = createMockGateway({
        getAgent: vi.fn().mockReturnValue(agent),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/add_contact John friend'));
      expect(mm.saveContactProfile).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Contact Added');
      expect(body.text).toContain('John');
    });

    it('should update existing contact profile', async () => {
      const existingProfile = { contactId: 'exist_1', name: 'John', relationship: 'old', updatedAt: new Date() };
      const mm = {
        listContactProfiles: vi.fn().mockReturnValue([{ contactId: 'exist_1', name: 'John' }]),
        loadContactProfile: vi.fn().mockReturnValue(existingProfile),
        saveContactProfile: vi.fn(),
      };
      const agent = {
        getProviderName: vi.fn().mockReturnValue('openai'),
        getMemoryManager: vi.fn().mockReturnValue(mm),
      };
      const gateway = createMockGateway({
        getAgent: vi.fn().mockReturnValue(agent),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/add_contact John boss'));
      expect(mm.saveContactProfile).toHaveBeenCalledWith(
        expect.objectContaining({ relationship: 'boss' }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Contact Updated');
    });
  });

  // ── sendMessage ───────────────────────────────────────────

  describe('sendMessage', () => {
    it('should send via Telegram API and return true', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      const result = await bot.sendMessage('hello');
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottok_abc/sendMessage',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('hello'),
        }),
      );
    });

    it('should return false when bot is disabled', async () => {
      const bot = createBot({ telegramBotToken: '' });
      const result = await bot.sendMessage('hello');
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return false on HTTP error', async () => {
      mockFetch.mockResolvedValue({ ok: false, text: vi.fn().mockResolvedValue('bad') });
      const bot = createBot();
      const result = await bot.sendMessage('hello');
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network'));
      const bot = createBot();
      const result = await bot.sendMessage('hello');
      expect(result).toBe(false);
    });
  });

  // ── notifyApprovalRequest ─────────────────────────────────

  describe('notifyApprovalRequest', () => {
    it('should send notification with icon and buttons', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await bot.notifyApprovalRequest({
        id: 'req-xyz',
        title: 'Send message',
        description: 'Send greeting',
        type: 'send_message',
        contactName: 'Bob',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Approval Required');
      expect(body.text).toContain('Send message');
      expect(body.text).toContain('Send greeting');
      expect(body.text).toContain('Bob');
      expect(body.text).toContain('/approve req-xyz');
      expect(body.text).toContain('/reject req-xyz');
      expect(body.text).toContain('💬');
    });

    it('should use correct icon for create_order type', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await bot.notifyApprovalRequest({
        id: 'r1', title: 'Order', description: 'New order', type: 'create_order',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('🛒');
    });

    it('should use correct icon for proactive_action type', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await bot.notifyApprovalRequest({
        id: 'r1', title: 'Action', description: 'Scheduled action', type: 'proactive_action',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('⏰');
    });

    it('should use wrench icon for unknown type', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await bot.notifyApprovalRequest({
        id: 'r1', title: 'Other', description: 'Something', type: 'other',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('🔧');
    });

    it('should omit contact line when not provided', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await bot.notifyApprovalRequest({
        id: 'r1', title: 'Action', description: 'Do it', type: 'send_message',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).not.toContain('Contact:');
    });

    it('should escape HTML in title and description', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot();
      await bot.notifyApprovalRequest({
        id: 'r1',
        title: '<b>bold</b>',
        description: 'Script <script>alert("xss")</script>',
        type: 'send_message',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).not.toContain('<script>');
      expect(body.text).toContain('&lt;script&gt;');
    });
  });

  // ── escapeHtml ────────────────────────────────────────────

  describe('escapeHtml', () => {
    it('should escape ampersand, angle brackets, and quotes', async () => {
      const queue = {
        approve: vi.fn().mockReturnValue(true),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/approve id&with<>chars'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('id&amp;with&lt;&gt;chars');
    });

    it('should escape double quotes', async () => {
      const queue = {
        approve: vi.fn().mockReturnValue(true),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/approve "req-1"'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('&quot;req-1&quot;');
    });
  });

  // ── start / stop lifecycle ────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('start does nothing when disabled', () => {
      const bot = createBot({ telegramBotToken: '' });
      bot.start();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('stop sets stopped and clears timer', () => {
      const bot = createBot();
      bot.start();
      bot.stop();
      expect((bot as any).stopped).toBe(true);
      expect((bot as any).pollTimer).toBeNull();
    });

    it('start sets stopped to false', () => {
      const bot = createBot();
      bot.stop();
      bot.start();
      expect((bot as any).stopped).toBe(false);
    });

    it('stop aborts pending fetch', () => {
      const bot = createBot();
      bot.start();
      bot.stop();
      expect((bot as any).abortController).toBeNull();
    });
  });

  // ── poll ──────────────────────────────────────────────────

  describe('poll', () => {
    it('should process updates from fetch', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const gateway = createMockGateway();
      const bot = createBot({}, gateway);
      await (bot as any).poll();
      // poll calls fetchUpdates which calls fetch for getUpdates
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle empty updates', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      });
      const bot = createBot();
      await (bot as any).poll();
      // No sendMessage should be called for empty results
    });

    it('should handle fetch error silently', async () => {
      mockFetch.mockRejectedValue(new Error('network'));
      const bot = createBot();
      await (bot as any).poll();
      // Should not throw
    });

    it('should handle AbortError silently', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);
      const bot = createBot();
      await (bot as any).poll();
      // Should not throw
    });

    it('should not poll when stopped', async () => {
      const bot = createBot();
      bot.stop();
      await (bot as any).poll();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should update lastUpdateId after processing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: [{ update_id: 42, message: undefined }],
        }),
      });
      const bot = createBot();
      await (bot as any).poll();
      expect((bot as any).lastUpdateId).toBe(42);
    });
  });

  // ── processUpdate edge cases ──────────────────────────────

  describe('processUpdate edge cases', () => {
    it('should ignore update with no message', async () => {
      const bot = createBot();
      await (bot as any).processUpdate({ update_id: 1 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should ignore message with no text', async () => {
      const bot = createBot();
      await (bot as any).processUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 1, is_bot: false, first_name: 'User' },
          chat: { id: 12345, type: 'private' },
          date: Date.now(),
        },
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle command execution error gracefully', async () => {
      const queue = {
        approve: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
        getStats: vi.fn(),
        getPending: vi.fn(),
      };
      const gateway = createMockGateway({
        getApprovalQueue: vi.fn().mockReturnValue(queue),
      });
      mockFetch.mockResolvedValue({ ok: true });
      const bot = createBot({}, gateway);
      await (bot as any).processUpdate(makeUpdate('/approve req-1'));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('boom');
    });
  });
});
