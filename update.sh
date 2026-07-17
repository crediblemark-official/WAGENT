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

# Re-exec with the freshly pulled script so any self-updates apply now.
if [ "${WAGENT_UPDATED:-}" != "1" ]; then
  export WAGENT_UPDATED=1
  exec bash "$0"
fi

# ── Reinstall deps ───────────────────────────────────────────────────────────
step "📦 Installing dependencies..."
export PATH="$HOME/.bun/bin:$PATH"
if bun install --frozen-lockfile > /dev/null 2>&1; then
  ok "Dependencies ready"
else
  echo -e "  ${Y}⚠ Retrying without frozen lockfile...${N}"
  if bun install > /dev/null 2>&1; then
    ok "Dependencies ready"
  else
    echo -e "  ❌ bun install failed"
    exit 1
  fi
fi

# ── Rebuild ──────────────────────────────────────────────────────────────────
step "🔨 Building packages..."
if bun run build > /dev/null 2>&1; then
  ok "Build complete"
else
  echo -e "  ❌ Build failed"
  exit 1
fi

# ── Reinstall CLI binary ──────────────────────────────────────────────────────
BIN_DIR="$HOME/.local/bin"
WAGENT_BIN="$BIN_DIR/wagent"
NODE_BIN="$(which node)"
mkdir -p "$BIN_DIR"
cat > "$WAGENT_BIN" << WAGENT_EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$NODE_BIN" "\$HOME/.wagent/packages/cli/dist/index.js" "\$@"
WAGENT_EOF
chmod +x "$WAGENT_BIN"

# ── Restore .env ───────────────────────────────────────────────
if [ -f ".env.backup" ]; then
  mv .env.backup .env
fi

echo ""
echo -e "  ${G}✅ WAGENT updated to latest version!${N}"
echo ""
echo -e "  Restart: wagent start"
echo ""
