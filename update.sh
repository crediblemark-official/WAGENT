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

# ── Detect package manager ──────────────────────────────────────
USE_BUN=1
export PATH="$HOME/.bun/bin:$PATH"
if ! bun --version >/dev/null 2>&1; then
  USE_BUN=0
fi

# ── Reinstall deps ───────────────────────────────────────────────────────────
step "📦 Installing dependencies..."
if [ "$USE_BUN" = "1" ]; then
  if bun install --frozen-lockfile > /dev/null 2>&1; then
    ok "Dependencies ready (bun)"
  else
    echo -e "  ${Y}⚠ Retrying without frozen lockfile...${N}"
    if bun install > /dev/null 2>&1; then
      ok "Dependencies ready (bun)"
    else
      echo -e "  ❌ bun install failed"
      exit 1
    fi
  fi
else
  if npm ci --no-audit --no-fund > /dev/null 2>&1; then
    ok "Dependencies ready (npm ci)"
  elif npm install --no-audit --no-fund > /dev/null 2>&1; then
    ok "Dependencies ready (npm)"
  elif npm install --ignore-scripts --no-audit --no-fund > /dev/null 2>&1; then
    ok "Dependencies ready (npm, scripts skipped — using node:sqlite fallback)"
  else
    echo -e "  ❌ npm install failed. Try: cd ~/.wagent && npm install 2>&1"
    exit 1
  fi
fi

# ── Rebuild ──────────────────────────────────────────────────────────────────
step "🔨 Building packages..."
if [ "$USE_BUN" = "1" ]; then
  if bun run build > /dev/null 2>&1; then
    ok "Build complete (bun)"
  else
    echo -e "  ❌ Build failed"
    exit 1
  fi
else
  BUILD_OK=1
  for pkg in core cli whatsapp tui; do
    if ! (cd "packages/$pkg" && npx tsc > /dev/null 2>&1); then
      echo -e "  ❌ Build failed in packages/$pkg"
      BUILD_OK=0
      break
    fi
  done
  if [ "$BUILD_OK" = "1" ]; then
    if ! (cd packages/dashboard && npx vite build > /dev/null 2>&1 && npx tsc > /dev/null 2>&1); then
      echo -e "  ❌ Build failed in packages/dashboard"
      BUILD_OK=0
    fi
  fi
  if [ "$BUILD_OK" = "1" ]; then
    ok "Build complete (npm)"
  else
    exit 1
  fi
fi

# ── Reinstall CLI binary ──────────────────────────────────────────────────────
BIN_DIR="$HOME/.local/bin"
WAGENT_BIN="$BIN_DIR/wagent"
mkdir -p "$BIN_DIR"
cat > "$WAGENT_BIN" << 'WAGENT_EOF'
#!/usr/bin/env bash
set -euo pipefail
exec node "$HOME/.wagent/packages/cli/dist/index.js" "$@"
WAGENT_EOF
chmod +x "$WAGENT_BIN"

# ── Restore .env ───────────────────────────────────────────────
if [ -f ".env.backup" ]; then
  mv .env.backup .env
fi

# ── Ensure ~/.local/bin is in PATH ────────────────────────────
SHELL_RC="$HOME/.bashrc"
if [ -f "$HOME/.zshrc" ] && [ -n "${ZSH_VERSION:-}" ]; then
  SHELL_RC="$HOME/.zshrc"
fi
if ! grep -q '\.local/bin' "$SHELL_RC" 2>/dev/null; then
  {
    echo ''
    echo 'export PATH="$HOME/.local/bin:$PATH"'
  } >> "$SHELL_RC"
fi
export PATH="$HOME/.local/bin:$PATH"

echo ""
echo -e "  ${G}✅ WAGENT updated to latest version!${N}"
echo ""
echo -e "  Restart: wagent start"
echo ""
