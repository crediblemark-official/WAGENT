import { Logger } from 'pino';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { WhatsAppAdapter } from './gateway.js';
import { EventBus } from './event-bus.js';
import {
  WAgentConfig,
  WhatsAppNumberConfig,
  WhatsAppNumberInfo,
  ConnectionStatus,
  GatewayEvent,
  Message,
} from './types.js';
import { getLogger } from './logger.js';

type AdapterFactory = (config: WAgentConfig, numberId: string) => WhatsAppAdapter;

export class MultiNumberManager {
  private adapters: Map<string, WhatsAppAdapter> = new Map();
  private numberConfigs: Map<string, WhatsAppNumberConfig> = new Map();
  private eventHandler: ((event: GatewayEvent) => void) | null = null;
  private logger: Logger;
  private baseSessionDir: string;

  constructor(
    private config: WAgentConfig,
    private adapterFactory: AdapterFactory
  ) {
    this.logger = getLogger().child({ module: 'multi-number' });
    this.baseSessionDir = config.whatsappSessionDir || join(process.cwd(), '.sessions');
  }

  onEvent(handler: (event: GatewayEvent) => void): void {
    this.eventHandler = handler;
  }

  async loadAndConnect(numbers: WhatsAppNumberConfig[]): Promise<void> {
    for (const numConfig of numbers) {
      this.numberConfigs.set(numConfig.id, numConfig);
    }
    this.logger.info('Loaded %d number configs', numbers.length);
    await this.connectAll();
  }

  addConfig(numConfig: WhatsAppNumberConfig): void {
    this.numberConfigs.set(numConfig.id, numConfig);
  }

  removeConfig(id: string): void {
    this.numberConfigs.delete(id);
  }

  private createAdapter(numConfig: WhatsAppNumberConfig): WhatsAppAdapter {
    // Create config override for this specific number
    const adapterConfig: WAgentConfig = {
      ...this.config,
      whatsappSessionName: numConfig.sessionName,
      whatsappSessionDir: this.baseSessionDir,
    };

    const adapter = this.adapterFactory(adapterConfig, numConfig.id);

    adapter.onEvent((event) => {
      const enriched = this.enrichEvent(event, numConfig.id);
      if (this.eventHandler) {
        this.eventHandler(enriched);
      }
    });

    this.adapters.set(numConfig.id, adapter);
    return adapter;
  }

  private enrichEvent(event: GatewayEvent, numberId: string): GatewayEvent {
    if (event.type === 'message:received') {
      return {
        ...event,
        message: { ...event.message, metadata: { ...event.message.metadata, numberId } },
      };
    }
    if (event.type === 'message:sent') {
      return {
        ...event,
        message: { ...event.message, metadata: { ...event.message.metadata, numberId } },
      };
    }
    return event;
  }

  async connectNumber(id: string): Promise<void> {
    const config = this.numberConfigs.get(id);
    if (!config) throw new Error(`Number config ${id} not found`);

    let adapter = this.adapters.get(id);
    if (!adapter) {
      adapter = this.createAdapter(config);
    }
    await adapter.connect();
    this.persistConfigs();
  }

  async disconnectNumber(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
    }
  }

  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, config] of this.numberConfigs) {
      if (config.enabled) {
        let adapter = this.adapters.get(id);
        if (!adapter) {
          adapter = this.createAdapter(config);
        }
        promises.push(adapter.connect().catch(err => {
          this.logger.error({ id, error: err.message }, 'Failed to connect number');
        }));
      }
    }
    await Promise.allSettled(promises);
    this.logger.info('All numbers connection initiated');
  }

  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, adapter] of this.adapters) {
      promises.push(adapter.disconnect());
    }
    await Promise.allSettled(promises);
    this.adapters.clear();
  }

  async sendMessage(numberId: string, to: string, content: string): Promise<Message> {
    const adapter = this.adapters.get(numberId);
    if (!adapter) throw new Error(`Number ${numberId} not connected`);
    return adapter.sendMessage(to, content);
  }

  getNumbers(): WhatsAppNumberInfo[] {
    const result: WhatsAppNumberInfo[] = [];
    for (const [id, config] of this.numberConfigs) {
      const adapter = this.adapters.get(id);
      result.push({
        id,
        sessionName: config.sessionName,
        label: config.label || config.sessionName,
        status: adapter?.getConnectionStatus() || 'disconnected',
      });
    }
    return result;
  }

  getAdapter(id: string): WhatsAppAdapter | undefined {
    return this.adapters.get(id);
  }

  getConnectedCount(): number {
    let count = 0;
    for (const adapter of this.adapters.values()) {
      if (adapter.isConnected()) count++;
    }
    return count;
  }

  isConnected(): boolean {
    return this.getConnectedCount() > 0;
  }

  getConnectionStatus(): ConnectionStatus {
    const connected = this.getConnectedCount();
    if (connected === 0) return 'disconnected';
    if (connected >= this.numberConfigs.size) return 'connected';
    return 'connecting';
  }

  private persistConfigs(): void {
    try {
      const filePath = join(process.cwd(), 'data', 'numbers.json');
      const dir = join(process.cwd(), 'data');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const configs = Array.from(this.numberConfigs.values());
      writeFileSync(filePath, JSON.stringify(configs, null, 2));
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to persist number configs');
    }
  }
}
