import { Logger } from 'pino';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { WhatsAppAdapter } from './gateway.js';
import {
  WAgentConfig,
  WhatsAppNumberConfig,
  WhatsAppNumberInfo,
  ConnectionStatus,
  GatewayEvent,
  Message,
  Contact,
  AudioMessageData,
} from './types.js';
import { getLogger } from './logger.js';

type AdapterFactory = (config: WAgentConfig, numberId: string) => WhatsAppAdapter;

/**
 * MultiWhatsAppAdapter implements WhatsAppAdapter by composing multiple
 * BaileysAdapter instances. The Gateway works unchanged — just pass this
 * adapter instead of a single-number adapter.
 *
 * Uses a JID routing table: when a message is received from JID X via number N,
 * replies to X will be sent through number N.
 */
export class MultiWhatsAppAdapter implements WhatsAppAdapter {
  private adapters: Map<string, WhatsAppAdapter> = new Map();
  private numberConfigs: Map<string, WhatsAppNumberConfig> = new Map();
  private eventHandler: ((event: GatewayEvent) => void) | null = null;
  private logger: Logger;
  private jidRouteTable = new Map<string, string>(); // jid → numberId

  constructor(
    private config: WAgentConfig,
    private adapterFactory: AdapterFactory,
    initialNumbers?: WhatsAppNumberConfig[]
  ) {
    this.logger = getLogger().child({ module: 'multi-adapter' });
    if (initialNumbers) {
      for (const n of initialNumbers) {
        this.numberConfigs.set(n.id, n);
      }
    }
  }

  // ── WhatsAppAdapter implementation ────────────────────────────

  async connect(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, cfg] of this.numberConfigs) {
      if (cfg.enabled) {
        promises.push(this.connectInner(id, cfg));
      }
    }
    await Promise.allSettled(promises);
    this.logger.info('All numbers connection initiated');
  }

  async disconnect(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, adapter] of this.adapters) {
      promises.push(adapter.disconnect());
    }
    await Promise.allSettled(promises);
    this.adapters.clear();
    this.jidRouteTable.clear();
    this.logger.info('All numbers disconnected');
  }

  async sendMessage(to: string, content: string): Promise<Message> {
    // Look up the JID in the routing table to find the correct adapter
    const numberId = this.jidRouteTable.get(to);
    if (numberId) {
      const adapter = this.adapters.get(numberId);
      if (adapter?.isConnected()) {
        return adapter.sendMessage(to, content);
      }
    }

    // Fallback: use any connected adapter
    for (const adapter of this.adapters.values()) {
      if (adapter.isConnected()) {
        return adapter.sendMessage(to, content);
      }
    }
    throw new Error('No connected WhatsApp number available for JID: ' + to);
  }

  getConnectionStatus(): ConnectionStatus {
    const connected = this.getConnectedCount();
    if (connected === 0) return 'disconnected';
    if (connected >= this.numberConfigs.size) return 'connected';
    return 'connecting';
  }

  async getContacts(): Promise<Contact[]> {
    const all: Contact[] = [];
    for (const adapter of this.adapters.values()) {
      try { all.push(...(await adapter.getContacts())); } catch {}
    }
    return all;
  }

  isConnected(): boolean {
    return this.getConnectedCount() > 0;
  }

  onEvent(handler: (event: GatewayEvent) => void): void {
    this.eventHandler = handler;
  }

  downloadAudio?(msg: any): Promise<AudioMessageData> {
    // Audio download is handled per-adapter; msg should contain numberId
    const numberId = msg?.numberId || 'default';
    const adapter = this.adapters.get(numberId);
    if (adapter?.downloadAudio) {
      return adapter.downloadAudio(msg);
    }
    throw new Error(`No download method for number ${numberId}`);
  }

  async sendPresenceUpdate(type: 'composing' | 'paused' | 'available' | 'unavailable', toJid?: string): Promise<void> {
    // For global presence (available/unavailable) or no JID, broadcast to all
    if (type === 'available' || type === 'unavailable' || !toJid) {
      await Promise.allSettled(
        Array.from(this.adapters.values()).map(a => a.sendPresenceUpdate?.(type, toJid) || Promise.resolve())
      );
      return;
    }
    // For composing/paused, route to the specific adapter via JID routing table
    const numberId = this.jidRouteTable.get(toJid);
    if (numberId) {
      await this.adapters.get(numberId)?.sendPresenceUpdate?.(type, toJid);
    }
  }

  async readMessages(jid: string, messageKeys: { id: string; fromMe?: boolean }[]): Promise<void> {
    const numberId = this.jidRouteTable.get(jid);
    if (numberId) {
      await this.adapters.get(numberId)?.readMessages?.(jid, messageKeys);
    }
  }

  // ── Multi-number management ───────────────────────────────────

  async addNumber(cfg: WhatsAppNumberConfig): Promise<void> {
    this.numberConfigs.set(cfg.id, cfg);
    await this.connectInner(cfg.id, cfg);
    this.persist();
  }

  async removeNumber(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
    }
    this.numberConfigs.delete(id);
    this.persist();
  }

  async connectNumber(id: string): Promise<void> {
    const cfg = this.numberConfigs.get(id);
    if (!cfg) throw new Error(`Number ${id} not found`);
    await this.connectInner(id, cfg);
  }

  async disconnectNumber(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
    }
  }

  getNumbers(): WhatsAppNumberInfo[] {
    const result: WhatsAppNumberInfo[] = [];
    for (const [id, cfg] of this.numberConfigs) {
      const adapter = this.adapters.get(id);
      result.push({
        id,
        sessionName: cfg.sessionName,
        label: cfg.label || cfg.sessionName,
        status: adapter?.getConnectionStatus() || 'disconnected',
      });
    }
    return result;
  }

  getConnectedCount(): number {
    let count = 0;
    for (const adapter of this.adapters.values()) {
      if (adapter.isConnected()) count++;
    }
    return count;
  }

  // ── Internal ──────────────────────────────────────────────────

  private async connectInner(id: string, cfg: WhatsAppNumberConfig): Promise<void> {
    let adapter = this.adapters.get(id);
    if (!adapter) {
      const adapterCfg: WAgentConfig = {
        ...this.config,
        whatsappSessionName: cfg.sessionName,
        whatsappSessionDir: join(this.config.whatsappSessionDir || join(process.cwd(), '.sessions')),
      };
      adapter = this.adapterFactory(adapterCfg, id);
      adapter.onEvent((event) => {
        const enriched = this.enrichEvent(event, id);
        if (this.eventHandler) this.eventHandler(enriched);
      });
      this.adapters.set(id, adapter);
    }
    await adapter.connect();
  }

  private enrichEvent(event: GatewayEvent, numberId: string): GatewayEvent {
    if (event.type === 'message:received') {
      // Register JID → numberId for reply routing
      this.jidRouteTable.set(event.message.from, numberId);
      return { ...event, message: { ...event.message, metadata: { ...event.message.metadata, numberId } } };
    }
    if (event.type === 'message:sent') {
      return { ...event, message: { ...event.message, metadata: { ...event.message.metadata, numberId } } };
    }
    return event;
  }

  private persist(): void {
    try {
      const filePath = join(process.cwd(), 'data', 'numbers.json');
      const dir = join(process.cwd(), 'data');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, JSON.stringify(Array.from(this.numberConfigs.values()), null, 2));
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to persist number configs');
    }
  }
}
