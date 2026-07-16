# @wagent/cli

WAGENT Command Line Interface (CLI) — Utilitas terminal interaktif untuk menjalankan, mengelola, dan mengonfigurasi platform WAGENT.

## Perintah Utama
- `wagent init`: Setup wizard interaktif untuk konfigurasi awal.
- `wagent start`: Memulai WAGENT AI Agent beserta Web Dashboard.
- `wagent status`: Cek status koneksi dan agent.
- `wagent number <list|add|remove>`: Kelola konfigurasi banyak nomor WhatsApp secara dinamis.
- `wagent kb <list|add|remove|search|upload>`: Sinkronisasikan database FAQ / Knowledge Base RAG Anda.
- `wagent crypto <init|encrypt|decrypt>`: Kelola kunci enkripsi data sensitif (at-rest AES-256-GCM).
- `wagent service <status|start|stop|restart|enable|disable>`: Integrasi systemd daemon untuk server Linux.
- `wagent skill <list|install|remove>`: Manajemen manual plugin / custom tools.
- `wagent mcp <list|test|expose>`: Model Context Protocol — konek ke sistem eksternal.

## Instalasi
```bash
bun add -g @wagent/wagent
```
*(CLI dibundel secara global di dalam package utama `@wagent/wagent`)*
