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
  } else {
    const envKey = resolved.envKey || `${resolved.provider.toUpperCase()}_API_KEY`;
    const apiKey = await text({
      message: `Masukkan API Key untuk ${resolved.name || resolved.provider} (${envKey}):`,
      placeholder: '...',
    });
    if (isCancel(apiKey)) process.exit(0);
    config.resolvedModel.apiKey = apiKey as string;
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
  // Semua konfigurasi WAgent sekarang disimpan di config.jsonc.
  // .env hanya digunakan jika pengguna ingin memasukkan token rahasia secara manual (opsional).
  
  const envVars: string[] = [
    '# WAGENT Environment Variables',
    `# Generated at ${new Date().toISOString()}`,
    '',
    '# Note: Konfigurasi utama WAgent ada di file config.jsonc.',
    '# Anda bisa menggunakan file .env ini untuk override rahasia (API Keys, Token) jika tidak ingin menyimpannya di config.jsonc.',
    ''
  ];

  writeFileSync(envPath, envVars.join('\n'));
  getLogger().info('Minimal .env generated at %s', envPath);
}

export function showQRInTUI(qr: string): void {
  console.log('');
  console.log(color.bold(color.cyan('  ┌─────────────────────────────────────────┐')));
  console.log(color.bold(color.cyan('  │')) + color.bold('         📱 Scan QR Code with WhatsApp    ') + color.bold(color.cyan('│')));
  console.log(color.bold(color.cyan('  └─────────────────────────────────────────┘')));
  console.log('');
  qrcode.generate(qr, { small: false });
  console.log('');
  console.log(color.dim('  Open WhatsApp → Linked Devices → Link a Device'));
  console.log('');
}
