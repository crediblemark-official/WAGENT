import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockMcpTool, mockMcpConnect, mockMcpClose, mockMcpHandleRequest, MockMcpServerClass, MockStdioTransport, mockCreateServer, mockListen } = vi.hoisted(() => {
  const mockMcpTool = vi.fn();
  const mockMcpConnect = vi.fn().mockResolvedValue(undefined);
  const mockMcpClose = vi.fn().mockResolvedValue(undefined);
  const mockMcpHandleRequest = vi.fn().mockResolvedValue({ result: 'ok' });

  class MockMcpServerClass {
    tool = mockMcpTool;
    connect = mockMcpConnect;
    close = mockMcpClose;
    handleRequest = mockMcpHandleRequest;
    constructor(_opts: any) {}
  }

  class MockStdioTransport {
    constructor(_opts?: any) {}
  }

  const mockListen = vi.fn();
  const mockCreateServer = vi.fn().mockImplementation(() => ({
    listen: mockListen,
    close: vi.fn(),
    on: vi.fn(),
  }));

  return { mockMcpTool, mockMcpConnect, mockMcpClose, mockMcpHandleRequest, MockMcpServerClass, MockStdioTransport, mockCreateServer, mockListen };
});

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

vi.mock('@modelcontextprotocol/server', () => ({
  McpServer: MockMcpServerClass,
}));

vi.mock('@modelcontextprotocol/server/stdio', () => ({
  StdioServerTransport: MockStdioTransport,
}));

vi.mock('http', () => ({
  createServer: mockCreateServer,
}));

import { MCPServer, MCPServerOptions } from '../mcp/server.js';
import { ToolDefinition } from '../types.js';

describe('MCPServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpConnect.mockResolvedValue(undefined);
    mockMcpClose.mockResolvedValue(undefined);
    mockMcpHandleRequest.mockResolvedValue({ result: 'ok' });
    mockCreateServer.mockImplementation(() => ({
      listen: mockListen,
      close: vi.fn(),
      on: vi.fn(),
    }));
  });

  describe('constructor', () => {
    it('should create server with default options', () => {
      const server = new MCPServer();
      expect(server).toBeDefined();
    });

    it('should create server with custom name and version', () => {
      const server = new MCPServer({ name: 'my-server', version: '2.0.0' });
      expect(server).toBeDefined();
    });

    it('should create server with tools', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'test',
          description: 'test tool',
          parameters: {},
          handler: async () => 'ok',
        },
      ];
      const server = new MCPServer({ tools });
      expect(server).toBeDefined();
    });
  });

  describe('startStdio', () => {
    it('should start MCP server on stdio transport', async () => {
      const server = new MCPServer();

      await server.startStdio();

      expect(mockMcpConnect).toHaveBeenCalled();
    });

    it('should register tools when starting on stdio', async () => {
      const handler = vi.fn().mockResolvedValue('tool result');
      const tools: ToolDefinition[] = [
        { name: 'greet', description: 'Greet someone', parameters: {}, handler },
      ];

      const server = new MCPServer({ tools });
      await server.startStdio();

      expect(mockMcpTool).toHaveBeenCalledWith(
        'greet',
        'Greet someone',
        {},
        expect.any(Function)
      );
    });

    it('should throw on stdio start failure', async () => {
      mockMcpConnect.mockRejectedValueOnce(new Error('stdio failed'));

      const server = new MCPServer();
      await expect(server.startStdio()).rejects.toThrow('stdio failed');
    });
  });

  describe('startHTTP', () => {
    it('should start MCP server on HTTP transport', async () => {
      const server = new MCPServer();

      await server.startHTTP(3001, '127.0.0.1');

      expect(mockCreateServer).toHaveBeenCalled();
      expect(mockListen).toHaveBeenCalledWith(3001, '127.0.0.1', expect.any(Function));
    });

    it('should use default host 0.0.0.0', async () => {
      const server = new MCPServer();

      await server.startHTTP(8080);

      expect(mockListen).toHaveBeenCalledWith(8080, '0.0.0.0', expect.any(Function));
    });

    it('should register tools when starting on HTTP', async () => {
      const handler = vi.fn().mockResolvedValue('http tool result');
      const tools: ToolDefinition[] = [
        { name: 'fetch', description: 'Fetch data', parameters: {}, handler },
      ];

      const server = new MCPServer({ tools });
      await server.startHTTP(3001);

      expect(mockMcpTool).toHaveBeenCalledWith(
        'fetch',
        'Fetch data',
        {},
        expect.any(Function)
      );
    });

    it('should throw on HTTP start failure', async () => {
      mockCreateServer.mockImplementationOnce(() => {
        throw new Error('http failed');
      });

      const server = new MCPServer();

      await expect(server.startHTTP(3001)).rejects.toThrow('http failed');
    });
  });

  describe('registerTools (via startStdio)', () => {
    it('should register multiple tools', async () => {
      const tools: ToolDefinition[] = [
        { name: 't1', description: 'tool 1', parameters: { type: 'object' }, handler: async () => 'a' },
        { name: 't2', description: 'tool 2', parameters: { type: 'object', properties: { x: {} } }, handler: async () => 'b' },
        { name: 't3', description: 'tool 3', parameters: {}, handler: async () => 'c' },
      ];

      const server = new MCPServer({ tools });
      await server.startStdio();

      expect(mockMcpTool).toHaveBeenCalledTimes(3);
      expect(mockMcpTool).toHaveBeenCalledWith('t1', 'tool 1', { type: 'object' }, expect.any(Function));
      expect(mockMcpTool).toHaveBeenCalledWith('t2', 'tool 2', { type: 'object', properties: { x: {} } }, expect.any(Function));
      expect(mockMcpTool).toHaveBeenCalledWith('t3', 'tool 3', {}, expect.any(Function));
    });

    it('should not register tools when tools array is empty', async () => {
      const server = new MCPServer({ tools: [] });
      await server.startStdio();

      expect(mockMcpTool).not.toHaveBeenCalled();
    });

    it('should not register tools when mcpServer is null', async () => {
      const server = new MCPServer();
      expect(mockMcpTool).not.toHaveBeenCalled();
    });

    it('should wrap tool handler to return MCP content format', async () => {
      const handler = vi.fn().mockResolvedValue('hello from tool');
      const tools: ToolDefinition[] = [
        { name: 'echo', description: 'echo', parameters: {}, handler },
      ];

      const server = new MCPServer({ tools });
      await server.startStdio();

      const registeredHandler = mockMcpTool.mock.calls[0][3];

      const result = await registeredHandler({ input: 'test' });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'hello from tool' }],
      });
      expect(handler).toHaveBeenCalledWith(
        { input: 'test' },
        expect.objectContaining({
          logger: expect.anything(),
          contactId: 'mcp-client',
        })
      );
    });

    it('should handle tool handler errors gracefully', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('tool crashed'));
      const tools: ToolDefinition[] = [
        { name: 'bad', description: 'bad tool', parameters: {}, handler },
      ];

      const server = new MCPServer({ tools });
      await server.startStdio();

      const registeredHandler = mockMcpTool.mock.calls[0][3];

      const result = await registeredHandler({});

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ error: 'tool crashed' }) }],
        isError: true,
      });
    });

    it('should pass context.db from options to tool handler', async () => {
      const mockDb = { query: vi.fn() } as any;
      const mockConfig = { appName: 'test' } as any;
      const handler = vi.fn().mockResolvedValue('ok');
      const tools: ToolDefinition[] = [
        { name: 'db-tool', description: 'uses db', parameters: {}, handler },
      ];

      const server = new MCPServer({
        tools,
        context: { db: mockDb, config: mockConfig },
      });
      await server.startStdio();

      const registeredHandler = mockMcpTool.mock.calls[0][3];
      await registeredHandler({});

      expect(handler).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          db: mockDb,
          config: mockConfig,
        })
      );
    });

    it('should pass knowledgeStore from options to tool handler', async () => {
      const mockKS = { search: vi.fn() } as any;
      const handler = vi.fn().mockResolvedValue('ok');
      const tools: ToolDefinition[] = [
        { name: 'ks-tool', description: 'uses knowledge', parameters: {}, handler },
      ];

      const server = new MCPServer({
        tools,
        context: { knowledgeStore: mockKS },
      });
      await server.startStdio();

      const registeredHandler = mockMcpTool.mock.calls[0][3];
      await registeredHandler({});

      expect(handler).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          knowledgeStore: mockKS,
        })
      );
    });
  });

  describe('stop', () => {
    it('should close the MCP server', async () => {
      const server = new MCPServer();
      await server.startStdio();
      await server.stop();

      expect(mockMcpClose).toHaveBeenCalled();
    });

    it('should be a no-op when server was never started', async () => {
      const server = new MCPServer();
      await server.stop();

      expect(mockMcpClose).not.toHaveBeenCalled();
    });

    it('should set mcpServer to null after stop', async () => {
      const server = new MCPServer();
      await server.startStdio();
      await server.stop();

      const connectCountBefore = mockMcpConnect.mock.calls.length;

      await server.startStdio();

      expect(mockMcpConnect.mock.calls.length).toBe(connectCountBefore + 1);
    });
  });
});
