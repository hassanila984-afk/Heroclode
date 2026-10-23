#!/bin/sh
# Build the site folder for Cloudflare Pages from ../firefly.
# index.html is written as a page body (claude.ai adds the document around it), so here it gets
# a proper head: charset, the mobile viewport, and the app manifest.
set -e
OUT="${1:-dist}"
SRC="$(dirname "$0")/../firefly"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r "$SRC/luma" "$SRC/intro" "$SRC/music" "$SRC/sfx" "$SRC/icons" "$SRC/manifest.webmanifest" "$SRC/sw.js" "$SRC/setup.html" "$OUT/"
{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' \
    '<meta charset="utf-8">' \
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' \
    '<meta name="theme-color" content="#0e0b26">' \
    '<link rel="manifest" href="/manifest.webmanifest">' \
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">' \
    '</head>' '<body>'
  cat "$SRC/index.html"
  printf '%s\n' '</body>' '</html>'
} > "$OUT/index.html"
# the Android app, when it has been built (android/: gradle assembleRelease)
APK="$(dirname "$0")/../android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] && cp "$APK" "$OUT/firefly.apk" || true
