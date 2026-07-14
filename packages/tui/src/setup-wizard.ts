/**
 * Setup Wizard - Creates config.jsonc via interactive CLI
 *
 * Uses @clack/prompts for beautiful terminal UI.
 * No manual file editing needed.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { intro, outro, text, select, confirm, isCancel, cancel, spinner } from '@clack/prompts';
import color from 'picocolors';
import { getCatalogProviders, getModelsForProviderCatalog } from '@wagent/core';

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
  escalation: {
    telegramBotToken: string;
    telegramChatId: string;
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
    escalation: {
      telegramBotToken: existingConfig?.escalation?.telegramBotToken || '',
      telegramChatId: existingConfig?.escalation?.telegramChatId || '',
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

  // Sort dinamis — tanpa list hardcoded:
  // 1. Provider sudah terkonfigurasi → paling atas
  // 2. Provider yang punya npm SDK (lebih mature) → berikutnya
  // 3. Sisanya alfabetis
  providerOptions.sort((a, b) => {
    const aConfigured = !!(existingProviders[a.value]?.apiKey || existingProviders[a.value]?.baseUrl);
    const bConfigured = !!(existingProviders[b.value]?.apiKey || existingProviders[b.value]?.baseUrl);
    if (aConfigured !== bConfigured) return aConfigured ? -1 : 1;

    const aHasNpm = !!(providersMap[a.value]?.npm);
    const bHasNpm = !!(providersMap[b.value]?.npm);
    if (aHasNpm !== bHasNpm) return aHasNpm ? -1 : 1;

    return a.label.localeCompare(b.label);
  });

  // Opsi skip di paling atas — hanya tampil jika sudah ada config sebelumnya
  const currentModelLabel = config.model
    ? color.dim(`(saat ini: ${config.model})`)
    : '';
  providerOptions.unshift({
    value: '__skip__',
    label: `⏭  Lewati — lanjutkan tanpa ubah AI ${currentModelLabel}`,
  });

  const provider = await select({
    message: 'Pilih AI Provider:',
    options: providerOptions,
  }) as string;

  if (isCancel(provider)) {
    cancel('Setup dibatalkan.');
    process.exit(0);
  }

  // Jika skip, pertahankan konfigurasi provider & model yang sudah ada
  let skipAI = provider === '__skip__';
  config.provider = skipAI ? (existingConfig?.model?.split('/')[0] || '') : provider;
  const providerInfo = skipAI ? undefined : providersMap[provider];

  // ── Step 2: Credentials ─────────────────────────────────────────
  if (skipAI) {
    // Lewati langkah kredensial dan pemilihan model
  } else if (provider === 'ollama') {
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
  if (!skipAI) {
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
          message: 'Masukkan nama model kustom (contoh: gpt-4o, gemini-2.0-flash):',
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
  }
  // Jika skip, config.model tetap menggunakan nilai dari existingConfig


  // ── Step 4: WhatsApp Session Name & QR Scan ────────────────────
  const session = await text({
    message: 'Nama session WhatsApp:',
    placeholder: 'wagent-session',
    defaultValue: config.session,
  });

  if (isCancel(session)) process.exit(0);
  config.session = session as string;

  // Tawari scan QR WA sekarang
  const scanNow = await confirm({
    message: 'Scan QR WhatsApp sekarang? (bisa juga dilakukan otomatis saat service start)',
    initialValue: true,
  }) as boolean;

  if (!isCancel(scanNow) && scanNow) {
    await scanWhatsAppQR(config.session);
  }

  // ── Step 5: Welcome Message ─────────────────────────────────────
  const welcomeMessage = await text({
    message: 'Welcome message untuk chat baru:',
    placeholder: 'Halo! Ada yang bisa saya bantu?',
    defaultValue: config.agent.welcomeMessage,
  });

  if (isCancel(welcomeMessage)) process.exit(0);
  config.agent.welcomeMessage = welcomeMessage as string;

  // ── Step 6: Telegram Escalation (Human Takeover) ────────────────
  const hasTelegramConfig = !!(config.escalation.telegramBotToken && config.escalation.telegramChatId);
  const enableEscalation = await confirm({
    message: hasTelegramConfig
      ? `Telegram sudah terkonfigurasi ${color.green('✔')}. Update konfigurasi eskalasi Telegram (Human Takeover)?`
      : 'Aktifkan eskalasi ke Telegram untuk Human Takeover? (opsional)',
    initialValue: hasTelegramConfig,
  }) as boolean;

  if (enableEscalation) {
    const botToken = await text({
      message: 'Masukkan Telegram Bot Token (dari @BotFather):',
      placeholder: '123456789:ABCdef...',
      defaultValue: config.escalation.telegramBotToken,
      validate: (v) => !v ? 'Bot Token tidak boleh kosong' : undefined,
    });

    if (isCancel(botToken)) process.exit(0);
    const token = botToken as string;

    // Auto-fetch Chat ID dari Telegram getUpdates
    let chatId = config.escalation.telegramChatId;
    chatId = await fetchTelegramChatId(token, chatId);

    config.escalation = {
      telegramBotToken: token,
      telegramChatId: chatId,
    };
  } else if (!hasTelegramConfig) {
    // Tidak dikonfigurasi
    config.escalation = { telegramBotToken: '', telegramChatId: '' };
  }


  // ── Step 7: Dashboard ───────────────────────────────────────────
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

  // Merge new provider config dengan existing — jangan overwrite jika skip
  const mergedProviders = { ...existingProviders };
  if (!skipAI && config.provider) {
    // Preserve existing config, hanya update field yang baru diisi
    const prev = mergedProviders[config.provider] || {};
    mergedProviders[config.provider] = { ...prev };
    if (config.apiKey) mergedProviders[config.provider].apiKey = config.apiKey;
    if (config.baseUrl) mergedProviders[config.provider].baseUrl = config.baseUrl;
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
  console.log(`  Dashboard  : ${config.dashboard.enabled ? color.green(`ON → http://localhost:${config.dashboard.port}`) : color.red('OFF')}`);
  console.log(`  Telegram   : ${config.escalation.telegramBotToken ? color.green('ON (Eskalasi Aktif)') : color.dim('OFF')}`);
  console.log('');

  // ── Auto-start service ──────────────────────────────────────
  const svc = spawnSync('systemctl', ['--user', 'is-active', 'wagent'], { encoding: 'utf-8' });
  const svcActive = svc.stdout?.trim() === 'active';

  if (svcActive) {
    const rs = spawnSync('systemctl', ['--user', 'restart', 'wagent'], { encoding: 'utf-8' });
    if (rs.status === 0) {
      console.log(color.green('  ✔ WAGENT service di-restart dengan konfigurasi baru.'));
    } else {
      console.log(color.yellow('  ⚠ Gagal restart service otomatis. Jalankan: wagent service restart'));
    }
  } else {
    // Coba start service jika tidak aktif
    const st = spawnSync('systemctl', ['--user', 'start', 'wagent'], { encoding: 'utf-8' });
    if (st.status === 0) {
      console.log(color.green('  ✔ WAGENT service dimulai di background.'));
    } else {
      console.log(color.dim('  Service systemd belum aktif.'));
    }
  }

  console.log('');
  console.log(color.bold('Gunakan:'));
  console.log(color.dim('  wagent service status   → cek status'));
  console.log(color.dim('  wagent service logs     → lihat log'));
  if (config.dashboard.enabled) {
    console.log(color.dim(`  Dashboard: `) + color.cyan(`http://localhost:${config.dashboard.port}`));
  }
  console.log('');
}

// ── WhatsApp QR Scan (saat init) ────────────────────────────────

/**
 * Koneksi sementara ke WhatsApp hanya untuk scan QR dan simpan session.
 * Setelah connected, koneksi ditutup — service yang akan mengelola selanjutnya.
 * Timeout: 2 menit.
 */
async function scanWhatsAppQR(sessionName: string): Promise<void> {
  console.log('');
  console.log(color.bold('  📱 Koneksi WhatsApp'));
  console.log(color.dim('  ' + '─'.repeat(36)));
  console.log(color.dim('  QR code akan muncul di bawah ini.'));
  console.log(color.dim('  Buka WhatsApp → ⋮ → Perangkat Tertaut → Tautkan Perangkat'));
  console.log('');

  try {
    const { join, dirname, resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const { homedir } = await import('os');
    const qrcode = await import('qrcode-terminal') as any;

    // Resolve baileys dari whatsapp package yang pasti punya dependency ini
    const tuiDir = dirname(fileURLToPath(import.meta.url));
    const baileysPath = resolve(tuiDir, '../../whatsapp/node_modules/@whiskeysockets/baileys/lib/index.js');
    const { default: makeWASocket, useMultiFileAuthState } =
      await import(baileysPath) as any;

    const sessionDir = join(homedir(), '.sessions', sessionName);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const s = spinner();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('');
        console.log(color.yellow('  ⏱ Timeout — QR tidak di-scan dalam 2 menit.'));
        console.log(color.dim('  WAGENT akan tetap berjalan; scan bisa dilakukan saat service pertama start.'));
        resolve();
      }, 120_000);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: { level: 'silent', child: () => ({ level: 'silent', info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {} }) },
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: any) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          console.log('');
          qrcode.generate(qr, { small: true });
          console.log(color.dim('  Scan QR di atas dengan WhatsApp...'));
        }

        if (connection === 'open') {
          clearTimeout(timeout);
          s.start('Tersambung! Menyimpan session...');
          await saveCreds();
          await sock.logout().catch(() => {});
          s.stop(color.green('✔ Session WhatsApp tersimpan!'));
          console.log(color.dim(`  Session: ${sessionDir}`));
          resolve();
        }

        if (connection === 'close') {
          const code = (lastDisconnect?.error as any)?.output?.statusCode;
          // Jika logout paksa atau tidak butuh reconnect
          if (code !== 401) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });
  } catch (err: any) {
    console.log(color.yellow(`  ⚠ Tidak bisa scan QR saat ini: ${err?.message || err}`));
    console.log(color.dim('  Session akan dibuat saat service pertama kali dijalankan.'));
  }
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
  lines.push('  // WhatsApp Session (scan QR saat wagent start)');
  lines.push(`  "session": "${config.session}",`);
  lines.push('');

  // Model
  lines.push('  // AI Model — format: provider/model-id');
  lines.push(`  "model": "${config.model}",`);
  lines.push('');

  // Providers
  lines.push('  // API Keys / Base URLs per provider');
  lines.push('  "providers": {');
  const providerEntries = Object.entries(providers);
  providerEntries.forEach(([pId, pConfig]: [string, any], index) => {
    lines.push(`    "${pId}": {`);
    const fields: string[] = [];
    if (pConfig.apiKey) fields.push(`      "apiKey": "${pConfig.apiKey}"`);
    if (pConfig.baseUrl) fields.push(`      "baseUrl": "${pConfig.baseUrl}"`);
    if (fields.length) lines.push(fields.join(',\n'));
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

  // Escalation
  lines.push('  // Eskalasi ke Telegram (Human Takeover) — kosongkan jika tidak dipakai');
  lines.push('  "escalation": {');
  lines.push(`    "telegramBotToken": "${config.escalation.telegramBotToken}",`);
  lines.push(`    "telegramChatId": "${config.escalation.telegramChatId}"`);
  lines.push('  },');
  lines.push('');

  // Dashboard
  lines.push('  // Web Dashboard');
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

// ── Telegram Chat ID Binding ────────────────────────────────────

/**
 * Binding method: generate kode unik → user kirim ke bot → polling sampai ketemu.
 * Auto-capture chat ID dari pesan yang berisi kode verifikasi.
 * Fallback ke input manual jika user skip.
 */
async function fetchTelegramChatId(token: string, defaultChatId: string): Promise<string> {
  const POLL_URL = `https://api.telegram.org/bot${token}/getUpdates?limit=10&timeout=5`;

  // Generate kode verifikasi 4 digit
  const code = `WGNT-${Math.floor(1000 + Math.random() * 9000)}`;

  console.log('');
  console.log(color.bold('  🔗 Binding Telegram Chat'));
  console.log(color.dim('  ' + '─'.repeat(36)));
  console.log(`  Kirim kode ini ke bot Telegram kamu:`);
  console.log('');
  console.log(`      ${color.bgCyan(color.black(` ${code} `))}`);
  console.log('');
  console.log(color.dim('  (bisa di chat pribadi dengan bot, atau di grup yang sudah ada botnya)'));
  console.log('');

  const s = spinner();
  s.start('Menunggu kode verifikasi... (60 detik)');

  // Ambil offset awal untuk hanya scan pesan baru
  let offset = 0;
  try {
    const init = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=1&offset=-1`);
    const initJson = await init.json() as any;
    const updates = initJson.result || [];
    if (updates.length > 0) {
      offset = updates[updates.length - 1].update_id + 1;
    }
  } catch { /* abaikan */ }

  const deadline = Date.now() + 60_000;
  let foundChatId = '';

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`${POLL_URL}&offset=${offset}`);
      const json = await res.json() as any;
      if (!json.ok) {
        s.stop(color.red('Token tidak valid.'));
        break;
      }
      for (const update of json.result || []) {
        offset = update.update_id + 1;
        const text: string = update.message?.text || update.channel_post?.text || '';
        if (text.includes(code)) {
          const chat = update.message?.chat || update.channel_post?.chat;
          if (chat) {
            foundChatId = String(chat.id);
            const name = chat.title || chat.first_name || foundChatId;
            s.stop(color.green(`✔ Chat ditemukan: ${name} (${foundChatId})`));
            return foundChatId;
          }
        }
      }
    } catch { /* retry */ }
  }

  if (!foundChatId) {
    s.stop(color.yellow('Waktu habis. Beralih ke input manual.'));
  }

  // Fallback: input manual
  const manual = await text({
    message: 'Masukkan Chat ID secara manual:',
    placeholder: '-100123456789',
    defaultValue: defaultChatId,
    validate: (v) => !v ? 'Chat ID tidak boleh kosong' : undefined,
  });

  if (isCancel(manual)) process.exit(0);
  return manual as string;
}
