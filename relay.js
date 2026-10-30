/* TEST INFRA ONLY — live command relay for the v2 mock test.
   Whitelisted dispatcher (NO eval): the page polls the local relay hub,
   executes only known command types, posts results back. Localhost-only. */
(function () {
  var HUB = 'http://127.0.0.1:8406';
  function run(cmd) {
    /* REAL APP commands (index.html — the full harness) */
    if (window.App && window.Store && !window.V2) {
      switch (cmd.type) {
        case 'seed': {
          var db = Store.db;
          var p = (db.providers || []).find(function (x) { return x.id === 'v2-nv'; });
          if (!p) { p = { id: 'v2-nv', name: 'NVIDIA Live', base: cmd.base, key: cmd.key, models: [] }; db.providers.push(p); }
          p.base = cmd.base; p.key = cmd.key;
          var MID = 'nvidia/nemotron-3-ultra-550b-a55b';
          if (!(p.models || []).some(function (m) { return m.id === MID; })) (p.models = p.models || []).push({ id: MID, name: 'Nemotron Ultra 550B' });
          db.settings.providerId = 'v2-nv';
          db.settings.model = MID;
          if (db.settings.disabledModels) db.settings.disabledModels = db.settings.disabledModels.filter(function (x) { return x !== MID; });
          Store.save();
          UI.renderChatHead(Store.active() || Store.newSession());
          return { seeded: true, model: db.settings.model, providers: db.providers.length };
        }
        case 'send': {
          var inp = document.querySelector('#chatInput');
          inp.value = String(cmd.text || '').slice(0, 2000);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#sendBtn').click();
          return { sent: true };
        }
        case 'appstatus': {
          var s = Store.active();
          var rows = [].slice.call(document.querySelectorAll('.act-row'));
          return {
            streaming: !!(window.App.isStreaming && App.isStreaming()),
            rows: rows.length,
            lastRows: rows.slice(-3).map(function (r) { return r.textContent.trim().slice(0, 70); }),
            msgs: (s.messages || []).length,
            files: Object.keys(s.vfsContent || {}).filter(function (f) { return f.indexOf('workspace/skills') !== 0; }).slice(0, 12),
            shots: Object.keys(s.vfsContent || {}).filter(function (f) { return /screenshots/.test(f); }).length,
            model: db.settings.model
          };
        }
        case 'queue': {
          var inp2 = document.querySelector('#chatInput');
          inp2.value = String(cmd.text || '').slice(0, 500);
          inp2.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#sendBtn').click();
          return { queuedOrSent: true };
        }
        case 'files': {
          var s2 = Store.active();
          return { files: Object.keys(s2.vfsContent || {}).filter(function (f) { return f.indexOf('workspace/skills') !== 0; }) };
        }
        case 'preview': {
          var s3 = Store.active();
          var entry = Object.keys(s3.vfsContent || {}).find(function (f) { return /(^|\/)index\.html?$/i.test(f); });
          if (!entry) return { err: 'no entry file' };
          var html = s3.vfsContent[entry];
          var dir = entry.indexOf('/') >= 0 ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
          var payload = JSON.stringify({ files: s3.vfsContent, dir: dir }).split('</scr' + 'ipt').join('<\\/scr' + 'ipt');
          var loader = '<scr' + 'ipt>window.__LIB=' + payload + ';document.addEventListener("DOMContentLoaded",function(){var P=window.__LIB,L=P.files,D=P.dir;document.querySelectorAll("link[href]").forEach(function(l){var k=D+l.getAttribute("href");if(L[k]===undefined)return;var st=document.createElement("style");st.textContent=L[k];l.parentNode.replaceChild(st,l);});document.querySelectorAll("script[src]").forEach(function(sc){var k=D+sc.getAttribute("src");if(L[k]===undefined)return;var ns=document.createElement("script");ns.textContent=L[k];sc.parentNode.replaceChild(ns,sc);});});})</scr' + 'ipt>';
          var page = html.indexOf('<head>') >= 0 ? html.split('<head>').join('<head>' + loader) : loader + html;
          if (window.LoopCore) page = LoopCore.injectThreeMap(page);
          var fr = document.querySelector('#wbFrame');
          if (!fr) return { err: 'no preview frame' };
          fr.setAttribute('srcdoc', page);
          try { H.push('ov-browser'); } catch (e) { }
          return { preview: 'opened', entry: entry };
        }
        case 'back': {
          try { if (window.App && App.openChat) App.openChat(); } catch (e) { }
          return { back: true };
        }
        default:
          break;
      }
    }
    /* v2 mock commands (test-v2.html) */
    switch (cmd.type) {
      case 'seed':
        var db = Store.db;
        var p = (db.providers || []).find(function (x) { return x.id === 'v2-nv'; });
        if (!p) { p = { id: 'v2-nv', name: 'NVIDIA Live', base: cmd.base, key: cmd.key, models: [] }; db.providers.push(p); }
        p.base = cmd.base; p.key = cmd.key;
        var MID = 'nvidia/nemotron-3-ultra-550b-a55b';
        if (!(p.models || []).some(function (m) { return m.id === MID; })) (p.models = p.models || []).push({ id: MID, name: 'Nemotron Ultra 550B' });
        db.settings.providerId = 'v2-nv';
        db.settings.model = MID;
        Store.save();
        if (window.V2) V2.renderAll();
        return { seeded: true, model: db.settings.model };
      case 'send':
        return Promise.resolve(V2.send(String(cmd.text || '').slice(0, 400))).then(function () { return { sent: true }; });
      case 'status':
        return {
          streaming: !!(window.V2 && V2.state.streaming),
          msgs: V2.state.msgs.length,
          provider: V2.state.provider ? V2.state.provider.id : null,
          model: V2.state.model,
          lastAi: (function () {
            var a = [].slice.call(document.querySelectorAll('.rv2-msg-ai')).pop();
            return a ? a.textContent.slice(-120) : '';
          })()
        };
      case 'drawer':
        document.querySelector('#rv2Drawer').classList.toggle('open');
        document.querySelector('#rv2Scrim').classList.toggle('open');
        return { drawer: document.querySelector('#rv2Drawer').classList.contains('open') };
      default:
        return { unknown: cmd.type };
    }
  }
  function poll() {
    fetch(HUB + '/next', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.cmd) return;
        var cmd = j.cmd;
        if (!cmd || !cmd.type) return;
        Promise.resolve(run(cmd)).then(function (res) {
          fetch(HUB + '/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, res: res }) }).catch(function () { });
        }).catch(function (e) {
          fetch(HUB + '/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, res: String(e && e.message || e) }) }).catch(function () { });
        });
      })
      .catch(function () { });
  }
  setInterval(poll, 600);
  console.log('[relay] live on', HUB);
})();
