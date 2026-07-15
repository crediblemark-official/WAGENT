import { createServer } from 'net';
import color from 'picocolors';
import {
  loadConfig,
  ensureDirectories,
  getLogger,
  Gateway,
  Database,
  SkillLoader
} from '@wagent/core';
import { BaileysAdapter } from '@wagent/whatsapp';
import { renderQRToString } from '@wagent/tui';
import { isServiceRunning, serviceStart } from './service.js';

// Helper: cek port
async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false)); // port bebas
    });
    server.on('error', () => resolve(true)); // port terpakai
  });
}

export async function startCommand(options: { port?: string; dashboard?: boolean }, pkgVersion: string): Promise<void> {
  // ── Port conflict check ─────────────────────────────────────
  // Lewati jika dijalankan sebagai systemd service (INVOCATION_ID di-set oleh systemd)
  const runningAsService = !!process.env.INVOCATION_ID;

  const config = await loadConfig();
  ensureDirectories(config);

  if (!runningAsService) {
    // Cek apakah service systemd sudah running (hanya untuk user manual)
    if (isServiceRunning()) {
      console.log('');
      console.log(color.yellow('  ⚠  WAGENT service is already running in background.'));
      console.log('');
      console.log(`  ${color.dim('Status:')}  wagent service status`);
      console.log(`  ${color.dim('Restart:')} wagent service restart`);
      console.log(`  ${color.dim('Logs:')}    wagent service logs`);
      console.log('');
      process.exit(0);
    }

    // Cek port secara langsung jika systemd tidak tersedia
    const targetPort = parseInt(options.port || '', 10) || config.dashboardPort || 3030;
    const portInUse = await checkPort(targetPort);
    if (portInUse) {
      console.log('');
      console.log(color.yellow(`  ⚠  Port ${targetPort} is already in use.`));
      console.log(color.dim('  WAGENT may already be running. Check with: wagent service status'));
      console.log('');
      process.exit(0);
    }
  }

  // Jika dijalankan di terminal interaktif (TTY) dan sesi sudah terhubung (creds.json ada)
  if (process.stdout.isTTY) {
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const sessionDir = join(
      config.whatsappSessionDir || join(process.cwd(), '.sessions'),
      config.whatsappSessionName
    );
    const credsPath = join(sessionDir, 'creds.json');

    if (existsSync(credsPath)) {
      console.log('');
      console.log(color.green(`  ✓ Sesi WhatsApp (${config.whatsappSessionName}) terdeteksi sudah aktif.`));
      console.log(color.cyan('  ⚙ Menjalankan WAGENT di latar belakang (background service)...'));
      console.log('');

      try {
        serviceStart();
        process.exit(0);
      } catch (err: any) {
        console.error(color.red(`  ✗ Gagal menjalankan service: ${err.message}`));
        console.log(color.dim('  Mencoba menjalankan secara manual di foreground...'));
        console.log('');
      }
    }
  }

  const logger = getLogger();

  const modelInfo = config.resolvedModel
    ? `${config.resolvedModel.provider} / ${config.resolvedModel.model}`
    : config.aiProvider;

  // Override port dari CLI
  if (options.port) {
    config.dashboardPort = parseInt(options.port, 10);
  }

  try {
    // Initialize database
    const db = new Database(config.databaseUrl);

    // Initialize WhatsApp adapter
    const whatsapp = new BaileysAdapter(config);

    // Initialize Dashboard (if enabled)
    let dashboard: any = undefined;
    if (options.dashboard !== false && config.dashboardPort) {
      try {
        // Path dari cli/dist/commands/start.js → naik 3 level ke packages/ lalu masuk dashboard
        const { resolve, dirname } = await import('path');
        const { fileURLToPath } = await import('url');
        const cliDistDir = dirname(fileURLToPath(import.meta.url));
        const dashboardPath = resolve(cliDistDir, '../../../dashboard/dist/server.js');
        const mod = await import(dashboardPath);
        const { DashboardServer } = mod;
        if (!DashboardServer) throw new Error('DashboardServer tidak ditemukan di modul');
        dashboard = new DashboardServer(config, db);
      } catch (err: any) {
        logger.warn('Dashboard module not available, running headless: %s', err?.message);
      }
    }

    // Redam QR dari qrcode-terminal — kita tampilkan sendiri lewat event bus
    process.env.WAGENT_DASHBOARD = '1';

    // Load skills untuk AI agent
    const skillLoader = new SkillLoader();
    await skillLoader.loadAll();
    const extraTools = skillLoader.getTools();

    // Create Gateway
    const gateway = new Gateway(config, db, whatsapp, dashboard, extraTools);

    // Wire dashboard to gateway (for approval queue)
    if (dashboard && typeof dashboard.setGateway === 'function') {
      dashboard.setGateway(gateway);
    }

    // Start gateway (emits connection:update + qr:received events)
    await gateway.start();

    // Dapatkan event bus dari gateway
    const bus = gateway.getEventBus();
    let qrWasShown = false;
    let shuttingDown = false;

    // Tampilkan informasi inisialisasi awal
    console.log('');
    console.log(color.bold(color.green('  ┌─────────────────────────────────────────┐')));
    console.log(color.bold(color.green('  │')) + color.bold('           🤖 WAGENT is running!         ') + color.bold(color.green('│')));
    console.log(color.bold(color.green('  └─────────────────────────────────────────┘')));
    console.log('');
    console.log(`  ${color.dim('Model')}       ${color.yellow(modelInfo)}`);
    console.log(`  ${color.dim('Session')}     ${config.whatsappSessionName || 'default'}`);
    if (config.dashboardPort && options.dashboard !== false) {
      console.log(`  ${color.dim('Dashboard')}   ${color.cyan(`http://localhost:${config.dashboardPort}`)}`);
    }
    console.log(`  ${color.dim('Stop')}        ${color.yellow('Ctrl+C')}`);
    console.log('');

    // Listener untuk QR Code
    bus.on('qr:received', (e: any) => {
      qrWasShown = true;
      console.log('');
      console.log(color.cyan('  📱 Scan QR code dengan WhatsApp:'));
      console.log(color.dim('  WhatsApp → ⋮ → Linked Devices → Link a Device'));
      console.log('');
      
      // Gunakan renderQRToString dari @wagent/tui
      const qrStr = renderQRToString(e.qr);
      console.log(qrStr);
      console.log('');
    });

    // Listener untuk status koneksi
    bus.on('connection:update', (e: any) => {
      const status = e.status;
      if (status === 'connected') {
        console.log(color.green('  ✓ WhatsApp terhubung!'));
        
        // Jika QR sempat muncul (artinya sesi fresh pairing/scan), otomatis hand-off ke background service
        if (qrWasShown) {
          console.log(color.cyan('  ⚙ Mengalihkan jalannya program ke background service...'));
          setImmediate(async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            try {
              await gateway.stop();
              db.close();
            } catch {}
            // Beri jeda 500ms agar socket WA dirilis sepenuhnya
            await new Promise(r => setTimeout(r, 500));
            try {
              serviceStart();
            } catch (err: any) {
              logger.warn('Gagal start service: %s', err?.message);
            }
            process.exit(0);
          });
        }
      } else if (status === 'disconnected') {
        console.log(color.red('  ✗ WhatsApp terputus.'));
      } else if (status === 'connecting') {
        console.log(color.dim('  ● Menghubungkan ke WhatsApp...'));
      }
    });

    // Clean shutdown helper
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(color.dim('\n  Stopping WAGENT...'));
      await gateway.stop();
      db.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep alive
    await new Promise(() => {});
    process.exit(0);

  } catch (err: any) {
    logger.error({ error: err.message }, 'Fatal error');
    console.error(color.red(`\n✗ Error: ${err.message}`));
    process.exit(1);
  }
}
