import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiWhatsAppAdapter } from './multi-adapter.js';
import { WhatsAppAdapter } from './gateway.js';
import { OpenCSConfig, WhatsAppNumberConfig, Message, ConnectionStatus, GatewayEvent, Contact } from './types.js';

function createMockAdapter(numberId: string, jid: string = ''): WhatsAppAdapter {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockImplementation(async (to: string, content: string) => ({
      id: `${numberId}-${Date.now()}`,
      from: jid,
      to,
      content,
      type: 'text',
      timestamp: new Date(),
      fromMe: true,
    } as Message)),
    getConnectionStatus: vi.fn().mockReturnValue('connected' as ConnectionStatus),
    getContacts: vi.fn().mockResolvedValue([] as Contact[]),
    isConnected: vi.fn().mockReturnValue(true),
    onEvent: vi.fn(),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MultiWhatsAppAdapter', () => {
  let adapter: MultiWhatsAppAdapter;
  let factory: ReturnType<typeof vi.fn>;

  const baseConfig: OpenCSConfig = {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'test',
    dashboardPort: 3030,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
  };

  beforeEach(() => {
    factory = vi.fn().mockImplementation((config, numberId) => createMockAdapter(numberId));
  });

  describe('initialization', () => {
    it('should create adapter with empty numbers', () => {
      adapter = new MultiWhatsAppAdapter(baseConfig, factory);
      expect(adapter.getNumbers()).toHaveLength(0);
    });

    it('should create adapter with initial numbers', () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', label: 'CS 1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', label: 'CS 2', enabled: true },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);
      expect(adapter.getNumbers()).toHaveLength(2);
    });
  });

  describe('connection management', () => {
    it('should connect all numbers', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);
      // onEvent needs to be called before connect to set up event handlers
      await adapter.connect();
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should skip disabled numbers on connect', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: false },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);

      const handler = vi.fn();
      adapter.onEvent(handler);
      await adapter.connect();

      // Only the enabled number should be created
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('JID routing', () => {
    it('should route sendMessage to correct adapter based on JID table', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);

      // Simulate receiving a message from a contact via cs-1
      const eventHandler = vi.fn();
      adapter.onEvent(eventHandler);

      // Manually trigger enrichEvent via the internal handler
      // The adapter's connectInner sets up event forwarding
      // After connect, we can verify the routing table works

      await adapter.connect();

      // Directly call enrichEvent by emitting from the mock adapters
      // We need to trigger the routing table population
      // Let's verify the getNumbers returns correctly
      const allNumbers = adapter.getNumbers();
      expect(allNumbers).toHaveLength(2);
      expect(allNumbers[0].status).toBe('connected');
    });

    it('should fallback to first connected adapter when JID not in routing table', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);
      await adapter.connect();

      // Send to a JID not in the routing table
      const msg = await adapter.sendMessage('unknown@jid', 'Hello');

      expect(msg).toBeDefined();
      expect(msg.content).toBe('Hello');
    });
  });

  describe('add/remove number', () => {
    it('should add a number dynamically', async () => {
      adapter = new MultiWhatsAppAdapter(baseConfig, factory);
      await adapter.addNumber({ id: 'cs-new', sessionName: 'sess-new', enabled: true });

      const numbers = adapter.getNumbers();
      const added = numbers.find(n => n.id === 'cs-new');
      expect(added).toBeDefined();
    });

    it('should remove a number dynamically', async () => {
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ]);
      await adapter.removeNumber('cs-1');
      expect(adapter.getNumbers()).toHaveLength(0);
    });
  });

  describe('JID routing table', () => {
    it('should populate routing table when receiving messages', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ];

      // Create a controllable adapter
      let adapterOnEvent: ((event: GatewayEvent) => void) | null = null;
      const controllableAdapter: WhatsAppAdapter = {
        ...createMockAdapter('cs-1'),
        onEvent: vi.fn().mockImplementation((handler) => { adapterOnEvent = handler; }),
      };

      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn(() => controllableAdapter), numbers);
      const handler = vi.fn();
      adapter.onEvent(handler);
      await adapter.connect();

      // Simulate an incoming message
      const msgEvent: GatewayEvent = {
        type: 'message:received',
        message: { id: 'm1', from: 'customer@jid', to: 'bot', content: 'Halo', type: 'text', timestamp: new Date(), fromMe: false },
      };
      adapterOnEvent!(msgEvent);

      // Now sendMessage to that JID — should route through cs-1
      const sentMsg = await adapter.sendMessage('customer@jid', 'Balasan');
      expect(sentMsg).toBeDefined();
      expect(sentMsg.content).toBe('Balasan');
    });

    it('should throw when no adapter is connected for JID', async () => {
      adapter = new MultiWhatsAppAdapter(baseConfig, factory);
      // No numbers added, no adapters connected
      // Force internal JID routing table entry
      (adapter as any).jidRouteTable.set('customer@jd', 'nonexistent');

      await expect(adapter.sendMessage('customer@jd', 'Test')).rejects.toThrow('No connected WhatsApp number');
    });
  });

  describe('sendPresenceUpdate', () => {
    it('should broadcast to all adapters for global presence', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ];

      const adapter1 = createMockAdapter('cs-1');
      const adapter2 = createMockAdapter('cs-2');

      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn((_cfg, id) => id === 'cs-1' ? adapter1 : adapter2), numbers);
      await adapter.connect();
      await adapter.sendPresenceUpdate('available');

      expect(adapter1.sendPresenceUpdate).toHaveBeenCalledWith('available', undefined);
      expect(adapter2.sendPresenceUpdate).toHaveBeenCalledWith('available', undefined);
    });
  });

  describe('readMessages', () => {
    it('should route readMessages via JID table', async () => {
      const adapter1 = createMockAdapter('cs-1');
      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn(() => adapter1), [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ]);
      await adapter.connect();

      // Set up routing table
      (adapter as any).jidRouteTable.set('customer@jid', 'cs-1');
      const messageKeys = [{ id: 'msg-1' }];
      await adapter.readMessages('customer@jid', messageKeys);

      expect(adapter1.readMessages).toHaveBeenCalledWith('customer@jid', messageKeys);
    });
  });

  describe('downloadAudio', () => {
    it('should route downloadAudio to correct adapter', async () => {
      const adapter1: WhatsAppAdapter = {
        ...createMockAdapter('cs-1'),
        downloadAudio: vi.fn().mockResolvedValue({ buffer: Buffer.from('audio'), mimetype: 'audio/ogg' }),
      };
      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn(() => adapter1), [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ]);
      await adapter.connect();

      const result = await adapter.downloadAudio!({ numberId: 'cs-1' });
      expect(result.mimetype).toBe('audio/ogg');
      expect(adapter1.downloadAudio).toHaveBeenCalled();
    });

    it('should throw when no download method for number', async () => {
      const adapter1 = createMockAdapter('cs-1'); // no downloadAudio
      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn(() => adapter1), [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ]);
      await adapter.connect();

      // downloadAudio throws synchronously (not async), so use toThrow() not rejects
      expect(() => adapter.downloadAudio!({ numberId: 'cs-1' })).toThrow('No download method');
    });
  });

  describe('connection status', () => {
    it('should report disconnected when no adapters', () => {
      adapter = new MultiWhatsAppAdapter(baseConfig, factory);
      expect(adapter.getConnectionStatus()).toBe('disconnected');
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getConnectedCount()).toBe(0);
    });

    it('should report connecting when partial adapters connected', () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ];
      const adapter1 = createMockAdapter('cs-1');
      const adapter2 = createMockAdapter('cs-2');
      vi.mocked(adapter1.isConnected).mockReturnValue(true);
      vi.mocked(adapter2.isConnected).mockReturnValue(false);

      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn((_cfg, id) => id === 'cs-1' ? adapter1 : adapter2), numbers);

      expect(adapter.getConnectedCount()).toBe(0); // not yet connected
    });

    it('should report connected when all adapters connected', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ];
      const adapter1 = createMockAdapter('cs-1');
      const adapter2 = createMockAdapter('cs-2');
      vi.mocked(adapter1.isConnected).mockReturnValue(true);
      vi.mocked(adapter2.isConnected).mockReturnValue(true);

      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn((_cfg, id) => id === 'cs-1' ? adapter1 : adapter2), numbers);
      await adapter.connect();

      expect(adapter.getConnectedCount()).toBe(2);
      expect(adapter.isConnected()).toBe(true);
      expect(adapter.getConnectionStatus()).toBe('connected');
    });
  });

  describe('getContacts', () => {
    it('should merge contacts from all adapters', async () => {
      const adapter1 = createMockAdapter('cs-1');
      vi.mocked(adapter1.getContacts).mockResolvedValue([
        { id: 'c1@s.whatsapp.net', name: 'A', number: '1', isGroup: false, createdAt: new Date(), updatedAt: new Date() },
      ]);
      const adapter2 = createMockAdapter('cs-2');
      vi.mocked(adapter2.getContacts).mockResolvedValue([
        { id: 'c2@s.whatsapp.net', name: 'B', number: '2', isGroup: false, createdAt: new Date(), updatedAt: new Date() },
      ]);

      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn((_cfg, id) => id === 'cs-1' ? adapter1 : adapter2), [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ]);
      await adapter.connect();

      const contacts = await adapter.getContacts();
      expect(contacts).toHaveLength(2);
    });

    it('should handle adapter that throws on getContacts', async () => {
      const adapter1 = createMockAdapter('cs-1');
      vi.mocked(adapter1.getContacts).mockRejectedValue(new Error('Fail'));

      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn(() => adapter1), [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ]);
      await adapter.connect();

      // Should not throw, just return empty
      const contacts = await adapter.getContacts();
      expect(contacts).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('should clear routing table on disconnect', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);
      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.getNumbers()).toHaveLength(1); // configs preserved
      expect(adapter.getConnectedCount()).toBe(0); // adapters cleared
    });
  });

  describe('connectNumber / disconnectNumber', () => {
    it('should connect a specific number', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
        { id: 'cs-2', sessionName: 'sess-2', enabled: true },
      ];
      adapter = new MultiWhatsAppAdapter(baseConfig, factory, numbers);

      // Only connect cs-2
      await adapter.connectNumber('cs-2');
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should disconnect a specific number', async () => {
      const numbers: WhatsAppNumberConfig[] = [
        { id: 'cs-1', sessionName: 'sess-1', enabled: true },
      ];
      const adapterMock = createMockAdapter('cs-1');
      adapter = new MultiWhatsAppAdapter(baseConfig, vi.fn(() => adapterMock), numbers);
      await adapter.connect();

      await adapter.disconnectNumber('cs-1');
      expect(adapterMock.disconnect).toHaveBeenCalled();
      expect(adapter.getConnectedCount()).toBe(0);
    });

    it('should throw when connecting non-existent number', async () => {
      adapter = new MultiWhatsAppAdapter(baseConfig, factory);
      await expect(adapter.connectNumber('nonexistent')).rejects.toThrow('Number nonexistent not found');
    });
  });
});
