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
  echo "ℹ️  Install directory $INSTALL_DIR not found (may already be removed)"
  read -p "   Continue cleanup (npm/bun/systemd)? (y/N): " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
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

# ── Stop & disable systemd service ─────────────────────────────
if command -v systemctl &>/dev/null && systemctl --user status wagent &>/dev/null 2>&1; then
  echo "⏹️  Stopping systemd service..."
  systemctl --user stop wagent 2>/dev/null || true
  systemctl --user disable wagent 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/wagent.service"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "✓ Systemd service removed"
fi

# ── Remove bin/wagent ──────────────────────────────────────────
if [ -f "$WAGENT_BIN" ] || [ -L "$WAGENT_BIN" ]; then
  rm -f "$WAGENT_BIN"
  echo "✓ Removed $WAGENT_BIN"
fi

# ── Uninstall from npm global ──────────────────────────────────
if command -v npm &>/dev/null; then
  npm ls -g @wagent/wagent &>/dev/null 2>&1 && {
    echo "📦 Uninstalling from npm global..."
    npm uninstall -g @wagent/wagent 2>/dev/null && echo "✓ Removed from npm" || echo "ℹ️  Not found in npm"
  } || true
fi

# ── Uninstall from bun global ──────────────────────────────────
if command -v bun &>/dev/null; then
  bun pm ls -g 2>/dev/null | grep -q "@wagent/wagent" && {
    echo "📦 Uninstalling from bun global..."
    bun remove -g @wagent/wagent 2>/dev/null && echo "✓ Removed from bun" || echo "ℹ️  Not found in bun"
  } || true
fi

# ── Remove install directory ───────────────────────────────────
rm -rf "$INSTALL_DIR"
echo "✓ Removed $INSTALL_DIR"

# ── Clean up legacy scattered data (pre-v0.2.68) ──────────────
LEGACY_DIRS=("$HOME/data" "$HOME/.sessions" "$HOME/memory" "$HOME/knowledge")
for d in "${LEGACY_DIRS[@]}"; do
  if [ -d "$d" ]; then
    rm -rf "$d"
    echo "✓ Removed legacy directory $d"
  fi
done

echo ""
echo "✅ WAGENT uninstalled."
echo ""
