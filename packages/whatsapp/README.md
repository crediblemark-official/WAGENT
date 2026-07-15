# @wagent/whatsapp

WAGENT WhatsApp Adapter — Adapter komunikasi yang mengintegrasikan bot WAGENT dengan server WhatsApp menggunakan library Baileys.

## Fitur Utama
- **Baileys Integration**: Konektivitas WhatsApp Socket yang stabil dan andal.
- **Dynamic Connection Patcher**: Mengatasi error login 405 secara otomatis dengan melakukan patching modul runtime sebelum inisialisasi socket.
- **Connection Lifecycle Management**: Handler reconnect otomatis, status sinkronisasi, dan export QR Code.

## Instalasi
```bash
npm install @wagent/whatsapp
```
