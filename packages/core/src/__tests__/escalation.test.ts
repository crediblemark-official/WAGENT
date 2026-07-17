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
  let mockSendToSelfChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSendToSelfChat = vi.fn().mockResolvedValue(true);
  });

  describe('isEnabled', () => {
    it('returns true when sendToSelfChat is provided', () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      expect(svc.isEnabled).toBe(true);
    });

    it('returns true always (escalations always enabled via self-chat)', () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      expect(svc.isEnabled).toBe(true);
    });
  });

  describe('escalate', () => {
    it('sends message to self-chat on AI error', async () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Something went wrong',
        reason: 'ai_error',
      });

      expect(result).toBe(true);
      expect(mockSendToSelfChat).toHaveBeenCalledTimes(1);
      const message = mockSendToSelfChat.mock.calls[0][0];
      expect(message).toContain('ESCALATION');
      expect(message).toContain('Budi');
      expect(message).toContain('6281234567890');
      expect(message).toContain('Error AI provider');
      expect(message).toContain('Something went wrong');
    });

    it('sends message on unanswerable question (ai_empty_response)', async () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      const result = await svc.escalate({
        contactId: '6281999888777@g.us',
        contactName: 'Group Chat',
        customerMessage: 'What is your return policy?',
        reason: 'ai_empty_response',
        details: 'No knowledge base match found',
      });

      expect(result).toBe(true);
      const message = mockSendToSelfChat.mock.calls[0][0];
      expect(message).toContain('AI tidak bisa memberikan jawaban');
      expect(message).toContain('No knowledge base match found');
      expect(message).toContain('Group Chat');
    });

    it('handles details and conversation history when provided', async () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'I need help with my order',
        reason: 'ai_explicit_escalation',
        details: 'Tool escalate_to_human was called',
        conversationHistory: 'Customer: Hi\nBot: Hello\nCustomer: I need help',
      });

      const message = mockSendToSelfChat.mock.calls[0][0];
      expect(message).toContain('AI meminta bantuan manusia');
      expect(message).toContain('Tool escalate_to_human was called');
      expect(message).toContain('Customer: Hi');
    });

    it('includes dashboard link when configured', async () => {
      const svc = new EscalationService(
        baseConfig({ dashboardHost: 'localhost', dashboardPort: 3000 }),
        mockSendToSelfChat
      );
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'tool_failure',
      });

      const message = mockSendToSelfChat.mock.calls[0][0];
      expect(message).toContain('http://localhost:3000');
    });

    it('does not include dashboard link when not configured', async () => {
      const svc = new EscalationService(
        baseConfig({ dashboardHost: undefined as any, dashboardPort: undefined as any }),
        mockSendToSelfChat
      );
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'tool_failure',
      });

      const message = mockSendToSelfChat.mock.calls[0][0];
      expect(message).not.toContain('Dashboard');
    });

    it('returns false when sendToSelfChat fails', async () => {
      mockSendToSelfChat.mockResolvedValue(false);

      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      const result = await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Budi',
        customerMessage: 'Help',
        reason: 'ai_error',
      });

      expect(result).toBe(false);
    });

    it('uses WhatsApp formatting (no HTML tags for structure)', async () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      await svc.escalate({
        contactId: '6281234567890@s.whatsapp.net',
        contactName: 'Test User',
        customerMessage: 'Hello World',
        reason: 'ai_error',
      });

      const message = mockSendToSelfChat.mock.calls[0][0];
      // Should NOT use HTML tags for bold/italic structure
      expect(message).not.toMatch(/^\s*<b>/m);
      expect(message).not.toMatch(/<\/b>\s*$/m);
      // Should use WhatsApp *bold* format
      expect(message).toContain('*ESCALATION - AI butuh bantuan manusia*');
      expect(message).toContain('Pelanggan:');
    });
  });

  describe('escalateSimple', () => {
    it('calls escalate with ai_explicit_escalation reason', async () => {
      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      const result = await svc.escalateSimple(
        '6281234567890@s.whatsapp.net',
        'Budi',
        'I want to talk to a human',
        'Customer explicitly requested'
      );

      expect(result).toBe(true);
      const message = mockSendToSelfChat.mock.calls[0][0];
      expect(message).toContain('AI meminta bantuan manusia');
      expect(message).toContain('Customer explicitly requested');
      expect(message).toContain('I want to talk to a human');
    });

    it('returns false when sendToSelfChat fails', async () => {
      mockSendToSelfChat.mockResolvedValue(false);

      const svc = new EscalationService(baseConfig(), mockSendToSelfChat);
      const result = await svc.escalateSimple(
        '6281234567890@s.whatsapp.net',
        'Budi',
        'Help'
      );
      expect(result).toBe(false);
    });
  });
});
