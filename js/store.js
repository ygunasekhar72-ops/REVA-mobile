/* Mono Harness — persistent store (localStorage) */
(function () {
  var KEY = 'mono-harness-v3';
  var PREV_KEY = 'mono-harness-v2';
  var DEFAULTS = {
    settings: {
      providerId: 'echo', model: 'echo-1',
      effort: 'High', maxTokens: 16, stream: true, fallbackId: '',
      ctxK: 128, tools: true,
      theme: 'obsidian', depth: 100, radius: 18, font: 15, motion: true, icons: 'line',
      mode: 'Build', compactAt: 80, notify: false, lang: 'en',
      autosave: true, checkpoints: true,
      dismissedSetup: false
    },
    providers: [
      { id: 'openai',    name: 'OpenAI',          base: 'https://api.openai.com/v1',      key: '', models: [] },
      { id: 'openrouter',name: 'OpenRouter',      base: 'https://openrouter.ai/api/v1',   key: '', models: [] },
      { id: 'groq',      name: 'Groq',            base: 'https://api.groq.com/openai/v1', key: '', models: [] },
      { id: 'ollama',    name: 'Ollama (local)',  base: 'http://localhost:11434/v1', key: '', models: [] },
      { id: 'lmstudio',  name: 'LM Studio (local)', base: 'http://localhost:1234/v1',  key: '', models: [] },
      { id: 'custom',    name: 'Custom provider', base: '',                               key: '', models: [] },
      { id: 'echo',      name: 'Echo (offline demo)', base: '', type: 'echo',             key: '', models: ['echo-1'] }
    ],
    skills: [],          // [{id, name, desc, on}] — announced to the model in the system prompt
    plugins: [],         // [{id, name, desc, prompt, source: 'user'|'ai', on}] — prompt packs
    memories: [],        // [{id, title, tag, body}]
    allowRules: [],      // [{id, rule}] — commands pre-approved for the agent
    sessions: [],
    activeId: null,
    autos: [],
    hooks: [],
    mcp: []             // [{name, url, on, ok, tools}]
  };

  function migrateV2(saved) {
    // plugins were a registry-driven object map + installed id list; drop them (static preview packs)
    var db = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(saved).forEach(function (k) {
      if (k === 'settings') { Object.assign(db.settings, saved.settings || {}, { tools: saved.settings && saved.settings.tools !== undefined ? saved.settings.tools : true }); return; }
      if (k === 'plugins' || k === 'installed') return;
      if (k === 'vfs' || k === 'vfsContent') { db[k] = saved[k]; return; } // kept for workspace migration below
      if (db[k] === undefined) return;
      db[k] = saved[k];
    });
    migrateWorkspaces(db, saved);
    delete db.vfs; delete db.vfsContent;
    return db;
  }

  /* Each chat owns its workspace. Sessions from before this change inherit
     the legacy global workspace; every new session starts empty. */
  function migrateWorkspaces(db, saved) {
    var legacyVfs = (saved && saved.vfs) || { workspace: [] };
    var legacyContent = (saved && saved.vfsContent) || {};
    db.sessions.forEach(function (s) {
      if (!s.vfs) {
        s.vfs = JSON.parse(JSON.stringify(legacyVfs));
        s.vfsContent = JSON.parse(JSON.stringify(legacyContent));
      }
    });
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        var prev = localStorage.getItem(PREV_KEY);
        if (prev) {
          var migrated = migrateV2(JSON.parse(prev));
          try { localStorage.setItem(KEY, JSON.stringify(migrated)); } catch (e) {}
          return migrated;
        }
        return JSON.parse(JSON.stringify(DEFAULTS));
      }
      var saved = JSON.parse(raw);
      var db = JSON.parse(JSON.stringify(DEFAULTS));
      Object.keys(saved).forEach(function (k) {
        if (k === 'settings') { Object.assign(db.settings, saved.settings || {}); return; }
        if (k === 'vfs' || k === 'vfsContent') return; // legacy global workspace — migrated per session below
        if (db[k] === undefined) return;
        db[k] = saved[k];
      });
      migrateWorkspaces(db, saved);
      return db;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  var db = load();
  var listeners = [];

  function leanCopy(db) {
    var lean = JSON.parse(JSON.stringify(db));
    // keep the active + 2 most recent chats fully intact; older ones lose
    // heavy payloads first (file contents, reasoning, activity, snapshots)
    var keepIds = {};
    keepIds[db.activeId || ''] = true;
    lean.sessions.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 3)
      .forEach(function (s) { keepIds[s.id] = true; });
    lean.sessions = lean.sessions.map(function (s) {
      if (keepIds[s.id]) return s;
      var slim = Object.assign({}, s, { vfsContent: {} });
      if (slim.compactions) slim.compactions = slim.compactions.map(function (c) { return Object.assign({}, c, { snapshot: undefined }); });
      if (slim.messages && slim.messages.length > 6) {
        slim.messages = slim.messages.slice(-6).map(function (m) {
          return Object.assign({}, m, { reasoning: undefined, activity: undefined });
        });
      }
      return slim;
    });
    return lean;
  }

  function persist() {
    try {
      var out = db;
      if (!db.settings.autosave) {
        out = Object.assign({}, db, { sessions: [], activeId: null });
      }
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch (e) {
      // quota exceeded — progressively trim old chats, never the active one's files
      var attempts = [leanCopy(db), (function () {
        var l = leanCopy(db);
        l.sessions = l.sessions.map(function (s) { return Object.assign({}, s, { messages: s.messages.slice(-4) }); });
        return l;
      })()];
      for (var i = 0; i < attempts.length; i++) {
        try { localStorage.setItem(KEY, JSON.stringify(attempts[i])); if (window.H && H.toast) H.toast('Storage full — older chats were trimmed'); return; } catch (e2) {}
      }
      /* storage full even lean; app keeps working in memory */
    }
    listeners.forEach(function (fn) { try { fn(db); } catch (e) {} });
  }

  window.Store = {
    KEY: KEY,
    db: db,
    save: persist,
    onChange: function (fn) { listeners.push(fn); },
    provider: function (id) {
      return db.providers.find(function (p) { return p.id === id; }) || db.providers[0];
    },
    activeProvider: function () { return this.provider(db.settings.providerId); },
    session: function (id) {
      return db.sessions.find(function (s) { return s.id === id; });
    },
    active: function () { return this.session(db.activeId); },
    newSession: function () {
      var s = {
        id: 's' + Date.now().toString(36),
        title: 'New chat',
        messages: [], todos: [],
        model: db.settings.model,
        createdAt: Date.now(), updatedAt: Date.now(),
        summary: null, compactions: [],
        vfs: { workspace: [] },          // every chat gets its own empty workspace
        vfsContent: {}
      };
      db.sessions.unshift(s);
      if (db.sessions.length > 40) db.sessions.length = 40;
      db.activeId = s.id;
      persist();
      return s;
    },
    /* the active chat's workspace (vfs + vfsContent), created on demand */
    ws: function () {
      var s = this.active();
      if (!s) return null;
      if (!s.vfs) { s.vfs = { workspace: [] }; s.vfsContent = {}; }
      return s;
    },
    wipe: function (parts) {
      (parts || ['sessions', 'memories', 'autos', 'hooks']).forEach(function (p) {
        if (p === 'sessions') { db.sessions = []; db.activeId = null; }
        else db[p] = JSON.parse(JSON.stringify(DEFAULTS[p]));
      });
      persist();
    }
  };
})();
