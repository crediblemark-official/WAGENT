import { existsSync } from 'fs';
import { join } from 'path';
import { Logger } from 'pino';
import { EventBus } from '../utils/event-bus.js';
import { Agent } from '../agent/agent.js';
import { Database } from '../storage/index.js';
import { Scheduler } from './scheduler.js';
import { Transcriber } from './transcriber.js';
import {
  WAgentConfig,
  Message,
  Contact,
  Chat,
  ConnectionStatus,
  GatewayEvent,
  ToolDefinition,
  AudioMessageData,
} from '../types.js';
import { getLogger } from '../utils/logger.js';
import { EscalationService, EscalationEvent } from './escalation.js';
import { ApprovalQueue } from './approval-queue.js';
import { ProactiveScheduler } from './proactive-scheduler.js';
import { promptLoader } from '../agent/prompt-loader.js';
import { ToolSandbox } from '../tools/tool-sandbox.js';
import { TelegramBot, TelegramGatewayAdapter } from './telegram-bot.js';
import { PromptGenerator } from '../agent/prompt-generator.js';



// ── Helpers ─────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Human-like Delay Helpers ────────────────────────────────────

/**
 * Calculate a human-like pre-delay before replying.
 * Uses a deterministic hash from the message ID to preserve
 * message ordering (same ID = same delay).
 * Returns milliseconds: 1-3s base + reading time.
 */
function calculateHumanDelay(incomingMessage: string, msgId?: string): number {
  const wordCount = Math.max(incomingMessage.split(/\s+/).length, 1);
  // Deterministic component from message ID for ordering
  let hash = 0;
  const seed = msgId || incomingMessage;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0; // Convert to 32-bit int
  }
  const deterministicBase = 1000 + Math.abs(hash % 2000); // 1-3s based on msg ID
  const readingTime = wordCount * 200;
  return Math.min(deterministicBase + readingTime, 8_000);
}

/**
 * Calculate typing delay for the AI's response.
 * Simulates human typing speed: ~100ms per character (moderate typist).
 * Returns milliseconds, capped at 15 seconds.
 */
function calculateTypingDelay(response: string): number {
  const charCount = response.length;
  // Typing speed: ~100ms per character for short responses, faster for long
  const speedPerChar = charCount < 50 ? 120 : charCount < 200 ? 80 : 50;
  const typingTime = charCount * speedPerChar;
  // Cap at 15 seconds so it doesn't feel too slow
  return Math.min(typingTime, 15_000);
}

// ── WhatsApp Adapter Interface ──────────────────────────────────

export interface WhatsAppAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(to: string, content: string): Promise<Message>;
  getConnectionStatus(): ConnectionStatus;
  getContacts(): Promise<Contact[]>;
  isConnected(): boolean;
  onEvent(handler: (event: GatewayEvent) => void): void;
  downloadAudio?(msg: any): Promise<AudioMessageData>;
  /** Show typing indicator / update online presence */
  sendPresenceUpdate?(type: 'composing' | 'paused' | 'available' | 'unavailable', toJid?: string): Promise<void>;
  /** Mark incoming message(s) as read */
  readMessages?(jid: string, messageKeys: { id: string; fromMe?: boolean }[]): Promise<void>;
  /** Bot's own JID (for @mention detection) */
  readonly userJid?: string;
}

// ── Dashboard Adapter Interface ─────────────────────────────────

export interface DashboardAdapter {
  start(port: number, host: string): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: GatewayEvent): void;
}

// ── Gateway Class ───────────────────────────────────────────────

export class Gateway {
  private eventBus: EventBus;
  private agent!: Agent;
  private logger: Logger;
  private _status: ConnectionStatus = 'disconnected';
  private scheduler!: Scheduler;
  private transcriber: Transcriber;

  private escalation: EscalationService;

  // v2 components
  private approvalQueue!: ApprovalQueue;
  private proactiveScheduler!: ProactiveScheduler;
  private toolSandbox!: ToolSandbox;
  private telegramBot!: TelegramBot;

  /** Pause auto-reply */
  private _paused = false;
  /** Gateway start time for uptime calculation */
  private _startTime: number = Date.now();

  constructor(
    private config: WAgentConfig,
    private db: Database,
    private whatsapp: WhatsAppAdapter,
    private dashboard?: DashboardAdapter,
    extraTools: ToolDefinition[] = []
  ) {
    this.eventBus = new EventBus();
    this.logger = getLogger().child({ module: 'gateway' });
    this.escalation = new EscalationService(config);

    // Initialize v2 components
    this.approvalQueue = new ApprovalQueue({
      eventBus: this.eventBus,
    });
    this.toolSandbox = new ToolSandbox();

    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    this.agent = new Agent(config, db, extraTools, {
      approvalQueue: this.approvalQueue,
      autoSummarizeEnabled: !isTest,
      autoLearnEnabled: !isTest,
    });

    this.proactiveScheduler = new ProactiveScheduler({
      db,
      approvalQueue: this.approvalQueue,
      onActionTrigger: async (action) => {
        this.logger.info({ id: action.id }, 'Executing proactive action: %s', action.title);
        // Proactive action execution would go through the agent
      },
    });

    this.scheduler = new Scheduler(db, whatsapp, this.eventBus);
    this.transcriber = new Transcriber(config);

    // Wire scheduler to agent for tool context (send_message, create_reminder)
    this.agent.setScheduler(this.scheduler);

    // Initialize TelegramBot (pass self as adapter)
    this.telegramBot = new TelegramBot(config, this as TelegramGatewayAdapter, db);

    // Wire up approval queue events → Telegram notifications
    this.eventBus.on('approval:request', (event) => {
      if (event.type === 'approval:request') {
        this.telegramBot.notifyApprovalRequest({
          id: event.request.id,
          title: event.request.title,
          description: event.request.description,
          type: event.request.type,
          contactName: event.request.contactName,
        }).catch(err => {
          this.logger.warn({ error: err.message }, 'Failed to send approval notification to Telegram');
        });
      }
    });

    this.whatsapp.onEvent((event) => this.handleWhatsAppEvent(event));

    if (this.dashboard) {
      this.eventBus.onAny((event) => this.dashboard!.broadcast(event));
    }

    if (this.escalation.isEnabled) {
      this.logger.info('Telegram escalation enabled');
    }

    if (this.telegramBot.isEnabled) {
      this.logger.info('Telegram Bot Control enabled');
    }
  }

  getAgent(): Agent { return this.agent; }
  getEventBus(): EventBus { return this.eventBus; }
  getStatus(): ConnectionStatus { return this._status; }
  getApprovalQueue(): ApprovalQueue { return this.approvalQueue; }
  getProactiveScheduler(): ProactiveScheduler { return this.proactiveScheduler; }
  getToolSandbox(): ToolSandbox { return this.toolSandbox; }
  getTelegramBot(): TelegramBot { return this.telegramBot; }
  getWhatsAppAdapter(): WhatsAppAdapter { return this.whatsapp; }

  /** Whether auto-reply is paused */
  isPaused(): boolean { return this._paused; }

  /** Pause or resume auto-reply */
  setPaused(paused: boolean): void {
    this._paused = paused;
    this.logger.info(paused ? 'Auto-reply PAUSED' : 'Auto-reply RESUMED');
    if (paused) {
      this.eventBus.emit({ type: 'human:active', chatId: '__system_paused__' });
    } else {
      this.eventBus.emit({ type: 'human:inactive', chatId: '__system_paused__' });
    }
  }

  setStatus(status: ConnectionStatus): void {
    this._status = status;
    this.eventBus.emit({ type: 'connection:update', status });
  }

  /** Deduplication guard: contactId → timestamp to prevent double-escalation within 60s */
  private recentEscalations = new Map<string, number>();

  /** Check if we recently escalated for this contact (within 60 seconds) */
  private canEscalate(contactId: string): boolean {
    const lastTime = this.recentEscalations.get(contactId);
    const now = Date.now();
    if (lastTime && (now - lastTime) < 60_000) return false;
    this.recentEscalations.set(contactId, now);
    return true;
  }

  private async handleWhatsAppEvent(event: GatewayEvent): Promise<void> {
    this.eventBus.emit(event);
    if (event.type === 'message:received') {
      const msg = event.message;

      // ── Human Takeover Detection ────────────────────────────
      // When a `fromMe: true` message arrives that was NOT sent
      // by our bot code (not in DB), a human replied from WhatsApp Web.
      // Mark this conversation as "human active" and save the
      // human's reply to DB so history is complete across restarts.
      if (msg.fromMe && msg.id) {
        const exists = this.db.messageExists(msg.id);
        if (!exists) {
          this.logger.info({ from: msg.from }, 'Human reply detected — AI will pause for this conversation');
          this.humanActiveMap.set(msg.from, Date.now());
          this.eventBus.emit({ type: 'human:active', chatId: msg.from });

          // Save human reply to DB for complete conversation history
          try {
            const humanChatId = msg.from;

            // Ensure contact exists
            const humanContact: Contact = {
              id: msg.from,
              name: msg.metadata?.pushName as string || msg.from,
              pushName: msg.metadata?.pushName as string,
              number: msg.from.replace('@s.whatsapp.net', '').replace('@g.us', ''),
              isGroup: msg.from.includes('@g.us'),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            this.db.saveContact(humanContact);

            // Update chat's last message first to satisfy FK constraint on messages table
            const humanExistingChat = this.db.getChat(humanChatId);
            this.db.saveChat({
              id: humanChatId,
              contactId: msg.from,
              contactName: humanContact.name,
              lastMessage: `👤 ${msg.content}`,
              lastMessageAt: msg.timestamp,
              unreadCount: humanExistingChat?.unreadCount || 0,
              isGroup: humanContact.isGroup,
              createdAt: humanExistingChat?.createdAt || new Date(),
            });

            // Save the human's reply message
            this.db.saveMessage(msg, humanChatId);
          } catch (err: any) {
            this.logger.warn({ error: err.message }, 'Failed to save human reply to DB');
          }
        }
        return; // Don't process fromMe messages further
      }

      await this.handleIncomingMessage(event.message);
    } else if (event.type === 'connection:update') {
      const prevStatus = this._status;
      this._status = event.status;
      if (event.status === 'connected' && prevStatus !== 'connected') {
        setImmediate(async () => {
          try {
            const userJid = this.whatsapp.userJid;
            if (userJid) {
              const history = this.db.getConversationHistory(userJid);
              if (history.length === 0) {
                if (!this.hasCustomPrompts()) {
                  const setupWelcome = [
                    `👋 *Halo Owner! Selamat datang di WAGENT.*`,
                    ``,
                    `Saya mendeteksi bahwa sistem ini belum dikonfigurasi. Mari kita setup kepribadian dan instruksi saya agar saya tidak generik dan bisa melayani Anda/customer Anda secara maksimal.`,
                    ``,
                    `*Pertanyaan 1:* Apakah Anda ingin menggunakan saya sebagai:`,
                    `1. Bisnis / Customer Service (CS)`,
                    `2. Asisten Pribadi (Personal Assistant)`,
                    `3. Campuran (Hybrid)`,
                    ``,
                    `👉 Silakan ketik pilihan Anda untuk memulai interview setup!`,
                    `💡 _Tips: Kirim \`/skip\` kapan saja untuk menggunakan konfigurasi asisten default._`,
                  ].join('\n');
                  this.db.addConversation(userJid, 'assistant', setupWelcome);
                  await this.whatsapp.sendMessage(userJid, setupWelcome);
                } else {
                  const intro = [
                    `👋 *Halo Owner! Saya Asisten AI Anda.*`,
                    ``,
                    `Saya baru saja terhubung dan siap membantu. Anda bisa mengobrol langsung dengan saya di sini (self-chat) untuk memberikan instruksi, bertanya, atau menguji respons saya secara real-time.`,
                    ``,
                    `💡 *Tips:* Kirim \`/help\` untuk melihat perintah kontrol yang tersedia.`,
                  ].join('\n');
                  await this.whatsapp.sendMessage(userJid, intro);
                }
              }
            }
          } catch (err: any) {
            this.logger.warn({ error: err.message }, 'Failed to send self-chat intro');
          }
        });
      }
    }
  }

  // ── Human Takeover ──────────────────────────────────────────────

  /** Map of JID → timestamp when a human last replied */
  private humanActiveMap = new Map<string, number>();

  /**
   * Check if a human is currently handling this conversation.
   * Cleans up stale entries automatically.
   */
  private isHumanActive(jid: string): boolean {
    const cooldownMs = (this.config.humanTakeoverCooldownMinutes || 30) * 60 * 1000;
    const lastHumanReply = this.humanActiveMap.get(jid);
    if (!lastHumanReply) return false;

    const elapsed = Date.now() - lastHumanReply;
    if (elapsed > cooldownMs) {
      // Cooldown expired, clean up and notify dashboard
      this.humanActiveMap.delete(jid);
      this.eventBus.emit({ type: 'human:inactive', chatId: jid });
      return false;
    }

    return true;
  }

  // ── Rate Limiter ────────────────────────────────────────────────

  private rateLimitMap = new Map<string, { count: number; windowStart: number }>();

  private checkRateLimit(contactId: string): boolean {
    const max = this.config.rateLimitMax || 10;
    const windowMs = (this.config.rateLimitWindowSeconds || 10) * 1000;
    const now = Date.now();

    let entry = this.rateLimitMap.get(contactId);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 1, windowStart: now };
      this.rateLimitMap.set(contactId, entry);
      return true;
    }

    entry.count++;
    return entry.count <= max;
  }

  /**
   * Periodically clean up stale rate limit entries
   */
  private cleanupRateLimits(): void {
    const windowMs = (this.config.rateLimitWindowSeconds || 10) * 1000;
    const now = Date.now();
    for (const [key, entry] of this.rateLimitMap.entries()) {
      if (now - entry.windowStart > windowMs) {
        this.rateLimitMap.delete(key);
      }
    }
  }

  // ── Working Hours Check ─────────────────────────────────────────

  private isWithinWorkingHours(): boolean {
    if (!this.config.workingHoursEnabled) return true;

    try {
      const startParts = (this.config.workingHoursStart || '08:00').split(':').map(Number);
      const endParts = (this.config.workingHoursEnd || '17:00').split(':').map(Number);
      const tz = this.config.workingHoursTimezone || 'Asia/Jakarta';

      // Get current time in the configured timezone
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const timeStr = formatter.format(now);
      const [currentH, currentM] = timeStr.split(':').map(Number);

      const currentMinutes = currentH * 60 + currentM;
      const startMinutes = startParts[0] * 60 + startParts[1];
      const endMinutes = endParts[0] * 60 + endParts[1];

      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } catch {
      this.logger.warn('Failed to check working hours, defaulting to online');
      return true;
    }
  }

  // ── Group Chat Check ────────────────────────────────────────────

  /**
   * Check if the bot is @mentioned in a group message
   */
  private isMentionedInGroup(msg: Message): boolean {
    const mentionedJids = msg.metadata?.mentionedJid as string[] | undefined;
    if (!mentionedJids || mentionedJids.length === 0) return false;
    return mentionedJids.includes(this.whatsapp.userJid || '');
  }

  /**
   * Detect self-chat: message sent to own WhatsApp number
   */
  private isSelfChat(msg: Message): boolean {
    const userJid = this.whatsapp.userJid;
    if (!userJid) return false;
    // msg.to is the recipient — if it matches own JID, it's self-chat
    return msg.to === userJid;
  }

  /**
   * Handle self-chat commands (WA control plane)
   * Supports: /status, /pause, /resume, /stats, /help, /contacts
   */
  private async handleSelfChatCommand(msg: Message): Promise<void> {
    const text = msg.content.trim();
    this.logger.info({ text }, 'Self-chat message received');
    const sc = promptLoader.getSelfChatConfig();

    // Check if system prompts have been configured yet
    if (!this.hasCustomPrompts()) {
      // Allow /skip or /skipsetup to generate fallback prompts and skip the interview
      if (text === '/skip' || text === '/skipsetup') {
        try {
          const generator = new PromptGenerator(this.config);
          const defaultAnswers = {
            businessName: 'My WAGENT',
            businessType: 'general-assistant',
            businessDescription: 'Asisten AI pintar serbaguna',
            targetCustomer: 'Owner',
            tone: 'casual' as const,
            emojiUsage: 'moderate' as const,
            language: 'id',
            frequentQuestions: [],
            orderProcess: '',
            paymentMethods: '',
            shippingTime: '',
            returnPolicy: '',
            forbiddenActions: [],
            escalationTriggers: [],
            workingHours: '24 jam',
            features: ['web_search', 'reminder'],
          };
          await generator.generateAll(defaultAnswers);
          await this.whatsapp.sendMessage(msg.from, `👋 *Setup dilewati!*\n\nBerkas prompt default telah ditulis ke folder \`prompts/\`.\nBot akan me-restart secara otomatis dalam 2 detik.`);
          setTimeout(() => process.exit(0), 2000);
        } catch (err: any) {
          await this.whatsapp.sendMessage(msg.from, `❌ Error skipping setup: ${err.message}`);
        }
        return;
      }

      // If not a command starting with /, process as setup interview
      if (!text.startsWith('/')) {
        await this.handleSetupInterviewMessage(msg);
        return;
      }
    } else {
      // If not a command starting with /, process with AI Agent (Normal Mode)
      if (!text.startsWith('/')) {
        const composing = () => this.whatsapp.sendPresenceUpdate?.('composing', msg.from)?.catch(() => {});
        await composing();
        const typingInterval = setInterval(composing, 8_000);
        try {
          const contactName = 'Owner';
          const result = await this.agent.processMessage(
            `[SELF-CHAT CONVERSATION WITH OWNER]
Pesan dari owner: "${text}"`, 
            msg.from, 
            contactName
          );
          clearInterval(typingInterval);
          this.whatsapp.sendPresenceUpdate?.('paused', msg.from)?.catch(() => {});
          await this.whatsapp.sendMessage(msg.from, result.response);
        } catch (err: any) {
          clearInterval(typingInterval);
          this.whatsapp.sendPresenceUpdate?.('paused', msg.from)?.catch(() => {});
          this.logger.error({ error: err.message }, 'Self-chat AI processing error');
          await this.whatsapp.sendMessage(msg.from, `❌ Error: ${err.message}`);
        }
        return;
      }
    }

    const [command, ...args] = text.split(/\s+/);
    const cmd = command.toLowerCase();

    try {
      switch (cmd) {
        case '/status': {
          const status = this.getStatus();
          const uptime = this._startTime ? Math.floor((Date.now() - this._startTime) / 1000) : 0;
          const mem = process.memoryUsage();
          const response = [
            `📊 *${sc.status_header}*`,
            ``,
            `Status: ${status}`,
            `Uptime: ${Math.floor(uptime / 60)}m ${uptime % 60}s`,
            `Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
            `Paused: ${this._paused ? 'Yes' : 'No'}`,
            `Contacts: ${this.db.getAllContacts().length}`,
          ].join('\n');
          await this.whatsapp.sendMessage(msg.from, response);
          break;
        }

        case '/pause': {
          this.setPaused(true);
          await this.whatsapp.sendMessage(msg.from, `⏸️ ${sc.pause_done}`);
          break;
        }

        case '/resume': {
          this.setPaused(false);
          await this.whatsapp.sendMessage(msg.from, `▶️ ${sc.resume_done}`);
          break;
        }

        case '/stats': {
          const contacts = this.db.getAllContacts();
          const response = [
            `📈 *Statistik*`,
            ``,
            `Total kontak: ${contacts.length}`,
            `Agent status: ${this._paused ? 'Paused' : 'Active'}`,
          ].join('\n');
          await this.whatsapp.sendMessage(msg.from, response);
          break;
        }

        case '/contacts': {
          const contacts = this.db.getAllContacts().slice(0, 10);
          if (contacts.length === 0) {
            await this.whatsapp.sendMessage(msg.from, sc.contacts_empty);
          } else {
            const list = contacts.map((c, i) => `${i + 1}. ${c.name || c.number}`).join('\n');
            await this.whatsapp.sendMessage(msg.from, `👥 *${sc.contacts_header}*\n\n${list}`);
          }
          break;
        }

        case '/help': {
          const help = [
            `📱 *${sc.help_header}*`,
            ``,
            `/status — ${sc.help_status}`,
            `/pause — ${sc.help_pause}`,
            `/resume — ${sc.help_resume}`,
            `/stats — ${sc.help_stats}`,
            `/contacts — ${sc.help_contacts}`,
            `/help — ${sc.help_help}`,
          ].join('\n');
          await this.whatsapp.sendMessage(msg.from, help);
          break;
        }

        default:
          await this.whatsapp.sendMessage(msg.from, `${sc.command_unknown}: ${cmd}\n${sc.help_hint}`);
      }
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Self-chat command error');
      await this.whatsapp.sendMessage(msg.from, `${sc.command_error}: ${err.message}`);
    }
  }

  private async handleIncomingMessage(msg: Message): Promise<void> {
    this.logger.info({ from: msg.from, content: msg.content }, 'Incoming message');

    // ── Self-Chat Control (WA Self-Chat) ────────────────────────
    // Messages sent to own number are treated as control commands
    if (msg.fromMe && this.isSelfChat(msg)) {
      await this.handleSelfChatCommand(msg);
      return;
    }

    if (msg.fromMe) return;

    // ── Pause Check ──────────────────────────────────────────
    if (this._paused) {
      this.logger.debug({ from: msg.from }, 'Agent is paused — skipping AI response');
      return;
    }

    // ── Human Takeover Check ──────────────────────────────────
    // If a human agent is handling this conversation, skip AI
    if (this.isHumanActive(msg.from)) {
      this.logger.info({ from: msg.from }, 'Human is active — skipping AI response');
      // Still save the message so the human can see it
      return;
    }

    // ── Group Chat Filter ──────────────────────────────────────
    const isGroup = msg.from.includes('@g.us');
    if (isGroup) {
      if (!this.config.groupChatEnabled) {
        this.logger.debug({ from: msg.from }, 'Skipping group message (group chat disabled)');
        return;
      }
      if (this.config.groupChatReplyIfMentioned && !this.isMentionedInGroup(msg)) {
        this.logger.debug({ from: msg.from }, 'Skipping group message (not @mentioned)');
        return;
      }
    }

    // ── Rate Limit Check ───────────────────────────────────────
    if (!this.checkRateLimit(msg.from)) {
      this.logger.warn({ from: msg.from }, 'Rate limited');
      try {
        const rateMsg = this.config.rateLimitMessage || promptLoader.getRateLimitMessage();
        await this.whatsapp.sendMessage(msg.from, rateMsg);
      } catch { /* ignore send error */ }
      return;
    }

    // ── Working Hours Check ───────────────────────────────────────
    if (!this.isWithinWorkingHours()) {
      this.logger.info({ from: msg.from }, 'Outside working hours, sending offline message');
      try {
        const offlineMsg = this.config.offlineMessage || promptLoader.getOfflineMessage();
        await this.whatsapp.sendMessage(msg.from, offlineMsg);
      } catch { /* ignore send error */ }
      return;
    }

    const contact: Contact = {
      id: msg.from,
      name: msg.metadata?.pushName as string || msg.from,
      pushName: msg.metadata?.pushName as string,
      number: msg.from.replace('@s.whatsapp.net', '').replace('@g.us', ''),
      isGroup,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.db.saveContact(contact);

    let messageContent = msg.content;
    if (msg.type === 'audio' && msg.metadata?.isVoiceNote && msg.metadata?.rawMessage) {
      try {
        if (this.transcriber.isAvailable() && this.whatsapp.downloadAudio) {
          const audioData = await this.whatsapp.downloadAudio(msg.metadata.rawMessage);
          const transcription = await this.transcriber.transcribe(audioData);
          messageContent = transcription.text;
          msg.content = `🎤 ${messageContent}`;
          msg.metadata = { ...msg.metadata, transcribed: true, originalType: 'audio', transcriptionProvider: transcription.provider };
        } else {
          messageContent = '[Pesan suara — transkripsi tidak tersedia]';
        }
      } catch (err: any) {
        messageContent = '[Pesan suara — gagal ditranskripsi]';
        msg.content = `🎤 [Transkripsi gagal: ${err.message}]`;
      }
    }

    const chatId = msg.from;
    const jid = msg.from;

    // Save/update chat FIRST to satisfy FK constraint on messages
    const existingChat = this.db.getChat(chatId);
    this.db.saveChat({
      id: chatId, contactId: msg.from, contactName: contact.name,
      lastMessage: msg.content, lastMessageAt: msg.timestamp,
      unreadCount: (existingChat?.unreadCount || 0) + 1,
      isGroup: contact.isGroup, createdAt: existingChat?.createdAt || new Date(),
    });
    this.db.saveMessage(msg, chatId);
    this.db.incrementMessageCount('incoming');

    // ── Auto-welcome for new conversations ───────────────────────
    const history = this.db.getConversationHistory(msg.from);
    const isNewChat = history.length === 0 && this.config.welcomeMessageEnabled && this.config.welcomeMessage;

    if (isNewChat) {
      this.logger.info({ from: msg.from }, 'Sending welcome message to new contact');
      // We'll let the AI respond naturally, but inject the welcome context
      // The AI will use the welcome message as part of its system prompt context
    }

    // ── Natural WhatsApp Behavior ───────────────────────────────
    // 1. Mark message as read (blue check ✓✓)
    if (msg.id) {
      this.whatsapp.readMessages?.(jid, [{ id: msg.id, fromMe: false }])?.catch(e =>
        this.logger.warn({ error: e.message }, 'Failed to mark as read')
      );
    }

    // 2. Show typing indicator ("mengetik...")
    const composing = () => this.whatsapp.sendPresenceUpdate?.('composing', jid)?.catch(() => {});
    await composing();

    // 3. Keep typing alive by re-sending every 8 seconds during AI processing
    const typingInterval = setInterval(composing, 8_000);

    // 4. Human-like pre-delay (simulate reading time)
    const preDelay = calculateHumanDelay(messageContent, msg.id);
    if (preDelay > 0) {
      this.logger.debug({ delayMs: preDelay }, 'Natural delay before AI processing');
      await sleep(preDelay);
    }

    try {
      // 5. Process message through AI
      const contactName = contact.pushName || contact.name;

      // Inject welcome context for new conversations
      if (isNewChat) {
        messageContent = `[PELANGGAN BARU - ${contactName}]
Pesan pertama: "${messageContent}"

Ini adalah chat pertama dengan pelanggan ini. Sambut dengan hangat dan tawarkan bantuan.
${this.config.welcomeMessage ? `Gunakan sambutan seperti: "${this.config.welcomeMessage}"` : ''}`;
      }

      const result = await this.agent.processMessage(messageContent, msg.from, contactName);
      const response = result.response;
      const pendingMessages = result.pendingMessages;

      // 6. Stop typing indicator
      clearInterval(typingInterval);
      this.whatsapp.sendPresenceUpdate?.('paused', jid)?.catch(e =>
        this.logger.warn({ error: e.message }, 'Failed to pause presence')
      );

      // 7. Send pending messages from tools (send_message, send_image)
      for (const pm of pendingMessages) {
        try {
          if (pm.type === 'image' && pm.imageUrl) {
            await this.whatsapp.sendMessage(pm.to, pm.imageUrl);
          } else {
            await this.whatsapp.sendMessage(pm.to, pm.content);
          }
          this.db.incrementMessageCount('outgoing');
        } catch (err: any) {
          this.logger.error({ error: err.message, to: pm.to }, 'Failed to send pending message');
        }
      }

      if (response) {
        // 7. Human-like post-delay (simulate typing speed)
        const postDelay = calculateTypingDelay(response);
        if (postDelay > 0) {
          await sleep(postDelay);
        }

        const sentMsg = await this.whatsapp.sendMessage(msg.from, response);
        this.db.saveMessage(sentMsg, chatId);
        this.db.incrementMessageCount('outgoing');
        this.db.saveChat({
          id: chatId, contactId: msg.from, contactName: contact.name,
          lastMessage: response, lastMessageAt: sentMsg.timestamp,
          unreadCount: 0, isGroup: contact.isGroup,
          createdAt: existingChat?.createdAt || new Date(),
        });
        this.eventBus.emit({ type: 'message:sent', message: sentMsg });

        // ── Check if AI response indicates inability to answer ──
        // If the AI says it doesn't know / can't answer, escalate
        if (response.length > 0 && response.length < 100 && this.canEscalate(msg.from)) {
          const lowerResp = response.toLowerCase();
          const unableKeywords = ['tidak tahu', 'tidak bisa jawab', 'tidak punya informasi', 'belum punya data',
            'tidak memiliki informasi', 'tidak dapat menjawab', 'di luar pengetahuan',
            'tidak tersedia', 'belum ada informasi'];
          if (unableKeywords.some(k => lowerResp.includes(k))) {
            this.logger.info({ from: msg.from }, 'AI unable to answer — escalating to Telegram');
            this.escalation.escalate({
              contactId: msg.from,
              contactName: contact.name,
              customerMessage: messageContent,
              reason: 'ai_empty_response',
              details: `AI response: "${response.substring(0, 200)}"`,
            }).catch(err => {
              this.logger.warn({ error: err.message, from: msg.from }, 'Failed to escalate to Telegram');
            });
          }
        }
      } else if (this.canEscalate(msg.from)) {
        // No response from AI — escalate
        this.logger.info({ from: msg.from }, 'AI returned empty response — escalating to Telegram');
        this.escalation.escalate({
          contactId: msg.from,
          contactName: contact.name,
          customerMessage: messageContent,
          reason: 'ai_empty_response',
          details: 'AI tidak mengembalikan response apapun',
        }).catch(err => {
          this.logger.warn({ error: err.message, from: msg.from }, 'Failed to escalate empty response to Telegram');
        });
      }
    } catch (err: any) {
      clearInterval(typingInterval);
      this.whatsapp.sendPresenceUpdate?.('paused', jid)?.catch(() => {});
      this.logger.error({ error: err.message }, 'Error handling message');
      // Escalate on AI error (with dedup guard)
      if (this.canEscalate(jid)) {
        this.escalation.escalate({
          contactId: jid,
          contactName: contact.name,
          customerMessage: messageContent,
          reason: 'ai_error',
          details: err.message,
        }).catch(err2 => {
          this.logger.warn({ error: err2.message, from: jid }, 'Failed to escalate AI error to Telegram');
        });
      }
    }
  }

  private staleCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private workingHoursInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Periodically clean up stale conversation history
   */
  private startStaleConversationCleanup(): void {
    const timeoutHours = this.config.conversationTimeoutHours;
    if (!timeoutHours || timeoutHours <= 0) return;

    this.logger.info('Conversation timeout enabled: %d hours idle → auto-clear', timeoutHours);

    // Run cleanup every 30 minutes
    this.staleCleanupInterval = setInterval(() => {
      try {
        const cleared = this.db.clearStaleConversations(timeoutHours);
        if (cleared > 0) {
          this.logger.info('Auto-cleared %d stale conversations (idle > %dh)', cleared, timeoutHours);
        }
      } catch (err: any) {
        this.logger.warn({ error: err.message }, 'Stale conversation cleanup failed');
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  private async setOnlinePresence(): Promise<void> {
    if (this.whatsapp.sendPresenceUpdate) {
      try {
        await this.whatsapp.sendPresenceUpdate('available');
      } catch { /* ignore presence errors */ }
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting WAGENT Gateway...');
    this.logger.info('AI Provider: %s', this.agent.getProviderName());
    await this.whatsapp.connect();

    // Start periodic cleanup of stale conversations
    this.startStaleConversationCleanup();

    // Start rate limit entry cleanup
    this.rateLimitCleanupInterval = setInterval(() => this.cleanupRateLimits(), 60_000); // every 60s

    // Start working hours presence check
    if (this.config.workingHoursEnabled) {
      this.workingHoursInterval = setInterval(() => {
        const inHours = this.isWithinWorkingHours();
        this.whatsapp.sendPresenceUpdate?.(inHours ? 'available' : 'unavailable')?.catch(() => {});
      }, 5 * 60 * 1000); // every 5 minutes
      this.logger.info('Working hours: %s-%s %s',
        this.config.workingHoursStart, this.config.workingHoursEnd, this.config.workingHoursTimezone);
    }

    // Set online presence after connection
    setTimeout(() => this.setOnlinePresence(), 2_000);

    if (this.dashboard) {
      await this.dashboard.start(this.config.dashboardPort, this.config.dashboardHost);
    }
    this.scheduler.start();
    this.proactiveScheduler.start();
    this.telegramBot.start();
    this.logger.info('WAGENT Gateway started successfully');
  }

  private hasCustomPrompts(): boolean {
    const customPath = join(process.cwd(), 'prompts/system.toon');
    return existsSync(customPath);
  }

  private async handleSetupInterviewMessage(msg: Message): Promise<void> {
    const text = msg.content.trim();
    const userJid = this.whatsapp.userJid;
    if (!userJid) return;

    // 1. Show typing status
    const composing = () => this.whatsapp.sendPresenceUpdate?.('composing', msg.from)?.catch(() => {});
    await composing();
    const typingInterval = setInterval(composing, 8_000);

    try {
      // 2. Add owner's message to DB history
      this.db.addConversation(userJid, 'user', text);

      // 3. Retrieve chat history
      const history = this.db.getConversationHistory(userJid);
      
      // Limit context to last 20 messages for efficiency and model focus
      const recentHistory = history.slice(-20);

      // 4. Map history to LLM format
      const setupInterviewConfig = promptLoader.load('setup-interview.toon');
      const systemPrompt = setupInterviewConfig?.prompt || `Kamu adalah Setup Assistant AI untuk WAGENT.
Tugasmu adalah memandu Owner (pemilik) melalui chat WhatsApp untuk mengonfigurasi AI WhatsApp Agent mereka.

Lakukan interview satu per satu secara interaktif dan santai. Jangan tanyakan banyak hal sekaligus.
Tanyakan hal-hal berikut secara berurutan:
1. Kebutuhan utama (Bisnis / Asisten Pribadi / Campuran).
2. Jika Bisnis: Nama bisnis, jenis usaha, deskripsi singkat, dan target customer.
   Jika Personal: Nama asisten AI yang diinginkan, dan konteks bantuan harian (misal: jadwal, reminder, dll).
3. Gaya bicara yang diinginkan (Santai, Formal, Profesional, atau Ramah) dan apakah boleh menggunakan emoji.
4. Jam operasional (jika ada).
5. Aturan penting (apa saja yang boleh dan TIDAK boleh dilakukan AI).

Begitu semua informasi penting terkumpul:
1. Buatlah rangkuman ringkas tentang racikan tersebut kepada Owner.
2. Panggil tool 'save_prompt_setup' dengan argumen data JSON yang lengkap untuk menulis konfigurasi tersebut ke sistem.
3. Beritahu Owner bahwa bot akan di-restart otomatis untuk menerapkan konfigurasi tersebut.

Penting: Jawab dengan bahasa Indonesia yang ramah, sopan, dan to-the-point. Tanyakan HANYA satu pertanyaan/topik dalam satu respons.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...recentHistory.map(h => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.content,
        }))
      ];

      // 5. Setup tool definition for saving
      const tools: ToolDefinition[] = [
        {
          name: 'save_prompt_setup',
          description: 'Simpan konfigurasi hasil interview setup ke file prompt kustom dan restart bot.',
          parameters: {
            type: 'object',
            properties: {
              useCase: { type: 'string', enum: ['business', 'personal', 'hybrid'] },
              businessName: { type: 'string' },
              businessType: { type: 'string' },
              businessDescription: { type: 'string' },
              targetCustomer: { type: 'string' },
              personalName: { type: 'string' },
              personalContext: { type: 'string' },
              tone: { type: 'string', enum: ['casual', 'formal', 'professional', 'friendly'] },
              emojiUsage: { type: 'string', enum: ['rare', 'moderate', 'frequent'] },
              language: { type: 'string' },
              greeting: { type: 'string' },
              workingHours: { type: 'string' },
              forbiddenActions: { type: 'array', items: { type: 'string' } },
              escalationTriggers: { type: 'array', items: { type: 'string' } },
              features: { type: 'array', items: { type: 'string' } }
            },
            required: ['useCase', 'tone', 'emojiUsage']
          },
          handler: async (args: Record<string, any>) => {
            const useCase = args.useCase || 'personal';
            const answers = {
              businessName: args.businessName || args.personalName || 'My WAGENT',
              businessType: args.businessType || (useCase === 'personal' ? 'personal-assistant' : 'general'),
              businessDescription: args.businessDescription || args.personalContext || 'Asisten pribadi cerdas',
              targetCustomer: args.targetCustomer || 'Owner',
              tone: (args.tone || 'casual') as 'casual' | 'formal' | 'professional' | 'friendly',
              emojiUsage: (args.emojiUsage || 'moderate') as 'rare' | 'moderate' | 'frequent',
              language: args.language || 'id',
              greeting: args.greeting || 'Halo!',
              frequentQuestions: args.frequentQuestions || [],
              orderProcess: args.orderProcess || '',
              paymentMethods: args.paymentMethods || '',
              shippingTime: args.shippingTime || '',
              returnPolicy: args.returnPolicy || '',
              forbiddenActions: args.forbiddenActions || [],
              escalationTriggers: args.escalationTriggers || [],
              workingHours: args.workingHours || '24 jam',
              features: args.features || ['web_search', 'reminder'],
              welcomeMessage: args.welcomeMessage || args.greeting || 'Halo! Ada yang bisa saya bantu?',
              errorMessage: args.errorMessage || 'Maaf, saya mengalami kendala teknis.',
              offlineMessage: args.offlineMessage || 'Di luar jam operasional.',
            };

            try {
              const generator = new PromptGenerator(this.config);
              await generator.generateWithAI(answers);
              
              // Send confirmation message to owner
              await this.whatsapp.sendMessage(userJid, `✅ *Konfigurasi Berhasil Disimpan!*\n\nBerkas kustom Anda telah ditulis ke direktori \`prompts/\`.\nBot akan me-restart secara otomatis dalam 2 detik untuk menerapkan kepribadian baru Anda.`);
              
              // Schedule exit after sending response
              setTimeout(() => {
                this.logger.info('Restarting bot after setup completion');
                process.exit(0);
              }, 2000);

              return JSON.stringify({ success: true, message: 'Configuration saved and bot restart scheduled.' });
            } catch (err: any) {
              return JSON.stringify({ success: false, error: err.message });
            }
          }
        }
      ];

      // 6. Get the AI response using provider.chat
      const provider = this.agent.getProvider();
      const response = await provider.chat(messages, tools);

      clearInterval(typingInterval);
      this.whatsapp.sendPresenceUpdate?.('paused', msg.from)?.catch(() => {});

      // 7. Handle LLM output or tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          if (toolCall.function.name === 'save_prompt_setup') {
            const tool = tools[0];
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const toolContext = {
              logger: this.logger,
              db: this.db,
              config: this.config,
              contactId: userJid,
            };
            await tool.handler!(args, toolContext);
            return;
          }
        }
      }

      // If no tool call, reply with assistant text response
      const aiReply = response.content || '';
      if (aiReply) {
        this.db.addConversation(userJid, 'assistant', aiReply);
        await this.whatsapp.sendMessage(userJid, aiReply);
      } else {
        await this.whatsapp.sendMessage(userJid, 'Maaf, saya tidak mengerti. Bisa diulang?');
      }

    } catch (err: any) {
      clearInterval(typingInterval);
      this.whatsapp.sendPresenceUpdate?.('paused', msg.from)?.catch(() => {});
      this.logger.error({ error: err.message }, 'Error in setup interview');
      await this.whatsapp.sendMessage(msg.from, `❌ Error during setup: ${err.message}`);
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping WAGENT Gateway...');
    this.scheduler.stop();
    this.proactiveScheduler.stop();
    this.telegramBot.stop();
    this.approvalQueue.destroy();
    if (this.staleCleanupInterval) {
      clearInterval(this.staleCleanupInterval);
      this.staleCleanupInterval = null;
    }
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
    }
    if (this.workingHoursInterval) {
      clearInterval(this.workingHoursInterval);
      this.workingHoursInterval = null;
    }
    this.humanActiveMap.forEach((_, jid) => {
      this.eventBus.emit({ type: 'human:inactive', chatId: jid });
    });
    this.humanActiveMap.clear();
    if (this.dashboard) await this.dashboard.stop();
    // Set offline presence before disconnect
    this.whatsapp.sendPresenceUpdate?.('unavailable')?.catch(() => {});
    await this.whatsapp.disconnect();
    this.setStatus('disconnected');
    this.eventBus.removeAll();
    this.logger.info('WAGENT Gateway stopped');
  }
}
