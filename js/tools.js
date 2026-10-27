/* Mono Harness — built-in agent tools + harness console.
   Tools operate on the ACTIVE CHAT's workspace only (each chat gets its own);
   there is no OS shell. The same command set powers the IDE console and the
   model's run_command tool. */
(function () {
  function WS() {
    var s = Store.ws();
    if (!s) throw new Error('No active chat — each chat has its own workspace');
    return s;
  }
  function normPath(p) {
    p = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (p === 'workspace') return p;
    if (p.indexOf('workspace/') !== 0) p = 'workspace/' + p;
    var parts = p.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === '.') continue;
      if (parts[i] === '..') { if (out.length > 1) out.pop(); continue; }
      out.push(parts[i]);
    }
    /* containment: resolution must never leave workspace/ — a leading '..'
       that pops past the root would otherwise address sibling keys */
    if (!out.length || out[0] !== 'workspace') return 'workspace';
    return out.join('/');
  }
  function parentOf(path) {
    var i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }
  function baseOf(path) {
    return path.slice(path.lastIndexOf('/') + 1);
  }
  /* make sure every directory segment exists in the workspace tree */
  function ensureDirs(path) {
    var vfs = WS().vfs;
    var parts = path.split('/');
    var acc = '';
    for (var i = 0; i < parts.length - 1; i++) {
      var parent = acc || 'workspace';
      acc = acc ? acc + '/' + parts[i] : parts[i];
      var list = vfs[parent] || (vfs[parent] = []);
      if (!list.some(function (e) { return e.n === parts[i] && e.t === 'dir'; })) {
        list.push({ n: parts[i], t: 'dir', p: acc });
        vfs[acc] = vfs[acc] || [];
      }
    }
    vfs[path] = vfs[path] || [];
  }
  function fmtSize(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
  function skillSlug(nm) { return String(nm || '').replace(/[^\w.-]+/g, '-'); }
  /* "did you mean" candidates when a path doesn't exist — lets the model
     self-correct from a typo instead of failing a whole round */
  function similarPaths(path) {
    try {
      var full = normPath(path), base = baseOf(full).toLowerCase();
      var stems = base.split(/[._\-]+/).filter(function (w) { return w.length > 2; });
      return Object.keys(WS().vfsContent).filter(function (k) {
        if (k === full) return false;
        var kb = baseOf(k).toLowerCase();
        if (kb.indexOf(base) >= 0 && base.length > 2) return true;
        if (base.indexOf(kb) >= 0 && kb.length > 2) return true;
        return stems.some(function (w) { return kb.indexOf(w) >= 0; });
      }).slice(0, 4);
    } catch (e) { return []; }
  }
  function notFound(path) {
    var sug = similarPaths(path);
    return 'Error: no such file: ' + normPath(path) + (sug.length ? ' — did you mean: ' + sug.join(', ') + '?' : '') +
      ' (check with list_files)';
  }
  /* closest line for an oldString that didn't match — token-overlap score */
  function nearestLine(text, needle) {
    var toks = (needle.toLowerCase().match(/[a-z0-9_$]{3,}/g) || []).filter(function (w, i, a) { return a.indexOf(w) === i; });
    if (!toks.length) return null;
    var best = null;
    String(text).split('\n').forEach(function (line, i) {
      var low = line.toLowerCase(), sc = 0;
      toks.forEach(function (w) { if (low.indexOf(w) >= 0) sc++; });
      if (sc && (!best || sc > best.sc)) best = { n: i + 1, sc: sc, line: line.trim().slice(0, 120) };
    });
    var need = Math.max(2, Math.ceil(toks.length / 3));
    return best && best.sc >= need ? best : null;
  }

  /* ============================================================
     PROJECT LIBRARY — imported projects mounted at lib/<slug>/
     Shared read/edit cores so workspace and library behave identically.
     ============================================================ */
  function segmentedRead(text, a) {
    var off = Math.max(0, parseInt(a.offset, 10) || 0);
    var part = String(text).slice(off, off + 6000);
    var foot = '';
    if (String(text).length > off + 6000) foot = '\n[showing chars ' + off + '-' + (off + 6000) + ' of ' + String(text).length + ' — pass a higher offset, or startLine/endLine for a line window]';
    return (off > 0 ? '[read from offset ' + off + ']\n' : '') + part + foot;
  }
  function numberedWindow(text, a, label) {
    var lines = String(text).split('\n');
    var st = Math.max(1, parseInt(a.startLine, 10) || 1);
    var en = Math.min(lines.length, parseInt(a.endLine, 10) || st + 119);
    if (en < st) return 'Error: endLine ' + en + ' is before startLine ' + st;
    var win = lines.slice(st - 1, en).map(function (l, i) { return 'L' + (st + i) + ': ' + l; }).join('\n');
    return label + ' — lines ' + st + '-' + en + ' of ' + lines.length +
      ' (numbered for reference; strip the "L<n>:" prefixes when using this text in edit_file)\n' + win;
  }
  function flatWs(s) { return String(s == null ? '' : s).split(/\s+/).join(' '); }
  function matchCore(text, oldStr, newStr, a) {
    var count = text.split(oldStr).length - 1;
    if (count === 0) {
      var flat = flatWs(text), want = flatWs(oldStr);
      if (want.length > 3 && flat.indexOf(want) >= 0) {
        var near0 = nearestLine(text, oldStr);
        return { err: 'Error: oldString not found VERBATIM, but a whitespace-differing match exists' +
          (near0 ? ' near line ' + near0.n + ': ' + near0.line : '') +
          '. Re-read that region (read_file with startLine/endLine) and copy the text EXACTLY, including indentation.' };
      }
      var near = nearestLine(text, oldStr);
      return { err: 'Error: oldString not found. read_file the region first, then copy the exact text.' +
        (near ? ' Closest line ' + near.n + ': ' + near.line : '') };
    }
    if (count > 1 && !a.replaceAll) {
      var at = [], i0 = -1;
      while ((i0 = text.indexOf(oldStr, i0 + 1)) > 0 && at.length < 5) at.push(text.slice(0, i0).split('\n').length);
      return { err: 'Error: oldString matches ' + count + ' places (lines ' + at.join(', ') + (count > 5 ? ', …' : '') + ') — include more surrounding context to make it unique, or set replaceAll:true' };
    }
    /* split/join — literal replacement, no special-pattern semantics */
    return { updated: text.split(oldStr).join(newStr), count: count };
  }
  function libCtx(path) {
    var p = (path == null ? '' : String(path)).split('\\').join('/');
    var m = p.match(/^lib\/([^/]+)(?:\/(.*))?$/);
    if (!m) return null;
    var sess = Store.active();
    var mount = ((sess && sess.mounts) || []).filter(function (x) { return x.slug === m[1]; })[0];
    if (!mount) return { missing: 'no mounted library "lib/' + m[1] + '/" — the user can mount it from Files → Project Library' };
    var project = Store.lib.get(mount.libId);
    if (!project) return { missing: 'the mounted library "' + mount.name + '" no longer exists' };
    return { mount: mount, project: project, rel: m[2] || '', full: p };
  }
  function libSuggest(project, rel) {
    var keys = Object.keys(project.files || {}).filter(function (k) { return k.indexOf(rel) >= 0 || rel.indexOf(k) >= 0; }).slice(0, 4);
    return keys.length ? ' — did you mean: ' + keys.join(', ') + '?' : '';
  }
  function libListDir(project, rel) {
    var pre = rel ? rel + '/' : '';
    var dirs = {}, files = [];
    Object.keys(project.files || {}).forEach(function (k) {
      if (pre && k.indexOf(pre) !== 0) return;
      var rest = pre ? k.slice(pre.length) : k;
      var si = rest.indexOf('/');
      if (si >= 0) dirs[rest.slice(0, si)] = true;
      else files.push({ n: rest, len: (project.files[k] || '').length });
    });
    var out = Object.keys(dirs).sort().map(function (d) { return '[dir]  ' + d; })
      .concat(files.sort(function (a, b) { return a.n < b.n ? -1 : 1; }).map(function (f) { return '       ' + f.n + '  ' + fmtSize(f.len); }));
    return out.length ? out.join('\n') : '(empty)';
  }
  function symbolReport(content, path) {
    var ext = path.split('.').pop().toLowerCase();
    var out = [], imports = [];
    var lines = String(content).split('\n');
    var pats;
    if (ext === 'py') {
      pats = [
        [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, 'function'], [/^\s*class\s+([A-Za-z_]\w*)/, 'class']
      ];
      var impPats = [[/^\s*import\s+(\S+)/], [/^\s*from\s+(\S+)/]];
    } else if (/^(css|scss)$/.test(ext)) {
      pats = [[/^\s*([.#][\w-][^{]*)\{/, 'rule']];
    } else { // js/ts/tsx/jsx and similar brace languages
      pats = [
        [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
        [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
        [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/, 'function'],
        [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
        [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, 'type'],
        [/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!.*=>\s*$)(?!.*function\b)/, 'export'],
        [/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!.*=>\s*$)(?!.*function\b)/, 'const']
      ];
      var impPats = [[/^\s*import\s.+from\s+['"]([^'"]+)['"]/], [/^\s*import\s+['"]([^'"]+)['"]/], [/^\s*(?:const|let|var)\s+.+=\s*require\(['"]([^'"]+)['"]\)/]];
    }
    lines.forEach(function (line, i) {
      var matched = false;
      if (impPats) {
        for (var q = 0; q < impPats.length; q++) {
          var im = line.match(impPats[q][0]);
          if (im) { imports.push('L' + (i + 1) + ' ' + im[1].trim().slice(0, 60)); matched = true; break; }
        }
      }
      if (matched) return;
      /* one label per line: first matching pattern wins */
      for (var pi = 0; pi < pats.length; pi++) {
        var m = line.match(pats[pi][0]);
        if (m) { out.push('L' + (i + 1) + ' ' + pats[pi][1] + ': ' + m[1].trim().slice(0, 80)); break; }
      }
    });
    /* collapse import runs into one budget-friendly outline entry */
    if (imports.length > 4) out.unshift(imports[0] + '-' + imports[imports.length - 1].replace(/^L\d+ /, '') + ' — import block (' + imports.length + ')');
    else if (imports.length) imports.reverse().forEach(function (im) { out.unshift(im); });
    if (!out.length) return 'No symbols found in ' + path + ' (' + lines.length + ' lines, .' + ext + ')';
    return path + ' — ' + out.length + ' symbols\n' + out.slice(0, 150).join('\n');
  }

  var IMPL = {
    write_file: function (a) {
      var Lw = libCtx(a.path);
      if (Lw) {
        if (Lw.missing) return 'Error: ' + Lw.missing;
        if (Lw.rel === '') return 'Error: lib/' + Lw.mount.slug + '/ is a mount root — write to a file inside it, e.g. lib/' + Lw.mount.slug + '/index.html';
        var prevL = Lw.project.files[Lw.rel];
        var libContent = String(a.content || '');
        if (a.mode === 'append' && prevL !== undefined) libContent = String(prevL) + libContent;
        Lw.project.files[Lw.rel] = libContent;
        Store.lib.put(Lw.project);
        var libLines = libContent.split('\n').length;
        var lmsg = 'Wrote ' + Lw.full + ' (' + fmtSize(libContent.length) + (a.mode === 'append' ? ', appended' : '') + ') — file now ' + libLines + ' lines total';
        if (a.mode !== 'append' && prevL !== undefined) lmsg += ' — replaced the previous ' + String(prevL).split('\n').length + '-line version';
        if (libLines > 400 && a.mode !== 'append') lmsg += '\nNOTE: that was a big single write. For files >150 lines prefer sections of ≤120 lines (write the opening, then mode:"append") — long single generations can be dropped by the provider.';
        return lmsg;
      }
      var s = WS();
      var path = normPath(a.path);
      var content = String(a.content || '');
      var prevLines;
      /* append mode: large files get written in sections — long single
         generations get silently dropped by free-tier providers */
      if (a.mode === 'append') {
        var prevContent = s.vfsContent[path];
        if (prevContent !== undefined) content = String(prevContent) + content;
      } else if (s.vfsContent[path] !== undefined) {
        prevLines = String(s.vfsContent[path]).split('\n').length;
      }
      ensureDirs(parentOf(path) || 'workspace');
      var dir = parentOf(path) || 'workspace';
      var list = s.vfs[dir] || (s.vfs[dir] = []);
      var name = baseOf(path);
      var size = fmtSize(content.length);
      var ex = list.find(function (e) { return e.n === name; });
      var isImg = /^data:image\//.test(content);
      if (ex) { ex.s = size; if (ex.t !== 'dir') ex.t = isImg ? 'img' : 'code'; }
      else list.push({ n: name, t: isImg ? 'img' : (/\.(md|txt)$/.test(name) ? 'doc' : 'code'), s: size });
      s.vfsContent[path] = content;
      Store.save();
      var totalLines = content.split('\n').length;
      var msg = 'Wrote ' + path + ' (' + size + (a.mode === 'append' ? ', appended' : '') + ') — file now ' + totalLines + ' lines total';
      if (a.mode !== 'append' && prevLines !== undefined) msg += ' — replaced the previous ' + prevLines + '-line version';
      if (totalLines > 400 && a.mode !== 'append') msg += '\nNOTE: that was a big single write. For files >150 lines prefer sections of ≤120 lines (write the opening, then mode:"append") — long single generations can be dropped by the provider.';
      return msg;
    },
    read_file: function (a) {
      var L = libCtx(a.path);
      if (L) {
        if (L.missing) return 'Error: ' + L.missing;
        if (L.rel === '') return 'lib/' + L.mount.slug + '/ is a mounted project (' + Object.keys(L.project.files).length + ' files) — list_files it to explore';
        if (L.project.files[L.rel] === undefined) return 'Error: no such file: ' + L.full + libSuggest(L.project, L.rel) + ' (list_files "lib/' + L.mount.slug + '/" to explore)';
        if (a.startLine !== undefined || a.endLine !== undefined) return numberedWindow(L.project.files[L.rel], a, L.full);
        return segmentedRead(L.project.files[L.rel], a);
      }
      var s = WS();
      var path = normPath(a.path);
      var c = s.vfsContent[path];
      if (c === undefined) return notFound(path);
      /* line window: numbered lines for precise edit_file anchoring.
         NOTE for the model: strip the "L<n>: " prefixes when copying text
         into edit_file oldString. */
      if (a.startLine !== undefined || a.endLine !== undefined) return numberedWindow(c, a, path);
      return segmentedRead(c, a);
    },
    create_directory: function (a) {
      var Lc = libCtx(a.path);
      if (Lc) {
        if (Lc.missing) return 'Error: ' + Lc.missing;
        return 'lib/' + Lc.mount.slug + '/ is a mounted project — directories are implicit there; just write files with their full paths (e.g. lib/' + Lc.mount.slug + '/src/main.js)';
      }
      var s = WS();
      var dir = normPath(a.path);
      if (!dir || dir === 'workspace') return 'Error: directory path required';
      ensureDirs(dir);
      Store.save();
      return 'Created directory ' + dir;
    },
    edit_file: function (a) {
      var Le = libCtx(a.path);
      if (Le) {
        if (Le.missing) return 'Error: ' + Le.missing;
        if (Le.rel === '') return 'Error: lib/' + Le.mount.slug + '/ is a mount root — edit a file inside it';
        var curL = Le.project.files[Le.rel];
        if (curL === undefined) return 'Error: no such file: ' + Le.full + libSuggest(Le.project, Le.rel);
        var oldL = String(a.oldString == null ? '' : a.oldString);
        var newL = String(a.newString == null ? '' : a.newString);
        if (!oldL) return 'Error: oldString required';
        var coreL = matchCore(String(curL), oldL, newL, a);
        if (coreL.err) return coreL.err;
        Le.project.files[Le.rel] = coreL.updated;
        Store.lib.put(Le.project);
        return 'Edited ' + Le.full + ' (' + coreL.count + (a.replaceAll ? ' replacement(s)' : ' replacement') + ') — file now ' + coreL.updated.split('\n').length + ' lines';
      }
      var s = WS();
      var path = normPath(a.path);
      var c = s.vfsContent[path];
      if (c === undefined) return notFound(path);
      var oldStr = String(a.oldString == null ? '' : a.oldString);
      var newStr = String(a.newString == null ? '' : a.newString);
      if (!oldStr) return 'Error: oldString required';
      var core = matchCore(String(c), oldStr, newStr, a);
      if (core.err) return core.err;
      var updated = core.updated;
      s.vfsContent[path] = updated;
      var dir = parentOf(path) || 'workspace';
      var list = s.vfs[dir] || (s.vfs[dir] = []);
      var ex = list.find(function (e) { return e.n === baseOf(path); });
      if (ex) ex.s = fmtSize(updated.length);
      Store.save();
      return 'Edited ' + path + ' (' + core.count + (a.replaceAll ? ' replacement(s)' : ' replacement') + ') — file now ' + updated.split('\n').length + ' lines';
    },
    list_files: function (a) {
      var Ll = libCtx(a && a.path ? a.path : '');
      if (Ll) {
        if (Ll.missing) return 'Error: ' + Ll.missing;
        if (Ll.rel === '') {
          var head = 'lib/' + Ll.mount.slug + '/ — mounted project "' + Ll.project.name + '" (' + Object.keys(Ll.project.files).length + ' files)';
          return head + '\n' + libListDir(Ll.project, '');
        }
        var any = Object.keys(Ll.project.files || {}).some(function (k) { return k.indexOf(Ll.rel + '/') === 0 || k === Ll.rel; });
        if (!any) return 'Error: no such folder: ' + Ll.full + libSuggest(Ll.project, Ll.rel);
        return libListDir(Ll.project, Ll.rel);
      }
      var s = WS();
      var path = normPath(a.path || 'workspace');
      var list = s.vfs[path];
      if (!list) return 'Error: no such folder: ' + path;
      if (!list.length) return '(empty)';
      return list.map(function (e) { return (e.t === 'dir' ? '[dir]  ' : '       ') + e.n + (e.s ? '  ' + e.s : ''); }).join('\n');
    },
    delete_file: function (a) {
      var Ld = libCtx(a.path);
      if (Ld) {
        if (Ld.missing) return 'Error: ' + Ld.missing;
        if (Ld.rel === '') return 'Error: cannot delete a mount root — unmount it from Files → Project Library instead';
        var hadL = Ld.project.files[Ld.rel] !== undefined;
        delete Ld.project.files[Ld.rel];
        Store.lib.put(Ld.project);
        return hadL ? 'Deleted ' + Ld.full : 'Error: no such file: ' + Ld.full;
      }
      var s = WS();
      var path = normPath(a.path);
      var dir = parentOf(path) || 'workspace';
      var name = baseOf(path);
      var list = s.vfs[dir] || [];
      var before = list.length;
      s.vfs[dir] = list.filter(function (e) { return e.n !== name; });
      var existed = s.vfsContent[path] !== undefined;
      delete s.vfsContent[path];
      Store.save();
      return (s.vfs[dir].length < before || existed) ? 'Deleted ' + path : notFound(path);
    },
    save_memory: function (a) {
      var title = String(a.title || '').trim().slice(0, 60);
      if (!title) return 'Error: memory needs a title';
      var tag = ['user', 'feedback', 'project', 'reference'].indexOf(a.tag) >= 0 ? a.tag : 'project';
      var body = String(a.body || '').slice(0, 600);
      // mem0-style: same title = update, not a duplicate
      var ex = Store.db.memories.find(function (m) { return m.title.toLowerCase() === title.toLowerCase(); });
      if (ex) { ex.body = body; ex.tag = tag; ex.updated = Date.now(); Store.save(); return 'Updated memory "' + title + '"'; }
      Store.db.memories.push({ id: 'm' + H.uid(), title: title, tag: tag, body: body, updated: Date.now() });
      Store.save();
      return 'Saved memory "' + title + '" (tag: ' + tag + ')';
    },
    memory_search: function (a) {
      var q = String(a.query || '').toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
      var ms = Store.db.memories || [];
      if (!ms.length) return 'No memories saved yet.';
      var scored = ms.map(function (m) {
        var hay = (m.title + ' ' + m.body + ' ' + m.tag).toLowerCase();
        var score = q.reduce(function (acc, w) { return acc + (hay.indexOf(w) >= 0 ? 1 : 0); }, 0);
        return { m: m, score: score };
      }).filter(function (x) { return x.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 5);
      if (!scored.length) {
        var recent = ms.slice(-4).reverse();
        return 'No memories match "' + String(a.query || '') + '" — most recent memories:\n' +
          recent.map(function (m) { return '- [' + m.tag + '] ' + m.title + ': ' + m.body.slice(0, 150); }).join('\n');
      }
      return scored.map(function (x) { return '- [' + x.m.tag + '] ' + x.m.title + ': ' + x.m.body.slice(0, 200); }).join('\n');
    },
    delete_memory: function (a) {
      var title = String(a.title || '').trim().toLowerCase();
      var ms = Store.db.memories || [];
      var idx = -1;
      for (var i = 0; i < ms.length; i++) {
        if (ms[i].title.toLowerCase() === title || ms[i].title.toLowerCase().indexOf(title) >= 0 && title.length > 3) { idx = i; break; }
      }
      if (idx < 0) return 'Error: no memory matching "' + title + '"';
      var gone = ms.splice(idx, 1)[0];
      Store.save();
      return 'Deleted memory "' + gone.title + '"';
    },
    todo_write: function (a) {
      var s = Store.active();
      if (!s) return 'Error: no active session';
      var items = a.items || a.todos;
      if (!Array.isArray(items)) return 'Error: items must be an array of {t: "step", done: false}';
      s.todos = items.slice(0, 20).map(function (it) {
        return { t: String(it.t || it.text || '').slice(0, 120), done: !!it.done };
      }).filter(function (it) { return it.t; });
      Store.save();
      try { UI.renderTodoCard(s); } catch (e) { }
      return 'Todo list updated (' + s.todos.filter(function (t) { return t.done; }).length + '/' + s.todos.length + ' done)' +
        (items.length > 20 ? ' — only the first 20 steps were kept; keep plans ≤20 steps' : '') +
        ' — shown to the user. Keep it current as you work.';
    },
    workspace_search: function (a) {
      // ripgrep-style recursive search over the workspace: regex or plain
      // text, glob filter, ignore rules, bounded results with line numbers
      var s = WS();
      var pat = String(a.pattern || '');
      if (!pat) return 'Error: pattern required';
      var re;
      try { re = new RegExp(a.isRegex ? pat : pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); } catch (e) { return 'Error: bad regex: ' + e.message; }
      var glob = String(a.glob || '').toLowerCase();
      var base = normPath(a.dir || 'workspace');
      var SKIP = /(^|\/)(node_modules|dist|build|\.git|\.gradle|__pycache__|\.proot)(\/|$)/;
      var BIN = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp4|mp3|zip|gz|tar|so|dll|exe|pdf)$/i;
      var max = Math.min(+a.maxResults || 60, 200);
      var out = [], scanned = 0, total = 0;
      Object.keys(s.vfsContent).forEach(function (path) {
        if (path.indexOf(base) !== 0) return;
        if (SKIP.test(path) || BIN.test(path)) return;
        if (glob && path.toLowerCase().indexOf(glob.replace(/^\*/, '')) < 0) return;
        var content = String(s.vfsContent[path] || '');
        if (content.indexOf('data:') === 0) return; // stored binaries
        scanned++;
        var fileHits = 0;
        content.split('\n').forEach(function (line, i) {
          re.lastIndex = 0;
          if (!re.test(line)) return;
          total++;
          if (out.length >= max || fileHits >= 15) return;
          fileHits++;
          out.push(path + ':' + (i + 1) + ': ' + line.trim().slice(0, 160));
        });
      });
      /* mounted libraries are searched too — their files are project files */
      var mounts = (Store.active() && Store.active().mounts) || [];
      for (var mi = 0; mi < mounts.length; mi++) {
        var pr = Store.lib.get(mounts[mi].libId);
        if (!pr) continue;
        var libFiles = Object.keys(pr.files || {}).sort();
        for (var fi = 0; fi < libFiles.length; fi++) {
          var lcontent = String(pr.files[libFiles[fi]] || '');
          if (!lcontent || lcontent.indexOf('data:') === 0) continue;
          scanned++;
          var llines = lcontent.split('\n');
          for (var li = 0; li < llines.length; li++) {
            re.lastIndex = 0;
            if (!re.test(llines[li])) continue;
            total++;
            if (out.length >= max) continue;
            out.push('lib/' + mounts[mi].slug + '/' + libFiles[fi] + ':' + (li + 1) + ': ' + llines[li].trim().slice(0, 160));
          }
        }
      }
      if (!out.length) return 'No matches for /' + pat + '/ (' + scanned + ' files scanned, mounted libraries included). Try: a shorter pattern, isRegex:true, or a different glob.';
      var note2 = '';
      if (total > out.length) note2 = '\n… ' + (total - out.length) + ' more match(es) not shown (bounded at ' + max + ').';
      return (out.length ? out.join('\n') : '') + '\n' + total + ' match(es) across ' + scanned + ' files.' + note2;
    },
    code_symbols: function (a) {
      // tree-sitter-style structural outline: functions, classes, imports,
      // exports with line numbers — enough to navigate before editing
      var Ls = libCtx(a.path);
      if (Ls) {
        if (Ls.missing) return 'Error: ' + Ls.missing;
        if (Ls.rel === '') return 'Error: lib/' + Ls.mount.slug + '/ is a mount root — pick a file inside it (list_files first)';
        var lbody = Ls.project.files[Ls.rel];
        if (lbody === undefined) return 'Error: no such file: ' + Ls.full + libSuggest(Ls.project, Ls.rel);
        if (String(lbody).indexOf('data:') === 0) return 'Error: binary file';
        return symbolReport(String(lbody), Ls.full);
      }
      var s = WS();
      var path = normPath(a.path || '');
      var content = s.vfsContent[path];
      if (content === undefined) return notFound(path);
      content = String(content);
      if (content.indexOf('data:') === 0) return 'Error: binary file';
      return symbolReport(content, path);
    },
    load_skill: function (a) {
      var nm = String(a.name || '').trim();
      var slug = skillSlug(nm);
      var enabled = [];
      try { enabled = (Store.db.skills || []).filter(function (k) { return k.on; }); } catch (e) { }
      /* case/slug-insensitive resolve so near-miss names still work */
      var hit = enabled.filter(function (k) {
        return k.name.toLowerCase() === nm.toLowerCase() || skillSlug(k.name).toLowerCase() === slug.toLowerCase();
      })[0];
      var name = hit ? hit.name : nm;
      var body = null;
      try { body = WS().vfsContent['workspace/skills/' + skillSlug(name) + '.md']; } catch (e) { }
      try {
        if ((body === undefined || body === null) && hit) {
          /* registered but bodyless (imported starter pack): seed a stub so the
             skill activates NOW and the agent fleshes out the procedure later */
          IMPL.write_file({ path: 'skills/' + skillSlug(name) + '.md', content: '---\nname: ' + name + '\ndescription: ' + (hit.desc || name) + '\n---\n\n# Skill: ' + name + '\n\n' + (hit.desc || '') + '\n\n<!-- Stub body: extend these instructions with the concrete step-by-step procedure this skill should follow when invoked. -->\n' });
          body = WS().vfsContent['workspace/skills/' + skillSlug(name) + '.md'];
        }
      } catch (e) { }
      if (body === undefined || body === null) {
        var avail = enabled.map(function (k) { return k.name; });
        var toks = slug.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
        var near = avail.filter(function (n2) {
          var l = n2.toLowerCase();
          return toks.some(function (w) { return l.indexOf(w) >= 0; });
        })[0];
        return 'Error: no skill "' + nm + '"' + (near ? ' — did you mean "' + near + '"?' : '') + '. Available: ' + (avail.join(', ') || 'none') + '.';
      }
      try {
        var s = Store.active();
        if (s) {
          s.activeSkills = s.activeSkills || [];
          if (s.activeSkills.indexOf(name) < 0) { s.activeSkills.push(name); Store.save(); }
        }
      } catch (e) { }
      return 'Skill "' + name + '" ACTIVATED for this session — its full instructions:\n\n' + String(body).slice(0, 6000);
    },
    /* ---------- servers manager (PolyDev-style dev-server registry) ----------
       The MODEL starts dev servers itself with shell_exec (verbatim command,
       the reviewed passthrough path — typically: nohup <cmd> >> log 2>&1 & echo PID=$!),
       then registers it here. run_server is pure registry state. Every
       shell-facing action (stop/log) goes through AgentExec.execArgs — an
       argv-array API that shell-quotes each argument in one reviewed place,
       so no command string is ever composed in tool code. */
    run_server: function (a) {
      var port = parseInt(a.port, 10);
      if (!port || port < 1024 || port > 65535) return 'Error: port must be 1024-65535';
      var pid = a.pid === undefined ? 0 : parseInt(a.pid, 10);
      if (isNaN(pid) || pid < 0) pid = 0;
      var name = String(a.name || 'server-' + port).replace(/[^\w .:-]/g, '').slice(0, 40) || ('server-' + port);
      var cmd = String(a.command || '').replace(/[\r\n]+/g, ' ').slice(0, 160);
      var dir = String(a.dir || '').replace(/[^\w ./_-]/g, '').slice(0, 120);
      var logFile = String(a.logFile || '.reva-servers/' + port + '.log').replace(/[^\w ./_-]/g, '');
      if (logFile.indexOf('..') >= 0) logFile = '.reva-servers/' + port + '.log';
      var db = Store.db;
      db.servers = (db.servers || []).filter(function (v) { return v.port !== port; });
      db.servers.unshift({
        id: 'sv' + Date.now().toString(36), name: name, port: port,
        dir: dir, cmd: cmd, pid: pid,
        status: 'running', startedAt: Date.now(), logFile: logFile
      });
      if (db.servers.length > 12) db.servers.length = 12;
      Store.save();
      return 'Server "' + name + '" registered on port ' + port + (pid ? ' (pid ' + pid + ')' : '') + '.\nURL: http://127.0.0.1:' + port + '/ — the built-in browser start page lists it, the user can open it there.\nManage with server_log / stop_server; stop the server when work is done.';
    },
    stop_server: async function (a) {
      var db = Store.db;
      var hit = (db.servers || []).filter(function (v) { return v.status === 'running'; }).filter(function (v) {
        return (a.port && v.port === parseInt(a.port, 10)) || (a.name && v.name === String(a.name));
      })[0];
      if (!hit) return 'Error: no running server matches that port/name';
      var pid = parseInt(hit.pid, 10);
      var ok = true, detail = '';
      if (window.AgentExec && window.REVAAgent && pid > 0) {
        var ex = await AgentExec.execArgs(['kill', String(pid)], { timeoutMs: 15000 });
        ok = ex.exit === 0;
        if (!ok) detail = ' (kill exit ' + ex.exit + ' — process may have already exited)';
      }
      hit.status = 'stopped';
      Store.save();
      return 'Server "' + hit.name + '" (port ' + hit.port + ') stopped' + (ok ? '.' : detail + ' — marked stopped in the registry anyway.');
    },
    server_log: async function (a) {
      var db = Store.db;
      var hit = (db.servers || []).filter(function (v) { return v.port === parseInt(a.port, 10); })[0];
      if (!hit) return 'Error: no server registered on port ' + a.port;
      var lines = Math.min(200, Math.max(5, parseInt(a.lines, 10) || 40));
      if (window.AgentExec && window.REVAAgent) {
        var ex = await AgentExec.execArgs(['tail', '-n', String(lines), hit.logFile], { timeoutMs: 15000 });
        if (ex.exit !== 0) return '(no log yet for "' + hit.name + '" — port ' + hit.port + ')';
        return String(ex.out || '(empty)').slice(0, 8000);
      }
      return '(log reading needs the device shell) server "' + hit.name + '" on port ' + hit.port + ' — cmd: ' + hit.cmd;
    },
    run_command: function (a) {
      return Console.exec(String(a.command || '')).out;
    }
  };

  function brief(name, args, result) {
    var s = String(result || '');
    var ok = s.indexOf('Error') !== 0;
    if (name === 'write_file') return { label: 'Writing ' + (args.path || ''), meta: fmtSize(String(args.content || '').length), ok: ok, path: normPath(args.path) };
    if (name === 'read_file') return { label: 'Reading ' + (args.path || ''), meta: s.split('\n').length + ' lines', ok: ok };
    if (name === 'list_files') return { label: 'Listing ' + (args.path || 'workspace'), meta: s.split('\n').length + ' entries', ok: ok };
    if (name === 'delete_file') return { label: 'Deleting ' + (args.path || ''), meta: ok ? 'done' : 'failed', ok: ok };
    if (name === 'save_memory') return { label: 'Saving memory ' + (args.title || ''), meta: args.tag || 'project', ok: ok };
    if (name === 'memory_search') return { label: 'Recalling ' + String(args.query || '').slice(0, 30), meta: '', ok: ok };
    if (name === 'todo_write') return { label: 'Planning', meta: (Store.active() && Store.active().todos ? Store.active().todos.length : 0) + ' steps', ok: ok };
    if (name === 'workspace_search') return { label: 'Searching workspace', meta: 'ripgrep-style', ok: ok };
    if (name === 'code_symbols') return { label: 'Symbols · ' + String(args.path || '').slice(0, 34), meta: '', ok: ok };
    if (name === 'load_skill') return { label: 'Skill · ' + String(args.name || ''), meta: 'activated', ok: ok };
    if (name === 'run_server') return { label: 'Server · ' + String(args.name || ('port ' + (args.port || '?'))), meta: ':' + (args.port || ''), ok: ok };
    if (name === 'server_log') return { label: 'Server log · :' + (args.port || ''), meta: '', ok: ok };
    if (name === 'stop_server') return { label: 'Stopping server · :' + (args.port || args.name || ''), meta: '', ok: ok };
    if (name === 'run_command') return { label: '❯ ' + (args.command || ''), meta: '', ok: ok, cmd: args.command, out: s };
    if (name === 'web_search') return { label: 'Search · ' + String(args.query || '').slice(0, 40), meta: '', ok: ok };
    if (name === 'web_read') return { label: 'Read · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: '', ok: ok };
    if (name === 'browser_open') return { label: 'Browser · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: '', ok: ok, target: String(args.url || '') };
    if (name === 'browser_read') return { label: 'Read · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: '', ok: ok, target: String(args.url || '') };
    if (name === 'image_gen') return { label: 'Imagining ' + String(args.prompt || '').slice(0, 36), meta: 'FLUX', ok: ok, target: args.path || 'images/' };
    if (name === 'shell_exec') return { label: '❯ ' + String(args.command || '').slice(0, 46), meta: '', ok: ok, cmd: args.command, out: s };
    return { label: name, meta: '', ok: ok };
  }

  var SCHEMAS = [
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in this chat\'s workspace. For LARGE files (>150 lines: games, big apps) ALWAYS write in sections: first call writes the opening, then subsequent calls pass mode:"append" to add the next section — long single generations get dropped. path is relative to workspace.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['append'], description: 'pass "append" to add this content to the end of the existing file instead of overwriting' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a workspace file (6000 chars per call). For large files pass offset (characters) to read further segments, e.g. offset:6000.', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number', description: 'character offset for reading large files in segments' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'edit_file', description: 'Edit an existing workspace file by exact string replacement (like the filesystem edit server). Fails unless oldString is unique unless replaceAll is set. Prefer this over rewriting whole files for small changes.', parameters: { type: 'object', properties: { path: { type: 'string' }, oldString: { type: 'string' }, newString: { type: 'string' }, replaceAll: { type: 'boolean' } }, required: ['path', 'oldString', 'newString'] } } },
    { type: 'function', function: { name: 'create_directory', description: 'Create a directory in the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List a workspace folder.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'defaults to workspace root' } } } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a workspace file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'todo_write', description: 'Plan and track your work: write the ordered steps for the current task BEFORE starting (analyze → implement → verify), and mark steps done as you complete them. The user sees this list live. Rewrite the whole list each call.', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { t: { type: 'string' }, done: { type: 'boolean' } }, required: ['t'] } } }, required: ['items'] } } },
    { type: 'function', function: { name: 'workspace_search', description: 'Fast recursive search over the workspace (ripgrep-style): exact text or regex, optional glob filter, skips node_modules/dist/binaries, returns file:line matches (bounded). Use this instead of reading whole files when locating code.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, isRegex: { type: 'boolean' }, glob: { type: 'string', description: 'path substring filter, e.g. ".js"' }, dir: { type: 'string' }, maxResults: { type: 'number' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'code_symbols', description: 'Structural outline of a code file: functions, classes, imports, exports with line numbers (tree-sitter-style symbol extraction for js/ts/py/css and similar). Use to navigate a file and find the right spot before editing.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'load_skill', description: 'Activate a skill by name: loads its full instructions into context for this session. Call it whenever the task matches an available skill (e.g. the user asks to build/publish a webpage — load the relevant skill first).', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
    { type: 'function', function: { name: 'run_server', description: 'Register a dev server you started with shell_exec so the user can open/monitor/stop it. Start it detached FIRST, e.g. shell_exec: "nohup python3 -m http.server 8080 >> .reva-servers/8080.log 2>&1 & echo PID=$!" (note: cd into the project dir first), then call run_server with the port and pid from the output. Args: name, port, pid (from $!), command, dir, logFile.', parameters: { type: 'object', properties: { name: { type: 'string' }, port: { type: 'number' }, pid: { type: 'number' }, command: { type: 'string', description: 'the full command you launched' }, dir: { type: 'string' }, logFile: { type: 'string' } }, required: ['port'] } } },
    { type: 'function', function: { name: 'server_log', description: 'Read the recent log output of a registered server (tail). Args: port, lines (default 40).', parameters: { type: 'object', properties: { port: { type: 'number' }, lines: { type: 'number' } }, required: ['port'] } } },
    { type: 'function', function: { name: 'stop_server', description: 'Stop a registered server by port or name and mark it stopped. Use when the work is done or the user asks to stop the preview.', parameters: { type: 'object', properties: { port: { type: 'number' }, name: { type: 'string' } } } } },
    { type: 'function', function: { name: 'memory_search', description: 'Search saved memories by relevance before relying on context. Returns the top matching memories.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'delete_memory', description: 'Delete a saved memory by title (or unique title fragment) — use when the user asks to forget something or a memory is outdated.', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
    { type: 'function', function: { name: 'save_memory', description: 'Persist something the user wants remembered across sessions. tag: user | feedback | project | reference. Saving with an existing title UPDATES that memory instead of duplicating.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'file-style name, e.g. deploy-notes.md' }, body: { type: 'string' }, tag: { type: 'string' } }, required: ['title', 'body'] } } },
    { type: 'function', function: { name: 'run_command', description: 'Run a harness console command. Available: ls [path], tree, cat <file>, rm <file>, mkdir <dir>, mv <a> <b>, echo <text>, wc <file>, grep <pat> <file>, date, model, memories, status, help.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'web_search', description: 'Search the live web. Returns result links with titles plus a snippet digest. Use for current events, docs, APIs, anything you are unsure about or that may have changed.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'web_read', description: 'Fetch and read a web page as clean text (markdown). Use after web_search to study a promising result, or for any URL the user gives you.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'shell_exec', description: 'Run a REAL shell command on the device (Android app builds). Returns combined stdout+stderr and the true exit code; the working directory persists across calls within the session. Use it to build, test, inspect processes, and verify work. A nonzero exit means failure — read the output and react. Long output is truncated to 64KB.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'working directory for this command (absolute or relative to the session cwd)' }, timeout_seconds: { type: 'number', description: 'default 120' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'browser_open', description: 'Open a URL in the built-in browser overlay (user-visible). Returns immediately after navigation starts; pair with browser_read for the page text.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'browser_read', description: 'Read a web page as clean markdown AND open it in the built-in browser so the user can see it. Best way to show a page to the user while studying it.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'image_gen', description: 'Generate an image from a text prompt (FLUX via NVIDIA, hosted). The PNG is saved into the workspace (default images/<ts>.png) and shows up in Files and chat. Use when the user asks for a picture, illustration, logo or visual.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, path: { type: 'string', description: 'optional workspace path, e.g. images/logo.png' } }, required: ['prompt'] } } }
  ];

  /* ---------- harness console (user terminal + run_command) ---------- */
  var Console = {
    HELP: 'commands: ls [path] · tree · cat <file> · rm <file> · mkdir <dir> · mv <a> <b> · echo <text> · wc <file> · grep <pat> <file> · date · model · memories · status · clear · help',
    exec: function (line) {
      line = String(line || '').trim();
      var parts = line.split(/\s+/);
      var cmd = (parts[0] || '').toLowerCase();
      var arg = parts.slice(1).join(' ');
      var out;
      try {
        if (cmd === 'help' || !cmd) out = Console.HELP;
        else if (cmd === 'ls') out = IMPL.list_files({ path: arg || 'workspace' });
        else if (cmd === 'tree') {
          var lines = [];
          Object.keys(WS().vfs).sort().forEach(function (p) {
            lines.push(p + '/');
            (WS().vfs[p] || []).forEach(function (e) { lines.push('  ' + e.n + (e.t === 'dir' ? '/' : '')); });
          });
          out = lines.join('\n') || '(empty)';
        }
        else if (cmd === 'cat') out = IMPL.read_file({ path: arg });
        else if (cmd === 'rm') out = IMPL.delete_file({ path: arg });
        else if (cmd === 'mkdir') { ensureDirs(normPath(arg)); Store.save(); out = 'Created ' + normPath(arg); }
        else if (cmd === 'mv') {
          var a = normPath((arg.split(/\s+/)[0] || ''));
          var b = normPath((arg.split(/\s+/)[1] || ''));
          var src = WS().vfsContent[a];
          if (src === undefined) out = 'Error: no such file: ' + a;
          else { IMPL.write_file({ path: b, content: src }); IMPL.delete_file({ path: a }); out = 'Moved ' + a + ' → ' + b; }
        }
        else if (cmd === 'echo') out = arg;
        else if (cmd === 'wc') {
          var c = WS().vfsContent[normPath(arg)];
          if (c === undefined) out = 'Error: no such file: ' + arg;
          else { c = String(c); out = c.split('\n').length + ' lines · ' + (c.match(/\S+/g) || []).length + ' words · ' + c.length + ' chars'; }
        }
        else if (cmd === 'grep') {
          var pat = arg.split(/\s+/)[0] || '';
          var f = normPath(arg.split(/\s+/).slice(1).join(' '));
          var body = WS().vfsContent[f];
          if (body === undefined) out = 'Error: no such file: ' + f;
          else {
            var hits = String(body).split('\n').map(function (l, n) { return l.toLowerCase().indexOf(pat.toLowerCase()) >= 0 ? (n + 1) + ': ' + l.trim().slice(0, 90) : null; }).filter(Boolean);
            out = hits.length ? hits.join('\n') : '(no matches)';
          }
        }
        else if (cmd === 'date') out = new Date().toLocaleString();
        else if (cmd === 'model') out = Store.db.settings.model + ' · ' + Store.activeProvider().name;
        else if (cmd === 'memories') out = Store.db.memories.length ? Store.db.memories.map(function (m) { return m.tag + ' · ' + m.title; }).join('\n') : '(none)';
        else if (cmd === 'servers') out = (Store.db.servers || []).length ? Store.db.servers.map(function (v) { return (v.status === 'running' ? 'RUN ' : 'stop') + ' :' + v.port + ' · ' + v.name + (v.cmd ? ' · ' + v.cmd : ''); }).join('\n') : '(no servers registered)';
        else if (cmd === 'status') out = 'provider ' + Store.activeProvider().name + ' · model ' + Store.db.settings.model + ' · tools ' + (Store.db.settings.tools !== false ? 'on' : 'off') + ' · mode ' + Store.db.settings.mode + ' · effort ' + Store.db.settings.effort;
        else if (cmd === 'clear') return { out: '', clear: true };
        else out = 'Unknown command: ' + cmd + '\n' + Console.HELP;
      } catch (e) { out = 'Error: ' + e.message; }
      return { out: out };
    }
  };

  var Tools = {
    schemas: SCHEMAS,
    brief: brief,
    exists: function (path) {
      try { var s = WS(); return s.vfsContent[normPath(path)] !== undefined; } catch (e) { return false; }
    },
    run: function (name, args) {
      args = args || {};
      var fn = IMPL[name];
      if (!fn) return 'Error: unknown tool ' + name;
      try { return fn(args); } catch (e) { return 'Error: ' + e.message; }
    }
  };

  window.Tools = Tools;
  window.Console = Console;
})();
