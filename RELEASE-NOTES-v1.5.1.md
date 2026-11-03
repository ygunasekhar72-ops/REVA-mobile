# REVA v1.5.1 — Durability

Follow-up to the Foundation Release: the deepseek-harness study's second wave, aimed entirely at **long projects**. Four upgrades, all pure engines with tested wiring.

## Tool-result pruner
Oversized tool outputs used to be cut with a flat head-slice — which loses the **end**, where errors live. The pruner keeps the head (60%), the tail (30%), and an honest middle marker (`[… N chars of middle output dropped …]`), so a failed build's final error is always visible to the model. Short results pass untouched.

## Crash repair
A transcript torn mid-tool-round is unanswerable on strict providers (a tool_call with no result → HTTP 400). At the outbound boundary, every unanswered tool_call now gets a synthetic result — *"interrupted before this call ran — treat it as NOT executed; re-issue it if still needed"* — before the next assistant message. Clean transcripts pass through untouched; originals are never mutated.

## Durable retry ledger
Every recovery event — **quota key rotations, transient retries, context compactions, empty-reply ladder** — is recorded on the session (persisted, capped at 40, tagged with its typed failure code). A long run's recovery story survives restarts and is inspectable via `App.retryLog()`. Verified live: a real network failure captured two recovery events on device.

## Anchor-honest token meter
Provider-reported usage is trusted **unless** an independent estimate of the same request wildly disagrees (zero, under ½, or over 3×) — then the estimate wins and the raw reading is kept for diagnostics (`rawIn`). Genuine compaction-driven drops still pass when no estimate is offered. The context-pressure projection behind proactive compaction is now grounded in two independent measurements.

---
Install over v1.5.0 (same key, no data loss). 27 unit suites + 19/19 evals green in CI. The long-project march continues: durable retry *policies* per provider, background jobs runtime, and the LSP-grade code intelligence are the next stones.
