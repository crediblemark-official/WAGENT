import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBuiltInTools } from './tools.js';
import type { ToolContext, WAgentConfig } from './types.js';
import type { Database } from './storage.js';

// ── Helpers ────────────────────────────────────────────────────

/** Create a minimal config */
function createConfig(): WAgentConfig {
  return {
    whatsappSessionName: 'test',
    aiProvider: 'openai',
    systemPrompt: 'Test',
    dashboardPort: 3030,
    dashboardHost: 'localhost',
    databaseType: 'sqlite',
    databaseUrl: ':memory:',
  };
}

/** Create a context with mocked DB */
function createContext(overrides: Partial<MockDb> = {}): ToolContext {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any,
    db: {
      searchContacts: vi.fn().mockReturnValue([]),
      getMessages: vi.fn().mockReturnValue([]),
      getContact: vi.fn().mockReturnValue(null),
      saveContact: vi.fn(),
      searchKnowledge: vi.fn().mockReturnValue([]),
      getKnowledgeEntry: vi.fn(),
      ...overrides,
    } as unknown as Database,
    config: createConfig(),
    contactId: '62812345678@s.whatsapp.net',
  };
}

interface MockDb {
  searchContacts?: ReturnType<typeof vi.fn>;
  getMessages?: ReturnType<typeof vi.fn>;
  getContact?: ReturnType<typeof vi.fn>;
  saveContact?: ReturnType<typeof vi.fn>;
  searchKnowledge?: ReturnType<typeof vi.fn>;
  getKnowledgeEntry?: ReturnType<typeof vi.fn>;
  [key: string]: any;
}

// ── Tests ──────────────────────────────────────────────────────

describe('createBuiltInTools — Tool Definitions', () => {
  it('should return all 18 tools', () => {
    const tools = createBuiltInTools(createConfig());
    expect(tools).toHaveLength(18);
  });

  it('should define tools with correct names', () => {
    const tools = createBuiltInTools(createConfig());
    const names = tools.map(t => t.name);
    expect(names).toEqual([
      'get_customer_info',
      'get_conversation_history',
      'get_current_time',
      'add_note',
      'get_customer_tags',
      'search_knowledge_base',
      'lookup_order',
      'check_stock',
      'send_message',
      'send_image',
      'create_reminder',
      'escalate_to_human',
      'safe_shell',
      'http_request',
      'file_read',
      'file_write',
      'file_list',
      'web_scrape',
    ]);
  });

  it('should define each tool with name, description, parameters, and handler', () => {
    const tools = createBuiltInTools(createConfig());
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.parameters).toBe('object');
      expect(tool.handler).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });
});

describe('Tool: get_customer_info', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'get_customer_info')!;
  });

  it('should return found=true when customer exists', async () => {
    const ctx = createContext({
      searchContacts: vi.fn().mockReturnValue([{ id: '62812', name: 'Budi' }]),
    });
    const result = await tool.handler({ query: 'Budi' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.customer.name).toBe('Budi');
  });

  it('should return found=false when customer not found', async () => {
    const ctx = createContext({
      searchContacts: vi.fn().mockReturnValue([]),
    });
    const result = await tool.handler({ query: 'Tidak Ada' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
    expect(parsed.message).toBe('Customer tidak ditemukan');
  });

  it('should search via query string', async () => {
    const searchContacts = vi.fn().mockReturnValue([]);
    const ctx = createContext({ searchContacts });
    await tool.handler({ query: '62812' }, ctx);
    expect(searchContacts).toHaveBeenCalledWith('62812');
  });
});

describe('Tool: get_conversation_history', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'get_conversation_history')!;
  });

  it('should return messages for a contact', async () => {
    const ctx = createContext({
      getMessages: vi.fn().mockReturnValue([
        { fromMe: false, content: 'Halo', timestamp: new Date('2025-01-01') },
        { fromMe: true, content: 'Halo juga!', timestamp: new Date('2025-01-01') },
      ]),
    });
    const result = await tool.handler({ contactId: '62812@s.whatsapp.net' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].from).toBe('customer');
    expect(parsed.messages[1].from).toBe('bot');
    expect(parsed.messages[0].content).toBe('Halo');
  });

  it('should use default limit of 10 when not specified', async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const ctx = createContext({ getMessages });
    await tool.handler({ contactId: '62812@s.whatsapp.net' }, ctx);
    expect(getMessages).toHaveBeenCalledWith('62812@s.whatsapp.net', 10);
  });

  it('should use custom limit when provided', async () => {
    const getMessages = vi.fn().mockReturnValue([]);
    const ctx = createContext({ getMessages });
    await tool.handler({ contactId: '62812@s.whatsapp.net', limit: 5 }, ctx);
    expect(getMessages).toHaveBeenCalledWith('62812@s.whatsapp.net', 5);
  });

  it('should return empty array when no messages', async () => {
    const ctx = createContext({
      getMessages: vi.fn().mockReturnValue([]),
    });
    const result = await tool.handler({ contactId: '62812@s.whatsapp.net' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.messages).toEqual([]);
  });
});

describe('Tool: get_current_time', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];
  let fakeDate: Date;

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'get_current_time')!;
    fakeDate = new Date('2025-06-15T10:30:00.000+07:00');
    vi.useFakeTimers();
    vi.setSystemTime(fakeDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return current time in Indonesian locale', async () => {
    const result = await tool.handler({}, {} as ToolContext);
    expect(result).toContain('15/6/2025');
    expect(typeof result).toBe('string');
  });
});

describe('Tool: add_note', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'add_note')!;
  });

  it('should add note to existing contact', async () => {
    const saveContact = vi.fn();
    const ctx = createContext({
      getContact: vi.fn().mockReturnValue({ id: '62812', notes: 'Catatan lama', name: 'Budi', number: '62812', isGroup: false, createdAt: new Date(), updatedAt: new Date() }),
      saveContact,
    });
    const result = await tool.handler({ contactId: '62812', note: 'Pesanan bermasalah' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(saveContact).toHaveBeenCalled();
    const saved = saveContact.mock.calls[0][0];
    expect(saved.notes).toContain('Catatan lama');
    expect(saved.notes).toContain('Pesanan bermasalah');
  });

  it('should create note when no existing notes', async () => {
    const saveContact = vi.fn();
    const ctx = createContext({
      getContact: vi.fn().mockReturnValue({ id: '62812', name: 'Budi', number: '62812', isGroup: false, createdAt: new Date(), updatedAt: new Date() }),
      saveContact,
    });
    const result = await tool.handler({ contactId: '62812', note: 'Pelanggan baru' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    const saved = saveContact.mock.calls[0][0];
    expect(saved.notes).toContain('Pelanggan baru');
    expect(saved.notes).not.toContain('Catatan lama');
  });

  it('should return success=false when contact not found', async () => {
    const ctx = createContext({
      getContact: vi.fn().mockReturnValue(null),
    });
    const result = await tool.handler({ contactId: 'nonexistent', note: 'Test' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toBe('Customer tidak ditemukan');
  });
});

describe('Tool: get_customer_tags', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'get_customer_tags')!;
  });

  it('should return tags when contact has tags', async () => {
    const ctx = createContext({
      getContact: vi.fn().mockReturnValue({ id: '62812', tags: ['vip', 'repeat-order'], name: 'Budi', number: '62812', isGroup: false, createdAt: new Date(), updatedAt: new Date() }),
    });
    const result = await tool.handler({ contactId: '62812' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.tags).toEqual(['vip', 'repeat-order']);
  });

  it('should return empty array when contact has no tags', async () => {
    const ctx = createContext({
      getContact: vi.fn().mockReturnValue({ id: '62812', name: 'Budi', number: '62812', isGroup: false, createdAt: new Date(), updatedAt: new Date() }),
    });
    const result = await tool.handler({ contactId: '62812' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.tags).toEqual([]);
  });

  it('should return found=false when contact not found', async () => {
    const ctx = createContext({
      getContact: vi.fn().mockReturnValue(null),
    });
    const result = await tool.handler({ contactId: 'nonexistent' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
    expect(parsed.message).toBe('Customer tidak ditemukan');
  });
});

describe('Tool: search_knowledge_base', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'search_knowledge_base')!;
  });

  it('should return results when found', async () => {
    const ctx = createContext({
      searchKnowledge: vi.fn().mockReturnValue([
        {
          entry: { question: 'Berapa ongkir?', answer: 'Rp 10.000', category: 'pengiriman' },
          score: 0.95,
        },
      ]),
    });
    const result = await tool.handler({ query: 'ongkir' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.total).toBe(1);
    expect(parsed.results[0].answer).toBe('Rp 10.000');
    expect(parsed.results[0].relevance).toBe('95%');
  });

  it('should return found=false when no results', async () => {
    const ctx = createContext({
      searchKnowledge: vi.fn().mockReturnValue([]),
    });
    const result = await tool.handler({ query: 'nonexistent' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
    expect(parsed.message).toContain('Tidak ada informasi');
    expect(parsed.suggestion).toContain('kata kunci');
  });    it('should use default maxResults of 3 (gets doubled for initial search)', async () => {
      const searchKnowledge = vi.fn().mockReturnValue([]);
      const ctx = createContext({ searchKnowledge });
      await tool.handler({ query: 'test' }, ctx);
      // Handler doubles maxResults for initial search, then slices to original
      expect(searchKnowledge).toHaveBeenCalledWith('test', 6);
    });

    it('should use custom maxResults when provided', async () => {
      const searchKnowledge = vi.fn().mockReturnValue([]);
      const ctx = createContext({ searchKnowledge });
      await tool.handler({ query: 'test', maxResults: 5 }, ctx);
      // Handler doubles maxResults for initial search
      expect(searchKnowledge).toHaveBeenCalledWith('test', 10);
    });

  it('should filter results by category', async () => {
    const ctx = createContext({
      searchKnowledge: vi.fn().mockReturnValue([
        { entry: { question: 'Produk A', category: 'produk' }, score: 0.9 },
        { entry: { question: 'Ongkir', category: 'pengiriman' }, score: 0.8 },
      ]),
    });
    const result = await tool.handler({ query: 'info', category: 'produk' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].category).toBe('produk');
  });

  it('should return not found when category filter excludes all', async () => {
    const ctx = createContext({
      searchKnowledge: vi.fn().mockReturnValue([
        { entry: { question: 'Ongkir', category: 'pengiriman' }, score: 0.8 },
      ]),
    });
    const result = await tool.handler({ query: 'info', category: 'produk' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
  });
});

describe('Tool: escalate_to_human', () => {
  let originalFetch: typeof globalThis.fetch;
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'escalate_to_human')!;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return escalated=true when Telegram is configured and works', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const ctx = createContext();
    // Set config with Telegram credentials
    ctx.config.telegramBotToken = '123:token';
    ctx.config.telegramChatId = '-100group';

    const result = await tool.handler(
      { reason: 'Tidak bisa menjawab pertanyaan', customerQuestion: 'Produk apa yang cocok?' },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.escalated).toBe(true);
    expect(parsed.message).toContain('diteruskan ke tim CS');
  });

  it('should return escalated=false when Telegram is not configured', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const ctx = createContext();
    // No Telegram config
    ctx.config.telegramBotToken = undefined;
    ctx.config.telegramChatId = undefined;

    const result = await tool.handler(
      { reason: 'Test', customerQuestion: 'Test' },
      ctx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.escalated).toBe(false);
    expect(parsed.message).toContain('sedang tidak bisa menghubungi');
    // fetch should not be called since escalation is disabled
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should use defaults for missing arguments', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const ctx = createContext();
    ctx.config.telegramBotToken = '123:token';
    ctx.config.telegramChatId = '-100group';

    // Missing both arguments - should use defaults
    const result = await tool.handler({}, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.escalated).toBe(true);
  });
});

// ── E-commerce Tools ────────────────────────────────────────────

describe('Tool: lookup_order', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'lookup_order')!;
  });

  it('should return found=true when order exists', async () => {
    const ctx = createContext({
      searchOrders: vi.fn().mockReturnValue([{
        orderNumber: 'ORD-001',
        status: 'shipped',
        items: [{ name: 'Kaos', qty: 1, price: 89000 }],
        totalAmount: 89000,
        currency: 'IDR',
        createdAt: new Date('2025-01-01'),
      }]),
    });
    const result = await tool.handler({ orderNumber: 'ORD-001' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.order.orderNumber).toBe('ORD-001');
    expect(parsed.order.status).toBe('shipped');
    expect(parsed.order.totalAmount).toBe(89000);
  });

  it('should return found=false when order not found', async () => {
    const ctx = createContext({
      searchOrders: vi.fn().mockReturnValue([]),
    });
    const result = await tool.handler({ orderNumber: 'ORD-999' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
    expect(parsed.message).toBe('Pesanan tidak ditemukan');
  });

  it('should call searchOrders with correct query', async () => {
    const searchOrders = vi.fn().mockReturnValue([]);
    const ctx = createContext({ searchOrders });
    await tool.handler({ orderNumber: 'ORD-001' }, ctx);
    expect(searchOrders).toHaveBeenCalledWith('ORD-001', 5);
  });
});

describe('Tool: check_stock', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'check_stock')!;
  });

  it('should return found=true when products exist', async () => {
    const ctx = createContext({
      searchProducts: vi.fn().mockReturnValue([{
        name: 'Kaos Polos',
        price: 89000,
        currency: 'IDR',
        stock: 25,
        category: 'apparel',
      }]),
    });
    const result = await tool.handler({ query: 'kaos' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.total).toBe(1);
    expect(parsed.products[0].name).toBe('Kaos Polos');
    expect(parsed.products[0].inStock).toBe(true);
  });

  it('should return inStock=false when stock is 0', async () => {
    const ctx = createContext({
      searchProducts: vi.fn().mockReturnValue([{
        name: 'Hoodie',
        price: 199000,
        currency: 'IDR',
        stock: 0,
        category: 'apparel',
      }]),
    });
    const result = await tool.handler({ query: 'hoodie' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.products[0].inStock).toBe(false);
  });

  it('should return found=false when no products found', async () => {
    const ctx = createContext({
      searchProducts: vi.fn().mockReturnValue([]),
    });
    const result = await tool.handler({ query: 'xyz' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
    expect(parsed.message).toBe('Produk tidak ditemukan');
  });
});

// ── Communication Tools ─────────────────────────────────────────

describe('Tool: send_message', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'send_message')!;
  });

  it('should return success with contactId from args', async () => {
    const ctx = createContext();
    const result = await tool.handler({ contactId: '62899@s.whatsapp.net', message: 'Halo!' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.contactId).toBe('62899@s.whatsapp.net');
    expect(parsed.message).toBe('Halo!');
  });

  it('should use context contactId when not provided', async () => {
    const ctx = createContext();
    ctx.contactId = '62812345678@s.whatsapp.net';
    const result = await tool.handler({ message: 'Test' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.contactId).toBe('62812345678@s.whatsapp.net');
  });
});

describe('Tool: send_image', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'send_image')!;
  });

  it('should return success with imageUrl', async () => {
    const ctx = createContext();
    const result = await tool.handler({ imageUrl: 'https://example.com/img.jpg', caption: 'Foto produk' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.imageUrl).toBe('https://example.com/img.jpg');
    expect(parsed.caption).toBe('Foto produk');
  });

  it('should default caption to empty string', async () => {
    const ctx = createContext();
    const result = await tool.handler({ imageUrl: 'https://example.com/img.jpg' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.caption).toBe('');
  });

  it('should use context contactId as default', async () => {
    const ctx = createContext();
    ctx.contactId = '62812345678@s.whatsapp.net';
    const result = await tool.handler({ imageUrl: 'https://example.com/img.jpg' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.contactId).toBe('62812345678@s.whatsapp.net');
  });
});

// ── Reminder Tool ───────────────────────────────────────────────

describe('Tool: create_reminder', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'create_reminder')!;
  });

  it('should return success with reminder details', async () => {
    const ctx = createContext();
    const result = await tool.handler({
      message: 'Follow up pesanan',
      datetime: '2025-06-20T10:00:00Z',
      contactId: '62812@s.whatsapp.net',
    }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('Follow up pesanan');
    expect(parsed.datetime).toBe('2025-06-20T10:00:00Z');
    expect(parsed.contactId).toBe('62812@s.whatsapp.net');
  });

  it('should use context contactId when not provided', async () => {
    const ctx = createContext();
    ctx.contactId = '62812345678@s.whatsapp.net';
    const result = await tool.handler({ message: 'Test', datetime: '2025-06-20T10:00:00Z' }, ctx);
    const parsed = JSON.parse(result);
    expect(parsed.contactId).toBe('62812345678@s.whatsapp.net');
  });
});

// ── Advanced Tools (v2) ─────────────────────────────────────────

describe('Tool: safe_shell', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];

  beforeEach(() => {
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'safe_shell')!;
  });

  it('should execute allowed command successfully', async () => {
    const result = await tool.handler({ command: 'echo hello' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toContain('hello');
    expect(parsed.exitCode).toBe(0);
  });

  it('should block denied commands', async () => {
    const result = await tool.handler({ command: 'rm -rf /' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(1);
    expect(parsed.stderr).toContain('not allowed');
  });

  it('should block non-whitelisted commands', async () => {
    const result = await tool.handler({ command: 'python3 -c "print(1)"' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(1);
  });

  it('should return success=false for empty command', async () => {
    const result = await tool.handler({ command: '' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });
});

describe('Tool: http_request', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'http_request')!;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should perform GET request successfully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: new Map(),
      text: async () => '{"data":"ok"}',
    });
    const result = await tool.handler({ url: 'https://api.example.com/data' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe(200);
    expect(parsed.body).toContain('data');
  });

  it('should perform POST request with body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 201,
      headers: new Map(),
      text: async () => 'created',
    });
    const result = await tool.handler({
      url: 'https://api.example.com/items',
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe(201);
  });

  it('should default to GET when method not specified', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: new Map(),
      text: async () => 'ok',
    });
    await tool.handler({ url: 'https://api.example.com/data' }, createContext());
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(init.method).toBe('GET');
  });

  it('should handle fetch errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    const result = await tool.handler({ url: 'https://api.example.com/data' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  it('should block requests to blocked domains', async () => {
    const result = await tool.handler({ url: 'http://localhost:3000/secret' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.body).toContain('blocked');
  });
});

describe('Tool: file_read / file_write / file_list', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let writeTool: (typeof tools)[0];
  let readTool: (typeof tools)[0];
  let listTool: (typeof tools)[0];
  const testDir = `/tmp/wagent-tools-test-${Date.now()}`;

  beforeEach(async () => {
    const config = createConfig();
    config.knowledgeDir = testDir;
    tools = createBuiltInTools(config);
    writeTool = tools.find(t => t.name === 'file_write')!;
    readTool = tools.find(t => t.name === 'file_read')!;
    listTool = tools.find(t => t.name === 'file_list')!;
    // Clean up
    const { rmSync, mkdirSync } = await import('fs');
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    const { rmSync } = await import('fs');
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('should write a file successfully', async () => {
    const result = await writeTool.handler({ path: 'test.md', content: '# Hello' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
  });

  it('should read back a written file', async () => {
    await writeTool.handler({ path: 'readme.md', content: 'content here' }, createContext());
    const result = await readTool.handler({ path: 'readme.md' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(true);
    expect(parsed.content).toBe('content here');
  });

  it('should return found=false for non-existent file', async () => {
    const result = await readTool.handler({ path: 'nope.md' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.found).toBe(false);
  });

  it('should list files in directory', async () => {
    await writeTool.handler({ path: 'a.md', content: 'a' }, createContext());
    await writeTool.handler({ path: 'b.md', content: 'b' }, createContext());
    const result = await listTool.handler({}, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.files.length).toBeGreaterThanOrEqual(2);
    const names = parsed.files.map((f: any) => f.name);
    expect(names).toContain('a.md');
    expect(names).toContain('b.md');
  });

  it('should list file with correct metadata', async () => {
    await writeTool.handler({ path: 'meta.md', content: 'hello' }, createContext());
    const result = await listTool.handler({}, createContext());
    const parsed = JSON.parse(result);
    const file = parsed.files.find((f: any) => f.name === 'meta.md');
    expect(file).toBeDefined();
    expect(file.size).toBeGreaterThan(0);
    expect(file.extension).toBe('.md');
    expect(file.isDirectory).toBe(false);
  });
});

describe('Tool: web_scrape', () => {
  let tools: ReturnType<typeof createBuiltInTools>;
  let tool: (typeof tools)[0];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tools = createBuiltInTools(createConfig());
    tool = tools.find(t => t.name === 'web_scrape')!;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should scrape a URL and return content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: new Map(),
      text: async () => '<html><head><title>Test</title><meta name="description" content="Desc"></head><body><p>Hello World</p><a href="https://example.com">link</a></body></html>',
    });
    const result = await tool.handler({ url: 'https://example.com' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.title).toBe('Test');
    expect(parsed.description).toBe('Desc');
    expect(parsed.content).toContain('Hello World');
  });

  it('should return success=false on fetch error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false, status: 404,
      headers: new Map(),
      text: async () => 'Not Found',
    });
    const result = await tool.handler({ url: 'https://example.com/404' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  it('should handle network exceptions', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('DNS failure'));
    const result = await tool.handler({ url: 'https://nonexistent.invalid' }, createContext());
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });
});
