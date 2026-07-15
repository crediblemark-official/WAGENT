#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import color from 'picocolors';

import { loadConfig, ensureDirectories, getLogger, Gateway, Database, WhatsAppNumberConfig, SkillLoader, isEncryptionAvailable, getEncryptionKey, generateEncryptionKey, encryptFile, decryptFile, encryptDirectory, decryptDirectory, encryptEnvFile, decryptEnvFile, getEncryptionStatus, KnowledgeStore } from '@wagent/core';
import { BaileysAdapter } from '@wagent/whatsapp';
import { setupWizard, saveConfigToEnv } from '@wagent/tui';
import { serviceStatus, serviceStart, serviceStop, serviceRestart, serviceLogs, serviceEnable, serviceDisable, isServiceRunning } from './commands/service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf-8')
);

// ── Constants ──────────────────────────────────────────────────

const ENV_PATH = join(process.cwd(), '.env');
const SESSION_DIR = join(process.cwd(), '.sessions');
const DB_PATH = join(process.cwd(), 'data', 'wagent.db');

const program = new Command();

program
  .name('wagent')
  .description('🤖 WAGENT - WhatsApp AI Agent')
  .version(
    [
      '',
      color.bold(color.cyan('🤖 WAGENT - WhatsApp AI Agent')),
      `  Versi    : ${color.green('v' + pkg.version)}`,
      `  Runtime  : Bun ${process.versions.bun || 'unknown'} / Node ${process.version}`,
      `  Platform : ${process.platform} ${process.arch}`,
      `  Install  : ${color.dim(join(process.execPath, '../..'))}`,
      '',
    ].join('\n'),
    '-v, --version',
    'Tampilkan versi WAGENT'
  );

// ── init ────────────────────────────────────────────────────────

program
  .command('init')
  .description('Setup wizard untuk konfigurasi WAGENT')
  .action(async () => {
    const { setupConfigWizard } = await import('@wagent/tui');
    
    await setupConfigWizard();
  });

// ── setup-prompts ────────────────────────────────────────────────

program
  .command('setup-prompts')
  .description('AI-guided setup untuk generate prompt files (system, personality, messages, skills)')
  .action(async () => {
    const { setupPromptWizard } = await import('@wagent/tui');
    
    await setupPromptWizard();
  });

// ── start ───────────────────────────────────────────────────────

program
  .command('start')
  .description('Mulai WAGENT Gateway (WhatsApp + AI Agent)')
  .option('-p, --port <port>', 'Dashboard port', '3030')
  .option('--no-dashboard', 'Jalankan tanpa dashboard web')
  .action(async (options) => {
    // ── Port conflict check ─────────────────────────────────────
    // Lewati jika dijalankan sebagai systemd service (INVOCATION_ID di-set oleh systemd)
    const runningAsService = !!process.env.INVOCATION_ID;

    if (!runningAsService) {
      // Cek apakah service systemd sudah running (hanya untuk user manual)
      if (isServiceRunning()) {
        console.log('');
        console.log(color.yellow('⚠  WAGENT service sudah berjalan di background.'));
        console.log(color.dim('   Gunakan:'));
        console.log(color.dim('     wagent service status   → cek status'));
        console.log(color.dim('     wagent service restart  → restart'));
        console.log(color.dim('     wagent service logs     → lihat log'));
        console.log('');
        process.exit(0);
      }

      // Cek port secara langsung jika systemd tidak tersedia
      const targetPort = parseInt(options.port, 10) || 3030;
      const portInUse = await checkPort(targetPort);
      if (portInUse) {
        console.log('');
        console.log(color.yellow(`⚠  Port ${targetPort} sudah dipakai.`));
        console.log(color.dim('   WAGENT mungkin sudah berjalan. Cek dengan: wagent service status'));
        console.log('');
        process.exit(0);
      }
    }


    console.log('');
    console.log(color.bold(color.cyan('╔══════════════════════════════════════╗')));
    console.log(color.bold(color.cyan('║      🤖 WAGENT WhatsApp AI Agent     ║')));
    console.log(color.bold(color.cyan('╚══════════════════════════════════════╝')));
    console.log(`  Versi   : ${color.green('v' + pkg.version)}`);
    console.log(`  Runtime : Bun ${process.versions.bun || process.version}`);
    console.log('');

    const config = await loadConfig();
    ensureDirectories(config);

    const logger = getLogger();

    // Log konfigurasi aktif
    const modelInfo = config.resolvedModel
      ? `${config.resolvedModel.provider} / ${config.resolvedModel.model}`
      : config.aiProvider;
    logger.info({ version: pkg.version, provider: modelInfo }, 'WAGENT starting');
    console.log(`  AI Model: ${color.yellow(modelInfo)}`);
    if (config.dashboardPort && options.dashboard !== false) {
      console.log(`  Dashboard: http://localhost:${config.dashboardPort}`);
    }
    console.log('');

    // Override port from CLI
    if (options.port) {
      config.dashboardPort = parseInt(options.port, 10);
    }

    try {
      // Initialize database
      const db = new Database(config.databaseUrl);
      logger.info('Database initialized');

      // Initialize WhatsApp adapter
      const whatsapp = new BaileysAdapter(config);

      // Initialize Dashboard (if enabled)
      let dashboard: any = undefined;
      if (options.dashboard !== false && config.dashboardPort) {
        try {
          // Path relatif dari cli/dist/ → packages/dashboard/dist/server.js
          const { resolve, dirname } = await import('path');
          const { fileURLToPath } = await import('url');
          const cliDistDir = dirname(fileURLToPath(import.meta.url));
          const dashboardPath = resolve(cliDistDir, '../../dashboard/dist/server.js');
          const mod = await import(dashboardPath);
          const { DashboardServer } = mod;
          if (!DashboardServer) throw new Error('DashboardServer tidak ditemukan di modul');
          dashboard = new DashboardServer(config, db);
          logger.info('Dashboard loaded: %s', dashboardPath);
        } catch (err: any) {
          logger.warn('Dashboard module not available, running headless: %s', err?.message);
        }
      }



      // Load skills for AI agent
      const skillLoader = new SkillLoader();
      await skillLoader.loadAll();
      const extraTools = skillLoader.getTools();
      logger.info('Loaded %d skill tools for AI agent', extraTools.length);

      // Create Gateway
      const gateway = new Gateway(config, db, whatsapp, dashboard, extraTools);

      // Wire dashboard to gateway (for approval queue)
      if (dashboard && typeof dashboard.setGateway === 'function') {
        dashboard.setGateway(gateway);
      }

      // Handle graceful shutdown
      const shutdown = async () => {
        console.log(color.yellow('\n⏳ Shutting down WAGENT...'));
        await gateway.stop();
        db.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Start gateway
      await gateway.start();

      console.log(color.green('\n✓ WAGENT running!'));
      if (dashboard) {
        console.log(color.cyan(`  Dashboard: http://localhost:${config.dashboardPort}`));
      }
      console.log(color.dim('  Press Ctrl+C to stop\n'));

      // Keep process alive
      await new Promise(() => {}); // Never resolves, relies on SIGINT

    } catch (err: any) {
      logger.error({ error: err.message }, 'Fatal error');
      console.error(color.red(`\n✗ Error: ${err.message}`));
      process.exit(1);
    }
  });

// ── config ──────────────────────────────────────────────────────

program
  .command('config')
  .description('Lihat konfigurasi saat ini')
  .action(async () => {
    const config = await loadConfig();
    console.log('');
    console.log(color.bold('Current Configuration:'));
    console.log('──────────────────────────────');
    console.log(`  WhatsApp Session : ${config.whatsappSessionName}`);
    console.log(`  AI Provider      : ${config.aiProvider}`);
    console.log(`  System Prompt    : ${config.systemPrompt.substring(0, 50)}...`);
    console.log(`  Dashboard Port   : ${config.dashboardPort}`);
    console.log(`  Database         : ${config.databaseType} (${config.databaseUrl})`);
    console.log('');

    if (config.resolvedModel) {
      console.log(`  Model Provider   : ${config.resolvedModel.provider} (${config.resolvedModel.name || ''})`);
      console.log(`  Model Name       : ${config.resolvedModel.model}`);
      if (config.resolvedModel.baseUrl) {
        console.log(`  Base URL         : ${config.resolvedModel.baseUrl}`);
      }
      if (config.resolvedModel.apiKey) {
        console.log(`  API Key          : ${config.resolvedModel.apiKey.substring(0, 8)}...`);
      }
    }
    console.log('');
  });

// ── status ──────────────────────────────────────────────────────

program
  .command('status')
  .description('Cek status koneksi WhatsApp')
  .action(async () => {
    // For simplicity, we check if session files exist
    const config = await loadConfig();
    const sessionDir = join(
      config.whatsappSessionDir || join(process.cwd(), '.sessions'),
      config.whatsappSessionName
    );

    console.log('');
    if (existsSync(sessionDir)) {
      const files = readdirSync(sessionDir);
      const hasCreds = files.some(f => f.includes('creds'));
      console.log(color.green('✓ Session folder ditemukan'));
      console.log(color.cyan(`  Location: ${sessionDir}`));
      if (hasCreds) {
        console.log(color.green('✓ Credentials tersimpan (pernah login)'));
      } else {
        console.log(color.yellow('! Belum pernah login, scan QR code diperlukan'));
      }
    } else {
      console.log(color.yellow('! Belum ada session. Jalankan "wagent start"'));
    }
    console.log('');
  });

// ── log ─────────────────────────────────────────────────────────

program
  .command('log')
  .description('Lihat log terbaru WAGENT')
  .option('-n, --lines <number>', 'Jumlah baris log', '50')
  .action((options) => {
    const logPath = join(process.cwd(), 'wagent.log');
    if (!existsSync(logPath)) {
      console.log(color.yellow('Belum ada file log.'));
      return;
    }
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').slice(-parseInt(options.lines, 10));
    console.log(lines.join('\n'));
  });

// ── number ──────────────────────────────────────────────────────

const NUMBERS_FILE = join(process.cwd(), 'data', 'numbers.json');

function loadNumbers(): WhatsAppNumberConfig[] {
  if (!existsSync(NUMBERS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(NUMBERS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveNumbers(numbers: WhatsAppNumberConfig[]): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(NUMBERS_FILE, JSON.stringify(numbers, null, 2));
}

const numberCmd = program.command('number').description('Kelola multi-number WhatsApp');

numberCmd
  .command('list')
  .description('Tampilkan semua nomor WhatsApp yang terkonfigurasi')
  .action(() => {
    const numbers = loadNumbers();
    const sessionDir = join(process.cwd(), '.sessions');

    console.log('');
    console.log(color.bold('📱 Multi-Number Configuration'));
    console.log('────────────────────────────────────');

    if (numbers.length === 0) {
      console.log(color.dim('  Belum ada nomor. Tambah dengan: wagent number add <id> <sessionName>'));
      console.log('');
      return;
    }

    for (const n of numbers) {
      const sessionPath = join(sessionDir, n.sessionName);
      const hasSession = existsSync(sessionPath);
      const hasCreds = hasSession && readdirSync(sessionPath).some(f => f.includes('creds'));

      const statusColor = hasCreds ? color.green : hasSession ? color.yellow : color.dim;
      const statusText = hasCreds ? '✅ Siap (pernah login)' : hasSession ? '⚠️  Session ada, belum login' : '❌ Belum ada session';

      console.log(`  ${color.cyan(n.id)}`);
      console.log(`    Label       : ${n.label || color.dim('(none)')}`);
      console.log(`    Session     : ${n.sessionName}`);
      console.log(`    Status      : ${statusColor(statusText)}`);
      console.log(`    Enabled     : ${n.enabled ? color.green('✓') : color.red('✗')}`);
      console.log('');
    }

    console.log(color.dim(`  Total: ${numbers.length} nomor terkonfigurasi`));
    console.log('');
  });

numberCmd
  .command('add')
  .description('Tambah nomor WhatsApp baru')
  .argument('<id>', 'ID unik untuk nomor (contoh: cs-1)')
  .argument('<sessionName>', 'Nama session folder (contoh: session-cs-1)')
  .argument('[label]', 'Label display (contoh: "Customer Service 1")')
  .action((id: string, sessionName: string, label?: string) => {
    const numbers = loadNumbers();

    if (numbers.some(n => n.id === id)) {
      console.log(color.red(`✗ Nomor dengan ID "${id}" sudah ada.`));
      return;
    }
    if (numbers.some(n => n.sessionName === sessionName)) {
      console.log(color.red(`✗ Session "${sessionName}" sudah digunakan oleh nomor lain.`));
      return;
    }

    const newNumber: WhatsAppNumberConfig = {
      id,
      sessionName,
      label: label || id,
      enabled: true,
    };

    numbers.push(newNumber);
    saveNumbers(numbers);

    console.log(color.green(`\n✓ Nomor "${id}" berhasil ditambahkan!`));
    console.log(color.cyan(`  Session : ${sessionName}`));
    console.log(color.cyan(`  Label   : ${newNumber.label}`));
    console.log(color.dim(`  Jalankan "wagent start" untuk connect nomor ini\n`));
  });

numberCmd
  .command('remove')
  .description('Hapus nomor WhatsApp')
  .argument('<id>', 'ID nomor yang akan dihapus')
  .option('-f, --force', 'Hapus tanpa konfirmasi')
  .action((id: string, options: { force?: boolean }) => {
    const numbers = loadNumbers();
    const idx = numbers.findIndex(n => n.id === id);

    if (idx === -1) {
      console.log(color.red(`✗ Nomor dengan ID "${id}" tidak ditemukan.`));
      return;
    }

    const removed = numbers[idx];

    if (!options.force) {
      console.log(color.yellow(`\n⚠️  Yakin hapus nomor "${id}"?`));
      console.log(color.yellow(`   Session "${removed.sessionName}" tidak akan dihapus.`));
      console.log(color.dim('   Gunakan --force untuk skip konfirmasi'));
      console.log('');
      // Since we can't easily do prompt in Commander, just ask to use --force
      return;
    }

    numbers.splice(idx, 1);
    saveNumbers(numbers);

    console.log(color.green(`\n✓ Nomor "${id}" berhasil dihapus.`));
    console.log(color.dim(`  Session folder "${removed.sessionName}" tidak terhapus.`));
    console.log(color.dim(`  Hapus manual: rm -rf .sessions/${removed.sessionName}\n`));
  });


// ── crypto ──────────────────────────────────────────────────────

const cryptoCmd = program.command('crypto').description('🔐 Kelola enkripsi data (credentials, session, database)');

cryptoCmd
  .command('init')
  .description('Generate encryption key dan enkripsi semua data sensitif')
  .action(() => {
    const keyExists = isEncryptionAvailable();
    if (keyExists) {
      console.log(color.yellow('\n⚠️  OPENCE_ENCRYPTION_KEY sudah terdeteksi.'));
      console.log(color.dim('  Gunakan "wagent crypto encrypt" untuk mengenkripsi data.'));
      console.log('');
      return;
    }

    const key = generateEncryptionKey();
    console.log('');
    console.log(color.bold('🔐 Encryption Key Generated'));
    console.log('');
    console.log(color.bold(color.yellow('⚠️  SIMPAN KEY INI — TIDAK BISA DIPULIHKAN!')));
    console.log(color.white('  ┌─────────────────────────────────────────────────────────────┐'));
    console.log(color.white(`  │ ${key} │`));
    console.log(color.white('  └─────────────────────────────────────────────────────────────┘'));
    console.log('');
    console.log(color.cyan('  Export key:'));
    console.log(color.dim(`  export OPENCE_ENCRYPTION_KEY=${key}`));
    console.log(color.dim('  Tambahkan ke ~/.bashrc atau ~/.zshrc agar permanen'));
    console.log('');
    console.log(color.dim('  Setelah export, jalankan: wagent crypto encrypt'));
    console.log('');
  });

cryptoCmd
  .command('encrypt')
  .description('Enkripsi .env, session WhatsApp, dan database')
  .action(() => {
    const keyHex = getEncryptionKey();
    if (!keyHex) {
      console.log(color.red('\n✗ OPENCE_ENCRYPTION_KEY tidak ditemukan.'));
      console.log(color.dim('  Jalankan "wagent crypto init" untuk generate key terlebih dahulu.'));
      console.log('');
      return;
    }

    const keyBuf = Buffer.from(keyHex, 'hex');
    let encryptedCount = 0;

    console.log('');
    console.log(color.bold('🔐 Mengenkripsi data sensitif...'));
    console.log('──────────────────────────────────────');

    // 1. Encrypt .env
    if (existsSync(ENV_PATH)) {
      try {
        encryptEnvFile(ENV_PATH, keyBuf);
        console.log(color.green('  ✓ .env → .env.encrypted'));
        encryptedCount++;
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal enkripsi .env: ${err.message}`));
      }
    } else {
      console.log(color.dim('  - .env tidak ditemukan, skip'));
    }

    // 2. Encrypt session files
    if (existsSync(SESSION_DIR)) {
      try {
        const count = encryptDirectory(SESSION_DIR, keyBuf, true);
        if (count > 0) {
          console.log(color.green(`  ✓ Session: ${count} file terenkripsi`));
          encryptedCount += count;
        } else {
          console.log(color.yellow('  ! Session: tidak ada file yang perlu dienkripsi'));
        }
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal enkripsi session: ${err.message}`));
      }
    } else {
      console.log(color.dim('  - Session folder tidak ditemukan, skip'));
    }

    // 3. Encrypt numbers.json
    const numbersPath = join(process.cwd(), 'data', 'numbers.json');
    if (existsSync(numbersPath)) {
      try {
        encryptFile(numbersPath, keyBuf, true);
        console.log(color.green('  ✓ numbers.json → numbers.json.encrypted'));
        encryptedCount++;
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal enkripsi numbers.json: ${err.message}`));
      }
    }

    // 4. Encrypt database
    const dbPath = join(process.cwd(), 'data', 'wagent.db');
    if (existsSync(dbPath)) {
      try {
        encryptFile(dbPath, keyBuf, true);
        console.log(color.green('  ✓ Database → wagent.db.encrypted'));
        encryptedCount++;
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal enkripsi database: ${err.message}`));
      }
    } else {
      console.log(color.dim('  - Database belum ada, akan dienkripsi otomatis saat shutdown'));
    }

    console.log('');
    if (encryptedCount > 0) {
      console.log(color.green(`✅ ${encryptedCount} item berhasil dienkripsi.`));
    } else {
      console.log(color.yellow('⚠️  Tidak ada data yang dienkripsi.'));
    }
    console.log('');
  });

cryptoCmd
  .command('decrypt')
  .description('Dekripsi semua data (kebalikan dari encrypt)')
  .action(() => {
    const keyHex = getEncryptionKey();
    if (!keyHex) {
      console.log(color.red('\n✗ OPENCE_ENCRYPTION_KEY tidak ditemukan.'));
      console.log('');
      return;
    }

    const keyBuf = Buffer.from(keyHex, 'hex');
    let decryptedCount = 0;

    console.log('');
    console.log(color.bold('🔓 Mendekripsi data...'));
    console.log('──────────────────────────────────────');

    // 1. Decrypt .env
    const envEncPath = ENV_PATH + '.encrypted';
    if (existsSync(envEncPath)) {
      try {
        decryptEnvFile(ENV_PATH, keyBuf);
        console.log(color.green('  ✓ .env.encrypted → .env'));
        decryptedCount++;
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal dekripsi .env: ${err.message}`));
      }
    }

    // 2. Decrypt session
    if (existsSync(SESSION_DIR)) {
      try {
        const count = decryptDirectory(SESSION_DIR, keyBuf, true);
        if (count > 0) {
          console.log(color.green(`  ✓ Session: ${count} file didekripsi`));
          decryptedCount += count;
        }
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal dekripsi session: ${err.message}`));
      }
    }

    // 3. Decrypt numbers.json
    const numbersEncPath = join(process.cwd(), 'data', 'numbers.json.encrypted');
    if (existsSync(numbersEncPath)) {
      try {
        decryptFile(numbersEncPath, keyBuf, true);
        console.log(color.green('  ✓ numbers.json.encrypted → numbers.json'));
        decryptedCount++;
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal dekripsi numbers.json: ${err.message}`));
      }
    }

    // 4. Decrypt database
    const dbEncPath = join(process.cwd(), 'data', 'wagent.db.encrypted');
    if (existsSync(dbEncPath)) {
      try {
        decryptFile(dbEncPath, keyBuf, true);
        console.log(color.green('  ✓ Database: wagent.db.encrypted → wagent.db'));
        decryptedCount++;
      } catch (err: any) {
        console.log(color.red(`  ✗ Gagal dekripsi database: ${err.message}`));
      }
    }

    console.log('');
    if (decryptedCount > 0) {
      console.log(color.green(`✅ ${decryptedCount} item berhasil didekripsi.`));
    } else {
      console.log(color.yellow('⚠️  Tidak ada file terenkripsi yang ditemukan.'));
    }
    console.log('');
  });

cryptoCmd
  .command('status')
  .description('Cek status enkripsi data')
  .action(() => {
    const status = getEncryptionStatus(ENV_PATH, SESSION_DIR, DB_PATH);

    console.log('');
    console.log(color.bold('🔐 Encryption Status'));
    console.log('────────────────────────────');
    console.log(`  Key ${status.keySet ? color.green('✓ Terpasang') : color.red('✗ Tidak ada (export OPENCE_ENCRYPTION_KEY)')}`);
    console.log(`  .env          : ${status.envEncrypted ? color.green('🔒 Terenkripsi') : color.dim('📄 Plaintext')}`);
    console.log(`  Session files : ${status.sessionEncrypted > 0 ? color.green(`🔒 ${status.sessionEncrypted} file`) : color.dim('📄 Plaintext')}`);
    console.log(`  Database      : ${status.dbEncrypted ? color.green('🔒 Terenkripsi') : color.dim('📄 Plaintext')}`);
    console.log('');

    if (!status.keySet) {
      console.log(color.dim('  Untuk mengaktifkan enkripsi:'));
      console.log(color.dim('    1. wagent crypto init       — generate key'));
      console.log(color.dim('    2. export OPENCE_ENCRYPTION_KEY=...'));
      console.log(color.dim('    3. wagent crypto encrypt    — enkripsi data'));
      console.log('');
    }
  });

// ── knowledge-base ──────────────────────────────────────────────

import { KnowledgeEntry } from '@wagent/core';

const kbCmd = program.command('kb').description('📚 Kelola knowledge base / FAQ untuk AI agent');

kbCmd
  .command('list')
  .description('Tampilkan semua entri knowledge base')
  .option('-c, --category <category>', 'Filter berdasarkan kategori')
  .action(async (options) => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);
    const entries = options.category
      ? db.getAllKnowledgeEntries(options.category)
      : db.getAllKnowledgeEntries();

    console.log('');
    console.log(color.bold('📚 Knowledge Base Entries'));
    console.log('────────────────────────────');

    if (entries.length === 0) {
      console.log(color.dim('  Belum ada entri knowledge base.'));
      console.log(color.dim('  Tambah: wagent kb add'));
      console.log('');
      return;
    }

    console.log(color.dim(`  Total: ${entries.length} entri\n`));

    for (const entry of entries) {
      const question = entry.question || '(tanpa pertanyaan)';
      const answerPreview = entry.answer.substring(0, 80) + (entry.answer.length > 80 ? '...' : '');
      const tags = entry.tags.length > 0 ? entry.tags.join(', ') : '';

      console.log(`  ${color.cyan(entry.id)}`);
      console.log(`    Kategori  : ${entry.category}`);
      console.log(`    Pertanyaan: ${question}`);
      console.log(`    Jawaban   : ${answerPreview}`);
      console.log(`    Prioritas : ${'⭐'.repeat(entry.priority) || '-'}`);
      if (tags) console.log(`    Tags      : ${color.dim(tags)}`);
      console.log('');
    }

    db.close();
  });

kbCmd
  .command('add')
  .description('Tambah entri knowledge base baru')
  .requiredOption('-a, --answer <answer>', 'Jawaban / konten informasi')
  .option('-q, --question <question>', 'Pertanyaan (optional)')
  .option('-c, --category <category>', 'Kategori (default: general)')
  .option('-k, --keywords <keywords>', 'Kata kunci, pisah dengan koma')
  .option('-t, --tags <tags>', 'Tags, pisah dengan koma')
  .option('-p, --priority <priority>', 'Prioritas (1-5, default: 0)', '0')
  .action(async (options) => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);

    const id = `kb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const keywords = options.keywords ? options.keywords.split(',').map((k: string) => k.trim()) : [];
    const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];

    const entry: KnowledgeEntry = {
      id,
      category: options.category || 'general',
      question: options.question || '',
      answer: options.answer,
      keywords,
      tags,
      priority: parseInt(options.priority, 10) || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.createKnowledgeEntry(entry);
    db.close();

    console.log(color.green(`\n✓ Entri knowledge base berhasil ditambahkan!`));
    console.log(color.cyan(`  ID       : ${id}`));
    console.log(color.cyan(`  Kategori : ${entry.category}`));
    if (entry.question) console.log(color.cyan(`  Tanya    : ${entry.question}`));
    console.log('');
  });

kbCmd
  .command('remove')
  .description('Hapus entri knowledge base')
  .argument('<id>', 'ID entri yang akan dihapus')
  .action(async (id: string) => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);
    const existing = db.getKnowledgeEntry(id);

    if (!existing) {
      console.log(color.red(`✗ Entri dengan ID "${id}" tidak ditemukan.`));
      console.log('');
      db.close();
      return;
    }

    db.deleteKnowledgeEntry(id);
    db.close();

    console.log(color.green(`\n✓ Entri "${id}" berhasil dihapus.`));
    console.log('');
  });

kbCmd
  .command('search')
  .description('Cari di knowledge base')
  .argument('<query>', 'Kata kunci pencarian')
  .option('-c, --category <category>', 'Filter kategori')
  .option('-n, --limit <number>', 'Jumlah hasil (default: 5)', '5')
  .action(async (query: string, options) => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);
    const limit = parseInt(options.limit, 10) || 5;

    const results = db.searchKnowledge(query, limit);
    db.close();

    console.log('');
    console.log(color.bold(`🔍 Hasil pencarian: "${query}"`));
    console.log('────────────────────────────────');

    if (results.length === 0) {
      console.log(color.dim('  Tidak ada hasil yang cocok.'));
      console.log('');
      return;
    }

    console.log(color.dim(`  ${results.length} hasil ditemukan\n`));

    for (const result of results) {
      const entry = result.entry;
      const question = entry.question || '(tanpa pertanyaan)';
      const answerPreview = entry.answer.substring(0, 100) + (entry.answer.length > 100 ? '...' : '');

      console.log(`  ${color.cyan(entry.id)} [${Math.round(result.score * 100)}% match]`);
      console.log(`    ${color.dim('Tanya:')} ${question}`);
      console.log(`    ${color.dim('Jawab:')} ${answerPreview}`);
      console.log(`    ${color.dim('Kategori:')} ${entry.category} | ${color.dim('Prioritas:')} ${entry.priority}`);
      console.log('');
    }
  });

function parseKbSeedMd(content: string): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];
  const now = new Date();
  const blocks = content.split(/^---$/m);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Skip comment lines and section headers
    if (lines[0].startsWith('#') || lines[0].startsWith('##')) continue;

    const meta: Record<string, string> = {};
    let answerStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        meta[match[1]] = match[2].trim();
      } else if (Object.keys(meta).length > 0 && line.trim() === '') {
        answerStart = i + 1;
        break;
      } else if (Object.keys(meta).length > 0) {
        answerStart = i;
        break;
      }
    }

    if (!meta.id) continue;

    const answer = lines.slice(answerStart).join('\n').trim();
    if (!answer) continue;

    entries.push({
      id: meta.id,
      category: meta.category || 'umum',
      question: meta.question || '',
      answer,
      keywords: meta.keywords ? meta.keywords.split(',').map(k => k.trim()) : [],
      tags: meta.tags ? meta.tags.split(',').map(t => t.trim()) : [],
      priority: parseInt(meta.priority || '3', 10),
      createdAt: now,
      updatedAt: now,
    });
  }

  return entries;
}

kbCmd
  .command('seed')
  .description('🌱 Isi database dengan contoh FAQ dari file kb-seed.md')
  .option('--clear', 'Hapus semua entri yang ada sebelum seed')
  .action(async (options) => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);

    if (options.clear) {
      const existing = db.getAllKnowledgeEntries();
      for (const e of existing) db.deleteKnowledgeEntry(e.id);
      console.log(color.dim(`  Menghapus ${existing.length} entri yang ada...`));
    }

    // Read seed data from markdown file
    const seedPaths = [
      join(__dirname, '../../data/kb-seed.md'),
      join(__dirname, '../data/kb-seed.md'),
      join(process.cwd(), 'kb-seed.md'),
    ];

    let seedFile = '';
    for (const p of seedPaths) {
      if (existsSync(p)) {
        seedFile = readFileSync(p, 'utf-8');
        break;
      }
    }

    if (!seedFile) {
      console.log(color.red('  ❌ File kb-seed.md tidak ditemukan!'));
      db.close();
      return;
    }

    const seedEntries = parseKbSeedMd(seedFile);

    let added = 0;
    for (const entry of seedEntries) {
      // Skip if already exists
      if (!db.getKnowledgeEntry(entry.id)) {
        db.createKnowledgeEntry(entry);
        added++;
      }
    }

    db.close();

    console.log('');
    console.log(color.bold('🌱 Knowledge Base Seeder'));
    console.log('────────────────────────────────');
    console.log(color.green(`  ✅ ${added} entri baru ditambahkan!`));
    console.log('');
    console.log(color.cyan('  📂 Kategori:'));
    const categories = [...new Set(seedEntries.map(e => e.category))];
    const counts = categories.map(cat => ({
      cat,
      count: seedEntries.filter(e => e.category === cat).length,
    }));
    for (const { cat, count } of counts) {
      console.log(`    ${color.dim('•')} ${cat}: ${count} entri ${cat === 'pengiriman' ? '📦' : cat === 'refund' ? '💰' : cat === 'operasional' ? '⏰' : cat === 'pembayaran' ? '💳' : cat === 'pesanan' ? '📋' : cat === 'keluhan' ? '🛡️' : '📄'}`);
    }
    console.log('');
    console.log(color.dim('  Gunakan "wagent kb list" untuk melihat semua entri.'));
    console.log(color.dim('  Atau coba: wagent kb search "ongkir jakarta"'));
    console.log('');
  });

kbCmd
  .command('categories')
  .description('Tampilkan semua kategori knowledge base')
  .action(async () => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);
    const categories = db.getKnowledgeCategories();
    const total = db.getKnowledgeCount();
    db.close();

    console.log('');
    console.log(color.bold('📂 Knowledge Base Categories'));
    console.log('────────────────────────────────');

    if (categories.length === 0) {
      console.log(color.dim('  Belum ada kategori.'));
      console.log('');
      return;
    }

    for (const cat of categories) {
      console.log(`  ${color.cyan(cat)}`);
    }
    console.log('');
    console.log(color.dim(`  Total entri: ${total} | Total kategori: ${categories.length}`));
    console.log('');
  });

// ── Flexible RAG (v2) ──────────────────────────────────────────

kbCmd
  .command('upload')
  .description('📁 Upload file ke knowledge store (.md, .txt, .csv, .json)')
  .argument('<file>', 'Path ke file yang akan diupload')
  .action(async (filePath: string) => {
    const resolvedPath = filePath.startsWith('/') ? filePath : join(process.cwd(), filePath);

    if (!existsSync(resolvedPath)) {
      console.log(color.red(`\n✗ File tidak ditemukan: ${resolvedPath}`));
      console.log('');
      return;
    }

    const config = await loadConfig();
    const db = new Database(config.databaseUrl);
    const store = new KnowledgeStore(db, config);

    console.log(color.cyan(`\n📁 Uploading ${filePath}...`));

    const result = await store.uploadFile(resolvedPath);
    db.close();

    if (result.status === 'failed') {
      console.log(color.red(`\n✗ Upload gagal: ${result.error}`));
    } else {
      console.log(color.green(`\n✓ File berhasil diupload!`));
      console.log(color.cyan(`  File ID  : ${result.fileId}`));
      console.log(color.cyan(`  Nama     : ${result.fileName}`));
      console.log(color.cyan(`  Chunks   : ${result.totalChunks}`));
      console.log(color.cyan(`  Embedded : ${result.embeddedChunks}/${result.totalChunks}`));
      console.log(color.cyan(`  Status   : ${result.status}`));
    }
    console.log('');
  });

kbCmd
  .command('files')
  .description('📄 Kelola file di knowledge store')
  .argument('[action]', 'Action: list, delete, embed')
  .argument('[name]', 'Nama file (untuk delete)')
  .action(async (action: string, name: string) => {
    const config = await loadConfig();
    const db = new Database(config.databaseUrl);
    const store = new KnowledgeStore(db, config);

    if (action === 'delete') {
      if (!name) {
        console.log(color.red('\n✗ Nama file harus disertakan: wagent kb files delete <nama-file>'));
        db.close();
        return;
      }
      const deleted = store.deleteFileByName(name);
      if (deleted) {
        console.log(color.green(`\n✓ File "${name}" berhasil dihapus.`));
      } else {
        console.log(color.red(`\n✗ File "${name}" tidak ditemukan.`));
      }
      db.close();
      return;
    }

    if (action === 'embed') {
      console.log(color.cyan('\n🧮 Embedding chunks...'));
      const result = await store.embedPendingChunks();
      db.close();
      console.log(color.green(`\n✓ Selesai!`));
      console.log(color.cyan(`  Embedded : ${result.embedded}/${result.total}`));
      if (result.failed > 0) console.log(color.yellow(`  Gagal    : ${result.failed}`));
      return;
    }

    // Default: list files
    const files = store.listFiles();
    const stats = store.getStats();
    db.close();

    console.log('');
    console.log(color.bold('📄 Knowledge Store Files'));
    console.log('────────────────────────────────');

    if (files.length === 0) {
      console.log(color.dim('  Belum ada file yang diupload.'));
      console.log(color.dim('  Upload: wagent kb upload <file>'));
      console.log('');
      return;
    }

    console.log(color.dim(`  Total: ${files.length} file, ${stats.totalChunks} chunks\n`));

    for (const file of files) {
      const sizeKB = (file.fileSize / 1024).toFixed(1);
      const statusIcon = file.status === 'ready' ? '✅' : file.status === 'partial' ? '⚠️' : '❌';

      console.log(`  ${statusIcon} ${color.cyan(file.fileName)}`);
      console.log(`    ID       : ${color.dim(file.id)}`);
      console.log(`    Tipe     : ${file.fileExtension}`);
      console.log(`    Ukuran   : ${sizeKB} KB`);
      console.log(`    Chunks   : ${file.chunkCount}`);
      console.log(`    Status   : ${file.status}`);
      console.log(`    Upload   : ${file.createdAt.toLocaleString('id-ID')}`);
      console.log('');
    }
  });

// ── escalation ──────────────────────────────────────────────────

import { EscalationService } from '@wagent/core';

const escalationCmd = program.command('escalation').description('🚨 Uji coba notifikasi escalation ke Telegram');

escalationCmd
  .command('test')
  .description('Kirim test escalation ke grup Telegram untuk verifikasi konfigurasi')
  .option('-m, --message <message>', 'Pesan test', '🧪 Ini adalah test escalation dari WAGENT. Jika kamu menerima ini, konfigurasi Telegram berhasil! ✅')
  .action(async (options) => {
    const config = await loadConfig();

    if (!config.telegramBotToken) {
      console.log(color.red('\n✗ TELEGRAM_BOT_TOKEN tidak dikonfigurasi.'));
      console.log(color.dim('  Set environment variable:'));
      console.log(color.dim('  export TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234...'));
      console.log('');
      return;
    }

    if (!config.telegramChatId) {
      console.log(color.red('\n✗ TELEGRAM_CHAT_ID tidak dikonfigurasi.'));
      console.log(color.dim('  Set environment variable:'));
      console.log(color.dim('  export TELEGRAM_CHAT_ID=-123456789'));
      console.log('');
      return;
    }

    const escalation = new EscalationService(config);

    console.log('');
    console.log(color.bold('🚨 Mengirim test escalation ke Telegram...'));
    console.log('');
    console.log(color.cyan(`  Chat ID: ${config.telegramChatId}`));
    console.log(color.cyan(`  Token  : ${config.telegramBotToken.substring(0, 10)}...`));
    console.log('');

    const sent = await escalation.escalate({
      contactId: '62812xxxxxxx@s.whatsapp.net',
      contactName: 'Test Customer',
      customerMessage: options.message,
      reason: 'ai_explicit_escalation',
      details: 'Test escalation dari CLI',
    });

    if (sent) {
      console.log(color.green('✅ Escalation berhasil dikirim ke Telegram!'));
      console.log(color.dim('  Cek grup Telegram untuk melihat pesan test.'));
    } else {
      console.log(color.red('✗ Gagal mengirim escalation.'));
      console.log(color.dim('  Periksa:'));
      console.log(color.dim('  1. Token bot valid? (buat di @BotFather)'));
      console.log(color.dim('  2. Bot sudah ditambahkan ke grup?'));
      console.log(color.dim('  3. Chat ID benar? (gunakan @getidsbot untuk cek)'));
    }
    console.log('');
  });

// ── skill ──────────────────────────────────────────────────────

const SKILLS_DIR = join(process.cwd(), 'skills');

const skillCmd = program.command('skill').description('Kelola skills / plugin untuk AI agent');

skillCmd
  .command('list')
  .description('Tampilkan semua skill yang terinstall')
  .action(async () => {
    const loader = new SkillLoader(SKILLS_DIR);
    await loader.loadAll();
    const skills = loader.getLoadedSkills();

    console.log('');
    console.log(color.bold('🧩 WAGENT Skills'));
    console.log('──────────────────────────');

    if (skills.length === 0) {
      console.log(color.dim('  Tidak ada skill terinstall.'));
      console.log(color.dim(`  Letakkan file .js skill di: ${SKILLS_DIR}`));
      console.log(color.dim('  Atau install: wagent skill install <path>'));
      console.log('');
      return;
    }

    for (const skill of skills) {
      console.log(`  ${color.cyan(skill.manifest.name)} ${color.dim('v' + skill.manifest.version)}`);
      console.log(`    ${skill.manifest.description}`);
      if (skill.manifest.author) console.log(`    Author: ${skill.manifest.author}`);
      console.log(`    Tools: ${skill.tools.map(t => color.green(t.name)).join(', ')}`);
      console.log('');
    }

    console.log(color.dim(`  Total: ${skills.length} skill, ${loader.getTools().length} tools`));
    console.log('');
  });

skillCmd
  .command('install')
  .description('Install skill dari file .js')
  .argument('<path>', 'Path ke file skill .js')
  .action(async (skillPath: string) => {
    const resolvedPath = join(process.cwd(), skillPath);
    if (!existsSync(resolvedPath)) {
      console.log(color.red(`✗ File tidak ditemukan: ${resolvedPath}`));
      return;
    }

    // Create skills dir if not exists
    if (!existsSync(SKILLS_DIR)) {
      mkdirSync(SKILLS_DIR, { recursive: true });
    }

    const filename = `skill-${Date.now()}.js`;
    const destPath = join(SKILLS_DIR, filename);

    // Copy the skill file
    const content = readFileSync(resolvedPath, 'utf-8');
    writeFileSync(destPath, content);

    // Try to load and validate
    const loader = new SkillLoader(SKILLS_DIR);
    const skill = await loader.loadSkillFile(filename);

    if (skill) {
      console.log(color.green(`\n✓ Skill "${skill.manifest.name}" v${skill.manifest.version} berhasil diinstall!`));
      console.log(color.cyan(`  File: ${destPath}`));
      console.log(color.dim('  Restart WAGENT untuk mengaktifkan skill ini.'));
      console.log('');
    } else {
      // Remove failed file
      try { unlinkSync(destPath); } catch {}
      console.log(color.red('✗ Gagal menginstall skill. Perbaiki error dan coba lagi.'));
      console.log('');
    }
  });

skillCmd
  .command('remove')
  .description('Hapus skill yang terinstall')
  .argument('<name>', 'Nama skill yang akan dihapus')
  .action(async (name: string) => {
    if (!existsSync(SKILLS_DIR)) {
      console.log(color.red('✗ Tidak ada skill terinstall.'));
      return;
    }

    const loader = new SkillLoader(SKILLS_DIR);
    const filePath = await loader.findSkillFile(name);

    if (filePath && existsSync(filePath)) {
      unlinkSync(filePath);
      console.log(color.green(`\n✓ Skill "${name}" berhasil dihapus.`));
      console.log(color.dim(`  File: ${filePath}`));
    } else {
      console.log(color.red(`✗ Skill "${name}" tidak ditemukan.`));
    }
    console.log('');
  });

// ── mcp ──────────────────────────────────────────────────────

const mcpCmd = program.command('mcp').description('🔌 Kelola MCP (Model Context Protocol) servers');

mcpCmd
  .command('list')
  .description('Tampilkan MCP servers yang terkonfigurasi')
  .action(async () => {
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
  });

mcpCmd
  .command('test')
  .description('Test koneksi ke MCP server')
  .argument('[name]', 'Nama server (default: semua)')
  .action(async (serverName?: string) => {
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
  });

mcpCmd
  .command('expose')
  .description('Expose WAGENT tools via MCP server')
  .option('-p, --port <port>', 'HTTP port', '3001')
  .option('--stdio', 'Use stdio transport (for local usage)')
  .action(async (opts) => {
    const { MCPServer, SkillLoader, loadConfig } = await import('@wagent/core');
    const config = await loadConfig();
    const SKILLS_DIR = join(process.cwd(), 'skills');

    // Load tools from skills
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
  });

// ── model ──────────────────────────────────────────────────────

const modelCmd = program.command('model').description('🧠 Kelola AI model catalog (166+ providers via models.dev)');

modelCmd
  .command('resolve')
  .description('Resolve model ID ke provider info')
  .argument('<modelId>', 'Model ID (contoh: openai/gpt-4o)')
  .action(async (modelId) => {
    const { resolveModel } = await import('@wagent/core');

    const resolved = await resolveModel(modelId);

    console.log('');
    console.log(color.bold(`🔍 Resolve: ${modelId}`));
    console.log('──────────────────────────');

    console.log(`  ${color.cyan('Model ID:')} ${resolved.input}`);
    console.log(`  ${color.cyan('Provider:')} ${resolved.provider}`);
    console.log(`  ${color.cyan('Model:')} ${resolved.model}`);
    if (resolved.envKey) {
      console.log(`  ${color.cyan('API Key Env:')} ${resolved.envKey}`);
    }
    if (resolved.baseUrl) {
      console.log(`  ${color.cyan('Base URL:')} ${resolved.baseUrl}`);
    }
    if (resolved.npm) {
      console.log(`  ${color.cyan('SDK Package:')} ${resolved.npm}`);
    }
    if (resolved.name) {
      console.log(`  ${color.cyan('Provider Name:')} ${resolved.name}`);
    }

    console.log('');
  });

modelCmd
  .command('list')
  .description('Tampilkan semua provider')
  .action(async () => {
    const { refreshModelCatalog } = await import('@wagent/core');
    await refreshModelCatalog();

    const fs = await import('fs');
    const cacheFile = join(process.env.HOME || '~', '.wagent', 'models.json');
    
    if (!fs.existsSync(cacheFile)) {
      console.log(color.red('  Cache tidak ditemukan.'));
      return;
    }

    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const providers = Object.values(cache.providers) as any[];

    console.log('');
    console.log(color.bold('🧠 WAGENT Model Catalog'));
    console.log('──────────────────────────');
    console.log(`  ${color.green(String(providers.length))} providers tersedia`);
    console.log('');

    for (const provider of providers) {
      const envStr = provider.env?.length ? color.dim(` [${provider.env.join(', ')}]`) : '';
      console.log(`  ${color.cyan(provider.id)} - ${provider.name}${envStr}`);
    }

    console.log('');
  });

modelCmd
  .command('refresh')
  .description('Force refresh catalog dari models.dev')
  .action(async () => {
    const { refreshModelCatalog } = await import('@wagent/core');
    
    console.log('');
    console.log(color.bold('🔄 Refreshing model catalog...'));
    await refreshModelCatalog();
    console.log(color.green('  ✓ Catalog updated'));
    console.log('');
  });

// ── update ───────────────────────────────────────────────────────

program
  .command('update')
  .description('Update WAGENT ke versi terbaru dari GitHub')
  .action(async () => {
    const { execSync } = await import('child_process');
    const { homedir } = await import('os');

    const installDir = join(homedir(), '.wagent');
    const updateScript = join(installDir, 'update.sh');

    if (!existsSync(updateScript)) {
      console.error(color.red(`❌ Script update tidak ditemukan: ${updateScript}`));
      process.exit(1);
    }

    try {
      execSync(`bash "${updateScript}"`, { stdio: 'inherit' });
    } catch {
      process.exit(1);
    }
  });

// ── uninstall ────────────────────────────────────────────────────

program
  .command('uninstall')
  .description('Hapus instalasi WAGENT dari sistem')
  .action(async () => {
    const { execSync } = await import('child_process');
    const { homedir } = await import('os');

    const installDir = join(homedir(), '.wagent');
    const uninstallScript = join(installDir, 'uninstall.sh');

    if (!existsSync(uninstallScript)) {
      console.error(color.red(`❌ Script uninstall tidak ditemukan: ${uninstallScript}`));
      process.exit(1);
    }

    try {
      execSync(`bash "${uninstallScript}"`, { stdio: 'inherit' });
    } catch {
      process.exit(1);
    }
  });

// ── service ──────────────────────────────────────────────────────

const serviceCmd = program
  .command('service')
  .description('Kelola WAGENT background service (systemd)');

serviceCmd
  .command('status')
  .description('Cek status service')
  .action(() => serviceStatus());

serviceCmd
  .command('start')
  .description('Start service')
  .action(() => serviceStart());

serviceCmd
  .command('stop')
  .description('Stop service')
  .action(() => serviceStop());

serviceCmd
  .command('restart')
  .description('Restart service')
  .action(() => serviceRestart());

serviceCmd
  .command('logs')
  .description('Tampilkan log service (live)')
  .action(() => serviceLogs());

serviceCmd
  .command('enable')
  .description('Aktifkan autostart saat boot')
  .action(() => serviceEnable());

serviceCmd
  .command('disable')
  .description('Nonaktifkan autostart saat boot')
  .action(() => serviceDisable());

// ── Helper: cek port ─────────────────────────────────────────────

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false)); // port bebas
    });
    server.on('error', () => resolve(true)); // port terpakai
  });
}

// ── Parse args ──────────────────────────────────────────────────

program.parse(process.argv);


// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}


