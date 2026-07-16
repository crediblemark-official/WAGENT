import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve, dirname, join, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  DashboardAdapter,
  GatewayEvent,
  WAgentConfig,
  Database,
  Message,
  Contact,
  Chat,
  ConnectionStatus,
  WhatsAppNumberConfig,
  promptLoader,
  getAllModels,
} from '@wagent/core';
import type { Gateway } from '@wagent/core';
import { getLogger } from '@wagent/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class DashboardServer implements DashboardAdapter {
  private app = express();
  private server = createServer(this.app);
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private numbers: WhatsAppNumberConfig[] = [];
  private humanActiveChats = new Set<string>();
  private logger = getLogger().child({ module: 'dashboard' });
  private isRunning = false;

  constructor(
    private config: WAgentConfig,
    private db: Database,
    private gateway?: Gateway
  ) {
    this.loadNumbers();
    this.wss = new WebSocketServer({ noServer: true });
    this.setupWebSocket();
    this.setupRoutes();

    // Bun doesn't support ws 'upgrade' event — handle upgrade manually
    this.server.on('upgrade', (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.logger.debug('Dashboard client connected');

      // Send initial data
      ws.send(JSON.stringify({
        type: 'connection:status',
        status: 'connected',
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        this.logger.debug('Dashboard client disconnected');
      });

      // Handle incoming messages from dashboard
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWsMessage(msg, ws);
        } catch (err) {
          this.logger.warn({ error: err }, 'Invalid WS message');
        }
      });
    });
  }

  private async handleWsMessage(msg: any, ws: WebSocket): Promise<void> {
    switch (msg.type) {
      case 'get:chats':
        ws.send(JSON.stringify({
          type: 'chat:list',
          chats: this.db.getAllChats(),
        }));
        break;

      case 'get:contacts':
        ws.send(JSON.stringify({
          type: 'contact:list',
          contacts: this.db.getAllContacts(),
        }));
        break;

      case 'get:messages':
        ws.send(JSON.stringify({
          type: 'messages',
          messages: this.db.getMessages(msg.chatId, msg.limit || 50, msg.offset || 0),
        }));
        break;

      case 'get:stats':
        ws.send(JSON.stringify({
          type: 'stats:update',
          stats: this.db.getStats(msg.days || 7),
        }));
        break;

      case 'get:broadcasts':
        ws.send(JSON.stringify({
          type: 'broadcasts',
          broadcasts: this.db.getAllBroadcasts(),
        }));
        break;

      case 'search:contacts':
        ws.send(JSON.stringify({
          type: 'contact:list',
          contacts: this.db.searchContacts(msg.query),
        }));
        break;

      // ── Human Takeover ─────────────────────────────────

      case 'get:human-active':
        ws.send(JSON.stringify({
          type: 'human:active:list',
          chatIds: Array.from(this.humanActiveChats),
        }));
        break;

      // ── Scheduled Messages ──────────────────────────────

      case 'get:scheduled':
        ws.send(JSON.stringify({
          type: 'scheduled:list',
          scheduled: this.db.getAllScheduledMessages(),
        }));
        break;

      case 'scheduled:create': {
        const input = msg.scheduled;
        if (!input || !input.id || !input.contactId || !input.content) {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid scheduled message data' }));
          break;
        }
        const scheduledMsg = {
          id: input.id,
          contactId: input.contactId,
          contactName: input.contactName || input.contactId,
          content: input.content,
          scheduledAt: new Date(input.scheduledAt),
          repeat: input.repeat || ('none' as const),
          status: 'pending' as const,
          sentCount: 0,
          failedCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.db.createScheduledMessage(scheduledMsg);
        this.broadcast({ type: 'scheduled:update', scheduled: scheduledMsg });
        break;
      }

      case 'scheduled:cancel': {
        if (msg.id) {
          this.db.updateScheduledMessage(msg.id, { status: 'cancelled' as const });
          const updated = this.db.getScheduledMessage(msg.id);
          if (updated) {
            this.broadcast({ type: 'scheduled:update', scheduled: updated });
          }
        }
        break;
      }

      case 'scheduled:delete': {
        if (msg.id) {
          this.db.deleteScheduledMessage(msg.id);
          this.broadcast({ type: 'scheduled:deleted', id: msg.id });
        }
        break;
      }

      // ── Multi-Number ───────────────────────────────────

      case 'get:numbers': {
        const adapter = this.gateway?.getWhatsAppAdapter();
        if (adapter && 'getNumbers' in adapter) {
          const liveNumbers = (adapter as any).getNumbers();
          ws.send(JSON.stringify({ type: 'numbers:list', numbers: liveNumbers }));
        } else {
          ws.send(JSON.stringify({ type: 'numbers:list', numbers: this.numbers }));
        }
        break;
      }

      case 'number:add': {
        const num = msg.number as WhatsAppNumberConfig;
        if (num && num.id && num.sessionName) {
          this.numbers.push(num);
          this.persistNumbers();
          
          const adapter = this.gateway?.getWhatsAppAdapter();
          if (adapter && 'addNumber' in adapter) {
            await (adapter as any).addNumber(num).catch((err: any) => {
              this.logger.error({ error: err.message }, 'Failed to add number to adapter');
            });
          }
          
          ws.send(JSON.stringify({ type: 'number:update', number: { ...num, status: 'disconnected' } }));
        }
        break;
      }

      case 'number:connect': {
        const connectId = msg.numberId || msg.id;
        const numToConnect = this.numbers.find(n => n.id === connectId);
        if (numToConnect) {
          numToConnect.enabled = true;
          this.persistNumbers();
          
          const adapter = this.gateway?.getWhatsAppAdapter();
          if (adapter && 'connectNumber' in adapter) {
            await (adapter as any).connectNumber(connectId).catch((err: any) => {
              this.logger.error({ error: err.message }, 'Failed to connect number adapter');
            });
          }
          
          this.logger.info({ numberId: connectId }, 'Number connected via dashboard');
        } else {
          ws.send(JSON.stringify({ type: 'error', error: `Number ${connectId} not found` }));
        }
        break;
      }

      case 'number:disconnect': {
        const disconnectId = msg.numberId || msg.id;
        const numToDisconnect = this.numbers.find(n => n.id === disconnectId);
        if (numToDisconnect) {
          numToDisconnect.enabled = false;
          this.persistNumbers();
          
          const adapter = this.gateway?.getWhatsAppAdapter();
          if (adapter && 'disconnectNumber' in adapter) {
            await (adapter as any).disconnectNumber(disconnectId).catch((err: any) => {
              this.logger.error({ error: err.message }, 'Failed to disconnect number adapter');
            });
          }
          
          this.logger.info({ numberId: disconnectId }, 'Number disconnected via dashboard');
        }
        break;
      }

      case 'number:remove': {
        const removeId = msg.numberId || msg.id;
        this.numbers = this.numbers.filter(n => n.id !== removeId);
        this.persistNumbers();
        
        const adapter = this.gateway?.getWhatsAppAdapter();
        if (adapter && 'removeNumber' in adapter) {
          await (adapter as any).removeNumber(removeId).catch((err: any) => {
            this.logger.error({ error: err.message }, 'Failed to remove number adapter');
          });
        }
        
        ws.send(JSON.stringify({ type: 'numbers:list', numbers: this.numbers }));
        this.logger.info({ numberId: removeId }, 'Number removed via dashboard');
        break;
      }

      // ── Approval Queue ────────────────────────────────────

      case 'get:approval-pending': {
        const pending = this.gateway?.getApprovalQueue().getPending() || [];
        ws.send(JSON.stringify({ type: 'approval:list', requests: pending }));
        break;
      }

      case 'approval:approve': {
        const { id, note } = msg;
        const ok = this.gateway?.getApprovalQueue().approve(id, 'dashboard', note) ?? false;
        ws.send(JSON.stringify({ type: 'approval:updated', id, status: ok ? 'approved' : 'not_found', note }));
        break;
      }

      case 'approval:reject': {
        const { id: rejId, reason } = msg;
        const ok = this.gateway?.getApprovalQueue().reject(rejId, 'dashboard', reason) ?? false;
        ws.send(JSON.stringify({ type: 'approval:updated', id: rejId, status: ok ? 'rejected' : 'not_found', reason }));
        break;
      }
    }
  }

  private setupRoutes(): void {
    // API routes
    this.app.use(express.json());

    // Get all contacts
    this.app.get('/api/contacts', (_req, res) => {
      res.json(this.db.getAllContacts());
    });

    // Get all chats
    this.app.get('/api/chats', (_req, res) => {
      res.json(this.db.getAllChats());
    });

    // Get messages for a chat
    this.app.get('/api/chats/:id/messages', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      res.json(this.db.getMessages(req.params.id, limit, offset));
    });

    // Get stats
    this.app.get('/api/stats', (req, res) => {
      const days = parseInt(req.query.days as string) || 7;
      res.json(this.db.getStats(days));
    });

    // Get broadcasts
    this.app.get('/api/broadcasts', (_req, res) => {
      res.json(this.db.getAllBroadcasts());
    });

    // ── Knowledge Base API ────────────────────────────────────

    // Get all KB entries (optional ?category= filter)
    this.app.get('/api/knowledge-base', (req, res) => {
      const category = req.query.category as string | undefined;
      res.json({ entries: category ? this.db.getAllKnowledgeEntries(category) : this.db.getAllKnowledgeEntries() });
    });

    // Get KB categories
    this.app.get('/api/knowledge-base/categories', (_req, res) => {
      res.json({ categories: this.db.getKnowledgeCategories() });
    });

    // Search KB
    this.app.get('/api/knowledge-base/search', (req, res) => {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      if (!query) {
        res.json({ results: [] });
        return;
      }
      const results = this.db.searchKnowledge(query, limit);
      res.json({ results });
    });

    // Create KB entry
    this.app.post('/api/knowledge-base', (req, res) => {
      const { category, question, answer, keywords, tags, priority } = req.body;
      if (!answer) {
        res.status(400).json({ error: 'Answer is required' });
        return;
      }
      const entry = {
        id: `kb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        category: category || 'general',
        question: question || '',
        answer,
        keywords: keywords || [],
        tags: tags || [],
        priority: priority || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.db.createKnowledgeEntry(entry);
      res.json({ success: true, entry });
    });

    // Update KB entry
    this.app.put('/api/knowledge-base', (req, res) => {
      const { id, category, question, answer, keywords, tags, priority } = req.body;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      const existing = this.db.getKnowledgeEntry(id);
      if (!existing) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }
      this.db.updateKnowledgeEntry(id, {
        category: category || existing.category,
        question: question !== undefined ? question : existing.question,
        answer: answer || existing.answer,
        keywords: keywords || existing.keywords,
        tags: tags || existing.tags,
        priority: priority !== undefined ? priority : existing.priority,
      });
      const updated = this.db.getKnowledgeEntry(id);
      res.json({ success: true, entry: updated });
    });

    // Delete KB entry
    this.app.delete('/api/knowledge-base/:id', (req, res) => {
      const id = req.params.id;
      const existing = this.db.getKnowledgeEntry(id);
      if (!existing) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }
      this.db.deleteKnowledgeEntry(id);
      res.json({ success: true });
    });

    // Get dynamic models from models.dev
    this.app.get('/api/models', async (_req, res) => {
      try {
        const models = await getAllModels();
        res.json({ models });
      } catch (err: any) {
        this.logger.error({ error: err.message }, 'Failed to fetch catalog models');
        res.status(500).json({ error: err.message });
      }
    });

    // Health check
    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    // ── File Manager API ──────────────────────────────────────
    const knowledgeDir = join(process.cwd(), 'knowledge');
    if (!existsSync(knowledgeDir)) mkdirSync(knowledgeDir, { recursive: true });

    // List files
    this.app.get('/api/files', (req, res) => {
      const subDir = (req.query.path as string) || '';
      const fullPath = join(knowledgeDir, subDir);
      if (!fullPath.startsWith(knowledgeDir)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      try {
        if (!existsSync(fullPath)) {
          res.json({ files: [] });
          return;
        }
        const entries = readdirSync(fullPath);
        const files = entries.map(name => {
          const entryPath = join(fullPath, name);
          const stat = statSync(entryPath);
          return {
            name,
            path: relative(knowledgeDir, entryPath),
            size: stat.size,
            isDirectory: stat.isDirectory(),
            extension: stat.isDirectory() ? undefined : name.split('.').pop(),
          };
        });
        res.json({ files });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Read file
    this.app.get('/api/files/read', (req, res) => {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Path is required' });
        return;
      }
      const fullPath = join(knowledgeDir, filePath);
      if (!fullPath.startsWith(knowledgeDir)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      try {
        if (!existsSync(fullPath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        const content = readFileSync(fullPath, 'utf-8');
        res.json({ path: filePath, content, size: Buffer.byteLength(content) });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Write file
    this.app.post('/api/files/write', (req, res) => {
      const { path: filePath, content } = req.body;
      if (!filePath || content === undefined) {
        res.status(400).json({ error: 'Path and content are required' });
        return;
      }
      const fullPath = join(knowledgeDir, filePath);
      if (!fullPath.startsWith(knowledgeDir)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      try {
        const dir = dirname(fullPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, content);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Delete file
    this.app.delete('/api/files', (req, res) => {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'Path is required' });
        return;
      }
      const fullPath = join(knowledgeDir, filePath);
      if (!fullPath.startsWith(knowledgeDir)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      try {
        if (!existsSync(fullPath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        unlinkSync(fullPath);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ── Approval Queue API ────────────────────────────────────

    this.app.get('/api/approval', (_req, res) => {
      const pending = this.gateway?.getApprovalQueue().getPending() || [];
      res.json({ actions: pending });
    });

    this.app.get('/api/approval/pending', (_req, res) => {
      const pending = this.gateway?.getApprovalQueue().getPending() || [];
      res.json({ actions: pending });
    });

    this.app.post('/api/approval/:id/approve', (req, res) => {
      const { id } = req.params;
      const note = req.body?.note || '';
      const ok = this.gateway?.getApprovalQueue().approve(id, 'dashboard', note) ?? false;
      res.json({ success: ok, id, action: 'approved', note });
    });

    this.app.post('/api/approval/:id/reject', (req, res) => {
      const { id } = req.params;
      const reason = req.body?.reason || '';
      const ok = this.gateway?.getApprovalQueue().reject(id, 'dashboard', reason) ?? false;
      res.json({ success: ok, id, action: 'rejected', reason });
    });

    // ── Settings API ───────────────────────────────────────────

    // Helper untuk convert TOON ke prompt string jika formatnya .toon
    const convertToonToPromptLocal = (toonObj: any): string => {
      const lines: string[] = [];
      if (toonObj.role) lines.push(`Role: ${toonObj.role}`);
      if (toonObj.language) lines.push(`Language: ${toonObj.language}`);
      if (toonObj.style) lines.push(`Style: ${toonObj.style}`);
      lines.push('');
      
      const sections: { [key: string]: string[] } = {
        'personality': toonObj.personality || [],
        'speaking-style': toonObj['speaking-style'] || [],
        'rules': toonObj.rules || [],
        'format': toonObj.format || [],
      };
      
      for (const [sectionName, items] of Object.entries(sections)) {
        if (items.length > 0) {
          const title = sectionName.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          lines.push(`## ${title}`);
          items.forEach((item: string) => lines.push(`- ${item}`));
          lines.push('');
        }
      }
      if (toonObj.reminder) lines.push(toonObj.reminder);
      return lines.join('\n');
    };

    this.app.get('/api/settings', (_req, res) => {
      const settingsPath = join(process.cwd(), 'config.jsonc');
      let configData = {};
      let systemPrompt = 'Kamu adalah customer service AI yang ramah dan profesional.';

      // 1. Baca config.jsonc
      try {
        if (existsSync(settingsPath)) {
          const raw = readFileSync(settingsPath, 'utf-8');
          const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
          configData = JSON.parse(cleaned);
        }
      } catch (err) {
        this.logger.warn({ error: err }, 'Failed to parse config.jsonc');
      }

      // 2. Baca system prompt
      try {
        const promptsDir = promptLoader.getPromptsDir();
        const toonPath = join(promptsDir, 'system.toon');
        const mdPath = join(promptsDir, 'system.md');

        if (existsSync(toonPath)) {
          try {
            const parsed = promptLoader.load('system.toon');
            if (parsed) {
              systemPrompt = convertToonToPromptLocal(parsed);
            } else {
              systemPrompt = readFileSync(toonPath, 'utf-8').trim();
            }
          } catch {
            systemPrompt = readFileSync(toonPath, 'utf-8').trim();
          }
        } else if (existsSync(mdPath)) {
          systemPrompt = readFileSync(mdPath, 'utf-8').trim();
        }
      } catch (err) {
        this.logger.warn({ error: err }, 'Failed to read system prompt');
      }

      res.json({
        config: configData,
        systemPrompt
      });
    });

    this.app.post('/api/settings', (req, res) => {
      const { config, systemPrompt } = req.body;
      const settingsPath = join(process.cwd(), 'config.jsonc');

      try {
        // 1. Tulis config.jsonc
        if (config) {
          writeFileSync(settingsPath, JSON.stringify(config, null, 2), 'utf-8');
        }

        // 2. Tulis system prompt ke system.md dan singkirkan system.toon lama
        if (systemPrompt !== undefined) {
          const promptsDir = promptLoader.getPromptsDir();
          const toonPath = join(promptsDir, 'system.toon');
          const mdPath = join(promptsDir, 'system.md');

          // Hapus atau backup system.toon agar system.md diprioritaskan oleh loader
          if (existsSync(toonPath)) {
            try {
              unlinkSync(toonPath);
            } catch {
              // Jika gagal hapus, rename saja
              const bakPath = join(promptsDir, 'system.toon.bak');
              writeFileSync(bakPath, readFileSync(toonPath));
              unlinkSync(toonPath);
            }
          }

          // Tulis prompt mentah ke system.md
          writeFileSync(mdPath, systemPrompt.trim(), 'utf-8');
          promptLoader.clearCache();
        }

        res.json({ success: true });

        // Memicu auto-restart proses setelah 1.5 detik agar respon terkirim ke klien lebih dahulu
        this.logger.info('Scheduling auto-restart in 1.5s to apply new settings...');
        setTimeout(() => {
          this.logger.info('Exiting process to let systemd restart the service...');
          process.exit(0);
        }, 1500);
      } catch (err: any) {
        this.logger.error({ error: err.message }, 'Failed to save settings');
        res.status(500).json({ error: err.message });
      }
    });

    // Serve static files in production
    const publicDir = resolve(__dirname, 'public');
    if (existsSync(publicDir)) {
      this.app.use(express.static(publicDir));

      // SPA fallback — gunakan regex agar kompatibel semua versi path-to-regexp
      this.app.get(/.*/, (_req, res) => {
        const indexPath = resolve(publicDir, 'index.html');
        if (existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).json({ error: 'Dashboard not built' });
        }
      });
    }
  }

  async start(port: number, host: string): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve) => {
      this.server.listen(port, host, () => {
        this.isRunning = true;
        this.logger.info(`Dashboard running at http://${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    // Close all WS connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => {
          this.isRunning = false;
          this.logger.info('Dashboard stopped');
          resolve();
        });
      });
    });
  }

  private loadNumbers(): void {
    try {
      const filePath = join(process.cwd(), 'data', 'numbers.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.numbers = Array.isArray(data) ? data : [];
        this.logger.info('Loaded %d number configs', this.numbers.length);
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to load numbers config');
    }
  }

  private persistNumbers(): void {
    try {
      const dir = join(process.cwd(), 'data');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'numbers.json'), JSON.stringify(this.numbers, null, 2));
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to persist numbers');
    }
  }

  getNumbers(): WhatsAppNumberConfig[] {
    return this.numbers;
  }

  setGateway(gateway: Gateway): void {
    this.gateway = gateway;
  }

  broadcast(event: GatewayEvent): void {
    // Track human-active chats
    if (event.type === 'human:active') {
      this.humanActiveChats.add(event.chatId);
    } else if (event.type === 'human:inactive') {
      this.humanActiveChats.delete(event.chatId);
    }

    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}
