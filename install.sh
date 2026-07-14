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

# ── Clone ──────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  echo "⚠️  WAGENT already installed at $INSTALL_DIR"
  echo "   Run 'wagent update' to update, or 'wagent uninstall' first."
  exit 1
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
