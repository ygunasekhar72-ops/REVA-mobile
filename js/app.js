/* Mono Harness — application controller */
(function () {
  var $ = H.$, $$ = H.$$;
  var root = $('#mono-harness'), phone = $('#phone');
  H.init(root, phone);

  var db = Store.db;
  var state = {
    mounted: null,          // FileSystemDirectoryHandle or null
    handles: {},            // path -> dir handle
    curPath: 'workspace',
    streaming: false,
    ctrl: null,
    pvId: null,             // provider being edited
    mmId: null,             // memory being edited
    auIdx: -1,              // automation being edited
    sheetProv: null         // provider selected inside model sheet
  };

  var MODE_DESC = {
    Plan: 'propose a plan before doing anything; do not assume it will be applied',
    Build: 'be pragmatic and produce working solutions',
    Edit: 'prefer minimal, precise diffs over rewrites',
    Yolo: 'be fast and direct; skip caveats',
    Guard: 'call out risks explicitly before anything destructive'
  };
  /* Starter skill pack — mirrors the capability map of a pro agent runtime */
  var STARTER_SKILLS = [
    ['docx', 'Create and edit Word documents; revisions, comments, format-preserving edits, DOCX to PDF/images'],
    ['pdf', 'PDF production: reports, posters, LaTeX papers, merge/split, text extraction'],
    ['pptx', 'Build PowerPoint decks from scratch or outlines; read and restyle existing decks'],
    ['xlsx', 'Excel/CSV/XLSM workbooks: create, edit, analyze, formulas, pivot data'],
    ['docx-viewer', 'Open and discuss Word files with the user in a document viewer'],
    ['pdf-viewer', 'Open and discuss PDFs with the user in a viewer'],
    ['pptx-viewer', 'Open and discuss slide decks with the user in a viewer'],
    ['xlsx-viewer', 'Open and discuss spreadsheets with the user in a viewer'],
    ['control-browser', 'Drive a real browser: navigate, click, type, fill forms, screenshot, verify pages'],
    ['web-gui-tester', 'Black-box test web UIs like a real user: clicks, input, scrolling, visual checks'],
    ['visualize', 'Interactive charts, simulations and visual tools rendered inline for the user'],
    ['mermaid-visualizer', 'Turn text into Mermaid flowcharts, architecture and sequence diagrams'],
    ['excalidraw-diagram', 'Generate Excalidraw diagrams: Obsidian, standard, or animated output'],
    ['json-canvas', 'Create and edit JSON Canvas boards: mind maps, flows, canvases'],
    ['obsidian-bases', 'Obsidian Bases (.base): database views, filters, formulas over notes'],
    ['obsidian-markdown', 'Obsidian-flavored markdown: wikilinks, embeds, callouts, frontmatter, tags'],
    ['obsidian-cli', 'Manage an Obsidian vault via CLI: notes, tasks, properties, plugin reloads'],
    ['obsidian-setup', 'Verify and install Obsidian CLI, defuddle and knap tooling'],
    ['defuddle', 'Extract clean article markdown from web pages, dropping clutter and navigation'],
    ['knap', 'Render markdown from templates and structured data with the Knap CLI'],
    ['cloudbase', 'Tencent CloudBase: web apps, mini-programs, cloud functions, databases, hosting'],
    ['mimosa-security-scan', 'Run a sealed, reproducible deep security scan of a repository'],
    ['reverse-engineer-anything', 'Reverse engineer binaries, Electron/managed apps, firmware, and web bundles'],
    ['computer-use', 'Control native desktop apps and the OS UI directly'],
    ['skill-creator', 'Author new skills: write SKILL.md, improve triggers and wording'],
    ['plugin-creator', 'Build agent-host plugins and local marketplaces'],
    ['dynamic-workflows', 'Write and debug multi-agent workflow scripts: fan-out, gating, typed results'],
    ['configuration-guide', 'Configure extension resources: MCP servers, commands, skills, hooks, plugins'],
    ['diagnose-commands', 'Diagnose and fix custom slash-command configuration problems'],
    ['diagnose-hooks', 'Diagnose and fix hook configuration problems: events, matchers, timeouts'],
    ['diagnose-mcp', 'Diagnose MCP server connection and tool-discovery problems'],
    ['diagnose-plugins', 'Diagnose plugin and marketplace problems'],
    ['diagnose-skills', 'Diagnose skill discovery: shadowing, precedence, disabled skills']
  ];
  var GREET = { en: ['Good morning', 'Good afternoon', 'Good evening'], hi: ['सुप्रभात', 'नमस्ते', 'शुभ संध्या'], de: ['Guten Morgen', 'Guten Tag', 'Guten Abend'] };

  /* ================= appearance ================= */
  function applyAppearance() {
    var s = db.settings;
    phone.setAttribute('data-theme', s.theme);
    document.body.setAttribute('data-page-theme', s.theme);
    phone.style.setProperty('--depth', (s.depth / 100).toFixed(2));
    phone.style.setProperty('--r', s.radius + 'px');
    phone.style.setProperty('--fs', s.font + 'px');
    phone.setAttribute('data-ico', s.icons);
    phone.classList.toggle('no-motion', !s.motion);
    $$('#thCards .thc').forEach(function (c) { c.classList.toggle('sel', c.getAttribute('data-theme') === s.theme); });
    $('#rngDepth').value = s.depth; $('#valDepth').textContent = s.depth + '%';
    $('#rngRad').value = s.radius; $('#valRad').textContent = s.radius + 'px';
    $('#rngFont').value = s.font; $('#valFont').textContent = s.font + 'px';
    $('#tglMotion').checked = !s.motion;
    $$('#icoSeg button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-ico') === s.icons); });
    $('#valTok').textContent = s.maxTokens + 'k'; $('#rngTok').value = s.maxTokens;
    $$('#effSeg button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-eff') === s.effort); });
    $('#swStream').checked = s.stream; $('#swThink').checked = !!s.think;
    $('#selCtxK').value = String(s.ctxK);
    $('#ringTotal').textContent = 'of ' + s.ctxK + 'k';
    $('#compactAt').textContent = s.compactAt + '%';
    $('#swAutosave').checked = s.autosave; $('#swCheckpoints').checked = s.checkpoints;
    $('#swNotify').checked = s.notify;
    $('#selLang').value = s.lang;
    $$('#pmodeSeg button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-pm') === s.mode); });
    $('#pmodeDesc').textContent = s.mode + ' — the agent will ' + MODE_DESC[s.mode] + '.';
    renderToolsPill();
    renderFallbackSel();
  }
  function renderToolsPill() {
    var on = db.settings.tools !== false;
    $('#toolsPill').classList.toggle('off', !on);
    $('#toolsTxt').textContent = on ? 'Tools' : 'Tools off';
  }
  function renderFallbackSel() {
    var sel = $('#selFallback');
    sel.innerHTML = '<option value="">None</option>' + db.providers.map(function (p) {
      return '<option value="' + p.id + '"' + (db.settings.fallbackId === p.id ? ' selected' : '') + '>' + H.esc(p.name) + '</option>';
    }).join('');
  }

  /* ================= clock / greeting ================= */
  function clock() {
    var d = new Date();
    $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var g = GREET[db.settings.lang] || GREET.en;
    $('#greetTxt').textContent = d.getHours() < 12 ? g[0] : d.getHours() < 17 ? g[1] : g[2];
  }

  /* ================= system prompt & context ================= */
  function sysPrompt() {
    var s = db.settings;
    var p = ['You are the assistant inside REVA — a minimal, local-first mobile AI harness. Be concise and helpful.'];
    p.push('Mode — ' + s.mode + ': ' + MODE_DESC[s.mode] + '.');
    p.push('Reasoning effort: ' + s.effort + '.');
    if (s.think) p.push('Think step by step for non-trivial requests before answering.');
    var skills = db.skills.filter(function (k) { return k.on; });
    if (skills.length) {
      p.push('Enabled skills:');
      skills.forEach(function (k) { p.push('- ' + k.name + (k.desc ? ': ' + k.desc : '')); });
    }
    var packs = db.plugins.filter(function (p) { return p.on; });
    packs.forEach(function (r) { p.push('Plugin ' + r.name + ':\n' + r.prompt); });
    if (db.settings.tools !== false) {
      p.push('You have tools: write_file, read_file, list_files, delete_file, save_memory, add_plugin, run_command. ' +
        'When asked to build or change anything, DO IT with write_file instead of pasting large code blocks in chat — ' +
        'the harness renders your tool calls as file cards and the user can run the result. ' +
        'Use save_memory to remember durable facts about the user or project.');
    }
    if (db.allowRules.length) {
      p.push('The user has pre-approved these commands without confirmation: ' + db.allowRules.map(function (r) { return r.rule; }).join(', ') + '.');
    }
    if (db.memories.length) {
      p.push('User memory (from the private AI workspace):');
      db.memories.forEach(function (m) { p.push('- ' + m.title + ': ' + m.body.slice(0, 300)); });
    }
    var sess = Store.active();
    if (sess && sess.todos && sess.todos.length) {
      p.push('Current todos: ' + sess.todos.map(function (t) { return (t.done ? '[x] ' : '[ ] ') + t.t; }).join(' '));
    }
    if (sess && sess.summary) p.push('Summary of earlier conversation:\n' + sess.summary);
    return p.join('\n');
  }
  function visibleMessages(sess) {
    sess = sess || Store.active();
    if (!sess) return [];
    return sess.messages.slice(sess.cutAt || 0);
  }
  function apiMessages() {
    var vis = visibleMessages();
    return [{ role: 'system', content: sysPrompt() }].concat(
      vis.map(function (m) { return { role: m.role, content: m.content }; })
    );
  }
  function histTokens() {
    return visibleMessages().reduce(function (a, m) { return a + H.tok(m.content); }, 0);
  }
  function refreshCtx() {
    UI.renderCtx(H.tok(sysPrompt()), histTokens());
    UI.renderBuffer(Store.active());
  }

  /* ================= chat ================= */
  function openChat() { H.push('ov-chat'); }
  App = window.App || {};
  function ensureSession() { return Store.active() || Store.newSession(); }

  function setSendStop(on) {
    var b = $('#sendBtn');
    b.classList.toggle('stop', on);
    b.innerHTML = '<i data-lucide="' + (on ? 'square' : 'arrow-up') + '"></i>';
    H.icons();
  }

  async function send(text) {
    if (state.streaming) return;
    text = (text !== undefined ? text : $('#chatInput').value).trim();
    if (!text) { H.toast('Type a message first'); return; }
    $('#chatInput').value = '';
    var s = ensureSession();
    if (!s.messages.length) s.title = text.slice(0, 38).replace(/\n/g, ' ');
    s.messages.push({ role: 'user', content: text, ts: Date.now() });
    s.updatedAt = Date.now(); s.model = db.settings.model;
    Store.save();
    UI.renderChat(s); UI.renderChatHead(s); refreshCtx(); UI.renderHome();
    fireHook('User prompt', { text: text });
    await streamReply(s);
  }

  async function streamReply(s) {
    var prov = Store.activeProvider();
    var flow = $('#msgFlow'), scroller = $('#chatMsgs');
    var typing = H.el('<div class="typing"><i></i><i></i><i></i></div>');
    flow.appendChild(typing);
    scroller.scrollTop = scroller.scrollHeight;
    var bubble = null, thinkEl = null, contentEl = null, statusEl = null, acc = '', accRe = '';
    state.streaming = true; setSendStop(true);
    state.ctrl = new AbortController();
    var toolsOn = db.settings.tools !== false;
    var MAX_ITERS = 8;

    /* live activity chip so the user can see what the agent is doing */
    function setStatus(txt) {
      if (!txt) { if (statusEl) { statusEl.remove(); statusEl = null; } return; }
      var b = ensureBubble();
      if (!statusEl) {
        statusEl = H.el('<div class="agent-status"><span class="dots"><i></i><i></i><i></i></span><span class="stxt"></span></div>');
      }
      statusEl.querySelector('.stxt').textContent = txt;
      b.appendChild(statusEl);
      if (stick) scroller.scrollTop = scroller.scrollHeight;
    }

    function atBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90; }
    var stick = true;
    function ensureBubble() {
      if (!bubble) {
        typing.remove();
        bubble = H.el('<div class="msg ai"></div>');
        flow.appendChild(bubble);
      }
      return bubble;
    }
    function ensureThink() {
      var b = ensureBubble();
      if (!thinkEl) {
        thinkEl = H.el('<details class="think" open><summary><i data-lucide="brain"></i>Thinking</summary><div class="think-body"></div></details>');
        b.insertBefore(thinkEl, b.firstChild);
        H.icons();
      }
      return thinkEl.querySelector('.think-body');
    }
    function ensureContent() {
      var b = ensureBubble();
      if (!contentEl) {
        contentEl = H.el('<div class="ai-seg"></div>');
        b.appendChild(contentEl);
      }
      return contentEl;
    }
    function onDeltaFn(d) {
      setStatus(null);
      ensureContent(); acc += d;
      if (stick) stick = atBottom();
      contentEl.innerHTML = H.mdLite(acc);
      H.icons();
      if (stick) scroller.scrollTop = scroller.scrollHeight;
    }
    function onReasoningFn(d) {
      var body = ensureThink();
      setStatus('Thinking…');
      accRe += d;
      body.textContent = accRe.slice(-4000);
      body.scrollTop = body.scrollHeight;
      if (stick) scroller.scrollTop = scroller.scrollHeight;
    }
    function appendToolCard(t) {
      var b = ensureBubble();
      contentEl = null; // next content starts a fresh segment under the card
      var card = H.el('<div class="toolcard' + (t.ok === false ? ' terr' : '') + '"><div class="th"><i data-lucide="' +
        (t.ok === false ? 'alert-circle' : 'wrench') + '"></i>' + H.esc(t.label) +
        (t.meta ? '<span class="st">' + H.esc(t.meta) + '</span>' : '') + '</div></div>');
      b.appendChild(card);
      H.icons();
      if (stick) scroller.scrollTop = scroller.scrollHeight;
    }
    function aborted(e) { return e && (e.aborted || e.name === 'AbortError'); }
    function callAI(provider) {
      return AI.chat({
        provider: provider,
        model: db.settings.model,
        messages: apiMsgs,
        stream: db.settings.stream,
        maxTokens: db.settings.maxTokens,
        signal: state.ctrl.signal,
        tools: toolsOn ? Tools.schemas : undefined,
        onDelta: onDeltaFn,
        onReasoning: onReasoningFn
      });
    }

    var apiMsgs = apiMessages();
    var toolResults = [], failed = null, stopped = false, usedFallback = false, iters = 0, res = null;

    while (true) {
      iters++;
      setStatus(iters === 1 ? 'Connecting…' : 'Working…');
      try {
        res = await callAI(prov);
      } catch (e) {
        if (aborted(e)) { stopped = true; break; }
        var fb = db.providers.find(function (x) { return x.id === db.settings.fallbackId; });
        if (fb && fb.id !== prov.id) {
          H.toast(prov.name + ' failed — retrying via ' + fb.name);
          try {
            res = await callAI(fb);
            usedFallback = true;
            H.toast('Replied via fallback ' + fb.name);
          } catch (e2) {
            if (aborted(e2)) { stopped = true; break; }
            failed = e2; break;
          }
        } else { failed = e; break; }
      }
      if (state.ctrl.signal.aborted) { stopped = true; break; }

      if (res.toolCalls && res.toolCalls.length && iters < MAX_ITERS) {
        apiMsgs.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
        for (var i = 0; i < res.toolCalls.length; i++) {
          var tc = res.toolCalls[i];
          var args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          var info = Tools.brief(tc.function.name, args, 'ok');
          setStatus(info.label + '…');
          var result = Tools.run(tc.function.name, args);
          info = Tools.brief(tc.function.name, args, result);
          info.name = tc.function.name;
          toolResults.push(info);
          appendToolCard(info);
          apiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 4000) });
        }
        acc = ''; contentEl = null;
        refreshCtx(); UI.renderHome();
        continue;
      }
      break;
    }
    setStatus(null);

    if (failed) {
      typing.remove();
      s.messages.push({ role: 'assistant', err: true, content: AI.friendlyError(failed), ts: Date.now() });
    } else if (stopped) {
      typing.remove();
      if (acc || toolResults.length) s.messages.push({ role: 'assistant', content: (acc ? acc + '\n\n*(stopped)*' : '*(stopped mid-task — see tool activity above)*'), reasoning: accRe || undefined, tools: toolResults.length ? toolResults : undefined, ts: Date.now() });
      else H.toast('Generation stopped');
    } else {
      ensureBubble();
      s.messages.push({ role: 'assistant', content: acc || (res && res.content) || '(empty reply)', reasoning: accRe || undefined, tools: toolResults.length ? toolResults : undefined, ts: Date.now() });
    }
    s.updatedAt = Date.now();
    Store.save();
    state.streaming = false; setSendStop(false); state.ctrl = null;
    UI.renderChat(s); UI.renderChatHead(s); refreshCtx(); UI.renderHome(); UI.renderSettingsSubs();
    fireHook('Assistant done', { model: s.model });
    notify('Reply finished', s.title);
    // auto-compact
    var used = H.tok(sysPrompt()) + histTokens();
    if (s.messages.length >= 4 && used / (db.settings.ctxK * 1000) * 100 >= db.settings.compactAt) {
      H.toast('Context over ' + db.settings.compactAt + '% — auto-compacting');
      compact(true);
    }
  }

  function retry() {
    var s = Store.active();
    if (!s || state.streaming) return;
    // drop trailing error message, then re-stream
    var last = s.messages[s.messages.length - 1];
    if (last && last.err) s.messages.pop();
    if (!s.messages.length) return;
    Store.save(); UI.renderChat(s);
    streamReply(s);
  }

  App.openSession = function (id) {
    db.activeId = id; Store.save();
    UI.renderChat(Store.active()); UI.renderChatHead(Store.active()); refreshCtx();
    openChat();
  };
  App.goPath = goPath;
  App.openFile = openFile;
  App.retry = retry;
  App.refreshCtx = refreshCtx;
  App.openPath = function (path) {
    if (!path) return;
    path = String(path).replace(/^\/+/, '');
    if (path.indexOf('workspace/') !== 0) path = 'workspace/' + path;
    var i = path.lastIndexOf('/');
    var dir = i > 0 ? path.slice(0, i) : 'workspace';
    var f = { n: path.slice(i + 1), t: 'code' };
    H.setTab('files');
    goPath(dir);
    openFile(f, dir);
  };

  /* ================= compaction ================= */
  function transcript(s) {
    return visibleMessages(s).map(function (m) { return m.role.toUpperCase() + ': ' + m.content; }).join('\n---\n');
  }
  function localSummary(s) {
    var users = visibleMessages(s).filter(function (m) { return m.role === 'user'; })
      .map(function (m) { return '• ' + m.content.slice(0, 120); });
    var lastA = ''; 
    for (var i = s.messages.length - 1; i >= 0; i--) if (s.messages[i].role === 'assistant' && !s.messages[i].err) { lastA = s.messages[i].content.slice(0, 240); break; }
    return 'Local summary (no model call):\n' + users.slice(0, 8).join('\n') + (lastA ? '\nLast reply: ' + lastA : '');
  }
  async function compact(silent) {
    var s = Store.active();
    if (!s || !visibleMessages(s).length) { H.toast('Nothing to compact'); return; }
    var before = H.tok(sysPrompt()) + histTokens();
    var prov = Store.activeProvider();
    var summary = null, viaApi = false;
    if (prov.type !== 'echo' && prov.key && prov.base) {
      try {
        var sr = await AI.chat({
          provider: prov, model: db.settings.model, stream: false, maxTokens: 4,
          messages: [{ role: 'user', content: 'Summarize this conversation in under 150 words. Keep decisions, file/code references, and open todos:\n\n' + transcript(s) }]
        });
        summary = (sr && sr.content) || null;
        viaApi = !!summary;
      } catch (e) { H.toast('Model summary failed — using local'); }
    }
    if (!summary) summary = localSummary(s);
    var after = H.tok(sysPrompt()) + H.tok(summary) + 40;
    s.compactions = s.compactions || [];
    if (db.settings.checkpoints) {
      s.compactions.unshift({ date: Date.now(), before: before, after: after, api: viaApi, snapshot: transcript(s) });
    } else {
      s.compactions.unshift({ date: Date.now(), before: before, after: after, api: viaApi });
    }
    s.summary = (s.summary ? s.summary + '\n\n' : '') + '[Compacted ' + new Date().toLocaleString() + ']\n' + summary;
    s.cutAt = s.messages.length;   // context drops; visible history stays
    s.updatedAt = Date.now();
    Store.save();
    refreshCtx(); UI.renderBuffer(s); UI.renderHome();
    H.toast('Compacted · ' + H.fmtK(before) + ' → ' + H.fmtK(after) + ' tok');
    fireHook('Compaction', { before: before, after: after });
  }

  /* ================= hooks / notify ================= */
  function fireHook(event, payload) {
    db.hooks.filter(function (h) { return h.on && h.event === event; }).forEach(function (h) {
      fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: 'reva', event: event, payload: payload, ts: Date.now() })
      }).catch(function () {});
    });
  }
  function notify(title, body) {
    if (!db.settings.notify || !document.hidden || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body: String(body || '').slice(0, 90) }); } catch (e) {}
    }
  }

  /* ================= files ================= */
  async function mount() {
    if (state.mounted) {
      state.mounted = null; state.handles = {}; state.curPath = 'workspace';
      $('#dirSub').textContent = 'Virtual workspace (mount a folder)';
      H.toast('Folder unmounted');
      goPath('workspace'); return;
    }
    if (!window.showDirectoryPicker) {
      H.toast('Folder mount not supported here — import files instead');
      $('#fileImport').click(); return;
    }
    try {
      state.mounted = await showDirectoryPicker();
      state.handles = {}; state.curPath = '';
      $('#dirSub').textContent = 'Mounted · ' + state.mounted.name;
      H.toast('Mounted ' + state.mounted.name);
      goPath('');
    } catch (e) { /* user cancelled */ }
  }
  async function handleAtPath(path) {
    if (path === '') return state.mounted;
    if (state.handles[path]) return state.handles[path];
    var parts = path.split('/');
    var dir = state.mounted;
    for (var i = 0; i < parts.length; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    state.handles[path] = dir;
    return dir;
  }
  async function goPath(path) {
    state.curPath = path;
    if (state.mounted !== null) {
      try {
        var dir = await handleAtPath(path);
        var entries = [];
        for await (var entry of dir.values()) {
          if (entry.kind === 'directory') entries.push({ n: entry.name, t: 'dir', handle: entry });
          else entries.push({ n: entry.name, t: 'code', s: '', handle: entry });
        }
        entries.sort(function (a, b) { return (a.t === 'dir' ? 0 : 1) - (b.t === 'dir' ? 0 : 1) || a.n.localeCompare(b.n); });
        UI.renderFiles(entries, path, true);
        return;
      } catch (e) { H.toast('Cannot open folder'); return; }
    }
    var list = db.vfs[path] || [];
    UI.renderFiles(list, path, false);
  }
  function fmtSize(b) { return b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB'; }

  async function openFile(f, path) {
    if (f.t === 'dir') { goPath(f.p !== undefined ? f.p : (path ? path + '/' + f.n : f.n)); return; }    if (f.handle) {
      try {
        var file = await f.handle.getFile();
        if (file.size > 200000) { H.toast('File too large to preview'); return; }
        $('#fsTitle').textContent = f.n;
        $('#fsCode').textContent = await file.text();
        H.openSheet('sheet-file'); return;
      } catch (e) { H.toast('Cannot read file'); return; }
    }
    var key = path + '/' + f.n;
    $('#fsTitle').textContent = f.n;
    var content = db.vfsContent[key] !== undefined ? db.vfsContent[key] : '// no content yet — this file is a placeholder';
    if (/^data:image\//.test(String(content))) {
      $('#fsImg').src = content; $('#fsImg').style.display = '';
      var tc = $('#fsCode').closest('.toolcard'); if (tc) tc.style.display = 'none';
    } else {
      $('#fsImg').style.display = 'none';
      var tc2 = $('#fsCode').closest('.toolcard'); if (tc2) tc2.style.display = '';
      $('#fsCode').innerHTML = H.hi(String(content), H.extLang(f.n));
    }
    H.openSheet('sheet-file');
  }

  function vfsFiles() {
    var out = [];
    Object.keys(db.vfs).forEach(function (path) {
      db.vfs[path].forEach(function (f) { if (f.t !== 'dir') out.push({ path: path + '/' + f.n, n: f.n }); });
    });
    return out;
  }
  function renderAttach() {
    var files = vfsFiles();
    $('#attList').innerHTML = files.map(function (f, i) {
      return '<button class="cmdrow" data-att="' + i + '"><span class="tile sm"><i data-lucide="paperclip"></i></span>' +
        '<span class="rtxt"><b style="font-size:13.5px;font-weight:500">' + H.esc(f.n) + '</b><small class="kbd" style="font-size:11px">' + H.esc(f.path) + '</small></span></button>';
    }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:10px">No files in workspace</p>';
    $('#attList').querySelectorAll('[data-att]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = files[+b.getAttribute('data-att')];
        var content = (db.vfsContent[f.path] || '').slice(0, 6000);
        $('#chatInput').value += '\n\n[file: ' + f.path + ']\n```\n' + content + '\n```';
        H.closeSheets();
        $('#chatInput').focus();
        H.toast('Attached ' + f.n);
      });
    });
    H.icons();
  }

  /* ================= providers ================= */
  function openProviderSheet(id) {
    state.pvId = id;
    var p = id ? Store.provider(id) : null;
    $('#pvTitle').innerHTML = '<i data-lucide="plug-zap" style="width:17px;height:17px"></i>' + (p ? H.esc(p.name) : 'New custom provider');
    $('#pvName').value = p ? p.name : '';
    $('#pvBase').value = p && p.base ? p.base : '';
    $('#pvKey').value = p ? p.key : '';
    $('#pvStatus').textContent = '';
    $('#pvDelete').style.display = p ? '' : 'none';
    H.openSheet('sheet-provider'); H.icons();
  }
  function pvDraft() {
    var p = state.pvId ? Store.provider(state.pvId) : null;
    if (p) {
      p.name = $('#pvName').value.trim() || p.name;
      p.base = $('#pvBase').value.trim();
      p.key = $('#pvKey').value.trim();
      return p;
    }
    var n = 2;
    while (db.providers.some(function (x) { return x.id === 'custom' + n; })) n++;
    p = { id: 'custom' + n, name: $('#pvName').value.trim() || 'Custom ' + n, base: $('#pvBase').value.trim(), key: $('#pvKey').value.trim(), models: [] };
    db.providers.push(p);
    state.pvId = p.id;   // later draft()/save()/fetch() calls reuse this provider
    return p;
  }
  async function pvFetch() {
    var p = pvDraft();
    $('#pvStatus').textContent = 'Fetching models from ' + (p.base || '…') + ' …';
    try {
      var models = await AI.listModels(p);
      p.models = Array.from(new Set(p.models.concat(models)));
      Store.save(); UI.renderModels(); UI.renderSettingsSubs();
      $('#pvStatus').textContent = '✓ ' + models.length + ' models found' + (models.length ? ' — e.g. ' + models.slice(0, 2).join(', ') : '');
    } catch (e) {
      $('#pvStatus').textContent = '✗ ' + AI.friendlyError(e).split('\n')[0];
    }
  }
  async function pvTest() {
    var p = pvDraft();
    $('#pvStatus').textContent = 'Testing connection…';
    try {
      var r = await AI.chat({ provider: p, model: p.models[0] || 'x', messages: [{ role: 'user', content: 'ping' }], stream: false, maxTokens: 1 });
      $('#pvStatus').textContent = '✓ Connection OK' + (r && r.reasoning ? ' (reasoning model)' : '');
    } catch (e) {
      // a model-level error still proves the endpoint is reachable
      var m = AI.friendlyError(e);
      $('#pvStatus').textContent = (m.indexOf('404') >= 0 || m.indexOf('400') >= 0) ? '✓ Endpoint reachable (pick a valid model)' : '✗ ' + m.split('\n')[0];
    }
  }
  function pickModel(m, provId) {
    if (provId) db.settings.providerId = provId;
    db.settings.model = m;
    Store.save();
    UI.renderModels(); UI.renderModelSheet(db.settings.providerId);
    UI.renderChatHead(Store.active()); UI.renderSettingsSubs();
    H.closeSheets();
    H.toast('Model → ' + m);
  }
  function selectProvider(id) {
    if (db.settings.providerId === id) return;
    db.settings.providerId = id;
    var p = Store.provider(id);
    if (p.type !== 'echo' && p.models.indexOf(db.settings.model) < 0) {
      db.settings.model = p.models[0] || db.settings.model;
    }
    Store.save();
    UI.renderModels(); UI.renderModelSheet(id);
    UI.renderChatHead(Store.active()); UI.renderSettingsSubs();
    H.toast('Provider → ' + p.name);
  }

  /* ================= automations ================= */
  var SCHED_LABEL = { once2: 'Once · in 2 min', i15: 'Every 15 min', i60: 'Every 60 min', d0900: 'Daily · 09:00' };
  function nextDue(a) {
    var now = Date.now();
    if (a.sched === 'once2') return a.created + 2 * 60e3;
    if (a.sched === 'i15') return (a.lastRun || a.created) + 15 * 60e3;
    if (a.sched === 'i60') return (a.lastRun || a.created) + 60 * 60e3;
    if (a.sched === 'd0900') {
      var d = new Date(); d.setHours(9, 0, 0, 0);
      if (d.getTime() <= (a.lastRun || a.created)) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return Infinity;
  }
  setInterval(function () {
    db.autos.forEach(function (a) {
      if (!a.on || state.streaming) return;
      if (Date.now() >= nextDue(a)) {
        a.lastRun = Date.now();
        if (a.sched === 'once2') a.on = false;
        Store.save(); UI.renderAutos(); UI.renderSettingsSubs();
        var s = Store.newSession();
        s.title = '[auto] ' + a.title;
        s.messages.push({ role: 'user', content: a.prompt, ts: Date.now() });
        Store.save();
        var histRow = H.el('<div class="row"><span class="tile sm"><i data-lucide="check"></i></span><span class="rtxt"><b>' + H.esc(a.title) + '</b><small>Ran ' + H.timeHM(a.lastRun) + '</small></span></div>');
        var hist = $('#autoHist');
        var ph = hist.querySelector('p');
        if (ph) ph.remove();
        hist.insertBefore(histRow, hist.firstChild);
        H.icons();
        UI.renderChat(s); UI.renderChatHead(s); refreshCtx(); openChat();
        H.toast('Automation ran · ' + a.title);
        streamReply(s);
      }
    });
  }, 20000);

  /* ================= boot: render everything ================= */
  function renderAll() {
    UI.renderHome(); UI.renderFiles(db.vfs[state.curPath] || [], state.curPath, false);
    UI.renderPlugins(); UI.renderMarket(''); UI.renderSkills(); UI.renderRules();
    UI.renderModels(); UI.renderModelSheet(db.settings.providerId);
    UI.renderMemory(); UI.renderMCP(); UI.renderHooks(); UI.renderAutos();
    UI.renderSettingsSubs();
    var sess = Store.active();
    UI.renderChat(sess); UI.renderChatHead(sess);
    refreshCtx();
  }

  /* ================= events ================= */
  // global delegation
  root.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-tab]'))) { H.setTab(t.getAttribute('data-tab')); return; }
    if ((t = e.target.closest('[data-go]'))) { H.push(t.getAttribute('data-go')); return; }
    if ((t = e.target.closest('[data-back]'))) { H.pop(); return; }
    if ((t = e.target.closest('[data-sheet]'))) {
      var sheetId = t.getAttribute('data-sheet');
      if (sheetId === 'sheet-model') UI.renderModelSheet(db.settings.providerId);
      H.openSheet(sheetId);
      return;
    }
    if ((t = e.target.closest('[data-toast]'))) { H.toast(t.getAttribute('data-toast')); return; }
    if ((t = e.target.closest('[data-sugg]'))) { $('#chatInput').value = t.getAttribute('data-sugg'); $('#chatInput').focus(); return; }
    if ((t = e.target.closest('[data-cmd]'))) {
      var c = t.getAttribute('data-cmd');
      H.closeSheets();
      if (c === '/compact') compact();
      else if (c === '/model') { UI.renderModelSheet(db.settings.providerId); H.openSheet('sheet-model'); }
      else if (c === '/resume') { H.setTab('home'); H.toast('Tap a session to resume'); }
      else if (c === '/memory') H.setTab('ai');
      else if (c === '/todos') openTodoSheet();
      else if (c === '/hooks') H.push('ov-hooks');
      else if (c === '/mcp') H.push('ov-mcp');
      else if (c === '/clear') { var s = Store.newSession(); UI.renderChat(s); UI.renderChatHead(s); refreshCtx(); UI.renderHome(); H.toast('Fresh context'); }
      return;
    }
    if ((t = e.target.closest('[data-editprov]'))) { openProviderSheet(t.getAttribute('data-editprov')); return; }
    if ((t = e.target.closest('[data-provider]'))) { selectProvider(t.getAttribute('data-provider')); return; }
    if ((t = e.target.closest('#addProvider'))) { openProviderSheet(null); return; }
    if ((t = e.target.closest('[data-prov-chip]'))) {
      state.sheetProv = t.getAttribute('data-prov-chip');
      UI.renderModelSheet(state.sheetProv);
      return;
    }
    if ((t = e.target.closest('[data-sheet-model]'))) {
      pickModel(t.getAttribute('data-sheet-model'), t.getAttribute('data-from-prov'));
      return;
    }
    if ((t = e.target.closest('[data-model]'))) { pickModel(t.getAttribute('data-model'), null); return; }
    if ((t = e.target.closest('[data-mem]'))) { openMemorySheet(t.getAttribute('data-mem')); return; }
    if ((t = e.target.closest('[data-mcp-test]'))) { testMcp(+t.getAttribute('data-mcp-test')); return; }
    if ((t = e.target.closest('[data-theme]'))) {
      db.settings.theme = t.getAttribute('data-theme');
      Store.save(); applyAppearance(); UI.renderSettingsSubs();
      return;
    }
    if ((t = e.target.closest('#modePill'))) {
      var modes = ['Plan', 'Build', 'Edit', 'Yolo', 'Guard'];
      db.settings.mode = modes[(modes.indexOf(db.settings.mode) + 1) % modes.length];
      Store.save(); applyAppearance(); UI.renderChatHead(Store.active()); UI.renderSettingsSubs(); refreshCtx();
      H.toast('Mode → ' + db.settings.mode);
      return;
    }
    if ((t = e.target.closest('.seg button'))) {
      var seg = t.parentElement;
      if (seg.id === 'pmodeSeg') {
        db.settings.mode = t.getAttribute('data-pm');
        Store.save(); applyAppearance(); UI.renderChatHead(Store.active()); UI.renderSettingsSubs(); refreshCtx();
        return;
      }
      if (t.hasAttribute('data-eff')) { db.settings.effort = t.getAttribute('data-eff'); Store.save(); }
      else if (t.hasAttribute('data-ico')) { db.settings.icons = t.getAttribute('data-ico'); Store.save(); applyAppearance(); return; }
      $$('button', seg).forEach(function (b) { b.classList.toggle('sel', b === t); });
      return;
    }
    if ((t = e.target.closest('#qPlan'))) {
      db.settings.mode = 'Plan'; Store.save(); applyAppearance(); UI.renderChatHead(Store.active());
      H.toast('Mode → Plan (propose first)'); return;
    }
    if ((t = e.target.closest('[data-delplugin]'))) {
      var pid = t.getAttribute('data-delplugin');
      db.plugins = db.plugins.filter(function (x) { return x.id !== pid; });
      Store.save(); UI.renderPlugins(); UI.renderMarket($('#mktSearch').value); UI.renderSettingsSubs(); refreshCtx();
      H.toast('Plugin removed');
      return;
    }
    if ((t = e.target.closest('[data-delrule]'))) {
      var rid = t.getAttribute('data-delrule');
      db.allowRules = db.allowRules.filter(function (x) { return x.id !== rid; });
      Store.save(); UI.renderRules(); refreshCtx(); H.toast('Rule removed');
      return;
    }
    if ((t = e.target.closest('[data-delskill]'))) {
      var sid = t.getAttribute('data-delskill');
      db.skills = db.skills.filter(function (x) { return x.id !== sid; });
      Store.save(); UI.renderSkills(); UI.renderSettingsSubs(); refreshCtx(); H.toast('Skill deleted');
      return;
    }
  });

  // hero & quick actions
  $('#hero').addEventListener('click', function () {
    var s = Store.active();
    if (s && s.messages.length) s = Store.newSession();
    UI.renderChat(s); UI.renderChatHead(s); refreshCtx(); openChat();
  });
  // delete current chat
  $('#chatDel').addEventListener('click', function () {
    var s = Store.active();
    if (!s) { H.toast('No chat to delete'); return; }
    if (!confirm('Delete chat "' + s.title + '"?')) return;
    db.sessions = db.sessions.filter(function (x) { return x.id !== s.id; });
    db.activeId = null;
    Store.save(); H.pop(); UI.renderHome(); refreshCtx();
    H.toast('Chat deleted');
  });
  // tools toggle
  $('#toolsPill').addEventListener('click', function () {
    db.settings.tools = db.settings.tools === false;
    Store.save(); renderToolsPill(); refreshCtx();
    H.toast(db.settings.tools === false ? 'Tools off — plain chat only' : 'Tools on — the model can write files, save memories, add plugins');
  });
  // IDE
  $('#idePill').addEventListener('click', function () { IDE.open(); });
  $('#ideBtn').addEventListener('click', function () { IDE.open(); });
  // AI-built plugins
  $('#aiPluginBtn').addEventListener('click', function () {
    H.setTab('home');
    var s = Store.active();
    if (s && s.messages.length) s = Store.newSession();
    UI.renderChat(s); UI.renderChatHead(s); refreshCtx(); openChat();
    $('#chatInput').value = 'Use the add_plugin tool to create a plugin that ';
    $('#chatInput').focus();
  });
  $('#qResume').addEventListener('click', function () {
    var last = db.sessions.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0];
    if (!last) { H.toast('No sessions yet'); return; }
    App.openSession(last.id);
  });
  $('#setupGo').addEventListener('click', function () { H.push('ov-model'); openProviderSheet(db.settings.providerId === 'echo' ? 'openrouter' : db.settings.providerId); });
  $('#setupDismiss').addEventListener('click', function () { db.settings.dismissedSetup = true; Store.save(); UI.renderHome(); });

  // chat composer
  $('#sendBtn').addEventListener('click', function () {
    if (state.streaming) { if (state.ctrl) state.ctrl.abort(); return; }
    send();
  });
  $('#chatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (!state.streaming) send(); }
  });
  $('#chatInput').addEventListener('input', function (e) {
    if (e.target.value.trim() === '/') { UI.renderModelSheet(db.settings.providerId); H.openSheet('sheet-slash'); e.target.value = ''; }
  });
  $('#slashBtn').addEventListener('click', function () { H.openSheet('sheet-slash'); });
  $('#todoBtn').addEventListener('click', openTodoSheet);
  $('#attachBtn').addEventListener('click', function () { renderAttach(); H.openSheet('sheet-attach'); });
  $('#ctxCompactBtn').addEventListener('click', function () { H.closeSheets(); compact(); });

  // todo sheet
  function openTodoSheet() {
    var s = Store.active();
    $('#tdText').value = s && s.todos ? s.todos.map(function (t) { return (t.done ? '- [x] ' : '- [ ] ') + t.t; }).join('\n') : '';
    H.openSheet('sheet-todo');
  }
  $('#tdSave').addEventListener('click', function () {
    var s = ensureSession();
    s.todos = $('#tdText').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) {
        var done = /^-?\s*\[x\]/i.test(l);
        return { t: l.replace(/^-\s*\[[ xX]\]\s*/, '').replace(/^-\s*/, ''), done: done };
      });
    Store.save(); UI.renderTodoCard(s); refreshCtx(); H.closeSheets();
    H.toast(s.todos.length + ' todos saved');
  });

  // files
  $('#mountBtn').addEventListener('click', mount);
  $('#dirRow').addEventListener('click', mount);
  $('#newFileBtn').addEventListener('click', function () {
    if (state.mounted) { H.toast('Mounted folder is read-only here'); return; }
    $('#nfName').value = '';
    H.openSheet('sheet-newfile');
  });
  $('#nfSave').addEventListener('click', function () {
    var name = $('#nfName').value.trim();
    if (!name) { H.toast('Name required'); return; }
    var path = state.curPath === '' ? 'workspace' : state.curPath;
    db.vfs[path] = db.vfs[path] || [];
    db.vfs[path].push({ n: name, t: name.endsWith('.md') ? 'doc' : 'code', s: '0 KB' });
    db.vfsContent[path + '/' + name] = '';
    Store.save(); goPath(path); H.closeSheets(); H.toast(name + ' created');
  });
  $('#fileImport').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    var pending = files.length, imported = 0;
    if (!pending) return;
    files.forEach(function (f) {
      if (f.size > 400000) { H.toast(f.name + ' too large — skipped'); if (--pending === 0) done(); return; }
      var isImg = /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f.name);
      var r = new FileReader();
      r.onload = function () {
        Tools.run('write_file', { path: 'workspace/imported/' + f.name, content: r.result });
        imported++;
        if (--pending === 0) done();
      };
      r.onerror = function () { if (--pending === 0) done(); };
      if (isImg) r.readAsDataURL(f); else r.readAsText(f);
    });
    function done() { Store.save(); goPath('workspace/imported'); H.toast(imported + ' file(s) imported'); }
    e.target.value = '';
  });
  $('#folderBtn').addEventListener('click', function () { $('#folderImport').click(); });
  $('#folderImport').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    var pending = files.length, imported = 0;
    if (!pending) return;
    files.forEach(function (f) {
      var rel = (f.webkitRelativePath || f.name).replace(/^\/+/, '');
      if (f.size > 400000) { if (--pending === 0) done(); return; }
      var isImg = /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f.name);
      var r = new FileReader();
      r.onload = function () {
        Tools.run('write_file', { path: 'workspace/' + rel, content: r.result });
        imported++;
        if (--pending === 0) done();
      };
      r.onerror = function () { if (--pending === 0) done(); };
      if (isImg) r.readAsDataURL(f); else r.readAsText(f);
    });
    function done() { Store.save(); goPath('workspace'); H.toast(imported + ' file(s) uploaded'); }
    e.target.value = '';
  });
  $('#fileSearch').addEventListener('input', function (e) {
    var q = e.target.value.toLowerCase();
    $$('#filesList .row').forEach(function (r) {
      r.style.display = r.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
    });
  });

  // marketplace search
  $('#mktSearch').addEventListener('input', function (e) { UI.renderMarket(e.target.value); });

  // memory sheet
  function openMemorySheet(id) {
    state.mmId = id;
    var m = id ? db.memories.find(function (x) { return x.id === id; }) : null;
    $('#mmTitle').innerHTML = '<i data-lucide="notebook-pen" style="width:17px;height:17px"></i>' + (m ? H.esc(m.title) : 'New memory');
    $('#mmTitleIn').value = m ? m.title : '';
    $('#mmTag').value = m ? m.tag : 'project';
    $('#mmBody').value = m ? m.body : '';
    $('#mmDelete').style.display = m ? '' : 'none';
    H.openSheet('sheet-memory'); H.icons();
  }
  $('#memAdd').addEventListener('click', function () { openMemorySheet(null); });
  $('#mmSave').addEventListener('click', function () {
    var title = $('#mmTitleIn').value.trim() || 'untitled.md';
    if (!/\.md$/.test(title)) title += '.md';
    var body = $('#mmBody').value;
    if (state.mmId) {
      var m = db.memories.find(function (x) { return x.id === state.mmId; });
      m.title = title; m.tag = $('#mmTag').value; m.body = body;
    } else {
      db.memories.push({ id: 'm' + H.uid(), title: title, tag: $('#mmTag').value, body: body });
    }
    Store.save(); UI.renderMemory(); refreshCtx(); H.closeSheets();
    H.toast('Memory saved — model sees it next turn');
  });
  $('#mmDelete').addEventListener('click', function () {
    if (!state.mmId) return;
    db.memories = db.memories.filter(function (x) { return x.id !== state.mmId; });
    Store.save(); UI.renderMemory(); refreshCtx(); H.closeSheets();
    H.toast('Memory deleted');
  });

  // provider sheet
  $('#pvSave').addEventListener('click', function () {
    var p = pvDraft();
    Store.save(); UI.renderModels(); UI.renderModelSheet(db.settings.providerId); UI.renderSettingsSubs(); renderFallbackSel(); UI.renderHome();
    H.closeSheets(); H.toast(p.name + ' saved');
  });
  $('#pvFetch').addEventListener('click', pvFetch);
  $('#pvTest').addEventListener('click', pvTest);
  $('#pvDelete').addEventListener('click', function () {
    if (!state.pvId) return;
    var p = Store.provider(state.pvId);
    if (!confirm('Delete provider "' + p.name + '"?')) return;
    db.providers = db.providers.filter(function (x) { return x.id !== state.pvId; });
    if (db.settings.providerId === state.pvId) { db.settings.providerId = 'echo'; db.settings.model = 'echo-1'; }
    Store.save(); applyAppearance(); renderAll(); renderFallbackSel();
    H.closeSheets(); H.toast('Provider deleted');
  });

  // add model manually
  $('#addModelBtn').addEventListener('click', function () {
    var v = $('#addModelIn').value.trim();
    if (!v) return;
    var p = Store.activeProvider();
    if (p.models.indexOf(v) < 0) p.models.push(v);
    db.settings.model = v;
    Store.save(); UI.renderModels(); UI.renderModelSheet(db.settings.providerId); UI.renderChatHead(Store.active()); UI.renderSettingsSubs();
    $('#addModelIn').value = '';
    H.toast('Model → ' + v);
  });

  // runtime selects & switches
  $('#swStream').addEventListener('change', function (e) { db.settings.stream = e.target.checked; Store.save(); });
  $('#swThink').addEventListener('change', function (e) { db.settings.think = e.target.checked; Store.save(); refreshCtx(); });
  $('#selCtxK').addEventListener('change', function (e) { db.settings.ctxK = +e.target.value; Store.save(); $('#ringTotal').textContent = 'of ' + db.settings.ctxK + 'k'; refreshCtx(); });
  $('#selFallback').addEventListener('change', function (e) { db.settings.fallbackId = e.target.value; Store.save(); });
  $('#rngTok').addEventListener('input', function (e) { db.settings.maxTokens = +e.target.value; $('#valTok').textContent = db.settings.maxTokens + 'k'; Store.save(); });

  // general
  $('#swAutosave').addEventListener('change', function (e) { db.settings.autosave = e.target.checked; Store.save(); H.toast(e.target.checked ? 'Sessions persist across reloads' : 'Sessions kept in memory only'); });
  $('#swCheckpoints').addEventListener('change', function (e) { db.settings.checkpoints = e.target.checked; Store.save(); });
  $('#compactAt').addEventListener('click', function () {
    var cur = db.settings.compactAt;
    db.settings.compactAt = cur === 80 ? 90 : cur === 90 ? 70 : 80;
    Store.save(); $('#compactAt').textContent = db.settings.compactAt + '%';
    H.toast('Auto-compact at ' + db.settings.compactAt + '%');
  });
  $('#swNotify').addEventListener('change', function (e) {
    db.settings.notify = e.target.checked; Store.save();
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  });
  $('#selLang').addEventListener('change', function (e) { db.settings.lang = e.target.value; Store.save(); clock(); });
  $('#clearData').addEventListener('click', function () {
    if (!confirm('Delete all sessions, memories, automations and workspace files?')) return;
    Store.wipe(); renderAll(); H.toast('Everything cleared');
  });

  // skills master
  $('#skillMaster').addEventListener('change', function (e) {
    var on = e.target.checked;
    db.skills.forEach(function (s) { s.on = on; });
    Store.save(); UI.renderSkills(); UI.renderSettingsSubs(); refreshCtx();
  });

  // skill sheet
  var skId = null;
  function openSkillSheet(id) {
    skId = id || null;
    var s = id ? db.skills.find(function (x) { return x.id === id; }) : null;
    $('#skTitle').innerHTML = '<i data-lucide="zap" style="width:17px;height:17px"></i>' + (s ? H.esc(s.name) : 'New skill');
    $('#skName').value = s ? s.name : '';
    $('#skDesc').value = s ? (s.desc || '') : '';
    $('#skDelete').style.display = s ? '' : 'none';
    H.openSheet('sheet-skill'); H.icons();
  }
  $('#addSkill').addEventListener('click', function () { openSkillSheet(null); });
  $('#importSkills').addEventListener('click', function () {
    var added = 0;
    STARTER_SKILLS.forEach(function (s) {
      var exists = db.skills.some(function (x) { return x.name.toLowerCase() === s[0].toLowerCase(); });
      if (!exists) { db.skills.push({ id: 'sk' + H.uid(), name: s[0], desc: s[1], on: true }); added++; }
    });
    if (!added) { H.toast('Starter pack already imported'); return; }
    Store.save(); UI.renderSkills(); UI.renderSettingsSubs(); refreshCtx();
    H.toast(added + ' skills imported');
  });
  $('#skSave').addEventListener('click', function () {
    var name = $('#skName').value.trim();
    if (!name) { H.toast('Name required'); return; }
    var desc = $('#skDesc').value.trim();
    if (skId) {
      var s = db.skills.find(function (x) { return x.id === skId; });
      s.name = name; s.desc = desc;
    } else {
      db.skills.push({ id: 'sk' + H.uid(), name: name, desc: desc, on: true });
    }
    Store.save(); UI.renderSkills(); UI.renderSettingsSubs(); refreshCtx(); H.closeSheets();
    H.toast('Skill saved — announced to the model every turn');
  });
  $('#skDelete').addEventListener('click', function () {
    if (!skId) return;
    db.skills = db.skills.filter(function (x) { return x.id !== skId; });
    Store.save(); UI.renderSkills(); UI.renderSettingsSubs(); refreshCtx(); H.closeSheets();
    H.toast('Skill deleted');
  });

  // allow-rules
  $('#addRule').addEventListener('click', function () { $('#rlText').value = ''; H.openSheet('sheet-rule'); });
  $('#rlSave').addEventListener('click', function () {
    var rule = $('#rlText').value.trim();
    if (!rule) { H.toast('Rule required'); return; }
    db.allowRules.push({ id: 'r' + H.uid(), rule: rule });
    Store.save(); UI.renderRules(); refreshCtx(); H.closeSheets();
    H.toast('Rule added');
  });

  // plugin sheet (user-authored plugins; the AI adds its own via the add_plugin tool)
  var plId = null;
  function openPluginSheet(id) {
    plId = id || null;
    var p = id ? db.plugins.find(function (x) { return x.id === id; }) : null;
    $('#plTitle').innerHTML = '<i data-lucide="puzzle" style="width:17px;height:17px"></i>' + (p ? H.esc(p.name) : 'New plugin');
    $('#plName').value = p ? p.name : '';
    $('#plDesc').value = p ? (p.desc || '') : '';
    $('#plPrompt').value = p ? p.prompt : '';
    $('#plDelete').style.display = p ? '' : 'none';
    H.openSheet('sheet-plugin'); H.icons();
  }
  $('#plugAdd').addEventListener('click', function () { openPluginSheet(null); });
  $('#mktAdd').addEventListener('click', function () { openPluginSheet(null); });
  $('#plSave').addEventListener('click', function () {
    var name = $('#plName').value.trim(), prompt = $('#plPrompt').value.trim();
    if (!name || !prompt) { H.toast('Name and instruction block required'); return; }
    if (plId) {
      var p = db.plugins.find(function (x) { return x.id === plId; });
      p.name = name; p.desc = $('#plDesc').value.trim(); p.prompt = prompt;
    } else {
      db.plugins.push({ id: 'p' + H.uid(), name: name, desc: $('#plDesc').value.trim(), prompt: prompt, source: 'user', on: true });
    }
    Store.save(); UI.renderPlugins(); UI.renderMarket($('#mktSearch').value); UI.renderSettingsSubs(); refreshCtx(); H.closeSheets();
    H.toast('Plugin saved');
  });
  $('#plDelete').addEventListener('click', function () {
    if (!plId) return;
    db.plugins = db.plugins.filter(function (x) { return x.id !== plId; });
    Store.save(); UI.renderPlugins(); UI.renderMarket($('#mktSearch').value); UI.renderSettingsSubs(); refreshCtx(); H.closeSheets();
    H.toast('Plugin deleted');
  });

  // toggles inside rendered lists (delegated change)
  root.addEventListener('change', function (e) {
    var t = e.target;
    var tog = t.getAttribute && t.getAttribute('data-toggle');
    if (tog) {
      var kind = tog.split(':')[0], id = tog.split(':')[1];
      if (kind === 'plugin') {
        var pk = db.plugins.find(function (x) { return x.id === id; });
        if (pk) pk.on = t.checked;
      }
      if (kind === 'skill') {
        var sk = db.skills.find(function (x) { return x.id === id; });
        if (sk) sk.on = t.checked;
        UI.renderSkills(); refreshCtx();
      }
      Store.save(); UI.renderSettingsSubs();
      return;
    }
    var mcpOn = t.getAttribute && t.getAttribute('data-mcp-on');
    if (mcpOn !== null && mcpOn !== undefined) {
      db.mcp[+mcpOn].on = t.checked; Store.save(); UI.renderMCP(); UI.renderSettingsSubs(); return;
    }
    var hookOn = t.getAttribute && t.getAttribute('data-hook-on');
    if (hookOn !== null && hookOn !== undefined) {
      db.hooks[+hookOn].on = t.checked; Store.save(); UI.renderHooks(); UI.renderSettingsSubs(); return;
    }
    var autoOn = t.getAttribute && t.getAttribute('data-auto-on');
    if (autoOn !== null && autoOn !== undefined) {
      db.autos[+autoOn].on = t.checked;
      if (t.checked) db.autos[+autoOn].lastRun = Date.now(); // reset interval on enable
      Store.save(); UI.renderAutos(); UI.renderSettingsSubs(); return;
    }
  });

  // hooks sheet
  var hkIdx = -1;
  $('#addHook').addEventListener('click', function () { hkIdx = -1; $('#hkEvent').value = 'Session start'; $('#hkUrl').value = ''; H.openSheet('sheet-hook'); });
  root.addEventListener('click', function (e) {
    var row = e.target.closest('[data-hook-on]');
    if (row && e.target.tagName !== 'INPUT') {
      hkIdx = +row.getAttribute('data-hook-on');
      var h = db.hooks[hkIdx];
      $('#hkEvent').value = h.event; $('#hkUrl').value = h.url;
      H.openSheet('sheet-hook');
    }
  });
  $('#hkSave').addEventListener('click', function () {
    var ev = $('#hkEvent').value, url = $('#hkUrl').value.trim();
    if (!url) { H.toast('URL required'); return; }
    if (hkIdx >= 0) { db.hooks[hkIdx].event = ev; db.hooks[hkIdx].url = url; }
    else db.hooks.push({ event: ev, url: url, on: true });
    Store.save(); UI.renderHooks(); UI.renderSettingsSubs(); H.closeSheets(); H.toast('Hook saved');
  });
  $('#hkDelete').addEventListener('click', function () {
    if (hkIdx < 0) return;
    db.hooks.splice(hkIdx, 1); hkIdx = -1;
    Store.save(); UI.renderHooks(); UI.renderSettingsSubs(); H.closeSheets(); H.toast('Hook deleted');
  });
  $('#hkTest').addEventListener('click', function () {
    var url = $('#hkUrl').value.trim();
    if (!url) { H.toast('URL required'); return; }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'reva', event: 'test' }) })
      .then(function () { H.toast('Test sent'); })
      .catch(function () { H.toast('Test failed — check URL / CORS'); });
  });

  // mcp sheet
  $('#addMcp').addEventListener('click', function () { $('#mcName').value = ''; $('#mcUrl').value = ''; H.openSheet('sheet-mcp'); });
  $('#mcSave').addEventListener('click', function () {
    var n = $('#mcName').value.trim(), u = $('#mcUrl').value.trim();
    if (!n || !u) { H.toast('Name and URL required'); return; }
    db.mcp.push({ name: n, url: u, on: true, ok: false });
    Store.save(); UI.renderMCP(); UI.renderSettingsSubs(); H.closeSheets();
    testMcp(db.mcp.length - 1);
  });
  function testMcp(i) {
    var s = db.mcp[i];
    H.toast('Handshaking ' + s.name + ' …');
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 10000);
    MCP.probe({ url: s.url })
      .then(function (r) { s.ok = true; s.tools = r.tools.length; })
      .catch(function () { s.ok = false; s.tools = null; })
      .then(function () {
        clearTimeout(to); Store.save(); UI.renderMCP(); UI.renderSettingsSubs();
        H.toast(s.name + (s.ok ? ' · ' + s.tools + ' tool' + (s.tools === 1 ? '' : 's') : ' unreachable (offline or CORS)'));
      });
  }

  // automations sheet
  $('#addAuto').addEventListener('click', function () {
    state.auIdx = -1;
    $('#auTitleIn').value = ''; $('#auPrompt').value = ''; $('#auSched').value = 'once2';
    $('#auDelete').style.display = 'none';
    H.openSheet('sheet-auto');
  });
  root.addEventListener('click', function (e) {
    var row = e.target.closest('[data-auto-on]');
    if (row && e.target.tagName !== 'INPUT') {
      state.auIdx = +row.getAttribute('data-auto-on');
      var a = db.autos[state.auIdx];
      $('#auTitleIn').value = a.title; $('#auPrompt').value = a.prompt; $('#auSched').value = a.sched;
      $('#auDelete').style.display = '';
      H.openSheet('sheet-auto');
    }
  });
  $('#auSave').addEventListener('click', function () {
    var title = $('#auTitleIn').value.trim(), prompt = $('#auPrompt').value.trim();
    if (!title || !prompt) { H.toast('Title and prompt required'); return; }
    var sched = $('#auSched').value;
    if (state.auIdx >= 0) {
      var a = db.autos[state.auIdx];
      a.title = title; a.prompt = prompt; a.sched = sched; a.scheduleLabel = SCHED_LABEL[sched];
    } else {
      db.autos.push({ id: H.uid(), title: title, prompt: prompt, sched: sched, scheduleLabel: SCHED_LABEL[sched], on: true, lastRun: 0, created: Date.now() });
    }
    Store.save(); UI.renderAutos(); UI.renderSettingsSubs(); H.closeSheets(); H.toast('Automation saved');
  });
  $('#auDelete').addEventListener('click', function () {
    if (state.auIdx < 0) return;
    db.autos.splice(state.auIdx, 1); state.auIdx = -1;
    Store.save(); UI.renderAutos(); UI.renderSettingsSubs(); H.closeSheets(); H.toast('Automation deleted');
  });

  // appearance sliders
  function bindRange(id, valId, fn) {
    $(id).addEventListener('input', function (e) { fn(+e.target.value); Store.save(); });
  }
  bindRange('#rngDepth', '#valDepth', function (v) { db.settings.depth = v; phone.style.setProperty('--depth', (v / 100).toFixed(2)); $('#valDepth').textContent = v + '%'; UI.renderSettingsSubs(); });
  bindRange('#rngRad', '#valRad', function (v) { db.settings.radius = v; phone.style.setProperty('--r', v + 'px'); $('#valRad').textContent = v + 'px'; });
  bindRange('#rngFont', '#valFont', function (v) { db.settings.font = v; phone.style.setProperty('--fs', v + 'px'); $('#valFont').textContent = v + 'px'; });
  $('#tglMotion').addEventListener('change', function (e) { db.settings.motion = !e.target.checked; Store.save(); phone.classList.toggle('no-motion', !db.settings.motion); });

  // dim & esc
  $('#dim').addEventListener('click', H.closeSheets);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var ide = document.getElementById('ide');
    if (ide && ide.style.display !== 'none') { IDE.close(); return; }
    if ($('.sheet.on')) { H.closeSheets(); return; }
    if ($('.ov.on')) H.pop();
  });

  // hero 3D tilt
  var hero = $('#hero');
  if (hero && window.matchMedia && matchMedia('(pointer:fine)').matches) {
    hero.addEventListener('pointermove', function (e) {
      if (phone.classList.contains('no-motion')) return;
      var r = hero.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      hero.style.transform = 'rotateY(' + (x * 7) + 'deg) rotateX(' + (-y * 7) + 'deg) translateZ(6px)';
    });
    hero.addEventListener('pointerleave', function () { hero.style.transform = ''; });
  }

  // storage meter
  function storeUse() {
    try {
      var bytes = new Blob([localStorage.getItem(Store.KEY) || '']).size;
      var pct = Math.min(100, Math.round(bytes / (5 * 1024 * 1024) * 100));
      $('#storeMeter').style.width = Math.max(4, pct) + '%';
      $('#storeUse').textContent = fmtSize(bytes) + ' of ~5 MB used';
    } catch (e) {}
  }

  var origSetTab = H.setTab;
  H.setTab = function (id) {
    origSetTab(id);
    if (id === 'files') goPath(state.curPath); // agent writes files mid-session — always render fresh
  };

  /* ================= start ================= */
  if (window.ResizeObserver) new ResizeObserver(H.fit).observe(root);
  window.addEventListener('resize', H.fit);
  H.fit();
  clock(); setInterval(clock, 30000);
  applyAppearance();
  renderAll();
  IDE.wire();
  storeUse();
  Store.onChange(function () { storeUse(); });
  H.icons();
  fireHook('Session start', { at: Date.now() });
  window.__appBooted = true;
})();
