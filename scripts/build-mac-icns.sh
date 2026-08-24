#!/usr/bin/env bash
# Rebuild macOS Dock icon.icns with ~86% content + transparent margin.
# Leaves Windows icon.ico / full-bleed icon.png untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
SRC="$ICONS/icon.png"
MAC="$ICONS/icon-mac.png"
OUT="$ICONS/icon.icns"

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi
if ! command -v magick >/dev/null; then
  echo "need ImageMagick (magick)" >&2
  exit 1
fi
if ! command -v iconutil >/dev/null; then
  echo "need iconutil (macOS)" >&2
  exit 1
fi

# 100/0.86 ≈ 116.279% canvas → content ≈ 86% with transparent rim
magick "$SRC" -background none -gravity center -extent 116.279% "PNG32:$MAC"
TMP="$(mktemp -d)/SeMa.iconset"
mkdir -p "$TMP"
magick "$MAC" -resize 1024x1024 "PNG32:$TMP/../mac1024.png"
BASE="$TMP/../mac1024.png"
for spec in \
  "16:icon_16x16.png" \
  "32:icon_16x16@2x.png" \
  "32:icon_32x32.png" \
  "64:icon_32x32@2x.png" \
  "128:icon_128x128.png" \
  "256:icon_128x128@2x.png" \
  "256:icon_256x256.png" \
  "512:icon_256x256@2x.png" \
  "512:icon_512x512.png" \
  "1024:icon_512x512@2x.png"
do
  size="${spec%%:*}"
  name="${spec#*:}"
  magick "$BASE" -resize "${size}x${size}" "PNG32:${TMP}/${name}"
done
iconutil -c icns "$TMP" -o "$OUT"
rm -rf "$(dirname "$TMP")"
echo "wrote $MAC and $OUT"
