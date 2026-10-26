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

echo "== proot + loader + talloc (Termux build — seccomp-aware; required so fork works when spawned by the app under zygote's seccomp policy) =="
BASE="https://packages.termux.dev/apt/termux-main/pool/main"
extract_deb() {
  # $1 = deb url — extracts proot/loader/talloc members into $TMP
  curl -sL -o "$TMP/pkg.deb" "$1"
  mkdir -p "$TMP/pkg"
  (command -v bsdtar >/dev/null && bsdtar -xf "$TMP/pkg.deb" -C "$TMP/pkg" data.tar.xz && bsdtar -xf "$TMP/pkg/data.tar.xz" -C "$TMP/pkg") \
    || python3 - "$TMP/pkg" <<'PYEOF'
import sys, tarfile
tarfile.open(sys.argv[1] + '/pkg.deb').extractall(sys.argv[1] + '/pkg', filter='data')
PYEOF
  find "$TMP/pkg/data" -type f -name proot -exec cp {} "$TMP/proot.bin" \;
  find "$TMP/pkg/data" -type f -path "*libexec/proot/loader" -exec cp {} "$TMP/proot-loader.bin" \;
  find "$TMP/pkg/data" -type f -name "libtalloc.so.*.*.*" -exec cp {} "$TMP/libtalloc.bin" \;
}
for abi in arm64-v8a x86_64; do
  case $abi in
    arm64-v8a) AARCH=aarch64 ;;
    x86_64)    AARCH=x86_64 ;;
  esac
  mkdir -p "$JNIDIR/$abi"
  rm -f "$TMP/proot.bin" "$TMP/proot-loader.bin" "$TMP/libtalloc.bin"
  extract_deb "$BASE/p/proot/proot_5.1.107.101_$AARCH.deb"
  cp "$TMP/proot.bin" "$JNIDIR/$abi/libproot.so"
  cp "$TMP/proot-loader.bin" "$JNIDIR/$abi/libproot-loader.so"
  extract_deb "$BASE/libt/libtalloc/libtalloc_2.5.0_$AARCH.deb"
  cp "$TMP/libtalloc.bin" "$JNIDIR/$abi/libtalloc.so"
  curl -sL -o "$JNIDIR/$abi/libandroid-shmem.so" "https://raw.githubusercontent.com/Bibarud/TermFold/HEAD/app/src/main/jniLibs/$abi/libandroid-shmem.so"
  echo "  bundled $abi (Termux proot + loader + talloc + shmem)"
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
cp -r css js assets plugins "$ASDIR/"
echo "  copied index.html, css/, js/, assets/, plugins/"

echo "done — build with: gradle -p android assembleDebug (or assembleRelease)"
