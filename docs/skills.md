# 🧩 Skills / Plugin System — WAGENT

Dokumentasi tentang plugin system untuk menambah kemampuan AI agent.

---

## 📖 Apa Itu Skills?

Skills adalah plugin yang menambah **tools** baru untuk AI Agent. Setiap skill bisa menyediakan satu atau lebih tool yang bisa dipanggil oleh AI secara otonom.

**Use case:**
- 🔌 Cek status pesanan dari API eksternal
- 💰 Cek saldo customer dari database
- 📦 Tracking pengiriman via API jasa ekspedisi
- 🎫 Buat tiket support di system eksternal
- 🌤️ Cek cuaca / info publik

**Tanpa Skills:** AI hanya punya 12 built-in tools  
**Dengan Skills:** AI bisa akses API apapun yang kamu sediakan

---

## 📁 Struktur Skills

Skills disimpan sebagai file `.js` atau `.mjs` di folder `skills/` di root project:

```
project/
├── skills/
│   ├── cek-resi.js
│   ├── cek-saldo.mjs
│   └── tiket-support.js
├── packages/
└── ...
```

Setiap skill file harus memiliki **default export** berupa function factory:

```typescript
// SkillFactory type
type SkillFactory = () => SkillDefinition | Promise<SkillDefinition>;

interface SkillDefinition {
  manifest: SkillManifest;
  tools: ToolDefinition[];
}

interface SkillManifest {
  name: string;        // Nama skill (unique)
  version: string;     // SemVer (e.g., "1.0.0")
  description: string; // Deskripsi singkat
  author?: string;     // Optional
  systemPromptAdditions?: string; // Optional: tambahan ke system prompt
}
```

---

## 🛠️ Membuat Skill Pertama

### Contoh: Cek Resi Pengiriman

Buat file `skills/cek-resi.js`:

```javascript
// skills/cek-resi.js
export default function cekResiSkill() {
  return {
    manifest: {
      name: 'cek-resi',
      version: '1.0.0',
      description: 'Cek status pengiriman berdasarkan nomor resi',
      author: 'Tim CS',
    },
    tools: [
      {
        name: 'cek_resi',
        description: 'Cek status pengiriman berdasarkan nomor resi. Gunakan ketika customer menanyakan status pengiriman pesanannya.',
        parameters: {
          type: 'object',
          properties: {
            resi: {
              type: 'string',
              description: 'Nomor resi pengiriman',
            },
            kurir: {
              type: 'string',
              description: 'Nama kurir (JNE, JNT, Sicepat, dll)',
              enum: ['JNE', 'J&T', 'Sicepat', 'Pos Indonesia'],
            },
          },
          required: ['resi'],
        },
        handler: async (args, context) => {
          const resi = String(args.resi);
          const kurir = String(args.kurir || 'JNE');

          try {
            // Panggil API tracking (contoh)
            const response = await fetch(
              `https://api.example.com/tracking?resi=${resi}&kurir=${kurir}`
            );
            const data = await response.json();

            if (!data.found) {
              return JSON.stringify({
                found: false,
                message: `Resi ${resi} (${kurir}) tidak ditemukan.`,
              });
            }

            return JSON.stringify({
              found: true,
              status: data.status,
              estimasi: data.estimated_delivery,
              riwayat: data.history.slice(0, 5),
            });
          } catch (err) {
            return JSON.stringify({
              found: false,
              message: `Gagal cek resi: ${err.message}`,
            });
          }
        },
      },
    ],
  };
}
```

### Contoh: Custom System Prompt

Skill juga bisa menambah system prompt untuk memberi konteks ke AI:

```javascript
export default function tokoElektronikSkill() {
  return {
    manifest: {
      name: 'toko-elektronik',
      version: '1.0.0',
      description: 'Informasi produk toko elektronik',
      systemPromptAdditions: `
- Stok produk tersedia di database
- Garansi resmi 1 tahun untuk semua produk elektronik
- Free ongkir untuk pembelian di atas Rp500.000
      `,
    },
    tools: [
      {
        name: 'cek_stok_produk',
        description: 'Cek ketersediaan stok produk',
        parameters: {
          type: 'object',
          properties: {
            produkId: { type: 'string', description: 'ID produk' },
          },
          required: ['produkId'],
        },
        handler: async (args, context) => {
          // Logic cek stok
          return JSON.stringify({ tersedia: true, stok: 10 });
        },
      },
    ],
  };
}
```

---

## 📦 Tool Definition

Setiap tool dalam skill harus mengikuti interface `ToolDefinition`:

```typescript
interface ToolDefinition {
  name: string;        // Nama tool (underscore_case, unique)
  description: string; // Deskripsi — penting! AI membaca ini untuk memutuskan
                       // kapan harus memanggil tool
  parameters: {        // JSON Schema untuk parameter
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

interface ToolContext {
  logger: Logger;           // Pino logger (child module)
  db: Database;             // Akses ke SQLite database
  config: WAGENTConfig;     // Konfigurasi saat ini
  contactId: string;        // JID customer yang sedang chat
}
```

### Penting!

1. **`description`** harus jelas — AI membaca ini untuk memutuskan kapan memanggil tool
2. **`handler` harus return string** — biasanya JSON string yang akan dibaca AI
3. **Jangan throw error** di handler — selalu catch dan return error message sebagai string
4. **Gunakan `context.logger`** untuk logging — jangan `console.log`

---

## 📟 CLI Commands

### Lihat Skills Terinstall

```bash
wagent skill list
```

Output:
```
🧩 WAGENT Skills
──────────────────────────
  cek-resi v1.0.0
    Cek status pengiriman berdasarkan nomor resi
    Tools: cek_resi

  toko-elektronik v1.0.0
    Informasi produk toko elektronik
    Tools: cek_stok_produk

  Total: 2 skill, 2 tools
```

### Install Skill

```bash
wagent skill install ./path/to/my-skill.js
```

Skill akan di-copy ke folder `skills/` dengan prefix `skill-{timestamp}.js`.

### Hapus Skill

```bash
wagent skill remove cek-resi
```

---

## 🔄 Lifecycle

### Startup

```
Gateway.start()
  → SkillLoader.loadAll()
    → Scan folder skills/ untuk file .js/.mjs
    → Import setiap file
    → Validasi manifest & tools
    → Register skill ke internal Map
  → Gateway constructor
    → Pass extra tools ke Agent
    → Agent menggabungkan built-in tools + skill tools
```

### Runtime

```
AI memproses pesan customer
  → AI memutuskan perlu tool
  → Cari tool di [built-in, ...skill tools]
  → Jalankan handler dengan context
  → Hasil dikembalikan ke AI untuk diproses lebih lanjut
```

### Hot Reload

Skills bisa di-reload tanpa restart Gateway:

```typescript
// Di SkillLoader
async reloadSkill(name: string): Promise<boolean> {
  // Hapus dari cache
  this.skills.delete(name);
  // Import ulang dengan cache-busting (?t=timestamp)
  const module = await import(`${filePath}?t=${Date.now()}`);
  // Validasi & register ulang
}
```

> **Catatan:** Hot reload belum di-expose via CLI, tapi tersedia di API internal.

---

## 📊 Best Practices

### 1. Naming Convention
- **Skill files:** `kebab-case.js` (e.g., `cek-resi.js`)
- **Tool names:** `snake_case` (e.g., `cek_resi`)
- **Unique tool names** — jangan sama dengan built-in tools

### 2. Error Handling
```javascript
handler: async (args, context) => {
  try {
    // Logic
    return JSON.stringify({ success: true, data: result });
  } catch (err) {
    context.logger.error({ error: err.message }, 'Tool failed');
    return JSON.stringify({
      success: false,
      message: 'Gagal memproses: ' + err.message,
    });
  }
}
```

### 3. Rate Limiting API Eksternal
Jika skill memanggil API eksternal, implementasikan rate limiting sendiri:

```javascript
const rateLimit = new Map();
const MAX_CALLS = 10;
const WINDOW_MS = 60_000;

handler: async (args, context) => {
  const now = Date.now();
  const calls = rateLimit.get(context.contactId) || [];
  const recent = calls.filter(t => now - t < WINDOW_MS);

  if (recent.length >= MAX_CALLS) {
    return JSON.stringify({ error: 'Too many requests. Please try again later.' });
  }

  recent.push(now);
  rateLimit.set(context.contactId, recent);

  // Proceed with API call...
}
```

### 4. Testing Skill
Buat file test terpisah untuk skill kamu:

```javascript
// tests/cek-resi.test.js
import cekResiSkill from '../skills/cek-resi.js';

const skill = await cekResiSkill();
const tool = skill.tools.find(t => t.name === 'cek_resi');

const result = await tool.handler(
  { resi: 'JP1234567890', kurir: 'JNE' },
  { logger: console, db: mockDb, config: mockConfig, contactId: 'test' }
);

const parsed = JSON.parse(result);
console.assert(parsed.found === true, 'Should find resi');
```

### 5. Performance
- Skill handler harus **cepat** (<5 detik) — AI menunggu hasilnya
- Fetch timeout: set timeout untuk API calls
- Cache results jika memungkinkan
- Jangan blocking — gunakan async/await

---

## Troubleshooting

### Skill Tidak Terload
```bash
# Cek folder skills ada?
ls skills/

# Cek apakah file .js/.mjs valid?
node skills/my-skill.js

# Cek log
wagent log -n 20 | grep skill
```

### Tool Tidak Dipanggil AI
- **Deskripsi tool kurang jelas** — perbaiki description
- **Nama tool tidak intuitif** — gunakan nama yang jelas
- **Parameter terlalu kompleks** — sederhanakan

### Error "Unknown tool"
- Tool name typo di handler vs definition
- Skill gagal load (cek log untuk error)
- Nama tool conflict dengan built-in tool
