import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBuiltInTools } from '../tools/tools.js';
import type { WAgentConfig, ToolContext } from '../types.js';

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

const mockSafeShellExecute = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, timedOut: false });
vi.mock('../tools/safe-shell.js', () => ({
  SafeShell: class { execute = mockSafeShellExecute; },
}));

const mockHttpClientGet = vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{"data":"test"}', headers: {} });
const mockHttpClientPost = vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{"created":true}', headers: {} });
vi.mock('../utils/http-client.js', () => ({
  HTTPClient: class {
    get(url: string) {
      if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
        return Promise.resolve({ ok: false, status: 0, body: 'Domain blocked', headers: {} });
      }
      return mockHttpClientGet(url);
    }
    post(url: string, body: any) {
      if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
        return Promise.resolve({ ok: false, status: 0, body: 'Domain blocked', headers: {} });
      }
      return mockHttpClientPost(url, body);
    }
  },
}));

const mockFileManagerRead = vi.fn().mockResolvedValue({ path: 'test.txt', content: 'file contents', size: 13, modifiedAt: new Date() });
const mockFileManagerWrite = vi.fn().mockResolvedValue(true);
const mockFileManagerList = vi.fn().mockResolvedValue([
  { name: 'test.txt', path: 'test.txt', size: 13, isDirectory: false, modifiedAt: new Date(), extension: '.txt' },
]);
vi.mock('../rag/file-manager.js', () => ({
  FileManager: class {
    read = mockFileManagerRead;
    write = mockFileManagerWrite;
    list = mockFileManagerList;
  },
}));

const mockWebScraperScrape = vi.fn().mockResolvedValue({
  url: 'https://example.com', title: 'Example', description: 'An example', content: 'Hello world',
  links: ['https://example.com/about'], images: [], metadata: {},
});
vi.mock('../rag/web-scraper.js', () => ({
  WebScraper: class { scrape = mockWebScraperScrape; },
}));

const mockEscalationEscalate = vi.fn().mockResolvedValue(true);
vi.mock('../services/escalation.js', () => ({
  EscalationService: class { escalateSimple = mockEscalationEscalate; },
}));

const mockEmbeddingGenerate = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
vi.mock('../rag/embeddings.js', () => ({
  EmbeddingService: class { generateEmbedding = mockEmbeddingGenerate; },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
  };
});

const config: WAgentConfig = {
  whatsappSessionName: 'test',
  whatsappSessionDir: '/tmp/test',
  aiProvider: 'openai',
  systemPrompt: 'test',
  dashboardPort: 3000,
  dashboardHost: 'localhost',
  databaseType: 'sqlite',
  databaseUrl: ':memory:',
  resolved: { provider: 'openai', model: 'gpt-4', apiKey: 'test', baseUrl: 'https://api.openai.com/v1' },
};

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn() } as any,
    db: {
      searchContacts: vi.fn().mockReturnValue([{ id: 'c1', name: 'Alice', number: '123' }]),
      getContact: vi.fn().mockReturnValue({ id: 'c1', name: 'Alice', tags: ['vip'], notes: '' }),
      saveContact: vi.fn(),
      getMessages: vi.fn().mockReturnValue([
        { fromMe: false, content: 'hi', timestamp: new Date() },
        { fromMe: true, content: 'hello', timestamp: new Date() },
      ]),
      searchKnowledge: vi.fn().mockReturnValue([]),
      searchKnowledgeSemantic: vi.fn().mockReturnValue([]),
      searchOrders: vi.fn().mockReturnValue([]),
      searchProducts: vi.fn().mockReturnValue([]),
      createScheduledMessage: vi.fn(),
    } as any,
    config,
    contactId: 'c1',
    pendingMessages: [],
    ...overrides,
  };
}

describe('createBuiltInTools', () => {
  let tools: ReturnType<typeof createBuiltInTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = createBuiltInTools(config);
  });

  it('returns array of ToolDefinitions', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('each tool has name, description, parameters, handler', () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  describe('get_current_time', () => {
    it('returns formatted time', async () => {
      const tool = tools.find(t => t.name === 'get_current_time')!;
      const result = await tool.handler({}, createContext());
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('get_customer_info', () => {
    it('searches contacts via db', async () => {
      const tool = tools.find(t => t.name === 'get_customer_info')!;
      const ctx = createContext();
      const result = await tool.handler({ query: 'Alice' }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(true);
      expect(parsed.customer.name).toBe('Alice');
      expect(ctx.db.searchContacts).toHaveBeenCalledWith('Alice');
    });
  });

  describe('get_conversation_history', () => {
    it('returns messages', async () => {
      const tool = tools.find(t => t.name === 'get_conversation_history')!;
      const ctx = createContext();
      const result = await tool.handler({ contactId: 'c1' }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].from).toBe('customer');
      expect(parsed.messages[1].from).toBe('bot');
    });
  });

  describe('add_note', () => {
    it('saves note to contact', async () => {
      const tool = tools.find(t => t.name === 'add_note')!;
      const ctx = createContext();
      const result = await tool.handler({ contactId: 'c1', note: 'Important' }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(ctx.db.saveContact).toHaveBeenCalled();
    });
  });

  describe('get_customer_tags', () => {
    it('returns tags', async () => {
      const tool = tools.find(t => t.name === 'get_customer_tags')!;
      const result = await tool.handler({ contactId: 'c1' }, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.tags).toEqual(['vip']);
    });
  });

  describe('send_message', () => {
    it('pushes to pendingMessages', async () => {
      const tool = tools.find(t => t.name === 'send_message')!;
      const ctx = createContext();
      await tool.handler({ message: 'Hello there' }, ctx);
      expect(ctx.pendingMessages).toHaveLength(1);
      expect(ctx.pendingMessages![0].content).toBe('Hello there');
      expect(ctx.pendingMessages![0].type).toBe('text');
    });
  });

  describe('send_image', () => {
    it('pushes to pendingMessages', async () => {
      const tool = tools.find(t => t.name === 'send_image')!;
      const ctx = createContext();
      await tool.handler({ imageUrl: 'https://example.com/img.png', caption: 'Photo' }, ctx);
      expect(ctx.pendingMessages).toHaveLength(1);
      expect(ctx.pendingMessages![0].type).toBe('image');
      expect(ctx.pendingMessages![0].imageUrl).toBe('https://example.com/img.png');
    });
  });

  describe('search_knowledge_base', () => {
    it('does semantic search', async () => {
      const tool = tools.find(t => t.name === 'search_knowledge_base')!;
      const ctx = createContext();
      ctx.db.searchKnowledgeSemantic = vi.fn().mockReturnValue([
        {
          entry: { id: 'k1', category: 'faq', question: 'Pricing', answer: '$10/mo', keywords: [], tags: [], priority: 1, createdAt: new Date(), updatedAt: new Date() },
          score: 0.9,
          matchedOn: 'semantic',
        },
      ]);
      ctx.knowledgeStore = {
        search: vi.fn().mockResolvedValue([
          { content: 'Pricing info', score: 0.9, fileName: 'pricing.md', sectionHeading: 'Prices' },
        ]),
      } as any;
      const result = await tool.handler({ query: 'pricing' }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(true);
      expect(parsed.searchMethod).toBe('semantic');
    });

    it('falls back to keyword', async () => {
      mockEmbeddingGenerate.mockResolvedValueOnce(null);
      const tool = tools.find(t => t.name === 'search_knowledge_base')!;
      const ctx = createContext();
      ctx.db.searchKnowledge = vi.fn().mockReturnValue([
        {
          entry: { id: 'k1', category: 'faq', question: 'Q', answer: 'A', keywords: [], tags: [], priority: 1, createdAt: new Date(), updatedAt: new Date() },
          score: 0.8,
          matchedOn: 'keyword',
        },
      ]);
      const result = await tool.handler({ query: 'payment' }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(true);
      expect(parsed.searchMethod).toBe('keyword');
    });
  });

  describe('safe_shell', () => {
    it('executes command', async () => {
      const tool = tools.find(t => t.name === 'safe_shell')!;
      const result = await tool.handler({ command: 'echo hello' }, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.stdout).toBe('ok');
    });
  });

  describe('http_request', () => {
    it('makes GET request', async () => {
      mockHttpClientGet.mockResolvedValueOnce({ ok: true, status: 200, body: 'response', headers: {} });
      const tool = tools.find(t => t.name === 'http_request')!;
      const result = await tool.handler({ url: 'https://api.example.com/data' }, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.status).toBe(200);
    });

    it('blocks localhost', async () => {
      const tool = tools.find(t => t.name === 'http_request')!;
      const result = await tool.handler({ url: 'http://localhost:3000/secret' }, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
    });
  });

  describe('file_read', () => {
    it('reads file', async () => {
      const tool = tools.find(t => t.name === 'file_read')!;
      const result = await tool.handler({ path: 'test.txt' }, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(true);
      expect(parsed.content).toBe('file contents');
    });
  });

  describe('file_write', () => {
    it('writes file', async () => {
      const tool = tools.find(t => t.name === 'file_write')!;
      const result = await tool.handler({ path: 'out.txt', content: 'data' }, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe('file_list', () => {
    it('lists files', async () => {
      const tool = tools.find(t => t.name === 'file_list')!;
      const result = await tool.handler({}, createContext());
      const parsed = JSON.parse(result);
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].name).toBe('test.txt');
    });
  });

  describe('create_reminder', () => {
    it('parses ISO datetime', async () => {
      const tool = tools.find(t => t.name === 'create_reminder')!;
      const ctx = createContext();
      const isoDate = new Date(Date.now() + 3600000).toISOString();
      const result = await tool.handler({ message: 'Call', datetime: isoDate }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(ctx.db.createScheduledMessage).toHaveBeenCalled();
    });

    it('parses Indonesian relative time', async () => {
      const tool = tools.find(t => t.name === 'create_reminder')!;
      const ctx = createContext();
      const result = await tool.handler({ message: 'Rapat', datetime: 'besok jam 14' }, ctx);
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      const scheduled = ctx.db.createScheduledMessage.mock.calls[0][0];
      expect(scheduled.scheduledAt.getHours()).toBe(14);
    });
  });

  describe('escalate_to_human', () => {
    it('calls EscalationService', async () => {
      const tool = tools.find(t => t.name === 'escalate_to_human')!;
      const result = await tool.handler(
        { reason: 'Complex issue', customerQuestion: 'How do I refund?' },
        createContext()
      );
      const parsed = JSON.parse(result);
      expect(parsed.escalated).toBe(true);
    });
  });
});
