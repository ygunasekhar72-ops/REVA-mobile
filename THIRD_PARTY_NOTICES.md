# Third-party notices

REVA is MIT-licensed. It bundles and interoperates with the following
third-party components:

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

## ripgrep — MIT OR Unlicense (bundled binary)
- Files: `android/app/…/jniLibs/<abi>/librg.so` (ripgrep 15.2.0, aarch64 +
  x86_64, copied to `filesDir/bin/rg` at runtime)
- Source: https://github.com/BurntSushi/ripgrep — MIT OR Unlicense.
  Binaries from the Termux packaging of the unmodified upstream release
  (https://packages.termux.dev/apt/termux-main/pool/main/r/ripgrep/),
  distributed unmodified as a separate aggregated work; REVA's code
  interops only via the process streams.

## web-tree-sitter + grammar WASMs — MIT (bundled, vendored)
- Files: `js/vendor/tree-sitter.js` + `js/vendor/tree-sitter.wasm`
  (web-tree-sitter 0.22.6, https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web);
  `js/vendor/ts/tree-sitter-*.wasm` — 19 prebuilt grammars (javascript,
  typescript, tsx, python, html, css, json, bash, c, cpp, java, kotlin,
  rust, go, php, ruby, lua, sql, yaml) from the `tree-sitter-wasms`
  0.1.13 package (https://github.com/helix-editor/tree-sitter-wasms... —
  registry: https://www.npmjs.com/package/tree-sitter-wasms)
- Powers REVA's AST code intelligence (`js/treesitter.js` — extraction and
  integration code is REVA's own, MIT). Each grammar is distributed
  unmodified under its MIT license. © tree-sitter contributors.

## models.dev — MIT (bundled data snapshot + live refresh)
- Files: `js/modeldb-data.js` (generated snapshot, via `scripts/gen-modeldb.js`),
  runtime integration in `js/modeldb.js` (trim/lookup logic is REVA's own,
  MIT-licensed)
- Source: https://models.dev — the open model database maintained by the
  opencode team (https://github.com/anomalyco/models.dev, MIT)
- Supplies automated model metadata (context window, vision, tool-calling,
  reasoning) for REVA's BYOK model management. The bundled snapshot is a
  trimmed derivative (id → context tokens + capability flags); the app also
  refreshes the full registry at runtime when online. © models.dev authors,
  MIT license.

## Reference projects (architecture references only — no code copied)
- TermFold (Apache-2.0): https://github.com/Bibarud/TermFold — proot bundling
  layout and environment invocation were adapted from its documented approach.
- Shelly (GPL-3.0): https://github.com/RYOITABASHI/Shelly — **no code reused**;
  GPL-3.0 is incompatible with this project's MIT license. Referenced solely
  as an architectural validation of the app-owned-PTY + bundled-toolchain
  approach.
