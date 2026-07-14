import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EscalationService, EscalationEvent } from './escalation.js';
import type { WAgentConfig } from './types.js';

// ── Helpers ────────────────────────────────────────────────────

/** Create a minimal config, optionally with Telegram settings */
function createConfig(overrides: Partial<WAgentConfig> = {}): WAgentConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'Test',
    dashboardPort: 3030,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
    telegramBotToken: undefined,
    telegramChatId: undefined,
    ...overrides,
  };
}

/** Build a sample escalation event with defaults */
function sampleEvent(overrides: Partial<EscalationEvent> = {}): EscalationEvent {
  return {
    contactId: '62812345678@s.whatsapp.net',
    contactName: 'Budi Santoso',
    customerMessage: 'Saya ingin tahu produk yang tidak ada di katalog',
    reason: 'ai_empty_response',
    ...overrides,
  };
}

/** Mock a successful Telegram API response */
function mockTelegramSuccess() {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true }),
  });
}

/** Mock a Telegram API error response */
function mockTelegramError(status: number = 400) {
  return vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => 'Bad Request: chat not found',
  });
}

/** Mock a network failure */
function mockTelegramNetworkError() {
  return vi.fn().mockRejectedValueOnce(new Error('ETIMEDOUT: connection failed'));
}

// ── Tests ──────────────────────────────────────────────────────

describe('EscalationService — Configuration', () => {
  it('should be disabled when no Telegram config provided', () => {
    const service = new EscalationService(createConfig());
    expect(service.isEnabled).toBe(false);
  });

  it('should be disabled when only bot token is set', () => {
    const service = new EscalationService(createConfig({
      telegramBotToken: '123:abc',
      telegramChatId: undefined,
    }));
    expect(service.isEnabled).toBe(false);
  });

  it('should be disabled when only chat ID is set', () => {
    const service = new EscalationService(createConfig({
      telegramBotToken: undefined,
      telegramChatId: '-123',
    }));
    expect(service.isEnabled).toBe(false);
  });

  it('should be enabled when both token and chat ID are set', () => {
    const service = new EscalationService(createConfig({
      telegramBotToken: '123456:ABC-DEF',
      telegramChatId: '-100123456789',
    }));
    expect(service.isEnabled).toBe(true);
  });


});

describe('EscalationService — Escalate Method', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return false when service is not enabled', async () => {
    globalThis.fetch = mockTelegramSuccess();
    const service = new EscalationService(createConfig());
    const result = await service.escalate(sampleEvent());
    expect(result).toBe(false);
    // fetch should NOT be called since service is disabled
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should POST to Telegram API with correct URL and headers', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: '123456:TOKEN',
      telegramChatId: '-100987654321',
    }));

    await service.escalate(sampleEvent());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123456:TOKEN/sendMessage');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('should include correct chat_id in request body', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: '-100GROUP',
    }));

    await service.escalate(sampleEvent());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_id).toBe('-100GROUP');
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(true);
  });

  it('should format escalation message with all fields', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
      dashboardHost: 'localhost',
      dashboardPort: 3030,
    }));

    await service.escalate(sampleEvent({
      contactId: '62876543210@s.whatsapp.net',
      contactName: 'Siti Rahma',
      customerMessage: 'Barang saya rusak, minta refund',
      reason: 'ai_explicit_escalation',
      details: 'Customer marah',
      conversationHistory: 'User: Halo\nBot: Ada yang bisa dibantu?',
    }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const text: string = body.text;

    // Check HTML tags present
    expect(text).toContain('<b>🚨 ESCALATION');
    expect(text).toContain('<b>👤 Pelanggan:</b>');
    expect(text).toContain('<b>📱 Nomor:</b>');

    // Check phone number extracted correctly (strip @s.whatsapp.net)
    expect(text).toContain('62876543210');

    // Check customer name
    expect(text).toContain('Siti Rahma');

    // Check formatted reason (AI meminta bantuan manusia 🙋)
    expect(text).toContain('AI meminta bantuan manusia');

    // Check details included
    expect(text).toContain('Customer marah');

    // Check customer message
    expect(text).toContain('Barang saya rusak, minta refund');

    // Check conversation history
    expect(text).toContain('User: Halo');

    // Check dashboard link
    expect(text).toContain('http://localhost:3030');
  });

  it('should handle contact without @s.whatsapp.net suffix', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalate(sampleEvent({ contactId: '08123456789' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('08123456789');
  });

  it('should handle group JID (@g.us)', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalate(sampleEvent({ contactId: '123-group@g.us' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('123-group');
    expect(body.text).not.toContain('@g.us');
  });

  it('should escape HTML in customer message', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalate(sampleEvent({
      customerMessage: 'Harga < Rp 100.000 & gratis ongkir > 50km? "promo"',
    }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('Harga &lt; Rp 100.000 &amp; gratis ongkir &gt; 50km? &quot;promo&quot;');
    // Should NOT contain raw HTML
    expect(body.text).not.toContain('< Rp');
    expect(body.text).not.toContain('> 50km');
  });

  it('should truncate long messages (500 chars)', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    const longMessage = 'A'.repeat(1000);
    await service.escalate(sampleEvent({ customerMessage: longMessage }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Should contain first 500 chars
    expect(body.text).toContain('A'.repeat(500));
    // But NOT contain char #501 (should be truncated)
    expect(body.text).not.toContain('A'.repeat(501));
  });

  it('should truncate long conversation history (1000 chars)', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    const longHistory = 'Halo '.repeat(300); // ~1500 chars
    await service.escalate(sampleEvent({ conversationHistory: longHistory }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Should contain first 1000 chars
    expect(body.text).toContain(longHistory.substring(0, 1000));
    // But NOT contain char past 1000
    const thousandChars = longHistory.substring(0, 1000);
    const thousandOneChars = longHistory.substring(0, 1001);
    expect(body.text).toContain(thousandChars);
    if (thousandChars !== thousandOneChars) {
      expect(body.text).not.toContain(thousandOneChars);
    }
  });

  it('should return true on successful send', async () => {
    globalThis.fetch = mockTelegramSuccess();
    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    const result = await service.escalate(sampleEvent());
    expect(result).toBe(true);
  });

  it('should return false on Telegram API error', async () => {
    globalThis.fetch = mockTelegramError(400);
    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    const result = await service.escalate(sampleEvent());
    expect(result).toBe(false);
  });

  it('should return false on network failure', async () => {
    globalThis.fetch = mockTelegramNetworkError();
    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    const result = await service.escalate(sampleEvent());
    expect(result).toBe(false);
  });

  it('should handle all escalation reason formats', async () => {
    const reasons: { reason: EscalationEvent['reason']; expectedSubstring: string }[] = [
      { reason: 'ai_error', expectedSubstring: 'Error AI provider' },
      { reason: 'ai_empty_response', expectedSubstring: 'AI tidak bisa memberikan jawaban' },
      { reason: 'ai_explicit_escalation', expectedSubstring: 'AI meminta bantuan manusia' },
      { reason: 'tool_failure', expectedSubstring: 'Gagal menjalankan tool' },
    ];

    for (const { reason, expectedSubstring } of reasons) {
      const fetchMock = mockTelegramSuccess();
      globalThis.fetch = fetchMock;

      const service = new EscalationService(createConfig({
        telegramBotToken: 'tok',
        telegramChatId: 'cid',
      }));

      await service.escalate(sampleEvent({ reason }));
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain(expectedSubstring);
    }
  });

  it('should include action instructions in message', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalate(sampleEvent());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('Balas customer ini melalui WhatsApp Web');
  });

  it('should include dashboard link when configured', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
      dashboardHost: 'dashboard.example.com',
      dashboardPort: 8080,
    }));

    await service.escalate(sampleEvent());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('http://dashboard.example.com:8080');
  });

  it('should NOT include dashboard link when not configured', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
      dashboardHost: undefined,
      dashboardPort: undefined,
    }));

    await service.escalate(sampleEvent());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).not.toContain('Dashboard');
  });
});

describe('EscalationService — escalateSimple', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockTelegramSuccess();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should escalate with explicit escalation reason', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalateSimple(
      '628111@s.whatsapp.net',
      'Ahmad',
      'Saya bingung dengan produk ini',
      'Customer tidak paham cara pakai',
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('AI meminta bantuan manusia');
    expect(body.text).toContain('Ahmad');
    expect(body.text).toContain('Saya bingung dengan produk ini');
    expect(body.text).toContain('Customer tidak paham cara pakai');
  });

  it('should use default note when not provided', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalateSimple(
      '628111@s.whatsapp.net',
      'Test',
      'Test message',
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('AI meminta bantuan manusia');
  });

  it('should return false when disabled', async () => {
    globalThis.fetch = mockTelegramSuccess();

    const service = new EscalationService(createConfig());
    const result = await service.escalateSimple('test', 'test', 'test');
    expect(result).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('EscalationService — name fallback', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should use contactId when contactName is empty', async () => {
    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    await service.escalate(sampleEvent({
      contactName: '',
      contactId: '62812345678@s.whatsapp.net',
    }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('62812345678@s.whatsapp.net');
  });
});

describe('EscalationService — edge cases', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should handle undefined event fields gracefully', async () => {
    const fetchMock = mockTelegramSuccess();
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
      dashboardHost: undefined,
      dashboardPort: undefined,
    }));

    // Minimal event without optional fields
    await service.escalate({
      contactId: '628xx@s.whatsapp.net',
      contactName: 'X',
      customerMessage: 'Test',
      reason: 'ai_error',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain('Error AI provider');
    // Should NOT include optional sections (details, history, dashboard)
    expect(body.text).not.toContain('📋 Detail');
    expect(body.text).not.toContain('📜 Riwayat percakapan');
    expect(body.text).not.toContain('Dashboard');
  });

  it('should handle non-OK response without JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    globalThis.fetch = fetchMock;

    const service = new EscalationService(createConfig({
      telegramBotToken: 'tok',
      telegramChatId: 'cid',
    }));

    const result = await service.escalate(sampleEvent());
    expect(result).toBe(false);
  });
});
