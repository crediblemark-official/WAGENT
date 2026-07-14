# 🤖 WAGENT — WhatsApp AI Agent Platform

**Open-source, self-hosted, multi-AI WhatsApp agent untuk bisnis apapun.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-f5e0ac)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-007ACC)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## 🎯 Apa itu WAGENT?

WAGENT bukan cuma chatbot CS. Ini adalah **platform WhatsApp AI Agent** yang bisa:

- 💬 **Jawab pertanyaan** — FAQ, produk, harga, stok
- 🛒 **Terima pesanan** — dari chat langsung ke sistem
- 🚚 **Hitung ongkir** — integrasi 17+ shipping provider
- 💰 **Proses pembayaran** — Midtrans, Xendit, transfer, COD
- 🔌 **Konek ke sistem existing** — POS, Shopee, Tokopedia via MCP
- 🧠 **Belajar** — adaptif dengan gaya bicara customer

---

## ✨ Fitur

### Core
| Fitur | Deskripsi |
|-------|-----------|
| 🧠 **Multi-AI Provider** | OpenAI, Gemini, Claude, atau Ollama (local) |
| 📚 **RAG Knowledge Base** | Semantic search + FTS5 untuk jawaban akurat |
| 👥 **Multi-Number WhatsApp** | Kelola banyak nomor dari satu instance |
| 🤝 **Human Takeover** | AI otomatis berhenti ketika human agent membalas |
| 🚨 **Telegram Escalation** | Notifikasi ke Telegram ketika AI tidak bisa menjawab |
| 🎤 **Voice Transcription** | Transkripsi pesan suara via Whisper atau Gemini |
| 🔐 **Encryption at-rest** | AES-256-GCM enkripsi data sensitif |
| ⏰ **Scheduled Messages** | Kirim pesan terjadwal (daily/weekly/monthly) |
| 🐌 **Natural Behavior** | Typing delay, read receipts — seperti manusia |

### Business
| Fitur | Deskripsi |
|-------|-----------|
| 🛒 **Order Management** | Buat & kelola pesanan dari WhatsApp |
| 📦 **Product Catalog** | Kelola produk, stok, harga |
| 🚚 **Shipping Integration** | 17+ kurir (JNE, J&T, SiCepat, dll) |
| 💳 **Payment Gateway** | Midtrans, Xendit, Transfer, COD |
| 📊 **Analytics** | Response time, CSAT, top contacts |

### Integration
| Fitur | Deskripsi |
|-------|-----------|
| 🔌 **MCP Support** | Model Context Protocol — konek ke sistem apapun |
| 🧩 **Skill System** | Plugin untuk extensibilitas |
| 🌐 **Web Scraper** | Cari info dari internet |
| 📱 **Dashboard** | Web UI untuk monitoring & management |

---

## 🚀 Quick Start

### Prasyarat

- **Bun** ≥ 1.0
- Akun **WhatsApp** (nomor bisnis)
- API key AI provider (Gemini gratis)

### Install

```bash
git clone https://github.com/crediblemark-official/WAGENT.git
cd WAGENT
bun install
bun run build
```

### Setup

```bash
./bin/wagent init              # Setup wizard interaktif
```

Atau buat `.env`:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
AGENT_SYSTEM_PROMPT="Kamu adalah asisten bisnis yang membantu."
```

### Start

```bash
./bin/wagent start
```

Scan QR code WhatsApp. Selesai!

---

## 💡 Use Cases

### 🏪 Toko Online / E-Commerce
```bash
# Upload katalog produk
./bin/wagent kb upload products.csv

# Customer tanya: "Baju A ada warna apa?"
# AI search KB → jawab otomatis

# Customer tanya: "Ongkir ke Bandung?"
# AI hitung ongkir via RajaOngkir → jawab

# Customer: "Mau order 2 pcs"
# AI buat order → approval via Telegram
```

### 🏢 Service Business (Salon, Klinik, etc)
```bash
# Upload daftar harga & layanan
./bin/wagent kb upload services.md

# Customer: "Berapa facial?"
# AI jawab dari KB

# Customer: "Mau booking jam 3"
# AI catat → kirim notifikasi ke Telegram
```

### 🏭 B2B / Distributor
```bash
# Konek ke POS yang sudah ada via MCP
./bin/wagent mcp connect pos-server

# Customer: "Stok barang A berapa?"
# AI query POS via MCP → jawab

# Customer: "Buat PO 100 unit"
# AI buat order di POS → approval
```

### 🤖 AI Agent untuk Apapun
```bash
# Buat skill custom
cat > skills/my-skill.js << 'EOF'
export default () => ({
  manifest: { name: 'my-skill', version: '1.0.0', description: 'Custom skill' },
  tools: [{
    name: 'my_tool',
    description: 'My custom tool',
    parameters: { type: 'object', properties: {} },
    handler: async () => JSON.stringify({ result: 'Hello!' }),
  }],
});
EOF

# Skill langsung ter-load
./bin/wagent start
```

---

## 📦 Skills / Integrasi

WAGENT mendukung integrasi via **Skills** (plugins):

### Shipping (17+ Provider)
- **Aggregator:** RajaOngkir, Shipper, Biteship, KiriminAja, Popaket, Autokirim, APIKurir
- **Kurir:** JNE, J&T, SiCepat, AnterAja, TIKI, POS, Lion, Ninja Van, Grab

### Payment
- **Gateway:** Midtrans, Xendit
- **Manual:** Transfer Bank, COD, E-Wallet

### POS / E-Commerce
- Shopee, Tokopedia, WooCommerce
- Custom POS via REST API

### MCP (Model Context Protocol)
- Database: MySQL, PostgreSQL, MongoDB
- File System
- Custom API

Lihat [Dokumentasi Skills](./docs/skills.md) untuk detail.

---

## 🔌 MCP (Model Context Protocol)

WAGENT mendukung MCP untuk konek ke sistem eksternal:

```bash
# Connect ke MySQL via MCP
./bin/wagent mcp connect mysql-server

# Expose WAGENT tools ke AI lain
./bin/wagent mcp expose --stdio
./bin/wagent mcp expose --port 3001
```

---

## 📋 Commands

```bash
# Core
./bin/wagent init                  # Setup wizard
./bin/wagent start                 # Start agent
./bin/wagent status                # Cek status
./bin/wagent config                # Lihat config

# Knowledge Base
./bin/wagent kb list               # List KB
./bin/wagent kb upload <file>      # Upload file
./bin/wagent kb search "query"     # Search KB

# Skills
./bin/wagent skill list            # List skills
./bin/wagent skill install <path>  # Install skill

# MCP
./bin/wagent mcp list              # List MCP servers
./bin/wagent mcp test              # Test connections
./bin/wagent mcp expose            # Expose tools
```

---

## 🛠️ Tech Stack

```
Runtime      │ Bun ≥1.0 (ESM)
Language     │ TypeScript 5.7
Database     │ bun:sqlite (SQLite + WAL + FTS5)
AI Providers │ OpenAI / Gemini / Claude / Ollama
Embeddings   │ Gemini text-embedding-004 (768d)
WhatsApp     │ @whiskeysockets/baileys
CLI          │ Commander.js + picocolors
Dashboard    │ React 19 + Vite + Express + WebSocket
MCP          │ @modelcontextprotocol/sdk v2
Encryption   │ AES-256-GCM (Node crypto)
Logging      │ Pino structured logger
Testing      │ Vitest + coverage v8
```

---

## 📊 Test Coverage

```bash
cd packages/core
bun test --coverage
```

| Metrik | Nilai |
|:---|---:|
| **Lines** | **~83%** 🟢 |
| **Branches** | **~81%** 🟢 |
| **Functions** | **~91%** 🟢 |
| **Tests** | **712+** ✅ |

---

## 📖 Dokumentasi

| Dokumen | Deskripsi |
|---------|-----------|
| [📘 Getting Started](./docs/getting-started.md) | Instalasi & setup |
| [⚙️ Configuration](./docs/configuration.md) | Semua env vars |
| [🏗️ Architecture](./docs/architecture.md) | System design |
| [📟 CLI Commands](./docs/cli-commands.md) | Semua commands |
| [📚 Knowledge Base](./docs/knowledge-base.md) | KB + RAG |
| [🧩 Skills](./docs/skills.md) | Plugin system |
| [🔌 MCP](./docs/mcp.md) | Model Context Protocol |
| [🔐 Encryption](./docs/encryption.md) | Data protection |
| [🚨 Escalation](./docs/escalation.md) | Telegram setup |

---

## 🤝 Kontribusi

1. **Coding:** Buka issue, fork, buat PR
2. **Testing:** Coba install, laporkan bugs
3. **Skills:** Buat skill baru untuk integrasi
4. **Dokumentasi:** Bantu perbaiki docs

Lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk panduan.

---

## 📄 Lisensi

WAGENT dirilis di bawah lisensi **MIT**.

---

## 🙏 Kredit

- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web library
- [Model Context Protocol](https://modelcontextprotocol.io) — Standard for AI integrations
- [OpenAI](https://openai.com), [Google Gemini](https://ai.google.dev), [Anthropic Claude](https://anthropic.com), [Ollama](https://ollama.ai) — AI Providers
- [Bun](https://bun.sh) — Runtime & SQLite engine
- Semua kontributor open-source

---

<div align="center">
  <sub>Dibuat dengan ❤️ untuk bisnis Indonesia yang lebih cerdas</sub>
</div>
