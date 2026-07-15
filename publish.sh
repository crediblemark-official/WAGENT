#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      🤖 WAGENT Publisher            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check deps ─────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  echo "❌ npm is required"
  exit 1
fi

# ── Get version from package.json ──────────────────────────────
VERSION=$(node -p "require('./package.json').version")
echo "📦 Version: v$VERSION"
echo ""

# ── Build ──────────────────────────────────────────────────────
echo "🔨 Building all packages..."
npm run build
echo "✓ Build complete"
echo ""

# ── Dry run ────────────────────────────────────────────────────
echo "📋 Dry run (npm pack)..."
npm pack --dry-run 2>&1 | tail -5
echo ""

# ── Confirm ────────────────────────────────────────────────────
read -p "   Publish wagent@$VERSION to npm? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

# ── Publish ────────────────────────────────────────────────────
echo ""
echo "📤 Publishing to npm..."
npm publish --access public
echo ""
echo "✅ Published wagent@$VERSION"
echo ""
echo "  Install: npm i -g wagent@$VERSION"
echo ""
