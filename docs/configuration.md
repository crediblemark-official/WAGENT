# ⚙️ Configuration — WAGENT

Referensi lengkap semua environment variables dan opsi konfigurasi WAGENT.

---

## 📁 Cara Konfigurasi

WAGENT membaca konfigurasi dari (prioritas tinggi ke rendah):

1. **Environment variables** (export/set langsung)
2. **File `.env`** di root project
3. **File `.env.local`** (override `.env`)
4. **Default values** (built-in)

### Format `.env`

```env
# KEY=VALUE
# Komentar dengan #
AI_PROVIDER=gemini
```

### Prioritas

Environment variable > `.env.local` > `.env` > Default.

---

## 📋 Daftar Lengkap Environment Variables

### WhatsApp

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `WHATSAPP_SESSION_NAME` | `wagent-session` | Nama folder session WhatsApp |
| `WHATSAPP_SESSION_DIR` | `./.sessions` | Direktori penyimpanan session |

### AI Provider

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `AI_PROVIDER` | `openai` | Provider AI: `openai`, `gemini`, `claude`, `ollama` |
| `AGENT_SYSTEM_PROMPT` | (built-in) | System prompt untuk AI agent |

### OpenAI

| Variable | Required | Default | Deskripsi |
|----------|:--------:|---------|-----------|
| `OPENAI_API_KEY` | ✅ Jika provider=openai | — | API key dari platform.openai.com |
| `OPENAI_MODEL` | ❌ | `gpt-4o` | Model OpenAI |

**Model yang didukung:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`

### Google Gemini

| Variable | Required | Default | Deskripsi |
|----------|:--------:|---------|-----------|
| `GEMINI_API_KEY` | ✅ Jika provider=gemini | — | API key dari ai.google.dev |
| `GEMINI_MODEL` | ❌ | `gemini-2.0-flash` | Model Gemini |

**Model yang didukung:** `gemini-2.0-flash`, `gemini-2.0-pro`, `gemini-1.5-pro`

> **💡 Catatan:** Gemini juga digunakan untuk **embeddings** (RAG semantic search) dan **voice transcription** secara otomatis jika API key tersedia.

### Anthropic Claude

| Variable | Required | Default | Deskripsi |
|----------|:--------:|---------|-----------|
| `ANTHROPIC_API_KEY` | ✅ Jika provider=claude | — | API key dari anthropic.com |
| `ANTHROPIC_MODEL` | ❌ | `claude-sonnet-4-20250514` | Model Claude |

**Model yang didukung:** `claude-sonnet-4-20250514`, `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`

### Ollama (Local)

| Variable | Required | Default | Deskripsi |
|----------|:--------:|---------|-----------|
| `OLLAMA_BASE_URL` | ✅ Jika provider=ollama | — | URL Ollama server (e.g. `http://localhost:11434`) |
| `OLLAMA_MODEL` | ❌ | `llama3` | Model Ollama |

### Conversation Settings

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `WELCOME_MESSAGE` | `Halo! 👋 Ada yang bisa saya bantu hari ini?` | Pesan sambutan untuk customer baru |
| `WELCOME_MESSAGE_ENABLED` | `true` | Aktifkan pesan sambutan |
| `CONVERSATION_TIMEOUT_HOURS` | `24` | Jam sebelum percakapan idle otomatis dihapus (0 = nonaktif) |

### Rate Limiting

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `RATE_LIMIT_MAX` | `10` | Maksimal pesan per kontak dalam window |
| `RATE_LIMIT_WINDOW_SECONDS` | `10` | Jendela waktu rate limit (detik) |
| `RATE_LIMIT_MESSAGE` | (built-in) | Pesan ketika kena rate limit |

### Working Hours (Jam Operasional)

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `WORKING_HOURS_ENABLED` | `false` | Aktifkan jam operasional |
| `WORKING_HOURS_START` | `08:00` | Jam buka (HH:mm, 24h) |
| `WORKING_HOURS_END` | `17:00` | Jam tutup (HH:mm, 24h) |
| `WORKING_HOURS_TIMEZONE` | `Asia/Jakarta` | Timezone untuk jam operasional |
| `OFFLINE_MESSAGE` | (built-in) | Pesan otomatis di luar jam kerja |

**Contoh jam operasional:**

```env
WORKING_HOURS_ENABLED=true
WORKING_HOURS_START=09:00
WORKING_HOURS_END=21:00
WORKING_HOURS_TIMEZONE=Asia/Jakarta
OFFLINE_MESSAGE=Mohon maaf, saat ini di luar jam operasional 🙏
```

### Human Takeover

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `HUMAN_TAKEOVER_COOLDOWN_MINUTES` | `30` | Cooldown AI setelah human membalas (menit) |

**Cara kerja:**
1. Customer chat dengan AI
2. Human agent membalas dari WhatsApp Web
3. AI mendeteksi balasan human dan **berhenti** untuk chat ini
4. Setelah cooldown (default 30 menit), AI akan aktif kembali
5. Jika customer mengirim pesan baru setelah cooldown, AI akan respon

### Group Chat

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `GROUP_CHAT_ENABLED` | `false` | Izinkan proses pesan dari grup |
| `GROUP_CHAT_REPLY_IF_MENTIONED` | `true` | Hanya reply jika bot di-@mention |

### Escalation (Telegram)

| Variable | Required | Deskripsi |
|----------|:--------:|-----------|
| `TELEGRAM_BOT_TOKEN` | ❌ | Token bot dari @BotFather |
| `TELEGRAM_CHAT_ID` | ❌ | ID grup/channel Telegram untuk notifikasi |

Cara setup lengkap: [Escalation Guide](./escalation.md)

### Dashboard

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `DASHBOARD_PORT` | `3030` | Port web dashboard |
| `DASHBOARD_HOST` | `localhost` | Host dashboard |

### Database

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `DATABASE_TYPE` | `sqlite` | Tipe database (`sqlite`) |
| `DATABASE_URL` | `./data/wagent.db` | Path ke file database |

> **Catatan:** Untuk MVP v0.1, hanya SQLite yang didukung. Postgres akan datang di v0.2.

---

## 📝 Contoh File `.env` Lengkap

```env
# === WhatsApp ===
WHATSAPP_SESSION_NAME=wagent-session
WHATSAPP_SESSION_DIR=./.sessions

# === AI Provider ===
AI_PROVIDER=gemini
AGENT_SYSTEM_PROMPT="Kamu adalah customer service yang ramah dan membantu. Jawab dengan bahasa Indonesia yang sopan dan natural. Gunakan emoji sesekali untuk kesan ramah."

# Gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.0-flash

# OpenAI (comment out jika pakai Gemini)
# AI_PROVIDER=openai
# OPENAI_API_KEY=sk-proj-...
# OPENAI_MODEL=gpt-4o

# === Conversation ===
WELCOME_MESSAGE="Halo! 👋 Ada yang bisa saya bantu hari ini?"
WELCOME_MESSAGE_ENABLED=true
CONVERSATION_TIMEOUT_HOURS=24

# === Rate Limiting ===
RATE_LIMIT_MAX=10
RATE_LIMIT_WINDOW_SECONDS=10
RATE_LIMIT_MESSAGE="Mohon tunggu sebentar ya, Anda terlalu cepat mengirim pesan. 😊"

# === Working Hours ===
WORKING_HOURS_ENABLED=true
WORKING_HOURS_START=08:00
WORKING_HOURS_END=17:00
WORKING_HOURS_TIMEZONE=Asia/Jakarta
OFFLINE_MESSAGE="Mohon maaf, saat ini di luar jam operasional 🙏"

# === Human Takeover ===
HUMAN_TAKEOVER_COOLDOWN_MINUTES=30

# === Group Chat ===
GROUP_CHAT_ENABLED=false
GROUP_CHAT_REPLY_IF_MENTIONED=true

# === Escalation ===
# TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234...
# TELEGRAM_CHAT_ID=-123456789

# === Dashboard ===
DASHBOARD_PORT=3030
DASHBOARD_HOST=localhost

# === Database ===
DATABASE_TYPE=sqlite
DATABASE_URL=./data/wagent.db
```

---

## 🔒 Environment Encryption

Untuk keamanan, file `.env` bisa dienkripsi:

```bash
# Generate key
wagent crypto init

# Export key
export OPENCE_ENCRYPTION_KEY=abc123...

# Encrypt .env
wagent crypto encrypt
```

WAGENT akan auto-decrypt saat startup jika key tersedia.

Lihat [Encryption Guide](./encryption.md) untuk detail.

---

## 🎯 Multi-Number Configuration

Untuk multi-number, tambahkan nomor via CLI:

```bash
# Tambah nomor CS-1
wagent number add cs-1 session-cs-1 "Customer Service 1"

# Tambah nomor CS-2
wagent number add cs-2 session-cs-2 "Customer Service 2"

# Lihat daftar nomor
wagent number list
```

Konfigurasi disimpan di `data/numbers.json`.

---

## Best Practices

### Production
1. **Always encrypt** `.env` dan database dengan `wagent crypto`
2. **Set working hours** untuk menghindari spam di luar jam kerja
3. **Config rate limit** sesuai volume chat
4. **Setup Telegram escalation** untuk menangani kasus yang AI tidak bisa jawab
5. **Isi Knowledge Base** untuk meningkatkan akurasi AI
6. **Gunakan PM2 / systemd** untuk auto-restart jika crash

### Development
1. Gunakan **Ollama** untuk testing lokal (gratis, tanpa API key)
2. Gunakan **Gemini** untuk testing (free tier generous)
3. Set `CONVERSATION_TIMEOUT_HOURS=0` untuk disable auto-clear
