#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.wagent"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      🤖 WAGENT Updater              ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check install ──────────────────────────────────────────────
if [ ! -d "$INSTALL_DIR" ]; then
  echo "❌ WAGENT not installed."
  echo "   Run: curl -fsSL https://raw.githubusercontent.com/crediblemark-official/WAGENT/main/install.sh | bash"
  exit 1
fi

cd "$INSTALL_DIR"

# ── Backup .env ────────────────────────────────────────────────
if [ -f ".env" ]; then
  cp .env .env.backup
  echo "✓ Backed up .env"
fi

# ── Pull latest ────────────────────────────────────────────────
echo "📥 Pulling latest changes..."
git pull origin main --ff-only || {
  echo "⚠️  Cannot fast-forward. Force updating..."
  git fetch origin main
  git reset --hard origin/main
}

# ── Reinstall deps ─────────────────────────────────────────────
echo "📦 Installing dependencies..."
npm install

# ── Rebuild ────────────────────────────────────────────────────
echo "🔨 Building..."
npm run build

# ── Restore .env ───────────────────────────────────────────────
if [ -f ".env.backup" ]; then
  mv .env.backup .env
  echo "✓ Restored .env"
fi

echo ""
echo "✅ WAGENT updated to latest version!"
echo ""
echo "  Restart: wagent start"
echo ""
