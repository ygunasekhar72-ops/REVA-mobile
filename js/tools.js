/* Mono Harness — built-in agent tools + harness console.
   Tools operate on the ACTIVE CHAT's workspace only (each chat gets its own);
   there is no OS shell. The same command set powers the user-facing terminal
   (IDE console) and the model's run_command tool. */
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
      if (parts[i] === '..') { out.pop(); continue; }
      out.push(parts[i]);
    }
    return out.join('/') || 'workspace';
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

  var IMPL = {
    write_file: function (a) {
      var s = WS();
      var path = normPath(a.path);
      var content = String(a.content || '');
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
      return 'Wrote ' + path + ' (' + size + ')';
    },
    read_file: function (a) {
      var s = WS();
      var path = normPath(a.path);
      var c = s.vfsContent[path];
      if (c === undefined) return 'Error: no such file: ' + path;
      return String(c).slice(0, 6000);
    },
    list_files: function (a) {
      var s = WS();
      var path = normPath(a.path || 'workspace');
      var list = s.vfs[path];
      if (!list) return 'Error: no such folder: ' + path;
      if (!list.length) return '(empty)';
      return list.map(function (e) { return (e.t === 'dir' ? '[dir]  ' : '       ') + e.n + (e.s ? '  ' + e.s : ''); }).join('\n');
    },
    delete_file: function (a) {
      var s = WS();
      var path = normPath(a.path);
      var dir = parentOf(path) || 'workspace';
      var name = baseOf(path);
      var list = s.vfs[dir] || [];
      var before = list.length;
      s.vfs[dir] = list.filter(function (e) { return e.n !== name; });
      delete s.vfsContent[path];
      Store.save();
      return s.vfs[dir].length < before ? 'Deleted ' + path : 'Error: no such file: ' + path;
    },
    save_memory: function (a) {
      var title = String(a.title || '').trim() || 'note.md';
      if (!/\.md$/.test(title)) title += '.md';
      var tag = ['user', 'feedback', 'project', 'reference'].indexOf(a.tag) >= 0 ? a.tag : 'project';
      Store.db.memories.push({ id: 'm' + H.uid(), title: title, tag: tag, body: String(a.body || '').slice(0, 600) });
      Store.save();
      return 'Saved memory ' + title + ' (' + tag + ')';
    },
    add_plugin: function (a) {
      var name = String(a.name || '').trim();
      var prompt = String(a.prompt || '').trim();
      var code = a.code ? String(a.code) : '';
      if (!name || (!prompt && !code)) return 'Error: plugin needs name and prompt (or code)';
      var id = 'p' + H.uid();
      Store.db.plugins.push({ id: id, name: name, desc: String(a.description || '').slice(0, 120), prompt: prompt.slice(0, 1200), code: code, source: 'ai', on: true });
      Store.save();
      Tools.reloadPlugins();
      return 'Added plugin "' + name + '" (' + id + ')' + (code ? ' with real tools' : '') + ' — enabled; applies from the next turn.';
    },
    run_command: function (a) {
      return Console.exec(String(a.command || '')).out;
    }
  };

  /* ---------- real plugin system ----------
     A plugin is JS code evaluated once with a `register` capability object.
     register({ name, description, parameters, run }) adds a REAL tool: it
     joins the schema list sent to the model and its run(args) is executed
     exactly like a built-in (async allowed). Nothing is simulated. */
  var pluginTools = [];

  function reloadPlugins() {
    pluginTools = [];
    (Store.db.plugins || []).forEach(function (p) {
      if (!p.on || !p.code) return;
      try {
        new Function('register', 'Tools', p.code)(function (spec) {
          if (!spec || !spec.name || typeof spec.run !== 'function') return;
          pluginTools.push({
            name: String(spec.name),
            desc: String(spec.description || spec.name),
            params: spec.parameters || { type: 'object', properties: {} },
            plugin: p.name,
            run: spec.run
          });
        }, Tools);
        p.loaded = true; p.error = '';
      } catch (e) {
        p.loaded = false; p.error = String(e && e.message || e);
      }
    });
    Tools.schemas = SCHEMAS.concat(pluginTools.map(function (t) {
      return { type: 'function', function: { name: t.name, description: t.desc + ' (plugin: ' + t.plugin + ')', parameters: t.params } };
    }));
  }

  function ensureStarterPack() {
    if (Store.db.starterInstalled) return Promise.resolve(false);
    return fetch('plugins/index.json').then(function (r) { return r.json(); }).then(function (list) {
      var added = [];
      var chain = Promise.resolve();
      (list.plugins || []).forEach(function (entry) {
        chain = chain.then(function () {
          var exists = (Store.db.plugins || []).some(function (p) { return p.starterId === entry.id; });
          if (exists) return null;
          return fetch('plugins/' + entry.file).then(function (r) { return r.text(); }).then(function (code) {
            Store.db.plugins.push({ id: 'sp_' + entry.id, starterId: entry.id, name: entry.name, desc: entry.desc, source: 'starter', on: true, code: code });
            added.push(entry.name);
          });
        });
      });
      return chain.then(function () {
        Store.db.starterInstalled = true;
        Store.save();
        if (added.length) reloadPlugins();
        return added;
      });
    }).catch(function () { return false; });
  }

  function brief(name, args, result) {    var s = String(result || '');
    var ok = s.indexOf('Error') !== 0;
    if (name === 'write_file') return { label: 'Writing ' + (args.path || ''), meta: fmtSize(String(args.content || '').length), ok: ok, path: normPath(args.path) };
    if (name === 'read_file') return { label: 'Reading ' + (args.path || ''), meta: s.split('\n').length + ' lines', ok: ok };
    if (name === 'list_files') return { label: 'Listing ' + (args.path || 'workspace'), meta: s.split('\n').length + ' entries', ok: ok };
    if (name === 'delete_file') return { label: 'Deleting ' + (args.path || ''), meta: ok ? 'done' : 'failed', ok: ok };
    if (name === 'save_memory') return { label: 'Saving memory ' + (args.title || ''), meta: args.tag || 'project', ok: ok };
    if (name === 'add_plugin') return { label: 'Adding plugin ' + (args.name || ''), meta: 'by AI', ok: ok };
    if (name === 'run_command') return { label: '❯ ' + (args.command || ''), meta: '', ok: ok, cmd: args.command, out: s };
    if (name === 'web_search') return { label: 'Search · ' + String(args.query || '').slice(0, 40), meta: '', ok: ok };
    if (name === 'web_read') return { label: 'Read · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: '', ok: ok };
    if (name === 'browser_open') return { label: 'Browser · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: '', ok: ok, target: String(args.url || '') };
    if (name === 'browser_read') return { label: 'Read · ' + String((args.url || '').replace(/^https?:\/\//, '')).slice(0, 40), meta: '', ok: ok, target: String(args.url || '') };
    if (name === 'shell_exec') return { label: '❯ ' + String(args.command || '').slice(0, 46), meta: '', ok: ok, cmd: args.command, out: s };
    return { label: name, meta: '', ok: ok };
  }

  var SCHEMAS = [
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in this chat\'s workspace. Use for code, notes, HTML apps. path is relative to workspace, e.g. "app/index.html".', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a workspace file (up to 6000 chars).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List a workspace folder.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'defaults to workspace root' } } } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a workspace file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'save_memory', description: 'Persist something the user wants remembered across sessions. tag: user | feedback | project | reference.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'file-style name, e.g. deploy-notes.md' }, body: { type: 'string' }, tag: { type: 'string' } }, required: ['title', 'body'] } } },
    { type: 'function', function: { name: 'add_plugin', description: 'Create and install a plugin for the user. Two kinds: (a) instruction pack — a persistent prompt block; (b) real tool plugin — provide `code` that calls register({name, description, parameters, run}) to add real tools the model can call. Use when the user asks for a plugin, persona, automation, or new capability.', parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, prompt: { type: 'string', description: 'instruction block (instruction-pack plugins)' }, code: { type: 'string', description: 'JS source calling register({name, description, parameters, run}) — creates REAL callable tools' } }, required: ['name'] } } },
    { type: 'function', function: { name: 'run_command', description: 'Run a harness console command. Available: ls [path], tree, cat <file>, rm <file>, mkdir <dir>, mv <a> <b>, echo <text>, wc <file>, grep <pat> <file>, date, model, memories, plugins, status, help.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'web_search', description: 'Search the live web. Returns result links with titles plus a snippet digest. Use for current events, docs, APIs, anything you are unsure about or that may have changed.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'web_read', description: 'Fetch and read a web page as clean text (markdown). Use after web_search to study a promising result, or for any URL the user gives you.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'shell_exec', description: 'Run a REAL shell command on the device (Android app builds). Returns combined stdout+stderr and the true exit code; the working directory persists across calls within the session. Use it to build, test, inspect processes, and verify work. A nonzero exit means failure — read the output and react. Long output is truncated to 64KB.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'working directory for this command (absolute or relative to the session cwd)' }, timeout_seconds: { type: 'number', description: 'default 120' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'browser_open', description: 'Open a URL in the built-in browser overlay (user-visible). Returns immediately after navigation starts; pair with browser_read for the page text.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'browser_read', description: 'Read a web page as clean markdown AND open it in the built-in browser so the user can see it. Best way to show a page to the user while studying it.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } }
  ];

  /* ---------- harness console (user terminal + run_command) ---------- */
  var Console = {
    HELP: 'commands: ls [path] · tree · cat <file> · rm <file> · mkdir <dir> · mv <a> <b> · echo <text> · wc <file> · grep <pat> <file> · date · model · memories · plugins · status · clear · help',
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
        else if (cmd === 'plugins') out = Store.db.plugins.length ? Store.db.plugins.map(function (p) { return (p.on ? 'on  ' : 'off ') + p.name + (p.source === 'ai' ? ' · built by AI' : ''); }).join('\n') : '(none)';
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
    reloadPlugins: reloadPlugins,
    ensureStarterPack: ensureStarterPack,
    exists: function (path) {
      try { var s = WS(); return s.vfsContent[normPath(path)] !== undefined; } catch (e) { return false; }
    },
    run: function (name, args) {
      args = args || {};
      var pt = null;
      for (var i = 0; i < pluginTools.length; i++) if (pluginTools[i].name === name) { pt = pluginTools[i]; break; }
      if (pt) {
        return Promise.resolve().then(function () { return pt.run(args); }).catch(function (e) { return 'Error: ' + (e && e.message || e); });
      }
      var fn = IMPL[name];
      if (!fn) return 'Error: unknown tool ' + name;
      try { return fn(args); } catch (e) { return 'Error: ' + e.message; }
    }
  };

  window.Tools = Tools;
  window.Console = Console;
})();
