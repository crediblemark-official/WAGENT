/**
 * MCP Server - Expose WAGENT tools to other AI systems
 *
 * Allows other AI applications (Claude, ChatGPT, Cursor, etc.)
 * to use WAGENT's tools via MCP protocol.
 *
 * Usage:
 *   const server = new MCPServer(gateway);
 *   await server.startStdio();  // For local usage
 *   await server.startHTTP(3001);  // For remote access
 */

import { Logger } from 'pino';
import { getLogger } from './logger.js';
import { ToolDefinition, ToolContext } from './types.js';

export interface MCPServerOptions {
  /** Server name */
  name?: string;
  /** Server version */
  version?: string;
  /** Tools to expose (default: all gateway tools) */
  tools?: ToolDefinition[];
  /** Tool context for handlers */
  context?: Partial<ToolContext>;
}

/**
 * MCPServer exposes WAGENT tools via MCP protocol.
 * Other AI applications can connect and use WAGENT's capabilities.
 */
export class MCPServer {
  private logger: Logger;
  private options: MCPServerOptions;
  private mcpServer: any = null;

  constructor(options: MCPServerOptions = {}) {
    this.logger = getLogger().child({ module: 'mcp-server' });
    this.options = {
      name: options.name || 'wagent',
      version: options.version || '1.0.0',
      tools: options.tools || [],
      context: options.context || {},
    };
  }

  /**
   * Start MCP server over stdio (for local usage)
   */
  async startStdio(): Promise<void> {
    try {
      const { McpServer } = await import('@modelcontextprotocol/server');
      const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');

      this.mcpServer = new McpServer({
        name: this.options.name!,
        version: this.options.version!,
      });

      this.registerTools();

      const transport = new StdioServerTransport();
      await this.mcpServer.connect(transport);

      this.logger.info('MCP server started on stdio');
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to start MCP server on stdio');
      throw err;
    }
  }

  /**
   * Start MCP server over HTTP
   */
  async startHTTP(port: number, host = '0.0.0.0'): Promise<void> {
    try {
      const { McpServer } = await import('@modelcontextprotocol/server');

      this.mcpServer = new McpServer({
        name: this.options.name!,
        version: this.options.version!,
      });

      this.registerTools();

      // Create HTTP server
      const http = await import('http');
      const server = http.createServer(async (req, res) => {
        // Handle MCP protocol over HTTP
        if (req.method === 'POST' && req.url === '/mcp') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const request = JSON.parse(body);
              const response = await this.mcpServer.handleRequest(request);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(response));
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(port, host, () => {
        this.logger.info({ port, host }, 'MCP server started on HTTP');
      });
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to start MCP server on HTTP');
      throw err;
    }
  }

  /**
   * Register tools with MCP server
   */
  private registerTools(): void {
    if (!this.mcpServer) return;

    for (const tool of this.options.tools || []) {
      this.mcpServer.tool(
        tool.name,
        tool.description,
        tool.parameters,
        async (args: Record<string, unknown>) => {
          try {
            const context: ToolContext = {
              logger: this.logger,
              db: this.options.context?.db!,
              config: this.options.context?.config!,
              contactId: 'mcp-client',
              knowledgeStore: this.options.context?.knowledgeStore,
            };

            const result = await tool.handler(args, context);

            return {
              content: [{
                type: 'text',
                text: result,
              }],
            };
          } catch (err: any) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: err.message }),
              }],
              isError: true,
            };
          }
        }
      );

      this.logger.debug({ tool: tool.name }, 'Registered MCP tool');
    }

    this.logger.info({ tools: this.options.tools?.length || 0 }, 'Registered all MCP tools');
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.close();
      this.mcpServer = null;
      this.logger.info('MCP server stopped');
    }
  }
}
