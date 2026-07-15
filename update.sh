#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.wagent"

# ── Colors ──────────────────────────────────────────────────────
G='\033[1;32m'
Y='\033[1;33m'
D='\033[2m'
N='\033[0m'

step() { echo -e "  ${D}$1${N}"; }
ok()   { echo -e "  ${G}✓${N}  $1"; }

echo ""
echo -e "  ${D}╔═══════════════════════════════════════╗${N}"
echo -e "  ${D}║${N}  🤖  ${D}W A G E N T  Updater${N}          ${D}║${N}"
echo -e "  ${D}╚═══════════════════════════════════════╝${N}"
echo ""

# ── Check install ──────────────────────────────────────────────
if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "  ❌ WAGENT not installed."
  echo -e "     Run: curl -fsSL https://raw.githubusercontent.com/crediblemark-official/WAGENT/main/install.sh | bash"
  exit 1
fi

cd "$INSTALL_DIR"

# ── Backup .env ────────────────────────────────────────────────
if [ -f ".env" ]; then
  cp .env .env.backup
fi

# ── Pull latest ────────────────────────────────────────────────
step "📥 Pulling latest changes..."
if git pull origin main --ff-only >/dev/null 2>&1; then
  ok "Code updated"
else
  git fetch origin main --quiet 2>/dev/null
  git reset --hard origin/main --quiet 2>/dev/null
  ok "Code updated (forced)"
fi

# ── Reinstall deps ─────────────────────────────────────────────
step "📦 Installing dependencies..."
if npm install --silent --no-fund --no-audit >/dev/null 2>&1; then
  ok "Dependencies ready"
else
  # npm v11 workspace dedup can crash on dependency changes — retry
  # after wiping node_modules.
  echo -e "  ${Y}⚠ Retrying with clean install...${N}"
  rm -rf node_modules packages/*/node_modules
  if npm install --silent --no-fund --no-audit >/dev/null 2>&1; then
    ok "Dependencies ready"
  else
    echo -e "  ❌ npm install failed"
    exit 1
  fi
fi

# ── Rebuild ────────────────────────────────────────────────────
step "🔨 Building packages..."
if npm run build --silent >/dev/null 2>&1; then
  ok "Build complete"
else
  echo -e "  ❌ Build failed"
  exit 1
fi

# ── Restore .env ───────────────────────────────────────────────
if [ -f ".env.backup" ]; then
  mv .env.backup .env
fi

echo ""
echo -e "  ${G}✅ WAGENT updated to latest version!${N}"
echo ""
echo -e "  Restart: wagent start"
echo ""
