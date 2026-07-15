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

# ── Detect package manager ─────────────────────────────────────
if command -v bun &>/dev/null; then
  PKG_MANAGER="bun"
  echo "✓ Using bun (fast mode)"
elif command -v pnpm &>/dev/null; then
  PKG_MANAGER="pnpm"
  echo "✓ Using pnpm (fast mode)"
elif command -v yarn &>/dev/null; then
  PKG_MANAGER="yarn"
  echo "✓ Using yarn"
else
  PKG_MANAGER="npm"
  echo "✓ Using npm"
fi

# ── Reinstall deps ─────────────────────────────────────────────
echo "📦 Installing dependencies..."
if [ "$PKG_MANAGER" = "bun" ]; then
  bun install
elif [ "$PKG_MANAGER" = "pnpm" ]; then
  pnpm install
elif [ "$PKG_MANAGER" = "yarn" ]; then
  yarn install
else
  npm install
fi

# ── Rebuild ────────────────────────────────────────────────────
echo "🔨 Building..."
if [ "$PKG_MANAGER" = "bun" ]; then
  bun run build
elif [ "$PKG_MANAGER" = "pnpm" ]; then
  pnpm run build
elif [ "$PKG_MANAGER" = "yarn" ]; then
  yarn run build
else
  npm run build
fi

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
