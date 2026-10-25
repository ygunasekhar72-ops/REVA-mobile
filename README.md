# Mono Harness

A minimal, local-first, mobile-styled AI harness that runs entirely in your browser. Bring any OpenAI-compatible endpoint — OpenAI, OpenRouter, Groq, a local Ollama or LM Studio, or anything that speaks `/chat/completions` — and get a phone-shaped agent with sessions, memory, context compaction, plugins, skills, MCP server discovery and webhooks. No build step, no framework, no backend, no telemetry.

## Features

- **Agent with real tools** — the model writes/reads/lists/deletes workspace files (`write_file`, `read_file`, `list_files`, `delete_file`), saves memories (`save_memory`), installs plugins for you (`add_plugin`), and runs a harness console (`run_command`) in a loop until the task is done. Tool calls render as compact cards ("Writing pomodoro.html · 3.1 KB") instead of code dumps.
- **Thinking display** — reasoning models' thought streams (`reasoning_content`) are captured and shown in a collapsible "Thinking" block per reply.
- **Chat with any OpenAI-compatible provider** — streaming, stop/retry, per-session model choice, fallback provider, markdown with syntax-highlighted code (long code blocks collapse).
- **Workspace IDE** — full-window overlay with file tree, code editor (Ctrl+S), sandboxed live preview for HTML apps, and a harness terminal shared with the model.
- **Sessions** — autosaved, resumable, deletable, with per-session token estimates.
- **Context management** — live context meter, auto-compaction with model or local summaries, checkpoint snapshots.
- **Memory** — manual notes plus AI-saved memories (`save_memory`), all injected into the system prompt every turn.
- **Skills & plugins** — user-authored skills and plugin instruction packs; the AI can build and install plugins on request.
- **Permissions** — five agent modes (Plan / Build / Edit / Yolo / Guard) plus user-defined allow-rules.
- **Files** — virtual workspace, file/folder/image upload, image previews, and read-only mounting of a real folder via the File System Access API (Chromium).
- **MCP servers** — real Model Context Protocol handshake over Streamable HTTP (`initialize` → `tools/list`) with tool counts.
- **Hooks & automations** — JSON webhooks on session start / prompt / done / compaction; scheduled prompts.
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
```

## Browser support

Best in current Chrome / Edge (File System Access API, PWA install). Firefox and Safari work for everything except mounting a real device folder — file import covers that case.

## License

[MIT](LICENSE)
