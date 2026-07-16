import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiWhatsAppAdapter } from '../services/multi-adapter.js';
import { WhatsAppNumberConfig, WAgentConfig } from '../types.js';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

function createMockAdapter(overrides: Partial<ReturnType<typeof createMockAdapterState>> = {}) {
  const state = {
    connected: false,
    eventHandler: null as ((event: any) => void) | null,
    connect: vi.fn().mockImplementation(async function () { state.connected = true; }),
    disconnect: vi.fn().mockImplementation(async function () { state.connected = false; }),
    sendMessage: vi.fn().mockResolvedValue({
      id: 'msg-1',
      from: 'bot',
      to: 'target',
      content: 'hello',
      type: 'text' as const,
      timestamp: new Date(),
      fromMe: true,
    }),
    getConnectionStatus: vi.fn().mockReturnValue('disconnected' as const),
    isConnected: vi.fn().mockImplementation(() => state.connected),
    getContacts: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn().mockImplementation((handler: (event: any) => void) => {
      state.eventHandler = handler;
    }),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return state;
}

function createConfig(): WAgentConfig {
  return {
    whatsappSessionName: 'test-session',
    whatsappSessionDir: '/tmp/sessions',
    aiProvider: 'openai',
    systemPrompt: 'test prompt',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
  };
}

function createNumber(id: string, overrides: Partial<WhatsAppNumberConfig> = {}): WhatsAppNumberConfig {
  return { id, sessionName: `session-${id}`, label: `Number ${id}`, enabled: true, ...overrides };
}

function setupAdapter(overrides: Partial<ReturnType<typeof createMockAdapterState>> = {}) {
  const mock = createMockAdapter(overrides);
  const factory = vi.fn().mockReturnValue(mock as any);
  return { mock, factory };
}

describe('MultiWhatsAppAdapter', () => {
  let config: WAgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createConfig();
  });

  describe('connect', () => {
    it('connects all enabled numbers', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const { mock, factory } = setupAdapter();

      const adapter = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await adapter.connect();

      expect(factory).toHaveBeenCalledTimes(2);
      expect(mock.connect).toHaveBeenCalledTimes(2);
    });

    it('skips disabled numbers', async () => {
      const n1 = createNumber('n1', { enabled: false });
      const n2 = createNumber('n2');
      const { mock, factory } = setupAdapter();

      const adapter = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await adapter.connect();

      expect(factory).toHaveBeenCalledTimes(1);
      expect(mock.connect).toHaveBeenCalledTimes(1);
    });

    it('works with no initial numbers', async () => {
      const { factory } = setupAdapter();
      const adapter = new MultiWhatsAppAdapter(config, factory);
      await adapter.connect();
      expect(factory).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('disconnects all adapters and clears state', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const { mock, factory } = setupAdapter();

      const adapter = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await adapter.connect();
      await adapter.disconnect();

      expect(mock.disconnect).toHaveBeenCalledTimes(2);
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getConnectedCount()).toBe(0);
    });
  });

  describe('sendMessage', () => {
    it('routes to correct adapter via JID routing table', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      // Simulate incoming message from JID 'user-x' via adapter n1
      adapter1.eventHandler?.({
        type: 'message:received',
        message: { id: 'm1', from: 'user-x', to: 'bot', content: 'hi', type: 'text', timestamp: new Date(), fromMe: false, metadata: {} },
      });

      const result = await multi.sendMessage('user-x', 'reply');
      expect(adapter1.sendMessage).toHaveBeenCalledWith('user-x', 'reply');
      expect(adapter2.sendMessage).not.toHaveBeenCalled();
      expect(result.id).toBe('msg-1');
    });

    it('falls back to any connected adapter when JID not in route table', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter({ connected: false, isConnected: vi.fn().mockReturnValue(false) });
      const adapter2 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      await multi.sendMessage('new-jid', 'hello');
      expect(adapter2.sendMessage).toHaveBeenCalledWith('new-jid', 'hello');
      expect(adapter1.sendMessage).not.toHaveBeenCalled();
    });

    it('throws when no adapter is connected', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter({ connected: false, isConnected: vi.fn().mockReturnValue(false) });
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      await expect(multi.sendMessage('any-jid', 'msg')).rejects.toThrow(
        'No connected WhatsApp number available for JID: any-jid'
      );
    });

    it('uses JID route adapter even if another is also connected', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      // Route 'user-y' through n2
      adapter2.eventHandler?.({
        type: 'message:received',
        message: { id: 'm1', from: 'user-y', to: 'bot', content: 'hi', type: 'text', timestamp: new Date(), fromMe: false, metadata: {} },
      });

      await multi.sendMessage('user-y', 'reply');
      expect(adapter2.sendMessage).toHaveBeenCalled();
      expect(adapter1.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('getConnectionStatus', () => {
    it('returns disconnected when no adapters are connected', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter({ connected: false, isConnected: vi.fn().mockReturnValue(false) });
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      expect(multi.getConnectionStatus()).toBe('disconnected');
    });

    it('returns connecting when some but not all are connected', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ connected: false, isConnected: vi.fn().mockReturnValue(false) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      expect(multi.getConnectionStatus()).toBe('connecting');
    });

    it('returns connected when all are connected', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      expect(multi.getConnectionStatus()).toBe('connected');
    });
  });

  describe('isConnected', () => {
    it('returns true when at least one adapter is connected', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      expect(multi.isConnected()).toBe(true);
    });

    it('returns false when no adapter is connected', () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);
      expect(multi.isConnected()).toBe(false);
    });
  });

  describe('addNumber / removeNumber', () => {
    it('addNumber creates and connects a new adapter', async () => {
      const { mock, factory } = setupAdapter();
      const multi = new MultiWhatsAppAdapter(config, factory);

      await multi.addNumber(createNumber('n1'));

      expect(factory).toHaveBeenCalledTimes(1);
      expect(mock.connect).toHaveBeenCalledTimes(1);
      expect(multi.getNumbers()).toHaveLength(1);
    });

    it('removeNumber disconnects adapter and removes config', async () => {
      const { mock, factory } = setupAdapter();
      const multi = new MultiWhatsAppAdapter(config, factory);

      await multi.addNumber(createNumber('n1'));
      expect(multi.getNumbers()).toHaveLength(1);

      await multi.removeNumber('n1');
      expect(mock.disconnect).toHaveBeenCalled();
      expect(multi.getNumbers()).toHaveLength(0);
    });

    it('removeNumber handles id not found gracefully', async () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);

      // Should not throw
      await multi.removeNumber('nonexistent');
      expect(multi.getNumbers()).toHaveLength(0);
    });
  });

  describe('getNumbers', () => {
    it('returns all numbers with correct info', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      adapter.getConnectionStatus.mockReturnValue('connected');
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      const numbers = multi.getNumbers();
      expect(numbers).toHaveLength(1);
      expect(numbers[0]).toEqual(
        expect.objectContaining({ id: 'n1', sessionName: 'session-n1', label: 'Number n1', status: 'connected' })
      );
    });

    it('returns empty array when no numbers configured', () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);
      expect(multi.getNumbers()).toEqual([]);
    });

    it('uses sessionName as label fallback', async () => {
      const n1 = createNumber('n1', { label: undefined });
      const factory = vi.fn().mockReturnValue(createMockAdapter() as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const numbers = multi.getNumbers();
      expect(numbers[0].label).toBe('session-n1');
    });
  });

  describe('getConnectedCount', () => {
    it('counts connected adapters correctly', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ connected: false, isConnected: vi.fn().mockReturnValue(false) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      expect(multi.getConnectedCount()).toBe(1);
    });

    it('returns 0 when no adapters exist', () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);
      expect(multi.getConnectedCount()).toBe(0);
    });
  });

  describe('onEvent / enrichEvent', () => {
    it('forwards enriched events from child adapters', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const handler = vi.fn();
      multi.onEvent(handler);
      await multi.connect();

      adapter.eventHandler?.({
        type: 'message:received',
        message: {
          id: 'm1',
          from: 'user-z',
          to: 'bot',
          content: 'hi',
          type: 'text',
          timestamp: new Date(),
          fromMe: false,
          metadata: {},
        },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.type).toBe('message:received');
      expect(event.message.metadata.numberId).toBe('n1');
    });

    it('enriches message:sent events with numberId', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const handler = vi.fn();
      multi.onEvent(handler);
      await multi.connect();

      adapter.eventHandler?.({
        type: 'message:sent',
        message: {
          id: 'm1',
          from: 'bot',
          to: 'user-z',
          content: 'reply',
          type: 'text',
          timestamp: new Date(),
          fromMe: true,
          metadata: {},
        },
      });

      const event = handler.mock.calls[0][0];
      expect(event.type).toBe('message:sent');
      expect(event.message.metadata.numberId).toBe('n1');
    });

    it('enriches non-message events with numberId at top level', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const handler = vi.fn();
      multi.onEvent(handler);
      await multi.connect();

      adapter.eventHandler?.({
        type: 'connection:update',
        status: 'connected',
      });

      const event = handler.mock.calls[0][0];
      expect(event.numberId).toBe('n1');
    });

    it('registers JID routing table on message:received', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const handler = vi.fn();
      multi.onEvent(handler);
      await multi.connect();

      adapter.eventHandler?.({
        type: 'message:received',
        message: {
          id: 'm1',
          from: 'user-route',
          to: 'bot',
          content: 'hello',
          type: 'text',
          timestamp: new Date(),
          fromMe: false,
          metadata: {},
        },
      });

      await multi.sendMessage('user-route', 'back');
      expect(adapter.sendMessage).toHaveBeenCalledWith('user-route', 'back');
    });

    it('does nothing when no event handler is registered', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      // Should not throw
      adapter.eventHandler?.({
        type: 'message:received',
        message: {
          id: 'm1',
          from: 'user',
          to: 'bot',
          content: 'hi',
          type: 'text',
          timestamp: new Date(),
          fromMe: false,
          metadata: {},
        },
      });
    });
  });

  describe('downloadAudio', () => {
    it('delegates to the correct adapter via numberId', async () => {
      const n1 = createNumber('n1');
      const audioData = { buffer: Buffer.from('audio'), mimetype: 'audio/ogg' };
      const adapter = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      (adapter as any).downloadAudio = vi.fn().mockResolvedValue(audioData);
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      const result = await (multi as any).downloadAudio({ numberId: 'n1', key: 'value' });
      expect(result).toEqual(audioData);
    });

    it('throws when adapter not found for numberId', () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);

      expect(() => (multi as any).downloadAudio({ numberId: 'nonexistent' })).toThrow(
        'No download method for number nonexistent'
      );
    });
  });

  describe('sendPresenceUpdate', () => {
    it('broadcasts available/unavailable to all adapters', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter();
      const adapter2 = createMockAdapter();

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();

      await multi.sendPresenceUpdate('available');
      expect(adapter1.sendPresenceUpdate).toHaveBeenCalledWith('available', undefined);
      expect(adapter2.sendPresenceUpdate).toHaveBeenCalledWith('available', undefined);
    });

    it('routes composing/paused to specific adapter via JID table', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const handler = vi.fn();
      multi.onEvent(handler);
      await multi.connect();

      adapter.eventHandler?.({
        type: 'message:received',
        message: {
          id: 'm1',
          from: 'user-c',
          to: 'bot',
          content: 'hi',
          type: 'text',
          timestamp: new Date(),
          fromMe: false,
          metadata: {},
        },
      });

      await multi.sendPresenceUpdate('composing', 'user-c');
      expect(adapter.sendPresenceUpdate).toHaveBeenCalledWith('composing', 'user-c');
    });
  });

  describe('readMessages', () => {
    it('routes read receipts via JID routing table', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      const handler = vi.fn();
      multi.onEvent(handler);
      await multi.connect();

      adapter.eventHandler?.({
        type: 'message:received',
        message: {
          id: 'm1',
          from: 'user-r',
          to: 'bot',
          content: 'hi',
          type: 'text',
          timestamp: new Date(),
          fromMe: false,
          metadata: {},
        },
      });

      await multi.readMessages('user-r', [{ id: 'm1' }]);
      expect(adapter.readMessages).toHaveBeenCalledWith('user-r', [{ id: 'm1' }]);
    });

    it('does nothing when JID not in routing table', async () => {
      const n1 = createNumber('n1');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      await multi.readMessages('unknown-jid', [{ id: 'm1' }]);
      expect(adapter.readMessages).not.toHaveBeenCalled();
    });
  });

  describe('connectNumber / disconnectNumber', () => {
    it('connectNumber connects a specific number', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter();
      const adapter2 = createMockAdapter();

      const factory = vi.fn().mockImplementation((_cfg: any, id: string) => {
        return id === 'n1' ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connectNumber('n2');

      expect(adapter2.connect).toHaveBeenCalled();
      expect(adapter1.connect).not.toHaveBeenCalled();
    });

    it('connectNumber throws for unknown id', async () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);

      await expect(multi.connectNumber('unknown')).rejects.toThrow('Number unknown not found');
    });

    it('disconnectNumber disconnects a specific adapter', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter1 = createMockAdapter();
      const adapter2 = createMockAdapter();

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();
      await multi.disconnectNumber('n1');

      expect(adapter1.disconnect).toHaveBeenCalled();
      expect(adapter2.disconnect).not.toHaveBeenCalled();
    });

    it('disconnectNumber handles unknown id gracefully', async () => {
      const factory = vi.fn();
      const multi = new MultiWhatsAppAdapter(config, factory);
      // Should not throw
      await multi.disconnectNumber('nonexistent');
    });
  });

  describe('getContacts', () => {
    it('aggregates contacts from all adapters', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const contacts1 = [{ id: 'c1', name: 'Alice', number: '1', isGroup: false, createdAt: new Date(), updatedAt: new Date() }];
      const contacts2 = [{ id: 'c2', name: 'Bob', number: '2', isGroup: false, createdAt: new Date(), updatedAt: new Date() }];

      const adapter1 = createMockAdapter({ getContacts: vi.fn().mockResolvedValue(contacts1) });
      const adapter2 = createMockAdapter({ getContacts: vi.fn().mockResolvedValue(contacts2) });

      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (adapter1 as any) : (adapter2 as any);
      });

      const multi = new MultiWhatsAppAdapter(config, factory, [n1, n2]);
      await multi.connect();
      const result = await multi.getContacts();

      expect(result).toHaveLength(2);
    });

    it('skips contacts from failing adapters', async () => {
      const n1 = createNumber('n1');
      const contacts = [{ id: 'c1', name: 'A', number: '1', isGroup: false, createdAt: new Date(), updatedAt: new Date() }];
      const adapter = createMockAdapter({ getContacts: vi.fn().mockResolvedValue(contacts) });
      const factory = vi.fn().mockReturnValue(adapter as any);

      const multi = new MultiWhatsAppAdapter(config, factory, [n1]);
      await multi.connect();

      // Override to throw on subsequent calls
      adapter.getContacts.mockRejectedValue(new Error('network fail'));
      const result = await multi.getContacts();
      expect(result).toEqual([]);
    });
  });
});
