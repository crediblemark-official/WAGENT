# 🤖 WAGENT — WhatsApp AI Agent

**Open-source, self-hosted, multi-AI WhatsApp chatbot untuk customer service otomatis.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-f5e0ac)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-007ACC)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## ✨ Fitur Unggulan

### v1.0 (Current)
| Fitur | Deskripsi |
|-------|-----------|
| 🧠 **Multi-AI Provider** | OpenAI, Gemini, Claude, atau Ollama (local) |
| 📚 **RAG Knowledge Base** | Semantic search dengan Gemini embeddings untuk jawaban akurat |
| 👥 **Multi-Number WhatsApp** | Kelola banyak nomor WhatsApp dari satu instance |
| 🤝 **Human Takeover** | AI otomatis berhenti ketika human agent membalas |
| 🚨 **Telegram Escalation** | Notifikasi ke Telegram ketika AI tidak bisa menjawab |
| 🎤 **Voice Transcription** | Transkripsi pesan suara via Whisper atau Gemini |
| 🔐 **Encryption at-rest** | AES-256-GCM enkripsi data sensitif |
| 🧩 **Plugin System** | Skills untuk menambah kemampuan AI |
| ⏰ **Scheduled Messages** | Kirim pesan terjadwal (daily/weekly/monthly) |
| 🏢 **Jam Operasional** | Konfigurasi jam kerja dengan timezone |
| 🐌 **Natural Behavior** | Typing delay, read receipts, presence — seperti manusia |
| 🚀 **Self-Hosted** | Semua data di server sendiri, zero third-party |

### v2.0 (Planning)
| Fitur | Deskripsi |
|-------|-----------|
| 🎭 **Per-Contact Style** | Formal/bisnis, casual/friends, family, romantic — berbeda per kontak |
| 🧠 **Memory System** | Short-term (JSONL) + Long-term (Markdown) — seperti manusia |
| ⏰ **Proactive Actions** | Scheduled messaging, reminders, auto follow-up |
| 📱 **Control Plane** | Telegram bot (primary), WA self-chat, Web Dashboard |
| 🔄 **Adaptive Learning** | Belajar dari gaya bicara user dan koreksi |
| 🛠️ **Tool Sandbox** | Safe shell, HTTP requests, file ops, web scraping |
| 📁 **Flexible RAG** | Upload apapun (.md, .txt, .csv) → langsung searchable |

Lihat [PLAN.md](./PLAN.md) untuk detail lengkap.

---

## 🏗️ Quick Start

### Prasyarat

- **Bun** ≥ 1.0 (runtime & package manager)
- Akun **WhatsApp** (nomor bisnis)
- API key salah satu AI provider

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/wagent.git
cd wagent
bun install
bun run build
```

### 2. Setup

```bash
./bin/wagent init              # Setup wizard interaktif
```

Atau manual — buat `.env` di root project:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-2.0-flash
DATABASE_TYPE=sqlite
DATABASE_URL=data/wagent.db
DASHBOARD_PORT=3030
```

### 3. Start

```bash
./bin/wagent start
```

Scan QR code WhatsApp yang muncul di terminal. Selesai!

### Global Command (opsional)

Biar bisa panggil `wagent` dari mana saja tanpa `./bin/`:

```bash
export PATH="$PWD/bin:$PATH"       # temporary
# atau
echo 'export PATH="/path/to/wagent/bin:$PATH"' >> ~/.bashrc  # permanent
```

### Commands

```bash
wagent init                  # Setup wizard
wagent start                 # Start dengan dashboard
wagent start --no-dashboard  # Start tanpa dashboard
wagent status                # Cek status WhatsApp
wagent config                # Lihat konfigurasi
wagent log                   # Lihat log terbaru
wagent kb list               # List knowledge base
wagent kb add                # Tambah KB entry
wagent kb search "query"     # Cari di KB
wagent kb upload <file>      # Upload file ke KB
wagent help                  # Semua commands
```

---

## 🔧 Konfigurasi Cepat

Buat file `.env` di root project:

```env
# Pilih AI Provider (openai / gemini / claude / ollama)
AI_PROVIDER=gemini

# Google Gemini (gratis — recommended untuk testing)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash

# Atau OpenAI
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o

# System Prompt
AGENT_SYSTEM_PROMPT="Kamu adalah customer service yang ramah dan membantu."
```

Lihat [Dokumentasi Konfigurasi Lengkap](./docs/configuration.md) untuk semua opsi.

---

## 📖 Dokumentasi Lengkap

| Dokumen | Deskripsi |
|---------|-----------|
| [📘 Getting Started](./docs/getting-started.md) | Instalasi detail, setup, first run |
| [⚙️ Configuration](./docs/configuration.md) | Semua env vars, AI provider setup |
| [🏛️ Architecture](./docs/architecture.md) | System design, component diagram |
| [📟 CLI Commands](./docs/cli-commands.md) | Semua perintah CLI dengan contoh |
| [📚 Knowledge Base](./docs/knowledge-base.md) | KB management + RAG semantic search |
| [🧩 Skills / Plugin](./docs/skills.md) | Cara membuat dan install skills |
| [🔐 Encryption](./docs/encryption.md) | AES-256-GCM data protection |
| [🚨 Escalation](./docs/escalation.md) | Telegram escalation setup |
| [📋 PRD](./PRD.md) | Product Requirements Document |

---

## 🧪 Test Coverage

```bash
cd packages/core
bun test --coverage
```

| Metrik | Nilai |
|:---|---:|
| **Lines** | **~83%** 🟢 |
| **Branches** | **~81%** 🟢 |
| **Functions** | **~91%** 🟢 |
| **Tests** | **712** ✅ |

---

## 🚀 Use Case

### UKM / Toko Online
- Jawab FAQ otomatis (ongkir, retur, status pesanan)
- Jam operasional terbatas (otomatis offline di luar jam)
- Eskalasi ke CS via Telegram jika AI tidak bisa menjawab
- Multi-nomor untuk CS 1, CS 2, dll

### Agency / Developer
- White-label untuk klien
- Custom skills dengan plugin system
- Dashboard real-time monitoring
- Encryption untuk kepatuhan data

### Enterprise (v1.0)
- Team management
- Advanced analytics
- Postgres support
- Docker / Kubernetes deployment

---

## 🛠️ Tech Stack

```
Runtime      │ Bun ≥1.0 (ESM)
Language     │ TypeScript 5.7
Database     │ bun:sqlite (SQLite + WAL)
AI Providers │ OpenAI / Gemini / Claude / Ollama
Embeddings   │ Gemini text-embedding-004 (768d)
WhatsApp     │ @whiskeysockets/baileys
CLI          │ Commander.js + picocolors
Dashboard    │ React 19 + Vite + Express + WebSocket
Encryption   │ AES-256-GCM (Node crypto)
Logging      │ Pino structured logger
Testing      │ Vitest + coverage v8
```

---

## 🤝 Kontribusi

Kami menyambut kontribusi dari siapa pun! Beberapa cara untuk berkontribusi:

1. **Coding:** Buka issue, fork, buat PR
2. **Testing:** Coba install dan laporkan bugs
3. **Dokumentasi:** Bantu perbaiki docs
4. **Ide:** Share use case dan feature request

Lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk panduan kontribusi.

---

## 📄 Lisensi

WAGENT dirilis di bawah lisensi **MIT**. Silakan gunakan, modifikasi, dan distribusikan secara bebas.

---

## 🙏 Kredit

- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — Library WhatsApp Web
- [OpenAI](https://openai.com), [Google Gemini](https://ai.google.dev), [Anthropic Claude](https://anthropic.com), [Ollama](https://ollama.ai) — AI Providers
- [Bun](https://bun.sh) — Runtime & SQLite engine
- Semua kontributor open-source yang membuat proyek ini mungkin

---

<div align="center">
  <sub>Dibuat dengan ❤️ untuk customer service Indonesia yang lebih baik</sub>
</div>
