/**
 * MCP Client - Connect to external MCP servers
 *
 * Allows WAGENT to use tools from external MCP servers:
 * - Database connectors (MySQL, PostgreSQL, MongoDB)
 * - File system access
 * - API integrations (Slack, GitHub, etc.)
 * - Custom MCP servers
 *
 * Usage:
 *   const client = new MCPClient();
 *   await client.connect('mysql-server', 'npx mysql-mcp-server');
 *   const tools = await client.listTools();
 *   const result = await client.callTool('query', { sql: 'SELECT * FROM users' });
 */

import { Logger } from 'pino';
import { getLogger } from './logger.js';
import { ToolDefinition, ToolContext } from './types.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Connection timeout in ms */
  timeoutMs?: number;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: any;
}

/**
 * MCPClient connects to external MCP servers and exposes their tools
 * as WAGENT ToolDefinitions.
 */
export class MCPClient {
  private logger: Logger;
  private servers: Map<string, {
    config: MCPServerConfig;
    client: any;
    tools: MCPToolInfo[];
    connected: boolean;
  }> = new Map();

  constructor() {
    this.logger = getLogger().child({ module: 'mcp-client' });
  }

  /**
   * Connect to an MCP server
   */
  async connect(config: MCPServerConfig): Promise<boolean> {
    try {
      // Dynamic import to avoid hard dependency
      const { Client } = await import('@modelcontextprotocol/client');
      const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env } as Record<string, string>,
      });

      const client = new Client({
        name: 'wagent',
        version: '1.0.0',
      });

      await client.connect(transport, { timeout: config.timeoutMs || 30000 });

      // List available tools
      const response = await client.listTools();
      const tools = response.tools || [];

      this.servers.set(config.name, {
        config,
        client,
        tools,
        connected: true,
      });

      this.logger.info({ server: config.name, tools: tools.length }, 'Connected to MCP server');
      return true;
    } catch (err: any) {
      this.logger.error({ error: err.message, server: config.name }, 'Failed to connect to MCP server');
      return false;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (server) {
      try {
        await server.client.close();
      } catch (err: any) {
        this.logger.warn({ server: serverName, error: err.message }, 'Error disconnecting from MCP server');
      }
      server.connected = false;
      this.servers.delete(serverName);
      this.logger.info({ server: serverName }, 'Disconnected from MCP server');
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.disconnect(name);
    }
  }

  /**
   * Get all tools from all connected servers as WAGENT ToolDefinitions
   */
  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const [serverName, server] of this.servers) {
      if (!server.connected) continue;

      for (const mcpTool of server.tools) {
        tools.push({
          name: `${serverName}__${mcpTool.name}`,
          description: `[MCP: ${serverName}] ${mcpTool.description || mcpTool.name}`,
          parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
          handler: async (args: Record<string, unknown>, context: ToolContext) => {
            return this.callTool(serverName, mcpTool.name, args);
          },
        });
      }
    }

    return tools;
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      return JSON.stringify({ error: `MCP server '${serverName}' not connected` });
    }

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Extract text content from result
      const content = result?.content || [];
      const texts = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);

      return texts.join('\n') || JSON.stringify(result);
    } catch (err: any) {
      this.logger.error({ error: err.message, server: serverName, tool: toolName }, 'MCP tool call failed');
      return JSON.stringify({ error: err.message });
    }
  }

  /**
   * List all connected servers and their tools
   */
  listServers(): Array<{ name: string; tools: string[]; connected: boolean }> {
    return Array.from(this.servers.entries()).map(([name, server]) => ({
      name,
      tools: server.tools.map(t => t.name || 'unnamed'),
      connected: server.connected,
    }));
  }

  /**
   * Auto-load MCP servers from config
   */
  async loadFromConfig(servers: MCPServerConfig[]): Promise<void> {
    for (const config of servers) {
      await this.connect(config);
    }
  }
}
