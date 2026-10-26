/* Mono Harness — Workspace IDE: full-window overlay with file tree, editor,
   live preview (sandboxed iframe for HTML), and the harness console. */
(function () {
  var $ = H.$;
  var curPath = null, dirty = false;
  var tabs = []; // open file paths — VS Code-style editor tabs

  function open(path) {
    var ide = $('#ide');
    if (!ide) return;
    ide.style.display = 'grid';
    IDE.refreshTree();
    IDE.clearOut();
    IDE.print('Harness console — workspace only, no OS shell. Type "help".', 'dim');
    if (path) IDE.loadFile(path);
    else IDE.showPreview(null);
  }
  function close() {
    var ide = $('#ide');
    if (ide) ide.style.display = 'none';
    curPath = null;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function allFiles() {
    var s = Store.ws();
    var out = [];
    if (!s) return out;
    Object.keys(s.vfs).sort().forEach(function (dir) {
      (s.vfs[dir] || []).forEach(function (f) {
        if (f.t !== 'dir') out.push({ path: dir + '/' + f.n, n: f.n });
      });
    });
    return out;
  }

  function refreshTree() {
    var tree = $('#ideTree');
    if (!tree) return;
    var files = allFiles();
    tree.innerHTML = files.map(function (f) {
      var sel = f.path === curPath ? ' sel' : '';
      var ico = /\.html?$/.test(f.n) ? 'code-2' : /\.(md|txt)$/.test(f.n) ? 'file-text' : 'file-code';
      return '<button class="ide-row' + sel + '" data-idefile="' + esc(f.path) + '"><i data-lucide="' + ico + '"></i><span>' + esc(f.n) + '</span></button>';
    }).join('') || '<p class="ide-empty">' + (Store.active() ? 'No files yet.<br>Ask the model to write one,<br>or use the console: <b>help</b>' : 'Each chat has its own<br>workspace — start a chat,<br>then build here.') + '</p>';
    if (window.lucide) try { lucide.createIcons({ attrs: { width: 14, height: 14 } }); } catch (e) {}
    tree.querySelectorAll('[data-idefile]').forEach(function (b) {
      b.addEventListener('click', function () { IDE.loadFile(b.getAttribute('data-idefile')); });
    });
  }

  function loadFile(path) {
    if (dirty && !confirm('Discard unsaved changes to ' + curPath + '?')) return;
    curPath = path;
    if (tabs.indexOf(path) === -1) tabs.push(path);
    var s = Store.ws();
    var c = s ? s.vfsContent[path] : undefined;
    $('#ideEditor').value = c === undefined ? '' : String(c);
    dirty = false;
    $('#idePath').textContent = path;
    refreshHl();
    refreshTabs();
    refreshTree();
    if (/\.html?$/.test(path)) showPreview(path);
    else showPreview(null);
  }

  /* VS Code-style tabs: every opened file gets a tab with a close X */
  function refreshTabs() {
    var bar = $('#ideTabs');
    if (!bar) return;
    bar.innerHTML = tabs.map(function (p) {
      var n = p.split('/').pop();
      var active = p === curPath;
      var dot = (p === curPath && dirty) ? ' ●' : '';
      return '<button class="ide-tab' + (active ? ' on' : '') + '" data-idetab="' + esc(p) + '"><span>' + esc(n) + dot + '</span><i data-lucide="x" data-idetabx="' + esc(p) + '"></i></button>';
    }).join('');
    if (window.lucide) try { lucide.createIcons({ attrs: { width: 12, height: 12 } }); } catch (e) {}
    bar.querySelectorAll('[data-idetab]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var x = e.target.closest('[data-idetabx]');
        if (x) {
          var p = x.getAttribute('data-idetabx');
          tabs = tabs.filter(function (t) { return t !== p; });
          if (curPath === p) { curPath = null; $('#ideEditor').value = ''; refreshHl(); IDE.showPreview(null); $('#idePath').textContent = '—'; }
          refreshTabs();
          return;
        }
        IDE.loadFile(b.getAttribute('data-idetab'));
      });
    });
  }

  /* line-number gutter, scroll-synced with the editor */
  function refreshGutter() {
    var g = $('#ideGutter'), ta = $('#ideEditor');
    if (!g || !ta) return;
    var n = ta.value.split('\n').length;
    var out = '';
    for (var i = 1; i <= Math.max(n, 1); i++) out += i + '\n';
    g.textContent = out;
    g.scrollTop = ta.scrollTop;
  }

  /* transparent-textarea-over-highlighted-pre keeps editing simple and code colored */
  function refreshHl() {
    var pre = $('#ideHl'), ta = $('#ideEditor');
    if (!pre || !ta) return;
    pre.innerHTML = H.hi(ta.value, H.extLang(curPath)) + '\n';
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  function showPreview(path) {
    var frame = $('#ideFrame'), holder = $('#idePreviewWrap');
    var s = Store.ws();
    if (path && s && s.vfsContent[path] !== undefined) {
      frame.setAttribute('srcdoc', s.vfsContent[path]);
      $('#idePrevLabel').textContent = path;
      holder.style.display = '';
    } else {
      frame.setAttribute('srcdoc', '<body style="font-family:system-ui;background:#0d0d10;color:#68686f;display:grid;place-items:center;height:100vh;margin:0">Open an .html file to preview it here</body>');
      $('#idePrevLabel').textContent = 'preview';
      holder.style.display = '';
    }
  }

  function save() {
    if (!curPath) return;
    var r = Tools.run('write_file', { path: curPath, content: $('#ideEditor').value });
    if (r.indexOf('Error') === 0) { IDE.print(r); return; }
    dirty = false;
    IDE.print('saved ' + curPath, 'dim');
    refreshTree(); refreshTabs();
    if (/\.html?$/.test(curPath)) showPreview(curPath);
  }

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
    if (r.open) IDE.loadFile(r.open);
    refreshTree();
  }

  function wire() {
    $('#ideClose').addEventListener('click', close);
    $('#ideSave').addEventListener('click', save);
    $('#ideRun').addEventListener('click', function () { if (curPath) showPreview(curPath); });
    $('#ideEditor').addEventListener('input', function () { dirty = true; refreshHl(); refreshGutter(); refreshTabs(); });
    $('#ideEditor').addEventListener('scroll', function () {
      var pre = $('#ideHl');
      pre.scrollTop = $('#ideEditor').scrollTop;
      pre.scrollLeft = $('#ideEditor').scrollLeft;
      var g = $('#ideGutter');
      if (g) g.scrollTop = $('#ideEditor').scrollTop;
    });
    $('#ideEditor').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        var q = prompt('Quick open — file name:');
        if (!q) return;
        var hit = allFiles().find(function (f) { return f.path.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
        if (hit) IDE.loadFile(hit.path); else IDE.print('no file matching "' + q + '"', 'dim');
      }
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
    $('#ideNewFile').addEventListener('click', function () {
      var name = prompt('New file path (e.g. app/index.html)');
      if (!name || !name.trim()) return;
      Tools.run('write_file', { path: name.trim(), content: '' });
      refreshTree();
      IDE.loadFile(name.trim().replace(/^\/+/, '').indexOf('workspace/') === 0 ? name.trim().replace(/^\/+/, '') : 'workspace/' + name.trim().replace(/^\/+/, ''));
    });
  }

  window.IDE = {
    open: open, close: close, refreshTree: refreshTree, loadFile: loadFile,
    showPreview: showPreview, save: save, print: print, clearOut: clearOut, wire: wire,
    refreshTabs: refreshTabs, refreshGutter: refreshGutter
  };
})();
