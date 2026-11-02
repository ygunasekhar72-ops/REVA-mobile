# REVA v1.5.0 — The Foundation Release

**REVA is a local-first mobile AI harness** — a real agent on your phone: it plans, builds, and verifies projects end-to-end, offline-first, with a real Linux terminal, project library, IDE, and 73 tools. v1.5.0 is the foundation release: the runtime got a deep, tested core.

## The headline: a foundation-first runtime

The strategy pivoted from volume to depth — big harnesses win on runtime, not content. Everything below is node-tested pure engines plus on-device verified wiring.

### Provider Core v2
- **Three native protocols**: OpenAI-compatible (default), **Anthropic Messages**, and **Gemini generateContent** — translated to one internal shape, so the agent loop never learns a second protocol. BYOK: Claude and Gemini keys now work directly.
- **The kernel is pure and node-tested** (27 unit suites): multi-key rotation surviving per-key quota walls, error classification (quota vs transient), HTTP hints, retry/window-wait decisions, the length-finish token-budget ladder, SSE parsing tolerant of keepalives and partial JSON, tool-call fragment merging, and textual-tool-call lifting for providers that leak calls as text.
- **Token accounting**: in/out/cached/reasoning tokens extracted per family; a per-session TokenMeter projects the context-window pressure.

### Context Engine v2 — compaction that anticipates
The run **pre-compacts at ≥85% projected window pressure before the provider refuses** — long builds no longer burn a failed request to discover the context died. The reactive path stays as the safety net. The resume brief tells the model its own pressure (`~42k in / 3k out, peak 42% of the window seen`).

### RunState v2 — a killed run resumes with its memory
Mid-run snapshots now carry the token meter, iteration count, and model. Stop or kill the app mid-build: the resume chip restores pressure continuity and the model resumes informed. (Also fixed: `shell_exec` rows were blank in resume briefs since L6.)

### Four new engines (all pure, all tested)
- **i18n** — real fallback chains, CLDR-style plurals (en/fr/ru/pl/ar), locale formatting, best-locale negotiation.
- **Scheduler** — vixie cron, drift-correcting intervals, missed-run policy for frozen WebViews (Android pauses timers for hours).
- **Test Factory** — detects a module's export contract and scaffolds honest node tests (self-proof: generated scaffolds execute and pass).
- **Permission Core** — a tool policy engine with per-argument rules and an audit ring; **Guard mode now hard-denies the destructive set at dispatch**. Inert by default.

### Code Intelligence
The IDE harness console gains **`def <symbol>`** (jumps to the definition, same file first) and **`refs <symbol>`** (every usage, path:line). Cross-file, workspace-wide.

## Launch blockers caught before any phone saw them
The deadline E2E on the real emulator (driving the real APK with a real model) caught:
1. **A dead boot** — a subsystem commit had overwritten the app's persistence layer; restored verbatim from git, both stores now coexist by design.
2. **A request-killer schema** — one tool schema had an inverted envelope; strict gateways 400'd the entire request whenever it was picked. Fixed + boot filter + regression.

A 16/16 device sweep of every surface caught a Models-screen crash on any configured provider and a dead section header — fixed.

## Also in v1.5.0
- Skills at **422 / 675KB** (frozen — the right size), 73 tools, IDE with find/replace, gutter diffs, ⌘K palette, local history, side-by-side diffs.
- 27 unit suites + 19/19 agent evals run in CI on every commit.
- Install-over-previous (same signing key); no data loss upgrading from v1.4.x.

## The honest ledger
~22,200 hand-written harness lines + ~130K vendored runtime sources + 3.79M grammar forge build-inputs. The 600K hand-written march continues post-launch as v1.5.x — this release is the first solid-foundation milestone, not the end.
