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
import { getLogger } from '@wagent/core';
import { resolveModel, refreshModelCatalog } from '@wagent/core';

// ── Types ───────────────────────────────────────────────────────

interface WizardConfig {
  session: string;
  model: string;
  apiKey: string;
  provider: string;
  modelId: string;
  agent: {
    systemPrompt: string;
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
    modelId: '',
    agent: {
      systemPrompt: 'Kamu adalah customer service AI yang ramah dan profesional.',
      welcomeMessage: 'Halo! 👋 Ada yang bisa saya bantu hari ini?',
    },
    dashboard: {
      enabled: true,
      port: 3030,
    },
  };

  // ── Step 1: Select Provider ─────────────────────────────────────
  const provider = await select({
    message: 'Pilih AI Provider:',
    options: [
      { value: 'openai', label: 'OpenAI', hint: 'GPT-4o, GPT-4o Mini' },
      { value: 'anthropic', label: 'Anthropic', hint: 'Claude Sonnet, Haiku' },
      { value: 'google', label: 'Google Gemini', hint: 'Gemini 2.0 Flash' },
      { value: 'groq', label: 'Groq', hint: 'Llama, Mixtral (fast)' },
      { value: 'deepseek', label: 'DeepSeek', hint: 'DeepSeek Chat' },
      { value: 'mistral', label: 'Mistral', hint: 'Mistral Large' },
      { value: 'xai', label: 'xAI', hint: 'Grok 3' },
      { value: 'ollama', label: 'Ollama (Local)', hint: 'LLaMA, Mistral (free)' },
    ],
  }) as string;

  if (isCancel(provider)) {
    cancel('Setup dibatalkan.');
    process.exit(0);
  }

  config.provider = provider;

  // ── Step 2: Get API Key ─────────────────────────────────────────
  if (provider !== 'ollama') {
    const apiKey = await text({
      message: `Masukkan API Key untuk ${provider}:`,
      placeholder: getApiKeyPlaceholder(provider),
      validate: (value) => {
        if (!value) return 'API Key harus diisi';
        return undefined;
      },
    });

    if (isCancel(apiKey)) {
      cancel('Setup dibatalkan.');
      process.exit(0);
    }

    config.apiKey = apiKey as string;
  }

  // ── Step 3: Select Model ────────────────────────────────────────
  const models = getModelsForProvider(provider);
  
  const modelId = await select({
    message: 'Pilih model:',
    options: models,
  }) as string;

  if (isCancel(modelId)) {
    cancel('Setup dibatalkan.');
    process.exit(0);
  }

  config.modelId = modelId;
  config.model = `${provider}/${modelId}`;

  // ── Step 4: Session Name ────────────────────────────────────────
  const session = await text({
    message: 'Nama session WhatsApp:',
    placeholder: 'wagent-session',
    defaultValue: 'wagent-session',
  });

  if (!isCancel(session)) {
    config.session = session as string;
  }

  // ── Step 5: Agent Settings ──────────────────────────────────────
  const systemPrompt = await text({
    message: 'System prompt untuk AI agent:',
    placeholder: 'Kamu adalah customer service yang ramah...',
    defaultValue: config.agent.systemPrompt,
  });

  if (!isCancel(systemPrompt)) {
    config.agent.systemPrompt = systemPrompt as string;
  }

  const welcomeMessage = await text({
    message: 'Welcome message untuk chat baru:',
    placeholder: 'Halo! Ada yang bisa saya bantu?',
    defaultValue: config.agent.welcomeMessage,
  });

  if (!isCancel(welcomeMessage)) {
    config.agent.welcomeMessage = welcomeMessage as string;
  }

  // ── Step 6: Dashboard ───────────────────────────────────────────
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

    if (!isCancel(port)) {
      config.dashboard.port = Number(port);
    }
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

function getApiKeyPlaceholder(provider: string): string {
  const placeholders: { [key: string]: string } = {
    openai: 'sk-...',
    anthropic: 'sk-ant-...',
    google: 'AIza...',
    groq: 'gsk_...',
    deepseek: 'sk-...',
    mistral: '',
    xai: '',
  };
  return placeholders[provider] || '';
}

function getModelsForProvider(provider: string): Array<{ value: string; label: string; hint?: string }> {
  const models: { [key: string]: Array<{ value: string; label: string; hint?: string }> } = {
    openai: [
      { value: 'gpt-4o', label: 'GPT-4o', hint: 'Best overall' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Fast & cheap' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', hint: 'Previous gen' },
    ],
    anthropic: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', hint: 'Best for CS' },
      { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', hint: 'Fast & cheap' },
      { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus', hint: 'Most capable' },
    ],
    google: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Fast & capable' },
      { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', hint: 'Cheapest' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', hint: 'Most capable' },
    ],
    groq: [
      { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B', hint: 'Best open source' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', hint: 'Fastest' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', hint: 'Good balance' },
    ],
    deepseek: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat', hint: 'Best for chat' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder', hint: 'Best for code' },
    ],
    mistral: [
      { value: 'mistral-large-latest', label: 'Mistral Large', hint: 'Most capable' },
      { value: 'mistral-small-latest', label: 'Mistral Small', hint: 'Fast & cheap' },
    ],
    xai: [
      { value: 'grok-3', label: 'Grok 3', hint: 'Latest' },
      { value: 'grok-2', label: 'Grok 2', hint: 'Previous gen' },
    ],
    ollama: [
      { value: 'llama3', label: 'LLaMA 3', hint: 'Latest LLaMA' },
      { value: 'llama3.1:8b', label: 'LLaMA 3.1 8B', hint: 'Fast' },
      { value: 'mistral', label: 'Mistral', hint: 'Good balance' },
      { value: 'phi3', label: 'Phi-3', hint: 'Small & fast' },
    ],
  };
  
  return models[provider] || [];
}

function generateJsonConfig(config: WizardConfig): string {
  const lines: string[] = [];
  
  lines.push('{');
  lines.push('  "$schema": "https://wagent.ai/config.json",');
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
  lines.push('  // API Key');
  lines.push('  "providers": {');
  lines.push(`    "${config.provider}": {`);
  if (config.apiKey) {
    lines.push(`      "apiKey": "${config.apiKey}"`);
  }
  lines.push('    }');
  lines.push('  },');
  lines.push('');
  
  // Agent
  lines.push('  // Agent Settings');
  lines.push('  "agent": {');
  lines.push(`    "systemPrompt": "${escapeJson(config.agent.systemPrompt)}",`);
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
