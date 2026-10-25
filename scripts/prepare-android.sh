#!/usr/bin/env bash
# Prepare local Android build inputs (mirrors .github/workflows/apk.yml).
# Needed while builds are local-only: jniLibs (busybox + proot), the REVA
# Linux rootfs, and the web app are all downloaded/copied at build time —
# none of them are committed.
#
# Usage:  scripts/prepare-android.sh
# Then:   JAVA_HOME=<jdk17> ANDROID_HOME=<sdk> gradle -p android assembleDebug
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
JNIDIR="$ROOT/android/app/src/main/jniLibs"
ASDIR="$ROOT/android/app/src/main/assets"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== busybox (meefik 1.34.1) =="
curl -sL -o "$TMP/bb.zip" https://github.com/meefik/busybox/releases/download/1.34.1/busybox-v1_34_1.zip
unzip -o -q "$TMP/bb.zip" 'arm/bin/busybox' 'arm64/bin/busybox' 'x86_64/bin/busybox' -d "$TMP"
mkdir -p "$JNIDIR/arm64-v8a" "$JNIDIR/armeabi-v7a" "$JNIDIR/x86_64"
for pair in "arm64 arm64-v8a" "arm armeabi-v7a" "x86_64 x86_64"; do
  set -- $pair
  [ -f "$TMP/$1/bin/busybox" ] && cp "$TMP/$1/bin/busybox" "$JNIDIR/$2/libbusybox.so" && echo "  bundled $2"
done

echo "== proot + deps (TermFold, Apache-2.0) =="
BASE="https://raw.githubusercontent.com/Bibarud/TermFold/HEAD/app/src/main/jniLibs"
for abi in arm64-v8a x86_64; do
  mkdir -p "$JNIDIR/$abi"
  for lib in libproot.so libproot-loader.so libtalloc.so libandroid-shmem.so; do
    curl -sL -o "$JNIDIR/$abi/$lib" "$BASE/$abi/$lib"
  done
  echo "  bundled $abi (proot + loader + talloc + shmem)"
done

echo "== REVA Linux rootfs (Alpine minirootfs 3.20.3) =="
for abi in aarch64 x86_64; do
  mkdir -p "$ASDIR/linux/$abi"
  # stored as rootfs.bin: aapt2 strips/decompresses *.gz assets in the APK
  curl -sL -o "$ASDIR/linux/$abi/rootfs.bin" \
    "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/$abi/alpine-minirootfs-3.20.3-$abi.tar.gz"
  echo "  bundled $abi ($(du -h "$ASDIR/linux/$abi/rootfs.bin" | cut -f1))"
done

echo "== web app assets =="
mkdir -p "$ASDIR"
cp index.html manifest.webmanifest "$ASDIR/"
cp -r css js assets "$ASDIR/"
echo "  copied index.html, css/, js/, assets/"

echo "done — build with: gradle -p android assembleDebug (or assembleRelease)"
