#!/usr/bin/env bash
# Vendor highlight.js (MIT) — downloads the npm tarball and extracts the
# UNMINIFIED CJS sources (lib/core.js + all lib/languages/*.js) into
# js/vendor/hljs/. Same pattern as prepare-android.sh: fetched at vendor
# time, committed, attributed in THIRD_PARTY_NOTICES.md.
# Usage: bash scripts/vendor-hljs.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEST="$ROOT/js/vendor/hljs"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

VER=11.12.0
echo "== highlight.js $VER (npm tarball) =="
curl -sL -o "$TMP/hl.tgz" "https://registry.npmjs.org/highlight.js/$VER" 2>/dev/null || true
curl -sL -o "$TMP/hl.tgz" "https://registry.npmjs.org/highlight.js/-/highlight.js-$VER.tgz"
tar -xzf "$TMP/hl.tgz" -C "$TMP"
rm -rf "$DEST/languages"   # idempotent: never leave stale or doubled files
mkdir -p "$DEST/languages"
cp "$TMP/package/lib/core.js" "$DEST/core.js"
cp "$TMP/package/lib/languages/"*.js "$DEST/languages/"
echo "  vendored core.js + $(ls "$DEST/languages" | wc -l) languages ($(du -sh "$DEST" | cut -f1))"
