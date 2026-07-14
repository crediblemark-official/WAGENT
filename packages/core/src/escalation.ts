import { WAgentConfig, Contact, Message } from './types.js';
import { getLogger } from './logger.js';

// ── Telegram Bot API ───────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramSendResult {
  ok: boolean;
  description?: string;
}

/**
 * Send a message via Telegram bot API.
 * Returns true if sent successfully.
 */
async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      getLogger().warn({ error: err }, 'Telegram API error');
      return false;
    }

    const result = await response.json() as TelegramSendResult;
    return result.ok;
  } catch (err: any) {
    getLogger().warn({ error: err.message }, 'Failed to send Telegram message');
    return false;
  }
}

// ── Escalation Service ─────────────────────────────────────────

export interface EscalationEvent {
  /** JID of the customer */
  contactId: string;
  /** Customer name or number */
  contactName: string;
  /** The message that triggered escalation */
  customerMessage: string;
  /** Reason for escalation */
  reason: 'ai_error' | 'ai_empty_response' | 'ai_explicit_escalation' | 'tool_failure';
  /** Additional context (error message, tool name, etc.) */
  details?: string;
  /** Conversation history snippet */
  conversationHistory?: string;
}

export class EscalationService {
  private logger = getLogger().child({ module: 'escalation' });
  private enabled: boolean;
  private botToken: string;
  private chatId: string;
  private dashboardUrl?: string;

  constructor(private config: WAgentConfig) {
    this.enabled = config.telegramBotToken ? true : false;
    this.botToken = config.telegramBotToken || '';
    this.chatId = config.telegramChatId || '';
    this.dashboardUrl = config.dashboardHost && config.dashboardPort
      ? `http://${config.dashboardHost}:${config.dashboardPort}`
      : undefined;
  }

  get isEnabled(): boolean {
    return this.enabled && !!this.botToken && !!this.chatId;
  }

  /**
   * Escalate a conversation to the Telegram group.
   * Returns true if escalation was sent successfully.
   */
  async escalate(event: EscalationEvent): Promise<boolean> {
    if (!this.isEnabled) {
      this.logger.debug('Escalation not enabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
      return false;
    }

    const contactInfo = event.contactName || event.contactId;
    const phoneNumber = event.contactId.replace('@s.whatsapp.net', '').replace('@g.us', '');

    // Build escalation message
    const lines: string[] = [
      '<b>🚨 ESCALATION — AI butuh bantuan manusia</b>',
      '',
      `<b>👤 Pelanggan:</b> ${this.escapeHtml(contactInfo)}`,
      `<b>📱 Nomor:</b> ${phoneNumber}`,
      `<b>⚠️ Alasan:</b> ${this.formatReason(event.reason)}`,
    ];

    if (event.details) {
      lines.push(`<b>📋 Detail:</b> ${this.escapeHtml(event.details)}`);
    }

    lines.push('');
    lines.push('<b>💬 Pesan customer:</b>');
    lines.push(this.escapeHtml(event.customerMessage.substring(0, 500)));

    if (event.conversationHistory) {
      lines.push('');
      lines.push('<b>📜 Riwayat percakapan:</b>');
      lines.push(this.escapeHtml(event.conversationHistory.substring(0, 1000)));
    }

    // Add dashboard link if available
    if (this.dashboardUrl) {
      lines.push('');
      lines.push(`🔗 <a href="${this.dashboardUrl}">Buka Dashboard</a>`);
    }

    // Add action instructions
    lines.push('');
    lines.push('<i>⚠️ Balas customer ini melalui WhatsApp Web. AI akan berhenti otomatis.</i>');

    const message = lines.join('\n');

    const sent = await sendTelegramMessage(this.botToken, this.chatId, message);

    if (sent) {
      this.logger.info({ contactId: event.contactId, reason: event.reason }, 'Escalation sent to Telegram');
    } else {
      this.logger.warn({ contactId: event.contactId }, 'Failed to send escalation');
    }

    return sent;
  }

  /**
   * Quick escalation for when a tool (like escalate_to_human) is called.
   * This is a simple version that just forwards the customer message.
   */
  async escalateSimple(contactId: string, contactName: string, message: string, note?: string): Promise<boolean> {
    return this.escalate({
      contactId,
      contactName,
      customerMessage: message,
      reason: 'ai_explicit_escalation',
      details: note || 'AI meminta bantuan manusia secara eksplisit',
    });
  }

  private formatReason(reason: EscalationEvent['reason']): string {
    switch (reason) {
      case 'ai_error': return 'Error AI provider 🔴';
      case 'ai_empty_response': return 'AI tidak bisa memberikan jawaban ❓';
      case 'ai_explicit_escalation': return 'AI meminta bantuan manusia 🙋';
      case 'tool_failure': return 'Gagal menjalankan tool ⚙️';
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
