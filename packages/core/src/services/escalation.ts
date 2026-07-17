import { WAgentConfig, Contact, Message } from '../types.js';
import { getLogger } from '../utils/logger.js';
import { promptLoader } from '../agent/prompt-loader.js';

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

export type SendToSelfChat = (text: string) => Promise<boolean>;

export class EscalationService {
  private logger = getLogger().child({ module: 'escalation' });
  private enabled: boolean;
  private dashboardUrl?: string;
  private sendToSelfChat: SendToSelfChat;

  constructor(
    private config: WAgentConfig,
    sendToSelfChat: SendToSelfChat,
  ) {
    this.sendToSelfChat = sendToSelfChat;
    this.enabled = true; // Always enabled — escalations go to self-chat
    this.dashboardUrl = config.dashboardHost && config.dashboardPort
      ? `http://${config.dashboardHost}:${config.dashboardPort}`
      : undefined;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Escalate a conversation to the owner via WA self-chat.
   * Returns true if escalation was sent successfully.
   */
  async escalate(event: EscalationEvent): Promise<boolean> {
    const contactInfo = event.contactName || event.contactId;
    const phoneNumber = event.contactId.replace('@s.whatsapp.net', '').replace('@g.us', '');
    const esc = promptLoader.getEscalationConfig();

    // Build escalation message (WhatsApp formatting — no HTML)
    const lines: string[] = [
      `🚨 *${esc.title}*`,
      '',
      `*👤 ${esc.label_customer}:* ${contactInfo}`,
      `*📱 ${esc.label_phone}:* ${phoneNumber}`,
      `*⚠️ ${esc.label_reason}:* ${this.formatReason(event.reason)}`,
    ];

    if (event.details) {
      lines.push(`*📋 ${esc.label_detail}:* ${event.details}`);
    }

    lines.push('');
    lines.push(`*💬 ${esc.label_message}:*`);
    lines.push(event.customerMessage.substring(0, 500));

    if (event.conversationHistory) {
      lines.push('');
      lines.push(`*📜 ${esc.label_history}:*`);
      lines.push(event.conversationHistory.substring(0, 1000));
    }

    // Add dashboard link if available
    if (this.dashboardUrl) {
      lines.push('');
      lines.push(`🔗 Dashboard: ${this.dashboardUrl}`);
    }

    // Add action instructions
    lines.push('');
    lines.push(`_⚠️ ${esc.action_instruction}_`);

    const message = lines.join('\n');

    const sent = await this.sendToSelfChat(message);

    if (sent) {
      this.logger.info({ contactId: event.contactId, reason: event.reason }, 'Escalation sent to self-chat');
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
    const esc = promptLoader.getEscalationConfig();
    return this.escalate({
      contactId,
      contactName,
      customerMessage: message,
      reason: 'ai_explicit_escalation',
      details: note || esc.reason_ai_escalation,
    });
  }

  private formatReason(reason: EscalationEvent['reason']): string {
    const esc = promptLoader.getEscalationConfig();
    switch (reason) {
      case 'ai_error': return `${esc.reason_ai_error} 🔴`;
      case 'ai_empty_response': return `${esc.reason_ai_empty} ❓`;
      case 'ai_explicit_escalation': return `${esc.reason_ai_escalation} 🙋`;
      case 'tool_failure': return `${esc.reason_tool_failure} ⚙️`;
    }
  }
}
