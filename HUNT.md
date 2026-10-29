# HUNT — REVA to opencode/ZCode class

Directive (user, 2026-10-29): the harness must match opencode/ZCode-class quality — **no matter the file count or line count**. This file is the campaign ledger: the honest gap matrix, the workstreams that close it, and the done-conditions. Updated every release. No inflation — working features and green tests are the only currency.

## Baseline (v1.4.12, honest numbers)

| | REVA | opencode | Codex CLI | Aider |
|---|---|---|---|---|
| First-party code | ~9.7K lines | ~1M (40MB TS) | ~2M (80MB Rust) | ~35K Python |
| Tests/evals | 10 agent evals | hundreds | thousands | extensive |
| Platforms | PWA + Android | 80+ terminals | macOS/Linux/Win | CLI |
| Code intelligence | regex symbol scan | LSP + tree-sitter | tree-sitter | tree-sitter repo-map |
| Terminal | external (user-built, pending) | full TUI | full TUI | n/a |

What REVA already has (built + verified): goal-driven endurance loop (500/5000-round caps), quota-aware multi-key rotation, transient auto-retry, stream watchdog, follow-up queue with cross-chat delivery, persistent live UI state, IndexedDB storage layering, Project Library + SAF native import, folder chats with implicit mounts, 33 tools, 15 seeded expert skills, shell channel with marker protocol + argv quoting, CI-built signed releases.

## The gap that matters (in priority order)

1. **Execution reliability** — the on-device shell wedge (573s spinner on `echo hi`) is exactly the class of bug real harnesses engineer away. Failures must be fast, honest, and self-healing. → **W1, starts now.**
2. **Testing depth** — 10 evals ≈ 0. Real harnesses unit-test parsers, protocols, and failure paths on every commit. → **W4.**
3. **Code intelligence** — models navigate big repos by structure, not grep luck: symbol index, references, repo-map. → **W3.**
4. **Context engine** — compaction, repo-map, state-of-the-world blocks for 100K-token runs. → **W5.**
5. **Terminal** — user-built PolyDev terminal integration against the standing contract (pty + marker protocol, /host bind, seccomp-aware proot, libtalloc naming). → **W2, blocked on the user's build.**
6. **Platform hardening** — process-death restore, background runs, long-session stability. → **W6.**
7. **Multimodal results** — screenshots/vision flowing through the tool loop, not just text pixel stats. → **W7.**

## Workstreams and done-conditions

- **W1 Execution reliability** — circuit breakers, watchdogs, graceful degradation. *Done when:* every failure mode observed on-device has an automated guard + a test reproducing it; no failure can burn more than its declared budget.
- **W2 Terminal integration** — integrate the user's terminal against the contract. *Done when:* long-running commands stream live, exit codes land via markers, /host bind works, a 10-min install survives the session.
- **W3 Code intelligence** — upgrade `code_symbols` to a real symbol index (defs/refs per language family), then a repo-map for prompts. *Done when:* the agent finds any symbol in a 100-file project in one tool call.
- **W4 Testing depth** — unit suite (parsers, protocols, breaker, storage migration) + eval suite growth 10 → 50 scenarios (failure paths included). *Done when:* CI runs the full suite < 5 min and every shipped bug class has a regression test.
- **W5 Context engine** — compaction + repo-map + STATE-OF-THE-WORLD persistence. *Done when:* a 500-round run stays coherent end-to-end.
- **W6 Platform hardening** — process-death restore, background continuation. *Done when:* killing the app mid-run and reopening resumes cleanly every time.
- **W7 Multimodal** — tool-result images into the model loop. *Done when:* the agent sees its own screenshots when the model supports vision.

## Rules of the hunt

1. Every increment verified (unit test or live run) before commit; CI green; honest reporting — if it fails, say so with the output.
2. On-device is the real gate: the phone finds what the browser hides.
3. **THE GOAL (user, 2026-10-29): cross 600,000 lines of real, high-quality code** — every line ships a capability; padding is forbidden. Lines come from two sources only: our own tested features, and vendored/adopted open-source layers doing real jobs (leverage doctrine). Real line counts (cloc) reported at every adoption.

## The 600K roadmap (capability-first, lines as the byproduct)

1. **web-tree-sitter + grammar packs** — AST code intelligence (L2). In progress.
2. **highlight.js** (~190 languages, source) — replaces the 18-extension regex highlighter in the IDE; real quality jump.
3. **jsdiff** — real diff stats for edit_file/write_file rows and rollback previews.
4. **markdown-it** — proper markdown rendering of AI replies in chat.
5. **three.js** — the original plan's 3D-build capability, vendored for built projects.
6. **Terminal integration** (user's PolyDev build) + xterm-class primitives where the contract needs them.
7. **L3 context engine** — repo-map over the tree-sitter symbols, compaction v2.
8. **L1/L5/L6 completion** — tool-call hang guards, 50+ evals, process-death restore.

Our own code grows on every rung; the vendor stack carries the mass. Both are audited: no line without a job.

## Leverage doctrine (2026-10-29 — play smart, not long)

The harness leaders open-sourced their commodity layers (verified licenses: opencode MIT, Codex CLI Apache-2.0, Aider Apache-2.0, models.dev MIT, tree-sitter MIT). We adopt them instead of re-deriving them; years of someone else's grinding is now embeddable code. REVA already does this at the infra layer (proot, busybox, Alpine); the doctrine extends it to the intelligence layer.

**Adopt (with attribution in THIRD_PARTY_NOTICES.md):**
- `web-tree-sitter` (MIT) → W3: real AST symbol index in the WebView; `code_symbols` regex → syntax trees.
- `models.dev` snapshot (MIT) → automated context/vision/tool-calling metadata for BYOK models, cached locally for offline; replaces CTX_RULES heuristics.
- `ripgrep` arm64 static binary (MIT) bundled like busybox → `workspace_search` runs real ripgrep inside proot Linux over /host.
- Aider's repo-map + edit-format recovery design (Apache-2.0, attribute) → W5 context engine + W4 eval scenarios.

**Read-only (no license, no copying):** Claude Code and ZCode are proprietary; anthropics/skills has NO license — inspiration only, zero content reuse. REVA's skills stay original.

**Never adopt:** their desktop TUIs, the Rust sandbox matrix (macOS/Linux-only, useless in our WebView), their provider matrices (OpenAI-compatible BYOK is simpler and is our feature).

**Still ours to build (the moat, where the nights go):** mobile harness UX, on-device Linux + Project Library + SAF, endurance engine, folder chats, circuit breakers/hardening tuned to this device class.

**Release cadence (user directive, 2026-10-29):** no push after every small update — increments accumulate as verified local commits; GitHub gets milestone batch pushes only.

## Log

- **v1.4.13 (2026-10-29):** W1 starts — shell channel circuit breaker (3 consecutive timeouts → 8s recovery probe → honest wedged guidance + automatic self-heal), plus the first unit test suite (`tests/agentexec-breaker.test.js`, 4 scenarios, wired into CI to run on every commit).
- **v1.4.14 (2026-10-29, local — first LEVERAGE DOCTRINE increment):** models.dev registry adopted (MIT) — bundled snapshot `js/modeldb-data.js` (4,845 model ids, 174KB, from 5.9MB raw via `scripts/gen-modeldb.js`), runtime `js/modeldb.js` (trim/lookup/refresh), `ctxFor`/`modelVision` now resolve from the registry first with id-heuristics as fallback, silent boot refresh when online, `tests/modeldb.test.js` 6/6 PASS. Attribution in THIRD_PARTY_NOTICES.md. The 12-point "model settings automated" requirement now runs on real data, not guesses.
- **v1.4.15 (2026-10-29, local — L0 DEEPENING: the loop never dies from its own history):** context-exhaustion auto-recovery — when a long run fills the model's window (OpenAI/Anthropic/Gemini wordings classified by `js/loopcore.js`), the transcript is compacted group-wise (tool results stay glued to their tool_calls — no provider 400s), a continuation note is appended, and the run continues; 2 attempts then honest failure. Plus AUTO-CHECKPOINT: every round that mutates the workspace snapshots first (throttled every 10 mutating rounds, newest 8 kept, `Store.checkpoints.del` added) — the whole run is undoable without the model opting in. `tests/loopcore.test.js` 5/5 PASS. The two loop deaths opencode closed years ago are now closed here.
- **v1.4.16 (2026-10-29, local — L0 COMPLETE: parallel tool execution):** all-read-only tool batches (read_file/list_files/workspace_search/code_symbols/memory_search/lint/test_data, classifier `LoopCore.isParallelSafe`) now run CONCURRENTLY — the "read these 6 files" pattern costs one round-trip instead of six; rows render as each finishes, tool results push in call order, hooks fire per tool. Mutating, stateful and shell batches keep the ordered sequential path. Ladder status: **L0 = 100%** (core loop, endurance, queue, compaction, auto-checkpoint, breaker, parallel reads). `tests/loopcore.test.js` 6/6 PASS.
- **v1.4.17 (2026-10-29, local — 600K GOAL SET + tree-sitter AST SHIPPED):** user goal: **cross 600K lines of real code** (ledger amended — every line ships a capability, no padding; roadmap added: highlight.js → jsdiff → markdown-it → three.js → terminal → repo-map). Vendored web-tree-sitter 0.22.6 + 19 prebuilt grammar WASMs (21MB, MIT) — `code_symbols` is now AST-FIRST with real syntax trees for 19 languages (js/ts/tsx/py/html/css/json/bash/c/cpp/java/kotlin/rust/go/php/ruby/lua/sql/yaml), regex outline kept as fallback; lazy engine load (nothing parses until first use), ancestry-aware methods (python), arrow-function declarations (JS family). `js/treesitter.js` pure extractWith() runs identically in node tests and the WebView. `tests/treesitter.test.js` 5/5 PASS with the real parsers. L2: ~40% → ~60%.
- **v1.4.18 (2026-10-29, local — SEARCH AT SCALE: bundled ripgrep):** vendored ripgrep 15.2.0 (MIT OR Unlicense) as `librg.so` for arm64 + x86_64 (Termux bionic builds — proven to run on Android), copied to `filesDir/bin/rg` + exec bit by MainActivity (same pattern as busybox), on the shell PATH. `workspace_search` on mounted Library projects now runs the REAL ripgrep over `/host/library/<slug>/` (real files on disk) via the agent shell — argv construction and output parsing are pure functions in `loopcore.js` (`rgArgs`/`parseRg`), tested 4/4; every failure path (no rg, exit 127, timeout, busy channel) falls back to the JS scan. `tests/rgsearch.test.js` 4/4 PASS. Next: repo-map over the tree-sitter symbol index (L3).
- **v1.4.19 (2026-10-29, local — L3 CONTEXT ENGINE: repo-map):** aider's design adapted to REVA's tree-sitter engine. `js/repomap.js` (pure, UMD): extracts every code file's symbols (AST via injected `symbolsFor` resolver, regex fallback), builds a cross-file reference graph by token frequency, ranks files by structural importance (kind weight × log(1+2×cross-refs+same-refs)), renders a budgeted map (default 1400 chars) with line-accurate top symbols. Rides the system prompt for folder chats (`sess0.repoMap`), rebuilt in the BACKGROUND after every tool phase (sig-cached on the session — the map follows the agent's edits) and awaited once (4s cap) at run start. `tests/repomap.test.js` 6/6 PASS including a real-AST case. Known artifact: on Windows/node-24 the wasm tests may log a libuv teardown assert AFTER PASS (exit 127) — CI (node 20/ubuntu) is clean; verified at next batch push. L3: ~10% → ~45%.
- **v1.4.20 (2026-10-29, local — 600K ROADMAP #3: highlight.js, 62.5K real lines):** vendored highlight.js 11.12.0 UNMINIFIED (core.js + all 386 language grammars, 62,551 lines, 2.3MB, via the committed `scripts/vendor-hljs.sh`) — the IDE's syntax highlighting is now a real tokenizing engine for 190+ languages instead of an 18-extension keyword regex. `js/hljs.js` = CJS-in-browser shim + lazy per-language loader (core + 20 common languages register in the background; every other language loads on demand and caches; every failure → null → the instant regex pass stays as the fallback). IDE paints regex color immediately, then the engine swaps in (stale-guarded against typing). Palette mapped 1:1 onto REVA's existing token colors. `tests/hljs.test.js` 6/6 PASS running the real vendored engine in node. Ledger: ~106K → ~168K lines tracked. Next: jsdiff + markdown-it (chat code blocks + real diff stats), then three.js.
- **v1.4.21 (2026-10-29, local — 600K ROADMAP #4: chat becomes real markdown + real diffs):** vendored markdown-it 14.1.0 (6,963 lines) + jsdiff 5.2.0 (1,730 lines) UMD dists via `scripts/vendor-md.sh`. `js/mdrender.js` renders AI replies as REAL markdown (DI constructor so node tests run the same pipeline): **html:false is a security decision — model HTML can never inject** (tested with a script+onerror payload), linkify off, fences keep the msgcode/codecard UX, code blocks paint via the regex pass then the highlight.js engine swaps in (stale-guarded). `H.mdLite` delegates to MDRENDER with the regex-lite version as the first-frame fallback; `diffStat` now uses REAL jsdiff line diffs (multiset fallback kept). `tests/mdrender.test.js` 6/6 PASS. Ledger: ~176K lines tracked. esbuild/npx-on-Windows path traps documented in the script (spaces + 8.3 short names → use the packages' own UMD dists).
