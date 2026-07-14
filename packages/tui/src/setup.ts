import { writeFileSync } from 'fs';
import { intro, outro, text, select, confirm, isCancel, cancel } from '@clack/prompts';
import color from 'picocolors';
import qrcode from 'qrcode-terminal';
import { OpenCSConfig, AIProviderType } from '@wagent/core';
import { getLogger } from '@wagent/core';

export async function setupWizard(): Promise<Partial<OpenCSConfig>> {
  console.clear();
  intro(color.inverse(' OpenCS Setup Wizard '));

  const config: Partial<OpenCSConfig> = {};

  // ── AI Provider ───────────────────────────────────────────────
  const aiProvider = await select({
    message: 'Pilih AI Provider:',
    options: [
      { value: 'openai', label: 'OpenAI', hint: 'GPT-4o (recommended)' },
      { value: 'gemini', label: 'Google Gemini', hint: 'Gemini 2.0 Flash' },
      { value: 'claude', label: 'Anthropic Claude', hint: 'Claude Sonnet' },
      { value: 'ollama', label: 'Ollama (Local)', hint: 'LLaMA, Mistral, dll' },
    ],
  }) as AIProviderType;

  if (isCancel(aiProvider)) {
    cancel('Setup dibatalkan.');
    process.exit(0);
  }

  config.aiProvider = aiProvider;

  // ── API Keys ──────────────────────────────────────────────────
  const systemPrompt = await text({
    message: 'System prompt untuk AI agent:',
    placeholder: 'Kamu adalah customer service yang ramah dan membantu...',
    defaultValue: 'Kamu adalah customer service yang ramah, profesional, dan membantu. Balaslah dengan bahasa Indonesia yang natural dan sopan.',
  });

  if (!isCancel(systemPrompt)) {
    config.systemPrompt = systemPrompt as string;
  }

  switch (aiProvider) {
    case 'openai': {
      const apiKey = await text({
        message: 'OpenAI API Key:',
        placeholder: 'sk-...',
        validate: (v) => !v.startsWith('sk-') ? 'API Key tidak valid' : undefined,
      });
      if (isCancel(apiKey)) process.exit(0);

      const model = await select({
        message: 'Pilih model OpenAI:',
        options: [
          { value: 'gpt-4o', label: 'GPT-4o', hint: 'Best overall' },
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Fast & cheap' },
          { value: 'o3-mini', label: 'o3-mini', hint: 'Reasoning model' },
        ],
      });
      if (isCancel(model)) process.exit(0);

      config.openai = { apiKey: apiKey as string, model: model as string };
      break;
    }

    case 'gemini': {
      const apiKey = await text({
        message: 'Google Gemini API Key:',
        placeholder: 'AIza...',
      });
      if (isCancel(apiKey)) process.exit(0);

      const model = await select({
        message: 'Pilih model Gemini:',
        options: [
          { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Fast & free' },
          { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', hint: 'Cheapest' },
          { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', hint: 'Most capable' },
        ],
      });
      if (isCancel(model)) process.exit(0);

      config.gemini = { apiKey: apiKey as string, model: model as string };
      break;
    }

    case 'claude': {
      const apiKey = await text({
        message: 'Anthropic API Key:',
        placeholder: 'sk-ant-...',
      });
      if (isCancel(apiKey)) process.exit(0);

      const model = await select({
        message: 'Pilih model Claude:',
        options: [
          { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', hint: 'Best for CS' },
          { value: 'claude-haiku-3-5-20241022', label: 'Claude Haiku 3.5', hint: 'Fast & cheap' },
        ],
      });
      if (isCancel(model)) process.exit(0);

      config.anthropic = { apiKey: apiKey as string, model: model as string };
      break;
    }

    case 'ollama': {
      const baseUrl = await text({
        message: 'Ollama base URL:',
        placeholder: 'http://localhost:11434',
        defaultValue: 'http://localhost:11434',
      });
      if (isCancel(baseUrl)) process.exit(0);

      const model = await text({
        message: 'Nama model Ollama:',
        placeholder: 'llama3',
        defaultValue: 'llama3',
      });
      if (isCancel(model)) process.exit(0);

      config.ollama = { baseUrl: baseUrl as string, model: model as string };
      break;
    }
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
    placeholder: 'opencs-session',
    defaultValue: 'opencs-session',
  });
  if (!isCancel(sessionName)) {
    config.whatsappSessionName = sessionName as string;
  }

  outro(color.green('✓ Konfigurasi selesai!'));

  return config;
}

export function saveConfigToEnv(config: Partial<OpenCSConfig>, envPath: string): void {
  const envVars: string[] = [
    '# OpenCS Configuration',
    `# Generated at ${new Date().toISOString()}`,
    '',
    '# WhatsApp',
    `WHATSAPP_SESSION_NAME=${config.whatsappSessionName || 'opencs-session'}`,
    '',
    '# AI Provider',
    `AI_PROVIDER=${config.aiProvider}`,
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
  envVars.push('DATABASE_URL=./data/opencs.db');

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
