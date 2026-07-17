import { ToolDefinition, ToolContext, WAgentConfig, KnowledgeSearchResult } from '../types.js';
import { EscalationService } from '../services/escalation.js';
import { EmbeddingService } from '../rag/embeddings.js';
import { SafeShell } from './safe-shell.js';
import { HTTPClient } from '../utils/http-client.js';
import { FileManager } from '../rag/file-manager.js';
import { WebScraper } from '../rag/web-scraper.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getLogger } from '../utils/logger.js';

function updateEnvFile(vars: Record<string, string>): void {
  const envPath = join(process.cwd(), '.env');
  let content = '';
  if (existsSync(envPath)) {
    content = readFileSync(envPath, 'utf-8');
  }
  
  const lines = content.split('\n');
  for (const [key, val] of Object.entries(vars)) {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith(`${key}=`)) {
        lines[i] = `${key}=${val}`;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(`${key}=${val}`);
    }
  }
  
  writeFileSync(envPath, lines.join('\n'), 'utf-8');
}

export function createBuiltInTools(config: WAgentConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'install_custom_skill',
      description: 'Instal skill (plugin/tool) baru secara dinamis untuk AI Agent. Tool ini akan menulis file JavaScript berisi kode skill ke direktori "skills/" di server, mengkonfigurasi kredensial (API keys) di file .env, dan me-restart bot untuk mengaktifkan skill baru tersebut.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Nama modul skill dalam format lowercase alphanumeric dan dashes (contoh: "rajaongkir" atau "pos-connector")',
          },
          code: {
            type: 'string',
            description: 'String JavaScript valid lengkap untuk modul skill. Kode harus memiliki "export default function create...Skill()" yang mereturn object berisi manifest dan tools.',
          },
          envVars: {
            type: 'object',
            description: 'Object key-value berisi environment variables / credentials (API keys) baru yang ingin disimpan ke file .env. Biarkan kosong jika tidak membutuhkan kredensial baru.',
            additionalProperties: {
              type: 'string'
            }
          }
        },
        required: ['name', 'code'],
      },
      handler: async (args: Record<string, unknown>) => {
        const name = String(args.name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const code = String(args.code);
        const envVars = (args.envVars || {}) as Record<string, string>;

        if (!name) {
          return JSON.stringify({ success: false, error: 'Nama skill tidak valid.' });
        }

        try {
          const skillsDir = join(process.cwd(), 'skills');
          if (!existsSync(skillsDir)) {
            mkdirSync(skillsDir, { recursive: true });
          }

          // Tulis file skill JS
          const filePath = join(skillsDir, `${name}.js`);
          writeFileSync(filePath, code, 'utf-8');

          // Tulis env variables jika ada
          if (Object.keys(envVars).length > 0) {
            updateEnvFile(envVars);
          }

          // Jadwalkan restart asinkron agar respon bisa dikirim dulu ke user sebelum shutdown
          setTimeout(() => {
            getLogger().info({ skillName: name }, 'Skill installed. Requesting process restart...');
            process.exit(0); // systemd/daemon akan me-restart program secara otomatis
          }, 1500);

          return JSON.stringify({
            success: true,
            message: `Skill "${name}" berhasil diinstal ke ${filePath}. Bot akan otomatis restart dalam 1.5 detik untuk mengaktifkannya.`,
          });

        } catch (err: any) {
          return JSON.stringify({ success: false, error: err.message });
        }
      },
    },

    {
      name: 'get_customer_info',
      description: 'Dapatkan informasi customer berdasarkan nomor atau nama',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nama atau nomor customer' },
        },
        required: ['query'],
      },
      handler: async (args: Record<string, unknown>, context: ToolContext) => {
        const query = String(args.query);
        const contact = context.db.searchContacts(query);
        if (contact.length === 0) {
          return JSON.stringify({ found: false, message: 'Customer tidak ditemukan' });
        }
        return JSON.stringify({ found: true, customer: contact[0] });
      },
    },

    {
      name: 'get_conversation_history',
      description: 'Dapatkan riwayat percakapan dengan customer tertentu',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'ID kontak customer' },
          limit: { type: 'number', description: 'Jumlah pesan terakhir (default: 10)' },
        },
        required: ['contactId'],
      },
      handler: async (args: Record<string, unknown>, context: ToolContext) => {
        const contactId = String(args.contactId);
        const limit = Number(args.limit) || 10;
        const messages = context.db.getMessages(contactId, limit);
        return JSON.stringify({ messages: messages.map((m: any) => ({
          from: m.fromMe ? 'bot' : 'customer',
          content: m.content,
          time: m.timestamp,
        })) });
      },
    },

    {
      name: 'get_current_time',
      description: 'Dapatkan waktu dan tanggal saat ini',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      },
    },

    {
      name: 'add_note',
      description: 'Tambahkan catatan ke customer tertentu',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'ID kontak customer' },
          note: { type: 'string', description: 'Catatan yang ingin ditambahkan' },
        },
        required: ['contactId', 'note'],
      },
      handler: async (args: Record<string, unknown>, context: ToolContext) => {
        const contactId = String(args.contactId);
        const note = String(args.note);
        const contact = context.db.getContact(contactId);

        if (!contact) {
          return JSON.stringify({ success: false, message: 'Customer tidak ditemukan' });
        }

        const existingNotes = contact.notes || '';
        const updatedNotes = existingNotes
          ? `${existingNotes}\n[${new Date().toLocaleDateString('id-ID')}] ${note}`
          : `[${new Date().toLocaleDateString('id-ID')}] ${note}`;

        context.db.saveContact({ ...contact, notes: updatedNotes });
        return JSON.stringify({ success: true, message: 'Catatan berhasil ditambahkan' });
      },
    },

    {
      name: 'get_customer_tags',
      description: 'Dapatkan daftar tags/label dari customer',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'ID kontak customer' },
        },
        required: ['contactId'],
      },
      handler: async (args: Record<string, unknown>, context: ToolContext) => {
        const contactId = String(args.contactId);
        const contact = context.db.getContact(contactId);
        if (!contact) {
          return JSON.stringify({ found: false, message: 'Customer tidak ditemukan' });
        }
        return JSON.stringify({ tags: contact.tags || [] });
      },
    },

    {
      name: 'search_knowledge_base',
      description: 'Cari informasi dari knowledge base / FAQ. Menggunakan semantic search (AI embeddings) untuk menemukan informasi yang paling relevan. Gunakan untuk menjawab pertanyaan tentang produk, layanan, kebijakan, harga, jam operasional, dan informasi bisnis lainnya.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Kata kunci atau pertanyaan yang ingin dicari' },
          category: { type: 'string', description: 'Filter berdasarkan kategori (optional)' },
          maxResults: { type: 'number', description: 'Jumlah hasil maksimal (default: 3)' },
        },
        required: ['query'],
      },
      handler: async (args: Record<string, unknown>, context: ToolContext) => {
        const query = String(args.query);
        const maxResults = Number(args.maxResults) || 3;
        const category = args.category ? String(args.category) : undefined;

        let results: KnowledgeSearchResult[] = [];

        // Search legacy knowledge entries (FAQ)
        try {
          const embedder = new EmbeddingService(context.config);
          const queryEmbedding = await embedder.generateEmbedding(query);

          if (queryEmbedding) {
            results = context.db.searchKnowledgeSemantic(queryEmbedding, maxResults * 2, 0.3);
          } else {
            results = context.db.searchKnowledge(query, maxResults * 2);
          }
        } catch {
          results = context.db.searchKnowledge(query, maxResults * 2);
        }

        // Filter by category if specified
        if (category) {
          results = results.filter(r => r.entry.category === category);
        }

        // Also search file-based knowledge chunks
        let kbChunks: Array<{ content: string; score: number; fileName?: string; sectionHeading?: string }> = [];
        if (context.knowledgeStore) {
          try {
            const chunkResults = await context.knowledgeStore.search(query, maxResults, 0.3);
            kbChunks = chunkResults.map((r: any) => ({
              content: r.content,
              score: r.score,
              fileName: r.fileName,
              sectionHeading: r.sectionHeading,
            }));
          } catch {
            // KB search failed, continue with legacy results only
          }
        }

        // Enhance results with semantic search context marker
        const hasSemantic = results.some(r => r.matchedOn === 'semantic');

        if (results.length === 0 && kbChunks.length === 0) {
          return JSON.stringify({
            found: false,
            message: 'Tidak ada informasi yang cocok dengan pertanyaan tersebut',
            suggestion: 'Coba gunakan kata kunci yang berbeda',
          });
        }

        return JSON.stringify({
          found: true,
          total: results.length + kbChunks.length,
          searchMethod: hasSemantic ? 'semantic' : 'keyword',
          results: [
            ...results.slice(0, maxResults).map(r => ({
              question: r.entry.question,
              answer: r.entry.answer,
              category: r.entry.category,
              relevance: Math.round(r.score * 100) + '%',
              source: 'knowledge_base',
            })),
            ...kbChunks.slice(0, maxResults).map(r => ({
              content: r.content,
              fileName: r.fileName,
              sectionHeading: r.sectionHeading,
              relevance: Math.round(r.score * 100) + '%',
              source: 'file',
            })),
          ],
        });
      },
    },
  ];

  // ── E-commerce Tools ──────────────────────────────────────

  tools.push({
    name: 'lookup_order',
    description: 'Cari informasi pesanan customer berdasarkan nomor pesanan atau ID',
    parameters: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string', description: 'Nomor pesanan (contoh: ORD-2024-001)' },
      },
      required: ['orderNumber'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
      const orderNumber = String(args.orderNumber);

      // Search by order number
      const results = context.db.searchOrders(orderNumber, 5);
      if (results.length === 0) {
        return JSON.stringify({ found: false, message: 'Pesanan tidak ditemukan' });
      }

      const order = results[0];
      return JSON.stringify({
        found: true,
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          items: order.items,
          totalAmount: order.totalAmount,
          currency: order.currency,
          createdAt: order.createdAt,
        },
      });
    },
  });

  tools.push({
    name: 'check_stock',
    description: 'Cek ketersediaan produk atau stok barang',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nama produk atau kata kunci pencarian' },
        category: { type: 'string', description: 'Filter berdasarkan kategori (optional)' },
      },
      required: ['query'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
      const query = String(args.query);
      const results = context.db.searchProducts(query, 10);

      if (results.length === 0) {
        return JSON.stringify({ found: false, message: 'Produk tidak ditemukan' });
      }

      return JSON.stringify({
        found: true,
        total: results.length,
        products: results.map((p: any) => ({
          name: p.name,
          price: p.price,
          currency: p.currency,
          stock: p.stock,
          inStock: p.stock > 0,
          category: p.category,
        })),
      });
    },
  });

  // ── Communication Tools ───────────────────────────────────

  tools.push({
    name: 'send_message',
    description: 'Kirim pesan WhatsApp ke customer. Gunakan untuk follow-up, konfirmasi, atau informasi tambahan.',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'ID kontak tujuan (opsional, default: kontak saat ini)' },
        message: { type: 'string', description: 'Isi pesan yang akan dikirim' },
      },
      required: ['message'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
      const message = String(args.message);
      const contactId = args.contactId ? String(args.contactId) : context.contactId;

      // Queue message to be sent after AI response
      if (context.pendingMessages) {
        context.pendingMessages.push({
          to: contactId,
          content: message,
          type: 'text',
        });
      }

      return JSON.stringify({
        success: true,
        contactId,
        message,
        queued: true,
      });
    },
  });

  tools.push({
    name: 'send_image',
    description: 'Kirim gambar via WhatsApp ke customer',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'ID kontak tujuan (opsional)' },
        imageUrl: { type: 'string', description: 'URL gambar atau path file' },
        caption: { type: 'string', description: 'Caption untuk gambar' },
      },
      required: ['imageUrl'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
      const imageUrl = String(args.imageUrl);
      const caption = args.caption ? String(args.caption) : '';
      const contactId = args.contactId ? String(args.contactId) : context.contactId;

      // Queue image to be sent after AI response
      if (context.pendingMessages) {
        context.pendingMessages.push({
          to: contactId,
          content: caption,
          type: 'image',
          imageUrl,
        });
      }

      return JSON.stringify({
        success: true,
        contactId,
        imageUrl,
        caption,
        queued: true,
      });
    },
  });

  // ── Reminder Tool ─────────────────────────────────────────

  tools.push({
    name: 'create_reminder',
    description: 'Buat reminder atau pengingat untuk customer',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Isi reminder' },
        datetime: { type: 'string', description: 'Waktu reminder (ISO 8601 atau "besok jam 10")' },
        contactId: { type: 'string', description: 'ID kontak tujuan (opsional)' },
      },
      required: ['message', 'datetime'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
      const message = String(args.message);
      const datetime = String(args.datetime);
      const contactId = args.contactId ? String(args.contactId) : context.contactId;

      // Parse datetime
      let scheduledAt: Date;
      try {
        scheduledAt = new Date(datetime);
        if (isNaN(scheduledAt.getTime())) {
          // Try parsing Indonesian relative time
          const now = new Date();
          if (/besok/i.test(datetime)) {
            const match = datetime.match(/jam\s+(\d+)/i);
            const hour = match ? parseInt(match[1]) : 9;
            scheduledAt = new Date(now);
            scheduledAt.setDate(scheduledAt.getDate() + 1);
            scheduledAt.setHours(hour, 0, 0, 0);
          } else {
            scheduledAt = new Date(Date.now() + 60 * 60 * 1000); // Default: 1 hour from now
          }
        }
      } catch {
        scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
      }

      // Create scheduled message in DB
      const id = `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      context.db.createScheduledMessage({
        id,
        contactId,
        contactName: contactId,
        content: message,
        scheduledAt,
        repeat: 'none',
        status: 'pending',
        sentCount: 0,
        failedCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return JSON.stringify({
        success: true,
        id,
        contactId,
        message,
        scheduledAt: scheduledAt.toISOString(),
        note: 'Reminder dijadwalkan dan akan dikirim otomatis',
      });
    },
  });

  // ── Escalation Tool ───────────────────────────────────────
  tools.push({
    name: 'escalate_to_human',
    description: 'MINTA BANTUAN MANUSIA. Gunakan tool ini jika kamu tidak bisa menjawab pertanyaan customer, tidak yakin dengan jawaban, atau customer meminta bicara dengan manusia. Fungsi ini akan mengirim notifikasi ke tim CS via Telegram.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Alasan kenapa perlu bantuan manusia' },
        customerQuestion: { type: 'string', description: 'Pertanyaan atau keluhan customer yang tidak bisa dijawab' },
      },
      required: ['reason', 'customerQuestion'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
      const reason = String(args.reason || 'Tidak dapat menjawab');
      const customerQuestion = String(args.customerQuestion || '');

      const escalationService = new EscalationService(context.config);
      const sent = await escalationService.escalateSimple(
        context.contactId,
        context.contactId, // contactName from context
        customerQuestion,
        reason
      );

      if (sent) {
        return JSON.stringify({
          escalated: true,
          message: 'Pertanyaan ini sudah diteruskan ke tim CS melalui Telegram. Tim kami akan segera membantu. Mohon tunggu ya! 🙏',
        });
      }

      return JSON.stringify({
        escalated: false,
        message: 'Maaf, sedang tidak bisa menghubungi tim CS. Silakan coba lagi nanti atau hubungi kami di jam kerja. 🙏',
      });
    },
  });

  // ── Advanced Tools (v2.0) ─────────────────────────────────

  // Safe Shell
  const safeShell = new SafeShell();
  tools.push({
    name: 'safe_shell',
    description: 'Jalankan command shell yang aman (whitelist). Hanya command tertentu yang diizinkan: date, echo, ls, cat, grep, head, tail, wc, jq. Gunakan untuk membaca file atau menjalankan command sederhana.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command shell yang akan dijalankan' },
      },
      required: ['command'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const command = String(args.command);
        const result = await safeShell.execute(command);
        return JSON.stringify({
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      } catch (err: any) {
        return JSON.stringify({ success: false, stderr: err.message, exitCode: 1 });
      }
    },
  });

  // HTTP Client
  const httpClient = new HTTPClient({
    allowedDomains: config.http?.allowedDomains || [],
    blockedDomains: ['localhost', '127.0.0.1', '0.0.0.0'],
  });
  tools.push({
    name: 'http_request',
    description: 'Kirim HTTP request ke URL yang diizinkan. Gunakan untuk mengambil data dari API atau website. Domain harus di-whitelist.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL tujuan' },
        method: { type: 'string', description: 'HTTP method (GET/POST), default: GET' },
        body: { type: 'string', description: 'Request body untuk POST (JSON string)' },
      },
      required: ['url'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const url = String(args.url);
        const method = (args.method ? String(args.method) : 'GET').toUpperCase();
        let body: unknown;
        if (args.body) {
          try {
            body = JSON.parse(String(args.body));
          } catch {
            return JSON.stringify({ success: false, status: 0, body: 'Invalid JSON in body' });
          }
        }

        let response;
        if (method === 'POST') {
          response = await httpClient.post(url, body);
        } else {
          response = await httpClient.get(url);
        }

        return JSON.stringify({
          success: response.ok,
          status: response.status,
          body: response.body.slice(0, 5000),
        });
      } catch (err: any) {
        return JSON.stringify({ success: false, status: 0, body: err.message });
      }
    },
  });

  // File Manager
  const fileManager = new FileManager({
    baseDir: config.knowledgeDir || join(homedir(), '.wagent', 'knowledge'),
  });
  tools.push({
    name: 'file_read',
    description: 'Baca isi file dari direktori yang diizinkan (knowledge, uploads). Gunakan untuk membaca dokumen, catatan, atau data.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file (relatif dari base directory)' },
      },
      required: ['path'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const path = String(args.path);
        const file = await fileManager.read(path);

        if (!file) {
          return JSON.stringify({ found: false, message: 'File tidak ditemukan' });
        }

        return JSON.stringify({
          found: true,
          path: file.path,
          content: file.content.slice(0, 10000),
          size: file.size,
        });
      } catch (err: any) {
        return JSON.stringify({ found: false, message: err.message });
      }
    },
  });

  tools.push({
    name: 'file_write',
    description: 'Tulis atau update file di direktori yang diizinkan. Gunakan untuk menyimpan catatan, data, atau dokumen.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path file (relatif dari base directory)' },
        content: { type: 'string', description: 'Isi file' },
      },
      required: ['path', 'content'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const path = String(args.path);
        const content = String(args.content);
        const success = await fileManager.write(path, content);

        return JSON.stringify({
          success,
          message: success ? 'File berhasil ditulis' : 'Gagal menulis file',
        });
      } catch (err: any) {
        return JSON.stringify({ success: false, message: err.message });
      }
    },
  });

  tools.push({
    name: 'file_list',
    description: 'Daftar file di direktori. Gunakan untuk melihat file yang tersedia.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path direktori (default: root)' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const path = args.path ? String(args.path) : '.';
        const files = await fileManager.list(path);

        return JSON.stringify({
          files: files.map(f => ({
            name: f.name,
            path: f.path,
            size: f.size,
            isDirectory: f.isDirectory,
            extension: f.extension,
          })),
        });
      } catch (err: any) {
        return JSON.stringify({ files: [], error: err.message });
      }
    },
  });

  // Web Scraper
  const webScraper = new WebScraper({
    http: {
      allowedDomains: config.http?.allowedDomains || [],
    },
  });
  tools.push({
    name: 'web_scrape',
    description: 'Ambil konten dari website. Gunakan untuk mendapatkan informasi dari halaman web, artikel, atau dokumentasi online.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL halaman web' },
      },
      required: ['url'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const url = String(args.url);
        const content = await webScraper.scrape(url);

        if (!content) {
          return JSON.stringify({ success: false, message: 'Gagal mengambil konten' });
        }

        return JSON.stringify({
          success: true,
          title: content.title,
          description: content.description,
          content: content.content.slice(0, 5000),
          links: content.links.slice(0, 10),
        });
      } catch (err: any) {
        return JSON.stringify({ success: false, message: err.message });
      }
    },
  });

  return tools;
}
