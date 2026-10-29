#!/usr/bin/env bash
# Vendor markdown-it + jsdiff (both MIT) from their npm UMD dist bundles —
# the packages' own prebuilt, source-derived bundles: loadable as plain
# <script> in the WebView (via the window.module shim) and requireable in
# node for the unit tests. Idempotent. Attribution in THIRD_PARTY_NOTICES.md.
# Usage: bash scripts/vendor-md.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

MD_VER=14.1.0
DIFF_VER=5.2.0

echo "== markdown-it $MD_VER (UMD dist) =="
mkdir -p "$ROOT/js/vendor/md"
rm -f "$ROOT/js/vendor/md/markdown-it.js"
curl -sL -o "$TMP/md.tgz" "https://registry.npmjs.org/markdown-it/-/markdown-it-$MD_VER.tgz"
tar -xzf "$TMP/md.tgz" -C "$TMP"
cp "$TMP/package/dist/markdown-it.js" "$ROOT/js/vendor/md/markdown-it.js"

echo "== jsdiff $DIFF_VER (UMD dist) =="
mkdir -p "$ROOT/js/vendor/diff"
rm -f "$ROOT/js/vendor/diff/jsdiff.js"
curl -sL -o "$TMP/diff.tgz" "https://registry.npmjs.org/diff/-/diff-$DIFF_VER.tgz"
tar -xzf "$TMP/diff.tgz" -C "$TMP"
cp "$TMP/package/dist/diff.js" "$ROOT/js/vendor/diff/jsdiff.js"

echo "  vendored markdown-it ($(wc -l < "$ROOT/js/vendor/md/markdown-it.js") lines) + jsdiff ($(wc -l < "$ROOT/js/vendor/diff/jsdiff.js") lines)"
