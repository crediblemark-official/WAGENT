/**
 * wagent service — Kelola systemd user service untuk WAGENT
 *
 * Subcommand:
 *   wagent service status   → status service
 *   wagent service start    → start service
 *   wagent service stop     → stop service
 *   wagent service restart  → restart service
 *   wagent service logs     → tail log service
 *   wagent service enable   → aktifkan autostart saat boot
 *   wagent service disable  → nonaktifkan autostart
 *   wagent service install  → install service file (dipakai install.sh)
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SERVICE_NAME = 'wagent';

// ── Deteksi apakah systemd tersedia ─────────────────────────────

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

// ── Jalankan systemctl ──────────────────────────────────────────

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

// ── Install service file ────────────────────────────────────────

export function serviceInstall(): boolean {
  if (!hasSystemd()) {
    console.log('⚠  systemd tidak tersedia — lewati install service.');
    return false;
  }

  const home = homedir();
  const serviceDir = join(home, '.config', 'systemd', 'user');
  const serviceFile = join(serviceDir, `${SERVICE_NAME}.service`);

  // Baca template dari direktori instalasi
  const installDir = join(home, '.wagent');
  const templatePath = join(installDir, 'bin', `${SERVICE_NAME}.service`);

  if (!existsSync(templatePath)) {
    console.error(`✗ Template service tidak ditemukan: ${templatePath}`);
    return false;
  }

  mkdirSync(serviceDir, { recursive: true });
  writeFileSync(serviceFile, readFileSync(templatePath, 'utf-8'));
  console.log(`✔ Service file diinstall: ${serviceFile}`);

  // Reload daemon
  ctl('daemon-reload');
  return true;
}

// ── Subcommand handlers ─────────────────────────────────────────

export function serviceStatus(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('status', SERVICE_NAME, '--no-pager', '-l');
  console.log(r.output);
}

export function serviceStart(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('start', SERVICE_NAME);
  if (r.ok) {
    console.log(`✔ ${SERVICE_NAME} service dimulai.`);
  } else {
    console.error(`✗ Gagal start service:\n${r.output}`);
    process.exit(1);
  }
}

export function serviceStop(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('stop', SERVICE_NAME);
  if (r.ok) {
    console.log(`✔ ${SERVICE_NAME} service dihentikan.`);
  } else {
    console.error(`✗ Gagal stop service:\n${r.output}`);
    process.exit(1);
  }
}

export function serviceRestart(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('restart', SERVICE_NAME);
  if (r.ok) {
    console.log(`✔ ${SERVICE_NAME} service di-restart.`);
  } else {
    console.error(`✗ Gagal restart service:\n${r.output}`);
    process.exit(1);
  }
}

export function serviceLogs(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  // Jalankan langsung untuk streaming output
  const result = spawnSync(
    'journalctl',
    ['--user', '-u', SERVICE_NAME, '-f', '--no-pager', '-n', '50'],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error('Gagal membaca log. Pastikan journald aktif.');
  }
}

export function serviceEnable(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('enable', SERVICE_NAME);
  if (r.ok) {
    console.log(`✔ ${SERVICE_NAME} akan otomatis start saat login/boot.`);
  } else {
    console.error(`✗ Gagal enable service:\n${r.output}`);
  }
}

export function serviceDisable(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('disable', SERVICE_NAME);
  if (r.ok) {
    console.log(`✔ Autostart ${SERVICE_NAME} dinonaktifkan.`);
  } else {
    console.error(`✗ Gagal disable service:\n${r.output}`);
  }
}

// ── Helper ──────────────────────────────────────────────────────

function printNoSystemd(): void {
  console.log('⚠  systemd tidak tersedia di sistem ini.');
  console.log('   Gunakan: wagent start  untuk menjalankan secara manual.');
}

// ── Cek apakah service sudah running ───────────────────────────

export function isServiceRunning(): boolean {
  if (!hasSystemd()) return false;
  const r = ctl('is-active', SERVICE_NAME);
  return r.ok && r.output.trim() === 'active';
}
