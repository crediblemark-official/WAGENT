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

# ── Check Bun ──────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "📦 Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "✓ Bun $(bun --version)"

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
bun install
bun run build

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

echo ""
echo "✅ WAGENT installed successfully!"
echo ""
echo "  Start:  wagent start"
echo "  Setup:  wagent init"
echo "  Help:   wagent help"
echo ""
