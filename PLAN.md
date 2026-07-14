# WAGENT v2 — WhatsApp Agent Plan

> WhatsApp AI Agent yang bisa jadi personal assistant atau business CS,
> dengan kemampuan proactive messaging, per-contact style, dan adaptive learning.
>
> **v1.0 (dasar) sudah selesai — 620 tests, ~83% coverage, 54 file sumber.**
> **Sekarang: Planning v2.0 — evolusi dari CS Bot jadi Personal Assistant.**

---

## 📊 Current v1.0 State — Sudah Siap

Sebelum membangun v2, berikut **fondasi yang sudah siap** dari v1.0:

### ✅ Sudah Ada (Tidak perlu dibangun ulang)

| Komponen | File | Kesiapan |
|:---------|:-----|:--------:|
| **Gateway** | `gateway.ts` | Message routing, event loop, lifecycle (start/stop) |
| **Agent Runtime** | `agent.ts` | AI loop dengan tool execution (4 provider, max 10 iterasi) |
| **Tool System** | `tools.ts` + `skill-loader.ts` | 12 built-in tools + plugin system (.js/.mjs) |
| **WhatsApp Adapter** | `client.ts` (whatsapp) | Full Baileys: connect, QR, messages, presence, audio, contacts |
| **Multi-Number** | `multi-adapter.ts` | Composite adapter + JID routing table |
| **Database** | `storage.ts` | SQLite: contacts, chats, messages, conversations, KB, broadcasts, scheduled, stats |
| **Knowledge Base** | `storage.ts` (KB methods) | CRUD + keyword search + semantic search (RAG) |
| **Embedding** | `embeddings.ts` | Gemini text-embedding-004 (768d) + cosine similarity |
| **Scheduler** | `scheduler.ts` | Cron messaging (30s check interval, daily/weekly/monthly) |
| **Transcriber** | `transcriber.ts` | Voice-to-text via Whisper / Gemini |
| **Escalation** | `escalation.ts` | Telegram Bot API + HTML formatting + dedup 60s |
| **Event Bus** | `event-bus.ts` | Pub/sub dengan wildcard handlers |
| **Crypto** | `crypto.ts` | AES-256-GCM: file, directory, .env, auto-decrypt |
| **Logger** | `logger.ts` | Pino structured logging |
| **Dashboard** | 8 halaman React + Express + WS | Chat, Contacts, KB, Analytics, Broadcast, Schedule, Numbers, Settings |
| **CLI** | `index.ts` (cli) | 30+ commands: init, start, kb, crypto, number, escalation, skill, log |
| **TUI** | `setup.ts` | Setup wizard interaktif (@clack/prompts) |
| **CI** | `.github/workflows/ci.yml` | GitHub Actions, Node 18/20/22, matrix, coverage |
| **Docs** | 12 file dokumentasi | PRD, README, docs/ — getting-started, config, architecture, dll |
| **Tests** | 575 unit tests | ~83% lines, ~80% branches |

### Coverage Detail

| File | Lines | Branches |
|:-----|:-----:|:--------:|
| escalation.ts | 100% | 95% |
| crypto.ts | 100% | 93% |
| config.ts | 100% | 100% |
| logger.ts | 100% | — |
| multi-number.ts | 98.71% | 85% |
| skill-loader.ts | 97.46% | 82% |
| agent.ts | 96.87% | 89% |
| transcriber.ts | 95.65% | 80% |
| scheduler.ts | 93.22% | 60% |
| multi-adapter.ts | 90.29% | 64% |
| storage.ts | 89.36% | 76% |
| gateway.ts | 86.47% | 78% |
| event-bus.ts | 80% | 75% |

---

## 🎯 Konsep Inti v2

- **Personal Assistant**: Bantu urusan pribadi (reminder, info, follow-up)
- **Business CS**: Layani customer, jawab FAQ, handle keluhan
- **Proactive**: Bisa chat duluan ke kontak (dengan izin user)
- **Adaptive**: Belajar gaya bicara user, jadi "clone" komunikasi
- **Per-Contact Style**: Gaya berbeda ke orang berbeda (formal ke bos, casual ke teman)
- **Control Plane**: Kelola agent via Telegram, Dashboard, atau WA Self-Chat

---

## 🏛️ Arsitektur v2

```
┌─────────────────────────────────────────────────────────┐
│                   User Control Plane                     │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Telegram │  │   Web    │  │   WA     │              │
│  │   Bot    │  │Dashboard │  │Self-Chat │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│       └──────────────┼──────────────┘                    │
│                      ↓                                   │
│              ┌───────────────┐                           │
│              │    Gateway    │ ← Single process          │
│              │   (v1 siap ✅)│                           │
│              └───────────────┘                           │
│                      │                                   │
│  ┌───────────────────┼───────────────────┐              │
│  │                   │                   │              │
│  ↓                   ↓                   ↓              │
│ ┌─────────┐    ┌──────────┐    ┌─────────────┐         │
│ │WhatsApp │    │  Agent   │    │   Memory    │         │
│ │ Adapter │────│ Runtime  │────│   System    │ ← BARU  │
│ │(v1 siap✅)│  │(refactor)│    └─────────────┘         │
│ └─────────┘    └──────────┘    ┌─────────────┐         │
│                      │         │ Knowledge   │         │
│              ┌───────┴───────┐ │   Store     │         │
│              │     Tools     │ │ ← ENHANCE   │         │
│              │ (v1 siap +    │ └─────────────┘         │
│              │  tool sandbox)│                          │
│              └───────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

---

## 🧩 Gap Analysis — v1.0 vs v2.0

### ✅ Ready from v1.0 → v2.0

| v2 Component | Status | Action Needed |
|:-------------|:------:|:--------------|
| **Gateway** | ✅ Siap | Minor: tambah proactive hooks |
| **WhatsApp Adapter** | ✅ Siap | Minor: tambah self-chat detection |
| **Tool System** | ✅ Siap | Tambah sandbox wrapper |
| **Scheduler** | ✅ Siap | Extend untuk proactive actions |
| **Database** | ✅ Siap | Tambah products, orders tables |
| **Dashboard** | ✅ Siap | Tambah Knowledge Manager, Approval UI |
| **Escalation** | ✅ Siap | Extend untuk approval notifications |

### 🟡 Need Refactor from v1.0

| v2 Component | What Changes | Complexity |
|:-------------|:-------------|:----------:|
| **Agent** → sub-components | Pisah: ContextBuilder, StyleRouter, ToolExecutor | 🟡 Sedang |
| **System Prompt** → dynamic | Static prompt → build dari context + style + history | 🟡 Sedang |
| **Contact system** → profiles | `contacts` table + `contacts/*.md` files | 🟡 Sedang |
| **Human takeover** → Telegram | Manual → bisa via `/approve`, `/reject` | 🟢 Rendah |

### 🔴 Need Build from Scratch

| v2 Component | Complexity | Depends On |
|:-------------|:----------:|:-----------|
| **Memory System** (JSONL + Markdown) | 🟡 Sedang | — |
| **Contact Profile format** | 🟢 Rendah | Memory System |
| **Style Router** | 🟡 Sedang | Contact Profiles |
| **Proactive Scheduler** | 🟡 Sedang | Memory System |
| **Approval Queue** | 🟡 Sedang | — |
| **Tool Sandbox** (limited shell) | 🔴 Tinggi | — |
| **Telegram Bot Control** | 🟡 Sedang | Approval Queue |
| **Auto-Learning** | 🔴 Tinggi | Memory System + Style Router |
| **Facts Extraction** | 🟡 Sedang | Memory System |
| **Correction Handling** | 🟡 Sedang | Auto-Learning |
| **Knowledge Manager** (products, orders) | 🟡 Sedang | Database + Dashboard |

---

## 🧠 Memory System (BARU)

### Structure

```
memory/
├── _global/
│   ├── style_profile.md      # User's base communication style
│   ├── facts.md              # Personal facts about user
│   └── preferences.md        # User preferences
│
├── contacts/
│   ├── budi.md               # Profile & style untuk Budi
│   ├── pak_hendra.md         # Profile & style untuk bos
│   └── customer_joni.md      # Profile & style untuk customer
│
├── conversations/
│   ├── budi/
│   │   ├── 2026-07-13.jsonl  # Chat history hari ini
│   │   └── summary.md        # Auto-generated summary
│   └── pak_hendra/
│       └── ...
│
├── patterns/
│   ├── learned_styles.md     # Auto-learned patterns
│   └── corrections.md        # User corrections
│
└── knowledge/
    ├── kb-seed.md            # Knowledge base (link ke v1)
    └── products.md           # Product catalog (BARU)
```

### Memory Types

| Type | Lifetime | Storage | Purpose |
|------|----------|---------|---------|
| Working | Session | In-memory | Current conversation context |
| Short-term | Daily | JSONL files | Recent conversations |
| Long-term | Permanent | Markdown files | Facts, patterns, knowledge |

### Integration dengan v1.0

```
v1.0 Database (SQLite)          v2.0 Memory (Files)
─────────────────────           ────────────────────
contacts table        ───→      contacts/*.md (style profiles)
conversations table   ───→      conversations/*/*.jsonl (history)
knowledge_base table  ───→      knowledge/*.md (products, policies)
messages table        (stay)    — tetap di SQLite untuk query cepat
```

---

## 👤 Per-Contact Style System

### Contact Profile Format

```markdown
# Budi Santoso
- Relasi: Teman kuliah
- Tone: Casual, sering pakai slang
- Bahasa: Indonesia campur Inggris
- Sapaan: "Bro", "Brod"
- Emoji: Jarang, tapi suka "😂"
- Contoh respon: "Oke bro gas aja"
- Topik: Gaming, kerjaan, nongkrong

## Recent Interactions
- 2026-07-13: Tanya kabar, ajak nongkrong
- 2026-07-10: Bahas project baru

## Learned Patterns
- Suka kirim voice note panjang
- Weekend lebih suka chat malam
```

### Style Router Flow

```
Message from: Budi
    ↓
1. Identify sender → Budi Santoso (dari v1.0 contact system)
2. Load memory/contacts/budi.md (profile + style)
3. Load conversation history (last 20 messages)
4. Determine context (casual chat / urgent / business)
5. Apply style → casual, mixed language, formal ke bos
6. Build context → system prompt + style + history
7. Generate response via Agent (v1.0)
```

---

## 📦 Knowledge Management (Flexible RAG)

### Philosophy
**Upload apapun, langsung searchable.** Tidak perlu catalog management UI yang ribet.

### How It Works

```
┌─────────────────────────────────────────────────┐
│           Knowledge Sources (Anything)           │
│                                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│  │Product│ │Price │ │Policy│ │ FAQ  │ │Custom│ │
│  │ .md  │ │ .md  │ │ .md  │ │ .md  │ │ .md  │ │
│  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ │
│     └────────┼────────┼────────┼────────┘      │
│              ↓                                 │
│     ┌────────────────┐                         │
│     │  Upload/Embed  │                         │
│     └────────┬───────┘                         │
│              ↓                                 │
│     ┌────────────────┐                         │
│     │  Vector Store  │ ← Semua jadi satu       │
│     │  (SQLite+emb)  │                         │
│     └────────────────┘                         │
└─────────────────────────────────────────────────┘
```

### Usage

```bash
# Upload file individual
wagent kb upload products.md
wagent kb upload pricing.md
wagent kb upload policies.md
wagent kb upload catalog.csv

# Upload semua file di folder
wagent kb upload ./docs/*

# Lihat semua knowledge
wagent kb list

# Hapus knowledge
wagent kb delete products.md
```

### File Format: Terserah

User bebas pakai format apapun:

**products.md:**
```markdown
# Produk
## Kaos Polos Premium
- SKU: KAOS-001
- Harga: Rp 89.000
- Warna: Putih, Hitam, Abu
- Stok: 150 pcs
- Deskripsi: Kaos katun 30s, nyaman dipakai
```

**pricing.md:**
```markdown
# Harga Grosir
- 10-50 pcs: Diskon 10%
- 51-100 pcs: Diskon 15%
- >100 pcs: Hubungi sales

# Promo Aktif
- Flashsale: Rp 69.000 (s/d 15 Juli)
- Free ongkir: Min. belanja Rp 200.000
```

**policies.md:**
```markdown
# Kebijakan Pengiriman
- Free ongkir Jabodetabek (min. Rp 150.000)
- Estimasi: Jabodetabek 1-2 hari, Jawa 2-3 hari

# Kebijakan Retur
- Retur dalam 7 hari
- Barang harus belum dipakai
```

**notes.txt:**
```markdown
Customer Joni: suka kaos warna gelap, biasa order 5-10 pcs
Budi: teman kuliah, sering tanya diskon
```

**chat_history.md:**
```markdown
# Percakapan Penting
- 13 Juli: Budi tanya ongkir ke Surabaya, saya kasih Rp 25.000
- 10 Juli: Joni komplain barang rusak, sudah saya ganti
```

### Storage

```
knowledge/
├── products.md          # Upload oleh user
├── pricing.md           # Upload oleh user
├── policies.md          # Upload oleh user
├── notes.txt            # Upload oleh user
├── chat_history.md      # Auto-generated dari chat
└── .vector/             # Auto-generated embeddings
    └── embeddings.db    # SQLite + vector index
```

### Real-time Data (Tetap pakai DB)

Hanya data yang butuh **real-time query**:

| Data | Storage | Why |
|------|---------|-----|
| Orders | SQLite | Status berubah terus |
| Stock | SQLite | Real-time update |
| Contacts | SQLite | Perlu lookup cepat |
| Schedules | SQLite | Cron jobs |

Knowledge tentang produk, harga, kebijakan → semua lewat RAG.

### Agent Tools (12 Built-in)

| Tool | Fungsi |
|------|--------|
| `search_knowledge_base` | Semantic search dari KB + uploaded files |
| `get_customer_info` | Cari data customer |
| `get_conversation_history` | Lihat riwayat chat |
| `get_current_time` | Jam/tanggal sekarang |
| `add_note` | Tambah catatan customer |
| `get_customer_tags` | Lihat tags customer |
| `escalate_to_human` | Transfer ke manusia |
| `lookup_order` | Cek status order (dari DB) |
| `check_stock` | Cek stok real-time (dari DB) |
| `send_message` | Kirim pesan ke kontak |
| `send_image` | Kirim gambar |
| `create_reminder` | Reminder via cron |

### Dashboard: Simple File Manager

```
┌─────────────────────────────────────────────────────┐
│  Knowledge Base                                     │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │  File           │ Size   │ Uploaded          │   │
│  │─────────────────┼────────┼──────────────────│   │
│  │  products.md    │ 12 KB  │ 13 Jul 10:30     │   │
│  │  pricing.md     │ 3 KB   │ 13 Jul 10:32     │   │
│  │  policies.md    │ 5 KB   │ 12 Jul 15:20     │   │
│  │  notes.txt      │ 2 KB   │ 11 Jul 09:15     │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
│  [Upload File]  [Upload Folder]  [Delete Selected]  │
└─────────────────────────────────────────────────────┘
```

---

## 📋 Control Plane Options

| Option | Use Case | Status |
|--------|----------|:------:|
| **Telegram Bot** | Primary control — dari mana saja | ✅ Ready (4 commands) |
| **Web Dashboard** | Monitor & manage — KB, analytics | ✅ Siap (enhance) |
| **WA Self-Chat** | Quick control — chat nomor sendiri | ✅ Ready (6 commands) |

### Telegram Bot Commands (BARU)

| Command | Fungsi |
|---------|--------|
| `/status` | Status agent & connections |
| `/pause` | Pause auto-reply |
| `/resume` | Resume auto-reply |
| `/approve <id>` | Approve pending action |
| `/reject <id>` | Reject pending action |
| `/contacts` | List managed contacts |
| `/add_contact <name> <relation>` | Add contact profile |
| `/logs` | Recent activity |

---

## 🛠️ Tools — v2 Enhancement

### Dari v1.0 (sudah ada, akan dienhance)

| Tool | Status | v2 Change |
|:-----|:------:|:----------|
| `search_knowledge_base` | ✅ Ada | Tambah semantic product search |
| `get_customer_info` | ✅ Ada | Tambah contact profile fields |
| `get_conversation_history` | ✅ Ada | Bisa baca JSONL history |
| `get_current_time` | ✅ Ada | Sama |
| `add_note` | ✅ Ada | Sama |
| `get_customer_tags` | ✅ Ada | Sama |
| `escalate_to_human` | ✅ Ada | Tambah approval mode |

### Tools BARU di v2

| Tool | Fungsi | Sandboxed | Approval? |
|:-----|:--------|:---------:|:---------:|
| `lookup_order` | Cek status order (dari DB) | ✅ | ❌ |
| `check_stock` | Cek stok real-time (dari DB) | ✅ | ❌ |
| `create_reminder` | Reminder via cron | ✅ | ❌ |
| `send_message` | Kirim pesan ke kontak | ✅ | ✅ |
| `send_image` | Kirim gambar | ✅ | ✅ |

### Limited Shell (Safe Commands) — Future

> **Belum diimplementasikan.** Akan ditambahkan di phase mendatang.

```yaml
shell:
  allowed:
    - "date"
    - "curl"        # dengan domain whitelist
    - "jq"
    - "wget"        # (hanya ke whitelist URL)
    - "ls"          # (hanya di restricted dirs)
    - "cat"         # (hanya di restricted dirs)
    - "grep"        # (hanya di restricted dirs)
  denied:
    - "rm"
    - "sudo"
    - "chmod"
    - "bash"
    - "*"
  restricted_dirs:
    - "./data"
    - "./memory"
    - "./uploads"
```

---

## 🔄 Proactive Actions

### Trigger Types
1. **Time-based**: Reminder, follow-up schedule (extend v1.0 Scheduler)
2. **Event-based**: New message dari customer (v1.0 Gateway hook)
3. **Pattern-based**: "3 hari belum reply → follow up" (BARU)

### Approval Flow
```
Agent detects trigger
    ↓
Queue for approval
    ↓
Notify via Telegram: "Agent mau follow up Budi"
    ↓
User: Approve / Reject / Edit
    ↓
Agent executes (if approved)
```

---

## 🧠 Learning & Adaptation

### Adaptation Levels

| Level | Description | v2 Target |
|:------|:------------|:---------:|
| 1. Basic | Template prompt, semua chat sama | ✅ v1.0 |
| 2. Style Learning | Learn dari chat history | 🎯 Phase 4 |
| 3. Context-Aware | Beda style per orang/konteks | 🎯 Phase 1-2 |
| 4. Full Clone | Handle conversation seperti user | 🚀 Future |

### Learning Flow
```
User chats with contact
    ↓
Agent respond (current style)
    ↓
User corrects atau agent detect pattern
    ↓
Update memory (contacts/*.md)
    ↓
Next time → apply learned style
```

---

## 📦 Prioritas Build (Updated)

### Phase 1: Core Foundation 🎯 (Sekarang — estimasi 3-5 hari)

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| Refactor Agent → sub-components | ✅ | — |
| - ContextBuilder (build context dari berbagai source) | ✅ | — |
| - MemoryManager (read/write JSONL + Markdown) | ✅ | — |
| - StyleRouter (apply per-contact style) | ✅ | — |
| Contact profile system (format + load/save) | ✅ | MemoryManager |
| Memory system: JSONL for short-term | ✅ | — |
| Memory system: Markdown for long-term | ✅ | — |
| Auto-summarization for token conservation | ✅ | Memory system |

### Phase 2: Knowledge Management (estimasi 3-5 hari)

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| Upload files → embed → vector store | ✅ | — |
| CLI: `kb upload`, `kb list`, `kb delete` | ✅ | — |
| Dashboard: Simple file manager | ✅ | — |
| Auto-embed on upload | ✅ | — |
| SQL migration: `kb_files` + `kb_chunks` tables | ✅ | — |

### Phase 3: Tools & Actions (estimasi 3-5 hari)

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| Proactive action scheduler | ✅ | Phase 1 |
| Approval queue system | ✅ | Phase 1 |
| Tool sandbox (whitelist shell) | ✅ | — |
| Reminder system | ✅ | Proactive scheduler |
| Scheduled messaging | ✅ | Scheduler |

### Phase 4: Control Plane (estimasi 3-4 hari)

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| Telegram bot (commands, notify, approve) | ✅ | Phase 3 |
| Dashboard: Approval UI | ✅ | Phase 3 |
| WA self-chat control | ✅ | Phase 1 |

### Phase 5: Learning (estimasi 4-6 hari)

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| Auto style learning | ✅ | Phase 1 + 4 |
| Pattern detection | ✅ | Phase 1 |
| Facts extraction | ✅ | Phase 1 |
| Correction handling | ✅ | Phase 4 |

### Phase 6: Advanced Automation ✅

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| BroadcastEngine (rate limiting, pause/resume, tag filter) | ✅ | Phase 1 |
| LinkDetector (URL detection, metadata fetch, caching) | ✅ | — |
| SchedulingWorkflows (follow-up sequences, conditions) | ✅ | Phase 1 |

### Phase 7: Analytics & Reporting ✅

| Task | Status | Depends On |
|:-----|:------:|:-----------|
| CSAT Tracking (surveys, ratings, NPS) | ✅ | Phase 1 |
| Performance Metrics (response time, p95, tool success) | ✅ | Phase 1 |
| Daily/Weekly Reports | ✅ | Phase 1 |

### Future (Optional)

| Task | Priority |
|:-----|:--------:|
| Shopify/WooCommerce API sync | 🟡 |
| Google Sheets sync | 🟢 |
| Payment gateway integration | 🟢 |
| Shipping API (RajaOngkir, etc.) | 🟢 |
| Docker deployment | 🟡 |
| Plugin marketplace | 🟢 |

---

## 💻 Tech Stack — v2

| Komponen | v1.0 | v2.0 |
|----------|:----:|:----:|
| **Runtime** | Node.js + TypeScript | Sama |
| **WhatsApp** | Baileys | Sama |
| **AI** | OpenAI / Gemini / Claude / Ollama | Sama |
| **Database** | SQLite (better-sqlite3) | SQLite + Markdown + JSONL |
| **Memory** | Conversation di DB | JSONL (short) + MD (long) |
| **Embeddings** | Gemini text-embedding-004 | Sama |
| **Control** | CLI + Web Dashboard | + Telegram Bot + WA Self-Chat |
| **Dashboard** | Vite + React (8 pages) | + Knowledge Manager + Approval UI |

---

## ❓ Open Questions

- [ ] Berapa max contacts yang perlu di-track?
- [ ] Group chat perlu beda style atau tidak?
- [ ] Auto-approve threshold: aksi mana yang boleh auto?
- [ ] Data privacy: boleh ke cloud atau harus local?
- [ ] Multi-device: agent bisa dijalankan di beberapa device?
- [ ] Bagaimana format memory agar AI bisa baca tulis dengan baik (Markdown → context → Markdown)?
- [ ] Auto-summarization: pakai AI summarize atau rule-based?

---

> **Referensi:**
> - [PRD.md](./PRD.md) — Product Requirements Document
> - [docs/architecture.md](./docs/architecture.md) — Arsitektur v1.0 detail
> - [docs/](./docs/README.md) — Dokumentasi lengkap
