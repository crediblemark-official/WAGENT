import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Gateway, WhatsAppAdapter, DashboardAdapter } from './gateway.js';
import { Database } from './storage.js';
import { WAgentConfig, Message, Contact, ConnectionStatus, GatewayEvent } from './types.js';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// ── Mock Helpers ───────────────────────────────────────────────

/**
 * Create a mock WhatsApp adapter with tracked calls for assertions.
 */
interface MockWhatsAppCalls {
  sendPresenceUpdate: string[];
  readMessages: boolean[];
  sendMessage: { to: string; content: string }[];
}

/**
 * Create a mock WhatsApp adapter with tracked calls for assertions.
 */
function createMockWhatsapp(overrides: Partial<WhatsAppAdapter> = {}): WhatsAppAdapter {
  const calls: MockWhatsAppCalls = { sendPresenceUpdate: [], readMessages: [], sendMessage: [] };

  const adapter = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockImplementation(async (to: string, content: string) => {
      calls.sendMessage.push({ to, content });
      return {
        id: `sent-${Date.now()}`,
        from: 'bot',
        to,
        content,
        type: 'text',
        timestamp: new Date(),
        fromMe: true,
      } as Message;
    }),
    getConnectionStatus: vi.fn().mockReturnValue('connected' as ConnectionStatus),
    getContacts: vi.fn().mockResolvedValue([] as Contact[]),
    isConnected: vi.fn().mockReturnValue(true),
    onEvent: vi.fn(),
    sendPresenceUpdate: vi.fn().mockImplementation(async (type: string) => {
      calls.sendPresenceUpdate.push(type);
    }),
    readMessages: vi.fn().mockImplementation(async () => {
      calls.readMessages.push(true);
    }),
    userJid: '62812bot@s.whatsapp.net',
    ...overrides,
  };

  // Attach calls tracker for test assertions
  (adapter as any).calls = calls;
  return adapter;
}

/**
 * Mock fetch to return a controlled AI response.
 */
function mockAIResponse(content: string, toolCalls?: any[]) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{
        message: { content, tool_calls: toolCalls },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });
}

/**
 * Build a minimal valid config for testing.
 */
function createTestConfig(dbPath: string): WAgentConfig {
  return {
    whatsappSessionName: 'e2e-test',
    aiProvider: 'openai',
    systemPrompt: 'Kamu adalah customer service yang ramah.',
    dashboardPort: 3030,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: dbPath,
    openai: { apiKey: 'sk-test', model: 'gpt-4o-mini' },
    // Enable all features for testing
    welcomeMessageEnabled: true,
    welcomeMessage: 'Halo! Ada yang bisa saya bantu?',
    conversationTimeoutHours: 0, // disable
    rateLimitMax: 5,
    rateLimitWindowSeconds: 10,
    groupChatEnabled: true,
    groupChatReplyIfMentioned: false,
    workingHoursEnabled: false,
    humanTakeoverCooldownMinutes: 30,
  };
}

/**
 * Create a test customer message.
 */
function customerMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}`,
    from: '62812345678@s.whatsapp.net',
    to: 'bot@wa.net',
    content: 'Halo, ada yang bisa saya bantu?',
    type: 'text',
    timestamp: new Date(),
    fromMe: false,
    ...overrides,
  };
}

/**
 * Create a test human reply message (fromMe: true, not from bot).
 */
function humanReplyMessage(jid?: string): Message {
  return {
    id: `human-${Date.now()}`,
    from: jid || '62812345678@s.whatsapp.net',
    to: 'customer@wa.net',
    content: 'Baik, saya bantu ya Kak!',
    type: 'text',
    timestamp: new Date(),
    fromMe: true, // sent from this WhatsApp number
    metadata: { pushName: 'Human Agent' },
  };
}

// ── E2E Tests ──────────────────────────────────────────────────

describe('E2E: WhatsApp Natural Behavior', () => {
  let db: Database;
  let mockWhatsapp: ReturnType<typeof createMockWhatsapp>;
  let gateway: Gateway;
  let config: WAgentConfig;
  let TEST_DB: string;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wagent-e2e-'));
    TEST_DB = join(dir, 'test.db');
    db = new Database(TEST_DB);
    config = createTestConfig(TEST_DB);

    vi.resetAllMocks();
    mockWhatsapp = createMockWhatsapp();
    globalThis.fetch = mockAIResponse('Halo! Ada yang bisa saya bantu hari ini? 😊');

    // Ensure contact exists for FK
    db.saveContact({
      id: '62812345678@s.whatsapp.net', name: 'Budi',
      number: '62812345678', isGroup: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    try { await gateway.stop(); } catch { /* ignore */ }
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    try { rmdirSync(dir); } catch { /* ignore */ }
  });

  // ── 1. Basic Message Flow ──────────────────────────────────

  it('should complete full message flow: read → typing → delay → AI → response', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();

    const msg = customerMessage();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];
    await handler({ type: 'message:received', message: msg });

    // 1. Message should be marked as read
    expect(mockWhatsapp.calls.readMessages.length).toBeGreaterThanOrEqual(1);

    // 2. Typing indicator (composing) should be sent
    const presenceCalls = mockWhatsapp.calls.sendPresenceUpdate;
    expect(presenceCalls.some((p: string) => p === 'composing')).toBe(true);

    // 3. AI should process and send response
    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(1);
    }, { timeout: 5000 });

    const sentMsg = mockWhatsapp.calls.sendMessage[0];
    expect(sentMsg.to).toBe('62812345678@s.whatsapp.net');
    expect(sentMsg.content).toContain('Halo');

    // 4. Typing should stop (paused after response)
    expect(presenceCalls.some((p: string) => p === 'paused')).toBe(true);

    // 5. Chat should be created in DB
    const chat = db.getChat('62812345678@s.whatsapp.net');
    expect(chat).toBeDefined();
    expect(chat?.lastMessage).toContain('Halo');
  }, 10000);

  it('should send typing indicator on every message', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);

    // Mock a simple response that's short enough for post-delay
    globalThis.fetch = mockAIResponse('OK!');
    await gateway.start();

    const handler = mockWhatsapp.onEvent.mock.calls[0][0];
    await handler({ type: 'message:received', message: customerMessage() });

    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendPresenceUpdate.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 5000 });

    const updates = mockWhatsapp.calls.sendPresenceUpdate;
    expect(updates[0]).toBe('composing');
    expect(updates[updates.length - 1]).toBe('paused');
  }, 10000);

  it('should skip processing for fromMe messages', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();

    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    // Send a fromMe: true message (bot's own message)
    await handler({
      type: 'message:received',
      message: customerMessage({ fromMe: true, content: 'Test echo' }),
    });

    // Should NOT send any response
    expect(mockWhatsapp.calls.sendMessage.length).toBe(0);
  });

  // ── 2. Human Takeover ──────────────────────────────────────

  it('should detect human reply and pause AI', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    // Customer sends a message
    await handler({ type: 'message:received', message: customerMessage() });

    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(1);
    }, { timeout: 5000 });

    // Human replies from WhatsApp Web
    await handler({
      type: 'message:received',
      message: humanReplyMessage(),
    });

    // Customer sends another message — AI should skip it
    const msgBefore = mockWhatsapp.calls.sendMessage.length;
    await handler({
      type: 'message:received',
      message: customerMessage({ content: 'Lanjutan', id: 'msg-lanjutan' }),
    });

    // Wait briefly — no AI response should come
    await new Promise(r => setTimeout(r, 500));
    expect(mockWhatsapp.calls.sendMessage.length).toBe(msgBefore);
  }, 10000);

  it('should emit human:active event on human reply', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];
    const eventBus = gateway.getEventBus();

    let receivedEvent: any = null;
    eventBus.on('human:active', (e: any) => { receivedEvent = e; });

    await handler({
      type: 'message:received',
      message: humanReplyMessage(),
    });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent.type).toBe('human:active');
    expect(receivedEvent.chatId).toBe('62812345678@s.whatsapp.net');
  });

  // ── 3. Rate Limiting ───────────────────────────────────────

  it('should rate limit rapid messages', async () => {
    config.rateLimitMax = 3;
    config.rateLimitWindowSeconds = 60;
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    // Send 3 messages (under limit) — each has ~3-8s delay from natural behavior
    for (let i = 0; i < 3; i++) {
      await handler({
        type: 'message:received',
        message: customerMessage({ content: `Pesan ${i}`, id: `rate-${i}` }),
      });
    }

    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(3);
    }, { timeout: 30000 });

    // 4th message should be rate limited
    await handler({
      type: 'message:received',
      message: customerMessage({ content: 'Spam', id: 'rate-spam' }),
    });

    // Should get rate limit message, not AI response
    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(4);
    }, { timeout: 5000 });

    const lastMsg = mockWhatsapp.calls.sendMessage[3];
    expect(lastMsg.content).toContain('Mohon tunggu');
  }, 60000);

  // ── 4. Working Hours ───────────────────────────────────────

  it('should send offline message outside working hours', async () => {
    // Set working hours to a range that NEVER matches (start > end means always outside)
    config.workingHoursEnabled = true;
    config.workingHoursStart = '00:01';
    config.workingHoursEnd = '00:00'; // Impossible range: 1 minute after midnight to midnight
    config.offlineMessage = 'Mohon maaf, di luar jam operasional 🙏';
    gateway = new Gateway(config, db, mockWhatsapp);

    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    await handler({
      type: 'message:received',
      message: customerMessage(),
    });

    // Should send offline message immediately (no AI processing, no delays)
    expect(mockWhatsapp.calls.sendMessage.length).toBe(1);
    const msg = mockWhatsapp.calls.sendMessage[0];
    expect(msg.content).toContain('jam operasional');
  });

  // ── 5. Group Chat ──────────────────────────────────────────

  it('should process group messages when enabled', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    await handler({
      type: 'message:received',
      message: customerMessage({
        from: '123-group@g.us',
        content: 'Halo semua!',
      }),
    });

    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(1);
    }, { timeout: 5000 });

    expect(mockWhatsapp.calls.sendMessage[0].to).toBe('123-group@g.us');
  }, 10000);

  it('should skip group messages when not @mentioned', async () => {
    config.groupChatReplyIfMentioned = true;
    gateway = new Gateway(config, db, mockWhatsapp);
    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    // Group message without @mention — should skip
    await handler({
      type: 'message:received',
      message: customerMessage({
        from: '123-group@g.us',
        content: 'Halo semua!',
        metadata: { mentionedJid: [] },
      }),
    });

    // Wait a bit — should be no response
    await new Promise(r => setTimeout(r, 300));
    expect(mockWhatsapp.calls.sendMessage.length).toBe(0);
  });

  // ── 6. Welcome Message ─────────────────────────────────────

  it('should inject welcome context for new conversations', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);

    // Track what the AI receives
    let capturedMessages: any[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      const body = JSON.parse(options.body);
      capturedMessages = body.messages;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Selamat datang! 😊' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      };
    });

    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    await handler({
      type: 'message:received',
      message: customerMessage({ content: 'Halo', id: 'new-chat-1' }),
    });

    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(1);
    }, { timeout: 5000 });

    // The last user message should contain welcome context
    const userMsg = capturedMessages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain('PELANGGAN BARU');
    expect(userMsg.content).toContain('Sambut dengan hangat');
  }, 10000);

  it('should NOT inject welcome for returning chats', async () => {
    // Pre-seed a conversation history
    db.addConversation('62812345678@s.whatsapp.net', 'user', 'Halo sebelumnya');
    db.addConversation('62812345678@s.whatsapp.net', 'assistant', 'Halo juga!');

    gateway = new Gateway(config, db, mockWhatsapp);

    let capturedMessages: any[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      const body = JSON.parse(options.body);
      capturedMessages = body.messages;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Iya, ada yang bisa dibantu?' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      };
    });

    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    await handler({
      type: 'message:received',
      message: customerMessage({ content: 'Masih ada yang mau ditanya', id: 'return-chat' }),
    });

    await vi.waitFor(() => {
      expect(mockWhatsapp.calls.sendMessage.length).toBe(1);
    }, { timeout: 5000 });

    // Should NOT contain welcome context
    const userMsg = capturedMessages.find((m: any) => m.role === 'user');
    expect(userMsg.content).not.toContain('PELANGGAN BARU');
  }, 10000);

  // ── 7. AI Error → Escalation ──────────────────────────────

  it('should handle AI errors gracefully and still save message', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);

    // Force AI to error
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('API timeout'));

    await gateway.start();
    const handler = mockWhatsapp.onEvent.mock.calls[0][0];

    await handler({
      type: 'message:received',
      message: customerMessage({ content: 'Test error', id: 'err-msg' }),
    });

    // Wait for processing
    await new Promise(r => setTimeout(r, 1000));

    // Message should still be saved to DB even though AI errored
    const msgs = db.getMessages('62812345678@s.whatsapp.net');
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].content).toBe('Test error');
  }, 10000);

  // ── 8. Knowledge Base Tool ─────────────────────────────────

  it('should have search_knowledge_base tool available', async () => {
    gateway = new Gateway(config, db, mockWhatsapp);
    const tools = gateway.getAgent().getTools();
    const kbTool = tools.find(t => t.name === 'search_knowledge_base');
    expect(kbTool).toBeDefined();
    expect(kbTool?.description).toContain('knowledge base');

    // Test the tool returns proper results with some KB data
    db.createKnowledgeEntry({
      id: 'kb-test-1', category: 'produk',
      question: 'Berapa harga?', answer: 'Rp 50.000',
      keywords: ['harga', 'produk'], tags: [],
      priority: 1, createdAt: new Date(), updatedAt: new Date(),
    });

    const result = await kbTool!.handler(
      { query: 'harga produk' },
      { logger: { info: vi.fn() } as any, db, config, contactId: 'test' } as any,
    );

    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.results[0].answer).toBe('Rp 50.000');
  });

  // ── 9. Conversation Timeout ────────────────────────────────

  it('should clear stale conversations', async () => {
    // Add old conversation entry
    db.addConversation('62812345678@s.whatsapp.net', 'user', 'Pesan lama');

    // The existing entry was just created (now), so we need to manually update it
    // to make it look stale. Direct SQL manipulation since the DB is internal.
    const dbAny = (db as any);
    dbAny.db.prepare(
      "UPDATE conversations SET created_at = datetime('now', '-25 hours') WHERE contact_id = ?"
    ).run('62812345678@s.whatsapp.net');

    const staleContacts = db.getStaleConversationContacts(24);
    expect(staleContacts).toContain('62812345678@s.whatsapp.net');

    const cleared = db.clearStaleConversations(24);
    expect(cleared).toBe(1);

    const history = db.getConversationHistory('62812345678@s.whatsapp.net');
    expect(history.length).toBe(0);
  });

  // ── 10. Dashboard Integration ──────────────────────────────

  it('should forward events to dashboard via event bus', async () => {
    const mockDashboard: DashboardAdapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      broadcast: vi.fn(),
    };

    gateway = new Gateway(config, db, mockWhatsapp, mockDashboard);
    await gateway.start();

    const handler = mockWhatsapp.onEvent.mock.calls[0][0];
    await handler({
      type: 'message:received',
      message: customerMessage(),
    });

    await vi.waitFor(() => {
      // Dashboard should receive the incoming message event
      const broadcasts = (mockDashboard.broadcast as any).mock.calls;
      const msgEvent = broadcasts.find((c: any) => c[0].type === 'message:received');
      expect(msgEvent).toBeDefined();
    }, { timeout: 5000 });
  }, 10000);
});
