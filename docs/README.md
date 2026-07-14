# 📖 OpenCS Documentation

Selamat datang di dokumentasi **OpenCS** — WhatsApp AI Customer Service Agent.

---

## 🚀 Mulai Cepat

| Dokumen | Deskripsi |
|---------|-----------|
| [Getting Started](./getting-started.md) | Instalasi, setup, first run |
| [Quick Start (README)](../README.md) | 1 menit setup |

---

## ⚙️ Konfigurasi

| Dokumen | Deskripsi |
|---------|-----------|
| [Configuration Reference](./configuration.md) | Semua environment variables |
| [.env Example](../.env.example) | Template file .env |

---

## 🏛️ Arsitektur

| Dokumen | Deskripsi |
|---------|-----------|
| [Architecture Overview](./architecture.md) | System design, components, data flow |
| [PRD](../PRD.md) | Product Requirements Document |

---

## 📟 CLI

| Dokumen | Deskripsi |
|---------|-----------|
| [CLI Commands](./cli-commands.md) | Semua perintah dengan contoh |

---

## ✨ Fitur

| Dokumen | Deskripsi |
|---------|-----------|
| [Knowledge Base + RAG](./knowledge-base.md) | FAQ management, semantic search, embeddings |
| [Encryption (AES-256-GCM)](./encryption.md) | Data protection at-rest |
| [Escalation to Telegram](./escalation.md) | Notifikasi ke Telegram + human takeover |
| [Skills / Plugin System](./skills.md) | Membuat dan menginstall plugin |

---

## 📋 Status Project

| Metrik | Nilai |
|:---|---:|
| **Tests** | 620 ✅ |
| **Lines coverage** | ~92% 🟢 |
| **Branches coverage** | ~81% 🟢 |
| **Functions coverage** | ~91% 🟢 |
| **Node version** | ≥18 ✅ |

### Package Status

| Package | Status | Description |
|---------|:------:|-------------|
| `@opencs/core` | ✅ Production-ready | Engine utama (gateway, agent, storage, dll) |
| `@opencs/cli` | ✅ Production-ready | Command-line interface |
| `@opencs/whatsapp` | 🟡 In Progress | Baileys WhatsApp adapter |
| `@opencs/dashboard` | 🟡 In Progress | Web UI (React) |
| `@opencs/tui` | 🟡 In Progress | Terminal setup wizard |

---

## 🔗 Link Penting

- [GitHub Repository](https://github.com/yourusername/opencs)
- [Issue Tracker](https://github.com/yourusername/opencs/issues)
- [PRD (Product Requirements)](../PRD.md)
