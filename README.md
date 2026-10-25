# REVA

A minimal, local-first, mobile-styled AI harness that runs entirely in your browser — and on Android as an APK. Bring any OpenAI-compatible endpoint — OpenAI, OpenRouter, Groq, a local Ollama or LM Studio, NVIDIA NIM, or anything that speaks `/chat/completions` — and get a phone-shaped agent with an agentic tool loop, workspace IDE, memory, context compaction, plugins, MCP server discovery and webhooks. No build step, no framework, no backend, no telemetry.

## Download for Android

Grab the latest APK from [Releases](../../releases) — built automatically by GitHub Actions on every push to `main`. Install by opening the downloaded file (Android asks to allow installs from the browser). The APK bundles the whole app: it works offline and stores everything on-device.

In the APK, API calls go out directly — no CORS proxy needed. Point a custom provider at e.g. `https://integrate.api.nvidia.com/v1` (NVIDIA NIM), paste your key, fetch models, go.

## Features

- **Real terminal** — a full-window xterm.js terminal (line editing, history, Ctrl+C). In the **Android APK** it runs a real device shell via a native bridge (commands exec as argv in the app sandbox — injection-safe, no shell-string eval); in the browser it fronts the harness console until a WASM backend is bundled.
- **Built-in browser** — URL bar with search fallback (DuckDuckGo Lite), back/forward/reload, quick links, a workspace home listing pages your agent built (tap to run them), and an honest "site refuses embedding" card with an open-externally escape for X-Frame-Options sites.
- **Live agent activity feed** — a ZCode-style feed in every reply: Thinking rows with durations, tool calls as they happen (Writing `index.html` · 6.8 KB), terminal commands with their output, and a spinner while the model works. Navigating away mid-build is safe — coming back re-attaches the live stream.
- **Agent with real tools** — the model writes/reads/lists/deletes workspace files, saves memories, installs plugins for you, and runs a harness console — in a loop until the task is done.
- **Per-chat workspaces** — every new chat starts with its own empty workspace; the IDE, Files tab, attachments and tools all scope to the active chat.
- **Workspace IDE** — full-window overlay with file tree, syntax-highlighted editor (Ctrl+S), sandboxed live preview for HTML apps, and a real harness terminal with command history.
- **Working effort control** — Low/High/Max right in the chat composer; it shapes the system prompt and sends `reasoning_effort` to supporting endpoints (auto-detected, gracefully skipped elsewhere).
- **Model verification** — fetching models probes every entry with a real request; dead catalog entries (NVIDIA lists dozens) are removed and only verified-working models get the ✓ badge. Manual adds are tested before being accepted.
- **Chat with any OpenAI-compatible provider** — streaming, stop/retry, per-session model choice, fallback provider, up to 2M-token context window setting.
- **Smart compaction** — auto/manual compaction summarizes only the older slice (model-made or local), keeps the recent messages live in context, merges summaries incrementally, and retains the newest checkpoints.
- **Practical modes** — Plan mode literally withholds file-modifying tools (read-only + planning), Guard disables destructive ones, Build/Edit/Yolo shape behavior via the prompt.
- **Memory** — manual notes plus AI-saved memories (`save_memory`), injected into the system prompt every turn.
- **Skills & plugins** — user-authored skills (plus a one-click starter pack) and plugin packs the AI can build and install itself.
- **Files** — per-chat virtual workspace, file/folder/image upload, image previews, read-only mounting of a real folder (Chromium).
- **MCP servers** — real Model Context Protocol handshake over Streamable HTTP with tool counts.
- **Hooks & automations** — JSON webhooks on session lifecycle events; scheduled prompts.
- **Three monochrome themes**, 3D depth/radius/text-size controls, reduced-motion support, installable as a PWA, and a signed Android APK built by CI.

## Quick start

No build, no install:

```bash
# option 1 — just open it
open index.html            # macOS
start index.html           # Windows

# option 2 — serve it (recommended, enables the PWA manifest)
python -m http.server 8080
# → http://localhost:8080
```

The app boots with an offline **Echo** provider so you can try the whole UI without any API key.

## Connecting a real model

1. **Settings → Model → Provider** (or the *Set up* banner on home).
2. Pick a preset — OpenAI, OpenRouter, Groq, Ollama, LM Studio — or add any custom base URL.
3. Paste your API key (stored **only** in your browser's `localStorage`) and press **Fetch models**.
4. Select a model and start chatting.

### CORS notes

The browser enforces CORS on every request:

- **Ollama**: start with `OLLAMA_ORIGINS=* ollama serve`.
- **LM Studio**: enable CORS in the server settings tab.
- **Remote APIs**: most major providers allow browser requests. If a provider doesn't, you'll get a clear network/CORS error card with hints.

## MCP servers

Settings → MCP servers accepts any MCP server speaking the [Streamable HTTP transport](https://modelcontextprotocol.io) (e.g. `https://host/mcp`). Mono Harness performs the `initialize` handshake and `tools/list` discovery, and shows reachable status plus tool count. Tool execution is not possible from a plain web page by design — wire a desktop bridge if you need it.

## Plugins & skills

- **Plugins** are instruction packs (name + description + prompt block) injected into the system prompt while enabled. Add your own on the Plugins screen (+), or ask the model — it installs them for you via its `add_plugin` tool.
- **Skills** are user-authored at runtime (Settings → Skills → +): a name and description announced to the model every turn.
- **Tools** are built in (`js/tools.js`): workspace file operations, memory, plugin installation, and the harness console. They operate on the app's virtual workspace only — there is no OS shell.

## Privacy

- Everything — sessions, memories, keys, files — stays in your browser's `localStorage`. There is no server, no analytics, no telemetry.
- The only network traffic is what you configure: your chosen AI provider, your webhooks, and MCP servers you add.
- **Clear all session data** in Settings → General wipes storage.

## Project structure

```
index.html          — the whole UI (screens, overlays, sheets, IDE)
css/app.css         — monochrome design system, 3 themes, IDE styles
js/util.js          — helpers: escaping, mini-markdown + syntax highlighter, navigation
js/store.js         — localStorage store + defaults (v3, migrates v2)
js/tools.js         — built-in agent tools + harness console commands
js/ai.js            — OpenAI-compatible client: streaming, reasoning, tool calls
js/mcp.js           — MCP Streamable HTTP client (initialize, tools/list)
js/ui.js            — per-screen renderers (incl. tool cards, thinking blocks)
js/ide.js           — workspace IDE (tree, editor, preview, terminal)
js/app.js           — application controller, agent loop, event wiring
js/vendor/          — vendored lucide icons (fully offline)
assets/icon.svg     — app icon
android/            — minimal WebView wrapper (the APK ships the web app in assets/)
.github/workflows/  — APK build + release pipeline
```

## Browser support

Best in current Chrome / Edge (File System Access API, PWA install). Firefox and Safari work for everything except mounting a real device folder — file import covers that case.

## License

[MIT](LICENSE)
