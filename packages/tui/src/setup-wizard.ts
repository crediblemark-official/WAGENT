/**
 * Setup Wizard - Creates config.jsonc via interactive CLI
 * 
 * Uses @clack/prompts for beautiful terminal UI.
 * No manual file editing needed.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { intro, outro, text, select, confirm, isCancel, cancel, spinner } from '@clack/prompts';
import color from 'picocolors';
import { getLogger, getCatalogProviders, getModelsForProviderCatalog } from '@wagent/core';

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

  // Load existing config if available
  const configPath = join(process.cwd(), 'config.jsonc');
  let existingConfig: any = null;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      existingConfig = parseJsonc(content);
    } catch {
      // Ignore parse error
    }
  }

  const existingProviders = existingConfig?.providers || {};

  const config: WizardConfig = {
    session: existingConfig?.session || 'wagent-session',
    model: existingConfig?.model || '',
    apiKey: '',
    provider: '',
    agent: {
      welcomeMessage: existingConfig?.agent?.welcomeMessage || 'Halo! 👋 Ada yang bisa saya bantu hari ini?',
    },
    dashboard: {
      enabled: existingConfig?.dashboard?.enabled !== false,
      port: existingConfig?.dashboard?.port || 3030,
    },
  };

  // ── Step 1: Pilih AI Provider (Dinamis dari Catalog) ─────────────
  intro(color.cyan('🔍 Mengambil daftar provider dari models.dev...'));
  const providersMap = await getCatalogProviders();
  
  const providerOptions = Object.entries(providersMap).map(([id, p]) => {
    const hasConfig = !!(existingProviders[id]?.apiKey || existingProviders[id]?.baseUrl);
    return {
      value: id,
      label: hasConfig ? `${p.name || id} ${color.green('✔ (Terkonfigurasi)')}` : (p.name || id),
    };
  });
  
  // Sort: provider populer berada di paling atas
  const popularOrder = ['openai', 'google', 'gemini', 'anthropic', 'claude', 'deepseek', 'groq', 'ollama'];
  providerOptions.sort((a, b) => {
    const idxA = popularOrder.indexOf(a.value);
    const idxB = popularOrder.indexOf(b.value);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.label.localeCompare(b.label);
  });

  const provider = await select({
    message: 'Pilih AI Provider:',
    options: providerOptions,
  }) as string;

  if (isCancel(provider)) {
    cancel('Setup dibatalkan.');
    process.exit(0);
  }

  config.provider = provider;
  const providerInfo = providersMap[provider];

  // ── Step 2: Credentials ─────────────────────────────────────────
  if (provider === 'ollama') {
    const oldBaseUrl = existingProviders[provider]?.baseUrl || providerInfo?.api || 'http://localhost:11434/api';
    const baseUrl = await text({
      message: 'Ollama base URL:',
      placeholder: 'http://localhost:11434/api',
      defaultValue: oldBaseUrl,
    });
    if (isCancel(baseUrl)) process.exit(0);
    config.baseUrl = baseUrl as string;
  } else {
    const envKey = providerInfo?.env?.[0] || `${provider.toUpperCase()}_API_KEY`;
    const oldApiKey = existingProviders[provider]?.apiKey || '';
    const apiKey = await text({
      message: `Masukkan API Key untuk ${providerInfo?.name || provider} (${envKey}):`,
      placeholder: oldApiKey ? 'Menggunakan API Key yang disimpan...' : '...',
      defaultValue: oldApiKey,
      validate: (v) => !v ? 'API Key tidak boleh kosong' : undefined,
    });
    if (isCancel(apiKey)) process.exit(0);
    config.apiKey = apiKey as string;
  }

  // ── Step 3: Pilih Model (Dinamis dari Catalog) ──────────────────
  intro(color.cyan(`🔍 Mengambil daftar model untuk ${providerInfo?.name || provider}...`));
  const modelsList = await getModelsForProviderCatalog(provider);
  
  let modelId: string;
  if (modelsList.length > 0) {
    modelsList.push({ value: 'custom', label: 'Tulis model kustom secara manual...' });
    
    const selectedModel = await select({
      message: `Pilih model untuk ${providerInfo?.name || provider}:`,
      options: modelsList,
    }) as string;
    
    if (isCancel(selectedModel)) process.exit(0);
    
    if (selectedModel === 'custom') {
      const customModelInput = await text({
        message: `Masukkan nama model kustom (contoh: gpt-4o, gemini-2.0-flash):`,
        validate: (v) => !v ? 'Nama model tidak boleh kosong' : undefined,
      });
      if (isCancel(customModelInput)) process.exit(0);
      modelId = customModelInput as string;
    } else {
      modelId = selectedModel;
    }
  } else {
    const customModelInput = await text({
      message: `Masukkan nama model untuk ${providerInfo?.name || provider} (contoh: llama3):`,
      validate: (v) => !v ? 'Nama model tidak boleh kosong' : undefined,
    });
    if (isCancel(customModelInput)) process.exit(0);
    modelId = customModelInput as string;
  }

  config.model = `${provider}/${modelId}`;

  // ── Step 4: Session Name ────────────────────────────────────────
  const session = await text({
    message: 'Nama session WhatsApp:',
    placeholder: 'wagent-session',
    defaultValue: config.session,
  });

  if (isCancel(session)) process.exit(0);
  config.session = session as string;

  // ── Step 5: Welcome Message ─────────────────────────────────────
  const welcomeMessage = await text({
    message: 'Welcome message untuk chat baru:',
    placeholder: 'Halo! Ada yang bisa saya bantu?',
    defaultValue: config.agent.welcomeMessage,
  });

  if (isCancel(welcomeMessage)) process.exit(0);
  config.agent.welcomeMessage = welcomeMessage as string;

  // ── Step 6: Dashboard ───────────────────────────────────────────
  const enableDashboard = await confirm({
    message: 'Aktifkan web dashboard?',
    initialValue: config.dashboard.enabled,
  }) as boolean;

  if (enableDashboard) {
    const port = await text({
      message: 'Port untuk dashboard:',
      placeholder: '3030',
      defaultValue: String(config.dashboard.port),
    });

    if (isCancel(port)) process.exit(0);
    config.dashboard.port = Number(port);
  } else {
    config.dashboard.enabled = false;
  }

  // ── Generate Config ─────────────────────────────────────────────
  const s = spinner();
  s.start('Generating config.jsonc...');

  // Merge new provider config with existing ones
  const mergedProviders = { ...existingProviders };
  mergedProviders[config.provider] = {};
  if (config.apiKey) {
    mergedProviders[config.provider].apiKey = config.apiKey;
  }
  if (config.baseUrl) {
    mergedProviders[config.provider].baseUrl = config.baseUrl;
  }

  const jsonConfig = generateJsonConfig(config, mergedProviders);
  
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

function parseJsonc(content: string): any {
  try {
    let cleaned = content.replace(/\/\/.*$/gm, (match) => {
      const idx = content.indexOf(match);
      const before = content.substring(0, idx);
      const openQuotes = (before.match(/"/g) || []).length;
      return openQuotes % 2 === 0 ? '' : match;
    });
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function generateJsonConfig(config: WizardConfig, providers: any): string {
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
  
  // Providers
  lines.push('  // API Keys / Base URLs');
  lines.push('  "providers": {');
  const providerEntries = Object.entries(providers);
  providerEntries.forEach(([pId, pConfig]: [string, any], index) => {
    lines.push(`    "${pId}": {`);
    const fields: string[] = [];
    if (pConfig.apiKey) {
      fields.push(`      "apiKey": "${pConfig.apiKey}"`);
    }
    if (pConfig.baseUrl) {
      fields.push(`      "baseUrl": "${pConfig.baseUrl}"`);
    }
    lines.push(fields.join(',\n'));
    lines.push(index === providerEntries.length - 1 ? '    }' : '    },');
  });
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
