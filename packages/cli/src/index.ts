#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import color from 'picocolors';

// Impor modul commands
import { startCommand } from './commands/start.js';
import { configCommand, statusCommand, logCommand } from './commands/config.js';
import { listNumbers, addNumber, removeNumber } from './commands/number.js';
import { initCrypto, encryptData, decryptData, statusCrypto } from './commands/crypto.js';
import {
  listKb,
  addKb,
  removeKb,
  searchKb,
  seedKb,
  categoriesKb,
  uploadFileKb,
  manageFilesKb
} from './commands/kb.js';
import { testEscalation } from './commands/escalation.js';
import { listSkills, installSkill, removeSkill } from './commands/skill.js';
import { listMcpServers, testMcpServer, exposeMcpServer } from './commands/mcp.js';
import { resolveModelCommand, listModels, refreshModels } from './commands/model.js';
import {
  serviceStatus,
  serviceStart,
  serviceStop,
  serviceRestart,
  serviceLogs,
  serviceEnable,
  serviceDisable
} from './commands/service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mencari package.json secara aman dengan fallback
let version = '0.2.15';
try {
  const possiblePaths = [
    join(__dirname, '../package.json'),              // CLI local package.json
    join(__dirname, '../../package.json'),           // CLI local parent
    join(__dirname, '../../../package.json'),        // Root dev package.json
    join(__dirname, '../../../../package.json'),     // Flat nested global package.json
    join(__dirname, '../../../../../package.json'),    // Deep nested global package.json
  ];
  const pkgPath = possiblePaths.find(p => existsSync(p));
  if (pkgPath) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg && pkg.version) {
      version = pkg.version;
    }
  }
} catch (e) {
  // Silent fallback
}

const program = new Command();

program
  .name('wagent')
  .description('🤖 WAGENT - WhatsApp AI Agent')
  .version(
    [
      '',
      color.bold(color.cyan('  WAGENT - WhatsApp AI Agent')),
      color.dim(`  Version  : v${version}`),
      color.dim(`  Runtime  : ${process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.version}`),
      color.dim(`  Platform : ${process.platform} ${process.arch}`),
      '',
    ].join('\n'),
    '-v, --version',
    'Show WAGENT version'
  );

// ── init & setup ──────────────────────────────────────────────────

program
  .command('init')
  .description('Setup wizard untuk konfigurasi WAGENT')
  .action(async () => {
    const { setupConfigWizard } = await import('@wagent/tui');
    await setupConfigWizard();
  });

program
  .command('setup-prompts')
  .description('AI-guided setup untuk generate prompt files (system, personality, messages, skills)')
  .action(async () => {
    const { setupPromptWizard } = await import('@wagent/tui');
    await setupPromptWizard();
  });

// ── start ─────────────────────────────────────────────────────────

program
  .command('start')
  .description('Mulai WAGENT Gateway (WhatsApp + AI Agent)')
  .option('-p, --port <port>', 'Dashboard port', '3030')
  .option('--no-dashboard', 'Jalankan tanpa dashboard web')
  .action((options) => startCommand(options, version));

// ── config, status, log ───────────────────────────────────────────

program
  .command('config')
  .description('Show current configuration')
  .action(() => configCommand());

program
  .command('status')
  .description('Check WhatsApp connection status')
  .action(() => statusCommand());

program
  .command('log')
  .description('Lihat log terbaru WAGENT')
  .option('-n, --lines <number>', 'Jumlah baris log', '50')
  .action((options) => logCommand(options));

// ── WhatsApp Multi-Number ──────────────────────────────────────────

const numberCmd = program.command('number').description('Kelola multi-number WhatsApp');

numberCmd
  .command('list')
  .description('Tampilkan semua nomor WhatsApp yang terkonfigurasi')
  .action(() => listNumbers());

numberCmd
  .command('add')
  .description('Tambah nomor WhatsApp baru')
  .argument('<id>', 'ID unik untuk nomor (contoh: cs-1)')
  .argument('<sessionName>', 'Nama session folder (contoh: session-cs-1)')
  .argument('[label]', 'Label display (contoh: "Customer Service 1")')
  .action((id, sessionName, label) => addNumber(id, sessionName, label));

numberCmd
  .command('remove')
  .description('Hapus nomor WhatsApp')
  .argument('<id>', 'ID nomor yang akan dihapus')
  .option('-f, --force', 'Hapus tanpa konfirmasi')
  .action((id, options) => removeNumber(id, options));

// ── Data Encryption (crypto) ──────────────────────────────────────

const cryptoCmd = program.command('crypto').description('🔐 Kelola enkripsi data (credentials, session, database)');

cryptoCmd
  .command('init')
  .description('Generate encryption key dan enkripsi semua data sensitif')
  .action(() => initCrypto());

cryptoCmd
  .command('encrypt')
  .description('Enkripsi .env, session WhatsApp, dan database')
  .action(() => encryptData());

cryptoCmd
  .command('decrypt')
  .description('Dekripsi semua data (kebalikan dari encrypt)')
  .action(() => decryptData());

cryptoCmd
  .command('status')
  .description('Cek status enkripsi data')
  .action(() => statusCrypto());

// ── Knowledge Base (kb) ───────────────────────────────────────────

const kbCmd = program.command('kb').description('📚 Kelola knowledge base / FAQ untuk AI agent');

kbCmd
  .command('list')
  .description('Tampilkan semua entri knowledge base')
  .option('-c, --category <category>', 'Filter berdasarkan kategori')
  .action((options) => listKb(options));

kbCmd
  .command('add')
  .description('Tambah entri knowledge base baru')
  .requiredOption('-a, --answer <answer>', 'Jawaban / konten informasi')
  .option('-q, --question <question>', 'Pertanyaan (optional)')
  .option('-c, --category <category>', 'Kategori (default: general)')
  .option('-k, --keywords <keywords>', 'Kata kunci, pisah dengan koma')
  .option('-t, --tags <tags>', 'Tags, pisah dengan koma')
  .option('-p, --priority <priority>', 'Prioritas (1-5, default: 0)', '0')
  .action((options) => addKb(options));

kbCmd
  .command('remove')
  .description('Hapus entri knowledge base')
  .argument('<id>', 'ID entri yang akan dihapus')
  .action((id) => removeKb(id));

kbCmd
  .command('search')
  .description('Cari di knowledge base')
  .argument('<query>', 'Kata kunci pencarian')
  .option('-c, --category <category>', 'Filter kategori')
  .option('-n, --limit <number>', 'Jumlah hasil (default: 5)', '5')
  .action((query, options) => searchKb(query, options));

kbCmd
  .command('seed')
  .description('🌱 Isi database dengan contoh FAQ dari file kb-seed.md')
  .option('--clear', 'Hapus semua entri yang ada sebelum seed')
  .action((options) => seedKb(options));

kbCmd
  .command('categories')
  .description('Tampilkan semua kategori knowledge base')
  .action(() => categoriesKb());

kbCmd
  .command('upload')
  .description('📁 Upload file ke knowledge store (.md, .txt, .csv, .json)')
  .argument('<file>', 'Path ke file yang akan diupload')
  .action((filePath) => uploadFileKb(filePath));

kbCmd
  .command('files')
  .description('📄 Kelola file di knowledge store')
  .argument('[action]', 'Action: list, delete, embed')
  .argument('[name]', 'Nama file (untuk delete)')
  .action((action, name) => manageFilesKb(action, name));

// ── Telegram Escalation ───────────────────────────────────────────

const escalationCmd = program.command('escalation').description('🚨 Uji coba notifikasi escalation ke Telegram');

escalationCmd
  .command('test')
  .description('Kirim test escalation ke grup Telegram untuk verifikasi konfigurasi')
  .option('-m, --message <message>', 'Pesan test', '🧪 Ini adalah test escalation dari WAGENT. Jika kamu menerima ini, konfigurasi Telegram berhasil! ✅')
  .action((options) => testEscalation(options));

// ── Skills / Plugins ──────────────────────────────────────────────

const skillCmd = program.command('skill').description('Kelola skills / plugin untuk AI agent');

skillCmd
  .command('list')
  .description('Tampilkan semua skill yang terinstall')
  .action(() => listSkills());

skillCmd
  .command('install')
  .description('Install skill dari file .js')
  .argument('<path>', 'Path ke file skill .js')
  .action((path) => installSkill(path));

skillCmd
  .command('remove')
  .description('Hapus skill yang terinstall')
  .argument('<name>', 'Nama skill yang akan dihapus')
  .action((name) => removeSkill(name));

// ── MCP (Model Context Protocol) ──────────────────────────────────

const mcpCmd = program.command('mcp').description('🔌 Kelola MCP (Model Context Protocol) servers');

mcpCmd
  .command('list')
  .description('Tampilkan MCP servers yang terkonfigurasi')
  .action(() => listMcpServers());

mcpCmd
  .command('test')
  .description('Test koneksi ke MCP server')
  .argument('[name]', 'Nama server (default: semua)')
  .action((name) => testMcpServer(name));

mcpCmd
  .command('expose')
  .description('Expose WAGENT tools via MCP server')
  .option('-p, --port <port>', 'HTTP port', '3001')
  .option('--stdio', 'Use stdio transport (for local usage)')
  .action((opts) => exposeMcpServer(opts));

// ── AI Model Catalog (model) ──────────────────────────────────────

const modelCmd = program.command('model').description('🧠 Kelola AI model catalog (166+ providers via models.dev)');

modelCmd
  .command('resolve')
  .description('Resolve model ID ke provider info')
  .argument('<modelId>', 'Model ID (contoh: openai/gpt-4o)')
  .action((modelId) => resolveModelCommand(modelId));

modelCmd
  .command('list')
  .description('Tampilkan semua provider')
  .action(() => listModels());

modelCmd
  .command('refresh')
  .description('Force refresh catalog dari models.dev')
  .action(() => refreshModels());

// ── update & uninstall ────────────────────────────────────────────

program
  .command('update')
  .description('Update WAGENT ke versi terbaru dari GitHub')
  .action(async () => {
    const { execSync } = await import('child_process');
    const { homedir } = await import('os');
    const installDir = join(homedir(), '.wagent');
    const updateScript = join(installDir, 'update.sh');

    if (existsSync(updateScript)) {
      // curl install — run update.sh from ~/.wagent
      try {
        execSync(`bash "${updateScript}"`, { stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
    } else {
      // npm global install — use npm to update
      console.log(color.cyan('📦 Updating via npm...'));
      try {
        execSync('npm update -g @wagent/wagent', { stdio: 'inherit' });
        console.log(color.green('✅ Updated to latest version!'));
      } catch {
        console.error(color.red('❌ npm update failed. Try: npm install -g @wagent/wagent@latest'));
        process.exit(1);
      }
    }
  });

program
  .command('uninstall')
  .description('Hapus instalasi WAGENT dari sistem')
  .action(async () => {
    const { execSync } = await import('child_process');
    const { homedir } = await import('os');
    const installDir = join(homedir(), '.wagent');
    const uninstallScript = join(installDir, 'uninstall.sh');

    if (existsSync(uninstallScript)) {
      // curl install — run uninstall.sh from ~/.wagent
      try {
        execSync(`bash "${uninstallScript}"`, { stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
    } else {
      // npm global install — uninstall via npm + clean up all WAGENT artifacts
      console.log(color.cyan('📦 Uninstalling WAGENT...'));
      try {
        execSync('npm uninstall -g @wagent/wagent', { stdio: 'inherit' });
        console.log(color.green('✓ npm package removed'));
      } catch {
        console.error(color.red('❌ npm uninstall failed. Try: npm uninstall -g @wagent/wagent'));
        process.exit(1);
      }
    }

    // Clean up all WAGENT artifacts (works for both install methods)
    const { unlinkSync, rmSync, existsSync: existsSync2 } = await import('fs');

    // 1. Remove ~/.local/bin/wagent (CLI shim)
    const binPath = join(homedir(), '.local', 'bin', 'wagent');
    if (existsSync2(binPath)) {
      try { unlinkSync(binPath); console.log(color.dim(`  ✓ Removed ${binPath}`)); } catch {}
    }

    // 2. Remove ~/.wagent (install dir + data)
    if (existsSync2(installDir)) {
      try { rmSync(installDir, { recursive: true, force: true }); console.log(color.dim(`  ✓ Removed ${installDir}`)); } catch {}
    }

    // 3. Remove systemd service
    const serviceFile = join(homedir(), '.config', 'systemd', 'user', 'wagent.service');
    if (existsSync2(serviceFile)) {
      try {
        execSync('systemctl --user stop wagent 2>/dev/null || true', { stdio: 'ignore' });
        execSync('systemctl --user disable wagent 2>/dev/null || true', { stdio: 'ignore' });
        unlinkSync(serviceFile);
        execSync('systemctl --user daemon-reload 2>/dev/null || true', { stdio: 'ignore' });
        console.log(color.dim(`  ✓ Removed systemd service`));
      } catch {}
    }

    console.log(color.green('\n✅ WAGENT uninstalled.'));
    console.log(color.dim('  You may also remove ~/.wagent manually if it still exists.'));
  });

// ── Systemd Service (service) ─────────────────────────────────────

const serviceCmd = program.command('service').description('Kelola WAGENT background service (systemd)');

serviceCmd.command('status').description('Cek status service').action(() => serviceStatus());
serviceCmd.command('start').description('Start service').action(() => serviceStart());
serviceCmd.command('stop').description('Stop service').action(() => serviceStop());
serviceCmd.command('restart').description('Restart service').action(() => serviceRestart());
serviceCmd.command('logs').description('Tampilkan log service (live)').action(() => serviceLogs());
serviceCmd.command('enable').description('Aktifkan autostart saat boot').action(() => serviceEnable());
serviceCmd.command('disable').description('Nonaktifkan autostart saat boot').action(() => serviceDisable());

// ── Parse Arguments ───────────────────────────────────────────────

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
