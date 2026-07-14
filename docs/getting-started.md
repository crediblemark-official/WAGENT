# 🚀 Getting Started — WAGENT

Panduan lengkap instalasi, setup, dan first run WAGENT.

---

## Prasyarat

- **Bun** ≥ 1.0 (runtime & package manager)
- **Git** (untuk clone repository)
- Nomor WhatsApp yang aktif (bisa nomor biasa atau bisnis)
- API key dari minimal satu AI provider

### Cek Prasyarat

```bash
bun --version   # ≥ 1.0
git --version    # (opsional)
```

---

## Instalasi

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

### Global Command (opsional)

Biar bisa panggil `wagent` dari mana saja:

```bash
echo 'export PATH="/path/to/wagent/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Wizard interaktif akan memandu kamu melalui:
1. Pilih AI Provider (OpenAI / Gemini / Claude / Ollama)
2. Masukkan API key
3. Pilih model
4. Atur system prompt
5. Konfigurasi settings tambahan (opsional)

Setelah selesai, file `.env` akan dibuat otomatis.

### Alternatif: Setup Manual

Buat file `.env` di root project:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-2.0-flash
DATABASE_TYPE=sqlite
DATABASE_URL=data/wagent.db
DASHBOARD_PORT=3030
```

Minimal yang harus diisi:

```env
# Pilih salah satu AI provider
AI_PROVIDER=gemini

# Google Gemini (gratis, recommended)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash

# Atau OpenAI
# AI_PROVIDER=openai
# OPENAI_API_KEY=sk-proj-...
# OPENAI_MODEL=gpt-4o

# Atau Claude
# AI_PROVIDER=claude
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Atau Ollama (local)
# AI_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3

# System Prompt
AGENT_SYSTEM_PROMPT="Kamu adalah customer service yang ramah dan membantu."
```

> **💡 Tip:** Untuk testing, Gemini punya **free tier** yang generous. Recommended untuk pertama kali coba.

---

## First Run

### 1. Start WAGENT

```bash
wagent start
```

Kamu akan melihat output seperti:

```
╔══════════════════════════════════════╗
║     🤖 WAGENT WhatsApp AI Agent     ║
╚══════════════════════════════════════╝

[INFO] Database initialized
[INFO] AI Provider: Gemini
[INFO] WhatsApp connecting...
[INFO] Loaded 0 skill tools for AI agent

╔══════════════════════════════════════╗
║  Scan QR code ini dengan WhatsApp    ║
║  Buka WhatsApp > 3 titik >           ║
║  Perangkat Tertaut > Hubungkan       ║
╚══════════════════════════════════════╝
```

### 2. Scan QR Code

1. Buka WhatsApp di HP
2. Tap ikon **3 titik** (atau **Settings** di iOS)
3. Pilih **Perangkat Tertaut** (Linked Devices)
4. Tap **Hubungkan Perangkat** (Link a Device)
5. Scan QR code yang muncul di terminal

### 3. Selamat! 🎉

Setelah scan berhasil, WAGENT akan otomatis menjawab pesan yang masuk.

```
✓ WAGENT running!
  Press Ctrl+C to stop
```

---

## Verifikasi Setup

### Cek Status

```bash
wagent status
```

Output:
```
✓ Session folder ditemukan
  Location: /home/user/wagent/.sessions/wagent-session
✓ Credentials tersimpan (pernah login)
```

### Cek Konfigurasi

```bash
wagent config
```

### Kirim Test Message

Kirim pesan WhatsApp ke nomor yang sudah di-scan. Bot akan merespon dengan AI.

### Cek Log

```bash
wagent log -n 20  # Lihat 20 baris log terakhir
```

---

## Troubleshooting

### QR Code Tidak Muncul

```bash
# Hapus session lama
rm -rf .sessions/wagent-session
# Start ulang
wagent start
```

### AI Tidak Merespon

1. Cek API key: `wagent config`
2. Cek log: `wagent log -n 30`
3. Pastikan environment variable ter-set dengan benar

### Database Error

```bash
# Reset database (HATI-HATI: menghapus semua data)
rm -f data/wagent.db
```

### Port Dashboard Bentrok

```bash
wagent start --port 4040
```

---

## Next Steps

Setelah sukses menjalankan WAGENT:

1. 📚 **[Isi Knowledge Base](./knowledge-base.md)** — Tambah FAQ biar AI lebih pintar
2. 🚨 **[Setup Telegram Escalation](./escalation.md)** — Notifikasi ketika AI tidak bisa jawab
3. 🔐 **[Aktifkan Encryption](./encryption.md)** — Lindungi data customer
4. 🧩 **[Buat Skill Custom](./skills.md)** — Tambah kemampuan spesifik AI
5. 📟 **[Jelajahi CLI Commands](./cli-commands.md)** — Semua yang bisa dilakukan CLI
6. ⚙️ **[Konfigurasi Lanjutan](./configuration.md)** — Atur jam kerja, rate limit, dll
