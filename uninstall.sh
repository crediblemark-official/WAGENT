#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.wagent"
BIN_DIR="$HOME/.local/bin"
WAGENT_BIN="$BIN_DIR/wagent"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      🤖 WAGENT Uninstaller          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Confirm ────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  echo "📁 Install location: $INSTALL_DIR"
  read -p "   Remove WAGENT? (y/N): " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
else
  echo "WAGENT not found at $INSTALL_DIR"
  exit 1
fi

# ── Stop if running ────────────────────────────────────────────
if pgrep -f "wagent" &>/dev/null; then
  echo "⏹️  Stopping WAGENT..."
  pkill -f "wagent" 2>/dev/null || true
  sleep 1
fi

# ── Remove symlink ─────────────────────────────────────────────
if [ -L "$WAGENT_BIN" ]; then
  rm "$WAGENT_BIN"
  echo "✓ Removed $WAGENT_BIN"
fi

# ── Remove install directory ───────────────────────────────────
rm -rf "$INSTALL_DIR"
echo "✓ Removed $INSTALL_DIR"

echo ""
echo "✅ WAGENT uninstalled."
echo ""
