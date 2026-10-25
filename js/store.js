/* Mono Harness — persistent store (localStorage) */
(function () {
  var KEY = 'mono-harness-v2';

  var DEFAULTS = {
    settings: {
      providerId: 'echo', model: 'echo-1',
      effort: 'High', maxTokens: 16, stream: true, fallbackId: '',
      ctxK: 128,
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
    plugins: {},         // id -> enabled, for entries in db.installed
    installed: [],       // plugin pack ids installed from the registry
    memories: [],        // [{id, title, tag, body}]
    allowRules: [],      // [{id, rule}] — commands pre-approved for the agent
    sessions: [],
    activeId: null,
    autos: [],
    hooks: [],
    mcp: [],             // [{name, url, on, ok, tools}]
    vfs: { workspace: [] },
    vfsContent: {}
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      var saved = JSON.parse(raw);
      var db = JSON.parse(JSON.stringify(DEFAULTS));
      // shallow-merge top level; settings merged key-by-key so new defaults appear
      Object.keys(saved).forEach(function (k) {
        if (k === 'settings') { Object.assign(db.settings, saved.settings || {}); return; }
        if (k === 'vfs' || k === 'vfsContent') { Object.assign(db[k], saved[k] || {}); return; }
        if (db[k] === undefined) return; // ignore unknown/removed keys from older versions
        db[k] = saved[k];
      });
      return db;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  var db = load();
  var listeners = [];

  function persist() {
    try {
      var out = db;
      if (!db.settings.autosave) {
        out = Object.assign({}, db, { sessions: [], activeId: null });
      }
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch (e) {
      // quota exceeded — drop heaviest payload and retry once
      try {
        var lean = Object.assign({}, db, { vfsContent: {} });
        localStorage.setItem(KEY, JSON.stringify(lean));
      } catch (e2) { /* storage full; app keeps working in memory */ }
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
        summary: null, compactions: []
      };
      db.sessions.unshift(s);
      if (db.sessions.length > 40) db.sessions.length = 40;
      db.activeId = s.id;
      persist();
      return s;
    },
    wipe: function (parts) {
      (parts || ['sessions', 'memories', 'autos', 'hooks', 'vfs', 'vfsContent']).forEach(function (p) {
        if (p === 'sessions') { db.sessions = []; db.activeId = null; }
        else if (p === 'vfs') { db.vfs = JSON.parse(JSON.stringify(DEFAULTS.vfs)); }
        else if (p === 'vfsContent') { db.vfsContent = JSON.parse(JSON.stringify(DEFAULTS.vfsContent)); }
        else db[p] = JSON.parse(JSON.stringify(DEFAULTS[p]));
      });
      persist();
    }
  };
})();
