# @crediblemark/cli

WAGENT Command Line Interface (CLI) — Utilitas terminal interaktif untuk menjalankan, mengelola, dan mengonfigurasi platform WAGENT.

## Perintah Utama
- `wagent start`: Memulai WAGENT AI Agent beserta Web Dashboard.
- `wagent number <list|add|remove>`: Kelola konfigurasi banyak nomor WhatsApp secara dinamis.
- `wagent kb <list|add|remove|seed>`: Sinkronisasikan database FAQ / Knowledge Base RAG Anda.
- `wagent crypto <init|encrypt|decrypt>`: Kelola kunci enkripsi data sensitif (at-rest AES-256-GCM).
- `wagent service <status|start|stop|restart>`: Integrasi systemd daemon untuk server Linux.
- `wagent skill <list|install|remove>`: Manajemen manual plugin / custom tools.

## Instalasi
```bash
npm install -g @crediblemark/wagent
```
*(CLI dibundel secara global di dalam package utama `@crediblemark/wagent`)*
