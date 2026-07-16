import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiNumberManager } from '../services/multi-number.js';
import type { WAgentConfig, WhatsAppNumberConfig } from '../types.js';

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

function createConfig(): WAgentConfig {
  return {
    whatsappSessionName: 'test-session',
    whatsappSessionDir: '/tmp/sessions',
    aiProvider: 'openai',
    systemPrompt: 'test',
    dashboardPort: 3000,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
  };
}

function createMockAdapter(overrides: Record<string, any> = {}) {
  const state = {
    connected: false,
    eventHandler: null as ((event: any) => void) | null,
    connect: vi.fn().mockImplementation(async () => { state.connected = true; }),
    disconnect: vi.fn().mockImplementation(async () => { state.connected = false; }),
    sendMessage: vi.fn().mockResolvedValue({
      id: 'msg-1', from: 'bot', to: 'target', content: 'hello',
      type: 'text' as const, timestamp: new Date(), fromMe: true,
    }),
    getConnectionStatus: vi.fn().mockImplementation(() =>
      state.connected ? 'connected' as const : 'disconnected' as const
    ),
    isConnected: vi.fn().mockImplementation(() => state.connected),
    onEvent: vi.fn().mockImplementation((handler: (event: any) => void) => {
      state.eventHandler = handler;
    }),
    ...overrides,
  };
  return state;
}

function createNumber(id: string, overrides: Partial<WhatsAppNumberConfig> = {}): WhatsAppNumberConfig {
  return { id, sessionName: `session-${id}`, label: `Number ${id}`, enabled: true, ...overrides };
}

describe('MultiNumberManager', () => {
  let config: WAgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createConfig();
  });

  describe('loadAndConnect', () => {
    it('connects enabled numbers', async () => {
      const n1 = createNumber('n1');
      const n2 = createNumber('n2');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);

      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([n1, n2]);

      expect(factory).toHaveBeenCalledTimes(2);
      expect(adapter.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('addConfig / removeConfig', () => {
    it('addConfig stores config', () => {
      const factory = vi.fn();
      const mgr = new MultiNumberManager(config, factory);
      const num = createNumber('n1');

      mgr.addConfig(num);
      const numbers = mgr.getNumbers();

      expect(numbers).toHaveLength(1);
      expect(numbers[0].id).toBe('n1');
    });

    it('removeConfig removes config', () => {
      const factory = vi.fn();
      const mgr = new MultiNumberManager(config, factory);
      mgr.addConfig(createNumber('n1'));

      mgr.removeConfig('n1');
      expect(mgr.getNumbers()).toHaveLength(0);
    });
  });

  describe('connectNumber', () => {
    it('creates adapter and connects', async () => {
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      mgr.addConfig(createNumber('n1'));

      await mgr.connectNumber('n1');

      expect(factory).toHaveBeenCalledTimes(1);
      expect(adapter.connect).toHaveBeenCalledTimes(1);
    });

    it('throws for unknown id', async () => {
      const factory = vi.fn();
      const mgr = new MultiNumberManager(config, factory);

      await expect(mgr.connectNumber('unknown')).rejects.toThrow('Number config unknown not found');
    });
  });

  describe('disconnectNumber', () => {
    it('disconnects adapter', async () => {
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      mgr.addConfig(createNumber('n1'));
      await mgr.connectNumber('n1');

      await mgr.disconnectNumber('n1');

      expect(adapter.disconnect).toHaveBeenCalledTimes(1);
      expect(mgr.getAdapter('n1')).toBeUndefined();
    });
  });

  describe('connectAll', () => {
    it('connects all enabled in parallel', async () => {
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      mgr.addConfig(createNumber('n1'));
      mgr.addConfig(createNumber('n2'));

      await mgr.loadAndConnect([createNumber('n1'), createNumber('n2')]);

      expect(adapter.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('disconnectAll', () => {
    it('disconnects and clears', async () => {
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1'), createNumber('n2')]);

      await mgr.disconnectAll();

      expect(adapter.disconnect).toHaveBeenCalledTimes(2);
      expect(mgr.getConnectedCount()).toBe(0);
    });
  });

  describe('sendMessage', () => {
    it('delegates to correct adapter', async () => {
      const adapter = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1')]);

      const result = await mgr.sendMessage('n1', 'user1', 'hello');

      expect(adapter.sendMessage).toHaveBeenCalledWith('user1', 'hello');
      expect(result.id).toBe('msg-1');
    });

    it('throws if not connected', async () => {
      const factory = vi.fn();
      const mgr = new MultiNumberManager(config, factory);

      await expect(mgr.sendMessage('n1', 'user', 'msg')).rejects.toThrow('Number n1 not connected');
    });
  });

  describe('getNumbers', () => {
    it('returns all configured numbers', () => {
      const factory = vi.fn();
      const mgr = new MultiNumberManager(config, factory);
      mgr.addConfig(createNumber('n1'));
      mgr.addConfig(createNumber('n2', { label: 'Second' }));

      const numbers = mgr.getNumbers();
      expect(numbers).toHaveLength(2);
      expect(numbers[0].id).toBe('n1');
      expect(numbers[0].label).toBe('Number n1');
      expect(numbers[1].label).toBe('Second');
    });
  });

  describe('getConnectedCount', () => {
    it('returns correct count', async () => {
      const adapter1 = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ connected: false, isConnected: vi.fn().mockReturnValue(false) });
      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? adapter1 as any : adapter2 as any;
      });
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1'), createNumber('n2')]);

      expect(mgr.getConnectedCount()).toBe(1);
    });
  });

  describe('isConnected', () => {
    it('returns true when any connected', async () => {
      const adapter = createMockAdapter({ connected: true, isConnected: vi.fn().mockReturnValue(true) });
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1')]);

      expect(mgr.isConnected()).toBe(true);
    });
  });

  describe('getConnectionStatus', () => {
    it("returns 'disconnected' when none connected", async () => {
      const adapter = createMockAdapter({ isConnected: vi.fn().mockReturnValue(false) });
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1')]);

      expect(mgr.getConnectionStatus()).toBe('disconnected');
    });

    it("returns 'connected' when all connected", async () => {
      const adapter = createMockAdapter({ isConnected: vi.fn().mockReturnValue(true) });
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1'), createNumber('n2')]);

      expect(mgr.getConnectionStatus()).toBe('connected');
    });

    it("returns 'connecting' when some connected", async () => {
      const adapter1 = createMockAdapter({ isConnected: vi.fn().mockReturnValue(true) });
      const adapter2 = createMockAdapter({ isConnected: vi.fn().mockReturnValue(false) });
      let callCount = 0;
      const factory = vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? adapter1 as any : adapter2 as any;
      });
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1'), createNumber('n2')]);

      expect(mgr.getConnectionStatus()).toBe('connecting');
    });
  });

  describe('onEvent', () => {
    it('registers handler', () => {
      const factory = vi.fn();
      const mgr = new MultiNumberManager(config, factory);
      const handler = vi.fn();
      mgr.onEvent(handler);
      // Verify no error thrown
    });
  });

  describe('enrichEvent', () => {
    it('injects numberId into message metadata for received messages', async () => {
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      const handler = vi.fn();
      mgr.onEvent(handler);
      await mgr.loadAndConnect([createNumber('n1')]);

      adapter.eventHandler?.({
        type: 'message:received',
        message: {
          id: 'm1', from: 'user', to: 'bot', content: 'hi',
          type: 'text', timestamp: new Date(), fromMe: false, metadata: {},
        },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.message.metadata.numberId).toBe('n1');
    });
  });

  describe('connectNumber persistence', () => {
    it('connectNumber persists configs', async () => {
      const fs = await import('fs');
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      mgr.addConfig(createNumber('n1'));

      await mgr.connectNumber('n1');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getAdapter', () => {
    it('returns adapter or undefined', async () => {
      const adapter = createMockAdapter();
      const factory = vi.fn().mockReturnValue(adapter as any);
      const mgr = new MultiNumberManager(config, factory);
      await mgr.loadAndConnect([createNumber('n1')]);

      expect(mgr.getAdapter('n1')).toBeDefined();
      expect(mgr.getAdapter('nonexistent')).toBeUndefined();
    });
  });
});
