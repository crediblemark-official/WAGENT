# 🔐 Encryption — WAGENT

Dokumentasi tentang enkripsi data di WAGENT menggunakan AES-256-GCM.

---

## 📖 Overview

WAGENT menggunakan **AES-256-GCM** (Advanced Encryption Standard dengan 256-bit key dan Galois/Counter Mode) untuk melindungi data sensitif.

**Kenapa AES-256-GCM?**
- **Standar industri:** Digunakan oleh pemerintah dan institusi finansial
- **Authenticated encryption:** GCM menyediakan integrity check (deteksi modifikasi)
- **Fast:** Performa hardware-accelerated di CPU modern (AES-NI)
- **Node.js native:** Tidak perlu library tambahan (menggunakan `crypto` module)

---

## 🔑 Key Management

### Key Generation

Key dihasilkan dengan `crypto.randomBytes(32)` → 64 karakter hex string:

```bash
wagent crypto init
```

Output:
```
🔐 Encryption Key Generated

⚠️  SIMPAN KEY INI — TIDAK BISA DIPULIHKAN!
  ┌─────────────────────────────────────────────────────────────┐
  │ a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0 │
  └─────────────────────────────────────────────────────────────┘

  Export key:
  export OPENCE_ENCRYPTION_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### Key Storage

Key **tidak disimpan** di file — hanya di environment variable:

```bash
# Export manual setiap session
export OPENCE_ENCRYPTION_KEY=a1b2c3d4e5f6...

# Atau tambah ke ~/.bashrc / ~/.zshrc
echo 'export OPENCE_ENCRYPTION_KEY=a1b2c3d4e5f6...' >> ~/.bashrc
source ~/.bashrc
```

### ⚠️ Peringatan

> **KEAMANAN:** Key adalah satu-satunya cara untuk mendekripsi data. **Tidak ada "lupa password" atau "reset key"**. Jika key hilang, **semua data terenkripsi tidak bisa dipulihkan**.

---

## 🗄️ Data yang Dienkripsi

| Data | File | Encrypted Extension |
|------|------|--------------------|
| Environment config | `.env` | `.env.encrypted` |
| Database | `wagent.db` | `wagent.db.encrypted` |
| WhatsApp session | `.sessions/**/*.json` | `.json.encrypted` |
| WhatsApp session | `.sessions/**/*.bin` | `.bin.encrypted` |
| Number config | `data/numbers.json` | `numbers.json.encrypted` |

---

## 📦 File Format

Setiap file terenkripsi memiliki format:

```
┌─────────┬────────┬────────────────┐
│ IV (16) │ Tag (16) │ Encrypted Data │
│  bytes  │  bytes  │    (variabel)   │
└─────────┴────────┴────────────────┘
```

- **IV:** Initialization Vector (random, unik setiap enkripsi)
- **Tag:** Authentication tag (GMAC — mendeteksi modifikasi data)
- **Encrypted Data:** Ciphertext (sama panjang dengan plaintext)

Total overhead: hanya **32 bytes** per file.

---

## 🔄 Alur Enkripsi/Dekripsi

### Encryption Flow

```
Plaintext file (e.g., .env)
    │
    ▼
generateRandomIV() → 16 bytes
    │
    ▼
cipher = createCipheriv('aes-256-gcm', key, iv)
    │
    ▼
encrypted = cipher.update(data) + cipher.final()
tag = cipher.getAuthTag()
    │
    ▼
Write File: [IV(16)] [Tag(16)] [Encrypted]
    = .env.encrypted
    │
    ▼
Delete original file
```

### Decryption Flow

```
.encrypted file (e.g., .env.encrypted)
    │
    ▼
Parse: IV(16) + Tag(16) + Encrypted
    │
    ▼
decipher = createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(tag)
    │
    ▼
plaintext = decipher.update(encrypted) + decipher.final()
    │
    ▼
Write original file (e.g., .env)
    │
    ▼
Delete .encrypted file
```

### Auto-Encrypt/Decrypt

WAGENT melakukan auto-decrypt saat startup dan auto-encrypt saat shutdown:

```
Startup:
  1. Cek: .env.encrypted exists + key available?
     → YES: decrypt .env.encrypted → .env
  2. Cek: wagent.db.encrypted exists + key available?
     → YES: decrypt → wagent.db
  3. Load config & start Gateway

Shutdown:
  1. Close database
  2. Key available?
     → YES: encrypt wagent.db → wagent.db.encrypted → delete original
```

---

## 🛠️ CLI Commands

### Generate Key & Setup

```bash
# Generate key dan export instructions
wagent crypto init

# Export key
export OPENCE_ENCRYPTION_KEY=a1b2c3d4e5f6...

# Enkripsi semua data
wagent crypto encrypt
```

### Enkripsi

```bash
wagent crypto encrypt

# Output:
#   ✓ .env → .env.encrypted
#   ✓ Session: 12 file terenkripsi
#   ✓ numbers.json → numbers.json.encrypted
#   ✓ Database → wagent.db.encrypted
# ✅ 15 item berhasil dienkripsi.
```

### Dekripsi

```bash
wagent crypto decrypt

# Output:
#   ✓ .env.encrypted → .env
#   ✓ Session: 12 file didekripsi
#   ✓ Database: wagent.db.encrypted → wagent.db
# ✅ 14 item berhasil didekripsi.
```

### Status

```bash
wagent crypto status

# Output:
# 🔐 Encryption Status
#   Key           : ✓ Terpasang
#   .env          : 🔒 Terenkripsi
#   Session files : 🔒 12 file
#   Database      : 🔒 Terenkripsi
```

---

## 🔧 Enkripsi Database At-Rest

Database secara otomatis dienkripsi saat `db.close()` dipanggil:

```typescript
// Di dalam Database.close():
close(): void {
  this.db.close();
  if (this.encryptionKey) {
    encryptFile(dbPath, this.encryptionKey, true); // delete original
  }
}
```

**Trigger close:**
- Gateway `stop()` → memanggil `db.close()`
- CLI commands (`kb list`, `kb add`, dll) → `db.close()` setelah selesai

---

## 💡 Best Practices

1. **Backup key** di password manager (Bitwarden, 1Password, dll)
2. **Jangan simpan key** di file yang sama dengan data terenkripsi
3. **Export key** di profile startup (`~/.bashrc`, `~/.zshrc`, atau systemd env)
4. **Rotate key** secara periodik (dekripsi semua → enkripsi ulang dengan key baru)
5. **Test decrypt** secara berkala untuk memastikan key masih valid

### Production Deployment

Untuk production, recommended setup:

```bash
# Systemd service environment
# /etc/systemd/system/wagent.service
[Service]
Environment=OPENCE_ENCRYPTION_KEY=a1b2c3d4...
ExecStart=/usr/bin/wagent start

# Pastikan hanya root yang bisa baca file service
chmod 600 /etc/systemd/system/wagent.service
```

---

## 🔬 Technical Detail

### Algoritma

| Parameter | Value |
|-----------|-------|
| **Algorithm** | AES-256-GCM |
| **Key size** | 256 bits (32 bytes) |
| **IV size** | 128 bits (16 bytes) |
| **Tag size** | 128 bits (16 bytes) |
| **Mode** | GCM (Galois/Counter Mode) |
| **Node module** | `crypto` (built-in) |

### Fungsi Crypto

```typescript
// Generate random 256-bit key
generateEncryptionKey(): string
  → randomBytes(32).toString('hex')

// Core encryption
encrypt(data: Buffer, key: Buffer): { encrypted, iv, tag }

// Core decryption
decrypt({ encrypted, iv, tag }, key): Buffer

// Convenience: string → base64
encryptString(plaintext, key): string
decryptString(ciphertext, key): string

// File-level
encryptFile(filePath, key, deleteOriginal): encryptedPath
decryptFile(encPath, key, deleteEncrypted): originalPath

// Directory-level (recursive)
encryptDirectory(dirPath, key, deleteOriginal): count
decryptDirectory(dirPath, key, deleteEncrypted): count

// .env-specific
encryptEnvFile(envPath, key): encryptedPath | null
decryptEnvFile(envPath, key): originalPath | null
```
