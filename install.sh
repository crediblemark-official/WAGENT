#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/crediblemark-official/WAGENT.git"
INSTALL_DIR="$HOME/.wagent"
BIN_DIR="$HOME/.local/bin"
WAGENT_BIN="$BIN_DIR/wagent"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      🤖 WAGENT Installer            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check Node (required) ──────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required but not installed."
  echo "   Install: https://nodejs.org"
  exit 1
fi

echo "✓ Node $(node --version)"

# ── Detect package manager ─────────────────────────────────────
PKG_MANAGER=""
if command -v bun &>/dev/null; then
  PKG_MANAGER="bun"
  echo "✓ Bun $(bun --version) (fast mode)"
elif command -v pnpm &>/dev/null; then
  PKG_MANAGER="pnpm"
  echo "✓ pnpm $(pnpm --version) (fast mode)"
elif command -v yarn &>/dev/null; then
  PKG_MANAGER="yarn"
  echo "✓ yarn $(yarn --version)"
else
  PKG_MANAGER="npm"
  echo "✓ npm (default)"
fi

# ── Clone atau Update ──────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  echo "✓ WAGENT sudah terinstall di $INSTALL_DIR"

  # Cek versi lokal vs remote
  LOCAL_VERSION="$(cat "$INSTALL_DIR/package.json" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo 'unknown')"
  echo "  Versi lokal  : v$LOCAL_VERSION"

  cd "$INSTALL_DIR"
  git fetch origin main --quiet 2>/dev/null || true

  LOCAL_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo '')"
  REMOTE_COMMIT="$(git rev-parse origin/main 2>/dev/null || echo '')"

  if [ -z "$LOCAL_COMMIT" ] || [ -z "$REMOTE_COMMIT" ]; then
    echo "⚠️  Tidak bisa cek versi remote. Jalankan 'wagent update' secara manual."
    exit 1
  fi

  if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    REMOTE_VERSION="$(git show origin/main:package.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "$LOCAL_VERSION")"
    echo "  Versi remote : v$REMOTE_VERSION"
    echo ""
    echo "✅ WAGENT sudah up-to-date! (v$LOCAL_VERSION)"
    echo ""
    echo "  Start:  wagent start"
    echo "  Update: wagent update"
    echo "  Help:   wagent --help"
    echo ""
    exit 0
  fi

  REMOTE_VERSION="$(git show origin/main:package.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo 'latest')"
  echo "  Versi remote : v$REMOTE_VERSION"
  echo ""
  echo "🆕 Ada versi baru! Menjalankan update otomatis..."
  echo ""
  bash "$INSTALL_DIR/update.sh"
  exit 0
fi

echo "📥 Cloning WAGENT..."
git clone --depth 1 "$REPO" "$INSTALL_DIR"

# ── Build ──────────────────────────────────────────────────────
echo "🔨 Building..."
cd "$INSTALL_DIR"

if [ "$PKG_MANAGER" = "bun" ]; then
  bun install && bun run build
elif [ "$PKG_MANAGER" = "pnpm" ]; then
  pnpm install && pnpm run build
elif [ "$PKG_MANAGER" = "yarn" ]; then
  yarn install && yarn run build
else
  npm install && npm run build
fi

# ── Link ───────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/bin/wagent" "$WAGENT_BIN"

# ── PATH check ─────────────────────────────────────────────────
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo ""
  echo "⚠️  $BIN_DIR is not in your PATH."
  echo "   Add this to your ~/.bashrc or ~/.zshrc:"
  echo ""
  echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

# ── Systemd Service ─────────────────────────────────────────────
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/wagent.service"
SERVICE_TEMPLATE="$INSTALL_DIR/bin/wagent.service"

if command -v systemctl &>/dev/null && systemctl --user status &>/dev/null 2>&1; then
  echo "⚙️  Installing systemd service..."
  mkdir -p "$SERVICE_DIR"
  cp "$SERVICE_TEMPLATE" "$SERVICE_FILE"

  systemctl --user daemon-reload
  systemctl --user enable wagent
  systemctl --user start wagent

  # Aktifkan linger agar service tetap berjalan walau user logout (khusus VPS)
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || true
  fi

  echo "✔  WAGENT service aktif dan akan auto-start saat boot."
  echo "   Gunakan: wagent service status"
else
  echo ""
  echo "ℹ️  systemd tidak tersedia — jalankan manual dengan: wagent start"
fi

echo ""
echo "✅ WAGENT installed successfully!"
echo ""
echo "  Setup:   wagent init      → konfigurasi AI, WhatsApp, Telegram"
echo "  Status:  wagent service status"
echo "  Log:     wagent service logs"
echo "  Help:    wagent --help"
echo ""
