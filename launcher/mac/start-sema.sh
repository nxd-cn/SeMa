#!/usr/bin/env bash
set -euo pipefail

# CLI / --check helper aligned with SeMa.app stub (launcher/mac/start-sema.sh).
CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$MAC_DIR/../.." && pwd)"

fail() {
  local msg="$1"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    echo "$msg" >&2
    exit 1
  fi
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"${msg}\" with title \"SeMa\" buttons {\"好\"} default button 1" >/dev/null || true
  else
    echo "$msg" >&2
  fi
  exit 1
}

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  fail "找不到 SeMa 仓库根目录（package.json）。请确认 launcher/mac 仍在仓库内。"
fi

# Dock / Finder launches have a minimal PATH; keep Homebrew + common user bins.
# main.js also enriches PATH on non-Windows; keep this for early checks in the stub.
export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"

ELECTRON_BIN=""
if [[ "$(uname -s)" == "Darwin" ]]; then
  ELECTRON_BIN="$REPO_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
elif [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
  ELECTRON_BIN="$REPO_ROOT/node_modules/electron/dist/electron.exe"
else
  # Linux fallback (not a product target; helps --check in CI-like envs)
  if [[ -x "$REPO_ROOT/node_modules/electron/dist/electron" ]]; then
    ELECTRON_BIN="$REPO_ROOT/node_modules/electron/dist/electron"
  fi
fi

if [[ -z "${ELECTRON_BIN}" || ! -x "$ELECTRON_BIN" ]]; then
  fail "未安装依赖。请在仓库根目录执行：npm install"
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  exit 0
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  if command -v node >/dev/null 2>&1 && [[ -f "$REPO_ROOT/scripts/brand-electron-mac.js" ]]; then
    (cd "$REPO_ROOT" && node scripts/brand-electron-mac.js) >/dev/null 2>&1 || true
  else
    ELECTRON_APP="$REPO_ROOT/node_modules/electron/dist/Electron.app"
    SRC_ICNS="$MAC_DIR/SeMa.app/Contents/Resources/AppIcon.icns"
    DST_ICNS="$ELECTRON_APP/Contents/Resources/electron.icns"
    if [[ -f "$SRC_ICNS" && -d "$ELECTRON_APP/Contents/Resources" ]]; then
      cp -f "$SRC_ICNS" "$DST_ICNS" 2>/dev/null || true
      if command -v plutil >/dev/null 2>&1; then
        plutil -replace CFBundleName -string "SeMa" "$ELECTRON_APP/Contents/Info.plist" 2>/dev/null || true
        plutil -replace CFBundleDisplayName -string "SeMa" "$ELECTRON_APP/Contents/Info.plist" 2>/dev/null || true
      fi
    fi
  fi
fi

cd "$REPO_ROOT"
exec "$ELECTRON_BIN" "$REPO_ROOT"
