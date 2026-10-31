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
    $('#ideEditor').value = c === undefined || c === null ? '' : String(c);
    dirty = false;
    $('#idePath').textContent = path;
    hideAc();
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
    dirty = false;
    print('saved ' + curPath, 'dim');
    refreshTree(); refreshTabs(); refreshOutline(); refreshStatus();
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

  /* ---------- gutter + highlighting ---------- */
  function refreshGutter() {
    var g = $('#ideGutter'), ta = $('#ideEditor');
    if (!g || !ta) return;
    var n = ta.value.split('\n').length;
    var out = '';
    for (var i = 1; i <= Math.max(n, 1); i++) out += i + '\n';
    g.textContent = out;
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
    var lc = IDECORE.lineCol(ta.value, ta.selectionStart || 0);
    var lang = curPath ? (H.extLang(curPath) || 'text') : '—';
    var m = mode();
    var where = m.kind === 'lib' ? 'project' : 'workspace';
    el.innerHTML = '<span>' + esc(curPath ? curPath.split('/').pop() : '—') + '</span>' +
      '<span class="ide-st-dim">' + esc(lang) + '</span>' +
      '<span class="ide-st-dim">Ln ' + lc.line + ', Col ' + lc.col + '</span>' +
      '<span class="ide-st-dim">' + (ta.value.length ? H.fmtK(ta.value.length) : '0') + '</span>' +
      '<span style="flex:1"></span>' +
      (dirty ? '<span class="ide-st-dirty">● unsaved</span>' : '<span class="ide-st-dim">' + where + '</span>');
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
    ta.addEventListener('click', function () { refreshStatus(); hideAc(); });
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
    newFile: newFile, renameFile: renameFile, deleteFile: deleteFile
  };
})();
