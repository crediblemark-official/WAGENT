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

# ── Stop server jika sedang berjalan ───────────────────────────
SELF_PID=$$
# Cari proses "wagent start" (bukan proses uninstall ini sendiri)
WAGENT_PIDS=$(pgrep -f "wagent start" 2>/dev/null | grep -v "^$SELF_PID$" || true)

if [ -n "$WAGENT_PIDS" ]; then
  echo "⏹️  Stopping WAGENT server..."
  echo "$WAGENT_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 1
  # Force kill jika masih ada
  STILL_RUNNING=$(pgrep -f "wagent start" 2>/dev/null | grep -v "^$SELF_PID$" || true)
  if [ -n "$STILL_RUNNING" ]; then
    echo "$STILL_RUNNING" | xargs kill -KILL 2>/dev/null || true
  fi
  echo "✓ WAGENT server stopped"
else
  echo "ℹ️  Tidak ada server WAGENT yang berjalan"
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
