/**
 * Setup Wizard - Creates config.jsonc via interactive CLI
 * 
 * Uses @clack/prompts for beautiful terminal UI.
 * No manual file editing needed.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { intro, outro, text, confirm, isCancel, cancel, spinner } from '@clack/prompts';
import color from 'picocolors';
import { getLogger } from '@wagent/core';
import { resolveModel } from '@wagent/core';

// ── Types ───────────────────────────────────────────────────────

interface WizardConfig {
  session: string;
  model: string;
  apiKey: string;
  provider: string;
  baseUrl?: string;
  agent: {
    welcomeMessage: string;
  };
  dashboard: {
    enabled: boolean;
    port: number;
  };
}

// ── Main Wizard ─────────────────────────────────────────────────

export async function setupWizard(): Promise<void> {
  console.clear();
  intro(color.inverse(' WAGENT Setup Wizard '));

  const config: WizardConfig = {
    session: 'wagent-session',
    model: '',
    apiKey: '',
    provider: '',
    agent: {
      welcomeMessage: 'Halo! 👋 Ada yang bisa saya bantu hari ini?',
    },
    dashboard: {
      enabled: true,
      port: 3030,
    },
  };

  // ── Step 1: AI Model ID ─────────────────────────────────────────
  const modelIdInput = await text({
    message: 'Masukkan Model ID dari models.dev (contoh: google/gemini-2.0-flash, openai/gpt-4o, deepseek/deepseek-chat, ollama/llama3):',
    placeholder: 'google/gemini-2.0-flash',
    defaultValue: 'google/gemini-2.0-flash',
    validate: (v) => {
      if (!v) return 'Model ID tidak boleh kosong';
      if (!v.includes('/')) {
        return 'Format model ID tidak valid (harus provider/model)';
      }
      return undefined;
    }
  });

  if (isCancel(modelIdInput)) {
    cancel('Setup dibatalkan.');
    process.exit(0);
  }

  // Resolve model ID
  intro(color.cyan('🔍 Menghubungkan ke models.dev & memverifikasi model...'));
  const resolved = await resolveModel(modelIdInput as string);

  config.provider = resolved.provider;
  config.model = resolved.input;

  // ── Step 2: Credentials ─────────────────────────────────────────
  if (resolved.provider === 'ollama') {
    const baseUrl = await text({
      message: 'Ollama base URL:',
      placeholder: 'http://localhost:11434/api',
      defaultValue: resolved.baseUrl || 'http://localhost:11434/api',
    });
    if (isCancel(baseUrl)) process.exit(0);
    config.baseUrl = baseUrl as string;
  } else {
    const envKey = resolved.envKey || `${resolved.provider.toUpperCase()}_API_KEY`;
    const apiKey = await text({
      message: `Masukkan API Key untuk ${resolved.name || resolved.provider} (${envKey}):`,
      placeholder: '...',
      validate: (v) => !v ? 'API Key tidak boleh kosong' : undefined,
    });
    if (isCancel(apiKey)) process.exit(0);
    config.apiKey = apiKey as string;
  }

  // ── Step 3: Session Name ────────────────────────────────────────
  const session = await text({
    message: 'Nama session WhatsApp:',
    placeholder: 'wagent-session',
    defaultValue: 'wagent-session',
  });

  if (isCancel(session)) process.exit(0);
  config.session = session as string;

  // ── Step 4: Welcome Message ─────────────────────────────────────
  const welcomeMessage = await text({
    message: 'Welcome message untuk chat baru:',
    placeholder: 'Halo! Ada yang bisa saya bantu?',
    defaultValue: 'Halo! 👋 Ada yang bisa saya bantu hari ini?',
  });

  if (isCancel(welcomeMessage)) process.exit(0);
  config.agent.welcomeMessage = welcomeMessage as string;

  // ── Step 5: Dashboard ───────────────────────────────────────────
  const enableDashboard = await confirm({
    message: 'Aktifkan web dashboard?',
    initialValue: true,
  }) as boolean;

  if (enableDashboard) {
    const port = await text({
      message: 'Port untuk dashboard:',
      placeholder: '3030',
      defaultValue: '3030',
    });

    if (isCancel(port)) process.exit(0);
    config.dashboard.port = Number(port);
  } else {
    config.dashboard.enabled = false;
  }

  // ── Generate Config ─────────────────────────────────────────────
  const s = spinner();
  s.start('Generating config.jsonc...');

  const jsonConfig = generateJsonConfig(config);
  const configPath = join(process.cwd(), 'config.jsonc');
  
  writeFileSync(configPath, jsonConfig);
  
  s.stop('Config created!');

  // ── Summary ─────────────────────────────────────────────────────
  outro(color.green('Setup selesai!'));
  
  console.log('');
  console.log(color.bold('Configuration:'));
  console.log(color.dim('─'.repeat(40)));
  console.log(`  Session    : ${config.session}`);
  console.log(`  Model      : ${color.cyan(config.model)}`);
  console.log(`  Provider   : ${config.provider}`);
  if (config.apiKey) {
    console.log(`  API Key    : ${config.apiKey.substring(0, 8)}...`);
  }
  console.log(`  Dashboard  : ${config.dashboard.enabled ? color.green('ON') : color.red('OFF')}`);
  console.log('');
  console.log(color.bold('Next steps:'));
  console.log(color.dim('  1. Review config.jsonc if needed'));
  console.log(color.dim('  2. Run: wagent start'));
  console.log('');
}

// ── Helper Functions ────────────────────────────────────────────

function generateJsonConfig(config: WizardConfig): string {
  const lines: string[] = [];
  
  lines.push('{');
  lines.push('  "$schema": "https://raw.githubusercontent.com/crediblemark-official/WAGENT/main/schemas/config.json",');
  lines.push('');
  
  // Session
  lines.push('  // WhatsApp Session');
  lines.push(`  "session": "${config.session}",`);
  lines.push('');
  
  // Model
  lines.push('  // AI Model - auto-detected from provider');
  lines.push(`  "model": "${config.model}",`);
  lines.push('');
  
  // Provider
  lines.push('  // API Keys / Base URLs');
  lines.push('  "providers": {');
  lines.push(`    "${config.provider}": {`);
  if (config.apiKey) {
    lines.push(`      "apiKey": "${config.apiKey}"`);
  } else if (config.baseUrl) {
    lines.push(`      "baseUrl": "${config.baseUrl}"`);
  }
  lines.push('    }');
  lines.push('  },');
  lines.push('');
  
  // Agent
  lines.push('  // Agent Settings');
  lines.push('  "agent": {');
  lines.push(`    "welcomeMessage": "${escapeJson(config.agent.welcomeMessage)}"`);
  lines.push('  },');
  lines.push('');
  
  // Dashboard
  lines.push('  // Dashboard');
  lines.push('  "dashboard": {');
  lines.push(`    "enabled": ${config.dashboard.enabled},`);
  lines.push(`    "port": ${config.dashboard.port}`);
  lines.push('  }');
  
  lines.push('}');
  
  return lines.join('\n');
}

function escapeJson(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
