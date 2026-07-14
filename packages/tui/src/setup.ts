import { writeFileSync } from 'fs';
import { intro, outro, text, select, confirm, isCancel, cancel } from '@clack/prompts';
import color from 'picocolors';
import qrcode from 'qrcode-terminal';
import { WAgentConfig, AIProviderType, resolveModel } from '@wagent/core';
import { getLogger } from '@wagent/core';

export async function setupWizard(): Promise<Partial<WAgentConfig>> {
  console.clear();
  intro(color.inverse(' WAGENT Setup Wizard '));

  const config: Partial<WAgentConfig> = {};

  // ── AI Model ID ───────────────────────────────────────────────
  const modelIdInput = await text({
    message: 'Masukkan Model ID dari models.dev (contoh: google/gemini-2.0-flash, openai/gpt-4o, deepseek/deepseek-chat, ollama/llama3):',
    placeholder: 'google/gemini-2.0-flash',
    defaultValue: 'google/gemini-2.0-flash',
    validate: (v) => {
      if (!v) return 'Model ID tidak boleh kosong';
      if (!v.includes('/') && !['openai', 'gemini', 'claude', 'ollama'].includes(v)) {
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

  config.resolvedModel = resolved;
  config.aiProvider = resolved.provider as any;

  // ── Credentials ───────────────────────────────────────────────
  if (resolved.provider === 'ollama') {
    const baseUrl = await text({
      message: 'Ollama base URL:',
      placeholder: 'http://localhost:11434/api',
      defaultValue: resolved.baseUrl || 'http://localhost:11434/api',
    });
    if (isCancel(baseUrl)) process.exit(0);
    config.resolvedModel.baseUrl = baseUrl as string;
    config.ollama = { baseUrl: baseUrl as string, model: resolved.model };
  } else {
    const envKey = resolved.envKey || `${resolved.provider.toUpperCase()}_API_KEY`;
    const apiKey = await text({
      message: `Masukkan API Key untuk ${resolved.name || resolved.provider} (${envKey}):`,
      placeholder: '...',
    });
    if (isCancel(apiKey)) process.exit(0);
    config.resolvedModel.apiKey = apiKey as string;

    // Untuk kompatibilitas ke belakang
    if (resolved.provider === 'openai') {
      config.openai = { apiKey: apiKey as string, model: resolved.model };
    } else if (resolved.provider === 'google') {
      config.gemini = { apiKey: apiKey as string, model: resolved.model };
    } else if (resolved.provider === 'anthropic') {
      config.anthropic = { apiKey: apiKey as string, model: resolved.model };
    }
  }

  // ── System Prompt ──────────────────────────────────────────────
  const systemPrompt = await text({
    message: 'System prompt untuk AI agent:',
    placeholder: 'Kamu adalah customer service yang ramah dan membantu...',
    defaultValue: 'Kamu adalah customer service yang ramah, profesional, dan membantu. Balaslah dengan bahasa Indonesia yang natural dan sopan.',
  });

  if (!isCancel(systemPrompt)) {
    config.systemPrompt = systemPrompt as string;
  }

  // ── Dashboard ─────────────────────────────────────────────────
  const enableDashboard = await confirm({
    message: 'Aktifkan web dashboard?',
    initialValue: true,
  }) as boolean;

  if (enableDashboard) {
    const port = await text({
      message: 'Port untuk dashboard:',
      placeholder: '3030',
      defaultValue: '3030',
      validate: (v) => isNaN(Number(v)) ? 'Masukkan angka valid' : undefined,
    });
    if (!isCancel(port)) {
      config.dashboardPort = Number(port);
      config.dashboardHost = '0.0.0.0';
    }
  } else {
    config.dashboardPort = 0;
    config.dashboardHost = '';
  }

  // ── Welcome Message ───────────────────────────────────────────
  const enableWelcome = await confirm({
    message: 'Kirim pesan sambutan untuk pelanggan baru?',
    initialValue: true,
  }) as boolean;

  if (enableWelcome) {
    const welcomeMsg = await text({
      message: 'Pesan sambutan:',
      placeholder: 'Halo! 👋 Ada yang bisa saya bantu hari ini?',
      defaultValue: 'Halo! 👋 Ada yang bisa saya bantu hari ini?',
    });
    if (!isCancel(welcomeMsg)) {
      config.welcomeMessage = welcomeMsg as string;
    }
  } else {
    config.welcomeMessageEnabled = false;
  }

  // ── Working Hours ─────────────────────────────────────────────
  const enableWorkingHours = await confirm({
    message: 'Aktifkan jam kerja? (di luar jam → auto offline)',
    initialValue: false,
  }) as boolean;

  if (enableWorkingHours) {
    const startTime = await text({
      message: 'Jam mulai (HH:mm, 24 jam):',
      placeholder: '08:00',
      defaultValue: '08:00',
    });
    if (!isCancel(startTime)) {
      config.workingHoursStart = startTime as string;
    }

    const endTime = await text({
      message: 'Jam selesai (HH:mm, 24 jam):',
      placeholder: '17:00',
      defaultValue: '17:00',
    });
    if (!isCancel(endTime)) {
      config.workingHoursEnd = endTime as string;
    }

    config.workingHoursEnabled = true;
    config.workingHoursTimezone = 'Asia/Jakarta';
  }

  // ── Group Chat ─────────────────────────────────────────────────
  const handleGroups = await confirm({
    message: 'Proses pesan dari grup WhatsApp?',
    initialValue: false,
  }) as boolean;

  if (handleGroups) {
    const mentionOnly = await confirm({
      message: 'Hanya balas jika di-mention (@nama)?',
      initialValue: true,
    }) as boolean;

    config.groupChatEnabled = true;
    config.groupChatReplyIfMentioned = mentionOnly;
  }

  // ── Session Name ──────────────────────────────────────────────
  const sessionName = await text({
    message: 'Nama session WhatsApp:',
    placeholder: 'wagent-session',
    defaultValue: 'wagent-session',
  });
  if (!isCancel(sessionName)) {
    config.whatsappSessionName = sessionName as string;
  }

  outro(color.green('✓ Konfigurasi selesai!'));

  return config;
}

export function saveConfigToEnv(config: Partial<WAgentConfig>, envPath: string): void {
  const modelId = config.resolvedModel ? config.resolvedModel.input : (config.aiProvider === 'openai' ? 'openai/' + (config.openai?.model || 'gpt-4o') : (config.aiProvider === 'gemini' ? 'google/' + (config.gemini?.model || 'gemini-2.0-flash') : (config.aiProvider === 'claude' ? 'anthropic/' + (config.anthropic?.model || 'claude-sonnet-4-20250514') : 'ollama/' + (config.ollama?.model || 'llama3'))));

  const envVars: string[] = [
    '# WAGENT Configuration',
    `# Generated at ${new Date().toISOString()}`,
    '',
    '# WhatsApp',
    `WHATSAPP_SESSION_NAME=${config.whatsappSessionName || 'wagent-session'}`,
    '',
    '# AI Provider',
    `AI_PROVIDER=${config.aiProvider}`,
    `MODEL=${modelId}`,
    `AGENT_SYSTEM_PROMPT="${config.systemPrompt || 'Kamu adalah customer service yang ramah dan membantu.'}"`,
    '',
  ];

  if (config.openai) {
    envVars.push('# OpenAI');
    envVars.push(`OPENAI_API_KEY=${config.openai.apiKey}`);
    envVars.push(`OPENAI_MODEL=${config.openai.model}`);
  }

  if (config.gemini) {
    envVars.push('# Google Gemini');
    envVars.push(`GEMINI_API_KEY=${config.gemini.apiKey}`);
    envVars.push(`GEMINI_MODEL=${config.gemini.model}`);
  }

  if (config.anthropic) {
    envVars.push('# Anthropic Claude');
    envVars.push(`ANTHROPIC_API_KEY=${config.anthropic.apiKey}`);
    envVars.push(`ANTHROPIC_MODEL=${config.anthropic.model}`);
  }

  if (config.ollama) {
    envVars.push('# Ollama');
    envVars.push(`OLLAMA_BASE_URL=${config.ollama.baseUrl}`);
    envVars.push(`OLLAMA_MODEL=${config.ollama.model}`);
    envVars.push('');
  }

  if (config.resolvedModel && !['openai', 'gemini', 'claude', 'ollama', 'google', 'anthropic'].includes(config.resolvedModel.provider)) {
    const resolved = config.resolvedModel;
    envVars.push(`# ${resolved.name || resolved.provider}`);
    const envKey = resolved.envKey || `${resolved.provider.toUpperCase()}_API_KEY`;
    envVars.push(`${envKey}=${resolved.apiKey || ''}`);
    envVars.push('');
  }

  if (config.dashboardPort) {
    envVars.push('');
    envVars.push('# Dashboard');
    envVars.push(`DASHBOARD_PORT=${config.dashboardPort}`);
    envVars.push(`DASHBOARD_HOST=${config.dashboardHost || '0.0.0.0'}`);
  }

  if (config.welcomeMessage) {
    envVars.push('');
    envVars.push('# Welcome Message');
    envVars.push(`WELCOME_MESSAGE="${config.welcomeMessage}"`);
    envVars.push('WELCOME_MESSAGE_ENABLED=true');
  }

  envVars.push('');
  envVars.push('# Database');
  envVars.push('DATABASE_TYPE=sqlite');
  envVars.push('DATABASE_URL=./data/wagent.db');

  envVars.push('');
  envVars.push('# Conversation Timeout (jam sebelum history otomatis dibersihkan)');
  envVars.push('CONVERSATION_TIMEOUT_HOURS=24');
  envVars.push('');

  writeFileSync(envPath, envVars.join('\n'));
  getLogger().info('Config saved to %s', envPath);
}

export function showQRInTUI(qr: string): void {
  console.log('');
  console.log(color.bgGreen(color.black(' Scan QR Code ini dengan WhatsApp Anda ')));
  console.log('');
  qrcode.generate(qr, { small: false });
  console.log('');
  console.log(color.dim('Atau buka WhatsApp > Linked Devices > Link a Device'));
  console.log('');
}
