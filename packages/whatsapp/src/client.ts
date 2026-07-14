import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import {
  WhatsAppAdapter,
  GatewayEvent,
  Message,
  ConnectionStatus,
  Contact,
  WAgentConfig,
  AudioMessageData,
  isEncryptionAvailable,
  getEncryptionKey,
  decryptDirectory,
  encryptDirectory,
} from '@wagent/core';
import { getLogger } from '@wagent/core';

export class BaileysAdapter implements WhatsAppAdapter {
  public readonly numberId: string;
  public _userJid: string = '';
  private sock: WASocket | null = null;
  private eventHandler: ((event: GatewayEvent) => void) | null = null;
  private status: ConnectionStatus = 'disconnected';
  private sessionDir: string;
  private logger = getLogger().child({ module: 'whatsapp' });
  private qrCallback: ((qr: string) => void) | null = null;
  private onReadyCallback: (() => void) | null = null;
  private encryptionKey: Buffer | null = null;

  constructor(config: WAgentConfig, numberId?: string) {
    this.numberId = numberId || 'default';
    this.logger = getLogger().child({ module: 'whatsapp', numberId: this.numberId });
    this.sessionDir = join(
      config.whatsappSessionDir || join(process.cwd(), '.sessions'),
      config.whatsappSessionName
    );

    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    // Set up encryption key if available
    if (isEncryptionAvailable()) {
      this.encryptionKey = Buffer.from(getEncryptionKey()!, 'hex');
    }
  }

  onEvent(handler: (event: GatewayEvent) => void): void {
    this.eventHandler = handler;
  }

  onQR(callback: (qr: string) => void): void {
    this.qrCallback = callback;
  }

  onReady(callback: () => void): void {
    this.onReadyCallback = callback;
  }

  get userJid(): string {
    return this._userJid;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  // ── Connection ────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.logger.info('Initializing WhatsApp connection...');

    // Auto-decrypt session directory before connecting
    if (this.encryptionKey) {
      const decrypted = decryptDirectory(this.sessionDir, this.encryptionKey, true);
      if (decrypted > 0) {
        this.logger.info('Decrypted %d session files before connect', decrypted);
      }
    }
    this.status = 'connecting';
    this.emit({ type: 'connection:update', status: 'connecting' });

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['WAGENT', 'Chrome', '0.1.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Handle QR & connection updates
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status = 'qr';
        this.emit({ type: 'connection:update', status: 'qr' });
        this.emit({ type: 'qr:received', qr });

        // Display QR in terminal
        qrcode.generate(qr, { small: true });

        if (this.qrCallback) {
          this.qrCallback(qr);
        }
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          this.status = 'reconnecting';
          this.emit({ type: 'connection:update', status: 'reconnecting' });
          this.logger.info('Connection closed, reconnecting...');
          await this.connect();
        } else {
          this.status = 'disconnected';
          this.emit({ type: 'connection:update', status: 'disconnected' });
          this.logger.warn('Logged out, please re-scan QR code');
        }
      } else if (connection === 'open') {
        this.status = 'connected';
        this._userJid = this.sock?.user?.id || '';
        this.emit({ type: 'connection:update', status: 'connected' });
        this.logger.info('WhatsApp connected successfully!');

        if (this.onReadyCallback) {
          this.onReadyCallback();
        }
      }
    });

    // Handle credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async (upsert) => {
      if (upsert.type !== 'notify') return;

      for (const msg of upsert.messages) {
        const key = msg.key;
        if (!key || !key.remoteJid) continue;

        // Check for voice note first
        if (this.isVoiceNote(msg)) {
          const message: Message = {
            id: key.id || `${Date.now()}-${Math.random().toString(36).substring(2)}`,
            from: key.remoteJid,
            to: this._userJid,
            content: '🎤 [Pesan Suara]',
            type: 'audio',
            timestamp: msg.messageTimestamp
              ? new Date(Number(msg.messageTimestamp) * 1000)
              : new Date(),
            fromMe: !!key.fromMe,
            metadata: {
              pushName: msg.pushName || '',
              isVoiceNote: true,
              rawMessage: msg,
            },
          };
          this.emit({ type: 'message:received', message });
          continue;
        }

        const content = this.extractMessageContent(msg);
        if (!content) continue;

        // Extract @mentions from extended text messages for group detection
        const mentionedJid = this.extractMentionedJids(msg);

        const message: Message = {
          id: key.id || `${Date.now()}-${Math.random().toString(36).substring(2)}`,
          from: key.remoteJid,
          to: this._userJid,
          content,
          type: 'text',
          timestamp: msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date(),
          fromMe: !!key.fromMe,
          metadata: {
            pushName: msg.pushName || '',
            ...(mentionedJid.length > 0 ? { mentionedJid } : {}),
          },
        };

        this.emit({ type: 'message:received', message });
      }
    });
  }

  private extractMessageContent(msg: any): string | null {
    if (!msg.message) return null;

    const m = msg.message;
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.documentMessage?.caption) return m.documentMessage.caption;
    if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId)
      return m.listResponseMessage.singleSelectReply.selectedRowId;
    if (m.templateButtonReplyMessage?.selectedId) return m.templateButtonReplyMessage.selectedId;

    return null;
  }

  // ── Mention Extraction ────────────────────────────────────────

  /**
   * Extract @mentioned JIDs from an incoming message
   */
  private extractMentionedJids(msg: any): string[] {
    try {
      const m = msg.message;
      if (!m) return [];

      // Check in extendedTextMessage
      if (m.extendedTextMessage?.contextInfo?.mentionedJid) {
        return m.extendedTextMessage.contextInfo.mentionedJid;
      }
      // Check in conversation (some clients use this for mentions)
      if (m.conversationContextInfo?.mentionedJid) {
        return m.conversationContextInfo.mentionedJid;
      }
      return [];
    } catch {
      return [];
    }
  }

  // ── Audio / Voice Note Handler ────────────────────────────────

  isVoiceNote(msg: any): boolean {
    return !!(msg.message?.audioMessage?.ptt === true);
  }

  async downloadAudio(msg: any): Promise<AudioMessageData> {
    const audioMsg = msg.message?.audioMessage;
    if (!audioMsg) {
      throw new Error('No audio message found');
    }

    this.logger.info('Downloading audio message...');
    const stream = await downloadContentFromMessage(audioMsg, 'audio');

    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    return {
      buffer,
      mimetype: audioMsg.mimetype || 'audio/ogg',
      duration: audioMsg.seconds ? Number(audioMsg.seconds) : undefined,
      fileSize: audioMsg.fileLength ? Number(audioMsg.fileLength) : undefined,
    };
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(new Error('Manual disconnect'));
      this.sock = null;
    }
    this.status = 'disconnected';
    this.emit({ type: 'connection:update', status: 'disconnected' });

    // Auto-encrypt session directory after disconnect
    if (this.encryptionKey) {
      const encrypted = encryptDirectory(this.sessionDir, this.encryptionKey, true);
      if (encrypted > 0) {
        this.logger.info('Encrypted %d session files after disconnect', encrypted);
      }
    }
  }

  async sendPresenceUpdate(type: 'composing' | 'paused' | 'available' | 'unavailable', toJid?: string): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.sendPresenceUpdate(type, toJid);
    } catch (err: any) {
      this.logger.debug({ error: err.message, type, toJid }, 'Presence update failed');
    }
  }

  async readMessages(jid: string, messageKeys: { id: string; fromMe?: boolean }[]): Promise<void> {
    if (!this.sock) return;
    try {
      // Skip groups — we need the participant JID which isn't available here
      if (jid.includes('@g.us')) return;

      const keys = messageKeys
        .filter(k => !k.fromMe)
        .map(k => ({
          remoteJid: jid,
          id: k.id,
          fromMe: false as const,
        }));
      if (keys.length > 0) {
        await this.sock.readMessages(keys);
      }
    } catch (err: any) {
      this.logger.debug({ error: err.message, jid }, 'Read receipt failed');
    }
  }

  async sendMessage(to: string, content: string): Promise<Message> {
    if (!this.sock || !this.isConnected()) {
      throw new Error('WhatsApp not connected');
    }

    const sent = await this.sock.sendMessage(to, { text: content });

    return {
      id: sent?.key?.id || `${Date.now()}`,
      from: this._userJid,
      to,
      content,
      type: 'text',
      timestamp: new Date(),
      fromMe: true,
    };
  }

  async getContacts(): Promise<Contact[]> {
    if (!this.sock) return [];

    try {
      // Get contacts from Baileys store
      const store = (this.sock as any)?.store;
      const contactsMap = store?.contacts || {};
      const contacts = Object.values(contactsMap) as any[];

      return contacts
        .filter((c: any) => c.id && !c.id.includes('@g.us') && !c.id.includes('@broadcast'))
        .map((c: any) => ({
          id: c.id,
          name: c.name || c.notify || c.verifiedName || c.id.split('@')[0],
          pushName: c.notify || undefined,
          number: c.id.split('@')[0],
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
    } catch (err) {
      this.logger.warn({ error: err }, 'Failed to fetch contacts');
      return [];
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private emit(event: GatewayEvent): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }
}
