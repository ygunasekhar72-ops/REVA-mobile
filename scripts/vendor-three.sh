#!/usr/bin/env bash
# Vendor three.js (MIT) — the module build plus the addons REVA's 3D skill
# guidance uses, so built projects import three from the HARNESS (offline,
# local-first) via an injected import map instead of a CDN.
# Idempotent. Attribution in THIRD_PARTY_NOTICES.md.
# Usage: bash scripts/vendor-three.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

VER=0.160.1
DEST="$ROOT/js/vendor/three"

echo "== three.js $VER (npm tarball) =="
rm -rf "$DEST"
mkdir -p "$DEST/addons/controls" "$DEST/addons/loaders" "$DEST/addons/utils"
curl -sL -o "$TMP/three.tgz" "https://registry.npmjs.org/three/-/three-$VER.tgz"
tar -xzf "$TMP/three.tgz" -C "$TMP"

cp "$TMP/package/build/three.module.js" "$DEST/three.module.js"
cp "$TMP/package/examples/jsm/controls/OrbitControls.js" "$DEST/addons/controls/"
cp "$TMP/package/examples/jsm/loaders/GLTFLoader.js" "$DEST/addons/loaders/"
cp "$TMP/package/examples/jsm/utils/BufferGeometryUtils.js" "$DEST/addons/utils/"

echo "  vendored three.module.js ($(wc -l < "$DEST/three.module.js") lines) + 3 addons ($(cat "$DEST/addons"/controls/OrbitControls.js "$DEST/addons/loaders/GLTFLoader.js" "$DEST/addons/utils/BufferGeometryUtils.js" | wc -l) lines)"
