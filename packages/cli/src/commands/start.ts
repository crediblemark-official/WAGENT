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
import { renderDashboard, renderQRToString } from '@wagent/tui';
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
        // Path relatif dari cli/dist/ → packages/dashboard/dist/server.js
        const { resolve, dirname } = await import('path');
        const { fileURLToPath } = await import('url');
        const cliDistDir = dirname(fileURLToPath(import.meta.url));
        const dashboardPath = resolve(cliDistDir, '../../dashboard/dist/server.js');
        const mod = await import(dashboardPath);
        const { DashboardServer } = mod;
        if (!DashboardServer) throw new Error('DashboardServer tidak ditemukan di modul');
        dashboard = new DashboardServer(config, db);
      } catch (err: any) {
        logger.warn('Dashboard module not available, running headless: %s', err?.message);
      }
    }

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

    // Full-screen Ink dashboard only when attached to a real terminal.
    // Under systemd / piped logs there is no TTY, so fall back to the
    // plain console summary.
    if (!process.stdout.isTTY) {
      console.log('');
      console.log(color.bold(color.green('  ┌─────────────────────────────────────────┐')));
      console.log(color.bold(color.green('  │')) + color.bold('           ✓ WAGENT is running!          ') + color.bold(color.green('│')));
      console.log(color.bold(color.green('  └─────────────────────────────────────────┘')));
      console.log('');
      if (config.dashboardPort && options.dashboard !== false) {
        console.log(`  ${color.dim('Dashboard')}  ${color.cyan(`http://localhost:${config.dashboardPort}`)}`);
      }
      console.log(`  ${color.dim('Stop')}       ${color.yellow('Ctrl+C')}`);
      console.log('');

      const shutdownHeadless = async () => {
        await gateway.stop();
        db.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdownHeadless);
      process.on('SIGTERM', shutdownHeadless);

      await new Promise(() => {}); // keep alive
      return;
    }

    // Render Ink dashboard (replaces console output). Tell WhatsApp client
    // not to print the QR itself — the dashboard renders it.
    process.env.WAGENT_DASHBOARD = '1';
    const dashboardUrl = config.dashboardPort
      ? `http://localhost:${config.dashboardPort}`
      : undefined;

    // Redam log error dekripsi libsignal yang mengotori TUI
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      const msg = args.join(' ');
      if (
        msg.includes('Failed to decrypt message') ||
        msg.includes('Bad MAC') ||
        msg.includes('libsignal/src/') ||
        msg.includes('verifyMAC')
      ) {
        return;
      }
      originalConsoleError(...args);
    };

    const ui = renderDashboard({
      version: pkgVersion,
      model: modelInfo,
      dashboardUrl,
      sessionName: config.whatsappSessionName || 'default',
    });

    // Drive the Ink dashboard dari gateway events
    const bus = gateway.getEventBus();
    bus.on('connection:update', (e: any) => {
      const s = e.status === 'reconnecting' ? 'connecting' : e.status;
      ui.setStatus(s);
    });
    bus.on('qr:received', (e: any) => ui.setQRCode(renderQRToString(e.qr)));
    bus.on('message:received', (e: any) => {
      const m = e.message || {};
      ui.addMessage({
        from: m.senderName || m.from || 'unknown',
        content: m.body || m.text || '',
        time: new Date().toLocaleTimeString(),
        isAI: false,
      });
    });

    let shuttingDown = false;

    // Setelah QR di-scan dan connected: stop proses ini, hand-off ke service
    ui.onConnected?.(() => {
      setImmediate(async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
          await gateway.stop();
          db.close();
        } catch { /* abaikan */ }
        // Beri jeda 500ms supaya socket WA benar-benar released sebelum service start
        await new Promise(r => setTimeout(r, 500));
        try {
          serviceStart();
        } catch (err: any) {
          logger.warn('Tidak bisa start service: %s', err?.message);
        }
        process.exit(0);
      });
    });

    // Clean shutdown used by both SIGINT/SIGTERM and Ink's own exit
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.error = originalConsoleError; // Restore console.error
      ui.stop();
      await gateway.stop();
      db.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Wait for Ink to exit (Ctrl+C / 'q' inside the TUI)
    await ui.waitUntilExit();

    // Ink closed — make sure gateway is stopped and process exits
    console.error = originalConsoleError; // Restore console.error
    if (!shuttingDown) {
      shuttingDown = true;
      await gateway.stop();
      db.close();
    }
    process.exit(0);

  } catch (err: any) {
    logger.error({ error: err.message }, 'Fatal error');
    console.error(color.red(`\n✗ Error: ${err.message}`));
    process.exit(1);
  }
}
