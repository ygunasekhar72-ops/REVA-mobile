/* Mono Harness — built-in agent tools + harness console.
   Tools operate on the workspace VFS and app state only; there is no OS shell.
   The same command set powers the user-facing console (IDE terminal) and the
   model's run_command tool. */
(function () {
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
  /* make sure every directory segment exists in the VFS tree */
  function ensureDirs(path) {
    var parts = path.split('/');
    var acc = '';
    for (var i = 0; i < parts.length - 1; i++) {
      var parent = acc || 'workspace';
      acc = acc ? acc + '/' + parts[i] : parts[i];
      var list = Store.db.vfs[parent] || (Store.db.vfs[parent] = []);
      if (!list.some(function (e) { return e.n === parts[i] && e.t === 'dir'; })) {
        list.push({ n: parts[i], t: 'dir', p: acc });
        Store.db.vfs[acc] = Store.db.vfs[acc] || [];
      }
    }
    Store.db.vfs[path] = Store.db.vfs[path] || [];
  }
  function fmtSize(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }

  var IMPL = {
    write_file: function (a) {
      var path = normPath(a.path);
      var content = String(a.content || '');
      ensureDirs(parentOf(path) || 'workspace');
      var dir = parentOf(path) || 'workspace';
      var list = Store.db.vfs[dir] || (Store.db.vfs[dir] = []);
      var name = baseOf(path);
      var size = fmtSize(content.length);
      var ex = list.find(function (e) { return e.n === name; });
      var isImg = /^data:image\//.test(content);
      if (ex) { ex.s = size; if (ex.t !== 'dir') ex.t = isImg ? 'img' : 'code'; }
      else list.push({ n: name, t: isImg ? 'img' : (/\.(md|txt)$/.test(name) ? 'doc' : 'code'), s: size });
      Store.db.vfsContent[path] = content;
      Store.save();
      return 'Wrote ' + path + ' (' + size + ')';
    },
    read_file: function (a) {
      var path = normPath(a.path);
      var c = Store.db.vfsContent[path];
      if (c === undefined) return 'Error: no such file: ' + path;
      return String(c).slice(0, 6000);
    },
    list_files: function (a) {
      var path = normPath(a.path || 'workspace');
      var list = Store.db.vfs[path];
      if (!list) return 'Error: no such folder: ' + path;
      if (!list.length) return '(empty)';
      return list.map(function (e) { return (e.t === 'dir' ? '[dir]  ' : '       ') + e.n + (e.s ? '  ' + e.s : ''); }).join('\n');
    },
    delete_file: function (a) {
      var path = normPath(a.path);
      var dir = parentOf(path) || 'workspace';
      var name = baseOf(path);
      var list = Store.db.vfs[dir] || [];
      var before = list.length;
      Store.db.vfs[dir] = list.filter(function (e) { return e.n !== name; });
      delete Store.db.vfsContent[path];
      Store.save();
      return Store.db.vfs[dir].length < before ? 'Deleted ' + path : 'Error: no such file: ' + path;
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
      if (!name || !prompt) return 'Error: plugin needs name and prompt';
      var id = 'p' + H.uid();
      Store.db.plugins.push({ id: id, name: name, desc: String(a.description || '').slice(0, 120), prompt: prompt.slice(0, 1200), source: 'ai', on: true });
      Store.save();
      return 'Added plugin "' + name + '" (' + id + ') — enabled. Tell the user to reload nothing; it applies next turn.';
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
    if (name === 'add_plugin') return { label: 'Adding plugin ' + (args.name || ''), meta: 'by AI', ok: ok };
    if (name === 'run_command') return { label: 'Console · ' + (args.command || ''), meta: '', ok: ok };
    return { label: name, meta: '', ok: ok };
  }

  var SCHEMAS = [
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in the harness workspace. Use for code, notes, HTML apps. path is relative to workspace, e.g. "app/index.html".', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a workspace file (up to 6000 chars).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List a workspace folder.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'defaults to workspace root' } } } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a workspace file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'save_memory', description: 'Persist something the user wants remembered across sessions. tag: user | feedback | project | reference.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'file-style name, e.g. deploy-notes.md' }, body: { type: 'string' }, tag: { type: 'string' } }, required: ['title', 'body'] } } },
    { type: 'function', function: { name: 'add_plugin', description: 'Create and install a plugin (a persistent instruction pack) for the user. Use when the user asks for a plugin, persona, or standing behavior.', parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, prompt: { type: 'string', description: 'the instruction block injected into the system prompt while enabled' } }, required: ['name', 'prompt'] } } },
    { type: 'function', function: { name: 'run_command', description: 'Run a harness console command. Available: ls [path], tree, cat <file>, rm <file>, model, memories, plugins, status, help.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }
  ];

  /* ---------- harness console (user terminal + run_command) ---------- */
  var Console = {
    HELP: 'commands: ls [path] · tree · cat <file> · rm <file> · model · memories · plugins · status · clear · help',
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
          Object.keys(Store.db.vfs).sort().forEach(function (p) {
            lines.push(p + '/');
            (Store.db.vfs[p] || []).forEach(function (e) { lines.push('  ' + e.n + (e.t === 'dir' ? '/' : '')); });
          });
          out = lines.join('\n') || '(empty)';
        }
        else if (cmd === 'cat') out = IMPL.read_file({ path: arg });
        else if (cmd === 'rm') out = IMPL.delete_file({ path: arg });
        else if (cmd === 'model') out = Store.db.settings.model + ' · ' + Store.activeProvider().name;
        else if (cmd === 'memories') out = Store.db.memories.length ? Store.db.memories.map(function (m) { return m.tag + ' · ' + m.title; }).join('\n') : '(none)';
        else if (cmd === 'plugins') out = Store.db.plugins.length ? Store.db.plugins.map(function (p) { return (p.on ? 'on  ' : 'off ') + p.name + (p.source === 'ai' ? ' · built by AI' : ''); }).join('\n') : '(none)';
        else if (cmd === 'status') out = 'provider ' + Store.activeProvider().name + ' · model ' + Store.db.settings.model + ' · tools ' + (Store.db.settings.tools !== false ? 'on' : 'off') + ' · mode ' + Store.db.settings.mode;
        else if (cmd === 'clear') return { out: '', clear: true };
        else out = 'Unknown command: ' + cmd + '\n' + Console.HELP;
      } catch (e) { out = 'Error: ' + e.message; }
      return { out: out };
    }
  };

  var Tools = {
    schemas: SCHEMAS,
    brief: brief,
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
