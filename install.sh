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

# ── Termux / Android preparation (run BEFORE any pkg install) ──
# On a fresh Termux the package repo is HTTPS and often fails with
# "certificate verify failed" until ca-certificates is present and the
# index is refreshed. Do this first so subsequent installs succeed.
if [ -d "/data/data/com.termux" ] || grep -qi "termux" <<< "$(uname -a 2>/dev/null)"; then
  info "Termux detected — preparing package repository..."
  if command -v pkg &>/dev/null; then
    pkg install -y ca-certificates >/dev/null 2>&1 || true
    pkg update >/dev/null 2>&1 || true
    ok "Termux repository prepared (ca-certificates + pkg update)"
    # Build tools as a fallback path (if the user ever uses Node + better-sqlite3)
    pkg install -y build-essential python nodejs >/dev/null 2>&1 || true
    ok "Termux build tools ready (build-essential, python, nodejs)"
  fi
  info "Tip: WAGENT uses Bun on Termux (bun:sqlite — no native compile needed)."
fi

# ── Step 1: Check prerequisites ─────────────────────────────
step "①" "Checking prerequisites..."

# On Termux there is no sudo and the package manager is `pkg`.
IS_TERMUX=0
if [ -d "/data/data/com.termux" ] || grep -qi "termux" <<< "$(uname -a 2>/dev/null)"; then
  IS_TERMUX=1
fi

install_pkg() {
  local pkg=$1
  local apt_pkg=$2
  info "Installing $pkg..."
  if [ "$IS_TERMUX" = "1" ]; then
    pkg install -y "$pkg" >/dev/null 2>&1
  elif command -v apt-get &>/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y "$apt_pkg" >/dev/null 2>&1
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y "$pkg" >/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    sudo yum install -y "$pkg" >/dev/null 2>&1
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm "$pkg" >/dev/null 2>&1
  else
    fail "No supported package manager found. Please install $pkg manually."
    exit 1
  fi
}

if ! command -v git &>/dev/null; then
  install_pkg git git
  if ! command -v git &>/dev/null; then
    fail "Failed to auto-install Git. Please install it manually."
    exit 1
  fi
  ok "Git installed successfully"
fi

if ! command -v node &>/dev/null; then
  install_pkg nodejs nodejs
  if ! command -v node &>/dev/null; then
    fail "Failed to auto-install Node.js. Please install it manually."
    exit 1
  fi
  ok "Node.js installed successfully"
fi
# Install bun jika belum ada (dipakai untuk install deps, lebih cepat & kompatibel)
if ! command -v bun &>/dev/null; then
  info "Installing bun (package manager)..."
  if curl -fsSL https://bun.sh/install | bash > /dev/null 2>&1; then
    export PATH="$HOME/.bun/bin:$PATH"
    ok "Bun $(bun --version) installed"
  else
    fail "Bun installation failed. Install manually: https://bun.sh"
    exit 1
  fi
fi
ok "Node $(node --version)"
ok "Bun $(bun --version)"
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

  # Baca versi dari remote package.json
  REMOTE_VERSION="$(git show origin/main:package.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "$LOCAL_VERSION")"

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
  echo -e "  ${Y}↑ New version available! (v$LOCAL_VERSION → v$REMOTE_VERSION) Updating...${N}"
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
export PATH="$HOME/.bun/bin:$PATH"
if bun install --frozen-lockfile > /dev/null 2>&1; then
  ok "Dependencies installed"
else
  fail "bun install failed"
  exit 1
fi
echo ""

# ── Step 4: Build ──────────────────────────────────────────
step "④" "Building packages..."
if FRESH_INSTALL=1 bun run build > /dev/null 2>&1; then
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
# Ensure ~/.bashrc exists and wires up Bun + the WAGENT bin dir, then
# apply it to the current session so `wagent` works immediately.
if [ ! -f "$HOME/.bashrc" ]; then
  touch "$HOME/.bashrc"
fi

SHELL_RC="$HOME/.bashrc"
if [ -f "$HOME/.zshrc" ] && [ -n "${ZSH_VERSION:-}" ]; then
  SHELL_RC="$HOME/.zshrc"
fi

if ! grep -q 'BUN_INSTALL' "$SHELL_RC" 2>/dev/null; then
  {
    echo ''
    echo 'export BUN_INSTALL="$HOME/.bun"'
    echo 'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$PATH"'
  } >> "$SHELL_RC"
fi

# Apply to current session
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$BIN_DIR:$PATH"

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo ""
  echo -e "  ${Y}⚠  $BIN_DIR is not in your PATH.${N}"
  echo -e "  ${D}Add this to your shell rc:${N}"
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

# ── Firewall check (UFW) ───────────────────────────────────────
if command -v ufw &>/dev/null; then
  if sudo ufw status 2>/dev/null | grep -q "Status: active"; then
    step "⑦" "Configuring firewall (UFW)..."
    if sudo ufw allow 3030/tcp >/dev/null 2>&1; then
      ok "Allowed port 3030/tcp in UFW firewall"
    else
      info "Could not configure UFW automatically. Please allow port 3030/tcp manually."
    fi
    echo ""
  fi
fi

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
