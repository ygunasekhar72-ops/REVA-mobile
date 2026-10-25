# Mono Harness

A minimal, local-first, mobile-styled AI harness that runs entirely in your browser. Bring any OpenAI-compatible endpoint — OpenAI, OpenRouter, Groq, a local Ollama or LM Studio, or anything that speaks `/chat/completions` — and get a phone-shaped agent with sessions, memory, context compaction, plugins, skills, MCP server discovery and webhooks. No build step, no framework, no backend, no telemetry.

## Features

- **Chat with any OpenAI-compatible provider** — streaming or buffered replies, per-session model choice, stop/retry, markdown + code blocks in replies.
- **Sessions** — autosaved to `localStorage`, resumable, with per-session token estimates.
- **Context management** — live context meter, auto-compaction at a configurable threshold, model-made or local summaries, full checkpoint snapshots of compacted transcripts.
- **Memory** — private notes (user / feedback / project / reference) injected into the system prompt every turn.
- **Skills** — your own capability definitions, announced to the model by name and description.
- **Plugins** — small instruction packs shipped in `js/registry.js`. Install from the marketplace, toggle per need; enabled packs extend the system prompt.
- **Permissions** — five agent modes (Plan / Build / Edit / Yolo / Guard) that reshape the system prompt, plus user-defined allow-rules.
- **Files** — a virtual workspace stored locally, file import, text previews, and read-only mounting of a real device folder via the File System Access API (Chromium browsers).
- **MCP servers** — real Model Context Protocol handshake over Streamable HTTP: `initialize` → `tools/list`, with tool counts surfaced in the UI. (Tool *execution* needs a desktop bridge — the browser sandbox can't spawn local processes.)
- **Hooks** — POST JSON webhooks on session start, user prompt, assistant done, and compaction.
- **Automations** — scheduled prompts that run while the app is open, each creating its own session.
- **Fallback provider** — if the primary provider fails, the request is retried once through a configured fallback.
- **Three monochrome themes**, 3D depth / radius / text-size controls, reduced-motion support, installable as a PWA.

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

- **Plugins** live in `js/registry.js`. Each entry has an `id`, display name, version, icon, and a `prompt` block injected into the system prompt while installed + enabled. Add an entry to publish a plugin to your fork.
- **Skills** are user-authored at runtime (AI Workspace → Skills → +): a name and a description that are announced to the model every turn.

## Privacy

- Everything — sessions, memories, keys, files — stays in your browser's `localStorage`. There is no server, no analytics, no telemetry.
- The only network traffic is what you configure: your chosen AI provider, your webhooks, and MCP servers you add.
- **Clear all session data** in Settings → General wipes storage.

## Project structure

```
index.html          — the whole UI (screens, overlays, sheets)
css/app.css         — monochrome neumorphic design system, 3 themes
js/util.js          — helpers: escaping, mini-markdown, navigation, toasts
js/store.js         — localStorage store + defaults
js/registry.js      — plugin registry (edit to add plugins)
js/ai.js            — OpenAI-compatible client (list models, chat, SSE stream)
js/mcp.js           — MCP Streamable HTTP client (initialize, tools/list)
js/ui.js            — per-screen renderers
js/app.js           — application controller and event wiring
js/vendor/          — vendored lucide icons (fully offline)
assets/icon.svg     — app icon
```

## Browser support

Best in current Chrome / Edge (File System Access API, PWA install). Firefox and Safari work for everything except mounting a real device folder — file import covers that case.

## License

[MIT](LICENSE)
