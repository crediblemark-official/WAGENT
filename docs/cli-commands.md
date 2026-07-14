# 📟 CLI Commands — WAGENT

Referensi lengkap semua perintah CLI WAGENT.

---

## 📋 Daftar Perintah

| Perintah | Deskripsi |
|----------|-----------|
| `init` | Setup wizard interaktif |
| `start` | Mulai WAGENT Gateway |
| `config` | Lihat konfigurasi saat ini |
| `status` | Cek status koneksi WhatsApp |
| `log` | Lihat log terbaru |
| `kb` | Kelola knowledge base |
| `number` | Kelola multi-number |
| `crypto` | Kelola enkripsi data |
| `escalation` | Tes notifikasi Telegram |
| `skill` | Kelola plugin / skills |

---

## 🚀 Perintah Utama

### `wagent init` — Setup Wizard

Jalankan setup wizard interaktif untuk konfigurasi awal.

```bash
wagent init
# atau dengan enkripsi otomatis
wagent init --encrypt
```

Wizard akan memandu melalui:
1. Pilih AI Provider
2. Masukkan API key dan model
3. Atur system prompt
4. Konfigurasi tambahan (opsional)

Setelah selesai, file `.env` akan dibuat.

**Options:**
| Flag | Deskripsi |
|------|-----------|
| `--encrypt` | Generate encryption key dan enkripsi semua data setelah setup |

---

### `wagent start` — Mulai Gateway

Memulai WAGENT Gateway (WhatsApp + AI Agent).

```bash
wagent start
```

**Options:**
| Flag | Default | Deskripsi |
|------|---------|-----------|
| `-p, --port <port>` | `3030` | Port untuk dashboard web |
| `--no-dashboard` | — | Jalankan tanpa dashboard web |

**Contoh:**
```bash
# Start dengan port kustom
wagent start --port 8080

# Start tanpa dashboard
wagent start --no-dashboard
```

**Proses:**
1. Load config dari `.env`
2. Initialize database SQLite
3. Initialize WhatsApp adapter
4. Load skills dari folder `skills/`
5. Create Gateway dengan semua komponen
6. Scan QR code WhatsApp
7. Dashboard tersedia di `http://localhost:{port}`

---

### `wagent config` — Lihat Konfigurasi

Tampilkan konfigurasi yang sedang aktif (tanpa nilai sensitif penuh).

```bash
wagent config
```

**Output contoh:**
```
Current Configuration:
──────────────────────────────
  WhatsApp Session : wagent-session
  AI Provider      : gemini
  System Prompt    : Kamu adalah customer service yang ramah...
  Dashboard Port   : 3030
  Database         : sqlite (./data/wagent.db)

  Gemini Model     : gemini-2.0-flash
  Gemini Key       : AIzaSy... (truncated)
```

---

### `wagent status` — Cek Status

Cek status koneksi WhatsApp.

```bash
wagent status
```

**Output contoh:**
```
✓ Session folder ditemukan
  Location: /home/user/wagent/.sessions/wagent-session
✓ Credentials tersimpan (pernah login)
```

---

### `wagent log` — Lihat Log

Lihat log WAGENT terbaru.

```bash
wagent log -n 50   # Lihat 50 baris terakhir
wagent log         # Default: 50 baris
```

**Options:**
| Flag | Default | Deskripsi |
|------|---------|-----------|
| `-n, --lines <number>` | `50` | Jumlah baris log yang ditampilkan |

---

## 📚 Knowledge Base Commands

### `wagent kb list` — Lihat Semua Entri

```bash
wagent kb list
wagent kb list -c pengiriman    # Filter kategori
```

**Options:**
| Flag | Deskripsi |
|------|-----------|
| `-c, --category <category>` | Filter berdasarkan kategori |

---

### `wagent kb add` — Tambah Entri Baru

```bash
wagent kb add \
  -a "Ongkir Jakarta mulai Rp10.000" \
  -q "Berapa ongkir ke Jakarta?" \
  -c pengiriman \
  -k "ongkir,ongkos kirim,biaya kirim,shipping" \
  -t "jakarta,promo" \
  -p 4
```

**Options:**
| Flag | Required | Default | Deskripsi |
|------|:--------:|---------|-----------|
| `-a, --answer <answer>` | ✅ | — | Jawaban / konten informasi |
| `-q, --question <question>` | ❌ | — | Pertanyaan (untuk referensi) |
| `-c, --category <category>` | ❌ | `general` | Kategori |
| `-k, --keywords <keywords>` | ❌ | — | Kata kunci, pisah dengan koma |
| `-t, --tags <tags>` | ❌ | — | Tags, pisah dengan koma |
| `-p, --priority <priority>` | ❌ | `0` | Prioritas (1-5) |

---

### `wagent kb remove <id>` — Hapus Entri

```bash
wagent kb remove kb-1712345678-abcd
```

---

### `wagent kb search <query>` — Cari di KB

```bash
wagent kb search "ongkir jakarta"
wagent kb search "jam operasional" -c operasional
wagent kb search "retur" -n 10
```

**Options:**
| Flag | Default | Deskripsi |
|------|---------|-----------|
| `-c, --category <category>` | — | Filter kategori |
| `-n, --limit <number>` | `5` | Jumlah hasil maksimal |

---

### `wagent kb seed` — Seed dari File

Isi database dengan contoh FAQ dari file `kb-seed.md`.

```bash
wagent kb seed
wagent kb seed --clear   # Hapus semua entri dulu, lalu seed
```

**Options:**
| Flag | Deskripsi |
|------|-----------|
| `--clear` | Hapus semua entri yang ada sebelum seed |

Format file `kb-seed.md`:

```markdown
id: kb-001
category: pengiriman
question: Berapa lama pengiriman?
keywords: lama pengiriman, estimasi, sampai
priority: 5
---
Jawaban di sini...

---

id: kb-002
category: refund
...
```

---

### `wagent kb categories` — Lihat Kategori

```bash
wagent kb categories
```

---

## 🔐 Encryption Commands

### `wagent crypto init` — Generate Key

Generate encryption key untuk AES-256-GCM.

```bash
wagent crypto init
```

Output:
```
🔐 Encryption Key Generated

⚠️  SIMPAN KEY INI — TIDAK BISA DIPULIHKAN!
  ┌─────────────────────────────────────────────────────────────┐
  │ a1b2c3d4e5f6...7890abcdef1234567890abcdef1234567890abcdef │
  └─────────────────────────────────────────────────────────────┘

  Export key:
  export OPENCE_ENCRYPTION_KEY=a1b2c3d4e5f6...7890abcdef
```

---

### `wagent crypto encrypt` — Enkripsi Data

Enkripsi semua data sensitif (.env, session, database, config).

```bash
# Pastikan key sudah di-export
export OPENCE_ENCRYPTION_KEY=your_key_here
wagent crypto encrypt
```

**Yang dienkripsi:**
- `.env` → `.env.encrypted`
- Session files (.json, .bin) → `.encrypted`
- `numbers.json` → `numbers.json.encrypted`
- Database `wagent.db` → `wagent.db.encrypted`

---

### `wagent crypto decrypt` — Dekripsi Data

Kebalikan dari encrypt: mengembalikan semua file ke plaintext.

```bash
export OPENCE_ENCRYPTION_KEY=your_key_here
wagent crypto decrypt
```

---

### `wagent crypto status` — Cek Status Enkripsi

```bash
wagent crypto status
```

Output:
```
🔐 Encryption Status
────────────────────────────
  Key           : ✓ Terpasang
  .env          : 🔒 Terenkripsi
  Session files : 🔒 12 file
  Database      : 🔒 Terenkripsi
```

---

## 📱 Number Commands

### `wagent number list` — Lihat Semua Nomor

```bash
wagent number list
```

Output:
```
📱 Multi-Number Configuration
────────────────────────────────────
  cs-1
    Label       : Customer Service 1
    Session     : session-cs-1
    Status      : ✅ Siap (pernah login)
    Enabled     : ✓

  cs-2
    Label       : Customer Service 2
    Session     : session-cs-2
    Status      : ❌ Belum ada session
    Enabled     : ✓
```

---

### `wagent number add <id> <sessionName> [label]` — Tambah Nomor

```bash
wagent number add cs-1 session-cs-1 "Customer Service 1"
```

---

### `wagent number remove <id>` — Hapus Nomor

```bash
wagent number remove cs-1
wagent number remove cs-1 --force   # Tanpa konfirmasi
```

---

## 🚨 Escalation Command

### `wagent escalation test` — Tes Telegram

Kirim test escalation ke Telegram untuk verifikasi konfigurasi.

```bash
wagent escalation test
wagent escalation test -m "Pesan test kustom"
```

**Options:**
| Flag | Default | Deskripsi |
|------|---------|-----------|
| `-m, --message <message>` | (built-in) | Pesan test yang dikirim |

---

## 🧩 Skill Commands

### `wagent skill list` — Lihat Skills Terinstall

```bash
wagent skill list
```

Output:
```
🧩 WAGENT Skills
──────────────────────────
  my-skill v1.0.0
    Custom skill untuk cek saldo
    Tools: cek_saldo
```

---

### `wagent skill install <path>` — Install Skill

```bash
wagent skill install ./path/to/my-skill.js
```

---

### `wagent skill remove <name>` — Hapus Skill

```bash
wagent skill remove my-skill
```

---

## 🏃‍♂️ Quick Reference

```bash
# Setup
wagent init                    # Setup wizard
wagent init --encrypt          # Setup + enkripsi

# Run
wagent start                   # Start Gateway
wagent start --port 8080       # Start dengan port kustom

# Info
wagent config                  # Lihat config
wagent status                  # Cek WhatsApp status
wagent log -n 30               # Lihat log

# Knowledge Base
wagent kb add -a "Jawaban" -q "Pertanyaan" -c kategori
wagent kb list                 # Lihat semua
wagent kb search "query"       # Cari
wagent kb seed --clear         # Seed dari file

# Encryption
wagent crypto init             # Generate key
wagent crypto encrypt          # Enkripsi data
wagent crypto decrypt          # Dekripsi data
wagent crypto status           # Cek status

# Multi-Number
wagent number list             # Lihat nomor
wagent number add cs-1 session-cs-1 "Label"

# Escalation
wagent escalation test         # Tes Telegram

# Skills
wagent skill list              # Lihat skills
wagent skill install ./skill.js
```
