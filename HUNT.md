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
3. Lines don't count. Working, tested features count.

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
