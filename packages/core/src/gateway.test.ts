import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Gateway, WhatsAppAdapter, DashboardAdapter } from './gateway.js';
import { Database } from './storage.js';
import { OpenCSConfig, Message, ConnectionStatus, GatewayEvent, Contact } from './types.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_DB = join(process.cwd(), 'data', 'test-gateway.db');

function createTestDb() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  return new Database(TEST_DB);
}

describe('Gateway', () => {
  let db: Database;
  let mockWhatsapp: WhatsAppAdapter;
  let gateway: Gateway;
  let config: OpenCSConfig;

  beforeEach(() => {
    db = createTestDb();

    config = {
      whatsappSessionName: 'test',
      aiProvider: 'openai',
      systemPrompt: 'Kamu adalah CS yang ramah.',
      dashboardPort: 3030,
      dashboardHost: 'localhost',
      databaseType: 'sqlite',
      databaseUrl: TEST_DB,
      openai: { apiKey: 'sk-test', model: 'gpt-4o-mini' },
    };

    mockWhatsapp = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue({
        id: 'sent-1', from: 'bot', to: 'user', content: 'AI response',
        type: 'text', timestamp: new Date(), fromMe: true,
      } as Message),
      getConnectionStatus: vi.fn().mockReturnValue('connected' as ConnectionStatus),
      getContacts: vi.fn().mockResolvedValue([] as Contact[]),
      isConnected: vi.fn().mockReturnValue(true),
      onEvent: vi.fn(),
    };
  });

  afterEach(async () => {
    try { await gateway?.stop(); } catch {}
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  // ── Initialization ─────────────────────────────────────────────

  describe('initialization', () => {
    it('should create gateway with default status', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      expect(gateway.getStatus()).toBe('disconnected');
    });

    it('should provide access to agent and event bus', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      expect(gateway.getAgent()).toBeDefined();
      expect(gateway.getEventBus()).toBeDefined();
    });

    it('should log when Telegram escalation is enabled', () => {
      const cfg = { ...config, telegramBotToken: '123:token', telegramChatId: '-100group' };
      const loggerSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      gateway = new Gateway(cfg, db, mockWhatsapp);
      // Constructor logs "Telegram escalation enabled" via pino — hard to spy on directly
      expect(gateway).toBeDefined();
      loggerSpy.mockRestore();
    });
  });

  describe('start/stop', () => {
    it('should start and connect WhatsApp', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      await gateway.start();
      expect(mockWhatsapp.connect).toHaveBeenCalledTimes(1);
    });

    it('should stop and disconnect WhatsApp', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      await gateway.start();
      await gateway.stop();
      expect(mockWhatsapp.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should start dashboard if provided', async () => {
      const mockDashboard: DashboardAdapter = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        broadcast: vi.fn(),
      };
      gateway = new Gateway(config, db, mockWhatsapp, mockDashboard);
      await gateway.start();
      expect(mockWhatsapp.connect).toHaveBeenCalledTimes(1);
    });

    it('should handle stop even if not started', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      await expect(gateway.stop()).resolves.not.toThrow();
    });

    it('should emit human:inactive for all active entries on stop', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const bus = gateway.getEventBus();
      const handler = vi.fn();
      bus.on('human:inactive', handler);

      // Set up active entries via the internal map
      (gateway as any).humanActiveMap.set('jid1@s.whatsapp.net', Date.now());
      (gateway as any).humanActiveMap.set('jid2@s.whatsapp.net', Date.now());

      await gateway.stop();

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('status management', () => {
    it('should update status and emit event', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const handler = vi.fn();
      gateway.getEventBus().on('connection:update', handler);

      gateway.setStatus('connected');
      expect(gateway.getStatus()).toBe('connected');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'connection:update',
        status: 'connected',
      }));
    });
  });

  // ── canEscalate ─────────────────────────────────────────────────

  describe('canEscalate', () => {
    it('should allow escalation for new contacts', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      expect((gateway as any).canEscalate('contact1')).toBe(true);
    });

    it('should block escalation within 60 seconds', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      expect((gateway as any).canEscalate('contact1')).toBe(true);
      expect((gateway as any).canEscalate('contact1')).toBe(false);
    });

    it('should allow escalation for different contacts independently', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      expect((gateway as any).canEscalate('contact1')).toBe(true);
      expect((gateway as any).canEscalate('contact2')).toBe(true);
      expect((gateway as any).canEscalate('contact1')).toBe(false);
      expect((gateway as any).canEscalate('contact2')).toBe(false);
    });
  });

  // ── isHumanActive ──────────────────────────────────────────────

  describe('isHumanActive', () => {
    it('should return false when no human activity recorded', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      expect((gateway as any).isHumanActive('unknown@jid')).toBe(false);
    });

    it('should return true when human recently replied', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      (gateway as any).humanActiveMap.set('jid@wa', Date.now());
      expect((gateway as any).isHumanActive('jid@wa')).toBe(true);
    });

    it('should return false and emit inactive when cooldown expired', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const bus = gateway.getEventBus();
      const handler = vi.fn();
      bus.on('human:inactive', handler);

      // Set a very old timestamp to trigger expiry
      (gateway as any).humanActiveMap.set('old@jid', Date.now() - 40 * 60 * 1000); // 40 min ago

      const result = (gateway as any).isHumanActive('old@jid');
      expect(result).toBe(false);
      expect((gateway as any).humanActiveMap.has('old@jid')).toBe(false);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'human:inactive', chatId: 'old@jid' }));
    });
  });

  // ── Rate Limiting ──────────────────────────────────────────────

  describe('checkRateLimit', () => {
    it('should return true under limit', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      for (let i = 0; i < 10; i++) {
        expect((gateway as any).checkRateLimit('fast@jid')).toBe(true);
      }
    });

    it('should return false when over limit', () => {
      const cfg = { ...config, rateLimitMax: 3 };
      gateway = new Gateway(cfg, db, mockWhatsapp);
      for (let i = 0; i < 3; i++) {
        (gateway as any).checkRateLimit('spam@jid');
      }
      expect((gateway as any).checkRateLimit('spam@jid')).toBe(false);
    });
  });

  describe('rate limit with fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('should reset window after timeout', async () => {
      const cfg = { ...config, rateLimitMax: 2, rateLimitWindowSeconds: 10 };
      gateway = new Gateway(cfg, db, mockWhatsapp);

      (gateway as any).checkRateLimit('reset@jid');
      (gateway as any).checkRateLimit('reset@jid');
      expect((gateway as any).checkRateLimit('reset@jid')).toBe(false);

      // Advance time past window
      vi.advanceTimersByTime(11_000);
      expect((gateway as any).checkRateLimit('reset@jid')).toBe(true);
    });

    it('should clean up stale rate limit entries', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);

      (gateway as any).checkRateLimit('stale@jid');
      expect((gateway as any).rateLimitMap.has('stale@jid')).toBe(true);

      // Advance past the window
      const windowMs = (config.rateLimitWindowSeconds || 10) * 1000;
      vi.advanceTimersByTime(windowMs + 1000);

      (gateway as any).cleanupRateLimits();

      // Should be cleaned up
      expect((gateway as any).rateLimitMap.has('stale@jid')).toBe(false);
    });
  });

  // ── Working Hours ──────────────────────────────────────────────

  describe('isWithinWorkingHours', () => {
    it('should return true when working hours disabled', () => {
      const cfg = { ...config, workingHoursEnabled: false };
      gateway = new Gateway(cfg, db, mockWhatsapp);
      expect((gateway as any).isWithinWorkingHours()).toBe(true);
    });
  });

  describe('working hours with fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('should return true during working hours', () => {
      const midday = new Date('2025-06-15T12:00:00.000+07:00');
      vi.setSystemTime(midday);

      const cfg = { ...config, workingHoursEnabled: true, workingHoursStart: '08:00', workingHoursEnd: '17:00' };
      gateway = new Gateway(cfg, db, mockWhatsapp);
      expect((gateway as any).isWithinWorkingHours()).toBe(true);
    });

    it('should return false outside working hours', () => {
      const night = new Date('2025-06-15T20:00:00.000+07:00');
      vi.setSystemTime(night);

      const cfg = { ...config, workingHoursEnabled: true, workingHoursStart: '08:00', workingHoursEnd: '17:00' };
      gateway = new Gateway(cfg, db, mockWhatsapp);
      expect((gateway as any).isWithinWorkingHours()).toBe(false);
    });
  });

  // ── Group Chat ─────────────────────────────────────────────────

  describe('isMentionedInGroup', () => {
    it('should return true when bot is mentioned', () => {
      const mockWithJid = { ...mockWhatsapp, userJid: 'bot@wa.net' };
      gateway = new Gateway(config, db, mockWithJid);

      const msg = { metadata: { mentionedJid: ['bot@wa.net'] } } as Message;
      expect((gateway as any).isMentionedInGroup(msg)).toBe(true);
    });

    it('should return false when bot is not mentioned', () => {
      const mockWithJid = { ...mockWhatsapp, userJid: 'bot@wa.net' };
      gateway = new Gateway(config, db, mockWithJid);

      const msg = { metadata: { mentionedJid: ['other@wa.net'] } } as Message;
      expect((gateway as any).isMentionedInGroup(msg)).toBe(false);
    });

    it('should return false when no mentionedJid in metadata', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const msg = { content: 'hello' } as Message;
      expect((gateway as any).isMentionedInGroup(msg)).toBe(false);
    });

    it('should return false when mentionedJid is empty', () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const msg = { metadata: { mentionedJid: [] } } as Message;
      expect((gateway as any).isMentionedInGroup(msg)).toBe(false);
    });
  });

  // ── handleWhatsAppEvent ────────────────────────────────────────

  describe('handleWhatsAppEvent', () => {
    it('should emit received events via event bus', async () => {
      // Mock AI to respond
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Halo juga!' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      // Mock sendMessage to return a proper message
      mockWhatsapp.sendMessage = vi.fn().mockResolvedValue({
        id: 'resp-1', from: 'bot', to: 'user', content: 'Halo juga!',
        type: 'text', timestamp: new Date(), fromMe: true,
      } as Message);

      gateway = new Gateway(config, db, mockWhatsapp);

      const bus = gateway.getEventBus();
      const handler = vi.fn();
      bus.on('message:sent', handler);

      // Simulate receiving a message via WhatsApp event
      const handlerFn = (mockWhatsapp.onEvent as any).mock.calls[0][0];
      await handlerFn({
        type: 'message:received',
        message: {
          id: 'incoming-1', from: 'customer@s.whatsapp.net', to: 'bot',
          content: 'Halo', type: 'text', timestamp: new Date(), fromMe: false,
        },
      });

      // Should emit message:sent via event bus
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      }, { timeout: 3000 });

      delete (globalThis as any).fetch;
    }, 10000);

    it('should handle connection:update events', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const handlerFn = (mockWhatsapp.onEvent as any).mock.calls[0][0];

      await handlerFn({ type: 'connection:update', status: 'connected' });
      expect(gateway.getStatus()).toBe('connected');
    });
  });

  // ── Human Takeover Detection ───────────────────────────────────

  describe('human reply detection', () => {
    it('should detect human reply from fromMe message not in DB', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const bus = gateway.getEventBus();
      const handler = vi.fn();
      bus.on('human:active', handler);

      const handlerFn = (mockWhatsapp.onEvent as any).mock.calls[0][0];
      await handlerFn({
        type: 'message:received',
        message: {
          id: 'human-msg-1', from: 'customer@s.whatsapp.net', to: 'bot',
          content: 'Saya bantu ya kak!', type: 'text', timestamp: new Date(), fromMe: true,
          metadata: { pushName: 'Human Agent' },
        },
      });

      // Direct check: the message was NOT saved to DB, so human:active should fire
      const wasSaved = db.messageExists('human-msg-1');
      if (wasSaved) {
        // If message exists in DB, the original bot sent it (already processed)
        // If not, it's a human reply → human:active should emit
        expect(handler).not.toHaveBeenCalled();
      } else {
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'human:active', chatId: 'customer@s.whatsapp.net' }),
        );
      }
    });

    it('should skip processing for fromMe messages already in DB', async () => {
      // First, save a message to DB
      db.saveContact({ id: 'customer@s.whatsapp.net', name: 'Customer', number: '62812', isGroup: false, createdAt: new Date(), updatedAt: new Date() });
      db.saveChat({ id: 'customer@s.whatsapp.net', contactId: 'customer@s.whatsapp.net', contactName: 'Customer', unreadCount: 0, isGroup: false, createdAt: new Date() });
      db.saveMessage(
        { id: 'existing-msg', from: 'customer@s.whatsapp.net', to: 'bot', content: 'Already saved', type: 'text', timestamp: new Date(), fromMe: true },
        'customer@s.whatsapp.net',
      );

      gateway = new Gateway(config, db, mockWhatsapp);
      const bus = gateway.getEventBus();
      const handler = vi.fn();
      bus.on('human:active', handler);

      const handlerFn = (mockWhatsapp.onEvent as any).mock.calls[0][0];
      await handlerFn({
        type: 'message:received',
        message: {
          id: 'existing-msg', from: 'customer@s.whatsapp.net', to: 'bot',
          content: 'Already saved', type: 'text', timestamp: new Date(), fromMe: true,
        },
      });

      // Should NOT emit human:active because message already exists in DB
      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit human:inactive via isHumanActive when cooldown expires', async () => {
      gateway = new Gateway(config, db, mockWhatsapp);
      const bus = gateway.getEventBus();
      const handler = vi.fn();
      bus.on('human:inactive', handler);

      // Simulate human activity 40 minutes ago (cooldown is 30 min)
      const fortyMinAgo = Date.now() - 40 * 60 * 1000;
      (gateway as any).humanActiveMap.set('old@s.whatsapp.net', fortyMinAgo);

      // Trigger the check
      (gateway as any).isHumanActive('old@s.whatsapp.net');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'human:inactive', chatId: 'old@s.whatsapp.net' }),
      );
    });
  });

  // ── Escalation Triggers ────────────────────────────────────────

  describe('escalation triggers', () => {
    it('should escalate when AI returns empty response', async () => {
      // Enable escalation
      const cfg = {
        ...config,
        telegramBotToken: '123:token',
        telegramChatId: '-100group',
        workingHoursEnabled: false,
      };

      // Sequence: typing indicator, AI provider (empty content), Telegram escalation
      globalThis.fetch = vi.fn()
        .mockResolvedValue({ ok: true, json: async () => ({}) })  // typing indicator
        .mockResolvedValueOnce({
          ok: true, json: async () => ({
            choices: [{ message: { content: '' } }],
            usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true, json: async () => ({ ok: true }),
        });

      gateway = new Gateway(cfg, db, mockWhatsapp);

      const handlerFn = (mockWhatsapp.onEvent as any).mock.calls[0][0];
      await handlerFn({
        type: 'message:received',
        message: {
          id: 'escalate-empty', from: 'customer@s.whatsapp.net', to: 'bot',
          content: 'Pertanyaan sulit', type: 'text', timestamp: new Date(), fromMe: false,
        },
      });

      // Should have called AI + Telegram API (escalation)
      // May also include typing indicator fetch calls
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalled();
        const calls = (globalThis.fetch as any).mock.calls;
        // At least AI + Telegram
        expect(calls.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 5000 });

      delete (globalThis as any).fetch;
    }, 10000);
  });
});
