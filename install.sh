#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/crediblemark-official/WAGENT.git"
INSTALL_DIR="$HOME/.wagent"
BIN_DIR="$HOME/.local/bin"
WAGENT_BIN="$BIN_DIR/wagent"

# ── Colors ──────────────────────────────────────────────────────
R='\033[1;31m'   # Red bold
G='\033[1;32m'   # Green bold
Y='\033[1;33m'   # Yellow bold
B='\033[1;34m'   # Blue bold
C='\033[1;36m'   # Cyan bold
W='\033[1;37m'   # White bold
D='\033[2m'      # Dim
N='\033[0m'      # Reset

# ── Helpers ─────────────────────────────────────────────────────
step() { echo -e "  ${C}$1${N}  ${W}$2${N}"; }
ok()   { echo -e "  ${G}✓${N}  $1"; }
fail() { echo -e "  ${R}✗${N}  $1"; }
info() { echo -e "  ${D}$1${N}"; }
hr()   { echo -e "  ${D}$(printf '─%.0s' {1..42})${N}"; }

# ── Banner ──────────────────────────────────────────────────────
echo ""
echo -e "  ${C}╔═══════════════════════════════════════╗${N}"
echo -e "  ${C}║${N}  🤖  ${W}W A G E N T${N}                   ${C}║${N}"
echo -e "  ${C}║${N}  ${D}WhatsApp AI Agent · Self-Hosted${N}     ${C}║${N}"
echo -e "  ${C}╚═══════════════════════════════════════╝${N}"
echo ""

# ── Step 1: Check Node ─────────────────────────────────────────
step "①" "Checking prerequisites..."
if ! command -v node &>/dev/null; then
  fail "Node.js is required but not installed."
  info "Install: https://nodejs.org"
  exit 1
fi
if ! command -v git &>/dev/null; then
  fail "Git is required but not installed."
  exit 1
fi
ok "Node $(node --version)"
ok "Git $(git --version | awk '{print $3}')"
echo ""

# ── Step 2: Clone or Update ────────────────────────────────────
step "②" "Preparing WAGENT..."
if [ -d "$INSTALL_DIR" ]; then
  ok "Already installed at $INSTALL_DIR"

  LOCAL_VERSION="$(cat "$INSTALL_DIR/package.json" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo 'unknown')"

  cd "$INSTALL_DIR"
  git fetch origin main --quiet 2>/dev/null || true

  LOCAL_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo '')"
  REMOTE_COMMIT="$(git rev-parse origin/main 2>/dev/null || echo '')"

  if [ -z "$LOCAL_COMMIT" ] || [ -z "$REMOTE_COMMIT" ]; then
    fail "Cannot check remote version. Run 'wagent update' manually."
    exit 1
  fi

  if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    echo ""
    hr
    echo -e "  ${G}Already up-to-date!${N} (v$LOCAL_VERSION)"
    hr
    echo ""
    echo -e "  ${W}Start:${N}   wagent start"
    echo -e "  ${W}Update:${N}  wagent update"
    echo -e "  ${W}Help:${N}    wagent --help"
    echo ""
    exit 0
  fi

  echo ""
  echo -e "  ${Y}↑ New version available! Updating...${N}"
  echo ""
  bash "$INSTALL_DIR/update.sh"
  exit 0
fi

if git clone --depth 1 "$REPO" "$INSTALL_DIR" >/dev/null 2>&1; then
  ok "Repository cloned"
else
  fail "Clone failed"
  exit 1
fi
echo ""

# ── Step 3: Install Dependencies ───────────────────────────────
step "③" "Installing dependencies..."
cd "$INSTALL_DIR"
if npm install --silent --no-fund --no-audit >/dev/null 2>&1; then
  ok "Dependencies installed"
else
  fail "npm install failed"
  exit 1
fi
echo ""

# ── Step 4: Build ──────────────────────────────────────────────
step "④" "Building packages..."
if FRESH_INSTALL=1 npm run build --silent >/dev/null 2>&1; then
  ok "Build complete"
else
  fail "Build failed"
  exit 1
fi
echo ""

# ── Step 5: Install CLI ────────────────────────────────────────
step "⑤" "Installing CLI..."
mkdir -p "$BIN_DIR"
cat > "$WAGENT_BIN" << 'WAGENT_EOF'
#!/usr/bin/env bash
set -euo pipefail
exec node "$HOME/.wagent/packages/cli/dist/index.js" "$@"
WAGENT_EOF
chmod +x "$WAGENT_BIN"
ok "CLI installed at $WAGENT_BIN"

# ── PATH check ─────────────────────────────────────────────────
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo ""
  echo -e "  ${Y}⚠  $BIN_DIR is not in your PATH.${N}"
  echo -e "  ${D}Add this to your ~/.bashrc or ~/.zshrc:${N}"
  echo ""
  echo -e "  ${W}export PATH=\"\$HOME/.local/bin:\$PATH\"${N}"
  echo ""
fi
echo ""

# ── Step 6: Systemd Service ────────────────────────────────────
step "⑥" "Setting up service..."
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/wagent.service"
SERVICE_TEMPLATE="$INSTALL_DIR/bin/wagent.service"

if command -v systemctl &>/dev/null && systemctl --user status &>/dev/null 2>&1; then
  mkdir -p "$SERVICE_DIR"
  cp "$SERVICE_TEMPLATE" "$SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable wagent 2>/dev/null || true

  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || true
  fi

  ok "Systemd service installed & enabled"
else
  info "Systemd not available — use 'wagent start' manually"
fi
echo ""

# ── Done ───────────────────────────────────────────────────────
hr
echo ""
echo -e "  ${G}  ✓ WAGENT installed successfully!${N}"
echo ""
echo -e "  ${W}  Quick Start:${N}"
echo ""
echo -e "    ${C}1.${N}  ${W}wagent start${N}           ${D}→ scan QR code (first-time pairing)${N}"
echo -e "    ${C}2.${N}  ${W}Ctrl+C${N}                 ${D}→ stop after connected${N}"
echo -e "    ${C}3.${N}  ${W}wagent service start${N}   ${D}→ run in background${N}"
echo ""
echo -e "  ${W}  Commands:${N}"
echo ""
echo -e "    ${W}wagent service status${N}   ${D}→ check service status${N}"
echo -e "    ${W}wagent service logs${N}     ${D}→ view logs${N}"
echo -e "    ${W}wagent --help${N}           ${D}→ all commands${N}"
echo ""
hr
echo ""
