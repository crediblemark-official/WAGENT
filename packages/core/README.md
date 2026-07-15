# @wagent/core

WAGENT Core Engine — Modul inti yang mengelola jalannya AI Agent, RAG Knowledge Base, database SQLite/Postgres, antrean persetujuan, scheduler, dan plugin/skill sistem.

## Fitur Utama
- **AI Agent Engine**: Abstraksi provider LLM (OpenAI, Gemini, Claude, Ollama) dengan memory percakapan dinamis.
- **RAG Knowledge Base**: Pencarian semantik menggunakan Vector Embeddings dan FTS5 SQLite untuk akurasi data.
- **Database Layer**: Penyimpanan data chat history, kontak, dan approval queue yang kompatibel dengan SQLite & PostgreSQL.
- **Dynamic Skill Loader**: Sistem plugin dinamis untuk memperluas fungsi agent (membuat pesanan, cek ongkir, dll.).

## Instalasi
```bash
npm install @wagent/core
```
