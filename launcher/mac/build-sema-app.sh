#!/usr/bin/env bash
set -euo pipefail

MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$MAC_DIR/../.." && pwd)"
APP="$MAC_DIR/SeMa.app"
TEMPLATES="$MAC_DIR/templates"
CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-sema-app.sh only runs on macOS" >&2
  exit 1
fi

fail() { echo "$1" >&2; exit 1; }

need_file() {
  [[ -f "$1" ]] || fail "missing: $1"
}

assemble() {
  need_file "$TEMPLATES/Info.plist"
  need_file "$TEMPLATES/SeMa"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  cp -f "$TEMPLATES/Info.plist" "$APP/Contents/Info.plist"
  cp -f "$TEMPLATES/SeMa" "$APP/Contents/MacOS/SeMa"
  chmod +x "$APP/Contents/MacOS/SeMa"

  local icns="$APP/Contents/Resources/AppIcon.icns"
  if [[ -f "$icns" ]]; then
    : # keep existing assembled icns
  elif [[ -f "$MAC_DIR/AppIcon.icns" ]]; then
    cp -f "$MAC_DIR/AppIcon.icns" "$icns"
  elif [[ -f "$REPO_ROOT/assets/icon-mac1024.png" ]] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    local tmp
    tmp="$(mktemp -d)"
    mkdir -p "$tmp/AppIcon.iconset"
    sips -z 1024 1024 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_512x512@2x.png" >/dev/null
    sips -z 512 512 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_512x512.png" >/dev/null
    sips -z 256 256 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_128x128@2x.png" >/dev/null
    sips -z 128 128 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_128x128.png" >/dev/null
    sips -z 64 64 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_32x32@2x.png" >/dev/null
    sips -z 32 32 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_32x32.png" >/dev/null
    sips -z 32 32 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_16x16@2x.png" >/dev/null
    sips -z 16 16 "$REPO_ROOT/assets/icon-mac1024.png" --out "$tmp/AppIcon.iconset/icon_16x16.png" >/dev/null
    iconutil -c icns "$tmp/AppIcon.iconset" -o "$icns"
    rm -rf "$tmp"
  else
    fail "No AppIcon.icns source. Copy an icns to $icns or provide assets/icon-mac1024.png + sips/iconutil."
  fi
}

validate() {
  need_file "$APP/Contents/Info.plist"
  need_file "$APP/Contents/MacOS/SeMa"
  need_file "$APP/Contents/Resources/AppIcon.icns"
  [[ -x "$APP/Contents/MacOS/SeMa" ]] || fail "not executable: $APP/Contents/MacOS/SeMa"
  bash "$APP/Contents/MacOS/SeMa" --check
}

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  validate
  echo "OK: $APP"
  exit 0
fi

assemble
validate
echo "Built $APP"
