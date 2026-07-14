# 🚨 Escalation — WAGENT

Dokumentasi tentang fitur eskalasi ke Telegram ketika AI tidak bisa menjawab pertanyaan customer.

---

## 📖 Apa Itu Escalation?

Escalation adalah mekanisme dimana WAGENT mengirim notifikasi ke grup Telegram ketika AI membutuhkan bantuan manusia. Ini memastikan tidak ada customer yang terabaikan meskipun AI tidak bisa menjawab.

### Kapan Escalation Terjadi?

| Kondisi | Trigger | Contoh Pesan |
|---------|---------|--------------|
| **AI Error** | Provider AI error (timeout, rate limit, dsb) | `⚠️ Alasan: Error AI provider 🔴` |
| **Empty Response** | AI tidak mengembalikan jawaban | `⚠️ Alasan: AI tidak bisa memberikan jawaban ❓` |
| **AI Explicit** | AI memanggil tool `escalate_to_human` | `⚠️ Alasan: AI meminta bantuan manusia 🙋` |
| **AI Can't Answer** | AI merespon singkat dengan kata "tidak tahu" | `⚠️ Alasan: AI tidak bisa memberikan jawaban ❓` |

### Deduplication

WAGENT menggunakan **60-second cooldown** per contact untuk mencegah spam escalation:

```typescript
private canEscalate(contactId: string): boolean {
  const lastTime = this.recentEscalations.get(contactId);
  const now = Date.now();
  if (lastTime && (now - lastTime) < 60_000) return false;
  this.recentEscalations.set(contactId, now);
  return true;
}
```

---

## 🔧 Setup Telegram Bot

### 1. Buat Bot Telegram

1. Buka Telegram dan cari **@BotFather**
2. Kirim perintah `/newbot`
3. Ikuti instruksi:
   - Masukkan **nama bot** (e.g., "WAGENT Escalation")
   - Masukkan **username** (e.g., `wagent_escalation_bot`)
4. Simpan **token** yang diberikan (format: `123456789:ABCdefGHIjkl...`)

### 2. Buat Grup Telegram

1. Buat grup baru di Telegram (e.g., "WAGENT CS Team")
2. Tambahkan bot ke grup sebagai admin
3. Kirim pesan di grup (biar ada aktivitas)

### 3. Dapatkan Chat ID

**Metode 1: @getidsbot**
1. Cari **@getidsbot** di Telegram
2. Forward pesan dari grup ke bot
3. Bot akan membalas dengan ID grup

**Metode 2: Manual via API**
```bash
# Ganti TOKEN dengan token bot kamu
curl https://api.telegram.org/bot<TOKEN>/getUpdates

# Cari "chat":{"id":-123456789,...} di response
# Chat ID grup biasanya negatif
```

### 4. Konfigurasi di WAGENT

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklmnopQRStuVWXyz
TELEGRAM_CHAT_ID=-123456789
```

### 5. Test Escalation

```bash
wagent escalation test
# atau dengan pesan kustom
wagent escalation test -m "Test dari WAGENT"
```

Jika berhasil, kamu akan menerima notifikasi di grup Telegram.

---

## 📝 Format Pesan Escalation

Pesan escalation dikirim dengan format HTML Telegram:

```
🚨 ESCALATION — AI butuh bantuan manusia

👤 Pelanggan: Budi Santoso
📱 Nomor: 6281234567890
⚠️ Alasan: AI tidak bisa memberikan jawaban ❓
📋 Detail: AI tidak mengembalikan response apapun

💬 Pesan customer:
Saya mau tanya tentang produk terbaru

⚠️ Balas customer ini melalui WhatsApp Web.
AI akan berhenti otomatis.
```

### Komponen Pesan:
1. **Header:** 🚨 ESCALATION + reason icon
2. **Info pelanggan:** Nama dan nomor (linkable)
3. **Alasan:** Kenapa escalation terjadi
4. **Detail tambahan:** Error message atau konteks
5. **Pesan customer:** Asli, tanpa modifikasi
6. **Dashboard link:** Jika dashboard aktif
7. **Instruksi:** Pengingat untuk reply via WhatsApp Web

---

## 🔄 Human Takeover

### Cara Kerja

```
1. Customer chat dengan AI
2. AI tidak bisa jawab → escalation ke Telegram
3. Human agent lihat notifikasi di grup Telegram
4. Human agent buka WhatsApp Web
5. Human agent balas customer dari WhatsApp Web
6. WAGENT mendeteksi balasan (fromMe + not in DB)
7. AI otomatis berhenti untuk chat ini
8. Event "human:active" dikirim ke dashboard
9. Setelah cooldown (default 30 menit):
   a. Event "human:inactive" dikirim
   b. AI aktif kembali untuk chat ini
```

### Konfigurasi Cooldown

```env
# Default: 30 menit
HUMAN_TAKEOVER_COOLDOWN_MINUTES=30
```

**Rekomendasi:**
- **15 menit:** Cepat, cocok untuk CS yang responsif
- **30 menit:** Default — balance
- **60 menit:** Lambat, cocok untuk tim dengan volume rendah

### Deteksi Balasan Human

WAGENT mendeteksi balasan human dengan mengecek:
1. **`fromMe: true`** — Pesan dikirim dari WhatsApp Web/Desktop
2. **`messageExists(id) === false`** — Pesan tidak ada di DB (bukan dari AI)
3. Jika kedua kondisi terpenuhi → **human takeover aktif**

---

## 🤖 Escalation via AI Tool

AI juga bisa secara eksplisit memanggil escalation:

```typescript
// Built-in tool: escalate_to_human
{
  name: 'escalate_to_human',
  description: 'MINTA BANTUAN MANUSIA. Gunakan tool ini jika kamu tidak bisa menjawab pertanyaan customer, tidak yakin dengan jawaban, atau customer meminta bicara dengan manusia.',
  parameters: {
    reason: 'Pertanyaan di luar pengetahuan',
    customerQuestion: 'Saya mau komplain tentang...',
  }
}
```

AI dilatih untuk menggunakan tool ini ketika:
- Customer meminta bicara dengan manusia
- Customer komplain / marah
- Customer bertanya di luar pengetahuan AI
- AI tidak yakin dengan jawaban

---

## 🛠️ CLI Commands

### Test Escalation

```bash
wagent escalation test
wagent escalation test -m "Test dari WAGENT"
```

Output sukses:
```
🚨 Mengirim test escalation ke Telegram...

  Chat ID: -123456789
  Token  : 123456789...

✅ Escalation berhasil dikirim ke Telegram!
  Cek grup Telegram untuk melihat pesan test.
```

Output gagal:
```
✗ Gagal mengirim escalation.
  Periksa:
  1. Token bot valid? (buat di @BotFather)
  2. Bot sudah ditambahkan ke grup?
  3. Chat ID benar? (gunakan @getidsbot untuk cek)
```

---

## 📊 Best Practices

1. **Buat grup khusus** untuk notifikasi escalation — jangan campur dengan chat lain
2. **Tambahkan admin bot** ke grup agar bisa kirim pesan
3. **Aktifkan notifikasi grup** di Telegram biar langsung tahu
4. **Setup dashboard** agar human agent bisa lihat konteks lengkap
5. **Atur cooldown** sesuai dengan kapasitas tim CS
6. **Isi Knowledge Base** dengan baik — semakin lengkap KB, semakin jarang escalation

### Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Tidak dapat escalation | Cek `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` |
| Bot not responding | Buat ulang token di @BotFather |
| "Chat not found" | Tambahkan bot ke grup sebagai admin |
| Spam escalation | Biarkan (60s cooldown akan handle) |
| AI tidak escalate | Cek log: AI mungkin pikir bisa jawab |
