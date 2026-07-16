# @wagent/core

WAGENT Core Engine — Modul inti yang mengelola jalannya AI Agent, RAG Knowledge Base, database SQLite, antrean persetujuan, scheduler, dan plugin/skill sistem.

## Fitur Utama
- **AI Agent Engine**: Abstraksi provider LLM (OpenAI, Gemini, Claude, Ollama) dengan memory percakapan dinamis.
- **RAG Knowledge Base**: Pencarian semantik menggunakan Vector Embeddings dan FTS5 SQLite untuk akurasi data.
- **Database Layer**: Penyimpanan data chat history, kontak, dan approval queue berbasis SQLite (better-sqlite3) dengan WAL mode dan FTS5 full-text search.
- **Dynamic Skill Loader**: Sistem plugin JavaScript dinamis untuk memperluas fungsi agent (membuat pesanan, cek ongkir, dll.).

## Instalasi
```bash
bun add @wagent/core
```
