import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EscalationService } from '../services/escalation.js';
import type { WAgentConfig } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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
    getEscalationConfig: () => ({
      title: 'ESCALATION - AI butuh bantuan manusia',
      label_customer: 'Pelanggan',
      label_phone: 'Nomor',
      label_reason: 'Alasan',
      label_detail: 'Detail',
      label_message: 'Pesan customer',
      label_history: 'Riwayat percakapan',
      action_instruction: 'Balas customer ini melalui WhatsApp Web. AI akan berhenti otomatis.',
      reason_ai_error: 'Error AI provider',
      reason_ai_empty: 'AI tidak bisa memberikan jawaban',
      reason_ai_escalation: 'AI meminta bantuan manusia',
      reason_tool_failure: 'Gagal menjalankan tool',
    }),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function baseConfig(overrides: Partial<WAgentConfig> = {}): WAgentConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'test',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
    ...overrides,
  } as WAgentConfig;
}

describe('EscalationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  describe('isEnabled', () => {
    it('returns true when both telegramBotToken and telegramChatId are present', () => {
      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      expect(svc.isEnabled).toBe(true);
    });

    it('returns false when telegramBotToken is missing', () => {
      const svc = new EscalationService(
        baseConfig({ telegramChatId: 'chat-123' })
      );
      expect(svc.isEnabled).toBe(false);
    });

    it('returns false when telegramChatId is missing', () => {
      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token' })
      );
      expect(svc.isEnabled).toBe(false);
    });

    it('returns false when neither telegram config is present', () => {
      const svc = new EscalationService(baseConfig());
      expect(svc.isEnabled).toBe(false);
    });
  });

  describe('escalate', () => {
    function successResponse() {
      return {
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      };
    }

    function errorResponse(body = 'Bad Request') {
      return {
        ok: false,
        text: () => Promise.resolve(body),
      };
    }

    it('returns false when not enabled', async () => {
      const svc = new EscalationService(baseConfig());
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help me',
        reason: 'ai_error',
      });
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends Telegram message on AI error', async () => {
      mockFetch.mockResolvedValue(successResponse());

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Something went wrong',
        reason: 'ai_error',
      });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body);
      expect(body.chat_id).toBe('chat-123');
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('ESCALATION');
      expect(body.text).toContain('Budi');
      expect(body.text).toContain('6281234567890');
      expect(body.text).toContain('Error AI provider');
      expect(body.text).toContain('Something went wrong');
    });

    it('sends message on unanswerable question (ai_empty_response)', async () => {
      mockFetch.mockResolvedValue(successResponse());

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      const result = await svc.escalate({
        contactId: '6281999888777@g.us',
        contactName: 'Group Chat',
        customerMessage: 'What is your return policy?',
        reason: 'ai_empty_response',
        details: 'No knowledge base match found',
      });

      expect(result).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('AI tidak bisa memberikan jawaban');
      expect(body.text).toContain('No knowledge base match found');
      expect(body.text).toContain('Group Chat');
    });

    it('handles details and conversation history when provided', async () => {
      mockFetch.mockResolvedValue(successResponse());

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'I need help with my order',
        reason: 'ai_explicit_escalation',
        details: 'Tool escalate_to_human was called',
        conversationHistory: 'Customer: Hi\nBot: Hello\nCustomer: I need help',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('AI meminta bantuan manusia');
      expect(body.text).toContain('Tool escalate_to_human was called');
      expect(body.text).toContain('Customer: Hi');
    });

    it('includes dashboard link when configured', async () => {
      mockFetch.mockResolvedValue(successResponse());

      const svc = new EscalationService(
        baseConfig({
          telegramBotToken: 'bot-token',
          telegramChatId: 'chat-123',
          dashboardHost: 'localhost',
          dashboardPort: 3000,
        })
      );
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'tool_failure',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('http://localhost:3000');
      expect(body.text).toContain('Buka Dashboard');
    });

    it('does not include dashboard link when not configured', async () => {
      mockFetch.mockResolvedValue(successResponse());

      const svc = new EscalationService(
        baseConfig({
          telegramBotToken: 'bot-token',
          telegramChatId: 'chat-123',
          dashboardHost: undefined as any,
          dashboardPort: undefined as any,
        })
      );
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'tool_failure',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).not.toContain('Buka Dashboard');
    });

    it('returns false when fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'ai_error',
      });

      expect(result).toBe(false);
    });

    it('returns false when Telegram API returns non-ok response', async () => {
      mockFetch.mockResolvedValue(errorResponse('Forbidden'));

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'ai_error',
      });

      expect(result).toBe(false);
    });

    it('returns false when Telegram API returns ok:false in body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'chat not found' }),
      });

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'ai_error',
      });

      expect(result).toBe(false);
    });

    it('escapes HTML in contact name and message', async () => {
      mockFetch.mockResolvedValue(successResponse());

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: '<script>alert("xss")</script>',
        customerMessage: 'Hello <b>bold</b> & "quotes"',
        reason: 'ai_error',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).not.toContain('<script>');
      expect(body.text).toContain('&lt;script&gt;');
      expect(body.text).toContain('&amp;');
      expect(body.text).toContain('&quot;');
    });
  });

  describe('escalateSimple', () => {
    it('calls escalate with ai_explicit_escalation reason', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const svc = new EscalationService(
        baseConfig({ telegramBotToken: 'bot-token', telegramChatId: 'chat-123' })
      );
      const result = await svc.escalateSimple(
        '6281234567890@s.whatsapp.net',
        'Budi',
        'I want to talk to a human',
        'Customer explicitly requested'
      );

      expect(result).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('AI meminta bantuan manusia');
      expect(body.text).toContain('Customer explicitly requested');
      expect(body.text).toContain('I want to talk to a human');
    });

    it('returns false when not enabled', async () => {
      const svc = new EscalationService(baseConfig());
      const result = await svc.escalateSimple(
        '6281234567890@s.whatsapp.net',
        'Budi',
        'Help'
      );
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
