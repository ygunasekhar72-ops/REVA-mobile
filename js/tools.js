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
  function matchCore(text, oldStr, newStr, a) {
    var count = text.split(oldStr).length - 1;
    if (count === 0) {
      /* L2b recovery ladder delegated to LoopCore (pure, unit-tested):
         whitespace-normalized tier, then confident-unique fuzzy tier.
         Missing LoopCore → the honest error path below. */
      if (window.LoopCore) {
        var lad = LoopCore.editLadder(text, oldStr, newStr);
        if (lad) return { updated: lad.updated, count: 1, recovery: lad.recovery };
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
    var mounts = ((sess && sess.mounts) || []).slice();
    /* folder chats: the chat's own Library project is implicitly mounted */
    if (sess && sess.libId) {
      var own = Store.lib.get(sess.libId);
      if (own) {
        var oslug = String(own.name).toLowerCase().split('\\').join('-').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
        mounts = mounts.filter(function (x) { return x.slug !== oslug; });
        mounts.unshift({ libId: sess.libId, slug: oslug, name: own.name, implicit: true });
      }
    }
    var mount = mounts.filter(function (x) { return x.slug === m[1]; })[0];
    if (!mount) return { missing: 'no mounted library "lib/' + m[1] + '/" — open this chat from its project folder, or mount one from Files → Project Library' };
    var project = Store.lib.get(mount.libId);
    if (!project) return { missing: 'the mounted library "' + mount.name + '" no longer exists' };
    return { mount: mount, project: project, rel: m[2] || '', full: p };
  }
  function libSuggest(project, rel) {
    var keys = Object.keys(project.files || {}).filter(function (k) { return k.indexOf(rel) >= 0 || rel.indexOf(k) >= 0; }).slice(0, 4);
    return keys.length ? ' — did you mean: ' + keys.join(', ') + '?' : '';
  }
  /* readLike: one reader for file-arg utility tools — Library mounts first,
     then the chat workspace. Returns {src, label} or {err}. */
  function readLike(path) {
    var L = libCtx(path);
    if (L) {
      if (L.missing) return { err: 'Error: ' + L.missing };
      if (L.rel === '' || L.project.files[L.rel] === undefined) return { err: 'Error: no such file: ' + L.full + libSuggest(L.project, L.rel) };
      return { src: String(L.project.files[L.rel]), label: L.full };
    }
    var s = WS();
    var p = normPath(path || '');
    if (s.vfsContent[p] === undefined) return { err: 'Error: no such file: ' + p + libSuggest({ files: s.vfsContent }, p) };
    return { src: String(s.vfsContent[p]), label: p };
  }
  /* initTemplates: real starter files per project kind — every scaffold is a
     working entry point, not lorem ipsum (the agent builds out from these). */
  function initTemplates() {
    return {
      static: function (name) {
        return {
          'index.html': '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + name + '</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<main>\n  <h1>' + name + '</h1>\n  <p>Scaffolded by REVA — build from here.</p>\n</main>\n<script src="app.js"></script>\n</body>\n</html>',
          'style.css': ':root { color-scheme: dark; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d10; color: #e9e9f0; font-family: system-ui, sans-serif; }\nmain { text-align: center; padding: 2rem; }',
          'app.js': "document.querySelector('h1').addEventListener('click', function () {\n  document.title = '" + name + " — alive';\n});"
        };
      },
      game: function (name) {
        return {
          'index.html': '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">\n<title>' + name + '</title>\n<style>html,body{margin:0;height:100%;background:#0d0d10;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>\n</head>\n<body>\n<canvas id="game"></canvas>\n<script src="game.js"></script>\n</body>\n</html>',
          'game.js': "/* " + name + " — scaffolded game loop (REVA) */\nvar cv = document.getElementById('game'), ctx = cv.getContext('2d');\nvar W, H;\nfunction resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }\naddEventListener('resize', resize); resize();\nvar player = { x: W / 2, y: H / 2, r: 18, speed: 220 };\nvar keys = {};\naddEventListener('keydown', function (e) { keys[e.key] = true; });\naddEventListener('keyup', function (e) { keys[e.key] = false; });\nvar last = performance.now();\nfunction tick(now) {\n  var dt = Math.min(0.05, (now - last) / 1000); last = now;\n  if (keys.ArrowLeft || keys.a) player.x -= player.speed * dt;\n  if (keys.ArrowRight || keys.d) player.x += player.speed * dt;\n  if (keys.ArrowUp || keys.w) player.y -= player.speed * dt;\n  if (keys.ArrowDown || keys.s) player.y += player.speed * dt;\n  ctx.fillStyle = '#0d0d10'; ctx.fillRect(0, 0, W, H);\n  ctx.fillStyle = '#7c5cff'; ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, 7); ctx.fill();\n  requestAnimationFrame(tick);\n}\nrequestAnimationFrame(tick);"
        };
      },
      node: function () {
        return {
          'package.json': '{\n  "name": "app",\n  "version": "1.0.0",\n  "private": true,\n  "main": "index.js"\n}\n',
          'index.js': "// scaffolded node script (REVA)\nconsole.log('running on node', process.version);\n\nconst args = process.argv.slice(2);\nif (args.length) console.log('args:', args);\n"
        };
      },
      python: function () {
        return {
          'main.py': "# scaffolded python script (REVA)\nimport sys\n\ndef main():\n    args = sys.argv[1:]\n    print('running on python', sys.version.split()[0])\n    if args:\n        print('args:', args)\n\nif __name__ == '__main__':\n    main()\n",
          'requirements.txt': ''
        };
      }
    };
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

  /* ============================================================
     TOOLS V2 — perception & safety: run_check (build → run → read the
     console → see the screenshot stats), screenshot, fetch_asset,
     checkpoint/rollback. These give the agent a self-verification loop:
     it can SEE what it built and fix it without the user pasting errors.
     ============================================================ */
  function mulberry32Tools(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function buildRunnableHtml(files, entry, hookConsole, hookAuto) {
    var html = String(files[entry] == null ? '' : files[entry]);
    var dir = entry.indexOf('/') >= 0 ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
    var payload = JSON.stringify({ files: files, dir: dir }).split('</scr' + 'ipt').join('<\\/scr' + 'ipt');
    var hook = hookConsole ? '<scr' + 'ipt>(function(){var logs=[];["log","warn","error","info"].forEach(function(m){var o=console[m]?console[m].bind(console):function(){};console[m]=function(){try{var a=[].slice.call(arguments).map(function(x){return typeof x==="object"?JSON.stringify(x).slice(0,200):String(x)}).join(" ");logs.push({lvl:m,t:a.slice(0,300)})}catch(e){}o.apply(null,arguments)}});window.addEventListener("error",function(e){logs.push({lvl:"error",t:"Uncaught: "+(e.message||"error")+(e.lineno?" @line "+e.lineno:"")})});window.addEventListener("unhandledrejection",function(e){logs.push({lvl:"error",t:"Unhandled rejection: "+String(e.reason).slice(0,200)})});window.__revaLogs=logs;window.__revaCapture=function(){var out=[];Array.prototype.slice.call(document.querySelectorAll("canvas")).forEach(function(c,i){try{out.push({i:i,w:c.width,h:c.height,url:c.toDataURL("image/png")})}catch(e){out.push({i:i,err:String(e.message||e)})}});return out};})();</scr' + 'ipt>' : '';
    hook += hookAuto ? '<scr' + 'ipt>window.addEventListener("message",function(e){var d=e.data;if(!d||!d.__revaAuto)return;var r={id:d.id};try{var el=d.sel?document.querySelector(d.sel):null;if(d.cmd==="click"){if(!el)throw new Error("no element: "+d.sel);try{el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))}catch(pe){}try{el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}))}catch(pe2){}el.click();r.ok=true}else if(d.cmd==="fill"){if(!el)throw new Error("no element: "+d.sel);el.focus();el.value=d.value;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));r.ok=true}else if(d.cmd==="read"){r.value=el?(el.value!==undefined&&el.value!==""?el.value:el.textContent):null;r.ok=true}else if(d.cmd==="exists"){r.ok=!!el}else{r.err="unknown cmd: "+d.cmd}}catch(err){r.err=String(err&&err.message||err)}try{e.source.postMessage({__revaAutoResult:r},"*")}catch(e2){}});</scr' + 'ipt>' : '';
    var resolver = '<scr' + 'ipt>(function(){var F=' + payload + ';' +
      'function key(u){return (F.dir+String(u||"").split("?")[0].split("#")[0]);}' +
      'document.addEventListener("DOMContentLoaded",function(){' +
      'Array.prototype.slice.call(document.querySelectorAll("link[href]")).forEach(function(l){var k=key(l.getAttribute("href"));if(F.files[k]===undefined)return;var st=document.createElement("style");st.textContent=F.files[k];l.parentNode.replaceChild(st,l);});' +
      'Array.prototype.slice.call(document.querySelectorAll("script[src]")).forEach(function(sc){var k=key(sc.getAttribute("src"));if(F.files[k]===undefined)return;var ns=document.createElement("script");ns.textContent=F.files[k];sc.parentNode.replaceChild(ns,sc);});' +
      'Array.prototype.slice.call(document.querySelectorAll("img[src]")).forEach(function(im){var k=key(im.getAttribute("src"));if(F.files[k]!==undefined)im.setAttribute("src",F.files[k]);});' +
      '});})();</scr' + 'ipt>';
    var head = hook + resolver;
    if (html.indexOf('<head>') >= 0) html = html.split('<head>').join('<head>' + head);
    else html = head + html;
    /* three.js projects import the harness's vendored copy (offline, no CDN) */
    return window.LoopCore ? LoopCore.injectThreeMap(html) : html;
  }

  function pixelStats(dataUrl) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = 96; c.height = 64;
          var cx = c.getContext('2d');
          cx.drawImage(img, 0, 0, 96, 64);
          var d = cx.getImageData(0, 0, 96, 64).data;
          var blank = 0, total = d.length / 4, colors = {};
          for (var i = 0; i < d.length; i += 4) {
            var r = d[i], g = d[i + 1], b = d[i + 2];
            if ((r > 244 && g > 244 && b > 244) || (r < 12 && g < 12 && b < 12)) blank++;
            var key = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
            colors[key] = (colors[key] || 0) + 1;
          }
          var top = Object.keys(colors).sort(function (a, b) { return colors[b] - colors[a]; }).slice(0, 3)
            .map(function (k) { var v = k.split(','); return 'rgb(' + (v[0] * 32) + ',' + (v[1] * 32) + ',' + (v[2] * 32) + ') ' + Math.round(colors[k] / total * 100) + '%'; });
          res({ w: img.naturalWidth, h: img.naturalHeight, nonBlankPct: Math.round((total - blank) / total * 100), topColors: top });
        } catch (e) { res({ err: e.message }); }
      };
      img.onerror = function () { res({ err: 'image load failed' }); };
      img.src = dataUrl;
    });
  }

  function resolveFilesFor(a) {
    var L = libCtx(a.path);
    if (L) {
      if (L.missing) return { err: 'Error: ' + L.missing };
      var entryL = L.rel || Object.keys(L.project.files || {}).filter(function (f) { return /(^|\/)index\.html?$/i.test(f); })[0] || Object.keys(L.project.files || {}).filter(function (f) { return /\.html?$/i.test(f); })[0];
      if (!entryL || L.project.files[entryL] === undefined) return { err: 'Error: no HTML entry in "' + L.project.name + '" — write an index.html first' };
      return { files: L.project.files, entry: entryL, label: 'lib/' + L.mount.slug + '/' + entryL, project: L.project };
    }
    var s = WS();
    var p = normPath(a.path || 'workspace/index.html');
    if (s.vfsContent[p] === undefined || !/\.html?$/i.test(p)) {
      var cand = Object.keys(s.vfsContent).filter(function (k) { return k.indexOf(p) === 0 && /\.html?$/i.test(k); }).sort()[0];
      if (!cand) return { err: 'Error: no HTML entry at ' + p + ' — write an index.html first' };
      p = cand;
    }
    return { files: s.vfsContent, entry: p, label: p };
  }

  function hiddenRun(html, seconds) {
    return new Promise(function (res) {
      var frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1024px;height:700px;';
      frame.setAttribute('srcdoc', html);
      document.body.appendChild(frame);
      setTimeout(function () {
        var logs = [], caps = [];
        try {
          var w = frame.contentWindow;
          if (w && w.__revaLogs) logs = w.__revaLogs;
          if (w && w.__revaCapture) caps = w.__revaCapture();
        } catch (e) { caps = [{ err: e.message }]; }
        frame.remove();
        res({ logs: logs, caps: caps });
      }, Math.max(1, seconds) * 1000);
    });
  }

  function hiddenRunWithActions(html, actions, seconds) {
    return new Promise(function (res) {
      var frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1024px;height:700px;';
      frame.setAttribute('srcdoc', html);
      document.body.appendChild(frame);
      var logs = [], results = [];
      var onMsg = function (e) {
        var d = e.data;
        if (d && d.__revaLogs) logs = d.__revaLogs;
        if (d && d.__revaAutoResult) results.push(d.__revaAutoResult);
      };
      window.addEventListener('message', onMsg);
      function finish() {
        var caps = [];
        try {
          var w = frame.contentWindow;
          if (w && w.__revaCapture) caps = w.__revaCapture();
          if (w && w.__revaLogs) logs = w.__revaLogs;
        } catch (e) { caps = [{ err: e.message }]; }
        window.removeEventListener('message', onMsg);
        frame.remove();
        res({ logs: logs, results: results, caps: caps });
      }
      var step = function (i) {
        if (i >= actions.length) { setTimeout(finish, 500); return; }
        var cmd = actions[i];
        cmd.id = 'act' + i; cmd.__revaAuto = 1;
        var to = setTimeout(function () { step(i + 1); }, 2500);
        var onRes = function (e) {
          var d = e.data;
          if (d && d.__revaAutoResult && d.__revaAutoResult.id === cmd.id) {
            window.removeEventListener('message', onRes);
            clearTimeout(to);
            setTimeout(function () { step(i + 1); }, 300);
          }
        };
        window.addEventListener('message', onRes);
        try { frame.contentWindow.postMessage(cmd, '*'); } catch (e) { clearTimeout(to); step(i + 1); }
      };
      setTimeout(function () { step(0); }, 400);
      setTimeout(function () { finish(); }, Math.max(4, seconds) * 1000);
    });
  }
  /* 16-bit PCM WAV encoder: Float32 samples -> data:audio/wav URL */
  function wavDataUrl(samples, sampleRate) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function str(off, txt) { for (var i = 0; i < txt.length; i++) v.setUint8(off + i, txt.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var j = 0; j < bytes.length; j += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 8192));
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function rebuildTables(s) {
    s.vfs = { workspace: [] };
    Object.keys(s.vfsContent).forEach(function (k) {
      var v = s.vfsContent[k];
      if (!v) return;
      var isImg = /^data:image\//.test(v);
      ensureDirs(parentOf(k) || 'workspace');
      var dir = parentOf(k) || 'workspace';
      var list = s.vfs[dir] || (s.vfs[dir] = []);
      var name = baseOf(k);
      if (!list.some(function (e) { return e.n === name; })) list.push({ n: name, t: isImg ? 'img' : (/\.(md|txt)$/.test(name) ? 'doc' : 'code'), s: fmtSize(v.length) });
    });
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
        return 'Edited ' + Le.full + ' (' + coreL.count + (a.replaceAll ? ' replacement(s)' : ' replacement') + ') — file now ' + coreL.updated.split('\n').length + ' lines' + (coreL.recovery ? ' [recovered: ' + coreL.recovery + ' — verify the region]' : '');
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
      return 'Edited ' + path + ' (' + core.count + (a.replaceAll ? ' replacement(s)' : ' replacement') + ') — file now ' + updated.split('\n').length + ' lines' + (core.recovery ? ' [recovered: ' + core.recovery + ' — verify the region]' : '');
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
      // text, glob filter, ignore rules, bounded results with line numbers.
      // ON-DEVICE FAST PATH: mounted Library projects are REAL files on disk
      // (/host/library/<slug>/) — search them with the bundled ripgrep via
      // the agent shell; any failure falls back to the JS scan below.
      var pat0 = String(a.pattern || '');
      if (!pat0) return 'Error: pattern required';
      var rgFast = (window.REVAAgent && window.AgentExec && window.LoopCore) ? rgFastSearch(a, pat0) : null;
      if (rgFast) return rgFast;
      return jsSearch(a, pat0);

      function rgFastSearch(a, pat) {
        var Ls = libCtx(String(a.dir || a.path || 'lib/'));
        if (!Ls || Ls.missing) return null; // not a lib target → JS path
        var slug = Ls.mount.slug;
        var argv = LoopCore.rgArgs(pat, '/host/library/' + slug, { glob: a.glob, isRegex: a.isRegex });
        var max = Math.min(+a.maxResults || 60, 200);
        return AgentExec.execArgs(argv, { timeoutMs: 30000 }).then(function (ex) {
          if (ex.exit === 127 || String(ex.out || '').indexOf('not found') >= 0) { rgFastSearch = null; return jsSearch(a, pat); }
          if (ex.timedOut || (ex.exit !== 0 && ex.exit !== 1)) return jsSearch(a, pat);
          var r = LoopCore.parseRg(ex.out, max);
          var hits = r.hits.map(function (h) {
            return h.path.replace('/host/library/' + slug, 'lib/' + slug) + ':' + h.line + ': ' + h.text.trim();
          });
          if (!hits.length) return 'No matches for "' + pat + '" in lib/' + slug + ' (ripgrep, real files on disk).';
          var note = r.total > hits.length ? '\n… ' + (r.total - hits.length) + ' more not shown (bounded at ' + max + ').' : '';
          return hits.join('\n') + '\n' + r.total + ' match(es) — ripgrep over lib/' + slug + ' (disk-fast).' + note;
        }).catch(function () { return jsSearch(a, pat); });
      }

      function jsSearch(a, pat) {
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
      }
    },
    code_symbols: function (a) {
      /* regex outline — the always-available fallback (also the path for
         languages without a grammar) */
      function regexOutline() {
        // structural outline: functions, classes, imports, exports with
        // line numbers — enough to navigate before editing
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
      }
      // AST-FIRST: real tree-sitter syntax trees for 19 languages when the
      // engine is available; every failure falls back to the outline above.
      var tsExt = (String(a.path || '').split('.').pop() || '').toLowerCase();
      if (!window.REVATS || !REVATS.extLang(tsExt)) return regexOutline();
      var tsSrc = null, tsLabel = '';
      var Ts = libCtx(a.path);
      if (Ts && !Ts.missing && Ts.rel !== '') {
        var tbody = Ts.project.files[Ts.rel];
        if (tbody !== undefined && String(tbody).indexOf('data:') !== 0) { tsSrc = String(tbody); tsLabel = Ts.full; }
      } else if (!Ts) {
        var tsPath = normPath(a.path || '');
        var tsBody = WS().vfsContent[tsPath];
        if (tsBody !== undefined) { tsSrc = String(tsBody); tsLabel = tsPath; }
      }
      if (tsSrc === null) return regexOutline();
      return REVATS.symbolsFor(tsExt, tsSrc).then(function (r) {
        if (!r || !r.symbols.length) return regexOutline();
        return 'SYMBOLS — ' + tsLabel + '  [tree-sitter AST · ' + r.lang + ']\n' +
          r.symbols.map(function (x) { return '  L' + x.line + '  ' + x.kind + '  ' + x.name; }).join('\n') +
          '\n  ' + r.symbols.length + ' symbols (real syntax tree — navigable, line-accurate)';
      });
    },
    /* ---------- Tools v2: perception & safety ---------- */
    run_check: async function (a) {
      var rf = resolveFilesFor(a);
      if (rf.err) return rf.err;
      var secs = Math.min(10, Math.max(1, parseInt(a.seconds, 10) || 3));
      var run = await hiddenRun(buildRunnableHtml(rf.files, rf.entry, true), secs);
      var errors = run.logs.filter(function (l) { return l.lvl === 'error'; });
      var warns = run.logs.filter(function (l) { return l.lvl === 'warn'; });
      var shots = [];
      for (var i = 0; i < run.caps.length && i < 3; i++) {
        if (run.caps[i].url && !run.caps[i].err) shots.push(await pixelStats(run.caps[i].url));
        else if (run.caps[i].err) shots.push({ err: run.caps[i].err });
      }
      var saved = '';
      var best = run.caps.filter(function (c) { return c.url && !c.err; })[0];
      if (best) {
        var s2 = WS();
        var pngPath = 'workspace/screenshots/' + Date.now() + '.png';
        s2.vfsContent[pngPath] = best.url;
        ensureDirs('workspace/screenshots');
        var list = s2.vfs['workspace/screenshots'] || (s2.vfs['workspace/screenshots'] = []);
        var nm = baseOf(pngPath);
        if (!list.some(function (e) { return e.n === nm; })) list.push({ n: nm, t: 'img', s: fmtSize(best.url.length) });
        Store.save();
        saved = ' Screenshot saved to ' + pngPath + ' (view it in Files).';
      }
      var out = 'RUN CHECK — ' + rf.label + '\n' +
        'Console: ' + (run.logs.length ? run.logs.length + ' entries' : 'clean (no output)') +
        (errors.length ? ' — ' + errors.length + ' ERROR(S):' : '') + '\n' +
        errors.slice(0, 6).map(function (l) { return '  [error] ' + l.t; }).join('\n') +
        (warns.length ? '\n  warnings: ' + warns.slice(0, 3).map(function (l) { return l.t; }).join(' | ') : '') + '\n' +
        'Visual: ' + (shots.length ? shots.map(function (s3, i2) {
          return s3.err ? 'canvas ' + i2 + ': capture failed (' + s3.err + ')' :
            'canvas ' + i2 + ' ' + s3.w + 'x' + s3.h + ' — non-blank ' + s3.nonBlankPct + '%, top colors: ' + s3.topColors.join(', ');
        }).join('; ') : 'no canvas found (static page or nothing rendered)') +
        '\n' + (errors.length ? 'FIX the errors above, then run_check again — report done only when the console is clean.' : 'Console is clean. Check the screenshot stats match what the user asked for.') + saved;
      return out;
    },
    screenshot: async function (a) {
      /* capture the live built-in browser if it has canvases; otherwise render args.path hidden */
      var f = document.getElementById('wbFrame');
      var caps = [];
      try {
        if (f && f.contentWindow && f.contentWindow.__revaCapture) caps = f.contentWindow.__revaCapture();
      } catch (e) { }
      if (!caps.length && a && a.path) {
        var rf = resolveFilesFor(a);
        if (rf.err) return rf.err;
        var run = await hiddenRun(buildRunnableHtml(rf.files, rf.entry, true), 2);
        caps = run.caps;
      }
      if (!caps.length) return 'Error: nothing to capture — open a preview in the built-in browser, or pass path (an html file in the workspace or a mounted library)';
      var stats = [];
      var saved = '';
      var best = caps.filter(function (c) { return c.url && !c.err; })[0];
      for (var i = 0; i < caps.length && i < 3; i++) {
        if (caps[i].url && !caps[i].err) stats.push(await pixelStats(caps[i].url));
        else if (caps[i].err) stats.push({ err: caps[i].err });
      }
      if (best) {
        var s2 = WS();
        var pngPath = 'workspace/screenshots/' + Date.now() + '.png';
        s2.vfsContent[pngPath] = best.url;
        ensureDirs('workspace/screenshots');
        var list = s2.vfs['workspace/screenshots'] || (s2.vfs['workspace/screenshots'] = []);
        var nm = baseOf(pngPath);
        if (!list.some(function (e) { return e.n === nm; })) list.push({ n: nm, t: 'img', s: fmtSize(best.url.length) });
        Store.save();
        saved = ' Saved to ' + pngPath + '.';
      }
      return 'SCREENSHOT — ' + (stats.length ? stats.map(function (s3, i2) {
        return s3.err ? 'canvas ' + i2 + ': failed (' + s3.err + ')' : 'canvas ' + i2 + ' ' + s3.w + 'x' + s3.h + ', non-blank ' + s3.nonBlankPct + '%, colors: ' + s3.topColors.join(', ');
      }).join('; ') : 'canvas present but returned no pixels') + '.' + saved;
    },
    fetch_asset: async function (a) {
      var url = String(a.url || '').trim();
      var path = String(a.path || '').trim();
      if (!/^https?:\/\//i.test(url)) return 'Error: provide a full http(s) URL';
      if (window.WebSearch && WebSearch.isPrivateTarget(url)) return 'Error: private/loopback addresses are not reachable through fetch_asset';
      if (!path) return 'Error: path required (where to save it, e.g. assets/models/ship.glb)';
      try {
        var resp = await fetch(url);
        if (!resp.ok) return 'Error: HTTP ' + resp.status + ' for ' + url;
        var buf = await resp.arrayBuffer();
        if (buf.byteLength > 8 * 1024 * 1024) return 'Error: asset too large (' + Math.round(buf.byteLength / 1048576) + ' MB) — cap is 8 MB';
        var bytes = new Uint8Array(buf);
        var b64 = ''; var CH = 32768;
        for (var i = 0; i < bytes.length; i += CH) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        var mime = resp.headers.get('content-type') || 'application/octet-stream';
        var dataUrl = 'data:' + mime + ';base64,' + btoa(b64);
        var res = IMPL.write_file({ path: path, content: dataUrl });
        return 'Fetched ' + url + ' → ' + normPath(path) + ' (' + fmtSize(bytes.length) + ', ' + mime + '). ' + res;
      } catch (e) {
        return 'Error: fetch failed (' + String(e.message || e).slice(0, 80) + '). Some CDNs block cross-origin reads — try a CORS-enabled source (github raw, jsdelivr, unpkg).';
      }
    },
    checkpoint: async function (a) {
      var s = WS();
      var count = Object.keys(s.vfsContent || {}).length;
      if (!count) return 'Error: the workspace is empty — nothing to checkpoint';
      var rec = Store.checkpoints.save(s.id, String(a.label || '').trim() || ('checkpoint ' + new Date().toLocaleTimeString()), s.vfsContent);
      return 'Checkpoint "' + rec.label + '" saved (' + rec.fileCount + ' files). Experiment freely — roll back with rollback{label:"' + rec.label + '"}';
    },
    rollback: async function (a) {
      var s = WS();
      var rows = await Store.checkpoints.list(s.id);
      if (!rows.length) return 'Error: no checkpoints saved for this chat yet — save one with checkpoint{label:"..."} first';
      var pick = null;
      if (a.label) pick = rows.filter(function (r) { return r.label === String(a.label); })[0] || rows.filter(function (r) { return r.label.indexOf(String(a.label)) >= 0; })[0];
      if (!pick && !a.label) pick = rows[0];
      if (!pick) return 'Error: no checkpoint matching "' + a.label + '" — saved checkpoints: ' + rows.map(function (r) { return '"' + r.label + '"'; }).join(', ');
      s.vfsContent = pick.files;
      rebuildTables(s);
      Store.save();
      return 'Rolled back to "' + pick.label + '" (' + pick.fileCount + ' files, saved ' + new Date(pick.ts).toLocaleString() + '). The workspace is exactly as it was at that checkpoint.';
    },
    /* ---------- Tools v2.5: functional verification + real assets ---------- */
    interact: async function (a) {
      var rf = resolveFilesFor(a);
      if (rf.err) return rf.err;
      var actions = Array.isArray(a.actions) ? a.actions.slice(0, 24) : [];
      if (!actions.length) return 'Error: actions required — an array like [{"sel":"#btn","cmd":"click"},{"sel":"#amount","cmd":"fill","value":"100"},{"sel":"#total","cmd":"read"}]. Commands: click, fill (value), read (returns text/value), exists.';
      var secs = Math.min(15, Math.max(2, parseInt(a.seconds, 10) || 4));
      var html = buildRunnableHtml(rf.files, rf.entry, true, true);
      var run = await hiddenRunWithActions(html, actions, secs + 2);
      var errors = run.logs.filter(function (l) { return l.lvl === 'error'; });
      var steps = run.results.map(function (r, i) {
        var a2 = actions[i] || {};
        var what = a2.cmd + ' ' + (a2.sel || '');
        if (r.err) return '  step ' + (i + 1) + ' FAILED — ' + what + ': ' + r.err;
        if (a2.cmd === 'read') return '  step ' + (i + 1) + ' — read ' + (a2.sel || '') + ' → ' + String(r.value === undefined ? '(none)' : r.value).slice(0, 120);
        return '  step ' + (i + 1) + ' — ' + a2.cmd + ' ok';
      });
      var shots = [];
      for (var i2 = 0; i2 < run.caps.length && i2 < 2; i2++) {
        if (run.caps[i2].url && !run.caps[i2].err) shots.push(await pixelStats(run.caps[i2].url));
      }
      var saved = '';
      var best = run.caps.filter(function (c) { return c.url && !c.err; })[0];
      if (best) {
        var s2 = WS();
        var pngPath = 'workspace/screenshots/' + Date.now() + '.png';
        s2.vfsContent[pngPath] = best.url;
        ensureDirs('workspace/screenshots');
        var list = s2.vfs['workspace/screenshots'] || (s2.vfs['workspace/screenshots'] = []);
        var nm = baseOf(pngPath);
        if (!list.some(function (e) { return e.n === nm; })) list.push({ n: nm, t: 'img', s: fmtSize(best.url.length) });
        Store.save();
        saved = ' Screenshot after the actions saved to ' + pngPath + '.';
      }
      var failCount = run.results.filter(function (r) { return r.err; }).length;
      var out = 'INTERACT — ' + rf.label + ' (' + actions.length + ' actions)\n' + steps.join('\n') + '\n' +
        'Console during session: ' + (run.logs.length ? run.logs.length + ' entries' + (errors.length ? ' — ' + errors.length + ' ERROR(S): ' + errors.slice(0, 4).map(function (l) { return l.t; }).join(' | ') : '') : 'clean') + '\n' +
        (shots.length ? 'Visual after actions: ' + shots.map(function (s3) { return s3.err ? 'capture failed' : s3.w + 'x' + s3.h + ', non-blank ' + s3.nonBlankPct + '%'; }).join('; ') + '\n' : '') +
        (failCount ? 'FIX the failed steps and interact again — the feature is not working.' : 'All actions succeeded — verify the read values match what the user asked for.') + saved;
      return out;
    },
    sfx: async function (a) {
      var type = String(a.type || 'coin').toLowerCase();
      var known = { jump: 0.28, coin: 0.4, laser: 0.32, explosion: 0.7, powerup: 0.55, blip: 0.14, hit: 0.2, unlock: 0.5 };
      if (!known[type]) return 'Error: unknown sfx type "' + type + '" — use: ' + Object.keys(known).join(', ');
      var dur = parseFloat(a.duration) || known[type];
      var sr = 44100;
      var n = Math.floor(sr * Math.min(3, Math.max(0.05, dur)));
      var data = new Float32Array(n);
      var seed = parseInt(a.seed, 10) || 12345;
      var rng = mulberry32Tools(seed);
      var i, t, ph;
      if (type === 'jump') {
        for (i = 0; i < n; i++) { t = i / n; ph = 2 * Math.PI * (300 + 700 * t * t) * (i / sr); data[i] = Math.sin(ph) * (1 - t) * 0.8; }
      } else if (type === 'coin') {
        for (i = 0; i < n; i++) { t = i / n; var f = t < 0.4 ? 988 : 1319; data[i] = Math.sin(2 * Math.PI * f * i / sr) * (t < 0.4 ? 0.9 : Math.max(0, 1 - (t - 0.4) / 0.6)) * 0.8; }
      } else if (type === 'laser') {
        for (i = 0; i < n; i++) { t = i / n; ph = 2 * Math.PI * (1200 - 1000 * t) * (i / sr); data[i] = (Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.2) * (1 - t); }
      } else if (type === 'explosion') {
        var lastN = 0;
        for (i = 0; i < n; i++) { t = i / n; var white = rng() * 2 - 1; lastN = lastN * 0.82 + white * 0.18; data[i] = lastN * Math.pow(1 - t, 1.6) * 2.2; }
      } else if (type === 'powerup') {
        var steps = [392, 523, 659, 784];
        for (i = 0; i < n; i++) { t = i / n; var si = Math.min(3, Math.floor(t * 4)); data[i] = Math.sin(2 * Math.PI * steps[si] * i / sr) * 0.7 * (0.6 + 0.4 * t); }
      } else if (type === 'hit') {
        for (i = 0; i < n; i++) { t = i / n; data[i] = (rng() * 2 - 1) * Math.pow(1 - t, 3) * 1.5 + Math.sin(2 * Math.PI * 90 * i / sr) * (1 - t) * 0.5; }
      } else if (type === 'unlock') {
        var tones = [523, 659, 784, 1047];
        for (i = 0; i < n; i++) { t = i / n; var tone = tones[Math.min(3, Math.floor(t * 4))]; var env = (t * 4) % 1; data[i] = Math.sin(2 * Math.PI * tone * i / sr) * (1 - env * 0.3) * 0.6; }
      } else { // blip
        for (i = 0; i < n; i++) { data[i] = Math.sin(2 * Math.PI * 880 * i / sr) * Math.pow(1 - i / n, 0.5) * 0.7; }
      }
      for (i = 0; i < n; i++) { data[i] = Math.max(-1, Math.min(1, data[i])); if (i < sr * 0.004) data[i] *= i / (sr * 0.004); }
      var path = String(a.path || 'assets/audio/' + type + '-' + seed + '.wav');
      var wav = wavDataUrl(data, sr);
      var wr = IMPL.write_file({ path: path, content: wav });
      return 'SFX "' + type + '" generated (' + Math.round(dur * 1000) + 'ms, ' + fmtSize(n * 2) + ') → ' + normPath(path) + '\n' + wr + '\nPlay it in the app with: new Audio("' + normPath(path) + '").play() — wire it to the action the user asked for (jump, coin, hit…).';
    },
    optimize_image: async function (a) {
      var p = normPath(a.path || '');
      var s = WS();
      var content = s.vfsContent[p];
      if (content === undefined) return notFound(p);
      if (content.indexOf('data:image') !== 0) return 'Error: ' + p + ' is not an image (expected a data:image/* file)';
      var maxW = Math.min(4096, Math.max(16, parseInt(a.maxWidth, 10) || 1200));
      var fmt = String(a.format || (a.path && /\.png$/i.test(a.path) ? 'image/png' : 'image/jpeg')).toLowerCase();
      var q = Math.min(1, Math.max(0.3, parseFloat(a.quality) || 0.82));
      var meta = await new Promise(function (res) {
        var img = new Image();
        img.onload = function () { res({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = function () { res(null); };
        img.src = content;
      });
      if (!meta) return 'Error: could not decode the image';
      if (meta.w <= maxW && fmt === 'image/png' && content.indexOf('image/png') >= 0) return p + ' is already ' + meta.w + 'px — nothing to optimize';
      var scaled = await new Promise(function (res) {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxW / img.naturalWidth);
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var cx = c.getContext('2d');
          cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL(fmt, q));
        };
        img.onerror = function () { res(null); };
        img.src = content;
      });
      if (!scaled) return 'Error: optimization failed';
      var before = content.length, after = scaled.length;
      s.vfsContent[p] = scaled;
      Store.save();
      return 'Optimized ' + p + ': ' + meta.w + 'x' + meta.h + ' → ' + Math.round(after / 1024) + ' KB (' + fmt.replace('image/', '') + ' q' + Math.round(q * 100) + ')\nSize: ' + fmtSize(before) + ' → ' + fmtSize(after) + ' (' + (after <= before ? '-' : '+') + Math.abs(Math.round((1 - after / before) * 100)) + '%)';
    },
    lint: function (a) {
      var L = libCtx(a.path);
      var src, label;
      if (L) {
        if (L.missing) return 'Error: ' + L.missing;
        if (L.rel === '' || L.project.files[L.rel] === undefined) return 'Error: no such file: ' + L.full + libSuggest(L.project, L.rel);
        src = String(L.project.files[L.rel]); label = L.full;
      } else {
        var s = WS();
        var path = normPath(a.path || '');
        if (s.vfsContent[path] === undefined) return notFound(path);
        src = String(s.vfsContent[path]); label = path;
      }
      var issues = [];
      if (/\.html?$/i.test(label)) {
        var scripts = src.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
        scripts.forEach(function (block, i) {
          var body = block.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '').trim();
          if (!body || /src\s*=/.test(block)) return;
          try { new Function(body); } catch (e) { issues.push('inline script #' + (i + 1) + ': ' + e.message); }
        });
        ['div', 'section', 'main', 'header', 'footer', 'form', 'table', 'ul', 'canvas'].forEach(function (tag) {
          var open = (src.match(new RegExp('<' + tag + '(\\s|>)', 'gi')) || []).length;
          var close = (src.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
          if (open !== close) issues.push('<' + tag + '> opened ' + open + 'x but closed ' + close + 'x');
        });
        var ids = {}, dup = [];
        (src.match(/\sid="[^"]+"/g) || []).forEach(function (m) { var v = m.slice(5); if (ids[v]) dup.push(v); ids[v] = 1; });
        if (dup.length) issues.push('duplicate ids: ' + dup.join(', '));
      } else if (/\.(js|mjs|cjs)$/i.test(label)) {
        if (/^\s*(import[\s{}]|export\s)/m.test(src)) issues.push('module syntax (import/export) — syntax-check skipped for this quick lint');
        else { try { new Function(src); } catch (e) { issues.push('JS syntax: ' + e.message); } }
      } else if (/\.css$/i.test(label)) {
        var open2 = (src.match(/{/g) || []).length, close2 = (src.match(/}/g) || []).length;
        if (open2 !== close2) issues.push('CSS braces unbalanced: ' + open2 + ' open vs ' + close2 + ' close');
      } else issues.push('lint: no rules for this file type');
      return issues.length ? 'LINT — ' + label + '\n' + issues.map(function (x) { return '  ⚠ ' + x; }).join('\n') : 'LINT — ' + label + ': clean';
    },
    test_data: function (a) {
      var kind = String(a.kind || 'users').toLowerCase();
      var count = Math.min(200, Math.max(1, parseInt(a.count, 10) || 10));
      var seed = parseInt(a.seed, 10) || 42;
      var rng = mulberry32Tools(seed);
      var F = ['Alice', 'Bruno', 'Clara', 'Dmitri', 'Elena', 'Farid', 'Gita', 'Hugo', 'Ines', 'Jonas', 'Kira', 'Liam', 'Mona', 'Nadia', 'Omar'];
      var L2 = ['Novak', 'Iversen', 'Okafor', 'Silva', 'Tanaka', 'Weber', 'Rossi', 'Kowal', 'Dubois', 'Haddad'];
      var words = ['aurora', 'basalt', 'cinder', 'delta', 'ember', 'flint', 'grove', 'harbor', 'ion', 'jasper'];
      function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
      var rows = [];
      for (var i = 0; i < count; i++) {
        var first = pick(F), last = pick(L2), n = i + 1;
        if (kind === 'users') rows.push({ id: n, name: first + ' ' + last, email: (first + '.' + last).toLowerCase() + '@example.com', joined: '2026-0' + (1 + Math.floor(rng() * 9)) + '-' + String(1 + Math.floor(rng() * 28)).padStart(2, '0'), active: rng() > 0.3 });
        else if (kind === 'products') rows.push({ id: n, name: pick(words) + ' ' + pick(['pro', 'mini', 'max', 'one', 'xl']), price: Math.round(rng() * 49000) / 100 + 5, stock: Math.floor(rng() * 120), rating: Math.round(rng() * 20) / 10 + 3 });
        else rows.push({ id: n, title: pick(words) + ' ' + pick(['note', 'task', 'report', 'log']), done: rng() > 0.5, created: '2026-10-' + String(1 + Math.floor(rng() * 28)).padStart(2, '0') });
      }
      var path = normPath(a.path || ('workspace/data/' + kind + '.json'));
      var json = JSON.stringify(kind === 'products' ? rows : rows, null, 2);
      var r = IMPL.write_file({ path: path, content: json });
      return 'Generated ' + count + ' realistic ' + kind + ' records (seed ' + seed + ' — deterministic). ' + r;
    },
    pwa_setup: function (a) {
      var L = libCtx(a.path);
      var files, root;
      if (L) {
        if (L.missing) return 'Error: ' + L.missing;
        files = L.project.files; root = L.rel || '';
      } else {
        var s = WS(); files = s.vfsContent; root = 'workspace';
      }
      var entry = Object.keys(files).filter(function (f) { return root === '' ? f === 'index.html' : f.indexOf(root + '/index.html') === 0; })[0] ||
        Object.keys(files).filter(function (f) { return /\.html?$/i.test(f) && (root === '' ? f.indexOf('/') < 0 : f.slice(root.length + 1).indexOf('/') < 0); })[0];
      if (!entry) return 'Error: no index.html at the root — a PWA needs one entry page';
      var name = String(a.name || 'REVA App').slice(0, 40);
      var theme = String(a.theme || '#7c5cff');
      var dir = entry.indexOf('/') >= 0 ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
      function icon(size) {
        var c = document.createElement('canvas');
        c.width = size; c.height = size;
        var cx = c.getContext('2d');
        cx.fillStyle = theme; cx.fillRect(0, 0, size, size);
        cx.fillStyle = '#ffffff'; cx.font = '600 ' + Math.round(size * 0.42) + 'px sans-serif';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(name.charAt(0).toUpperCase(), size / 2, size / 2 + size * 0.03);
        return c.toDataURL('image/png');
      }
      files[dir + 'icon-192.png'] = icon(192);
      files[dir + 'icon-512.png'] = icon(512);
      files[dir + 'manifest.webmanifest'] = JSON.stringify({ name: name, short_name: name.slice(0, 12), start_url: './' + (entry.slice(dir.length) || 'index.html'), display: 'standalone', background_color: '#101014', theme_color: theme, icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2);
      files[dir + 'sw.js'] = 'var C="' + (dir + 'pwa-cache-v1') + '";self.addEventListener("install",function(e){e.waitUntil(caches.open(C).then(function(c2){return c2.addAll(["./"])})).then(function(){return self.skipWaiting()})});self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==C}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});self.addEventListener("fetch",function(e){e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request)}))});';
      var html = String(files[entry]);
      var inject = '<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="' + theme + '">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + '<scr' + 'ipt>if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js");</scr' + 'ipt>';
      if (html.indexOf('<head>') >= 0) html = html.split('<head>').join('<head>\n' + inject);
      else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, function (m0) { return m0 + '\n<head>' + inject + '</head>'; });
      else html = inject + html;
      files[entry] = html;
      if (L && L.project) Store.lib.put(L.project); else { Store.save(); }
      return 'PWA setup complete for "' + name + '" (root: ' + (dir || './') + '):\n  manifest.webmanifest — name, icons 192+512, standalone\n  sw.js — offline cache-first service worker\n  index.html — manifest link + theme-color + SW registration\nInstallable when served over http(s) (run_server). Icons generated from the app name.';
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
    /* ---------- utility batch (toolkit.js engines — batch 1 of the 150-tool ladder) ---------- */
    http_request: async function (a) {
      var url = String(a.url || '');
      if (!/^https?:\/\//i.test(url)) return 'Error: http_request needs an absolute http(s) URL';
      if (window.WebSearch && WebSearch.isPrivateTarget && WebSearch.isPrivateTarget(url)) return 'Error: blocked — private/loopback targets are not reachable from the agent (SSRF guard)';
      var method = String(a.method || 'GET').toUpperCase();
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].indexOf(method) < 0) return 'Error: unsupported method ' + method;
      /* use the FETCH CLIENT (subsystem #6) — retry, timeout, single-flight */
      var client = window.FETCHCLIENT ? FETCHCLIENT.createClient({
        baseUrl: url.replace(/\/[^\/]*$/, ''),
        timeout: 30000,
        retries: 1,
        fetch: typeof fetch !== 'undefined' ? fetch : undefined
      }) : null;
      if (client) {
        var t0 = Date.now();
        var opts = { method: method, headers: a.headers || {}, maxBytes: Math.min(20000, Math.max(500, parseInt(a.maxBytes, 10) || 4000)) };
        if (a.body !== undefined && method !== 'GET' && method !== 'HEAD') opts.body = a.body;
        var result;
        try {
          result = method === 'GET' ? await client.get(url.replace(/\/[^\/]*$/, '').length ? url : url, opts) : await client.request(method, url, opts);
        } catch (e) { return 'Error: ' + (e.message || e); }
        var hs2 = [];
        Object.keys(result.headers || {}).forEach(function (k) { if (/^(content-type|content-length|cache-control|retry-after|location|server|date)$/i.test(k)) hs2.push(k + ': ' + result.headers[k]); });
        var dataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        return 'HTTP ' + result.status + ' (' + (Date.now() - t0) + 'ms)\n' + hs2.join('\n') + '\n\n' + (dataStr || '').slice(0, opts.maxBytes) + ((dataStr || '').length > opts.maxBytes ? '\n… (' + (dataStr || '').length + ' bytes total)' : '');
      }
      /* fallback: raw fetch (when FETCHCLIENT is not available) */
      var headers = {};
      Object.keys(a.headers || {}).forEach(function (k) { headers[String(k).replace(/[^\w-]/g, '')] = String(a.headers[k]).slice(0, 500); });
      var opts2 = { method: method, headers: headers };
      if (a.body !== undefined && method !== 'GET' && method !== 'HEAD') opts2.body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
      var t1 = Date.now();
      var res = await fetch(url, opts2);
      var body = await res.text();
      var cap = Math.min(20000, Math.max(500, parseInt(a.maxBytes, 10) || 4000));
      var hs = [];
      res.headers.forEach(function (v, k) { if (/^(content-type|content-length|cache-control|retry-after|location|server|date)$/i.test(k)) hs.push(k + ': ' + v); });
      return 'HTTP ' + res.status + ' ' + res.statusText + ' (' + (Date.now() - t1) + 'ms)\n' + hs.join('\n') + '\n\n' + body.slice(0, cap) + (body.length > cap ? '\n… (' + body.length + ' bytes total — raise maxBytes up to 20000 to read more)' : '');
    },
    diff_texts: function (a) {
      var A = a.a, B = a.b, nA = a.pathA, nB = a.pathB;
      if (a.fileA !== undefined) { var ra = readLike(a.fileA); if (ra.err) return ra.err; A = ra.src; nA = nA || ra.label; }
      if (a.fileB !== undefined) { var rb = readLike(a.fileB); if (rb.err) return rb.err; B = rb.src; nB = nB || rb.label; }
      if (A === undefined || B === undefined) return 'Error: diff_texts needs a/b text or fileA/fileB paths';
      var patch = window.TOOLKIT.unifiedDiff(String(A), String(B), nA, nB);
      return patch.length > 9000 ? patch.slice(0, 9000) + '\n… (diff truncated)' : patch;
    },
    math_eval: function (a) {
      try {
        var v = window.TOOLKIT.mathEval(a.expression);
        return String(a.expression) + ' = ' + v;
      } catch (e) { return 'Error: ' + e.message + ' — supported: numbers, + - * / % ^, (), functions (sqrt sin cos tan floor ceil round abs min max log pow …), pi/e'; }
    },
    encode_decode: function (a) {
      try {
        var out = window.TOOLKIT.encodeDecode(String(a.op || 'encode'), String(a.scheme || 'base64'), String(a.text == null ? '' : a.text));
        return out.length > 8000 ? out.slice(0, 8000) + '…' : out;
      } catch (e) { return 'Error: ' + e.message; }
    },
    hash_text: async function (a) {
      var algo = String(a.algo || 'SHA-256').toUpperCase().replace('-', '');
      var map = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
      var alg = map[algo] || 'SHA-256';
      try {
        var buf = await crypto.subtle.digest(alg, new TextEncoder().encode(String(a.text == null ? '' : a.text)));
        var hex = Array.prototype.map.call(new Uint8Array(buf), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
        return alg + ': ' + hex;
      } catch (e) { return 'Error: hashing unavailable here (' + e.message + ')'; }
    },
    json_query: function (a) {
      var src;
      if (a.json !== undefined) src = String(a.json);
      else if (a.file !== undefined) { var r = readLike(a.file); if (r.err) return r.err; src = r.src; }
      else return 'Error: json_query needs json (text) or file (path)';
      var data;
      try { data = JSON.parse(src); } catch (e) { return 'Error: invalid JSON — ' + e.message; }
      try {
        var v = window.TOOLKIT.jsonQuery(data, a.path || '.', String(a.op || 'get'));
        return typeof v === 'string' ? v : JSON.stringify(v, null, 2).slice(0, 6000);
      } catch (e) { return 'Error: ' + e.message; }
    },
    csv_parse: function (a) {
      var src;
      if (a.text !== undefined) src = String(a.text);
      else if (a.file !== undefined) { var rc = readLike(a.file); if (rc.err) return rc.err; src = rc.src; }
      else return 'Error: csv_parse needs text or file';
      var parsed = window.TOOLKIT.csvParse(src, a.delimiter);
      if (String(a.output) === 'raw') return JSON.stringify(parsed.raw.slice(0, 60), null, 1).slice(0, 8000);
      if (String(a.output) === 'headers') return parsed.headers.join(', ');
      return JSON.stringify(parsed.rows.slice(0, 60), null, 1).slice(0, 8000) + (parsed.rows.length > 60 ? '\n… (' + parsed.rows.length + ' rows total)' : '');
    },
    todo_scan: function (a) {
      var s = WS(), files = {}, dirs = a.dir ? normPath(a.dir) : null;
      Object.keys(s.vfs).forEach(function (dir) {
        if (dirs && (dir + '/').indexOf(dirs) !== 0 && dir !== dirs) return;
        (s.vfs[dir] || []).forEach(function (f) {
          if (f.t !== 'dir') files[dir + '/' + f.n] = s.vfsContent[dir + '/' + f.n] || '';
        });
      });
      var marks = window.TOOLKIT.todoScan(files);
      if (!marks.length) return 'No TODO/FIXME/HACK/XXX/BUG markers found' + (a.dir ? ' under ' + a.dir : '') + '.';
      return marks.map(function (m) { return m.path + ':' + m.line + ' [' + m.tag + '] ' + m.text.replace(/^\W*(TODO|FIXME|HACK|XXX|BUG)\b[:\s]*/, ''); }).join('\n');
    },
    test_gen: function (a) {
      if (!a || !a.path) return 'Error: path required';
      var r = readLike(a.path);
      if (r.err) return r.err;
      var TF = window.TESTFACTORY;
      if (!TF) return 'Error: test factory engine not loaded';
      var plan = TF.planTests(r.src);
      if (!plan.length) return 'No exportable contract detected in ' + r.label + ' (no module.exports, no exports.x, no top-level function/class declarations). Nothing to scaffold.';
      var rel = a.path.replace(/^workspace\//, '');
      var suite = TF.renderSuite(plan, { relPath: rel, label: rel.split('/').pop().replace(/\.js$/, '') });
      var head = 'Test scaffold for ' + r.label + ' — ' + plan.length + ' contract target(s):\n' +
        plan.map(function (p) { return '- ' + p.name + ' [' + p.kind + ']' + (p.methods && p.methods.length ? ' methods: ' + p.methods.join(', ') : ''); }).join('\n') +
        '\n\nWrite this to tests/ with write_file (adjust the require path if the module lives outside js/), deepen the placeholders into real behavior cases, then run it. The scaffold asserts the CONTRACT (existence/type) — deepening is where proof comes from.\n\n' + suite;
      return head;
    },
    word_count: function (a) {
      var s = WS(), out = [], tot = { lines: 0, words: 0, chars: 0 };
      function tally(label, text) {
        var w = window.TOOLKIT.wcCalc(text);
        tot.lines += w.lines; tot.words += w.words; tot.chars += w.chars;
        out.push(label + ' — ' + w.lines + ' lines, ' + w.words + ' words, ' + w.chars + ' chars');
      }
      if (a.path) {
        var r = readLike(a.path);
        if (r.err) return r.err;
        tally(r.label, r.src);
      } else {
        Object.keys(s.vfs).sort().forEach(function (dir) {
          (s.vfs[dir] || []).forEach(function (f) {
            if (f.t !== 'dir') tally(dir + '/' + f.n, String(s.vfsContent[dir + '/' + f.n] || ''));
          });
        });
      }
      if (!out.length) return 'Error: workspace is empty';
      if (!a.path && out.length > 1) out.push('TOTAL — ' + tot.lines + ' lines, ' + tot.words + ' words, ' + tot.chars + ' chars');
      return out.join('\n');
    },
    init_project: function (a) {
      var kind = String(a.kind || 'static').toLowerCase();
      var name = String(a.name || 'app').replace(/[^\w .-]/g, '').trim().slice(0, 40) || 'app';
      var slug = name.toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
      var base = 'workspace/' + slug;
      var TPL = initTemplates();
      var files = (TPL[kind] || function () { return null; })(name);
      if (!files) return 'Error: unknown kind "' + kind + '" — kinds: static, game, node, python';
      var made = 0;
      Object.keys(files).forEach(function (rel) {
        var r = IMPL.write_file({ path: base + '/' + rel, content: files[rel] });
        if (String(r).indexOf('Error') !== 0) made++;
      });
      return 'Scaffolded "' + name + '" (' + kind + ') — ' + made + ' files under ' + base + '/. Open them with list_files, then build out from these real entry points.';
    },
    format_json: function (a) {
      var r = readLike(a.path);
      if (r.err) return r.err;
      var data;
      try { data = JSON.parse(r.src); } catch (e) { return 'Error: invalid JSON in ' + r.label + ' — ' + e.message; }
      var mode = String(a.mode || 'pretty');
      var out = mode === 'minify' ? JSON.stringify(data) : JSON.stringify(data, null, Math.min(8, Math.max(1, parseInt(a.indent, 10) || 2)));
      var lw = libCtx(a.path);
      if (lw && !lw.missing && lw.rel) { lw.project.files[lw.rel] = out; Store.lib.put(lw.project); }
      else if (!lw) { var s2 = WS(); s2.vfsContent[r.label] = out; Store.save(); }
      return 'Formatted ' + r.label + ' (' + mode + ') — valid JSON, now ' + out.split('\n').length + ' lines, ' + out.length + ' bytes';
    },
    uuid_key: function (a) {
      var rnd = (window.crypto && crypto.getRandomValues)
        ? function () { var u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] / 4294967296; }
        : Math.random;
      var ids = window.TOOLKIT.uuidGen(String(a.kind || 'uuid4'), parseInt(a.count, 10) || 1, rnd);
      return ids.join('\n');
    },
    /* ---------- batch 2 utilities (46 → 58) ---------- */
    html_to_markdown: function (a) {
      var src;
      if (a.html !== undefined) src = String(a.html);
      else if (a.file !== undefined) { var r = readLike(a.file); if (r.err) return r.err; src = r.src; }
      else return 'Error: html_to_markdown needs html (text) or file (path)';
      var md = window.TOOLKIT.htmlToMarkdown(src);
      return md.length > 12000 ? md.slice(0, 12000) + '\n… (truncated)' : (md || '(empty)');
    },
    rss_parse: async function (a) {
      var xml;
      if (a.xml !== undefined) xml = String(a.xml);
      else if (a.url !== undefined) {
        var res = await fetch(String(a.url));
        xml = await res.text();
        if (res.status >= 400) return 'Error: HTTP ' + res.status + ' fetching the feed';
      }
      else return 'Error: rss_parse needs xml (text) or url';
      var f = window.TOOLKIT.rssParse(xml);
      if (!f.items.length) return 'Error: no feed items found — is this an RSS/Atom URL?';
      var lines = [f.title ? 'Feed: ' + f.title + (f.atom ? ' (Atom)' : ' (RSS)') : (f.atom ? 'Atom feed' : 'RSS feed')];
      f.items.forEach(function (it) {
        lines.push('- ' + it.title + (it.link ? '\n  ' + it.link : '') + (it.date ? '\n  ' + it.date : ''));
      });
      return lines.join('\n');
    },
    qr_generate: function (a) {
      var q;
      try { q = window.TOOLKIT.qrMake(String(a.text || ''), a.ecc === 'M' ? 'M' : 'L'); }
      catch (e) { return 'Error: ' + e.message; }
      var out = ''.concat('QR generated — v', q.version, ' (', q.size, 'x', q.size, ' modules), ECC ', q.ecc, ', mask ', q.mask);
      if (a.path) {
        var p = normPath(a.path);
        var w = IMPL.write_file({ path: p, content: q.svg });
        if (String(w).indexOf('Error') === 0) return w;
        out += '\nSaved ' + p + ' (' + Math.round(q.svg.length / 1024) + ' KB SVG) — embed with <img src="' + p + '"> or open it.';
      } else {
        out += '\n' + q.svg.slice(0, 400) + '… (pass path to save the full SVG)';
      }
      return out;
    },
    text_stats: function (a) {
      var src;
      if (a.text !== undefined) src = String(a.text);
      else if (a.file !== undefined) { var r2 = readLike(a.file); if (r2.err) return r2.err; src = r2.src; }
      else return 'Error: text_stats needs text or file';
      var st = window.TOOLKIT.textStats(src);
      return ''.concat(st.words, ' words · ', st.sentences, ' sentences · ', st.chars, ' chars · avg ', st.avgWordsPerSentence, ' words/sentence · Flesch ', st.flesch, ' (~', st.readingMinutes, ' min read)');
    },
    diff_words: function (a) {
      var A = a.a, B = a.b, nA = 'a', nB = 'b';
      if (a.fileA !== undefined) { var ra = readLike(a.fileA); if (ra.err) return ra.err; A = ra.src; nA = a.fileA; }
      if (a.fileB !== undefined) { var rb = readLike(a.fileB); if (rb.err) return rb.err; B = rb.src; nB = a.fileB; }
      if (A === undefined || B === undefined) return 'Error: diff_words needs a/b text or fileA/fileB paths';
      var parts = window.TOOLKIT.diffWords(String(A), String(B));
      var out = [], added = 0, removed = 0;
      parts.forEach(function (p) {
        if (p.v === '+') { added++; out.push('+ ' + p.text.trim().slice(0, 120)); }
        else if (p.v === '-') { removed++; out.push('- ' + p.text.trim().slice(0, 120)); }
      });
      if (!out.length) return 'Identical word-for-word.';
      return ''.concat(nA, ' → ', nB, ': +', added, ' / -', removed, ' word group(s)\n', out.slice(0, 60).join('\n'));
    },
    cron_next: function (a) {
      try {
        var times = window.TOOLKIT.cronNext(String(a.expr || ''), a.from ? Date.parse(a.from) : Date.now(), Math.min(20, Math.max(1, parseInt(a.count, 10) || 3)));
        return ''.concat('Next ', times.length, ' run(s) for "', a.expr, '":\n', times.join('\n'));
      } catch (e) { return 'Error: ' + e.message; }
    },
    csv_generate: function (a) {
      var rows = a.rows;
      if (a.file !== undefined) {
        var rj = readLike(a.file);
        if (rj.err) return rj.err;
        try { rows = JSON.parse(rj.src); } catch (e) { return 'Error: file is not JSON — ' + e.message; }
      }
      if (!Array.isArray(rows) || !rows.length) return 'Error: csv_generate needs rows (array of objects)';
      var csv = window.TOOLKIT.csvGenerate(rows, a.headers);
      if (a.path) {
        var p2 = normPath(a.path);
        var w2 = IMPL.write_file({ path: p2, content: csv });
        if (String(w2).indexOf('Error') === 0) return w2;
        return 'Wrote ' + rows.length + ' rows to ' + p2 + ' (' + csv.length + ' bytes)';
      }
      return csv.length > 8000 ? csv.slice(0, 8000) + '…' : csv;
    },
    json_schema_check: function (a) {
      var data;
      if (a.data !== undefined) data = a.data;
      else if (a.file !== undefined) {
        var rd = readLike(a.file);
        if (rd.err) return rd.err;
        try { data = JSON.parse(rd.src); } catch (e) { return 'Error: file is not JSON — ' + e.message; }
      }
      else return 'Error: json_schema_check needs data or file';
      var errs = window.TOOLKIT.schemaCheck(data, a.schema || {}, '$');
      return errs.length ? 'INVALID — ' + errs.length + ' problem(s):\n- ' + errs.join('\n- ') : 'VALID — matches the schema.';
    },
    color_convert: function (a) {
      try {
        var c = window.TOOLKIT.colorConvert(a.color);
        return ''.concat(c.hex, ' · rgb(', c.rgb.join(', '), ') · hsl(', c.hsl.join(', '), ')',
          '\nContrast: ', c.contrastOnWhite, ':1 on white · ', c.contrastOnBlack, ':1 on black — use ', c.bestTextOn, ' text on this fill (WCAG AA needs 4.5)');
      } catch (e) { return 'Error: ' + e.message; }
    },
    password_gen: function (a) {
      var rnd = (window.crypto && crypto.getRandomValues)
        ? function () { var u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] / 4294967296; }
        : Math.random;
      var n = Math.min(10, Math.max(1, parseInt(a.count, 10) || 1));
      var out = [];
      for (var i = 0; i < n; i++) out.push(window.TOOLKIT.passwordGen(a, rnd));
      return out.join('\n');
    },
    url_parse: function (a) {
      try {
        var u = window.TOOLKIT.urlParse(a.url);
        return ''.concat('origin: ', u.origin, '\npath: ', u.path, '\nquery: ', JSON.stringify(u.query), (u.hash ? '\nhash: ' + u.hash : ''));
      } catch (e) { return 'Error: ' + e.message + ' — url_parse needs an absolute URL'; }
    },
    markdown_toc: function (a) {
      var src;
      if (a.text !== undefined) src = String(a.text);
      else if (a.file !== undefined) { var r3 = readLike(a.file); if (r3.err) return r3.err; src = r3.src; }
      else return 'Error: markdown_toc needs text or file';
      var toc = window.TOOLKIT.markdownToc(src);
      if (!toc.length) return 'No headings found.';
      var lines = toc.map(function (h) {
        var ind = '';
        for (var i = 0; i < h.level - 1; i++) ind += '  ';
        return ind + '- ' + h.text + ' (#' + h.slug + ')';
      });
      return lines.join('\n');
    },
    /* ---------- batch 3 utilities (58 → 70) ---------- */
    markdown_to_html: function (a) {
      var src;
      if (a.text !== undefined) src = String(a.text);
      else if (a.file !== undefined) { var r4 = readLike(a.file); if (r4.err) return r4.err; src = r4.src; }
      else return 'Error: markdown_to_html needs text or file';
      var html = window.TOOLKIT.mdToHtml(src);
      return html.length > 14000 ? html.slice(0, 14000) + '\n… (truncated)' : html;
    },
    csv_stats: function (a) {
      var rows;
      if (a.rows !== undefined) rows = a.rows;
      else if (a.file !== undefined) {
        var r5 = readLike(a.file);
        if (r5.err) return r5.err;
        try { rows = JSON.parse(r5.src); } catch (e) {
          rows = window.TOOLKIT.csvParse(r5.src, a.delimiter).rows;
        }
      }
      else return 'Error: csv_stats needs rows or file';
      if (!Array.isArray(rows) || !rows.length) return 'Error: no rows to aggregate';
      var st = window.TOOLKIT.csvStats(rows, a);
      return JSON.stringify(st, null, 1);
    },
    json_merge: function (a) {
      var A = a.a, B = a.b;
      if (a.fileA !== undefined) { var ra2 = readLike(a.fileA); if (ra2.err) return ra2.err; try { A = JSON.parse(ra2.src); } catch (e) { return 'Error: fileA is not JSON'; } }
      if (a.fileB !== undefined) { var rb2 = readLike(a.fileB); if (rb2.err) return rb2.err; try { B = JSON.parse(rb2.src); } catch (e) { return 'Error: fileB is not JSON'; } }
      if (A === undefined || B === undefined) return 'Error: json_merge needs a/b or fileA/fileB (JSON)';
      var merged = window.TOOLKIT.jsonMerge(A, B);
      var out = JSON.stringify(merged, null, 2);
      if (a.path) {
        var p3 = normPath(a.path);
        var w3 = IMPL.write_file({ path: p3, content: out });
        if (String(w3).indexOf('Error') === 0) return w3;
        return 'Merged into ' + p3 + ' (' + out.length + ' bytes)';
      }
      return out.length > 8000 ? out.slice(0, 8000) + '…' : out;
    },
    json_flatten: function (a) {
      var data;
      if (a.json !== undefined) { try { data = JSON.parse(a.json); } catch (e) { return 'Error: json is not valid JSON'; } }
      else if (a.file !== undefined) {
        var rf = readLike(a.file);
        if (rf.err) return rf.err;
        try { data = JSON.parse(rf.src); } catch (e) { return 'Error: file is not JSON — ' + e.message; }
      }
      else return 'Error: json_flatten needs json or file';
      var out = a.op === 'unflatten' ? window.TOOLKIT.jsonUnflatten(data, a.sep) : window.TOOLKIT.jsonFlatten(data, a.sep);
      return JSON.stringify(out, null, a.op === 'unflatten' ? 2 : undefined).slice(0, 8000);
    },
    text_case: function (a) {
      var mode = String(a.mode || 'kebab');
      if (['camel', 'snake', 'kebab', 'pascal', 'title', 'words'].indexOf(mode) < 0) return 'Error: mode is camel | snake | kebab | pascal | title | words';
      return window.TOOLKIT.textCase(String(a.text || ''), mode);
    },
    mime_lookup: function (a) {
      var ext = String(a.ext || '');
      var list = ext.split(',').map(function (e) { return e.trim(); }).filter(Boolean).slice(0, 20);
      return list.map(function (e) {
        return ''.concat(e, ' → ', window.TOOLKIT.mimeLookup(e));
      }).join('\n');
    },
    roman_convert: function (a) {
      try { return String(window.TOOLKIT.romanConvert(a.value)); }
      catch (e) { return 'Error: ' + e.message; }
    },
    byte_size: function (a) {
      try { return String(window.TOOLKIT.byteSize(a.value)); }
      catch (e) { return 'Error: ' + e.message; }
    },
    cron_describe: function (a) {
      try { return window.TOOLKIT.cronDescribe(a.expr); }
      catch (e) { return 'Error: ' + e.message; }
    },
    list_diff: function (a) {
      var A = a.a, B = a.b;
      if (a.fileA !== undefined) { var ra3 = readLike(a.fileA); if (ra3.err) return ra3.err; A = ra3.src.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
      if (a.fileB !== undefined) { var rb3 = readLike(a.fileB); if (rb3.err) return rb3.err; B = rb3.src.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
      if (!Array.isArray(A) || !Array.isArray(B)) return 'Error: list_diff needs a/b arrays or fileA/fileB line lists';
      var d = window.TOOLKIT.listDiff(A, B);
      return ''.concat('only in A (', d.onlyA.length, '): ', d.onlyA.slice(0, 30).join(', '),
        '\nonly in B (', d.onlyB.length, '): ', d.onlyB.slice(0, 30).join(', '),
        '\nin both (', d.intersect.length, '): ', d.intersect.slice(0, 30).join(', '));
    },
    sort_lines: function (a) {
      var src;
      if (a.text !== undefined) src = String(a.text);
      else if (a.file !== undefined) { var r6 = readLike(a.file); if (r6.err) return r6.err; src = r6.src; }
      else return 'Error: sort_lines needs text or file';
      var out = window.TOOLKIT.sortLines(src, a);
      return out.length > 8000 ? out.slice(0, 8000) + '…' : out;
    },
    apply_patch: function (a) {
      if (!a.patch) return 'Error: apply_patch needs the unified-diff patch text';
      var r = readLike(a.path);
      if (r.err) return r.err;
      var ap = window.DIFFENG.applyPatch(r.src, String(a.patch), { fuzz: Math.max(0, Math.min(5, parseInt(a.fuzz, 10) || 2)) });
      if (!ap.ok) return 'Error: ' + ap.error + ' — read the region with read_file and regenerate the patch with exact context lines';
      var lw = libCtx(a.path);
      if (lw && !lw.missing && lw.rel) { lw.project.files[lw.rel] = ap.result; Store.lib.put(lw.project); }
      else if (!lw) { var s3 = WS(); s3.vfsContent[r.label] = ap.result; Store.save(); }
      var before = r.src.split('\n').length, after = ap.result.split('\n').length;
      return 'Patched ' + r.label + ' — file now ' + after + ' lines (' + (after > before ? '+' + (after - before) : after < before ? after - before : 'same line count') + '). Verify with read_file or run_check.';
    },
    diff_files: function (a) {
      var ra = a.fileA !== undefined ? readLike(a.fileA) : null;
      var rb = a.fileB !== undefined ? readLike(a.fileB) : null;
      if (a.fileA !== undefined && ra.err) return ra.err;
      if (a.fileB !== undefined && rb.err) return rb.err;
      var A = a.fileA !== undefined ? ra.src : a.a, B = a.fileB !== undefined ? rb.src : a.b;
      if (A === undefined || B === undefined) return 'Error: diff_files needs a/b or fileA/fileB';
      var rows = window.DIFFENG.alignSides(String(A), String(B));
      var out = [];
      rows.forEach(function (row, i) {
        var l = row.left ? row.left.op + ' ' + row.left.t : '  ';
        var rr = row.right ? row.right.op + ' ' + row.right.t : '';
        out.push(String(i + 1).padStart(3) + ' | ' + l.padEnd(46) + ' | ' + rr);
      });
      return out.slice(0, 120).join('\n') + (out.length > 120 ? '\n… (' + out.length + ' rows total)' : '');
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
    if (name === 'run_check') return { label: 'Verify · ' + String(args.path || '').split('/').pop(), meta: 'console + visual', ok: ok };
    if (name === 'screenshot') return { label: 'Screenshot', meta: 'visual check', ok: ok };
    if (name === 'fetch_asset') return { label: 'Asset · ' + String(args.path || '').split('/').pop(), meta: 'download', ok: ok };
    if (name === 'checkpoint') return { label: 'Checkpoint · ' + String(args.label || '').slice(0, 26), meta: 'saved', ok: ok };
    if (name === 'rollback') return { label: 'Rollback · ' + String(args.label || '').slice(0, 26), meta: 'restored', ok: ok };
    if (name === 'interact') return { label: 'Interact · ' + String(args.path || '').split('/').pop(), meta: (args.actions || []).length + ' steps', ok: ok };
    if (name === 'sfx') return { label: 'SFX · ' + String(args.type || ''), meta: 'wav', ok: ok };
    if (name === 'optimize_image') return { label: 'Optimize · ' + String(args.path || '').split('/').pop(), meta: 'image', ok: ok };
    if (name === 'lint') return { label: 'Lint · ' + String(args.path || '').split('/').pop(), meta: 'static', ok: ok };
    if (name === 'test_data') return { label: 'Data · ' + String(args.kind || 'users'), meta: 'generated', ok: ok };
    if (name === 'pwa_setup') return { label: 'PWA setup', meta: 'installable', ok: ok };
    if (name === 'http_request') return { label: 'HTTP · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: (args.method || 'GET'), ok: ok };
    if (name === 'diff_texts') return { label: 'Diff · ' + String(args.fileA || args.pathA || 'texts').split('/').pop() + ' ↔ ' + String(args.fileB || args.pathB || '').split('/').pop(), meta: 'jsdiff', ok: ok };
    if (name === 'math_eval') return { label: 'Math · ' + String(args.expression || '').slice(0, 30), meta: 'parsed', ok: ok };
    if (name === 'encode_decode') return { label: 'Codec · ' + String(args.scheme || 'base64'), meta: args.op || 'encode', ok: ok };
    if (name === 'hash_text') return { label: 'Hash · ' + String(args.algo || 'SHA-256'), meta: '', ok: ok };
    if (name === 'json_query') return { label: 'JSON · ' + String(args.path || '.').slice(0, 24), meta: args.op || 'get', ok: ok };
    if (name === 'csv_parse') return { label: 'CSV · ' + String(args.file || 'text').split('/').pop(), meta: 'parsed', ok: ok };
    if (name === 'todo_scan') return { label: 'Marker scan', meta: 'TODO/FIXME', ok: ok };
    if (name === 'word_count') return { label: 'Count · ' + String(args.path || 'workspace'), meta: 'wc', ok: ok };
    if (name === 'init_project') return { label: 'Scaffold · ' + String(args.name || ''), meta: args.kind || 'static', ok: ok };
    if (name === 'format_json') return { label: 'JSON fmt · ' + String(args.path || '').split('/').pop(), meta: args.mode || 'pretty', ok: ok };
    if (name === 'uuid_key') return { label: 'Ids · ' + String(args.kind || 'uuid4'), meta: 'crypto', ok: ok };
    if (name === 'html_to_markdown') return { label: 'HTML→MD · ' + String(args.file || 'html').split('/').pop(), meta: 'converted', ok: ok };
    if (name === 'rss_parse') return { label: 'Feed · ' + String((args.url || 'xml').replace(/^https?:\/\//, '')).slice(0, 34), meta: 'parsed', ok: ok };
    if (name === 'qr_generate') return { label: 'QR · ' + String(args.text || '').slice(0, 26), meta: 'svg', ok: ok };
    if (name === 'text_stats') return { label: 'Stats · ' + String(args.file || 'text').split('/').pop(), meta: 'readability', ok: ok };
    if (name === 'diff_words') return { label: 'Word diff · ' + String(args.fileA || 'texts').split('/').pop(), meta: 'jsdiff', ok: ok };
    if (name === 'cron_next') return { label: 'Cron · ' + String(args.expr || '').slice(0, 24), meta: 'next runs', ok: ok };
    if (name === 'test_gen') return { label: 'Test factory · ' + String(args.path || '').split('/').pop(), meta: 'scaffold', ok: ok };
    if (name === 'csv_generate') return { label: 'CSV · ' + String(args.path || (Array.isArray(args.rows) ? args.rows.length + ' rows' : 'json')), meta: 'generated', ok: ok };
    if (name === 'json_schema_check') return { label: 'Schema check', meta: 'validate', ok: ok };
    if (name === 'color_convert') return { label: 'Color · ' + String(args.color || ''), meta: 'contrast', ok: ok };
    if (name === 'password_gen') return { label: 'Passphrase · ×' + (args.count || 1), meta: 'crypto', ok: ok };
    if (name === 'url_parse') return { label: 'URL · ' + String(args.url || '').slice(0, 34), meta: 'parsed', ok: ok };
    if (name === 'markdown_toc') return { label: 'TOC · ' + String(args.file || 'md').split('/').pop(), meta: 'outline', ok: ok };
    if (name === 'markdown_to_html') return { label: 'MD→HTML · ' + String(args.file || 'md').split('/').pop(), meta: 'converted', ok: ok };
    if (name === 'csv_stats') return { label: 'Stats · ' + String(args.file || 'rows').split('/').pop(), meta: args.op || 'count', ok: ok };
    if (name === 'json_merge') return { label: 'JSON merge · ' + String(args.path || 'result'), meta: 'deep', ok: ok };
    if (name === 'json_flatten') return { label: 'JSON ' + (args.op || 'flatten'), meta: 'dot-keys', ok: ok };
    if (name === 'text_case') return { label: 'Case · ' + (args.mode || 'kebab'), meta: '', ok: ok };
    if (name === 'mime_lookup') return { label: 'MIME · ' + String(args.ext || '').slice(0, 24), meta: 'types', ok: ok };
    if (name === 'roman_convert') return { label: 'Roman · ' + String(args.value || '').slice(0, 12), meta: 'convert', ok: ok };
    if (name === 'byte_size') return { label: 'Size · ' + String(args.value || '').slice(0, 12), meta: 'convert', ok: ok };
    if (name === 'cron_describe') return { label: 'Cron · ' + String(args.expr || '').slice(0, 20), meta: 'plain english', ok: ok };
    if (name === 'list_diff') return { label: 'Set diff · A vs B', meta: 'lists', ok: ok };
    if (name === 'sort_lines') return { label: 'Sort lines', meta: args.numeric ? 'numeric' : 'alpha', ok: ok };
    if (name === 'apply_patch') return { label: 'Patch · ' + String(args.path || '').split('/').pop(), meta: 'unified diff', ok: ok };
    if (name === 'diff_files') return { label: 'Diff · ' + String(args.fileA || 'a').split('/').pop() + ' ↔ ' + String(args.fileB || 'b').split('/').pop(), meta: 'side-by-side', ok: ok };
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
    { type: 'function', function: { name: 'shell_exec', description: 'Run a REAL shell command on the device (Android app builds). Returns combined stdout+stderr and the true exit code; the working directory persists across calls within the session. Use it to build, test, inspect processes, and verify work. A nonzero exit means failure — read the output and react. Long output is truncated to 64KB. A circuit breaker guards the channel: after consecutive timeouts it probes for recovery and reports instead of hanging.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'working directory for this command (absolute or relative to the session cwd)' }, timeout_seconds: { type: 'number', description: 'default 120' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'browser_open', description: 'Open a URL in the built-in browser overlay (user-visible). Returns immediately after navigation starts; pair with browser_read for the page text.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'browser_read', description: 'Read a web page as clean markdown AND open it in the built-in browser so the user can see it. Best way to show a page to the user while studying it.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'run_check', description: 'Build-quality verification: renders an HTML entry (workspace or lib/ path) in a hidden frame, captures its console errors/warnings and a screenshot analysis (canvas size, non-blank %, dominant colors), and saves the screenshot into workspace/screenshots/. ALWAYS run this after building or changing anything visual/interactive; fix every error and run again until the console is clean before reporting done.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'HTML entry: workspace path or lib/<slug>/index.html' }, seconds: { type: 'number', description: 'seconds to let it run before capture (default 3)' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'screenshot', description: 'Capture what the built-in browser is currently showing (or render a given HTML path) — returns canvas size, non-blank % and dominant colors, and saves a PNG to workspace/screenshots/. Use to SEE the current state of a visual build.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'optional HTML path to render and capture (defaults to the current browser page)' } } } } },
    { type: 'function', function: { name: 'fetch_asset', description: 'Download a real asset (3D model .glb/.gltf, texture, image, audio) from a public CORS-enabled URL into the workspace — real assets beat geometric primitives. Cap 8 MB. Use for games/3D: fetch models and textures from github raw / jsdelivr / unpkg.', parameters: { type: 'object', properties: { url: { type: 'string' }, path: { type: 'string', description: 'workspace path to save to, e.g. assets/models/ship.glb' } }, required: ['url', 'path'] } } },
    { type: 'function', function: { name: 'checkpoint', description: 'Snapshot the whole workspace before a risky experiment or a big refactor. Roll back with rollback{label} if it goes wrong.', parameters: { type: 'object', properties: { label: { type: 'string', description: 'short name, e.g. "before physics refactor"' } }, required: ['label'] } } },
    { type: 'function', function: { name: 'rollback', description: 'Restore the workspace to a saved checkpoint (latest one, or by label). Use when an experiment made things worse.', parameters: { type: 'object', properties: { label: { type: 'string' } } } } },
    { type: 'function', function: { name: 'interact', description: 'USE the built app like a real user: click buttons, fill inputs, read results — in a hidden frame running the entry HTML. THE functional verification tool: after building a calculator/form/game, drive it — fill inputs, click the action button, read the output, and confirm the values are mathematically correct before reporting done. Commands: click, fill (value), read, exists. Verify behavior, not just rendering.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'HTML entry: workspace path or lib/<slug>/index.html' }, actions: { type: 'array', description: 'ordered steps, e.g. [{"sel":"#bill","cmd":"fill","value":"100"},{"sel":"#tip15","cmd":"click"},{"sel":"#total","cmd":"read"}]', items: { type: 'object', properties: { sel: { type: 'string' }, cmd: { type: 'string', description: 'click | fill | read | exists' }, value: { type: 'string' } }, required: ['sel', 'cmd'] } }, seconds: { type: 'number', description: 'session length before the final capture (default 4)' } }, required: ['path', 'actions'] } } },
    { type: 'function', function: { name: 'sfx', description: 'Generate procedural sound effects as .wav files — no downloads needed: jump, coin, laser, explosion, powerup, hit, unlock, blip. Use for games so actions have sound; wire with new Audio(path).play(). Deterministic per seed.', parameters: { type: 'object', properties: { type: { type: 'string', description: 'jump | coin | laser | explosion | powerup | hit | unlock | blip' }, path: { type: 'string', description: 'where to save, e.g. assets/audio/jump.wav' }, duration: { type: 'number' }, seed: { type: 'number' } }, required: ['type'] } } },
    { type: 'function', function: { name: 'optimize_image', description: 'Resize/compress an image in the workspace for web use (canvas-based): scales to maxWidth, converts format, reports the size savings. Use before shipping images so pages load fast.', parameters: { type: 'object', properties: { path: { type: 'string' }, maxWidth: { type: 'number', description: 'default 1200' }, format: { type: 'string', description: 'image/jpeg | image/png | image/webp' }, quality: { type: 'number', description: '0.3-1, default 0.82' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'lint', description: 'Quick static checks: JS syntax, HTML tag balance and duplicate ids, CSS brace balance. Run before run_check to catch cheap errors early.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'test_data', description: 'Generate realistic deterministic test data (users, products, todos) as JSON in the workspace — so apps and demos have real-looking content instead of lorem ipsum. Seeded: same seed = same data.', parameters: { type: 'object', properties: { kind: { type: 'string', description: 'users | products | todos' }, count: { type: 'number' }, path: { type: 'string', description: 'default workspace/data/<kind>.json' }, seed: { type: 'number' } } } } },
    { type: 'function', function: { name: 'pwa_setup', description: 'Make a built project installable: generates manifest.webmanifest, icon-192/512.png (from the app name), an offline service worker, and injects them into the entry HTML. Use after building an app so the user can add it to their home screen.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'project root: workspace or lib/<slug>/' }, name: { type: 'string', description: 'app name for the manifest and icon' }, theme: { type: 'string', description: 'theme color hex, default #7c5cff' } } } } },
    { type: 'function', function: { name: 'http_request', description: 'Make a raw HTTP request to any public API: method, headers, body. Returns status, key headers and the body. Use it to call REST APIs, test webhooks, download JSON data, or debug endpoints the user is building against. Public hosts only (private/loopback blocked).', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string', description: 'GET | POST | PUT | PATCH | DELETE (default GET)' }, headers: { type: 'object', description: 'e.g. {"Authorization": "Bearer ...", "Content-Type": "application/json"}' }, body: { type: 'string', description: 'request body (objects are JSON-encoded)' }, maxBytes: { type: 'number', description: 'body chars returned, default 4000, cap 20000' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'diff_texts', description: 'Unified diff of two texts or two workspace files (vendored jsdiff). Use to show exactly what changed between versions, review an edit before applying it, or explain a change to the user.', parameters: { type: 'object', properties: { a: { type: 'string', description: 'first text (or use fileA)' }, b: { type: 'string', description: 'second text (or use fileB)' }, fileA: { type: 'string' }, fileB: { type: 'string' }, pathA: { type: 'string', description: 'label for a' }, pathB: { type: 'string', description: 'label for b' } } } } },
    { type: 'function', function: { name: 'math_eval', description: 'Evaluate a math expression safely (parsed, never eval): numbers, + - * / % ^, parentheses, functions (sqrt, sin, cos, tan, floor, ceil, round, abs, min, max, log, pow, exp, hypot…), constants pi/e. Use for any arithmetic you should not trust yourself to do mentally — tip splits, physics, percentages, conversions.', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. "round(84.50 * 1.15 * 100) / 100"' } }, required: ['expression'] } } },
    { type: 'function', function: { name: 'encode_decode', description: 'Encode or decode text: base64, URL-encoding, hex. Use for data URLs, auth headers, safe embedding of text in code, or inspecting encoded payloads.', parameters: { type: 'object', properties: { op: { type: 'string', description: 'encode | decode (default encode)' }, scheme: { type: 'string', description: 'base64 | uri | hex (default base64)' }, text: { type: 'string' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'hash_text', description: 'Hash text with SHA-1/256/512 (crypto.subtle). Use to verify content, build cache keys, or demo auth flows.', parameters: { type: 'object', properties: { text: { type: 'string' }, algo: { type: 'string', description: 'SHA-256 (default) | SHA-1 | SHA-512' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'json_query', description: 'Extract data from JSON by path (e.g. "users[2].name", "config.timeouts") with ops: get | keys | len | type. Works on inline json or a workspace file. Use instead of reading whole JSON files when you need one value.', parameters: { type: 'object', properties: { json: { type: 'string', description: 'inline JSON text' }, file: { type: 'string', description: 'workspace/lib path' }, path: { type: 'string' }, op: { type: 'string', description: 'get (default) | keys | len | type' } } } } },
    { type: 'function', function: { name: 'csv_parse', description: 'Parse CSV text or a workspace .csv file (quoted fields, escaped quotes, CRLF all handled). Returns headers + row objects. Use to turn data files into JSON the app can embed or transform.', parameters: { type: 'object', properties: { file: { type: 'string' }, text: { type: 'string' }, delimiter: { type: 'string', description: 'default ","' }, output: { type: 'string', description: 'objects (default) | raw | headers' } } } } },
    { type: 'function', function: { name: 'todo_scan', description: 'Scan the whole workspace for TODO/FIXME/HACK/XXX/BUG markers with file:line. Run before declaring a task finished, or when the user asks what work remains.', parameters: { type: 'object', properties: { dir: { type: 'string', description: 'limit to a subfolder' } } } } },
    { type: 'function', function: { name: 'test_gen', description: 'Generate a unit-test scaffold for a JS module: detects the export contract (module.exports map, single export, exports.x, function/class/prototype methods) and renders a runnable node test file with honest contract checks. Write the output to tests/, deepen the placeholders, run it.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'module file to scaffold tests for' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'word_count', description: 'Lines/words/chars for one file (path) or every workspace file with a TOTAL. Use to report project size honestly or check a file is not empty.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
    { type: 'function', function: { name: 'init_project', description: 'Scaffold a real starter project in one call: kind=static (index.html + style.css + app.js), kind=game (canvas game loop with resize + keyboard), kind=node (package.json + index.js), kind=python (main.py + requirements.txt). ALWAYS use this to start a new app/site/game instead of writing boilerplate from scratch — then build out from these working entry points.', parameters: { type: 'object', properties: { kind: { type: 'string', description: 'static | game | node | python' }, name: { type: 'string', description: 'project name (becomes the folder slug)' } }, required: ['kind', 'name'] } } },
    { type: 'function', function: { name: 'format_json', description: 'Validate + pretty-print or minify a JSON file in place. Reports the exact parse error when invalid. Use after hand-building JSON config files.', parameters: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string', description: 'pretty (default) | minify' }, indent: { type: 'number' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'uuid_key', description: 'Generate identifiers: uuid4, nanoid (21-char), hex, or 6-digit pin. Cryptographically random. Use when building apps that need ids, tokens, or demo keys.', parameters: { type: 'object', properties: { kind: { type: 'string', description: 'uuid4 (default) | nanoid | hex | pin' }, count: { type: 'number', description: '1-50' } } } } },
    { type: 'function', function: { name: 'html_to_markdown', description: 'Convert HTML to clean markdown (headings, links, lists, code, emphasis; scripts stripped). Feed it HTML fetched via http_request to read pages as markdown, or convert workspace .html content for docs.', parameters: { type: 'object', properties: { html: { type: 'string' }, file: { type: 'string', description: 'workspace/lib path to an .html file' } } } } },
    { type: 'function', function: { name: 'rss_parse', description: 'Parse an RSS or Atom feed (url or xml) into items with title/link/date/summary. Use to build news readers, integrate feeds, or check what a feed publishes.', parameters: { type: 'object', properties: { url: { type: 'string' }, xml: { type: 'string' } } } } },
    { type: 'function', function: { name: 'qr_generate', description: 'Generate a real QR code as crisp SVG (Reed-Solomon ECC, masked): URLs, text, wifi strings, contact cards. Saves to the workspace when given a path — embed with <img src>. Use for share features in built apps.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'the payload (URL, text, wifi:...)' }, ecc: { type: 'string', description: 'L (default) | M' }, path: { type: 'string', description: 'save the SVG to this workspace path, e.g. assets/qr.svg' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'text_stats', description: 'Readability analysis: words, sentences, Flesch reading ease, reading time. Use to report on docs/content the agent wrote or to tune copy length.', parameters: { type: 'object', properties: { text: { type: 'string' }, file: { type: 'string' } } } } },
    { type: 'function', function: { name: 'diff_words', description: 'Word-level diff of two texts or files (+added / -removed groups, vendored jsdiff). Use to show what changed between two drafts or versions in human terms.', parameters: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' }, fileA: { type: 'string' }, fileB: { type: 'string' } } } } },
    { type: 'function', function: { name: 'cron_next', description: 'Parse a 5-field cron expression and compute the next N fire times. Use when building schedulers, explaining cron, or verifying a schedule (e.g. "30 9 * * 1-5").', parameters: { type: 'object', properties: { expr: { type: 'string', description: 'min hour dom month dow' }, from: { type: 'string', description: 'ISO date to start scanning from (default now)' }, count: { type: 'number', description: 'default 3, max 20' } }, required: ['expr'] } } },
    { type: 'function', function: { name: 'csv_generate', description: 'Generate RFC-4180 CSV from an array of objects (proper quoting) — the inverse of csv_parse. Saves to a file or returns the text. Use to produce data files for built apps.', parameters: { type: 'object', properties: { rows: { type: 'array', description: 'array of objects' }, file: { type: 'string', description: 'JSON file to convert' }, headers: { type: 'array' }, path: { type: 'string', description: 'save to this .csv path' } } } } },
    { type: 'object', function: { name: 'json_schema_check', description: 'Validate JSON against a mini schema (type/required/properties/items/enum/min/max) and report every violation with its path. Use to verify API responses, config files, or generated data before shipping.', parameters: { type: 'object', properties: { data: { type: 'object' }, file: { type: 'string' }, schema: { type: 'object', description: 'mini-schema: {type, required, properties, items, enum, minimum, maximum}' } }, required: ['schema'] } } },
    { type: 'function', function: { name: 'color_convert', description: 'Convert colors (hex/rgb/hsl) and compute WCAG contrast ratios against white/black with the AA verdict. Use when picking palettes so text is readable — pairs with the color-theory-ui skill.', parameters: { type: 'object', properties: { color: { type: 'string', description: '#7c5cff, #f55 or rgb(124,92,255)' } }, required: ['color'] } } },
    { type: 'function', function: { name: 'password_gen', description: 'Generate memorable crypto-random passphrases (word words-digits-symbol) for demos, seeded users, or test accounts. NOT for real security use.', parameters: { type: 'object', properties: { words: { type: 'number', description: 'words per phrase, default 3' }, count: { type: 'number', description: 'how many, default 1' } } } } },
    { type: 'function', function: { name: 'url_parse', description: 'Break a URL into origin/path/query object/hash. Use to inspect URLs before fetching or to build routing in apps.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'markdown_toc', description: 'Extract the heading outline of a markdown file/text with anchor slugs (skips code fences). Use to navigate or document long docs.', parameters: { type: 'object', properties: { file: { type: 'string' }, text: { type: 'string' } } } } },
    { type: 'function', function: { name: 'markdown_to_html', description: 'Convert markdown to clean HTML (headings, lists, code fences, links, bold/italic, blockquotes). Content is HTML-escaped first — injection impossible. Use to render docs as pages in built apps.', parameters: { type: 'object', properties: { text: { type: 'string' }, file: { type: 'string', description: 'workspace .md path' } } } } },
    { type: 'function', function: { name: 'csv_stats', description: 'Aggregate rows: groupBy a field + sum/avg/min/max/count over a value field. Works on JSON arrays or parsed CSV files. Use for quick data summaries in reports and dashboards.', parameters: { type: 'object', properties: { file: { type: 'string' }, rows: { type: 'array' }, groupBy: { type: 'string' }, field: { type: 'string' }, op: { type: 'string', description: 'count (default) | sum | avg | min | max' } } } } },
    { type: 'function', function: { name: 'json_merge', description: 'Deep-merge two JSON objects (objects merge, arrays/scalars replace) — from text or files, saved to a path. Use to combine configs or update state files.', parameters: { type: 'object', properties: { a: { type: 'object' }, b: { type: 'object' }, fileA: { type: 'string' }, fileB: { type: 'string' }, path: { type: 'string', description: 'save the merged result here' } } } } },
    { type: 'function', function: { name: 'json_flatten', description: 'Flatten nested JSON to dot-keys (a.b.c) or unflatten back — roundtrips. Use to normalize config shapes or inspect deep structures.', parameters: { type: 'object', properties: { json: { type: 'string' }, file: { type: 'string' }, op: { type: 'string', description: 'flatten (default) | unflatten' }, sep: { type: 'string' } } } } },
    { type: 'function', function: { name: 'text_case', description: 'Convert identifier/text casing: camel, snake, kebab, pascal, title, words. Use to normalize names across generated code and files.', parameters: { type: 'object', properties: { text: { type: 'string' }, mode: { type: 'string' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'mime_lookup', description: 'Content-type for file extensions (70+ types incl. wasm/glb/fonts) — the table a static server needs. Comma-separate several extensions.', parameters: { type: 'object', properties: { ext: { type: 'string', description: 'e.g. ".html, .js, .glb"' } }, required: ['ext'] } } },
    { type: 'function', function: { name: 'roman_convert', description: 'Convert numbers to Roman numerals and back (1..3999). Use for game levels, outlines, stylized numbering in built apps.', parameters: { type: 'object', properties: { value: { type: 'string', description: 'a number or a roman numeral' } }, required: ['value'] } } },
    { type: 'function', function: { name: 'byte_size', description: 'Format bytes human (1536 → "1.5 KB") or parse human sizes back ("1.5 KB" → 1536). Use for file-size displays and limit configs.', parameters: { type: 'object', properties: { value: { type: 'string', description: 'bytes or a size string' } }, required: ['value'] } } },
    { type: 'function', function: { name: 'cron_describe', description: 'Explain a cron expression in plain English ("30 9 * * 1-5" → "at 09:30 on Monday through Friday"). Pairs with cron_next.', parameters: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] } } },
    { type: 'function', function: { name: 'list_diff', description: 'Set operations on two lists (text or file lines): only-in-A, only-in-B, in-both. Use to compare exports, file lists, dependency lists.', parameters: { type: 'object', properties: { a: { type: 'array' }, b: { type: 'array' }, fileA: { type: 'string' }, fileB: { type: 'string' } } } } },
    { type: 'function', function: { name: 'sort_lines', description: 'Sort/dedupe text lines: alpha, numeric, by-length, desc, dedupe, trim. Use to normalize lists, sort logs, clean output.', parameters: { type: 'object', properties: { text: { type: 'string' }, file: { type: 'string' }, numeric: { type: 'boolean' }, desc: { type: 'boolean' }, dedupe: { type: 'boolean' }, length: { type: 'boolean' } } } } },
    { type: 'function', function: { name: 'apply_patch', description: 'Apply a unified diff patch to a file — MULTIPLE changes in one call (better than several edit_file calls for spread-out edits). Format: ---/+++ headers optional, @@ hunks with context lines. Context drift up to 2 lines is tolerated (fuzz). On failure the exact failing hunk is reported — read_file the region and regenerate with exact context.', parameters: { type: 'object', properties: { path: { type: 'string' }, patch: { type: 'string', description: 'unified diff, e.g. "@@ -2,1 +2,1 @@\\n-old line\\n+new line"' }, fuzz: { type: 'number', description: 'context drift tolerance, default 2' } }, required: ['path', 'patch'] } } },
    { type: 'function', function: { name: 'diff_files', description: 'Side-by-side line diff of two workspace files (or a/b texts) with row numbers and +/- markers. Use to compare versions or show exactly what differs.', parameters: { type: 'object', properties: { fileA: { type: 'string' }, fileB: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' } } } } },
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
      var toolName = String(name || '');
      var fn = IMPL[toolName];
      var isMcp = false;
      if (!fn && toolName.indexOf('mcp_') === 0 && window.App && App.runMcp) {
        /* MCP tools: dispatched through the app bridge, same budget rules */
        isMcp = true;
        var mcpRun = App.runMcp;
        fn = function (a) { return mcpRun(toolName, a); };
      }
      if (!fn) return 'Error: unknown tool ' + toolName;
      var call = function () { return fn(args); };
      /* L1 watchdog: budgeted tools (network/iframe) get the unified
         watchdog + circuit breaker from loopcore; local file ops stay
         direct (a timed-out write must never be discarded mid-flight) */
      if (window.LoopCore && LoopCore.DEFAULT_BUDGETS[toolName]) {
        var health = (window.App && App.toolHealth) || null;
        return LoopCore.withBudget(call, toolName, health).then(function (r) {
          return r.ok ? r.value : r.out;
        });
      }
      if (isMcp) return call(); // runMcpTool is async and catches internally
      try { return call(); } catch (e) { return 'Error: ' + e.message; }
    }
  };

  window.Tools = Tools;
  window.Console = Console;
})();
