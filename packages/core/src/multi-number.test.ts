import { describe, it, expect, vi } from 'vitest';
import { MultiNumberManager } from './multi-number.js';
import type { WhatsAppAdapter } from './gateway.js';
import type { OpenCSConfig, WhatsAppNumberConfig, Message, ConnectionStatus, GatewayEvent } from './types.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

// ── Helpers ────────────────────────────────────────────────────

/** Create a minimal config */
function createConfig(overrides: Partial<OpenCSConfig> = {}): OpenCSConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'Test',
    dashboardPort: 3030,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
    ...overrides,
  };
}

/** Create a number config */
function numberConfig(overrides: Partial<WhatsAppNumberConfig> = {}): WhatsAppNumberConfig {
  return {
    id: 'wa-1',
    sessionName: 'session-1',
    label: 'Nomor 1',
    enabled: true,
    ...overrides,
  };
}

/** Create a mock WhatsApp adapter */
function createMockAdapter(
  overrides: Partial<WhatsAppAdapter> = {},
): WhatsAppAdapter {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockImplementation(async (to: string, content: string) => ({
      id: `msg-${Date.now()}`,
      from: 'bot',
      to,
      content,
      type: 'text' as const,
      timestamp: new Date(),
      fromMe: true,
    }) as Message),
    getConnectionStatus: vi.fn().mockReturnValue('disconnected' as ConnectionStatus),
    getContacts: vi.fn().mockResolvedValue([]),
    isConnected: vi.fn().mockReturnValue(false),
    onEvent: vi.fn(),
    ...overrides,
  };
}

/** Factory that creates mock adapters with tracking */
function createMockFactory() {
  const adapters = new Map<string, WhatsAppAdapter>();

  const factory = (_config: OpenCSConfig, numberId: string): WhatsAppAdapter => {
    if (!adapters.has(numberId)) {
      adapters.set(numberId, createMockAdapter());
    }
    return adapters.get(numberId)!;
  };

  return { factory, adapters, getAdapter: (id: string) => adapters.get(id) };
}

// ── Tests ──────────────────────────────────────────────────────

describe('MultiNumberManager — Constructor & Config', () => {
  it('should initialize with empty state', () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);
    expect(manager.getNumbers()).toEqual([]);
    expect(manager.getConnectedCount()).toBe(0);
    expect(manager.isConnected()).toBe(false);
    expect(manager.getConnectionStatus()).toBe('disconnected');
  });

  it('should add and get a number config', () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1', label: 'CS 1' }));
    const numbers = manager.getNumbers();
    expect(numbers).toHaveLength(1);
    expect(numbers[0].id).toBe('wa-1');
    expect(numbers[0].label).toBe('CS 1');
    expect(numbers[0].status).toBe('disconnected');
  });

  it('should remove a number config', () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    expect(manager.getNumbers()).toHaveLength(1);

    manager.removeConfig('wa-1');
    expect(manager.getNumbers()).toHaveLength(0);
  });

  it('should load and connect multiple configs', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    const configs: WhatsAppNumberConfig[] = [
      numberConfig({ id: 'wa-1', enabled: true }),
      numberConfig({ id: 'wa-2', enabled: true }),
    ];

    await manager.loadAndConnect(configs);

    expect(manager.getNumbers()).toHaveLength(2);
    // Adapters should have been created and connect called
    expect(getAdapter('wa-1')?.connect).toHaveBeenCalled();
    expect(getAdapter('wa-2')?.connect).toHaveBeenCalled();
  });

  it('should skip disabled numbers during connectAll', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1', enabled: false }));
    manager.addConfig(numberConfig({ id: 'wa-2', enabled: true }));

    await manager.connectAll();

    // wa-1 is disabled, so connect should NOT be called
    expect(getAdapter('wa-1')).toBeUndefined();
    // wa-2 should be created and connected
    expect(getAdapter('wa-2')?.connect).toHaveBeenCalled();
  });
});

describe('MultiNumberManager — Connect & Disconnect', () => {
  it('should connect a single number', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    const adapter = getAdapter('wa-1');
    expect(adapter).toBeDefined();
    expect(adapter!.connect).toHaveBeenCalledTimes(1);
  });

  it('should throw when connecting non-existent number', async () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    await expect(manager.connectNumber('non-existent')).rejects.toThrow(
      'Number config non-existent not found',
    );
  });

  it('should disconnect a single number', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');
    await manager.disconnectNumber('wa-1');

    const adapter = getAdapter('wa-1');
    expect(adapter!.disconnect).toHaveBeenCalledTimes(1);
    // Should no longer be tracked in adapters map after disconnect
    expect(manager.getConnectedCount()).toBe(0);
  });

  it('should handle disconnect of non-connected number gracefully', async () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    // Disconnecting a number that was never connected should not throw
    await expect(manager.disconnectNumber('non-existent')).resolves.not.toThrow();
  });

  it('should connect all enabled numbers', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1', enabled: true }));
    manager.addConfig(numberConfig({ id: 'wa-2', enabled: true }));
    manager.addConfig(numberConfig({ id: 'wa-3', enabled: false }));

    await manager.connectAll();

    // Wait for promises to settle
    await vi.waitFor(() => {
      expect(getAdapter('wa-1')).toBeDefined();
      expect(getAdapter('wa-2')).toBeDefined();
    });

    // wa-3 is disabled, should not be created
    expect(getAdapter('wa-3')).toBeUndefined();
  });

  it('should disconnect all numbers', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1', enabled: true }));
    manager.addConfig(numberConfig({ id: 'wa-2', enabled: true }));

    await manager.connectAll();
    await manager.disconnectAll();

    expect(getAdapter('wa-1')!.disconnect).toHaveBeenCalled();
    expect(getAdapter('wa-2')!.disconnect).toHaveBeenCalled();
    expect(manager.getConnectedCount()).toBe(0);
  });

  it('should handle connection failure gracefully', async () => {
    // One adapter fails, the other succeeds
    const failingAdapter = createMockAdapter({
      connect: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      isConnected: vi.fn().mockReturnValue(false),
    });
    const successAdapter = createMockAdapter({
      connect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    });

    const manager = new MultiNumberManager(createConfig(), (_cfg, id) => {
      if (id === 'wa-1') return failingAdapter;
      return successAdapter;
    });

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    manager.addConfig(numberConfig({ id: 'wa-2' }));

    // connectAll should not throw even if one fails (Promise.allSettled)
    await expect(manager.connectAll()).resolves.not.toThrow();

    // wa-2 should be connected
    expect(manager.getConnectedCount()).toBe(1);
    expect(manager.isConnected()).toBe(true);
    expect(manager.getConnectionStatus()).toBe('connecting'); // 1/2 connected
  });
});

describe('MultiNumberManager — Send Message', () => {
  it('should send message via specific number', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    const msg = await manager.sendMessage('wa-1', '62812@s.whatsapp.net', 'Halo!');
    expect(msg.content).toBe('Halo!');
    expect(msg.to).toBe('62812@s.whatsapp.net');
    expect(getAdapter('wa-1')!.sendMessage).toHaveBeenCalledWith(
      '62812@s.whatsapp.net',
      'Halo!',
    );
  });

  it('should throw when sending via non-connected number', async () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    await expect(
      manager.sendMessage('non-existent', '62812@s.whatsapp.net', 'Test'),
    ).rejects.toThrow('Number non-existent not connected');
  });
});

describe('MultiNumberManager — Connection Status', () => {
  it('should report disconnected when no adapters', () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);
    expect(manager.getConnectionStatus()).toBe('disconnected');
    expect(manager.isConnected()).toBe(false);
    expect(manager.getConnectedCount()).toBe(0);
  });

  it('should report connecting when partial adapters are connected', async () => {
    const adapter1 = createMockAdapter({
      isConnected: vi.fn().mockReturnValue(true),
      connect: vi.fn().mockResolvedValue(undefined),
    });
    const adapter2 = createMockAdapter({
      isConnected: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockResolvedValue(undefined),
    });

    const manager = new MultiNumberManager(createConfig(), (_cfg, id) => {
      if (id === 'wa-1') return adapter1;
      return adapter2;
    });

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    manager.addConfig(numberConfig({ id: 'wa-2' }));

    await manager.connectAll();

    // wa-1 connected, wa-2 not → 1/2 → status = 'connecting'
    expect(manager.getConnectedCount()).toBe(1);
    expect(manager.isConnected()).toBe(true);
    expect(manager.getConnectionStatus()).toBe('connecting');
  });

  it('should report connected when all adapters are connected', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    // Override isConnected to return true after connect
    const adapter1 = createMockAdapter({
      connect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    });
    const adapter2 = createMockAdapter({
      connect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    });

    const customFactory = (_cfg: OpenCSConfig, id: string) => {
      if (id === 'wa-1') return adapter1;
      return adapter2;
    };

    const customManager = new MultiNumberManager(createConfig(), customFactory);
    customManager.addConfig(numberConfig({ id: 'wa-1' }));
    customManager.addConfig(numberConfig({ id: 'wa-2' }));

    await customManager.connectAll();

    // All enabled + all connected
    expect(customManager.getConnectedCount()).toBe(2);
    expect(customManager.isConnected()).toBe(true);
    expect(customManager.getConnectionStatus()).toBe('connected');
  });

  it('should get adapter for a number', () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));

    // Before connect, getAdapter returns undefined
    expect(manager.getAdapter('wa-1')).toBeUndefined();
    expect(manager.getAdapter('non-existent')).toBeUndefined();
  });

  it('should return adapter after connection', async () => {
    const { factory, getAdapter } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    const adapter = manager.getAdapter('wa-1');
    expect(adapter).toBeDefined();
    expect(adapter!.isConnected).toBeDefined();
  });
});

describe('MultiNumberManager — Event Forwarding', () => {
  it('should forward enriched events from adapter to handler', async () => {
    // Create a custom adapter that we control
    let adapterOnEvent: ((event: GatewayEvent) => void) | null = null;

    const controllableAdapter: WhatsAppAdapter = {
      ...createMockAdapter(),
      onEvent: vi.fn().mockImplementation((handler: (event: GatewayEvent) => void) => {
        adapterOnEvent = handler;
      }),
    };

    const manager = new MultiNumberManager(createConfig(), (_cfg, id) => {
      if (id === 'wa-1') return controllableAdapter;
      return createMockAdapter();
    });

    const receivedEvents: GatewayEvent[] = [];
    manager.onEvent((event) => { receivedEvents.push(event); });

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    // Simulate incoming message from adapter
    const incomingEvent: GatewayEvent = {
      type: 'message:received',
      message: {
        id: 'msg-1',
        from: '62812@s.whatsapp.net',
        to: 'bot',
        content: 'Halo',
        type: 'text',
        timestamp: new Date(),
        fromMe: false,
        metadata: {},
      },
    };

    adapterOnEvent?.(incomingEvent);

    // Event should be forwarded with numberId in metadata
    expect(receivedEvents).toHaveLength(1);
    const forwarded = receivedEvents[0];
    expect(forwarded.type).toBe('message:received');
    if (forwarded.type === 'message:received') {
      expect(forwarded.message.metadata?.numberId).toBe('wa-1');
    }
  });

  it('should forward message:sent events with numberId', async () => {
    let adapterOnEvent: ((event: GatewayEvent) => void) | null = null;

    const controllableAdapter: WhatsAppAdapter = {
      ...createMockAdapter(),
      onEvent: vi.fn().mockImplementation((handler: (event: GatewayEvent) => void) => {
        adapterOnEvent = handler;
      }),
    };

    const manager = new MultiNumberManager(createConfig(), (_cfg, id) => {
      if (id === 'wa-1') return controllableAdapter;
      return createMockAdapter();
    });

    const receivedEvents: GatewayEvent[] = [];
    manager.onEvent((event) => { receivedEvents.push(event); });

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    const sentEvent: GatewayEvent = {
      type: 'message:sent',
      message: {
        id: 'msg-2',
        from: 'bot',
        to: '62812@s.whatsapp.net',
        content: 'Balasan',
        type: 'text',
        timestamp: new Date(),
        fromMe: true,
      },
    };

    adapterOnEvent?.(sentEvent);

    expect(receivedEvents).toHaveLength(1);
    const forwarded = receivedEvents[0];
    if (forwarded.type === 'message:sent') {
      expect(forwarded.message.metadata?.numberId).toBe('wa-1');
    }
  });

  it('should forward non-message events without enrichment', async () => {
    let adapterOnEvent: ((event: GatewayEvent) => void) | null = null;

    const controllableAdapter: WhatsAppAdapter = {
      ...createMockAdapter(),
      onEvent: vi.fn().mockImplementation((handler: (event: GatewayEvent) => void) => {
        adapterOnEvent = handler;
      }),
    };

    const manager = new MultiNumberManager(createConfig(), (_cfg, id) => {
      if (id === 'wa-1') return controllableAdapter;
      return createMockAdapter();
    });

    const receivedEvents: GatewayEvent[] = [];
    manager.onEvent((event) => { receivedEvents.push(event); });

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    const connectionEvent: GatewayEvent = {
      type: 'connection:update',
      status: 'connected',
    };

    adapterOnEvent?.(connectionEvent);

    expect(receivedEvents).toHaveLength(1);
    // Non-message event should pass through without enrichment
    expect(receivedEvents[0].type).toBe('connection:update');
    if (receivedEvents[0].type === 'connection:update') {
      expect(receivedEvents[0].status).toBe('connected');
    }
  });
});

describe('MultiNumberManager — Edge Cases', () => {
  it('should handle loadAndConnect with empty array', async () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    // Should not throw
    await expect(manager.loadAndConnect([])).resolves.not.toThrow();
    expect(manager.getNumbers()).toHaveLength(0);
  });

  it('should persist configs after connect', async () => {
    // Clean up any existing test data file
    const configPath = join(process.cwd(), 'data', 'numbers.json');
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }

    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    // Config should be persisted to data/numbers.json
    expect(existsSync(configPath)).toBe(true);

    // Clean up
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
  });

  it('should update number info after connection status changes', async () => {
    const connectedAdapter = createMockAdapter({
      isConnected: vi.fn().mockReturnValue(true),
      getConnectionStatus: vi.fn().mockReturnValue('connected' as ConnectionStatus),
    });

    const manager = new MultiNumberManager(createConfig(), (_cfg, id) => {
      if (id === 'wa-1') return connectedAdapter;
      return createMockAdapter();
    });

    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    const numbers = manager.getNumbers();
    expect(numbers[0].status).toBe('connected');
  });

  it('should use label from config when available', () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1', label: 'Customer Service 1' }));
    const numbers = manager.getNumbers();
    expect(numbers[0].label).toBe('Customer Service 1');
  });

  it('should fall back to sessionName when label is not set', () => {
    const { factory } = createMockFactory();
    const manager = new MultiNumberManager(createConfig(), factory);

    manager.addConfig(numberConfig({ id: 'wa-1', label: undefined }));
    const numbers = manager.getNumbers();
    expect(numbers[0].label).toBe('session-1');
  });

  it('should handle adapter that throws on sendMessage', async () => {
    const failingAdapter = createMockAdapter({
      sendMessage: vi.fn().mockRejectedValue(new Error('Message too long')),
    });

    const manager = new MultiNumberManager(createConfig(), () => failingAdapter);
    manager.addConfig(numberConfig({ id: 'wa-1' }));
    await manager.connectNumber('wa-1');

    await expect(
      manager.sendMessage('wa-1', '62812@s.whatsapp.net', 'A'.repeat(100000)),
    ).rejects.toThrow('Message too long');
  });
});
