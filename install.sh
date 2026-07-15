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
npm install
FRESH_INSTALL=1 npm run build

# ── Install bin/wagent ─────────────────────────────────────────
mkdir -p "$BIN_DIR"
cat > "$WAGENT_BIN" << 'WAGENT_EOF'
#!/usr/bin/env bash
set -euo pipefail
exec node "$HOME/.wagent/packages/cli/dist/index.js" "$@"
WAGENT_EOF
chmod +x "$WAGENT_BIN"

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

  # Aktifkan linger agar service tetap berjalan walau user logout (khusus VPS)
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || true
  fi

  echo ""
  echo "✅ WAGENT installed successfully!"
  echo ""
  echo "  Step 1:  wagent start      → scan QR code (pairing pertama)"
  echo "  Step 2:  Ctrl+C            → henti setelah terkoneksi"
  echo "  Step 3:  wagent service start → jalankan di background"
  echo ""
  echo "  Status:  wagent service status"
  echo "  Log:     wagent service logs"
  echo "  Help:    wagent --help"
  echo ""
else
  echo ""
  echo "✅ WAGENT installed successfully!"
  echo ""
  echo "  Jalankan: wagent start     → scan QR code & mulai"
  echo "  Help:     wagent --help"
  echo ""
fi
