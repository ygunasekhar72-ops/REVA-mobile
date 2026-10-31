/* REVA — Workspace IDE (Phase A: the real editor).
   Full-window overlay: hierarchical file tree, tabbed editor with syntax
   highlighting + gutter, symbol outline with click-to-jump, cross-file
   search, autocomplete (doc identifiers + language dictionaries), typing
   intelligence (auto-indent, bracket pairing, tab-indent), live preview,
   status bar, harness console. Edits the ACTIVE workspace: the chat's
   scratch VFS, or — when the session carries a Library project — the
   mounted project's real files.
   Pure logic lives in js/idecore.js (unit-tested); this file is the shell. */
(function () {
  var $ = H.$;
  var curPath = null, dirty = false;
  var tabs = []; // open file paths — VS Code-style editor tabs
  var collapsed = {}; // tree collapse state, keyed dir:depth
  var acItems = [], acIdx = -1, acOpen = false;
  var savedText = ''; // last-saved content — the diff base for gutter markers
  var find = { matches: [], idx: -1, opts: { caseSensitive: false, regex: false, wholeWord: false } };
  var autoSave = localStorage.getItem('reva.ideAutosave') === '1';
  var asTimer = null;
  var palItems = [], palIdx = -1;
  var ICONS = { dir: 'folder', file: 'file-code', html: 'code-2', md: 'file-text' };

  /* ---------- workspace resolution: chat VFS or mounted Library project ---------- */
  function mode() {
    var s = Store.active();
    if (s && s.libId && window.Store.lib) {
      var p = Store.lib.get(s.libId);
      if (p && p.files) return { kind: 'lib', proj: p };
    }
    return { kind: 'ws' };
  }
  /* display paths are store-relative: 'workspace/src/app.js' → 'src/app.js' —
     the redundant root prefix never reaches the tree, search, or agent paths */
  function stripWs(p) { return String(p).replace(/^workspace\//, ''); }
  function filesObj() {
    var m = mode();
    if (m.kind === 'lib') return m.proj.files;
    var s = Store.ws();
    var out = {};
    if (!s) return out;
    Object.keys(s.vfs).forEach(function (dir) {
      (s.vfs[dir] || []).forEach(function (f) {
        if (f.t !== 'dir') out[stripWs(dir + '/' + f.n)] = s.vfsContent[dir + '/' + f.n] || '';
      });
    });
    return out;
  }
  function allFiles() { return Object.keys(filesObj()).sort(); }
  function contentOf(path) { return filesObj()[path]; }

  /* ---------- open / close ---------- */
  function open(path) {
    var ide = $('#ide');
    if (!ide) return;
    ide.style.display = 'grid';
    refreshTree();
    refreshOutline();
    clearOut();
    var m = mode();
    print(m.kind === 'lib' ? 'Editing project "' + m.proj.name + '" — harness console, type "help".' : 'Harness console — workspace only, no OS shell. Type "help".', 'dim');
    if (path) loadFile(path);
    else showPreview(null);
  }
  function close() {
    var ide = $('#ide');
    if (ide) ide.style.display = 'none';
    curPath = null;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function extOf(p) { return (String(p).split('.').pop() || '').toLowerCase(); }

  /* ---------- hierarchical file tree ---------- */
  function refreshTree() {
    var tree = $('#ideTree');
    if (!tree) return;
    var m = mode();
    var label = m.kind === 'lib' ? m.proj.name : (Store.active() ? 'workspace' : 'no chat');
    var files = allFiles();
    var head = '<div class="ide-treewslbl"><i data-lucide="database"></i>' + esc(label) + ' · ' + files.length + '</div>';
    if (!files.length) {
      tree.innerHTML = head + '<p class="ide-empty">' + (Store.active() ? 'No files yet.<br>Ask the model to write one,<br>or use the console: <b>help</b>' : 'Each chat has its own<br>workspace — start a chat,<br>then build here.') + '</p>';
      H.icons();
      return;
    }
    var rows = IDECORE.flattenTree(IDECORE.buildTree(files), 0, [], collapsed);
    tree.innerHTML = head + rows.map(function (r) {
      var pad = 'padding-left:' + (9 + r.depth * 14) + 'px';
      if (r.kind === 'dir') {
        return '<button class="ide-row ide-dir" data-idedir="' + esc(r.name) + '" data-ded="' + r.depth + '" style="' + pad + '"><i data-lucide="chevron-' + (r.collapsed ? 'right' : 'down') + '"></i><i data-lucide="' + ICONS.dir + '"></i><span>' + esc(r.name) + '</span></button>';
      }
      var sel = r.path === curPath ? ' sel' : '';
      var ico = /\.html?$/.test(r.name) ? ICONS.html : /\.(md|txt)$/.test(r.name) ? ICONS.md : ICONS.file;
      return '<button class="ide-row' + sel + '" data-idefile="' + esc(r.path) + '" style="' + pad + '"><i data-lucide="' + ico + '"></i><span>' + esc(r.name) + '</span></button>';
    }).join('');
    H.icons();
    tree.querySelectorAll('[data-idefile]').forEach(function (b) {
      b.addEventListener('click', function () { loadFile(b.getAttribute('data-idefile')); });
    });
    tree.querySelectorAll('[data-idedir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-idedir') + ':' + b.getAttribute('data-ded');
        collapsed[k] = !collapsed[k];
        refreshTree();
      });
    });
  }

  /* ---------- symbol outline (tree-sitter regex fallback via REVAMAP) ---------- */
  function refreshOutline() {
    var el = $('#ideOutline');
    if (!el) return;
    if (!curPath) { el.innerHTML = '<div class="ide-outlbl">Outline</div><p class="ide-empty">open a file</p>'; return; }
    var src = contentOf(curPath);
    var syms = (window.REVAMAP && src !== undefined && src !== null) ? REVAMAP.extractFallback(extOf(curPath), String(src)) : [];
    if (!syms.length) { el.innerHTML = '<div class="ide-outlbl">Outline</div><p class="ide-empty">(no named symbols)</p>'; return; }
    var KICO = { func: 'lambda', 'class': 'box', 'interface': 'layers', struct: 'box', method: 'lambda' };
    el.innerHTML = '<div class="ide-outlbl">Outline</div>' + syms.slice(0, 60).map(function (s) {
      return '<button class="ide-row ide-sym" data-idesym="' + s.line + '" style="padding-left:9px"><i data-lucide="' + (KICO[s.kind] || 'circle') + '"></i><span>' + esc(s.name) + '</span><span class="ide-symln">L' + s.line + '</span></button>';
    }).join('');
    H.icons();
    el.querySelectorAll('[data-idesym]').forEach(function (b) {
      b.addEventListener('click', function () { jumpTo(parseInt(b.getAttribute('data-idesym'), 10)); });
    });
  }

  /* ---------- cross-file search panel ---------- */
  function toggleSearch(on) {
    var p = $('#ideSearch');
    if (!p) return;
    var show = on === undefined ? p.style.display !== 'grid' : !!on;
    p.style.display = show ? 'grid' : 'none';
    if (show) { $('#ideSearchIn').value = ''; $('#ideSearchOut').innerHTML = ''; $('#ideSearchIn').focus(); }
  }
  function runSearch() {
    var q = $('#ideSearchIn').value;
    var out = $('#ideSearchOut');
    if (!q.trim()) { out.innerHTML = ''; return; }
    var hits = IDECORE.searchWorkspace(filesObj(), q, 60);
    out.innerHTML = hits.length ? hits.map(function (h) {
      return '<button class="ide-hit" data-idehit="' + esc(h.path) + '" data-idehl="' + h.line + '"><span class="ide-hitp">' + esc(h.path) + ':' + h.line + '</span><span class="ide-hitt">' + esc(h.text) + '</span></button>';
    }).join('') : '<p class="ide-empty">no matches</p>';
    out.querySelectorAll('[data-idehit]').forEach(function (b) {
      b.addEventListener('click', function () {
        loadFile(b.getAttribute('data-idehit'));
        jumpTo(parseInt(b.getAttribute('data-idehl'), 10));
      });
    });
  }

  function jumpTo(line) {
    var ta = $('#ideEditor');
    var text = ta.value;
    var lines = text.split('\n');
    var off = 0;
    for (var i = 0; i < Math.min(line - 1, lines.length); i++) off += lines[i].length + 1;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = Math.min(off, text.length);
    ta.scrollTop = Math.max(0, (line - 5) * 20);
    refreshHl(); refreshStatus();
  }

  /* ---------- tabs ---------- */
  function refreshTabs() {
    var bar = $('#ideTabs');
    if (!bar) return;
    bar.innerHTML = tabs.map(function (p) {
      var n = p.split('/').pop();
      var active = p === curPath;
      var dot = (p === curPath && dirty) ? ' ●' : '';
      return '<button class="ide-tab' + (active ? ' on' : '') + '" data-idetab="' + esc(p) + '"><span>' + esc(n) + dot + '</span><i data-lucide="x" data-idetabx="' + esc(p) + '"></i></button>';
    }).join('');
    H.icons();
    bar.querySelectorAll('[data-idetab]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var x = e.target.closest('[data-idetabx]');
        if (x) {
          var p = x.getAttribute('data-idetabx');
          tabs = tabs.filter(function (t) { return t !== p; });
          if (curPath === p) { curPath = null; $('#ideEditor').value = ''; refreshHl(); showPreview(null); $('#idePath').textContent = '—'; refreshOutline(); refreshStatus(); }
          refreshTabs();
          return;
        }
        loadFile(b.getAttribute('data-idetab'));
      });
    });
  }

  /* ---------- file lifecycle ---------- */
  function loadFile(path) {
    if (dirty && !confirm('Discard unsaved changes to ' + curPath + '?')) return;
    curPath = path;
    if (tabs.indexOf(path) === -1) tabs.push(path);
    var c = contentOf(path);
    var text = c === undefined || c === null ? '' : String(c);
    $('#ideEditor').value = text;
    savedText = text;
    dirty = false;
    $('#idePath').textContent = path;
    hideAc(); hideFind();
    refreshHl(); refreshTabs(); refreshTree(); refreshOutline(); refreshStatus(); refreshGutter();
    if (/\.html?$/.test(path)) showPreview(path);
    else showPreview(null);
  }

  function save() {
    if (!curPath) return;
    var content = $('#ideEditor').value;
    var m = mode();
    if (m.kind === 'lib') {
      m.proj.files[curPath] = content;
      Store.lib.put(m.proj);
    } else {
      var r = Tools.run('write_file', { path: curPath, content: content });
      if (r.indexOf('Error') === 0) { print(r); return; }
    }
    savedText = content;
    dirty = false;
    print('saved ' + curPath, 'dim');
    refreshTree(); refreshTabs(); refreshOutline(); refreshStatus(); refreshGutter();
    if (/\.html?$/.test(curPath)) showPreview(curPath);
  }

  function newFile() {
    var name = prompt('New file path (e.g. app/index.html)');
    if (!name || !name.trim()) return;
    var p = name.trim().replace(/^\/+/, '');
    if (p.indexOf('workspace/') === 0) p = p.slice('workspace/'.length);
    var m = mode();
    if (m.kind === 'lib') {
      if (m.proj.files[p] !== undefined) { print('Error: ' + p + ' already exists'); return; }
      m.proj.files[p] = '';
      Store.lib.put(m.proj);
    } else {
      Tools.run('write_file', { path: p, content: '' });
    }
    refreshTree();
    loadFile(p);
  }

  function renameFile() {
    if (!curPath) { H.toast('Select a file first'); return; }
    var to = prompt('Rename ' + curPath + ' to:', curPath);
    if (!to || to === curPath) return;
    var m = mode();
    var c = contentOf(curPath);
    if (m.kind === 'lib') {
      delete m.proj.files[curPath];
      m.proj.files[to] = c || '';
      Store.lib.put(m.proj);
    } else {
      Tools.run('write_file', { path: to, content: c || '' });
      Tools.run('delete_file', { path: curPath });
    }
    tabs = tabs.map(function (t) { return t === curPath ? to : t; });
    loadFile(to);
  }

  function deleteFile() {
    if (!curPath) { H.toast('Select a file first'); return; }
    if (!confirm('Delete ' + curPath + '?')) return;
    var m = mode();
    if (m.kind === 'lib') {
      delete m.proj.files[curPath];
      Store.lib.put(m.proj);
    } else {
      Tools.run('delete_file', { path: curPath });
    }
    tabs = tabs.filter(function (t) { return t !== curPath; });
    curPath = null;
    $('#ideEditor').value = '';
    $('#idePath').textContent = '—';
    refreshTree(); refreshTabs(); refreshOutline(); refreshHl(); refreshStatus(); showPreview(null);
  }

  /* ---------- gutter + highlighting (Phase B: change markers, current line) ---------- */
  function refreshGutter() {
    var g = $('#ideGutter'), ta = $('#ideEditor');
    if (!g || !ta) return;
    var n = ta.value.split('\n').length;
    var marks = IDECORE.changeMarkers(savedText, ta.value);
    var cur = IDECORE.lineCol(ta.value, ta.selectionStart || 0).line;
    var out = '';
    for (var i = 1; i <= Math.max(n, 1); i++) {
      var cls = marks[i] || (i === cur ? 'cur' : '');
      out += '<div class="gl ' + cls + '">' + i + '</div>';
    }
    g.innerHTML = out;
    g.scrollTop = ta.scrollTop;
  }

  /* transparent-textarea-over-highlighted-pre keeps editing simple and code colored.
     Progressive: the regex pass paints instantly; when the vendored highlight.js
     engine has the language ready it takes over (stale-guarded against typing).
     NOTE: window.HLJS explicitly — the vendored hljs core declares a top-level
     `const HLJS` that lexically shadows our loader in every classic script. */
  function refreshHl() {
    var pre = $('#ideHl'), ta = $('#ideEditor');
    if (!pre || !ta) return;
    var code = ta.value;
    pre.innerHTML = H.hl(code, H.extLang(curPath)) + '\n';
    if (window.HLJS) {
      window.HLJS.highlight(code, H.extLang(curPath)).then(function (html) {
        if (html && ta.value === code && $('#ideEditor') === ta) pre.innerHTML = html + '\n';
      });
    }
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  /* ---------- status bar ---------- */
  function refreshStatus() {
    var el = $('#ideStatus');
    var ta = $('#ideEditor');
    if (!el || !ta) return;
    var caret = ta.selectionStart || 0;
    var lc = IDECORE.lineCol(ta.value, caret);
    var lang = curPath ? (H.extLang(curPath) || 'text') : '—';
    var m = mode();
    var where = m.kind === 'lib' ? 'project' : 'workspace';
    var bm = IDECORE.bracketMatch(ta.value, caret);
    el.innerHTML = '<span>' + esc(curPath ? curPath.split('/').pop() : '—') + '</span>' +
      '<span class="ide-st-dim">' + esc(lang) + '</span>' +
      '<span class="ide-st-dim">Ln ' + lc.line + ', Col ' + lc.col + '</span>' +
      (bm ? '<span class="ide-st-dim">match Ln ' + IDECORE.lineCol(ta.value, bm.a).line + '</span>' : '') +
      '<span class="ide-st-dim">' + (ta.value.length ? H.fmtK(ta.value.length) : '0') + '</span>' +
      '<span style="flex:1"></span>' +
      (dirty ? '<span class="ide-st-dirty">● unsaved</span>' : '<span class="ide-st-dim">' + where + '</span>') +
      '<button class="ide-st-tgl' + (autoSave ? ' on' : '') + '" id="ideStAutosave" title="toggle auto-save">auto-save</button>';
    var asBtn = $('#ideStAutosave');
    if (asBtn) asBtn.addEventListener('click', toggleAutoSave);
  }

  /* ---------- autocomplete ---------- */
  var CW = 7.6, LH = 20; // caret metrics for the popup (12.5px mono, lh 1.6)
  function maybeAc() {
    var ta = $('#ideEditor');
    if (!ta || !curPath) return;
    var res = IDECORE.autocomplete(ta.value, ta.selectionStart || 0, extOf(curPath), window.IDEKEYWORDS ? IDEKEYWORDS.forExt(extOf(curPath)) : null);
    if (!res.items.length) { hideAc(); return; }
    acItems = res.items; acIdx = -1; acOpen = true;
    var pop = $('#ideAc');
    if (!pop) return;
    var lc = IDECORE.lineCol(ta.value, ta.selectionStart || 0);
    var x = 14 + (lc.col - 1) * CW - ta.scrollLeft;
    var y = (lc.line - 1) * LH - ta.scrollTop + LH + 4;
    pop.style.left = Math.max(4, Math.min(x, ta.clientWidth - 220)) + 'px';
    pop.style.top = Math.max(4, Math.min(y, ta.clientHeight - 190)) + 'px';
    pop.style.display = 'block';
    paintAc();
  }
  function paintAc() {
    var pop = $('#ideAc');
    if (!pop) return;
    pop.innerHTML = acItems.map(function (it, i) {
      return '<button class="ide-ac-i' + (i === acIdx ? ' on' : '') + '" data-ideaci="' + i + '"><b>' + esc(it.name) + '</b><span>' + it.src + '</span></button>';
    }).join('');
    pop.querySelectorAll('[data-ideaci]').forEach(function (b) {
      b.addEventListener('click', function () { acceptAc(parseInt(b.getAttribute('data-ideaci'), 10)); taFocus(); });
    });
  }
  function taFocus() { var ta = $('#ideEditor'); if (ta) ta.focus(); }
  function acceptAc(i) {
    var ta = $('#ideEditor');
    var it = acItems[i];
    if (!ta || !it) { hideAc(); return; }
    var w = IDECORE.wordAt(ta.value, ta.selectionStart || 0);
    insert(ta, it.name, w.start, w.end);
    hideAc();
  }
  function hideAc() {
    acOpen = false; acIdx = -1; acItems = [];
    var pop = $('#ideAc');
    if (pop) pop.style.display = 'none';
  }
  function acMove(d) {
    if (!acOpen) return;
    acIdx = (acIdx + d + acItems.length) % acItems.length;
    paintAc();
  }

  /* insert text preserving the native undo stack (execCommand insertText) */
  function insert(ta, text, from, to) {
    ta.focus();
    if (from !== undefined) { ta.selectionStart = from; ta.selectionEnd = to === undefined ? from : to; }
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { }
    if (!ok) {
      var s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + text.length;
    }
    afterEdit();
  }

  /* ---------- typing intelligence ---------- */
  function onKey(e) {
    var ta = $('#ideEditor');
    if (!ta) return;
    if (acOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideAc(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptAc(acIdx >= 0 ? acIdx : 0); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      var q = prompt('Quick open — file name:');
      if (!q) return;
      var hit = allFiles().find(function (f) { return f.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
      if (hit) loadFile(hit); else print('no file matching "' + q + '"', 'dim');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleSearch(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); openFind(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      var ln = parseInt(prompt('Jump to line:'), 10);
      if (ln > 0) jumpTo(ln);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (ta.selectionStart !== ta.selectionEnd) { indentSel(e.shiftKey); return; }
      insert(ta, '  ');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      var pol = IDECORE.autoIndent(ta.value, ta.selectionStart);
      if (pol.skipIndent) {
        /* the closer keeps its own line; caret lands on our indent */
        var parent = pol.indent.slice(0, -2);
        insert(ta, '\n' + pol.indent + '\n' + parent);
        ta.selectionStart = ta.selectionEnd = ta.selectionStart - (parent.length + 1);
        afterEdit();
        return;
      }
      insert(ta, '\n' + pol.indent);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      var ch = e.key;
      var after = ta.value[ta.selectionStart] || '';
      /* quote/closer skip-over: typing the expected closer walks past it */
      if ((ch === '"' || ch === "'" || ch === '`' || ')]}'.indexOf(ch) >= 0) && after === ch && IDECORE.wordAt(ta.value, ta.selectionStart).word === '') {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1;
        afterEdit();
        return;
      }
      var pair = IDECORE.bracketAuto(ch, after);
      if (pair) {
        e.preventDefault();
        insert(ta, ch + pair);
        ta.selectionStart = ta.selectionEnd = ta.selectionStart - 1;
        afterEdit();
      }
    }
  }

  /* Tab / Shift+Tab over a multi-line selection */
  function indentSel(out) {
    var ta = $('#ideEditor');
    var a = ta.selectionStart, b = ta.selectionEnd;
    var v = ta.value;
    var ls = v.lastIndexOf('\n', a - 1) + 1;
    var seg = v.slice(ls, b);
    var lines = seg.split('\n');
    var changed = lines.map(function (l) {
      if (out) return l.replace(/^[ \t]{1,2}/, '');
      return '  ' + l;
    }).join('\n');
    insert(ta, changed, ls, b);
  }

  function afterEdit() {
    dirty = true;
    refreshHl(); refreshGutter(); refreshTabs(); refreshStatus(); maybeAc();
    scheduleAutoSave();
    if (find.matches.length || $('#ideFind').style.display === 'grid') {
      var keep = $('#ideFindIn').value;
      var ms = IDECORE.findMatches($('#ideEditor').value, keep, findOpts());
      find.matches = ms || [];
      find.idx = -1;
      $('#ideFindCount').textContent = ms === null ? 'bad regex' : String(find.matches.length);
    }
  }

  /* ---------- preview ---------- */
  function showPreview(path) {
    var frame = $('#ideFrame'), holder = $('#idePreviewWrap');
    var c = path ? contentOf(path) : undefined;
    if (path && c !== undefined && c !== null) {
      frame.setAttribute('srcdoc', String(c));
      $('#idePrevLabel').textContent = path;
      holder.style.display = '';
    } else {
      frame.setAttribute('srcdoc', '<body style="font-family:system-ui;background:#0d0d10;color:#68686f;display:grid;place-items:center;height:100vh;margin:0">Open an .html file to preview it here</body>');
      $('#idePrevLabel').textContent = 'preview';
      holder.style.display = '';
    }
  }

  /* ---------- find / replace bar (Phase B) ---------- */
  function openFind() {
    var bar = $('#ideFind');
    if (!bar) return;
    bar.style.display = 'grid';
    $('#ideFindIn').focus();
    $('#ideFindIn').select();
    runFind();
  }
  function hideFind() {
    var bar = $('#ideFind');
    if (bar) bar.style.display = 'none';
    find.matches = []; find.idx = -1;
  }
  function findOpts() {
    return {
      caseSensitive: $('#ideFindCase').classList.contains('on'),
      regex: $('#ideFindRe').classList.contains('on'),
      wholeWord: $('#ideFindWord').classList.contains('on')
    };
  }
  function runFind() {
    var ta = $('#ideEditor');
    var q = $('#ideFindIn').value;
    var ms = IDECORE.findMatches(ta.value, q, findOpts());
    find.matches = ms || [];
    find.idx = -1;
    var cnt = $('#ideFindCount');
    if (ms === null) { cnt.textContent = 'bad regex'; return; }
    cnt.textContent = ms.length ? (ms.length + (ms.length >= 500 ? '+' : '')) : '0';
    if (ms.length) findNext(1, true);
  }
  function findNext(dir, fromCaret) {
    if (!find.matches.length) return;
    var ta = $('#ideEditor');
    var caret = ta.selectionStart || 0;
    var i = -1;
    if (fromCaret !== true) find.idx = (find.idx + (dir > 0 ? 1 : -1) + find.matches.length) % find.matches.length;
    else {
      for (var k = 0; k < find.matches.length; k++) { if (find.matches[k].start >= caret) { i = k; break; } }
      find.idx = i >= 0 ? i : 0;
    }
    var m = find.matches[find.idx];
    ta.focus();
    ta.setSelectionRange(m.start, m.end);
    var lc = IDECORE.lineCol(ta.value, m.start);
    ta.scrollTop = Math.max(0, (lc.line - 4) * 20);
    $('#ideFindCount').textContent = (find.idx + 1) + '/' + find.matches.length;
    refreshHl(); refreshGutter(); refreshStatus();
  }
  function doReplace() {
    var ta = $('#ideEditor');
    if (find.idx >= 0 && find.matches[find.idx]) {
      var m = find.matches[find.idx];
      insert(ta, $('#ideFindRep').value, m.start, m.end);
      runFind();
    }
  }
  function doReplaceAll() {
    var ta = $('#ideEditor');
    var r = IDECORE.replaceAll(ta.value, $('#ideFindIn').value, $('#ideFindRep').value, findOpts());
    if (r === null) { $('#ideFindCount').textContent = 'bad regex'; return; }
    if (!r.count) { $('#ideFindCount').textContent = '0'; return; }
    var pos = ta.selectionStart;
    ta.value = r.text;
    ta.selectionStart = ta.selectionEnd = Math.min(pos, r.text.length);
    afterEdit();
    runFind();
    print('Replaced ' + r.count + ' occurrence' + (r.count > 1 ? 's' : '') + ' in ' + curPath, 'dim');
  }

  /* ---------- command palette (Phase B): files + symbols + commands ---------- */
  function paletteItems() {
    var items = [];
    allFiles().forEach(function (p) { items.push({ kind: 'file', label: 'Open ' + p, run: function () { loadFile(p); } }); });
    if (curPath) {
      var src = contentOf(curPath);
      var syms = (window.REVAMAP && src) ? REVAMAP.extractFallback(extOf(curPath), String(src)) : [];
      syms.forEach(function (s) {
        items.push({ kind: 'sym', label: '≡ ' + s.name + '  (' + s.line + ')', run: function () { jumpTo(s.line); } });
      });
    }
    items.push(
      { kind: 'cmd', label: 'Save file (Ctrl+S)', run: function () { save(); } },
      { kind: 'cmd', label: 'New file…', run: function () { newFile(); } },
      { kind: 'cmd', label: 'Search across files (Ctrl+Shift+F)', run: function () { toggleSearch(true); } },
      { kind: 'cmd', label: 'Find in file (Ctrl+F)', run: function () { openFind(); } },
      { kind: 'cmd', label: (autoSave ? '✓ Auto-save is ON — turn off' : 'Auto-save is OFF — turn on'), run: function () { toggleAutoSave(); } },
      { kind: 'cmd', label: 'Preview this file', run: function () { if (curPath) showPreview(curPath); } }
    );
    return items;
  }
  function openPalette() {
    var pal = $('#idePal');
    if (!pal) return;
    pal.style.display = 'grid';
    $('#idePalIn').value = '';
    palIdx = -1;
    renderPal('');
    $('#idePalIn').focus();
  }
  function hidePalette() {
    var pal = $('#idePal');
    if (pal) pal.style.display = 'none';
    palItems = []; palIdx = -1;
  }
  function renderPal(q) {
    var pal = $('#idePal');
    if (!pal) return;
    palItems = paletteItems()
      .map(function (it) { return { it: it, sc: IDECORE.paletteScore(q, it.label) }; })
      .filter(function (x) { return x.sc > 0; })
      .sort(function (a, b) { return b.sc - a.sc; })
      .slice(0, 12)
      .map(function (x) { return x.it; });
    palIdx = palItems.length ? 0 : -1;
    $('#idePalOut').innerHTML = palItems.length ? palItems.map(function (it, i) {
      var k = it.kind === 'file' ? 'file-code' : it.kind === 'sym' ? 'lambda' : 'zap';
      return '<button class="ide-pal-i' + (i === palIdx ? ' on' : '') + '" data-idepal="' + i + '"><i data-lucide="' + k + '"></i>' + esc(it.label) + '</button>';
    }).join('') : '<p class="ide-empty" style="padding:10px">nothing matches</p>';
    H.icons();
    pal.querySelectorAll('[data-idepal]').forEach(function (b) {
      b.addEventListener('click', function () { execPal(parseInt(b.getAttribute('data-idepal'), 10)); });
    });
  }
  function execPal(i) {
    var it = palItems[i];
    hidePalette();
    if (it && it.run) { taFocus(); it.run(); }
  }
  function palMove(d) {
    if (!palItems.length) return;
    palIdx = (palIdx + d + palItems.length) % palItems.length;
    renderPal($('#idePalIn').value);
    var on = document.querySelector('#idePalOut .ide-pal-i.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- auto-save (Phase B) ---------- */
  function toggleAutoSave() {
    autoSave = !autoSave;
    localStorage.setItem('reva.ideAutosave', autoSave ? '1' : '0');
    H.toast('Auto-save ' + (autoSave ? 'ON — edits save ~1.5s after typing stops' : 'OFF'));
    refreshStatus();
  }
  function scheduleAutoSave() {
    if (!autoSave) return;
    clearTimeout(asTimer);
    asTimer = setTimeout(function () {
      if (dirty && curPath) { save(); renderPaletteIfOpen(); }
    }, 1500);
  }
  function renderPaletteIfOpen() {
    var pal = $('#idePal');
    if (pal && pal.style.display === 'grid') renderPal($('#idePalIn').value);
  }

  /* ---------- console ---------- */
  function print(line, cls) {
    var out = $('#ideOut');
    if (!out) return;
    var d = document.createElement('div');
    d.className = 'ide-line' + (cls ? ' ' + cls : '');
    d.textContent = line;
    out.appendChild(d);
    out.scrollTop = out.scrollHeight;
  }
  function clearOut() { var out = $('#ideOut'); if (out) out.innerHTML = ''; }

  function runCmd() {
    var inp = $('#ideCmd');
    var line = inp.value;
    if (!line.trim()) return;
    print('❯ ' + line, 'cmd');
    inp.value = '';
    var r = Console.exec(line);
    if (r.clear) { clearOut(); return; }
    if (r.out) print(r.out);
    if (r.open) loadFile(r.open);
    refreshTree();
  }

  /* ---------- wiring ---------- */
  function wire() {
    $('#ideClose').addEventListener('click', close);
    $('#ideSave').addEventListener('click', save);
    $('#ideRun').addEventListener('click', function () { if (curPath) showPreview(curPath); });
    $('#ideNewFile').addEventListener('click', newFile);
    $('#ideSearchBtn').addEventListener('click', function () { toggleSearch(); });
    $('#ideSearchIn').addEventListener('input', runSearch);
    $('#ideSearchX').addEventListener('click', function () { toggleSearch(false); });
    $('#ideRename').addEventListener('click', renameFile);
    $('#ideDelete').addEventListener('click', deleteFile);
    var ta = $('#ideEditor');
    ta.addEventListener('input', afterEdit);
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('click', function () { refreshStatus(); hideAc(); refreshGutter(); });
    ta.addEventListener('keyup', function () { refreshGutter(); refreshStatus(); });
    ta.addEventListener('scroll', function () {
      var pre = $('#ideHl');
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      var g = $('#ideGutter');
      if (g) g.scrollTop = ta.scrollTop;
      hideAc();
    });
    var cmdHistory = [], histPos = -1;
    $('#ideCmd').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var line = $('#ideCmd').value;
        if (line.trim()) { cmdHistory.push(line); histPos = cmdHistory.length; }
        runCmd();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histPos > 0) { histPos--; $('#ideCmd').value = cmdHistory[histPos] || ''; }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histPos < cmdHistory.length) { histPos++; $('#ideCmd').value = cmdHistory[histPos] || ''; }
      }
    });
    /* find bar wiring */
    $('#ideFindIn').addEventListener('input', runFind);
    $('#ideFindIn').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { hideFind(); taFocus(); }
    });
    $('#ideFindRep').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doReplace(); }
      if (e.key === 'Escape') { hideFind(); taFocus(); }
    });
    $('#ideFindPrev').addEventListener('click', function () { findNext(-1); });
    $('#ideFindNext').addEventListener('click', function () { findNext(1); });
    $('#ideFindRepBtn').addEventListener('click', doReplace);
    $('#ideFindAllBtn').addEventListener('click', doReplaceAll);
    $('#ideFindX').addEventListener('click', function () { hideFind(); taFocus(); });
    ['ideFindCase', 'ideFindRe', 'ideFindWord'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () { b.classList.toggle('on'); runFind(); });
    });
    /* command palette wiring */
    $('#idePalBtn').addEventListener('click', openPalette);
    $('#idePalIn').addEventListener('input', function () { renderPal($('#idePalIn').value); });
    $('#idePalIn').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); execPal(palIdx >= 0 ? palIdx : 0); }
      else if (e.key === 'Escape') { hidePalette(); taFocus(); }
    });
    /* status-bar auto-save toggle */
    var asBtn = $('#ideStAutosave');
    if (asBtn) asBtn.addEventListener('click', toggleAutoSave);
    $('#ideGit').addEventListener('click', function () {
      H.openSheet('sheet-git');
      if (window.App && App.gitRun) App.gitRun('status', true);
    });
  }

  window.IDE = {
    open: open, close: close, refreshTree: refreshTree, loadFile: loadFile,
    showPreview: showPreview, save: save, print: print, clearOut: clearOut, wire: wire,
    refreshTabs: refreshTabs, refreshGutter: refreshGutter, refreshOutline: refreshOutline,
    refreshStatus: refreshStatus, toggleSearch: toggleSearch, jumpTo: jumpTo,
    newFile: newFile, renameFile: renameFile, deleteFile: deleteFile,
    openFind: openFind, hideFind: hideFind, runFind: runFind, findNext: findNext,
    doReplace: doReplace, doReplaceAll: doReplaceAll,
    openPalette: openPalette, hidePalette: hidePalette, renderPal: renderPal,
    toggleAutoSave: toggleAutoSave
  };
})();
