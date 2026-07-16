/**
 * wagent service — Manage WAGENT systemd user service
 *
 * Subcommands:
 *   wagent service status   → check service status
 *   wagent service start    → start service
 *   wagent service stop     → stop service
 *   wagent service restart  → restart service
 *   wagent service logs     → tail service logs
 *   wagent service enable   → enable autostart on boot
 *   wagent service disable  → disable autostart
 *   wagent service install  → install service file (used by install.sh)
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import color from 'picocolors';

const SERVICE_NAME = 'wagent';
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Detect systemd availability ─────────────────────────────────

function hasSystemd(): boolean {
  try {
    const result = spawnSync('systemctl', ['--user', '--no-pager', 'list-units'], {
      stdio: 'pipe',
      timeout: 2000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── Run systemctl ────────────────────────────────────────────────

function ctl(...args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('systemctl', ['--user', ...args], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  return {
    ok: result.status === 0,
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

// ── Install service file ─────────────────────────────────────────

export function serviceInstall(): boolean {
  if (!hasSystemd()) {
    console.log(color.dim('  ⚠  systemd not available — skipping service install.'));
    return false;
  }

  const home = homedir();
  const serviceDir = join(home, '.config', 'systemd', 'user');
  const serviceFile = join(serviceDir, `${SERVICE_NAME}.service`);

  // Cari template secara dinamis
  const possibleTemplates = [
    join(home, '.wagent', 'bin', `${SERVICE_NAME}.service`),
    join(__dirname, '../../bin', `${SERVICE_NAME}.service`),
    join(__dirname, '../../../bin', `${SERVICE_NAME}.service`),
    join(__dirname, '../../../../bin', `${SERVICE_NAME}.service`),
  ];
  const templatePath = possibleTemplates.find(p => existsSync(p));

  // Generate inline template dinamis secara langsung agar ExecStart adaptif
  // Dapatkan path binary wagent aktual di sistem user
  let wagentBin = 'wagent';
  try {
    const whichResult = execSync('which wagent', { encoding: 'utf-8' }).trim();
    if (whichResult) {
      wagentBin = whichResult;
    }
  } catch {
    // Fallback ke default global bun/npm path
    wagentBin = join(home, '.bun', 'bin', 'wagent');
  }

  const serviceContent = [
    '[Unit]',
    'Description=WAGENT WhatsApp AI Agent',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    'WorkingDirectory=%h',
    `ExecStart=${wagentBin} start`,
    'Restart=always',
    'RestartSec=10',
    'StandardOutput=journal',
    'StandardError=journal',
    'Environment=HOME=%h',
    'Environment=NVM_DIR=%h/.nvm',
    'Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin',
    'Environment=WAGENT_SERVICE=1',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');

  try {
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(serviceFile, serviceContent);
    console.log(color.green(`  ✓ Service file installed: ${serviceFile}`));
    ctl('daemon-reload');
    ctl('enable', SERVICE_NAME); // Aktifkan autostart saat boot
    return true;
  } catch (err: any) {
    console.error(color.red(`  ✗ Gagal menulis file service: ${err.message}`));
    return false;
  }
}

// ── Subcommand handlers ──────────────────────────────────────────

export function serviceStatus(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('status', SERVICE_NAME, '--no-pager', '-l');
  console.log(r.output);
}

function ensureServiceUpdated(serviceFile: string): void {
  if (!existsSync(serviceFile)) {
    console.log(color.cyan(`  🔍 Unit file wagent.service belum terpasang. Menginstal otomatis...`));
    const installed = serviceInstall();
    if (!installed) {
      console.error(color.red(`  ✗ Tidak dapat melanjutkan karena instalasi service gagal.`));
      process.exit(1);
    }
  } else {
    try {
      const content = readFileSync(serviceFile, 'utf-8');
      if (content.includes('Restart=on-failure') || !content.includes('WAGENT_SERVICE=1')) {
        console.log(color.cyan(`  ⚙ Memperbarui unit file wagent.service ke format terbaru (Restart=always)...`));
        serviceInstall();
      }
    } catch {}
  }
}

export function serviceStart(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  
  const home = homedir();
  const serviceFile = join(home, '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
  ensureServiceUpdated(serviceFile);

  const r = ctl('start', SERVICE_NAME);
  if (r.ok) {
    console.log(color.green(`  ✓ ${SERVICE_NAME} service started.`));
  } else {
    // Jika masih gagal (misal jika status file sempat tersangkut), reload daemon lalu coba lagi sekali
    ctl('daemon-reload');
    const retry = ctl('start', SERVICE_NAME);
    if (retry.ok) {
      console.log(color.green(`  ✓ ${SERVICE_NAME} service started after reload.`));
    } else {
      console.error(color.red(`  ✗ Failed to start service:\n${retry.output}`));
      process.exit(1);
    }
  }
}

export function serviceStop(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('stop', SERVICE_NAME);
  if (r.ok) {
    console.log(color.green(`  ✓ ${SERVICE_NAME} service stopped.`));
  } else {
    console.error(color.red(`  ✗ Failed to stop service:\n${r.output}`));
    process.exit(1);
  }
}

export function serviceRestart(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }

  const home = homedir();
  const serviceFile = join(home, '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
  ensureServiceUpdated(serviceFile);

  const r = ctl('restart', SERVICE_NAME);
  if (r.ok) {
    console.log(color.green(`  ✓ ${SERVICE_NAME} service restarted.`));
  } else {
    console.error(color.red(`  ✗ Failed to restart service:\n${r.output}`));
    process.exit(1);
  }
}

export function serviceLogs(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const result = spawnSync(
    'journalctl',
    ['--user', '-u', SERVICE_NAME, '-f', '--no-pager', '-n', '50'],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(color.red('  ✗ Failed to read logs. Is journald active?'));
  }
}

export function serviceEnable(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }

  const home = homedir();
  const serviceFile = join(home, '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
  ensureServiceUpdated(serviceFile);

  const r = ctl('enable', SERVICE_NAME);
  if (r.ok) {
    console.log(color.green(`  ✓ ${SERVICE_NAME} will autostart on login/boot.`));
  } else {
    console.error(color.red(`  ✗ Failed to enable service:\n${r.output}`));
  }
}

export function serviceDisable(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('disable', SERVICE_NAME);
  if (r.ok) {
    console.log(color.green(`  ✓ Autostart for ${SERVICE_NAME} disabled.`));
  } else {
    console.error(color.red(`  ✗ Failed to disable service:\n${r.output}`));
  }
}

// ── Helper ───────────────────────────────────────────────────────

function printNoSystemd(): void {
  console.log(color.yellow('  ⚠  systemd is not available on this system.'));
  console.log(color.dim('     Use: wagent start  to run manually.'));
}

// ── Check if service is running ──────────────────────────────────

export function isServiceRunning(): boolean {
  if (!hasSystemd()) return false;
  const r = ctl('is-active', SERVICE_NAME);
  return r.ok && r.output.trim() === 'active';
}
