# 📋 PRD — WAGENT: WhatsApp AI Customer Service Agent

**Versi:** 1.0 (v0.1 MVP complete ✅ → v2.0 Planning)  
**Status:** Production-Ready / Active Development  
**Lisensi:** MIT  
**Updated:** July 2026

---

## 1. Ringkasan Eksekutif

WAGENT adalah **open-source WhatsApp AI Customer Service Agent** yang memungkinkan bisnis mengotomatiskan layanan pelanggan melalui WhatsApp menggunakan AI (LLM) dengan dukungan multi-provider, knowledge base RAG, multi-nomor WhatsApp, dan eskalasi ke human agent via Telegram.

**Status: Semua fitur v1.0 sudah selesai, v2.0 sedang dalam pengembangan (620 tests, ~83% line coverage).**
**Sekarang: Memasuki pengembangan v2 — Personal Assistant + Business CS Hybrid dengan proactive messaging, per-contact style, dan adaptive learning.**

**Visi:** Memberdayakan setiap bisnis di Indonesia (dan global) untuk memiliki customer service AI yang canggih, privacy-aware, dan mudah di-deploy — tanpa ketergantungan pada platform SaaS berbayar.

---

## 2. Masalah & Solusi

### Masalah
1. **Biaya tinggi:** Layanan WhatsApp Business API resmi dan platform SaaS CS mahal untuk UKM
2. **Kompleksitas:** Integrasi WhatsApp + AI membutuhkan banyak komponen teknis
3. **Privasi data:** Platform SaaS menyimpan data pelanggan di server pihak ketiga
4. **Kustomisasi terbatas:** Solusi siap pakai tidak bisa disesuaikan dengan kebutuhan bisnis spesifik
5. **Bahasa Indonesia:** Banyak AI chatbot tidak di-optimalkan untuk bahasa Indonesia
6. **Reaktif saja:** CS bot hanya menunggu, tidak bisa chat duluan atau belajar gaya komunikasi

### Solusi
1. **Self-hosted & open-source:** Semua data tetap di infrastruktur sendiri
2. **Plug-and-play:** Setup wizard interaktif, satu command `wagent start`
3. **Multi-AI provider:** Bebas pilih OpenAI, Gemini, Claude, atau Ollama (local)
4. **Plugin system:** Skills untuk ekstensibilitas tanpa batas
5. **RAG Knowledge Base:** Semantic search dengan embedding untuk jawaban akurat
6. **Bahasa Indonesia first:** Prompt default, tools, dan error messages dalam Bahasa Indonesia
7. **v2: Proactive + Adaptive:** Bisa chat duluan, beda gaya per kontak, belajar dari koreksi

---

## 3. Target Pengguna

| Persona | Deskripsi | Kebutuhan Utama |
|---------|-----------|-----------------|
| **UKM / Pemilik Bisnis** | Toko online, jasa, F&B dengan 50-5000 chat/hari | Setup cepat, harga murah, jawab FAQ otomatis |
| **Developer / Agency** | Build custom CS solution untuk klien | Extensible, API, plugin system, multi-number |
| **CS Team Lead** | Mengelola tim customer service | Human takeover, escalation, dashboard, reporting |
| **Personal User** | Ingin AI assistant pribadi di WhatsApp | Proactive, adaptive style, reminder |

---

## 4. Fitur — v1.0 (Semua Selesai ✅)

### ✅ AI Agent Engine

| Fitur | Coverage | Detail |
|-------|:--------:|--------|
| OpenAI Provider | ✅ | GPT-4o, GPT-4o-mini, o3-mini |
| Gemini Provider | ✅ | Gemini 2.0 Flash, Pro, 1.5 Pro |
| Claude Provider | ✅ | Claude Sonnet 4, Haiku 3.5 |
| Ollama (Local LLM) | ✅ | LLaMA, Mistral, dll |
| Tool Execution Loop | 96.87% lines | Max 10 iterasi auto-tool-calling |
| Conversation History | ✅ | Trim otomatis, stale cleanup |
| System Prompt | ✅ | Customizable per bisnis |

### ✅ Gateway & Message Handler

| Fitur | Coverage | Detail |
|-------|:--------:|--------|
| Message Routing & Processing | 86.47% lines | Incoming → AI → Outgoing |
| Rate Limiting | ✅ | Sliding window per contact |
| Working Hours | ✅ | Timezone-aware (Asia/Jakarta default) |
| Group Chat Support | ✅ | @mention filter |
| Human Takeover Detection | ✅ | Auto-detect fromMe + not in DB |
| Natural Typing Delay | ✅ | 1-8s reading + typing simulation |
| Audio Transcription | ✅ | Whisper (OpenAI) / Gemini |
| Blue Check (read receipts) | ✅ | Auto-mark read |
| Online Presence | ✅ | Available/unavailable |

### ✅ Knowledge Base + RAG

| Fitur | Coverage | Detail |
|-------|:--------:|--------|
| CRUD Knowledge Entries | 89.36% lines | CLI + API |
| Keyword Search | ✅ | Hybrid scoring: keyword → question → answer |
| Semantic Search (RAG) | ✅ | Gemini text-embedding-004 (768d) |
| Cosine Similarity | ✅ | Dual-layer: semantic → keyword fallback |
| KB Seed from File | ✅ | Markdown format `kb-seed.md` |

### ✅ SQLite Database

| Fitur | Detail |
|-------|--------|
| Contacts, Chats, Messages | ✅ Full CRUD |
| Conversations (AI Context) | ✅ Role-based history |
| Broadcasts & Recipients | ✅ Mass messaging |
| Scheduled Messages | ✅ Daily/weekly/monthly |
| Daily Stats | ✅ Message counts per day |
| WAL mode + Foreign Keys | ✅ Production-grade |

### ✅ WhatsApp Adapter (Baileys)

| Fitur | Detail |
|-------|--------|
| QR Code Auth | ✅ Terminal + auto-reconnect |
| Message Receive (text) | ✅ + extended text, captions, buttons |
| Voice Note Detection | ✅ Auto-download + transcribe |
| @Mention Extraction | ✅ For group chat routing |
| Send Message | ✅ With error handling |
| sendPresenceUpdate | ✅ Composing, paused, available |
| readMessages | ✅ Blue check (skip groups) |
| downloadAudio | ✅ Stream buffer → transcription |
| getContacts | ✅ From Baileys store |
| Session Auto-Encrypt | ✅ AES-256-GCM on disconnect |

### ✅ Dashboard Web UI (React + Express + WebSocket)

| Halaman | Fitur |
|---------|-------|
| **ChatPage** | Real-time chat list, message view, human takeover badge, send message |
| **ContactsPage** | Contact list, search, detail panel (tags, notes, info) |
| **KnowledgeBasePage** | Full CRUD, modal form, search with debounce, category filter, expand/collapse, keyword/tag management, priority selector, search relevance badge |
| **AnalyticsPage** | 4 stat cards, bar chart per day, daily detail table, period selector (7/14/30/90 days) |
| **BroadcastPage** | Broadcast form, history list, status indicators |
| **SchedulePage** | Create form (contact, date, time, repeat), upcoming/history tabs, cancel/delete |
| **NumbersPage** | Multi-number management, status indicators, connect/disconnect |
| **SettingsPage** | System prompt editor, toggle switches, AI provider selector |
| **WebSocket** | Auto-reconnect, event system, request/response pattern |

### ✅ CLI (Commander.js)

| Command Group | Commands |
|---------------|----------|
| **init** | Setup wizard interaktif |
| **start** | Gateway + WhatsApp + Dashboard |
| **config** | Lihat konfigurasi |
| **status** | Cek session WhatsApp |
| **log** | Lihat log terbaru |
| **kb** | list, add, remove, search, seed, categories |
| **number** | list, add, remove (multi-number) |
| **crypto** | init, encrypt, decrypt, status (AES-256-GCM) |
| **escalation** | test (Telegram notifikasi) |
| **skill** | list, install, remove (plugin system) |

### ✅ Fitur Pendukung Lainnya

| Fitur | Lines Coverage |
|-------|:--------------:|
| Encryption (AES-256-GCM) | **100%** |
| Escalation to Telegram | **100%** |
| Multi-Number Manager | **98.71%** |
| Skill Loader (Plugin System) | **97.46%** |
| Transcriber (Voice-to-Text) | **95.65%** |
| Scheduler | **93.22%** |
| Multi-WhatsApp Adapter | **90.29%** |
| Event Bus | **80%** |
| Logger (Pino) | **100%** |

### 📊 Coverage Keseluruhan

| Metrik | Nilai |
|:---|---:|
| **Tests** | **620 ✅** |
| **Statements** | **~90%** 🟢 |
| **Branches** | **~81%** 🟢 |
| **Functions** | **~91%** 🟢 |
| **Lines** | **~83%** 🟢 |
| **Files** | **54 files** with tests |

---

## 5. Arsitektur Teknis — v1.0 (Current)

```
┌───────────────────────────────────────────────────────────────┐
│                      wagent CLI                                │
│  (commander.js — init, start, kb, crypto, number, skill, log) │
└───────────────────┬───────────────────────────────────────────┘
                    │
┌───────────────────▼───────────────────────────────────────────┐
│                  @wagent/core (Engine)                         │
│                                                                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │    Gateway      │──│    Agent       │──│ MultiWhatsApp  │  │
│  │  • Message hub  │  │  • AI loop     │  │   Adapter      │  │
│  │  • Rate limit   │  │  • Tool exec   │  │  • JID routing │  │
│  │  • Working hrs  │  │  • 4 providers │  │  • Auto-encrypt │  │
│  │  • Human takeov │  │  • Conversation│  │  • Multi-number │  │
│  │  • Natural delay│  │  • 12 built-in │  └────────────────┘  │
│  │  • Escalation   │  │    tools       │                      │
│  └────────┬───────┘  └───────┬────────┘                      │
│           │                  │                                │
│  ┌────────▼──────────────────▼───────┐  ┌──────────────────┐  │
│  │         Database (SQLite)         │  │ EmbeddingService │  │
│  │  contacts │ chats │ messages      │  │ (Gemini 768d)    │  │
│  │  conversations │ knowledge_base   │  └──────────────────┘  │
│  │  broadcasts │ scheduled │ stats   │                        │
│  └─────────────────────────────────-─┘                        │
│                                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │Scheduler │ │Transcriber│ │SkillLoad │ │  EventBus        │  │
│  │(msg cron)│ │(voice→txt)│ │(plugins) │ │  (pub/sub)       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│  │Escalation│ │  Crypto  │ │  Logger  │                       │
│  │(Telegram)│ │AES-256   │ │ (Pino)   │                       │
│  └──────────┘ └──────────┘ └──────────┘                       │
└───────────────────────────────────────────────────────────────┘
           │
           ▼
┌───────────────────────────────────────────────────────────────┐
│              WhatsApp (Baileys Adapter)                        │
│  connect │ disconnect │ sendMessage │ sendPresenceUpdate      │
│  readMessages │ downloadAudio │ getContacts                   │
│  Auto-reconnect │ QR auth │ Session encryption                │
└───────────────────────────────────────────────────────────────┘
           │
           ▼
┌───────────────────────────────────────────────────────────────┐
│              Dashboard Web UI (React + Express + WS)           │
│  8 pages: Chat │ Contacts │ KB │ Analytics │ Broadcast       │
│  Schedule │ Numbers │ Settings                                │
└───────────────────────────────────────────────────────────────┘
```

### Stack

| Layer | Teknologi |
|-------|-----------|
| **Runtime** | Node.js ≥18 (ESM) |
| **Language** | TypeScript 5.7 |
| **Database** | better-sqlite3 (SQLite + WAL) |
| **AI Providers** | OpenAI / Gemini / Claude / Ollama |
| **Embeddings** | Gemini text-embedding-004 (768d) |
| **WhatsApp** | @whiskeysockets/baileys |
| **CLI** | Commander.js + picocolors |
| **Dashboard** | React 19 + Vite + Express + WebSocket |
| **TUI** | @clack/prompts + qrcode-terminal |
| **Encryption** | AES-256-GCM (Node crypto) |
| **Logging** | Pino structured logger |
| **Testing** | Vitest + coverage v8 |
| **CI** | GitHub Actions (Node 18/20/22 matrix) |

---

## 6. Konsep Kunci

### Natural WhatsApp Behavior
- **Typing indicator:** Bot menunjukkan "mengetik..." seperti manusia
- **Reading delay:** Bot membaca pesan dengan delay natural (1-8 detik)
- **Typing speed delay:** Respon AI diketik perlahan sesuai panjang teks
- **Blue check (✓✓):** Pesan otomatis ditandai sudah dibaca
- **Presence:** Bot muncul sebagai "online" / "tersambung"

### Human Takeover
Ketika human agent membalas dari WhatsApp Web, AI otomatis berhenti untuk chat tersebut selama cooldown period (default 30 menit).

### RAG Knowledge Base
Knowledge base entries memiliki embedding vector (768-dim dari Gemini) untuk semantic search. Dual-layer search: semantic → keyword fallback.

### Escalation Pipeline
Jika AI tidak bisa menjawab (error / empty response / explicit request), notifikasi dikirim ke Telegram group CS dengan 60s deduplication.

### Per-Contact Style (v2)
Gaya komunikasi berbeda per kontak — formal ke bos, casual ke teman, sopan ke customer.

---

## 7. Metrik Kesuksesan

| Metrik | v1.0 Target | Real | v2.0 Target |
|--------|:-----------:|:----:|:-----------:|
| **Test Coverage** | ≥90% lines | **~83%** 🟢 | ≥90% lines |
| **Branches** | ≥80% | **~81%** 🟢 | ≥80% |
| **Setup time** | <5 menit | **<2 menit** | <2 menit |
| **Time to first reply** | <5 detik | ✅ | <5 detik |
| **Uptime** | >99% | ✅ | >99% |
| **Escalation rate** | ≤15% | — | ≤10% (dengan v2 learning) |

---

## 8. Roadmap

### ✅ v1.0 (Current — Complete) — Juli 2026

**Semua fitur selesai, 620 tests, ~83% line coverage.**

| Package | Status | Detail |
|---------|:------:|--------|
| `@wagent/core` | ✅ Production | Gateway, Agent, Database, Tools, dll — 54 file sumber |
| `@wagent/cli` | ✅ Production | 30+ CLI commands |
| `@wagent/whatsapp` | ✅ Production | Baileys full integration |
| `@wagent/dashboard` | ✅ Production | 8 halaman React + Express + WebSocket |
| `@wagent/tui` | ✅ Production | Setup wizard interaktif |
| **CI Pipeline** | ✅ Active | GitHub Actions, Node 18/20/22 matrix |
| **Docs** | ✅ Complete | PRD, README, 12 file dokumentasi |

### 🚀 v2.0 (In Planning) — Next

**Evolusi dari CS Bot → Personal Assistant + Business CS Hybrid.**

Lihat [PLAN.md](./PLAN.md) untuk detail lengkap.

| Phase | Fokus | Estimasi |
|:------|:------|:--------:|
| **Phase 1** | Core Foundation — Agent refactor, Memory system, Contact profiles, Style router | 3-5 hari |
| **Phase 2** | Knowledge Management — Upload files → embed → vector store, CLI commands | 3-5 hari |
| **Phase 3** | Tools & Actions — Proactive scheduler, Approval queue, Tool sandbox, Scheduled messaging | 3-5 hari |
| **Phase 4** | Control Plane — Telegram bot, WA self-chat control, Dashboard enhancements | 3-4 hari |
| **Phase 5** | Learning — Auto style learning, Pattern detection, Facts extraction, Corrections | 4-6 hari |

**v2 Key Features:**
- **Per-Contact Style:** Tone/language berbeda per kontak (formal ↔ casual)
- **Proactive Messaging:** Agent bisa chat duluan (dengan approval)
- **Scheduled Messaging:** One-time, recurring, follow-up sequences
- **Memory System:** Short-term (JSONL) + Long-term (Markdown) memory
- **Telegram Control:** `/status`, `/pause`, `/approve` — full remote control
- **WA Self-Chat:** Quick control via self-chat
- **Adaptive Learning:** Belajar dari gaya bicara user dan koreksi
- **Tool Sandbox:** Limited shell execution dengan whitelist
- **Flexible RAG:** Upload apapun (.md, .txt, .csv) → langsung searchable

### v2.x — Future
- Shopify/WooCommerce API sync
- Google Sheets sync
- Payment gateway integration
- Docker deployment
- Plugin marketplace

---

## 9. Persyaratan Non-Fungsional

| Aspek | v1.0 | v2.0 |
|-------|:----:|:----:|
| **Performance** | 100+ concurrent chats | 200+ concurrent chats |
| **Memory** | <200MB idle | <300MB idle (dengan memory system) |
| **Storage** | ~1MB per 10K messages | ~2MB per 10K (dengan style profiles) |
| **Security** | AES-256-GCM | AES-256-GCM + approval queue |
| **Privacy** | Zero external data sharing | Zero external data sharing |
| **Reliability** | Auto-reconnect WhatsApp | Auto-reconnect + Telegram backup |
| **Extensibility** | Plugin system (.js/.mjs) | Plugin system + tool sandbox |

---

## 10. Appendix

### Struktur Monorepo

```
wagent/
├── packages/
│   ├── core/         → @wagent/core     — Engine utama (54 files)
│   ├── cli/          → @wagent/cli      — CLI (30+ commands)
│   ├── dashboard/    → @wagent/dashboard — Web UI (8 pages)
│   ├── whatsapp/     → @wagent/whatsapp — Baileys adapter
│   └── tui/          → @wagent/tui      — Setup wizard
├── docs/             → 12 file dokumentasi
├── .github/          → CI pipeline + Link checker
├── PRD.md            → Dokumen ini
├── PLAN.md           → v2 development plan
└── README.md         → Project entry point
```

### Tech Stack v1.0 → v2.0 Evolution

| Komponen | v1.0 | v2.0 |
|----------|:----:|:----:|
| Database | SQLite | SQLite + Markdown files |
| Memory | Conversation in DB | JSONL + Markdown + DB |
| Agent | Single prompt context | Dynamic context builder |
| Tools | Hardcoded tools | Tool sandbox + approval |
| Control | CLI only | Telegram + Dashboard + WA Self-Chat |
| Learning | None | Pattern detection + corrections |

---

Lihat [PLAN.md](./PLAN.md) untuk detail lengkap rencana pengembangan v2.
Lihat [docs/](./docs/README.md) untuk dokumentasi teknis lengkap.
