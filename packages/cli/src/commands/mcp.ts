import { join } from 'path';
import color from 'picocolors';
import { loadConfig } from '@wagent/core';

export async function listMcpServers(): Promise<void> {
  const config = await loadConfig();
  const mcpServers = (config as any).mcpServers || [];

  console.log('');
  console.log(color.bold('🔌 WAGENT MCP Servers'));
  console.log('──────────────────────────');

  if (mcpServers.length === 0) {
    console.log(color.dim('  Tidak ada MCP server terkonfigurasi.'));
    console.log(color.dim('  Tambahkan di .env:'));
    console.log(color.dim('    MCP_SERVERS=[{"name":"mysql","command":"npx","args":["mysql-mcp-server"]}]'));
    console.log('');
    return;
  }

  for (const server of mcpServers) {
    console.log(`  ${color.cyan(server.name || 'unnamed')}`);
    console.log(`    Command: ${color.green(server.command)} ${(server.args || []).join(' ')}`);
    if (server.env) console.log(`    Env: ${Object.keys(server.env).join(', ')}`);
    console.log('');
  }

  console.log(color.dim(`  Total: ${mcpServers.length} servers`));
  console.log('');
}

export async function testMcpServer(serverName?: string): Promise<void> {
  const { MCPClient } = await import('@wagent/core');
  const config = await loadConfig();
  const mcpServers = (config as any).mcpServers || [];

  if (mcpServers.length === 0) {
    console.log(color.red('✗ Tidak ada MCP server terkonfigurasi.'));
    return;
  }

  const client = new MCPClient();
  const servers = serverName
    ? mcpServers.filter((s: any) => s.name === serverName)
    : mcpServers;

  for (const server of servers) {
    console.log(`\n  Connecting to ${color.cyan(server.name)}...`);
    const ok = await client.connect(server);
    if (ok) {
      console.log(color.green(`  ✓ Connected to ${server.name}`));
      const tools = client.listServers().find(s => s.name === server.name);
      console.log(`    Tools: ${tools?.tools.join(', ') || 'none'}`);
    } else {
      console.log(color.red(`  ✗ Failed to connect to ${server.name}`));
    }
  }

  await client.disconnectAll();
  console.log('');
}

export async function exposeMcpServer(opts: { port: string; stdio?: boolean }): Promise<void> {
  const { MCPServer, SkillLoader, loadConfig } = await import('@wagent/core');
  const config = await loadConfig();
  const SKILLS_DIR = join(process.cwd(), 'skills');

  const loader = new SkillLoader(SKILLS_DIR);
  await loader.loadAll();
  const tools = loader.getTools();

  if (tools.length === 0) {
    console.log(color.red('✗ Tidak ada tools untuk di-expose.'));
    return;
  }

  console.log(`\n  Exposing ${color.green(String(tools.length))} tools via MCP...`);

  const server = new MCPServer({
    name: 'wagent',
    version: '1.0.0',
    tools,
  });

  if (opts.stdio) {
    console.log(color.dim('  Starting on stdio...'));
    await server.startStdio();
  } else {
    const port = parseInt(opts.port) || 3001;
    console.log(color.dim(`  Starting on HTTP port ${port}...`));
    await server.startHTTP(port);
  }
}
