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
import { join } from 'path';
import { homedir } from 'os';
import color from 'picocolors';

const SERVICE_NAME = 'wagent';

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

  const installDir = join(home, '.wagent');
  const templatePath = join(installDir, 'bin', `${SERVICE_NAME}.service`);

  if (!existsSync(templatePath)) {
    console.error(color.red(`  ✗ Service template not found: ${templatePath}`));
    return false;
  }

  mkdirSync(serviceDir, { recursive: true });
  writeFileSync(serviceFile, readFileSync(templatePath, 'utf-8'));
  console.log(color.green(`  ✓ Service file installed: ${serviceFile}`));

  ctl('daemon-reload');
  return true;
}

// ── Subcommand handlers ──────────────────────────────────────────

export function serviceStatus(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('status', SERVICE_NAME, '--no-pager', '-l');
  console.log(r.output);
}

export function serviceStart(): void {
  if (!hasSystemd()) { printNoSystemd(); return; }
  const r = ctl('start', SERVICE_NAME);
  if (r.ok) {
    console.log(color.green(`  ✓ ${SERVICE_NAME} service started.`));
  } else {
    console.error(color.red(`  ✗ Failed to start service:\n${r.output}`));
    process.exit(1);
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
