/* Mono Harness — persistent store (localStorage) */
(function () {
  var KEY = 'mono-harness-v3';
  var PREV_KEY = 'mono-harness-v2';
  var DEFAULTS = {
    settings: {
      providerId: 'echo', model: 'echo-1',
      effort: 'High', maxTokens: 64, stream: true, fallbackId: '',
      ctxK: 128, tools: true,
      theme: 'porcelain', depth: 0, radius: 14, font: 15, motion: true, icons: 'line',
      mode: 'Build', compactAt: 80, notify: false, lang: 'en',
      autosave: true, checkpoints: true,
      dismissedSetup: false, uiFlat: false
    },
    providers: [
      { id: 'openai',    name: 'OpenAI',          base: 'https://api.openai.com/v1',      key: '', models: [] },
      { id: 'openrouter',name: 'OpenRouter',      base: 'https://openrouter.ai/api/v1',   key: '', models: [] },
      { id: 'groq',      name: 'Groq',            base: 'https://api.groq.com/openai/v1', key: '', models: [] },
      { id: 'echo',      name: 'Echo (offline demo)', base: '', type: 'echo',             key: '', models: ['echo-1'] }
    ],
    disabledModels: [],  // model ids hidden from the chat model picker (toggle in Model settings)
    skills: [],          // [{id, name, desc, on}] — announced to the model in the system prompt
    plugins: [],         // [{id, name, desc, prompt, source: 'user'|'ai', on}] — prompt packs
    memories: [],        // [{id, title, tag, body}]
    allowRules: [],      // [{id, rule}] — commands pre-approved for the agent
    sessions: [],
    activeId: null,
    autos: [],
    hooks: [],
    mcp: [],            // [{name, url, on, ok, tools}]
    browser: { history: [] },   // recent sites visited in the built-in browser
    servers: [],        // [{id, name, port, dir, cmd, status, startedAt, log}]
    usage: {},          // { 'YYYY-MM-DD': { model: { reqs, inTok, outTok, errs } } }
    deploy: { target: '', token: '', site: '' }  // BYOK deploy target config
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
      /* one-time migration to the flat redesign (2026-10): old installs carry
         the neumorphic dark default — flip them to the flat light theme once */
      if (!db.settings.uiFlat) {
        db.settings.uiFlat = true;
        db.settings.theme = 'porcelain';
        db.settings.depth = 0;
      }
      /* provider cleanup: placeholder/local entries go, user-configured stay */
      db.providers = (db.providers || []).filter(function (p) {
        return ['ollama', 'lmstudio', 'custom'].indexOf(p.id) < 0 || p.key || (p.models && p.models.length);
      });
      /* every session must carry the vfsContent object — tools write into it.
         _vfsHydrated is a RUNTIME flag: after a reload every session starts
         un-hydrated so file contents are re-read from IndexedDB. */
      db.sessions.forEach(function (s) {
        if (!s.vfsContent) s.vfsContent = {};
        s._vfsHydrated = false;
      });
      return db;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  var db = load();
  var listeners = [];

  /* ============================================================
     PHASE 1.5 — heavy storage moved to IndexedDB.
     In-memory db always holds full vfsContent (the sync tool API never
     changes). localStorage keeps metadata + messages only, so the ~5 MB
     ceiling and the whole-db stringify cost stop biting. File contents
     write-through to IndexedDB on every save (dirty-checked by a cheap
     count+size signature).
     ============================================================ */
  var VFS_STORE = 'vfs';
  var idb = null;
  var vfsSigCache = {};
  function vfsSig(s) {
    var n = 0, total = 0, k;
    for (k in s.vfsContent) { n++; total += (s.vfsContent[k] || '').length; }
    return n + ':' + total;
  }
  function openVfsDb() {
    return new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      try {
        /* v2 adds the Project Library store; v3 adds checkpoints; one connection serves all layers */
        var rq = indexedDB.open('reva-vfs', 3);
        rq.onupgradeneeded = function () {
          var d = rq.result;
          if (!d.objectStoreNames.contains(VFS_STORE)) d.createObjectStore(VFS_STORE);
          if (!d.objectStoreNames.contains('library')) d.createObjectStore('library');
          if (!d.objectStoreNames.contains('checkpoints')) d.createObjectStore('checkpoints');
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function vfsPut(sessionId, content) {
    if (!idb) return;
    try {
      idb.transaction(VFS_STORE, 'readwrite').objectStore(VFS_STORE).put(JSON.stringify(content), sessionId);
    } catch (e) { }
  }
  function vfsGet(sessionId) {
    return new Promise(function (res) {
      if (!idb) return res(undefined);
      try {
        var rq = idb.transaction(VFS_STORE, 'readonly').objectStore(VFS_STORE).get(sessionId);
        rq.onsuccess = function () { try { res(rq.result ? JSON.parse(rq.result) : undefined); } catch (e) { res(undefined); } };
        rq.onerror = function () { res(undefined); };
      } catch (e) { res(undefined); }
    });
  }
  function syncVfs() {
    /* write-through — but ONLY for hydrated/fresh sessions: IDB is the
       authority for file contents, and a just-booted session's empty
       in-memory copy must NEVER overwrite the stored record */
    if (!idb) return;
    db.sessions.forEach(function (s) {
      if (!s._vfsHydrated) return;
      var sig = vfsSig(s);
      if (vfsSigCache[s.id] !== sig) { vfsSigCache[s.id] = sig; vfsPut(s.id, s.vfsContent || {}); }
    });
  }
  var vfsReady = openVfsDb().then(function (database) {
    idb = database;
    syncVfs();
    /* hydrate the active + 3 most recent sessions so files are usable at once */
    var recent = db.sessions.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 4);
    return Promise.all(recent.map(function (s) { return hydrateVfs(s); }));
  });
  function hydrateVfs(s) {
    if (!s.vfsContent) s.vfsContent = {}; // the tool API assumes this key always exists
    if (s._vfsHydrated) return Promise.resolve();
    if (Object.keys(s.vfsContent || {}).length) {
      /* legacy in-memory copy is the truthful one — push it to IDB once */
      s._vfsHydrated = true;
      vfsSigCache[s.id] = vfsSig(s);
      vfsPut(s.id, s.vfsContent || {});
      return Promise.resolve();
    }
    if (!idb) { s._vfsHydrated = true; return Promise.resolve(); }
    return vfsGet(s.id).then(function (content) {
      /* additive merge: IDB fills what's missing in memory; never clobbers
         newer in-memory entries (seeded skill files, post-boot writes) */
      if (content) Object.keys(content).forEach(function (k) {
        if (s.vfsContent[k] === undefined) s.vfsContent[k] = content[k];
      });
      s._vfsHydrated = true;
      vfsSigCache[s.id] = vfsSig(s);
    });
  }
  window.addEventListener('beforeunload', function () { syncVfs(); });

  /* ============================================================
     PROJECT LIBRARY (Phase 2) — imported projects live in IndexedDB,
     mounted into chats as lib/<slug>/ paths. Same IDB as vfs, extra store.
     ============================================================ */
  var libDb = null;
  var libCache = {};   // projectId -> {id, name, createdAt, files:{path:content}}
  function openLibDb() {
    /* the Library shares the vfs connection — openVfsDb creates both stores */
    return openVfsDb();
  }
  function libPersist(p) {
    if (!libDb) return;
    try { libDb.transaction('library', 'readwrite').objectStore('library').put(JSON.stringify(p), p.id); } catch (e) { }
  }
  function libRemove(id) {
    if (!libDb) return;
    try { libDb.transaction('library', 'readwrite').objectStore('library').delete(id); } catch (e) { }
  }
  var libReady = openLibDb().then(function (database) {
    libDb = database;
    if (!libDb) return;
    return new Promise(function (res) {
      var rq = libDb.transaction('library', 'readonly').objectStore('library').getAll();
      rq.onsuccess = function () {
        (rq.result || []).forEach(function (raw) {
          try { var p = JSON.parse(raw); libCache[p.id] = p; } catch (e) { }
        });
        res();
      };
      rq.onerror = function () { res(); };
    });
  });

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
      /* file contents live in IndexedDB (write-through below) — the
         localStorage payload stays small, so the quota ceiling and the
         whole-db stringify cost are gone */
      var sessions = out.sessions.map(function (s) {
        var c = Object.assign({}, s);
        delete c.vfsContent;
        delete c._vfsHydrated; // runtime flag — must never survive a reload
        return c;
      });
      syncVfs();
      localStorage.setItem(KEY, JSON.stringify(Object.assign({}, out, { sessions: sessions })));
    } catch (e) {
      // quota exceeded — progressively trim old chats, never the active one's files
      var attempts = [leanCopy(db), (function () {
        var l = leanCopy(db);
        l.sessions = l.sessions.map(function (s) { return Object.assign({}, s, { messages: s.messages.slice(-4) }); });
        return l;
      })()];
      for (var i = 0; i < attempts.length; i++) {
        try {
          var slim = attempts[i];
          slim.sessions = slim.sessions.map(function (s) { var c = Object.assign({}, s); delete c.vfsContent; return c; });
          localStorage.setItem(KEY, JSON.stringify(Object.assign({}, slim, { sessions: slim.sessions })));
          if (window.H && H.toast) H.toast('Storage full — older chats were trimmed'); return;
        } catch (e2) {}
      }
      /* storage full even lean; app keeps working in memory */
    }
    listeners.forEach(function (fn) { try { fn(db); } catch (e) {} });
  }

  window.Store = {
    KEY: KEY,
    db: db,
    save: persist,
    ready: vfsReady,
    _vfsDebug: { vfsPut: vfsPut, syncVfs: syncVfs, vfsSig: vfsSig, vfsGet: vfsGet, cache: vfsSigCache },
    hydrateSession: function (s) {
      if (!s) return Promise.resolve();
      return hydrateVfs(s).then(function () { try { persist(); } catch (e) { } });
    },
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
        vfsContent: {},
        _vfsHydrated: true               // created fresh in memory — nothing to hydrate
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
  window.Store.lib = {
    ready: libReady,
    list: function () {
      return Object.keys(libCache).map(function (id) {
        var p = libCache[id];
        var files = Object.keys(p.files || {});
        var size = 0; files.forEach(function (f) { size += (p.files[f] || '').length; });
        return { id: p.id, name: p.name, createdAt: p.createdAt, fileCount: files.length, size: size };
      }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    },
    get: function (id) { return libCache[id] || null; },
    put: function (p) { libCache[p.id] = p; libPersist(p); return p; },
    remove: function (id) { delete libCache[id]; libRemove(id); },
    slugTaken: function (slug) {
      return Object.keys(libCache).some(function (id) {
        return libCache[id].name.toLowerCase().replace(/[^\w.-]+/g, '-').toLowerCase() === slug.toLowerCase();
      });
    }
  };

  /* ============================================================
     CHECKPOINTS (Tools v2) — workspace snapshots in IndexedDB so the
     agent can experiment during long builds and roll back cleanly.
     ============================================================ */
  var cpDb = null;
  var cpReady = openVfsDb().then(function (database) { cpDb = database; });
  function cpPut(rec) {
    if (!cpDb) return;
    try { cpDb.transaction('checkpoints', 'readwrite').objectStore('checkpoints').put(JSON.stringify(rec), rec.id); } catch (e) { }
  }
  function cpAll(sessionId) {
    return new Promise(function (res) {
      if (!cpDb) return res([]);
      try {
        var rq = cpDb.transaction('checkpoints', 'readonly').objectStore('checkpoints').getAll();
        rq.onsuccess = function () {
          var rows = [];
          (rq.result || []).forEach(function (raw) {
            try { var r = JSON.parse(raw); if (r.sessionId === sessionId) rows.push(r); } catch (e) { }
          });
          rows.sort(function (a, b) { return b.ts - a.ts; });
          res(rows);
        };
        rq.onerror = function () { res([]); };
      } catch (e) { res([]); }
    });
  }
  function cpGet(id) {
    return new Promise(function (res) {
      if (!cpDb) return res(null);
      try {
        var rq = cpDb.transaction('checkpoints', 'readonly').objectStore('checkpoints').get(id);
        rq.onsuccess = function () { try { res(rq.result ? JSON.parse(rq.result) : null); } catch (e) { res(null); } };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  window.Store.checkpoints = {
    ready: cpReady,
    save: function (sessionId, label, files) {
      var rec = { id: 'cp' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), sessionId: sessionId, label: String(label || '').slice(0, 80), ts: Date.now(), fileCount: Object.keys(files || {}).length, files: files || {} };
      cpPut(rec);
      return rec;
    },
    list: cpAll,
    get: cpGet,
    del: function (id) { try { cpDb.transaction('checkpoints', 'readwrite').objectStore('checkpoints').delete(id); } catch (e) { } }
  };
})();
