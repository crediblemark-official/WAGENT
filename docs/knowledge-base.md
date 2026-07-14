# 📚 Knowledge Base — WAGENT

Dokumentasi lengkap tentang Knowledge Base dengan RAG (Retrieval-Augmented Generation) dan semantic search.

---

## 📖 Apa Itu Knowledge Base?

Knowledge Base (KB) adalah kumpulan FAQ/informasi bisnis yang bisa dicari oleh AI untuk menjawab pertanyaan customer secara akurat.

**Tanpa KB:** AI hanya mengandalkan pengetahuan umum dan system prompt. Jawaban bisa kurang akurat atau halusinasi.

**Dengan KB:** AI mencari informasi spesifik dari database internal sebelum menjawab — menghasilkan jawaban yang faktual dan sesuai dengan bisnis kamu.

---

## 🧠 RAG Architecture

```
Customer: "Berapa ongkir ke Jakarta?"
        │
        ▼
┌─────────────────────────────────────┐
│  search_knowledge_base tool         │
│  (dipanggil oleh AI Agent)          │
└──────────────┬──────────────────────┘
               │
      ┌────────▼────────┐
      │  Gemini API      │
      │  generateEmbed-  │
      │  ding(query)     │
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │  SQLite DB      │
      │  cosine sim     │
      │  search         │
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │  Top-K results  │
      │  sorted by      │
      │  relevance      │
      └────────┬────────┘
               │
               ▼
AI: "Ongkir ke Jakarta mulai Rp10.000 untuk
     pengiriman standar (3-5 hari kerja)."
```

### Two-Layer Search Strategy

```
search_knowledge_base(query)
    │
    ├── Try: Semantic Search (Gemini embedding)
    │   ├── ✅ Success → return cosine similarity results
    │   └── ❌ Fail/no key → fallback to keyword
    │
    └── Keyword Search (original method)
        └── Score by keyword → question → answer match
        
    → Filter by category (optional)
    → Return top-K results sorted by relevance
    → Mark results with search method ('semantic' | 'keyword')
```

### Scoring Systems

**Semantic Search (cosine similarity):**
- Range: 0 to 1 (higher = more similar)
- Threshold default: 0.3
- Dimensi: 768 (Gemini text-embedding-004)
- Results returned: maxResults × 2 (before category filter)

**Keyword Search (hybrid scoring):**
- Keyword match: 1.0 × (matched keywords / total keywords)
- Question match: 0.8 × (matched query words / total query words)
- Answer match: 0.5 × (matched query words / total query words)
- Priority boost: score × (1 + priority × 0.1)
- Final score capped at 1.0

---

## 🗄️ Database Structure

```sql
CREATE TABLE knowledge_base (
  id          TEXT PRIMARY KEY,
  category    TEXT DEFAULT 'general',
  question    TEXT DEFAULT '',
  answer      TEXT NOT NULL,
  keywords    TEXT DEFAULT '[]',     -- JSON array of strings
  tags        TEXT DEFAULT '[]',     -- JSON array of strings
  priority    INTEGER DEFAULT 0,     -- 0-5
  embedding   TEXT,                  -- JSON array of 768 floats
  created_at  TEXT,
  updated_at  TEXT
);

-- Indexes
CREATE INDEX idx_kb_category ON knowledge_base(category);
CREATE INDEX idx_kb_priority ON knowledge_base(priority);
-- embedding column added via ALTER TABLE migration (v0.1)
```

**KnowledgeEntry Type:**
```typescript
interface KnowledgeEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string[];
  tags: string[];
  priority: number;        // 0-5, higher = more important
  embedding?: number[];    // 768-dim float array (optional)
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 🛠️ Manajemen KB via CLI

### Menambah Entri

```bash
# Minimal
wagent kb add -a "Jawabannya adalah..."

# Lengkap
wagent kb add \
  -a "Ongkir Jakarta mulai Rp10.000 untuk pengiriman standar (3-5 hari). Pengiriman express (1 hari) Rp25.000." \
  -q "Berapa ongkir ke Jakarta?" \
  -c pengiriman \
  -k "ongkir,ongkos kirim,biaya kirim,shipping,courier" \
  -t "jakarta,standar,express" \
  -p 4
```

### Melihat Entri

```bash
# Semua entri
wagent kb list

# Filter kategori
wagent kb list -c pengiriman
```

### Mencari

```bash
# Cari dengan keyword atau pertanyaan
wagent kb search "ongkir jakarta berapa"
wagent kb search "retur barang" -c refund
wagent kb search "jam buka" -n 3
```

### Seed dari File

Buat file `kb-seed.md` di root project:

```markdown
---
id: kb-001
category: pengiriman
question: Berapa lama pengiriman ke Jakarta?
keywords: lama pengiriman, estimasi, sampai
priority: 5
---
Pengiriman ke Jakarta standar 3-5 hari kerja.
Express (JNE YES, Sameday) 1 hari kerja.

---

id: kb-002
category: pengiriman
question: Apakah bisa kirim ke luar pulau?
keywords: luar pulau, daerah terpencil
tags: daerah,3T
priority: 3
---
Bisa, estimasi 7-14 hari kerja tergantung lokasi.

---

id: kb-003
category: refund
question: Bagaimana cara refund?
keywords: refund, retur, pengembalian dana, kembali
---
Refund diproses 1x24 jam setelah barang diterima.
```

Jalankan:

```bash
wagent kb seed          # Tambah dari file kb-seed.md
wagent kb seed --clear  # Hapus semua dulu, lalu seed ulang
```

---

## 🤖 Cara AI Menggunakan KB

1. **AI menerima pertanyaan customer**
2. **AI memutuskan** apakah perlu mencari informasi di KB (via tool `search_knowledge_base`)
3. **Semantic search** dijalankan (jika Gemini API key tersedia)
4. **Hasil relevan** dikembalikan ke AI sebagai context
5. **AI menjawab** berdasarkan informasi dari KB

### Kapan AI Mencari KB?

AI dilatih untuk mencari KB ketika:
- Customer bertanya tentang **produk/layanan spesifik**
- Customer bertanya tentang **kebijakan** (ongkir, refund, garansi)
- Customer bertanya tentang **harga/promo**
- Customer bertanya tentang **jam operasional / lokasi**
- Customer bertanya tentang **tata cara / prosedur**

### Contoh Skenario

**Customer:** "Berapa biaya kirim ke Bandung?"

**AI internal:**
```
1. Customer tanya ongkir
2. Saya perlu cari info ongkir → panggil search_knowledge_base("biaya kirim bandung")
3. KB return: "Ongkir ke Bandung Rp12.000 (3-5 hari)"
4. Saya jawab: "Untuk pengiriman ke Bandung, biaya ongkirnya Rp12.000 dengan estimasi 3-5 hari kerja ya kak 😊"
```

---

## 💡 Tips Optimalisasi KB

### 1. Gunakan Kata Kunci yang Relevan

✅ **Baik:** `ongkir, ongkos kirim, biaya kirim, shipping, courier, tarif`  
❌ **Kurang:** `ongkir` (terlalu sedikit)

### 2. Buat Pertanyaan yang Natural

✅ **Baik:** `Berapa ongkir ke Jakarta?`  
❌ **Kurang:** `ongkir jakarta` (terlalu pendek)

### 3. Gunakan Prioritas

- **Priority 5:** Informasi paling penting (kebijakan refund, harga)
- **Priority 3:** Informasi umum (jam operasional, kontak)
- **Priority 1:** Informasi tambahan (tips, saran)

### 4. Kategorikan dengan Baik

Contoh kategori yang recommended:
- `pengiriman` — Ongkir, ekspedisi, estimasi
- `pembayaran` — Metode bayar, transfer, cicilan
- `refund` — Retur, refund, komplain
- `produk` — Spesifikasi, stok, varian
- `operasional` — Jam buka, lokasi, kontak

### 5. Embedding Otomatis

Embedding di-generate **saat AI search**, bukan saat entry dibuat. Ini berarti:
- Entry baru tanpa embedding → kena fallback ke keyword search
- Setelah pertama kali dicari → embedding tersimpan, search berikutnya pakai semantic

Untuk batch-embed semua entry yang ada, restart cukup sekali dan AI akan meng-embed setiap entry saat pertama kali di-search.

---

## 🔧 Embedding Service

### Provider: Gemini text-embedding-004

| Properti | Nilai |
|----------|-------|
| **Model** | `text-embedding-004` |
| **Dimensions** | 768 |
| **API** | `embedContent` endpoint |
| **Gratis?** | ✅ Ya (60 requests/minute) |
| **Key** | Pakai `GEMINI_API_KEY` yang sama |

### Cara Kerja

```typescript
// 1. Generate embedding untuk query
const embedder = new EmbeddingService(config);
const queryEmbedding = await embedder.generateEmbedding("ongkir jakarta");
// → [0.023, -0.045, ..., 0.012] (768 angka)

// 2. Search di DB dengan cosine similarity
const results = db.searchKnowledgeSemantic(queryEmbedding, 5, 0.3);
// → Entri dengan similarity ≥ 0.3

// 3. Sort by similarity descending
// → Hasil paling relevan di atas
```

### Fallback Strategy

```
generateEmbedding()
  ├── ✅ Key tersedia + API sukses → return 768-dim vector
  ├── ❌ Key tidak ada → return null
  └── ❌ API error → return null + log warning
    
Jika null → keyword search sebagai fallback
```

---

## 📊 Performance Notes

- **Embedding storage:** ~3KB per entry (768 floats × 4 bytes + JSON overhead)
- **Semantic search:** O(n) linear scan (SQLite — semua entry di-load ke memory untuk cosine sim)
- **10K entries:** ~30MB memory untuk embeddings, search dalam ~50ms
- **Cold start:** Entry pertama tanpa embedding → keyword search (lalu embedding disimpan)
- **Database size:** 1MB ≈ 300 entries with embeddings

### Untuk Skala Besar (Future)

Untuk >10K entries, pertimbangkan:
1. Dedicated vector database (Pinecone, Qdrant, pgvector)
2. Approximate Nearest Neighbor (ANN) indexing
3. Batch embedding generation on KB add/update

---

## 📁 Flexible RAG (v2.0)

Fitur baru yang sudah diimplementasikan: upload file langsung → auto-embed → searchable.

### Konsep

```
📁 Upload Any File → 🔄 Auto-Chunk → 🧮 Auto-Embed → 🔍 Searchable
```

### Supported Formats

| Format | Contoh | Use Case |
|--------|--------|----------|
| **Markdown** | `.md` | Dokumentasi, notes, blog |
| **Text** | `.txt` | FAQ, policies, transcripts |
| **CSV** | `.csv` | Product lists, pricing, inventory |
| **JSON** | `.json` | Structured data, configs |

### Workflow

```bash
# Upload file
wagent kb upload products.csv
wagent kb upload faq.md
wagent kb upload pricing.txt

# Semua otomatis: chunk → embed → store
# Lalu search seperti biasa
wagent kb search "harga produk X"
```

### Perbedaan dengan v1.0

| Aspect | v1.0 (FAQ) | v2.0 (Flexible) |
|--------|-----------|-----------------|
| **Input** | CLI add per entry | Upload file langsung |
| **Format** | Question-Answer | Apapun (.md, .txt, .csv) |
| **Chunking** | Manual (per entry) | Auto-chunk per paragraph/section |
| **Management** | CRUD per entry | Upload/delete files |
| **Search** | FAQ + semantic | Full document semantic |

### Roadmap

Lihat [PLAN.md](../PLAN.md) untuk detail implementasi:
- Phase 2: Knowledge Management ✅
- File processing pipeline ✅
- Vector store integration ✅
- Dashboard file manager (coming soon)

---

## CLI Reference

### v1.0 Commands (FAQ)

```bash
# List all FAQ entries
wagent kb list

# Add FAQ entry
wagent kb add --question "Jam berapa buka?" --answer "Buka jam 9-5" --category "info"

# Search FAQ
wagent kb search "jam buka"

# Remove FAQ entry
wagent kb remove <id>

# Seed sample data
wagent kb seed

# List categories
wagent kb categories
```

### v2.0 Commands (Flexible RAG)

```bash
# Upload file (.md, .txt, .csv, .json)
wagent kb upload products.csv
wagent kb upload documentation.md

# List all uploaded files
wagent kb files

# Delete uploaded file by name
wagent kb files delete products.csv

# Embed all pending chunks (batch processing)
wagent kb files embed
```

---

## Troubleshooting

### Semantic Search Tidak Jalan

- Cek `GEMINI_API_KEY` terisi: `wagent config`
- Cek log: `wagent log -n 20`
- Pastikan ada entri KB dengan embedding: cek via `wagent kb list`

### AI Tidak Memakai KB

- Pastikan KB terisi minimal 1 entry
- Coba tanya dengan kata kunci yang ada di KB
- Cek log apakah tool `search_knowledge_base` dipanggil

### Embedding Gagal

- Cek Gemini API key valid dan tidak expired
- Cek kuota Gemini (60 req/minute free)
- Lihat error detail di log: `wagent log -n 30 | grep embedding`
