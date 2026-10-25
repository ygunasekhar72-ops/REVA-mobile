# Third-party notices

REVA is MIT-licensed. It bundles and interoperates with the following
third-party components:

## xterm.js — MIT
- Files: `js/vendor/xterm.js`, `css/vendor/xterm.css`
- Source: https://github.com/xtermjs/xterm.js
- Terminal emulator front-end (rendering, input handling, buffer).

## Lucide icons — ISC
- Files: `js/vendor/lucide.min.js`
- Source: https://lucide.dev

## BusyBox — GPL-2.0 (binary distribution)
- File: bundled at build time as `android/app/…/jniLibs/<abi>/libbusybox.so`
- Binary source: https://github.com/meefik/busybox (release 1.34.1, built from
  BusyBox source at https://busybox.net/)
- BusyBox is licensed under the GNU GPL version 2. The binary is distributed
  unmodified, as a separate aggregated work within the APK; REVA's own code
  (MIT) does not link against it and communicates only via process streams.
  Complete corresponding source: https://git.busybox.net/busybox/tag/?h=1_34_1
  and the build configuration at https://github.com/meefik/busybox.

## PRoot — GPL-2.0+ (binary distribution)
- Files: bundled at build time as `android/app/…/jniLibs/<abi>/libproot.so`
  and `libproot-loader.so`
- Binary source: https://github.com/Bibarud/TermFold (Apache-2.0 project,
  which builds PRoot from https://github.com/proot-me/PRoot, GPL-2.0+)
- Same aggregation terms as BusyBox: unmodified binaries, no linking, stream
  interoperation only. Source: https://github.com/proot-me/PRoot

## Android shell (mksh / toybox)
- Used from the device system image (`/system/bin/sh`); not redistributed.

## Alpine Linux minirootfs — multiple licenses (aggregated distribution)
- Files: bundled at build time as `android/app/…/assets/linux/<arch>/rootfs.bin`
  (Alpine minirootfs 3.20.3 tarball, aarch64 + x86_64)
- Source: https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/ (build recipe:
  https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/scripts)
- Distributed unmodified as a separate aggregated work; REVA's own code does
  not link against it. It contains many packages under their own licenses
  (musl libc — MIT, BusyBox — GPL-2.0, apk-tools — GPL-2.0, zlib — zlib
  license, plus everything installed at runtime via `apk`). Package sources:
  https://gitlab.alpinelinux.org/alpine/aports

## Reference projects (architecture references only — no code copied)
- TermFold (Apache-2.0): https://github.com/Bibarud/TermFold — proot bundling
  layout and environment invocation were adapted from its documented approach.
- Shelly (GPL-3.0): https://github.com/RYOITABASHI/Shelly — **no code reused**;
  GPL-3.0 is incompatible with this project's MIT license. Referenced solely
  as an architectural validation of the app-owned-PTY + bundled-toolchain
  approach.
