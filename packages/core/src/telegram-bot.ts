import { Logger } from 'pino';
import { getLogger } from './logger.js';
import { WAgentConfig } from './types.js';
import { ApprovalQueue } from './approval-queue.js';
import type { Agent } from './agent.js';
import type { Database } from './storage.js';

// ── Types ───────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

interface TelegramResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
}

// ── Command Definition ──────────────────────────────────────────

type CommandHandler = (args: string[]) => Promise<string>;

interface CommandDef {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  handler: CommandHandler;
}

// ── Telegram Bot Class ──────────────────────────────────────────

/**
 * Gateway interface — subset of what the TelegramBot needs from Gateway.
 * This avoids circular dependency issues.
 */
export interface TelegramGatewayAdapter {
  getStatus(): string;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  getAgent(): Agent;
  getApprovalQueue(): ApprovalQueue;
}

export class TelegramBot {
  private logger: Logger;
  private enabled: boolean;
  private botToken: string;
  private authorizedChatId: string;
  private lastUpdateId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs = 3_000; // Poll every 3 seconds

  private commands: Map<string, CommandDef> = new Map();
  private gateway: TelegramGatewayAdapter;
  private db: Database;

  // ── Constructor ───────────────────────────────────────────────

  constructor(
    config: WAgentConfig,
    gateway: TelegramGatewayAdapter,
    db: Database,
  ) {
    this.logger = getLogger().child({ module: 'telegram-bot' });
    this.gateway = gateway;
    this.db = db;

    this.enabled = !!(config.telegramBotToken && config.telegramChatId);
    this.botToken = config.telegramBotToken || '';
    this.authorizedChatId = config.telegramChatId || '';

    if (this.enabled) {
      this.registerCommands();
      this.logger.info('Telegram Bot Control enabled for chat %s', this.authorizedChatId);
    } else {
      this.logger.debug('Telegram Bot Control disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // ── Command Registration ─────────────────────────────────────

  private registerCommands(): void {
    this.addCommand({
      name: 'status',
      aliases: ['stats', 's'],
      description: 'Show agent status & connection info',
      usage: '/status',
      handler: () => this.handleStatus(),
    });

    this.addCommand({
      name: 'pause',
      aliases: ['stop'],
      description: 'Pause auto-reply (AI will not respond to messages)',
      usage: '/pause',
      handler: () => this.handlePause(),
    });

    this.addCommand({
      name: 'resume',
      aliases: ['start'],
      description: 'Resume auto-reply after pause',
      usage: '/resume',
      handler: () => this.handleResume(),
    });

    this.addCommand({
      name: 'approve',
      aliases: ['a', 'yes'],
      description: 'Approve a pending action by ID',
      usage: '/approve <request_id> [note]',
      handler: (args) => this.handleApprove(args),
    });

    this.addCommand({
      name: 'reject',
      aliases: ['r', 'no', 'deny'],
      description: 'Reject a pending action by ID',
      usage: '/reject <request_id> [reason]',
      handler: (args) => this.handleReject(args),
    });

    this.addCommand({
      name: 'pending',
      aliases: ['queue', 'list'],
      description: 'List all pending approval requests',
      usage: '/pending',
      handler: () => this.handlePending(),
    });

    this.addCommand({
      name: 'contacts',
      aliases: ['c'],
      description: 'List managed WhatsApp contacts',
      usage: '/contacts [limit]',
      handler: (args) => this.handleContacts(args),
    });

    this.addCommand({
      name: 'logs',
      aliases: ['log', 'l', 'activity'],
      description: 'Show recent activity logs',
      usage: '/logs [count]',
      handler: (args) => this.handleLogs(args),
    });

    this.addCommand({
      name: 'add_contact',
      aliases: ['add', 'ac'],
      description: 'Add or update a contact profile with name and relationship',
      usage: '/add_contact <name> <relationship>',
      handler: (args) => this.handleAddContact(args),
    });

    this.addCommand({
      name: 'help',
      aliases: ['h', '?', 'commands'],
      description: 'Show available commands',
      usage: '/help [command]',
      handler: (args) => this.handleHelp(args),
    });
  }

  private addCommand(cmd: CommandDef): void {
    this.commands.set(cmd.name, cmd);
    for (const alias of cmd.aliases) {
      this.commands.set(alias, cmd);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  start(): void {
    if (!this.enabled || this.pollTimer) return;
    this.logger.info('Telegram Bot polling started (interval: %dms)', this.pollIntervalMs);

    // Start polling immediately
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info('Telegram Bot polling stopped');
  }

  // ── Polling ───────────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      const updates = await this.fetchUpdates();
      if (!updates || updates.length === 0) return;

      // Process each update in order
      for (const update of updates) {
        await this.processUpdate(update);
        this.lastUpdateId = update.update_id;
      }

    } catch (err: any) {
      // Polling errors are expected (network issues, etc.) — just log
      this.logger.debug({ error: err.message }, 'Telegram poll error');
    }
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates` +
      `?offset=${this.lastUpdateId + 1}&timeout=5&allowed_updates=["message"]`;

    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      this.logger.warn({ error: err }, 'Telegram getUpdates failed');
      return [];
    }

    const data = await response.json() as TelegramResponse;
    return data.result || [];
  }

  // ── Update Processing ─────────────────────────────────────────

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || !msg.text) return;

    // Only respond to authorized chat
    const chatId = String(msg.chat.id);
    if (chatId !== this.authorizedChatId) {
      this.logger.debug('Ignoring message from unauthorized chat: %s', chatId);
      return;
    }

    // Parse command
    const { command, args } = this.parseCommand(msg.text);
    if (!command) return; // Not a command

    this.logger.info({ command, args }, 'Telegram command received');

    // Execute command
    const cmdDef = this.commands.get(command.toLowerCase());
    if (!cmdDef) {
      await this.sendMessage(
        `Unknown command: <code>/${command}</code>\n\n` +
        `Type <code>/help</code> for available commands.`
      );
      return;
    }

    try {
      const response = await cmdDef.handler(args);
      await this.sendMessage(response);
    } catch (err: any) {
      this.logger.error({ command, error: err.message }, 'Command execution failed');
      await this.sendMessage(`Error executing /${command}: ${this.escapeHtml(err.message)}`);
    }
  }

  /**
   * Parse a message text into command and arguments.
   * Supports: /command, /command arg1 arg2, /command@botname arg1
   */
  private parseCommand(text: string): { command: string; args: string[] } {
    const trimmed = text.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) return { command: '', args: [] };

    // Split command and arguments
    const parts = trimmed.split(/\s+/);
    let cmdName = parts[0].substring(1); // Remove leading /

    // Remove @botname suffix if present
    const atIndex = cmdName.indexOf('@');
    if (atIndex > 0) cmdName = cmdName.substring(0, atIndex);

    const args = parts.slice(1);

    return { command: cmdName, args };
  }

  // ── Command Handlers ─────────────────────────────────────────

  private async handleStatus(): Promise<string> {
    const agent = this.gateway.getAgent();
    const queue = this.gateway.getApprovalQueue();
    const queueStats = queue.getStats();

    const lines: string[] = [
      '<b>🤖 WAGENT Status</b>',
      '',
      `<b>Pause:</b> ${this.gateway.isPaused() ? '⏸️ PAUSED' : '▶️ ACTIVE'}`,
      `<b>Connection:</b> ${this.gateway.getStatus()}`,
      `<b>AI Provider:</b> ${agent.getProviderName()}`,
      `<b>Pending Approvals:</b> ${queueStats.pending}`,
      `<b>Approved Today:</b> ${queueStats.approved}`,
      `<b>Rejected:</b> ${queueStats.rejected}`,
    ];

    return lines.join('\n');
  }

  private async handlePause(): Promise<string> {
    if (this.gateway.isPaused()) {
      return '⚠️ Agent is already paused. Use <code>/resume</code> to resume.';
    }

    this.gateway.setPaused(true);
    return '✅ <b>Agent PAUSED.</b>\n\nAI will not auto-reply to messages.\nUse <code>/resume</code> to enable again.';
  }

  private async handleResume(): Promise<string> {
    if (!this.gateway.isPaused()) {
      return '⚠️ Agent is already active. Use <code>/pause</code> to pause.';
    }

    this.gateway.setPaused(false);
    return '✅ <b>Agent RESUMED.</b>\n\nAI will now auto-reply to messages.';
  }

  private async handleApprove(args: string[]): Promise<string> {
    if (args.length === 0) {
      return '⚠️ Usage: <code>/approve &lt;request_id&gt; [note]</code>\n\nUse <code>/pending</code> to see pending requests.';
    }

    const id = args[0];
    const note = args.slice(1).join(' ') || undefined;

    const success = this.gateway.getApprovalQueue().approve(id, 'telegram', note);
    if (!success) {
      return `❌ Could not approve <code>${this.escapeHtml(id)}</code>.\n\nRequest not found or already resolved. Use <code>/pending</code> to see active requests.`;
    }

    return `✅ <b>Approved:</b> <code>${this.escapeHtml(id)}</code>${note ? `\nNote: ${this.escapeHtml(note)}` : ''}`;
  }

  private async handleReject(args: string[]): Promise<string> {
    if (args.length === 0) {
      return '⚠️ Usage: <code>/reject &lt;request_id&gt; [reason]</code>\n\nUse <code>/pending</code> to see pending requests.';
    }

    const id = args[0];
    const reason = args.slice(1).join(' ') || undefined;

    const success = this.gateway.getApprovalQueue().reject(id, 'telegram', reason);
    if (!success) {
      return `❌ Could not reject <code>${this.escapeHtml(id)}</code>.\n\nRequest not found or already resolved.`;
    }

    return `❌ <b>Rejected:</b> <code>${this.escapeHtml(id)}</code>${reason ? `\nReason: ${this.escapeHtml(reason)}` : ''}`;
  }

  private async handlePending(): Promise<string> {
    const pending = this.gateway.getApprovalQueue().getPending();

    if (pending.length === 0) {
      return '✅ No pending approval requests.';
    }

    const lines: string[] = [
      `<b>📋 Pending Approvals (${pending.length})</b>`,
      '',
    ];

    for (const req of pending.slice(0, 10)) { // Show max 10
      const typeIcon = req.type === 'send_message' ? '💬' :
                       req.type === 'create_order' ? '🛒' :
                       req.type === 'proactive_action' ? '⏰' : '🔧';
      lines.push(
        `${typeIcon} <code>${req.id}</code>` +
        `\n    ${this.escapeHtml(req.title)}` +
        (req.contactName ? `\n    👤 ${this.escapeHtml(req.contactName)}` : '') +
        `\n    Expires: ${req.expiresAt.toLocaleString('id-ID')}`
      );
    }

    if (pending.length > 10) {
      lines.push(`\n... and ${pending.length - 10} more`);
    }

    return lines.join('\n');
  }

  private async handleContacts(args: string[]): Promise<string> {
    const limit = args.length > 0 ? Math.min(parseInt(args[0], 10) || 10, 20) : 10;
    const contacts = this.db.getAllContacts().slice(0, limit);

    if (contacts.length === 0) {
      return '📭 No contacts yet.';
    }

    const lines: string[] = [
      `<b>📇 Contacts (${this.db.getAllContacts().length} total)</b>`,
      '',
    ];

    for (const contact of contacts) {
      const name = contact.pushName || contact.name || contact.number;
      const tags = contact.tags && contact.tags.length > 0
        ? ` [${contact.tags.join(', ')}]` : '';
      lines.push(`• ${this.escapeHtml(name)}${tags}`);
    }

    return lines.join('\n');
  }

  private async handleLogs(args: string[]): Promise<string> {
    const count = args.length > 0 ? Math.min(parseInt(args[0], 10) || 5, 20) : 5;

    // Get recent chats/messages
    const chats = this.db.getAllChats().slice(0, count);

    if (chats.length === 0) {
      return '📭 No recent activity.';
    }

    const lines: string[] = [
      `<b>📜 Recent Activity (${chats.length} chats)</b>`,
      '',
    ];

    for (const chat of chats) {
      const lastMsg = chat.lastMessage
        ? chat.lastMessage.substring(0, 50)
        : '(no messages)';
      const time = chat.lastMessageAt
        ? chat.lastMessageAt.toLocaleString('id-ID')
        : '';
      lines.push(
        `• <b>${this.escapeHtml(chat.contactName || chat.contactId)}</b>` +
        `\n  ${this.escapeHtml(lastMsg)}` +
        (time ? `\n  🕐 ${time}` : '')
      );
    }

    return lines.join('\n');
  }

  private async handleHelp(args: string[]): Promise<string> {
    // Help for specific command
    if (args.length > 0) {
      const cmdName = args[0].toLowerCase();
      const cmdDef = this.commands.get(cmdName);

      if (cmdDef) {
        const lines: string[] = [
          `<b>/${cmdDef.name}</b>`,
          '',
          cmdDef.description,
          '',
          `<b>Usage:</b> <code>${this.escapeHtml(cmdDef.usage)}</code>`,
        ];

        if (cmdDef.aliases.length > 0) {
          const primaryAliases = cmdDef.aliases.filter(a => a !== cmdDef.name);
          if (primaryAliases.length > 0) {
            lines.push('');
            lines.push(`<b>Aliases:</b> ${primaryAliases.map(a => `<code>/${a}</code>`).join(', ')}`);
          }
        }

        return lines.join('\n');
      }

      return `Unknown command: <code>/${this.escapeHtml(cmdName)}</code>`;
    }

    // General help
    const lines: string[] = [
      '<b>🤖 WAGENT Bot Commands</b>',
      '',
      '<b>Status & Control</b>',
      '  <code>/status</code> — Show agent status',
      '  <code>/pause</code> — Pause auto-reply',
      '  <code>/resume</code> — Resume auto-reply',
      '',
      '<b>Approval</b>',
      '  <code>/pending</code> — List pending approvals',
      '  <code>/approve &lt;id&gt;</code> — Approve action',
      '  <code>/reject &lt;id&gt;</code> — Reject action',
      '',
      '<b>Information</b>',
      '  <code>/contacts</code> — List contacts',
      '  <code>/logs</code> — Recent activity',
      '  <code>/help [cmd]</code> — Show this help',
    ];

    return lines.join('\n');
  }

  private async handleAddContact(args: string[]): Promise<string> {
    if (args.length < 2) {
      return '⚠️ Usage: <code>/add_contact &lt;name&gt; &lt;relationship&gt;</code>\n\nExample: <code>/add_contact Budi Santoso Teman kuliah</code>';
    }

    const name = args[0];
    const relationship = args.slice(1).join(' ');

    try {
      // Use the agent's existing MemoryManager (avoids custom dir mismatch)
      const mm = this.gateway.getAgent().getMemoryManager();

      // Check if profile already exists by name
      const existingProfiles = mm.listContactProfiles();
      const existing = existingProfiles.find(p => p.name.toLowerCase() === name.toLowerCase());

      if (existing) {
        const profile = mm.loadContactProfile(existing.contactId);
        if (profile) {
          profile.relationship = relationship;
          profile.updatedAt = new Date();
          mm.saveContactProfile(profile);
          return `✅ <b>Contact Updated:</b> ${this.escapeHtml(name)}\nRelationship: ${this.escapeHtml(relationship)}`;
        }
      }

      // Contact not found in memory profiles — still record it
      // (The actual WhatsApp JID will be linked when contact chats)
      const contactId = `tg_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
      mm.saveContactProfile({
        contactId,
        name,
        relationship,
        tone: 'friendly',
        updatedAt: new Date(),
      });

      return `✅ <b>Contact Added:</b> ${this.escapeHtml(name)}\nRelationship: ${this.escapeHtml(relationship)}\n\nStyle profile created. Use Dashboard to customize tone and style.`;
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to add contact');
      return `❌ Failed to add contact: ${this.escapeHtml(err.message)}`;
    }
  }

  // ── Utilities ─────────────────────────────────────────────────

  /**
   * Send a message to the authorized Telegram chat.
   * Returns true if sent successfully.
   */
  async sendMessage(text: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.authorizedChatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn({ error: err }, 'Telegram sendMessage failed');
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to send Telegram message');
      return false;
    }
  }

  /**
   * Send a notification about a new approval request.
   */
  async notifyApprovalRequest(request: {
    id: string;
    title: string;
    description: string;
    type: string;
    contactName?: string;
  }): Promise<void> {
    const typeIcon = request.type === 'send_message' ? '💬' :
                     request.type === 'create_order' ? '🛒' :
                     request.type === 'proactive_action' ? '⏰' : '🔧';

    const lines: string[] = [
      `${typeIcon} <b>Approval Required: ${this.escapeHtml(request.title)}</b>`,
      '',
      this.escapeHtml(request.description),
    ];

    if (request.contactName) {
      lines.push(`👤 Contact: ${this.escapeHtml(request.contactName)}`);
    }

    lines.push('');
    lines.push(`ID: <code>${request.id}</code>`);
    lines.push('');
    lines.push(
      `<code>/approve ${request.id}</code> ✅  ` +
      `<code>/reject ${request.id}</code> ❌`
    );

    await this.sendMessage(lines.join('\n'));
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
