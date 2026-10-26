/* Mono Harness — screen renderers (all data comes from the live store) */
(function () {
  var $ = H.$, $$ = H.$$;
  var ICON = { dir: 'folder', code: 'file-code', doc: 'file-text', img: 'image' };
  var TOOL_ICON = { write_file: 'file-plus-2', read_file: 'file-search', list_files: 'folder-open', delete_file: 'trash-2', save_memory: 'book-marked', add_plugin: 'puzzle', run_command: 'terminal' };

  function switchRow(icon, title, sub, on, attr) {
    return '<div class="row"><span class="tile"><i data-lucide="' + icon + '"></i></span>' +
      '<span class="rtxt"><b>' + H.esc(title) + '</b><small>' + H.esc(sub) + '</small></span>' +
      '<label class="sw"><input type="checkbox" data-toggle="' + attr + '"' + (on ? ' checked' : '') + '/><i></i></label></div>';
  }

  var UI = {

    /* ---------- HOME ---------- */
    renderHome: function () {
      var db = Store.db;
      var sess = db.sessions.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 6);
      var wrap = $('#sessList');
      wrap.innerHTML = sess.length ? '' :
        '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:14px 0 6px">No sessions yet — start a new chat</p>';
      sess.forEach(function (s) {
        var tok = s.messages.reduce(function (a, m) { return a + H.tok(m.content); }, 0);
        var pct = Math.min(100, Math.round(tok / (db.settings.ctxK * 1000) * 100));
        var row = H.el('<button class="row sess">' +
          '<span class="tile"><i data-lucide="message-square"></i></span>' +
          '<span class="rtxt"><b>' + H.esc(s.title) + '</b><small>' + H.esc(s.model) + ' · ' + H.ago(s.updatedAt) + ' · ' + H.fmtK(tok) + ' tok</small></span>' +
          '<span class="cbar"><b style="width:' + pct + '%"></b></span></button>');
        row.addEventListener('click', function () { App.openSession(s.id); });
        H.longPress(row, function () {
          if (confirm('Delete session "' + s.title + '"?')) {
            db.sessions = db.sessions.filter(function (x) { return x.id !== s.id; });
            if (db.activeId === s.id) db.activeId = null;
            Store.save(); UI.renderHome();
            H.toast('Session deleted');
          }
        });
        wrap.appendChild(row);
      });

      var wk = Date.now() - 7 * 86400e3;
      var recent = db.sessions.filter(function (s) { return s.updatedAt >= wk; });
      var toks = db.sessions.reduce(function (a, s) {
        return a + s.messages.reduce(function (x, m) { return x + H.tok(m.content); }, 0);
      }, 0);
      var models = {};
      db.sessions.forEach(function (s) { models[s.model] = 1; });
      $('#statsRow').innerHTML =
        '<div style="flex:1"><b style="font-size:19px;font-variant-numeric:tabular-nums">' + recent.length + '</b><br><small style="font-size:11.5px;color:var(--ink3)">sessions</small></div>' +
        '<div style="flex:1"><b style="font-size:19px;font-variant-numeric:tabular-nums">' + H.fmtK(toks) + '</b><br><small style="font-size:11.5px;color:var(--ink3)">tokens</small></div>' +
        '<div style="flex:1"><b style="font-size:19px;font-variant-numeric:tabular-nums">' + Object.keys(models).length + '</b><br><small style="font-size:11.5px;color:var(--ink3)">models used</small></div>';

      var realKeyed = db.providers.some(function (p) { return p.key && p.type !== 'echo'; });
      $('#setupBanner').style.display = (realKeyed || db.settings.dismissedSetup) ? 'none' : 'flex';
      H.icons();
    },

    /* ---------- FILES ---------- */
    renderFiles: function (entries, path, mounted, emptyMsg) {
      var parts = path.split('/');
      var crumbs = $('#fileCrumbs');
      crumbs.innerHTML = '';
      parts.forEach(function (p, i) {
        var acc = parts.slice(0, i + 1).join('/');
        var b = document.createElement('button');
        b.textContent = i === 0 ? (mounted ? 'device' : 'workspace') : p;
        if (i === parts.length - 1) b.className = 'cur';
        b.addEventListener('click', function () { App.goPath(acc); });
        crumbs.appendChild(b);
        if (i < parts.length - 1) {
          var s = document.createElement('i');
          s.setAttribute('data-lucide', 'chevron-right');
          s.style.cssText = 'width:12px;height:12px;opacity:.5';
          crumbs.appendChild(s);
        }
      });
      var fl = $('#filesList');
      fl.innerHTML = entries.length ? '' :
        '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:16px 0">' + H.esc(emptyMsg || 'Empty folder — create a file or import one') + '</p>';
      entries.forEach(function (f) {
        var row = H.el('<button class="row">' +
          '<span class="tile"><i data-lucide="' + (ICON[f.t] || 'file') + '"></i></span>' +
          '<span class="rtxt"><b>' + H.esc(f.n) + '</b><small>' + (f.t === 'dir' ? 'Folder' : H.esc(f.s || '')) + '</small></span>' +
          '<i data-lucide="' + (f.t === 'dir' ? 'chevron-right' : 'eye') + '" class="chev" style="width:16px;height:16px"></i></button>');
        row.addEventListener('click', function () { App.openFile(f, path); });
        fl.appendChild(row);
      });
      $('#mountBtn').innerHTML = '<i data-lucide="' + (mounted ? 'x' : 'folder-open') + '"></i>';
      $('#mountBtn').setAttribute('aria-label', mounted ? 'Unmount folder' : 'Mount device folder');
      H.icons();
    },

    /* ---------- PLUGINS / MARKET ---------- */
    renderPlugins: function () {
      var list = Store.db.plugins;
      var srcIcon = function (p) { return p.source === 'starter' ? 'package' : (p.source === 'ai' ? 'sparkles' : 'puzzle'); };
      var srcTag = function (p) { return p.code ? ' · real tools' : ''; };
      var errTag = function (p) { return p.error ? ' · error: ' + p.error : ''; };
      $('#plugList').innerHTML = list.map(function (p) {
        return '<div class="row"><span class="tile"><i data-lucide="' + srcIcon(p) + '"></i></span>' +
          '<span class="rtxt"><b>' + H.esc(p.name) + '</b><small>' + H.esc((p.desc || '') + srcTag(p) + (p.source === 'ai' ? ' · built by AI' : '') + errTag(p)) + '</small></span>' +
          '<i data-lucide="x" class="chev" style="width:15px;height:15px;cursor:pointer" data-delplugin="' + p.id + '"></i>' +
          '<label class="sw"><input type="checkbox" data-toggle="plugin:' + p.id + '"' + (p.on ? ' checked' : '') + '/><i></i></label></div>';
      }).join('') ||
        '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:14px 0 6px">No plugins — add one below or let the AI build it</p>';
      var n = list.filter(function (p) { return p.on; }).length;
      $('#setPlugSub').textContent = n + ' enabled · ' + list.length + ' installed';
      $('#mktCount').textContent = list.length + ' plugins installed';
      H.icons();
    },
    renderMarket: function (q) {
      q = (q || '').toLowerCase();
      var list = Store.db.plugins.filter(function (p) { return p.name.toLowerCase().indexOf(q) > -1; });
      $('#mktList').innerHTML = list.map(function (p) {
        var icon = p.source === 'ai' ? 'sparkles' : 'puzzle';
        return '<div class="row"><span class="tile"><i data-lucide="' + icon + '"></i></span>' +
          '<span class="rtxt"><b>' + H.esc(p.name) + '</b><small>' + H.esc(p.desc || '') + (p.source === 'ai' ? ' · built by AI' : '') + '</small></span>' +
          '<i data-lucide="x" class="chev" style="width:15px;height:15px;cursor:pointer" data-delplugin="' + p.id + '"></i>' +
          '<label class="sw"><input type="checkbox" data-toggle="plugin:' + p.id + '"' + (p.on ? ' checked' : '') + '/><i></i></label></div>';
      }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:18px">No plugins yet — build one with the AI above</p>';
      H.icons();
    },

    /* ---------- SKILLS ---------- */
    renderSkills: function () {
      var skills = Store.db.skills;
      $('#skillList').innerHTML = skills.map(function (s) {
        return '<div class="row"><span class="tile"><i data-lucide="zap"></i></span>' +
          '<span class="rtxt" style="cursor:pointer" data-editskill="' + H.esc(s.name) + '"><b>' + H.esc(s.name) + '</b><small>' + H.esc(s.desc || '') + ' · tap to edit body</small></span>' +
          '<i data-lucide="x" class="chev" style="width:15px;height:15px;cursor:pointer" data-delskill="' + s.id + '"></i>' +
          '<label class="sw"><input type="checkbox" data-toggle="skill:' + s.id + '"' + (s.on ? ' checked' : '') + '/><i></i></label></div>';
      }).join('') ||
        '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:12px 0">No skills yet — add one with + or import the starter pack</p>';
      var n = skills.filter(function (s) { return s.on; }).length;
      $('#setSkillSub').textContent = n + ' of ' + skills.length + ' enabled';
      $('#skillMaster').checked = skills.length > 0 && n === skills.length;
      H.icons();
    },

    /* ---------- ALLOW-RULES ---------- */
    renderRules: function () {
      var rules = Store.db.allowRules;
      $('#ruleList').innerHTML = rules.map(function (r) {
        return '<div class="row"><span class="tile sm"><i data-lucide="terminal"></i></span>' +
          '<span class="rtxt"><b class="kbd" style="font-weight:500">' + H.esc(r.rule) + '</b><small>Pre-approved for this app</small></span>' +
          '<i data-lucide="x" class="chev" style="width:15px;height:15px;cursor:pointer" data-delrule="' + r.id + '"></i></div>';
      }).join('') ||
        '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:12px 0">No allow-rules — add commands the agent may use without asking</p>';
      $('#setPermSub').textContent = 'Mode: ' + Store.db.settings.mode + ' · ' + rules.length + ' rule' + (rules.length === 1 ? '' : 's');
      H.icons();
    },

    /* ---------- MODELS / PROVIDERS ---------- */
    renderModels: function () {
      var db = Store.db, prov = Store.activeProvider();
      $('#provCards').innerHTML = db.providers.map(function (p) {
        var ok = p.type === 'echo' || !!p.key;
        return '<button class="mcard' + (p.id === db.settings.providerId ? ' sel' : '') + '" data-provider="' + p.id + '">' +
          '<span class="mrow"><span class="rad"></span><span class="rtxt"><b>' + H.esc(p.name) + '</b>' +
          '<small>' + (p.type === 'echo' ? 'offline demo' : H.esc(p.base || 'not configured')) + '</small></span>' +
          '<span style="margin-left:auto;display:flex;align-items:center;gap:9px">' +
          '<span class="mcpdot ' + (ok ? 'ok' : 'err') + '"></span>' +
          '<i data-lucide="pencil" class="chev" style="width:15px;height:15px;cursor:pointer" data-editprov="' + p.id + '" aria-label="Edit provider"></i></span></span>' +
          '<span class="mmeta"><span>' + (p.models.length ? p.models.length + ' models' : 'no models') + '</span>' +
          (p.key ? '<span>key saved</span>' : (p.type === 'echo' ? '<span>no key needed</span>' : '<span>no key</span>')) + '</span></button>';
      }).join('') +
      '<button class="row" id="addProvider"><span class="tile"><i data-lucide="plus"></i></span><span class="rtxt"><b>Add custom provider</b><small>Any OpenAI-compatible endpoint</small></span><i data-lucide="chevron-right" class="chev" style="width:16px;height:16px"></i></button>';

      $('#modelCards').innerHTML = prov.models.length ? prov.models.map(function (m) {
        var st = (prov.modelStatus || {})[m];
        var badge = st === 'ok' ? '<span>✓ verified</span>' : (st === 'unknown' ? '<span>unverified</span>' : '');
        return '<button class="mcard' + (m === db.settings.model ? ' sel' : '') + '" data-model="' + H.esc(m) + '">' +
          '<span class="mrow"><span class="rad"></span><span class="rtxt"><b>' + H.esc(m) + '</b><small>' + H.esc(prov.name) + '</small></span></span>' +
          '<span class="mmeta"><span>' + db.settings.ctxK + 'k ctx</span>' + badge + '</span></button>';
      }).join('') :
      '<div class="lockban"><i data-lucide="info"></i><span>No models yet — open the provider and press "Fetch models", or add one manually below.</span></div>';

      $('#setModelSub').textContent = db.settings.model + ' · ' + prov.name;
      H.icons();
    },
    renderModelSheet: function (selId) {
      var db = Store.db;
      /* columns: [Built-in models][Provider 1][Provider 2]… — one column per
         connected provider, the strip scrolls horizontally, each column
         vertically. Truly connected only (key set or currently active). */
      var connected = db.providers.filter(function (p) {
        return (p.key && String(p.key).trim()) || p.id === db.settings.providerId;
      });
      var strip = $('#modelStrip');
      if (!strip) return;
      var BI = window.REVA_BUILTIN_MODELS || [];
      var cols = [];
      cols.push({
        name: 'Built-in models',
        cards: BI.map(function (m, i) {
          return '<button class="mcard' + (m.id === db.settings.model ? ' sel' : '') + '" data-builtin="' + i + '">' +
            '<span class="mrow"><span class="rad"></span><span class="rtxt"><b>' + H.esc(m.name) + '</b><small>' + H.esc(m.desc) + '</small></span></span></button>';
        }).join('')
      });
      connected.forEach(function (p) {
        if (!p.models.length) return;
        cols.push({
          name: p.name,
          cards: p.models.map(function (m) {
            return '<button class="mcard' + (m === db.settings.model && p.id === db.settings.providerId ? ' sel' : '') + '" data-sheet-model="' + H.esc(m) + '" data-from-prov="' + p.id + '">' +
              '<span class="mrow"><span class="rad"></span><span class="rtxt"><b>' + H.esc(m) + '</b></span></span></button>';
          }).join('')
        });
      });
      strip.innerHTML = cols.map(function (c) {
        return '<div class="mcol"><div class="mcolhead">' + H.esc(c.name) + '</div><div class="mcolbody">' +
          (c.cards || '<p class="ide-empty">no models</p>') + '</div></div>';
      }).join('');
      H.icons();
    },

    /* ---------- AI WORKSPACE ---------- */
    renderCtx: function (sysTok, histTok, limitK) {
      var db = Store.db;
      var total = (limitK || db.settings.ctxK) * 1000;
      var used = sysTok + histTok;
      var p = Math.min(100, Math.round(used / total * 100));
      var free = Math.max(0, total - sysTok - histTok);
      var segs = [
        { n: 'System + memory', v: sysTok, o: .28 },
        { n: 'History', v: histTok, o: .78 },
        { n: 'Free', v: free, o: .1 }
      ];
      $('#ctxPct1').textContent = p + '%';
      $('#ctxBarFill').style.width = p + '%';
      $('#ringPct').textContent = p + '%';
      var C = 2 * Math.PI * 47;
      var arc = $('#ringArc');
      if (arc) arc.setAttribute('stroke-dashoffset', (C * (1 - p / 100)).toFixed(1));
      [$('#segBar'), $('#segBar2')].forEach(function (bar) {
        if (!bar) return; bar.innerHTML = '';
        segs.forEach(function (s) {
          var b = document.createElement('b');
          b.style.width = Math.min(100, (s.v / total * 100)) + '%';
          b.style.background = 'var(--ink)'; b.style.opacity = s.o;
          bar.appendChild(b);
        });
      });
      [$('#segLgd'), $('#segLgd2')].forEach(function (lg) {
        if (!lg) return; lg.innerHTML = '';
        segs.forEach(function (s) {
          var li = document.createElement('div'); li.className = 'li';
          li.innerHTML = '<span class="sw2" style="background:var(--ink);opacity:' + s.o + '"></span>' + s.n +
            '<b>' + H.fmtK(s.v) + '</b>';
          lg.appendChild(li);
        });
      });
    },
    renderMemory: function () {
      var mems = Store.db.memories;
      var idx = mems.map(function (m) { return '- [' + m.title + '](' + m.tag + ')'; }).join('\n');
      $('#memIndex').textContent = mems.length ? idx : '# empty — add a memory below';
      $('#memList').innerHTML = mems.map(function (m) {
        return '<button class="row memrow" data-mem="' + m.id + '">' +
          '<span class="tile sm"><i data-lucide="' + ({ user: 'user', feedback: 'message-square', project: 'target', reference: 'link' }[m.tag] || 'notebook') + '"></i></span>' +
          '<span class="rtxt"><b class="kbd" style="font-weight:500">' + H.esc(m.title) + '</b><small>' + H.esc(m.body.slice(0, 60)) + '</small></span>' +
          '<span class="tag">' + H.esc(m.tag) + '</span></button>';
      }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:12px 0">No memories yet</p>';
      H.icons();
    },
    renderBuffer: function (sess) {
      var buf = $('#bufList'), tok = 0;
      if (!sess) { buf.innerHTML = ''; $('#bufTok').textContent = '0 tok'; return; }
      var msgs = sess.messages.slice(-4);
      tok = sess.messages.reduce(function (a, m) { return a + H.tok(m.content); }, 0);
      $('#bufTok').textContent = H.fmtK(tok) + ' tok';
      buf.innerHTML = msgs.map(function (m) {
        return '<div class="be"><time>' + H.timeHM(m.ts || sess.updatedAt) + '</time><span>' +
          H.esc((m.role === 'user' ? '' : '· ') + m.content.slice(0, 90)) + '</span></div>';
      }).join('') || '<div class="be"><span>No messages yet in this session</span></div>';
      var cl = $('#compactList');
      cl.innerHTML = (sess.compactions || []).map(function (c) {
        return '<div class="row"><span class="tile sm"><i data-lucide="archive"></i></span>' +
          '<span class="rtxt"><b>Compaction · ' + new Date(c.date).toLocaleDateString() + '</b>' +
          '<small>' + H.fmtK(c.before) + ' → ' + H.fmtK(c.after) + ' tok' + (c.api ? ' · via model' : ' · local') + '</small></span></div>';
      }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:12.5px;padding:6px 0 2px">Nothing compacted yet</p>';
      H.icons();
    },

    /* ---------- CHAT ---------- */
    renderChat: function (sess) {
      var flow = $('#msgFlow'), scroller = $('#chatMsgs');
      var live = (window.App && App.takeLiveEl) ? App.takeLiveEl(sess) : null;
      flow.innerHTML = '';
      var empty = $('#chatEmpty');
      if (!sess || !sess.messages.length) {
        empty.style.display = 'flex';
        if (live) flow.appendChild(live); // a run started in this empty session — keep it visible
        UI.renderTodoCard(sess); H.icons(); return;
      }
      empty.style.display = 'none';
      sess.messages.forEach(function (m, mi) { flow.appendChild(UI.msgEl(m, mi)); });
      if (live) flow.appendChild(live); // re-attach the in-flight stream after navigating back
      UI.renderTodoCard(sess);
      scroller.scrollTop = scroller.scrollHeight;
      H.icons();
    },
    msgEl: function (m, i) {
      if (m.err) {
        var e = H.el('<div class="msg ai err"><div class="etxt">' + H.esc(m.content) + '</div>' +
          '<div style="display:flex;gap:8px;margin-top:10px"><button class="btnGhost" style="padding:8px 14px;font-size:12.5px;border-radius:11px" data-retry>' +
          '<i data-lucide="refresh-cw" style="width:13px;height:13px"></i>Retry</button></div></div>');
        e.querySelector('[data-retry]').addEventListener('click', function () { App.retry(); });
        return e;
      }
      if (m.role === 'user') {
        var u = H.el('<div class="msg user"><div class="utext"></div>' +
          '<div class="uacts"><button class="uact" data-editmsg="' + i + '" aria-label="Edit message"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>' +
          '<button class="uact" data-copymsg="' + i + '" aria-label="Copy message"><i data-lucide="copy" style="width:12px;height:12px"></i></button></div></div>');
        u.querySelector('.utext').textContent = m.content;
        return u;
      }
      var a = H.el('<div class="msg ai"></div>');
      var inner = '';
      var acts = m.activity && m.activity.length ? m.activity : (m.tools || []).map(function (t) {
        return { k: t.cmd ? 'cmd' : 'tool', icon: t.cmd ? 'terminal' : 'wrench', text: t.label, meta: t.meta || '', out: t.out || '' };
      });
      if (acts.length) {
        var rows = acts.map(function (a) {
          if (a.k === 'cmd') return '<div class="act-row"><i data-lucide="terminal"></i><b>' + H.esc(a.text) + '</b></div>' + (a.out ? '<pre class="act-out">' + H.esc(a.out) + '</pre>' : '');
          return '<div class="act-row' + (a.ok === false ? ' failed' : '') + '" data-open="' + H.esc(a.path || '') + '"><i data-lucide="' + (a.ok === false ? 'alert-circle' : a.icon) + '"></i><b>' + H.esc(a.text) + '</b>' + (a.meta ? '<span class="meta">' + H.esc(a.meta) + '</span>' : '') + '</div>';
        }).join('');
        if (acts.length > 4) inner += '<details class="actwrap"><summary>' + acts.length + ' steps</summary><div class="activity">' + rows + '</div></details>';
        else inner += '<div class="activity">' + rows + '</div>';
      }
      inner += H.mdLite(m.content);
      inner += '<div class="aacts"><button class="uact" data-copyai aria-label="Copy reply"><i data-lucide="copy" style="width:12px;height:12px"></i> Copy</button></div>';
      a.innerHTML = inner;
      a.querySelectorAll('[data-toolpath]').forEach(function (card) {
        var p = card.getAttribute('data-toolpath');
        if (p) card.addEventListener('click', function () { App.openPath(p); });
      });
      a.querySelectorAll('.act-row[data-open]').forEach(function (row) {
        var p = row.getAttribute('data-open');
        row.style.cursor = 'pointer';
        row.addEventListener('click', function () { App.openPath(p); });
      });
      var cp = a.querySelector('[data-copyai]');
      if (cp) cp.addEventListener('click', function () { H.copy(m.content); H.toast('Reply copied'); });
      return a;
    },
    renderTodoCard: function (sess) {
      var card = $('#todoCard');
      if (!sess || !sess.todos || !sess.todos.length) { card.style.display = 'none'; return; }
      card.style.display = '';
      var done = sess.todos.filter(function (t) { return t.done; }).length;
      card.innerHTML = '<div class="th"><i data-lucide="list-todo" style="width:13px;height:13px"></i>Todos · ' + done + '/' + sess.todos.length + '</div>' +
        sess.todos.map(function (t, i) {
          return '<div class="ti' + (t.done ? ' done' : '') + '" data-todo="' + i + '"><span class="bx"><i data-lucide="check" style="width:13px;height:13px"></i></span>' + H.esc(t.t) + '</div>';
        }).join('');
      card.querySelectorAll('[data-todo]').forEach(function (el) {
        el.addEventListener('click', function () {
          var i = +el.getAttribute('data-todo');
          sess.todos[i].done = !sess.todos[i].done;
          sess.updatedAt = Date.now();
          Store.save(); UI.renderTodoCard(sess); App.refreshCtx();
          H.icons();
        });
      });
      H.icons();
    },
    renderChatHead: function (sess) {
      $('#chatTitle').textContent = sess ? sess.title : 'New chat';
      $('#chatSub').textContent = sess ? (sess.messages.length + ' messages · ' + H.ago(sess.updatedAt)) : 'fresh context';
      $('#modelPill').textContent = Store.db.settings.model;
      $('#modeTxt').textContent = Store.db.settings.mode;
    },

    /* ---------- MCP / HOOKS / AUTOMATIONS ---------- */
    renderMCP: function () {
      var l = $('#mcpList');
      l.innerHTML = Store.db.mcp.map(function (s, i) {
        var meta = s.ok ? (s.tools != null ? s.tools + ' tool' + (s.tools === 1 ? '' : 's') : 'reachable') : s.url;
        return '<div class="row"><span class="mcpdot ' + (s.ok ? 'ok' : 'err') + '"></span>' +
          '<span class="rtxt"><b>' + H.esc(s.name) + '</b><small>' + H.esc(s.url) + (s.ok ? ' · ' + H.esc(meta) : '') + '</small></span>' +
          '<button class="btnGhost" data-mcp-test="' + i + '" style="padding:8px 12px;font-size:12px;border-radius:11px">Test</button>' +
          '<label class="sw"><input type="checkbox" data-mcp-on="' + i + '"' + (s.on ? ' checked' : '') + '/><i></i></label></div>';
      }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:12px 0">No servers — add one with the + button</p>';
      var ok = Store.db.mcp.filter(function (s) { return s.ok && s.on; }).length;
      $('#setMcpSub').textContent = ok + ' connected · ' + (Store.db.mcp.length - ok) + ' unreachable';
      H.icons();
    },
    renderHooks: function () {
      var l = $('#hookList');
      l.innerHTML = Store.db.hooks.map(function (h, i) {
        return '<div class="row"><span class="tile"><i data-lucide="webhook"></i></span>' +
          '<span class="rtxt"><b>' + H.esc(h.event) + '</b><small class="kbd" style="font-size:11px">' + H.esc(h.url) + '</small></span>' +
          '<label class="sw"><input type="checkbox" data-hook-on="' + i + '"' + (h.on ? ' checked' : '') + '/><i></i></label></div>';
      }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:12px 0">No hooks — add one above</p>';
      $('#setHookSub').textContent = Store.db.hooks.filter(function (h) { return h.on; }).length + ' active · ' + Store.db.hooks.length + ' total';
      H.icons();
    },
    renderAutos: function () {
      var l = $('#autoList');
      l.innerHTML = Store.db.autos.map(function (a, i) {
        var app = a.appPkg ? ' · app: ' + a.appPkg.split('.').pop() : '';
        return '<div class="row"><span class="tile"><i data-lucide="' + (a.appPkg ? 'app-window' : 'calendar-clock') + '"></i></span>' +
          '<span class="rtxt"><b>' + H.esc(a.title) + '</b><small>' + H.esc(a.scheduleLabel) + app + (a.lastRun ? ' · last ' + H.ago(a.lastRun) : '') + '</small></span>' +
          '<label class="sw"><input type="checkbox" data-auto-on="' + i + '"' + (a.on ? ' checked' : '') + '/><i></i></label></div>';
      }).join('') || '<p style="text-align:center;color:var(--ink3);font-size:13px;padding:12px 0">No automations yet</p>';
      $('#setAutoSub').textContent = Store.db.autos.filter(function (a) { return a.on; }).length + ' active · runs while app is open';
      H.icons();
    },

    /* ---------- SETTINGS subs ---------- */
    renderSettingsSubs: function () {
      var db = Store.db;
      $('#setModelSub').textContent = db.settings.model + ' · ' + Store.activeProvider().name;
      var skills = db.skills; var n = skills.filter(function (s) { return s.on; }).length;
      $('#setSkillSub').textContent = n + ' of ' + skills.length + ' enabled';
      $('#setPermSub').textContent = 'Mode: ' + db.settings.mode + ' · ' + db.allowRules.length + ' rule' + (db.allowRules.length === 1 ? '' : 's');
      var pn = db.plugins.filter(function (p) { return p.on; }).length;
      $('#setPlugSub').textContent = pn + ' enabled · ' + db.plugins.length + ' installed';
      var ok = db.mcp.filter(function (s) { return s.ok && s.on; }).length;
      $('#setMcpSub').textContent = ok + ' connected · ' + (db.mcp.length - ok) + ' unreachable';
      $('#setHookSub').textContent = db.hooks.filter(function (h) { return h.on; }).length + ' of ' + db.hooks.length + ' active';
      $('#setAutoSub').textContent = db.autos.filter(function (a) { return a.on; }).length + ' scheduled runs active';
      $('#setAppSub').textContent = db.settings.theme + ' · 3D depth ' + db.settings.depth + '%';
    }
  };

  window.UI = UI;
})();
