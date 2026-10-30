/* REVA v2 chat controller — the new UI shell running on the REAL engine.
   Real: Store persistence, AI.chat streaming (real provider), modeldb
   badges, MDRENDER markdown. Mock: the tool cards (the full agent loop
   moves to v2 next). This is the mock-test surface for the v2 UI. */
(function () {
  const $ = (s) => document.querySelector(s);

  const state = { msgs: [], streaming: false, provider: null, model: null };

  async function boot() {
    await Store.ready;
    /* provider: reuse the stored e2e-nv/live-nv if present, else seed via
       the URL contract (?key=&base=) or the local proxy default */
    const db = Store.db;
    state.provider = (db.providers || []).find((p) => /nvidia/i.test(p.name) || p.id === 'e2e-nv' || p.id === 'live-nv');
    if (!state.provider && db.settings && db.settings.e2eBase && db.settings.e2eKey) {
      state.provider = { id: 'v2-nv', name: 'NVIDIA', base: db.settings.e2eBase, key: db.settings.e2eKey, models: [] };
      db.providers.push(state.provider);
    }
    if (state.provider) {
      const MID = 'nvidia/nemotron-3-ultra-550b-a55b';
      if (!(state.provider.models || []).some((m) => m.id === MID)) (state.provider.models = state.provider.models || []).push({ id: MID, name: 'Nemotron Ultra 550B' });
      state.model = MID;
      db.settings.providerId = state.provider.id;
      db.settings.model = MID;
      Store.save();
    }
    renderAll();
  }

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderAll() {
    renderHead();
    renderFlow();
    renderPill();
  }

  function renderHead() {
    $('#rv2Title').textContent = 'New chat';
  }

  function renderPill() {
    const el = $('#rv2Model');
    if (!el) return;
    const hit = window.REVAMODELDB && state.model ? REVAMODELDB.lookup(state.model) : null;
    el.innerHTML = '<b>' + esc(hit ? (state.model.split('/').pop()) : (state.model || 'no model')) + '</b>' +
      (hit && hit.ctx ? '<span class="rv2-badge">' + Math.round(hit.ctx / 1000) + 'k</span>' : '') +
      (hit && hit.vision ? '<span class="rv2-badge">vision</span>' : '');
  }

  function msgUserEl(t) {
    const d = document.createElement('div');
    d.className = 'rv2-msg-user m-in';
    d.textContent = t;
    return d;
  }

  function msgAiEl() {
    const d = document.createElement('div');
    d.className = 'rv2-msg-ai m-in';
    d.innerHTML = '<div class="rv2-ai-body"></div>';
    return d;
  }

  function thinkEl() {
    const d = document.createElement('details');
    d.className = 'rv2-think';
    d.open = true;
    d.innerHTML = '<summary><span class="rv2-flow-text">Thinking</span></summary><div class="rv2-think-body"></div>';
    return d;
  }

  function renderFlow() {
    const f = $('#rv2Flow');
    const hero = $('#rv2Hero');
    f.innerHTML = '';
    if (hero) hero.style.display = state.msgs.length ? 'none' : '';
    if (!state.msgs.length && hero) { f.appendChild(hero); return; }
    for (const m of state.msgs) {
      if (m.role === 'user') f.appendChild(msgUserEl(m.content));
      else if (m.role === 'assistant') {
        const a = msgAiEl();
        a.querySelector('.rv2-ai-body').innerHTML = window.MDRENDER ? (MDRENDER.render(m.content) || esc(m.content)) : esc(m.content);
        f.appendChild(a);
      }
    }
    f.scrollTop = f.scrollHeight;
  }

  async function send(text) {
    if (!text || state.streaming) return;
    if (!state.provider) { banner('No provider configured — set ?base= &key= in the URL (proxy base: http://127.0.0.1:8124/nv/v1)'); return; }
    state.msgs.push({ role: 'user', content: text });
    const f = $('#rv2Flow');
    f.appendChild(msgUserEl(text));
    const ai = msgAiEl();
    f.appendChild(ai);
    const body = ai.querySelector('.rv2-ai-body');
    f.scrollTop = f.scrollHeight;

    state.streaming = true;
    setSend(true);
    const think = thinkEl();
    ai.insertBefore(think, body);
    let acc = '';
    let thinkOpen = true;
    try {
      const res = await AI.chat({
        provider: state.provider,
        model: state.model,
        messages: [{ role: 'system', content: 'You are REVA, a local-first mobile AI harness. Be concise and helpful.' }].concat(
          state.msgs.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
        ).concat([{ role: 'user', content: text }]),
        maxTokens: 64,
        onDelta: (piece) => {
          if (thinkOpen) { think.open = false; think.querySelector('summary').textContent = 'Thought'; thinkOpen = false; }
          acc += piece;
          body.textContent = acc;
          $('#rv2Flow').scrollTop = $('#rv2Flow').scrollHeight;
        },
        onReasoning: (piece) => {
          const tb = think.querySelector('.rv2-think-body');
          tb.textContent = (tb.textContent + piece).slice(-600);
          $('#rv2Flow').scrollTop = $('#rv2Flow').scrollHeight;
        }
      });
      if (thinkOpen) { think.open = false; think.querySelector('summary').textContent = 'Thought'; }
      const finalText = (res && res.content) || acc || '(empty reply)';
      body.innerHTML = window.MDRENDER ? (MDRENDER.render(finalText) || esc(finalText)) : esc(finalText);
      if (window.MDRENDER) MDRENDER.enhance(body);
      state.msgs.push({ role: 'assistant', content: finalText });
    } catch (e) {
      body.innerHTML = '<span style="color:var(--red)">Error: ' + esc(String((e && e.message) || e)) + '</span>';
    }
    state.streaming = false;
    setSend(false);
    $('#rv2Flow').scrollTop = $('#rv2Flow').scrollHeight;
  }

  function setSend(on) {
    const b = $('#rv2Send');
    b.classList.toggle('stop', on);
    b.textContent = on ? '■' : '↑';
  }

  function banner(t) {
    const d = document.createElement('div');
    d.className = 'rv2-msg-ai';
    d.style.color = 'var(--yellow)';
    d.textContent = t;
    $('#rv2Flow').appendChild(d);
  }

  function wire() {
    $('#rv2Send').addEventListener('click', () => {
      const inp = $('#rv2Input');
      const t = inp.value.trim();
      if (!t) return;
      inp.value = '';
      send(t);
    });
    document.querySelectorAll('.rv2-chip').forEach((c) => {
      c.addEventListener('click', () => {
        $('#rv2Input').value = c.getAttribute('data-fill');
        $('#rv2Send').click();
      });
    });
    $('#rv2Input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#rv2Send').click(); }
    });
    $('#rv2Menu').addEventListener('click', () => {
      $('#rv2Drawer').classList.add('open');
      $('#rv2Scrim').classList.add('open');
    });
    $('#rv2Scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    /* drawer projects from the real Store */
    const list = $('#rv2Projects');
    const params = new URLSearchParams(location.search);
    if (params.get('base') && params.get('key')) {
      const db = Store.db;
      db.settings.e2eBase = params.get('base');
      db.settings.e2eKey = params.get('key');
      Store.save();
    }
    (Store.lib.list() || []).forEach((p) => {
      const d = document.createElement('div');
      d.className = 'rv2-ditem';
      d.textContent = p.name + ' · ' + p.fileCount + ' files';
      list.appendChild(d);
    });
    if (!list.children.length) list.innerHTML = '<div style="padding:9px 18px;color:var(--foreground-subtlest);font-size:var(--text-ui-sm)">No projects yet</div>';
  }
  function closeDrawer() { $('#rv2Drawer').classList.remove('open'); $('#rv2Scrim').classList.remove('open'); }

  window.V2 = { boot, send, state, renderAll, wire, banner };
  document.addEventListener('DOMContentLoaded', () => { wire(); boot(); });
})();
