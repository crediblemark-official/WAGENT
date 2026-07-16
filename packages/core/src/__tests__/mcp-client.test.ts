import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConnect, mockListTools, mockCallTool, mockClose, StdioClientTransport } = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockListTools = vi.fn().mockResolvedValue({ tools: [] });
  const mockCallTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });
  const mockClose = vi.fn().mockResolvedValue(undefined);

  const StdioClientTransport = vi.fn(function(_opts?: any) {});

  return { mockConnect, mockListTools, mockCallTool, mockClose, StdioClientTransport };
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

vi.mock('@modelcontextprotocol/client', () => {
  const MockClient = vi.fn(function(_opts: any) {
    return {
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool,
      close: mockClose,
    };
  });
  return { Client: MockClient };
});

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport,
}));

import { MCPClient, MCPServerConfig } from '../mcp/client.js';

describe('MCPClient', () => {
  let client: MCPClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });
    mockClose.mockResolvedValue(undefined);
    client = new MCPClient();
  });

  describe('connect', () => {
    it('should connect to an MCP server and return true', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [
          { name: 'tool1', description: 'A tool', inputSchema: { type: 'object', properties: {} } },
        ],
      });

      const config: MCPServerConfig = {
        name: 'test-server',
        command: 'node',
        args: ['server.js'],
      };

      const result = await client.connect(config);

      expect(result).toBe(true);
      expect(mockConnect).toHaveBeenCalled();
      expect(mockListTools).toHaveBeenCalled();
    });

    it('should return false on connection failure', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));

      const config: MCPServerConfig = {
        name: 'failing-server',
        command: 'nonexistent',
      };

      const result = await client.connect(config);

      expect(result).toBe(false);
    });

    it('should merge env variables with process.env', async () => {
      const config: MCPServerConfig = {
        name: 'env-server',
        command: 'node',
        env: { MY_VAR: 'test-value' },
      };

      await client.connect(config);

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({ MY_VAR: 'test-value' }),
        })
      );
    });

    it('should use default timeout of 30000 when not specified', async () => {
      const config: MCPServerConfig = {
        name: 'default-timeout-server',
        command: 'node',
      };

      await client.connect(config);

      expect(mockConnect).toHaveBeenCalledWith(
        expect.anything(),
        { timeout: 30000 }
      );
    });

    it('should use custom timeout from config', async () => {
      const config: MCPServerConfig = {
        name: 'custom-timeout-server',
        command: 'node',
        timeoutMs: 5000,
      };

      await client.connect(config);

      expect(mockConnect).toHaveBeenCalledWith(
        expect.anything(),
        { timeout: 5000 }
      );
    });

    it('should use default empty args when not provided', async () => {
      const config: MCPServerConfig = {
        name: 'no-args-server',
        command: 'node',
      };

      await client.connect(config);

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [],
        })
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect from a connected server', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [{ name: 't1' }] });

      await client.connect({ name: 's1', command: 'node' });
      await client.disconnect('s1');

      expect(mockClose).toHaveBeenCalled();
      const servers = client.listServers();
      expect(servers).toHaveLength(0);
    });

    it('should handle disconnect of non-existent server gracefully', async () => {
      await client.disconnect('nonexistent');
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should handle close error gracefully', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [] });
      mockClose.mockRejectedValueOnce(new Error('close failed'));

      await client.connect({ name: 'err-server', command: 'node' });
      await client.disconnect('err-server');

      const servers = client.listServers();
      expect(servers).toHaveLength(0);
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect from all connected servers', async () => {
      mockListTools
        .mockResolvedValueOnce({ tools: [{ name: 't1' }] })
        .mockResolvedValueOnce({ tools: [{ name: 't2' }] });

      await client.connect({ name: 's1', command: 'node' });
      await client.connect({ name: 's2', command: 'node' });

      expect(client.listServers()).toHaveLength(2);

      await client.disconnectAll();

      expect(mockClose).toHaveBeenCalledTimes(2);
      expect(client.listServers()).toHaveLength(0);
    });

    it('should handle empty server list', async () => {
      await client.disconnectAll();
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('getTools', () => {
    it('should return empty array when no servers connected', () => {
      const tools = client.getTools();
      expect(tools).toEqual([]);
    });

    it('should return tool definitions from connected server', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [
          { name: 'search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
        ],
      });

      await client.connect({ name: 'web', command: 'node' });

      const tools = client.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('web__search');
      expect(tools[0].description).toBe('[MCP: web] Search the web');
      expect(tools[0].parameters).toEqual({ type: 'object', properties: { query: { type: 'string' } } });
    });

    it('should prefix tool name with server name', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'toolA' }, { name: 'toolB' }],
      });

      await client.connect({ name: 'myserver', command: 'node' });

      const tools = client.getTools();
      expect(tools[0].name).toBe('myserver__toolA');
      expect(tools[1].name).toBe('myserver__toolB');
    });

    it('should use tool name as description fallback when description is missing', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'no-desc-tool' }],
      });

      await client.connect({ name: 'srv', command: 'node' });

      const tools = client.getTools();
      expect(tools[0].description).toBe('[MCP: srv] no-desc-tool');
    });

    it('should use empty object schema as fallback when inputSchema is missing', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'bare-tool' }],
      });

      await client.connect({ name: 'srv', command: 'node' });

      const tools = client.getTools();
      expect(tools[0].parameters).toEqual({ type: 'object', properties: {} });
    });

    it('should skip tools from disconnected servers', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 't1' }],
      });

      await client.connect({ name: 'srv', command: 'node' });

      const tools = client.getTools();
      expect(tools).toHaveLength(1);

      await client.disconnect('srv');
      const toolsAfterDisconnect = client.getTools();
      expect(toolsAfterDisconnect).toHaveLength(0);
    });

    it('should aggregate tools from multiple servers', async () => {
      mockListTools
        .mockResolvedValueOnce({ tools: [{ name: 'a1' }, { name: 'a2' }] })
        .mockResolvedValueOnce({ tools: [{ name: 'b1' }] });

      await client.connect({ name: 'serverA', command: 'node' });
      await client.connect({ name: 'serverB', command: 'node' });

      const tools = client.getTools();
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name)).toEqual([
        'serverA__a1',
        'serverA__a2',
        'serverB__b1',
      ]);
    });

    it('handler should delegate to callTool', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 'echo', description: 'echo tool' }],
      });
      mockCallTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hello' }] });

      await client.connect({ name: 'srv', command: 'node' });

      const tools = client.getTools();
      const result = await tools[0].handler({ msg: 'hi' }, {} as any);

      expect(result).toBe('hello');
      expect(mockCallTool).toHaveBeenCalledWith({ name: 'echo', arguments: { msg: 'hi' } });
    });
  });

  describe('callTool', () => {
    it('should call tool on connected server and return text', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'output line 1' }, { type: 'text', text: 'output line 2' }],
      });

      await client.connect({ name: 'srv', command: 'node' });

      const result = await client.callTool('srv', 't1', { input: 'val' });

      expect(result).toBe('output line 1\noutput line 2');
      expect(mockCallTool).toHaveBeenCalledWith({ name: 't1', arguments: { input: 'val' } });
    });

    it('should return JSON error for disconnected server', async () => {
      const result = await client.callTool('nonexistent', 'tool', {});

      expect(result).toBe(JSON.stringify({ error: "MCP server 'nonexistent' not connected" }));
    });

    it('should return JSON error on tool call failure', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
      mockCallTool.mockRejectedValueOnce(new Error('tool exploded'));

      await client.connect({ name: 'srv', command: 'node' });

      const result = await client.callTool('srv', 't1', {});

      expect(result).toBe(JSON.stringify({ error: 'tool exploded' }));
    });

    it('should return stringified result when no text content', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'image', data: 'base64data' }],
      });

      await client.connect({ name: 'srv', command: 'node' });

      const result = await client.callTool('srv', 't1', {});

      expect(result).toContain('base64data');
    });

    it('should handle empty content array', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
      mockCallTool.mockResolvedValueOnce({ content: [] });

      await client.connect({ name: 'srv', command: 'node' });

      const result = await client.callTool('srv', 't1', {});

      expect(result).toBeTruthy();
    });

    it('should handle null content gracefully', async () => {
      mockListTools.mockResolvedValueOnce({ tools: [{ name: 't1' }] });
      mockCallTool.mockResolvedValueOnce({ content: null });

      await client.connect({ name: 'srv', command: 'node' });

      const result = await client.callTool('srv', 't1', {});

      expect(result).toBeTruthy();
    });
  });

  describe('listServers', () => {
    it('should return empty array when no servers connected', () => {
      const servers = client.listServers();
      expect(servers).toEqual([]);
    });

    it('should return connected server info', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: 't1' }, { name: 't2' }],
      });

      await client.connect({ name: 'myserver', command: 'node' });

      const servers = client.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('myserver');
      expect(servers[0].tools).toEqual(['t1', 't2']);
      expect(servers[0].connected).toBe(true);
    });

    it('should handle tools with no name as "unnamed"', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [{ name: '' }],
      });

      await client.connect({ name: 'srv', command: 'node' });

      const servers = client.listServers();
      expect(servers[0].tools).toEqual(['unnamed']);
    });

    it('should return multiple servers', async () => {
      mockListTools
        .mockResolvedValueOnce({ tools: [{ name: 'a' }] })
        .mockResolvedValueOnce({ tools: [{ name: 'b' }, { name: 'c' }] });

      await client.connect({ name: 's1', command: 'node' });
      await client.connect({ name: 's2', command: 'node' });

      const servers = client.listServers();
      expect(servers).toHaveLength(2);
      expect(servers.map(s => s.name)).toEqual(['s1', 's2']);
    });
  });

  describe('loadFromConfig', () => {
    it('should connect to all servers in config array', async () => {
      mockListTools.mockResolvedValue({ tools: [] });

      const configs: MCPServerConfig[] = [
        { name: 's1', command: 'node', args: ['a.js'] },
        { name: 's2', command: 'python', args: ['b.py'] },
      ];

      await client.loadFromConfig(configs);

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(client.listServers()).toHaveLength(2);
    });

    it('should handle empty config array', async () => {
      await client.loadFromConfig([]);

      expect(mockConnect).not.toHaveBeenCalled();
      expect(client.listServers()).toHaveLength(0);
    });

    it('should continue loading other servers if one fails', async () => {
      mockListTools.mockResolvedValue({ tools: [] });
      mockConnect
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);

      const configs: MCPServerConfig[] = [
        { name: 'bad', command: 'nonexistent' },
        { name: 'good', command: 'node' },
      ];

      await client.loadFromConfig(configs);

      expect(client.listServers()).toHaveLength(1);
      expect(client.listServers()[0].name).toBe('good');
    });
  });
});
