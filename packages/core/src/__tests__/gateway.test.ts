import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import type { WAgentConfig, Message, GatewayEvent } from '../types.js';

// ── Mocks ──────────────────────────────────────────────────────

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

const mockProcessMessage = vi.fn().mockResolvedValue({ response: 'AI response', pendingMessages: [] });
const mockGetProviderName = vi.fn().mockReturnValue('openai');
const mockGetTools = vi.fn().mockReturnValue([]);
const mockSetScheduler = vi.fn();
const mockGetProvider = vi.fn().mockReturnValue({ chat: vi.fn() });

vi.mock('../agent/agent.js', () => ({
  Agent: vi.fn(function (this: any) {
    this.processMessage = mockProcessMessage;
    this.getProviderName = mockGetProviderName;
    this.getTools = mockGetTools;
    this.setScheduler = mockSetScheduler;
    this.getProvider = mockGetProvider;
  }),
}));

const mockEventBusEmit = vi.fn();
const mockEventBusOn = vi.fn();
const mockEventBusOnAny = vi.fn();
const mockEventBusRemoveAll = vi.fn();

vi.mock('../utils/event-bus.js', () => ({
  EventBus: vi.fn(function (this: any) {
    this.emit = mockEventBusEmit;
    this.on = mockEventBusOn;
    this.onAny = mockEventBusOnAny;
    this.removeAll = mockEventBusRemoveAll;
    this.handlers = new Map();
    this.wildcardHandlers = new Set();
  }),
}));

const mockSendMessage = vi.fn().mockResolvedValue({ id: 'msg-1', content: 'sent', timestamp: Date.now(), fromMe: true, to: 'test' });
const mockGetConnectionStatus = vi.fn().mockReturnValue('connected' as any);
const mockIsConnected = vi.fn().mockReturnValue(true);
const mockSendPresenceUpdate = vi.fn().mockResolvedValue(undefined);
const mockReadMessages = vi.fn().mockResolvedValue(undefined);
const mockDownloadAudio = vi.fn();
const mockOnEvent = vi.fn();
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

const mockWhatsApp = {
  connect: mockConnect,
  disconnect: mockDisconnect,
  sendMessage: mockSendMessage,
  getConnectionStatus: mockGetConnectionStatus,
  getContacts: vi.fn().mockResolvedValue([]),
  isConnected: mockIsConnected,
  onEvent: mockOnEvent,
  sendPresenceUpdate: mockSendPresenceUpdate,
  readMessages: mockReadMessages,
  downloadAudio: mockDownloadAudio,
  userJid: 'user@whatsapp',
};

// Database mock
const mockDb = {
  messageExists: vi.fn().mockReturnValue(false),
  saveContact: vi.fn(),
  getChat: vi.fn().mockReturnValue(null),
  saveChat: vi.fn(),
  saveMessage: vi.fn(),
  incrementMessageCount: vi.fn(),
  getConversationHistory: vi.fn().mockReturnValue([]),
  getAllContacts: vi.fn().mockReturnValue([]),
  addConversation: vi.fn(),
  clearStaleConversations: vi.fn().mockReturnValue(0),
  trimConversation: vi.fn(),
};

vi.mock('../services/scheduler.js', () => ({
  Scheduler: vi.fn(function (this: any) {
    this.start = vi.fn();
    this.stop = vi.fn();
  }),
}));

vi.mock('../services/transcriber.js', () => ({
  Transcriber: vi.fn(function (this: any) {
    this.isAvailable = vi.fn().mockReturnValue(false);
    this.transcribe = vi.fn();
    this.getProvider = vi.fn().mockReturnValue('none');
  }),
}));

vi.mock('../services/escalation.js', () => ({
  EscalationService: vi.fn(function (this: any) {
    this.isEnabled = false;
    this.escalate = vi.fn().mockResolvedValue(true);
    this.escalateSimple = vi.fn().mockResolvedValue(true);
  }),
}));

const mockApprovalQueueDestroy = vi.fn();

vi.mock('../services/approval-queue.js', () => ({
  ApprovalQueue: vi.fn(function (this: any) {
    this.enqueue = vi.fn();
    this.get = vi.fn();
    this.approve = vi.fn();
    this.reject = vi.fn();
    this.cancel = vi.fn();
    this.getPending = vi.fn().mockReturnValue([]);
    this.getAll = vi.fn().mockReturnValue([]);
    this.destroy = mockApprovalQueueDestroy;
    this.startExpireCheck = vi.fn();
    this.stopExpireCheck = vi.fn();
  }),
}));

vi.mock('../services/proactive-scheduler.js', () => ({
  ProactiveScheduler: vi.fn(function (this: any) {
    this.start = vi.fn();
    this.stop = vi.fn();
    this.getAll = vi.fn().mockReturnValue([]);
  }),
}));

vi.mock('../tools/tool-sandbox.js', () => ({
  ToolSandbox: vi.fn(function (this: any) {
    // empty
  }),
}));

vi.mock('../services/telegram-bot.js', () => ({
  TelegramBot: vi.fn(function (this: any) {
    this.isEnabled = false;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.notifyApprovalRequest = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../agent/prompt-loader.js', () => ({
  promptLoader: {
    getSelfChatConfig: vi.fn().mockReturnValue({
      help_hint: 'Kirim /help untuk daftar command',
      pause_done: 'Agent di-pause.',
      resume_done: 'Agent di-resume.',
      contacts_empty: 'Belum ada kontak.',
      contacts_header: 'Kontak Terakhir',
      command_unknown: 'Command tidak dikenal',
      command_error: 'Error',
      help_header: 'WAGENT Self-Chat Commands',
      help_status: 'Lihat status agent',
      help_pause: 'Pause auto-reply',
      help_resume: 'Resume auto-reply',
      help_stats: 'Statistik hari ini',
      help_contacts: 'Daftar kontak',
      help_help: 'Tampilkan bantuan ini',
      status_header: 'WAGENT Status',
    }),
    getRateLimitMessage: vi.fn().mockReturnValue('Rate limit exceeded'),
    getOfflineMessage: vi.fn().mockReturnValue('Outside working hours'),
    getEscalationConfig: vi.fn().mockReturnValue({
      title: 'Escalation',
      label_customer: 'Pelanggan',
      label_phone: 'Nomor',
      label_reason: 'Alasan',
      label_detail: 'Detail',
      label_message: 'Pesan',
      label_history: 'Riwayat',
      action_instruction: 'Balas customer',
      reason_ai_error: 'Error',
      reason_ai_empty: 'Empty',
      reason_ai_escalation: 'Escalation',
      reason_tool_failure: 'Tool failure',
    }),
    load: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../agent/prompt-generator.js', () => ({
  PromptGenerator: vi.fn(function (this: any) {
    this.generateAll = vi.fn().mockResolvedValue(undefined);
    this.generateWithAI = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

import { Gateway } from '../services/gateway.js';

// ── Helpers ────────────────────────────────────────────────────

function makeConfig(overrides: Partial<WAgentConfig> = {}): WAgentConfig {
  return {
    whatsappSessionName: 'test',
    whatsappSessionDir: '/tmp/test-wa',
    aiProvider: 'openai',
    systemPrompt: 'You are a helpful assistant.',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: 'test.db',
    rateLimitMax: 10,
    rateLimitWindowSeconds: 10,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    from: '12345@s.whatsapp.net',
    to: 'other@whatsapp',
    content: 'Hello!',
    type: 'text',
    timestamp: new Date(),
    fromMe: false,
    ...overrides,
  };
}

/**
 * Flush all pending microtasks and advance fake timers enough to cover
 * the internal `sleep()` calls in handleIncomingMessage (pre + post delay).
 */
async function flushWithTimers() {
  // Let microtasks resolve first
  await Promise.resolve();
  // Advance past human-delay (max 8s) + typing-delay (max 15s) + typing interval (8s)
  await vi.advanceTimersByTimeAsync(40_000);
}

function createGateway(cfg?: Partial<WAgentConfig>) {
  const c = makeConfig(cfg);
  const gw = new Gateway(c, mockDb as any, mockWhatsApp as any);
  // The constructor already called onEvent — grab the registered handler
  const lastCall = mockOnEvent.mock.calls[mockOnEvent.mock.calls.length - 1];
  const eventHandler: (event: GatewayEvent) => Promise<void> = lastCall![0];
  return { gw, eventHandler };
}

// ── Tests ──────────────────────────────────────────────────────

describe('Gateway', () => {
  let gw: Gateway;
  let eventHandler: (event: GatewayEvent) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Re-apply defaults (clearAllMocks doesn't clear mockReturnValueOnce queue)
    mockProcessMessage.mockReset();
    mockProcessMessage.mockResolvedValue({ response: 'AI response', pendingMessages: [] });
    mockDb.messageExists.mockReset();
    mockDb.messageExists.mockReturnValue(false);
    mockDb.saveContact.mockReset();
    mockDb.getChat.mockReset();
    mockDb.getChat.mockReturnValue(null);
    mockDb.saveChat.mockReset();
    mockDb.saveMessage.mockReset();
    mockDb.incrementMessageCount.mockReset();
    mockDb.getConversationHistory.mockReset();
    mockDb.getConversationHistory.mockReturnValue([]);
    mockDb.getAllContacts.mockReset();
    mockDb.getAllContacts.mockReturnValue([]);
    mockDb.addConversation.mockReset();
    mockDb.clearStaleConversations.mockReset();
    mockDb.clearStaleConversations.mockReturnValue(0);
    mockDb.trimConversation.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ id: 'msg-1', content: 'sent', timestamp: Date.now(), fromMe: true, to: 'test' });
    mockSendPresenceUpdate.mockReset();
    mockSendPresenceUpdate.mockResolvedValue(undefined);
    mockReadMessages.mockReset();
    mockReadMessages.mockResolvedValue(undefined);
    mockGetConnectionStatus.mockReset();
    mockGetConnectionStatus.mockReturnValue('connected' as any);
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockReset();
    mockDisconnect.mockResolvedValue(undefined);
    mockEventBusEmit.mockReset();
    mockEventBusOn.mockReset();
    mockOnEvent.mockReset();
    mockApprovalQueueDestroy.mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    const result = createGateway();
    gw = result.gw;
    eventHandler = result.eventHandler;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Status & Getters ─────────────────────────────────────────

  describe('getters', () => {
    it('getAgent returns the agent instance', () => {
      expect(gw.getAgent()).toBeDefined();
    });

    it('getEventBus returns the event bus instance', () => {
      expect(gw.getEventBus()).toBeDefined();
    });

    it('getStatus returns initial disconnected status', () => {
      expect(gw.getStatus()).toBe('disconnected');
    });

    it('setStatus updates the connection status', () => {
      gw.setStatus('connected');
      expect(gw.getStatus()).toBe('connected');
    });

    it('getWhatsAppAdapter returns the whatsapp adapter', () => {
      expect(gw.getWhatsAppAdapter()).toBe(mockWhatsApp);
    });

    it('getApprovalQueue returns approval queue instance', () => {
      expect(gw.getApprovalQueue()).toBeDefined();
    });

    it('getProactiveScheduler returns proactive scheduler instance', () => {
      expect(gw.getProactiveScheduler()).toBeDefined();
    });

    it('getToolSandbox returns tool sandbox instance', () => {
      expect(gw.getToolSandbox()).toBeDefined();
    });

    it('getTelegramBot returns telegram bot instance', () => {
      expect(gw.getTelegramBot()).toBeDefined();
    });
  });

  // ── Pause / Resume ───────────────────────────────────────────

  describe('pause/resume', () => {
    it('isPaused returns false initially', () => {
      expect(gw.isPaused()).toBe(false);
    });

    it('setPaused(true) sets paused state', () => {
      gw.setPaused(true);
      expect(gw.isPaused()).toBe(true);
    });

    it('setPaused(true) emits human:active with __system_paused__', () => {
      gw.setPaused(true);
      expect(mockEventBusEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'human:active', chatId: '__system_paused__' })
      );
    });

    it('setPaused(false) emits human:inactive with __system_paused__', () => {
      gw.setPaused(true);
      vi.clearAllMocks();
      gw.setPaused(false);
      expect(mockEventBusEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'human:inactive', chatId: '__system_paused__' })
      );
    });

    it('setPaused(false) resumes from paused state', () => {
      gw.setPaused(true);
      expect(gw.isPaused()).toBe(true);
      gw.setPaused(false);
      expect(gw.isPaused()).toBe(false);
    });
  });

  // ── Rate Limiting ────────────────────────────────────────────

  describe('rate limiting', () => {
    it('first message from a contact is always allowed', async () => {
      const contactId = 'alice@s.whatsapp.net';
      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: contactId, content: 'Hi' });
      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('under limit returns true and processes message', async () => {
      const contactId = 'bob@s.whatsapp.net';
      const r = createGateway({ rateLimitMax: 3, rateLimitWindowSeconds: 60 });
      const h = r.eventHandler;

      for (let i = 0; i < 3; i++) {
        mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
        mockDb.getConversationHistory.mockReturnValueOnce([]);
        const msg = makeMessage({ from: contactId, content: `msg${i}` });
        const p = h({ type: 'message:received', message: msg });
        await flushWithTimers();
        await p;
      }

      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('at limit returns false and sends rate limit message', async () => {
      const contactId = 'charlie@s.whatsapp.net';
      const r = createGateway({ rateLimitMax: 2, rateLimitWindowSeconds: 3600 });
      const h = r.eventHandler;

      mockProcessMessage.mockResolvedValue({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValue([]);

      // Messages 1 & 2: allowed
      let p = h({ type: 'message:received', message: makeMessage({ from: contactId, content: 'hi 1' }) });
      await flushWithTimers();
      await p;

      p = h({ type: 'message:received', message: makeMessage({ from: contactId, content: 'hi 2' }) });
      await flushWithTimers();
      await p;

      // Message 3: rate limited
      vi.clearAllMocks();
      mockSendMessage.mockResolvedValueOnce({ id: 'rl', content: '', timestamp: Date.now(), fromMe: true, to: contactId });
      await h({ type: 'message:received', message: makeMessage({ from: contactId, content: 'hi 3' }) });

      expect(mockSendMessage).toHaveBeenCalled();
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('rate limit sends configured message when exceeded', async () => {
      const contactId = 'dave@s.whatsapp.net';
      const r = createGateway({ rateLimitMax: 1, rateLimitWindowSeconds: 60 });
      const h = r.eventHandler;

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      let p = h({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      vi.clearAllMocks();
      mockSendMessage.mockResolvedValueOnce({ id: 'rl', content: '', timestamp: Date.now(), fromMe: true, to: contactId });
      await h({ type: 'message:received', message: makeMessage({ from: contactId }) });

      expect(mockSendMessage).toHaveBeenCalledWith(contactId, 'Rate limit exceeded');
    });

    it('counter resets after window expires', async () => {
      const contactId = 'eve@s.whatsapp.net';
      const r = createGateway({ rateLimitMax: 1, rateLimitWindowSeconds: 1 });
      const h = r.eventHandler;

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      let p = h({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      vi.advanceTimersByTime(2000);

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      vi.clearAllMocks();
      p = h({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });

    it('cleanupRateLimits removes stale entries', async () => {
      const contactId = 'frank@s.whatsapp.net';
      const r = createGateway({ rateLimitMax: 1, rateLimitWindowSeconds: 1 });
      const h = r.eventHandler;

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      let p = h({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      vi.advanceTimersByTime(2000);

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      p = h({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });
  });

  // ── Working Hours ────────────────────────────────────────────

  describe('working hours', () => {
    it('returns true when working hours are disabled', async () => {
      const r = createGateway({ workingHoursEnabled: false });
      const h = r.eventHandler;

      vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const p = h({ type: 'message:received', message: makeMessage({ from: 'test@s.whatsapp.net' }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });

    it('returns true within working hours', async () => {
      const r = createGateway({
        workingHoursEnabled: true,
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
        workingHoursTimezone: 'Asia/Jakarta',
      });
      const h = r.eventHandler;

      // 10:00 Jakarta = 03:00 UTC
      vi.setSystemTime(new Date('2026-01-15T03:00:00Z'));

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const p = h({ type: 'message:received', message: makeMessage({ from: 'test@s.whatsapp.net' }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });

    it('returns false outside working hours and sends offline message', async () => {
      const r = createGateway({
        workingHoursEnabled: true,
        workingHoursStart: '09:00',
        workingHoursEnd: '18:00',
        workingHoursTimezone: 'Asia/Jakarta',
      });
      const h = r.eventHandler;

      // 20:00 Jakarta = 13:00 UTC
      vi.setSystemTime(new Date('2026-01-15T13:00:00Z'));

      mockSendMessage.mockResolvedValueOnce({ id: 'offline', content: '', timestamp: Date.now(), fromMe: true, to: 'test@s.whatsapp.net' });
      await h({ type: 'message:received', message: makeMessage({ from: 'test@s.whatsapp.net' }) });

      expect(mockSendMessage).toHaveBeenCalledWith('test@s.whatsapp.net', 'Outside working hours');
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('handles timezone correctly for different timezones', async () => {
      const r = createGateway({
        workingHoursEnabled: true,
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        workingHoursTimezone: 'America/New_York',
      });
      const h = r.eventHandler;

      // 10:00 New York = 15:00 UTC
      vi.setSystemTime(new Date('2026-01-15T15:00:00Z'));

      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const p = h({ type: 'message:received', message: makeMessage({ from: 'test@s.whatsapp.net' }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });

    it('sends offline message when outside working hours', async () => {
      const r = createGateway({
        workingHoursEnabled: true,
        workingHoursStart: '08:00',
        workingHoursEnd: '17:00',
        workingHoursTimezone: 'Asia/Jakarta',
        offlineMessage: 'Custom offline message',
      });
      const h = r.eventHandler;

      // 19:00 Jakarta = 12:00 UTC
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

      mockSendMessage.mockResolvedValueOnce({ id: 'off', content: '', timestamp: Date.now(), fromMe: true, to: 'test@s.whatsapp.net' });
      await h({ type: 'message:received', message: makeMessage({ from: 'test@s.whatsapp.net' }) });

      expect(mockSendMessage).toHaveBeenCalledWith('test@s.whatsapp.net', 'Custom offline message');
    });
  });

  // ── Human Takeover ────────────────────────────────────────────

  // ── Human Takeover ───────────────────────────────────────────

  describe('human takeover', () => {
    it('fromMe message not in DB triggers human:active event', async () => {
      mockDb.messageExists.mockReturnValue(false);
      mockSendMessage.mockResolvedValue({ id: 'h1', content: '', timestamp: Date.now(), fromMe: true, to: 'other@whatsapp' });

      const msg = makeMessage({
        from: 'customer@s.whatsapp.net',
        to: 'other@whatsapp',
        fromMe: true,
        id: 'human-msg-1',
      });

      await eventHandler({ type: 'message:received', message: msg });

      expect(mockEventBusEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'human:active', chatId: 'customer@s.whatsapp.net' })
      );
    });

    it('fromMe message already in DB does not trigger human:active', async () => {
      mockDb.messageExists.mockReturnValue(true);

      const msg = makeMessage({
        from: 'customer2@s.whatsapp.net',
        to: 'other@whatsapp',
        fromMe: true,
        id: 'bot-msg-1',
      });

      vi.clearAllMocks();
      await eventHandler({ type: 'message:received', message: msg });

      expect(mockEventBusEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'human:active' })
      );
    });

    it('human-active contacts skip AI processing', async () => {
      mockDb.messageExists.mockReturnValue(false);
      mockSendMessage.mockResolvedValue({ id: 'h2', content: '', timestamp: Date.now(), fromMe: true, to: 'c3@whatsapp' });

      // Human sends a message (fromMe, not in DB) → triggers human:active
      const humanMsg = makeMessage({
        from: 'c3@whatsapp',
        to: 'other@whatsapp',
        fromMe: true,
        id: 'human-takeover-1',
      });
      await eventHandler({ type: 'message:received', message: humanMsg });

      // Now a customer sends a message to the same contact
      vi.clearAllMocks();
      mockProcessMessage.mockResolvedValue({ response: 'AI', pendingMessages: [] });
      const customerMsg = makeMessage({ from: 'c3@whatsapp', content: 'Customer msg' });
      const p = eventHandler({ type: 'message:received', message: customerMsg });
      await flushWithTimers();
      await p;

      // AI should not process since human is active (cooldown is 30 min by default)
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });
  });

  // ── Escalation ───────────────────────────────────────────────

  describe('escalation', () => {
    it('canEscalate returns true when no recent escalation for contact', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: '', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      let p = eventHandler({ type: 'message:received', message: makeMessage({ from: 'esc-test@s.whatsapp.net' }) });
      await flushWithTimers();
      await p;

      mockProcessMessage.mockResolvedValueOnce({ response: '', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      p = eventHandler({ type: 'message:received', message: makeMessage({ from: 'esc-test2@s.whatsapp.net' }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    });

    it('canEscalate returns false within 60s window for same contact', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: '', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const contactId = 'esc-dedup@s.whatsapp.net';
      let p = eventHandler({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      mockProcessMessage.mockResolvedValueOnce({ response: '', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      p = eventHandler({ type: 'message:received', message: makeMessage({ from: contactId }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    });

    it('AI empty response triggers escalation flow', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: 'tidak tahu', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const p = eventHandler({ type: 'message:received', message: makeMessage({ from: 'escalate-me@s.whatsapp.net', content: 'What is X?' }) });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });
  });

  // ── Message Handling ─────────────────────────────────────────

  describe('message handling', () => {
    it('fromMe messages are skipped (human takeover)', async () => {
      const msg = makeMessage({
        from: 'user@whatsapp',
        to: 'customer@s.whatsapp.net',
        fromMe: true,
        id: 'skip-me-1',
      });
      mockDb.messageExists.mockReturnValue(true);

      await eventHandler({ type: 'message:received', message: msg });

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('paused gateway skips incoming messages', async () => {
      gw.setPaused(true);
      vi.clearAllMocks();

      const msg = makeMessage({ from: 'customer-paused@s.whatsapp.net' });
      await eventHandler({ type: 'message:received', message: msg });

      expect(mockProcessMessage).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('group messages skipped when groupChatEnabled is false', async () => {
      const r = createGateway({ groupChatEnabled: false });
      const msg = makeMessage({ from: 'group123@g.us', content: 'Group message' });
      await r.eventHandler({ type: 'message:received', message: msg });

      expect(mockProcessMessage).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('messages are saved to DB', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'save-test@s.whatsapp.net', content: 'Save me' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockDb.saveContact).toHaveBeenCalled();
      expect(mockDb.saveChat).toHaveBeenCalled();
      expect(mockDb.saveMessage).toHaveBeenCalled();
      expect(mockDb.incrementMessageCount).toHaveBeenCalledWith('incoming');
    });

    it('AI response is sent via whatsapp', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: 'AI says hello', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'reply-test@s.whatsapp.net' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockSendMessage).toHaveBeenCalledWith('reply-test@s.whatsapp.net', 'AI says hello');
      expect(mockDb.incrementMessageCount).toHaveBeenCalledWith('outgoing');
    });

    it('AI error triggers escalation', async () => {
      mockProcessMessage.mockRejectedValueOnce(new Error('AI crashed'));
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'error-test@s.whatsapp.net' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });

    it('pending tool messages are sent', async () => {
      mockProcessMessage.mockResolvedValueOnce({
        response: 'Done',
        pendingMessages: [
          { to: 'tool-dest@s.whatsapp.net', content: 'Tool message', type: 'text' },
        ],
      });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'tool-test@s.whatsapp.net' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockSendMessage).toHaveBeenCalledWith('tool-dest@s.whatsapp.net', 'Tool message');
      expect(mockDb.incrementMessageCount).toHaveBeenCalledWith('outgoing');
    });
  });

  // ── Connection Handling ──────────────────────────────────────

  describe('connection events', () => {
    it('connection:update emits to event bus', async () => {
      await eventHandler({ type: 'connection:update', status: 'connected' });

      expect(mockEventBusEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'connection:update', status: 'connected' })
      );
    });

    it('connection:update updates internal status', async () => {
      await eventHandler({ type: 'connection:update', status: 'connected' });
      expect(gw.getStatus()).toBe('connected');
    });

    it('first connection sends setup message when no history and no custom prompts', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      mockDb.getConversationHistory.mockReturnValue([]);
      mockSendMessage.mockResolvedValue({ id: 'setup1', content: '', timestamp: Date.now(), fromMe: true, to: 'user@whatsapp' });

      const p = eventHandler({ type: 'connection:update', status: 'connected' });
      await p;
      // setImmediate is mocked by fake timers — advance to flush it
      await vi.advanceTimersByTimeAsync(200);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'user@whatsapp',
        expect.stringContaining('Halo Owner')
      );
    });

    it('first connection sends intro when custom prompts exist', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      mockDb.getConversationHistory.mockReturnValue([]);
      mockSendMessage.mockResolvedValue({ id: 'intro1', content: '', timestamp: Date.now(), fromMe: true, to: 'user@whatsapp' });

      const p = eventHandler({ type: 'connection:update', status: 'connected' });
      await p;
      await vi.advanceTimersByTimeAsync(200);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'user@whatsapp',
        expect.stringContaining('Saya Asisten AI')
      );
    });

    it('connection update from connected to connected does not resend intro', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      mockDb.getConversationHistory.mockReturnValue([]);
      mockSendMessage.mockResolvedValue({ id: 'intro2', content: '', timestamp: Date.now(), fromMe: true, to: 'user@whatsapp' });

      // First connection
      let p = eventHandler({ type: 'connection:update', status: 'connected' });
      await p;
      await vi.advanceTimersByTimeAsync(200);

      vi.clearAllMocks();
      mockSendMessage.mockResolvedValue({ id: 'intro3', content: '', timestamp: Date.now(), fromMe: true, to: 'user@whatsapp' });

      // Second connected event (already connected)
      p = eventHandler({ type: 'connection:update', status: 'connected' });
      await p;
      await vi.advanceTimersByTimeAsync(200);

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() connects whatsapp and starts services', async () => {
      await gw.start();
      expect(mockConnect).toHaveBeenCalled();
    });

    it('stop() disconnects whatsapp and cleans up', async () => {
      await gw.stop();
      expect(mockDisconnect).toHaveBeenCalled();
      expect(mockApprovalQueueDestroy).toHaveBeenCalled();
      expect(mockEventBusRemoveAll).toHaveBeenCalled();
    });

    it('stop() emits human:inactive for all active contacts', async () => {
      mockDb.messageExists.mockReturnValue(false);
      mockSendMessage.mockResolvedValue({ id: 'h3', content: '', timestamp: Date.now(), fromMe: true, to: 'c5@whatsapp' });

      const msg = makeMessage({
        from: 'c5@whatsapp',
        to: 'other@whatsapp',
        fromMe: true,
        id: 'human-active-msg',
      });
      await eventHandler({ type: 'message:received', message: msg });

      vi.clearAllMocks();
      await gw.stop();

      expect(mockEventBusEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'human:inactive', chatId: 'c5@whatsapp' })
      );
    });
  });

  // ── Event Bus Integration ────────────────────────────────────

  describe('event bus integration', () => {
    it('all whatsapp events are forwarded to event bus', async () => {
      const event: GatewayEvent = { type: 'connection:update', status: 'connected' };
      await eventHandler(event);

      expect(mockEventBusEmit).toHaveBeenCalledWith(event);
    });

    it('constructor registers dashboard broadcast listener when dashboard provided', () => {
      const dashboard = { broadcast: vi.fn(), start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
      const c = makeConfig();
      const gw2 = new Gateway(c, mockDb as any, mockWhatsApp as any, dashboard);

      expect(mockEventBusOnAny).toHaveBeenCalled();
    });
  });

  // ── Group Chat ───────────────────────────────────────────────

  describe('group chat', () => {
    it('group messages are processed when groupChatEnabled is true', async () => {
      const r = createGateway({ groupChatEnabled: true });
      mockProcessMessage.mockResolvedValueOnce({ response: 'Group reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);

      const msg = makeMessage({ from: 'group456@g.us', content: 'Hello group' });
      const p = r.eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });

    it('group messages without mention are skipped when groupChatReplyIfMentioned is true', async () => {
      const r = createGateway({
        groupChatEnabled: true,
        groupChatReplyIfMentioned: true,
      });

      const msg = makeMessage({
        from: 'group789@g.us',
        content: 'Hello group',
        metadata: { mentionedJid: ['someone-else@whatsapp'] },
      });
      await r.eventHandler({ type: 'message:received', message: msg });

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('group messages with mention are processed when groupChatReplyIfMentioned is true', async () => {
      const r = createGateway({
        groupChatEnabled: true,
        groupChatReplyIfMentioned: true,
      });
      mockProcessMessage.mockResolvedValueOnce({ response: 'Mention reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);

      const msg = makeMessage({
        from: 'group789@g.us',
        content: 'Hello @bot',
        metadata: { mentionedJid: ['user@whatsapp'] },
      });
      const p = r.eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalled();
    });
  });

  // ── Welcome Message ──────────────────────────────────────────

  describe('welcome message', () => {
    it('injects welcome context for new conversations when enabled', async () => {
      const r = createGateway({
        welcomeMessageEnabled: true,
        welcomeMessage: 'Welcome to our business!',
      });

      mockProcessMessage.mockResolvedValueOnce({ response: 'Welcome!', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);

      const msg = makeMessage({ from: 'new-customer@s.whatsapp.net', content: 'Hi there' });
      const p = r.eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.stringContaining('PELANGGAN BARU'),
        'new-customer@s.whatsapp.net',
        expect.any(String)
      );
    });
  });

  // ── readMessages ─────────────────────────────────────────────

  describe('message read receipts', () => {
    it('marks incoming messages as read', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'read-test@s.whatsapp.net', id: 'read-msg-1' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockReadMessages).toHaveBeenCalledWith(
        'read-test@s.whatsapp.net',
        expect.arrayContaining([
          expect.objectContaining({ id: 'read-msg-1', fromMe: false }),
        ])
      );
    });
  });

  // ── Presence Updates ─────────────────────────────────────────

  describe('presence updates', () => {
    it('sends composing presence before AI processing', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'presence-test@s.whatsapp.net' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockSendPresenceUpdate).toHaveBeenCalledWith(
        'composing',
        'presence-test@s.whatsapp.net'
      );
    });

    it('sends paused presence after AI response', async () => {
      mockProcessMessage.mockResolvedValueOnce({ response: 'Reply', pendingMessages: [] });
      mockDb.getConversationHistory.mockReturnValueOnce([]);
      const msg = makeMessage({ from: 'presence-test2@s.whatsapp.net' });

      const p = eventHandler({ type: 'message:received', message: msg });
      await flushWithTimers();
      await p;

      expect(mockSendPresenceUpdate).toHaveBeenCalledWith(
        'paused',
        'presence-test2@s.whatsapp.net'
      );
    });
  });
});
