import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import color from 'picocolors';
import { loadConfig } from '@wagent/core';

export async function configCommand(): Promise<void> {
  const config = await loadConfig();
  console.log('');
  console.log(color.bold(color.cyan('  Current Configuration')));
  console.log(color.dim('  ───────────────────────────────────'));
  console.log(`  ${color.dim('Session')}      ${config.whatsappSessionName}`);
  console.log(`  ${color.dim('AI Provider')}  ${config.aiProvider}`);
  console.log(`  ${color.dim('Prompt')}       ${config.systemPrompt.substring(0, 50)}...`);
  console.log(`  ${color.dim('Dashboard')}    ${config.dashboardPort || 'disabled'}`);
  console.log(`  ${color.dim('Database')}     ${config.databaseType} (${config.databaseUrl})`);
  console.log('');

  if (config.resolvedModel) {
    console.log(color.bold(color.cyan('  Model')));
    console.log(color.dim('  ───────────────────────────────────'));
    console.log(`  ${color.dim('Provider')}  ${config.resolvedModel.provider} (${config.resolvedModel.name || ''})`);
    console.log(`  ${color.dim('Model')}     ${config.resolvedModel.model}`);
    if (config.resolvedModel.baseUrl) {
      console.log(`  ${color.dim('Base URL')}  ${config.resolvedModel.baseUrl}`);
    }
    if (config.resolvedModel.apiKey) {
      console.log(`  ${color.dim('API Key')}   ${config.resolvedModel.apiKey.substring(0, 8)}...`);
    }
  }
  console.log('');
}

export async function statusCommand(): Promise<void> {
  const config = await loadConfig();
  const sessionDir = join(
    config.whatsappSessionDir || join(process.cwd(), '.sessions'),
    config.whatsappSessionName
  );

  console.log('');
  if (existsSync(sessionDir)) {
    const files = readdirSync(sessionDir);
    const hasCreds = files.some(f => f.includes('creds'));
    console.log(color.green('  ✓ Session folder found'));
    console.log(`  ${color.dim('Location:')} ${sessionDir}`);
    if (hasCreds) {
      console.log(color.green('  ✓ Credentials saved (previously logged in)'));
    } else {
      console.log(color.yellow('  ⚠ Not yet logged in — scan QR code required'));
    }
  } else {
    console.log(color.yellow('  ⚠ No session found. Run "wagent start" to begin.'));
  }
  console.log('');
}

export function logCommand(options: { lines: string }): void {
  const logPath = join(process.cwd(), 'wagent.log');
  if (!existsSync(logPath)) {
    console.log(color.yellow('Belum ada file log.'));
    return;
  }
  const content = readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').slice(-parseInt(options.lines, 10));
  console.log(lines.join('\n'));
}
