/* Mono Harness — shared utilities */
(function () {
  var root, phone;
  window.H = {
    $: function (s, el) { return (el || document).querySelector(s); },
    $$: function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); },
    init: function (r, p) { root = r; phone = p; },
    phone: function () { return phone; },
    icons: function () {
      if (window.lucide) {
        try { lucide.createIcons({ attrs: { width: 18, height: 18 } }); } catch (e) {}
      }
    },
    el: function (html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; },
    esc: function (s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    /* user-configured endpoint validation (provider base URLs, MCP servers,
       model listings). Local/loopback hosts are a deliberate FEATURE (Ollama,
       LM Studio, on-device MCP) — the checks are about scheme sanity, control
       characters and credential leakage, not about blocking private nets. */
    assertEndpointUrl: function (u) {
      var s = String(u || '').trim();
      if (!/^https?:\/\//i.test(s)) throw new Error('Endpoint must be an http(s) URL');
      if (/[\s\u0000-\u001f\u007f]/.test(s)) throw new Error('Endpoint URL contains control characters');
      var parsed;
      try { parsed = new URL(s); } catch (e) { throw new Error('Endpoint URL is malformed'); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http/https endpoints are allowed');
      if (parsed.username || parsed.password) throw new Error('Endpoint URL must not embed credentials — put the key in the key field');
      var host = parsed.hostname;
      if (!/^(\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3}|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i.test(host)) throw new Error('Endpoint hostname is malformed');
      return s.replace(/\/+$/, '');
    },
    /* tiny syntax highlighter — returns HTML with tok-* spans over escaped text */
    hl: function (src, lang) {
      lang = (lang || '').toLowerCase();
      var KW = 'const|let|var|function|return|if|else|elif|for|while|class|new|import|export|from|await|async|try|catch|except|finally|throw|raise|typeof|instanceof|this|self|super|null|nil|none|undefined|true|false|def|lambda|not|and|or|in|is|pass|with|as|yield|switch|case|break|continue|do|enum|interface|type|implements|extends|public|private|protected|static|void|int|float|str|string|bool|boolean|struct|match|fun|val|echo|local';
      var comments = '<!--[\\s\\S]*?-->|/\\*[\\s\\S]*?\\*/|//[^\\n]*';
      if (/^(py|python|sh|bash|zsh|yaml|yml|rb|ruby|toml|conf)$/.test(lang)) comments += '|#[^\\n]*';
      var re = new RegExp(
        '(' + comments + ')' +
        '|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)' +
        '|(\\b\\d+(?:\\.\\d+)?\\b)' +
        '|(\\b(?:' + KW + ')\\b)' +
        '|(<\\/?[a-zA-Z][a-zA-Z0-9-]*)', 'g');
      function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      var raw = String(src), out = '', last = 0, m;
      while ((m = re.exec(raw)) !== null) {
        out += esc(raw.slice(last, m.index));
        if (m[1]) out += '<span class="tok-com">' + esc(m[1]) + '</span>';
        else if (m[2]) out += '<span class="tok-str">' + esc(m[2]) + '</span>';
        else if (m[3]) out += '<span class="tok-num">' + esc(m[3]) + '</span>';
        else if (m[4]) out += '<span class="tok-kw">' + esc(m[4]) + '</span>';
        else out += '<span class="tok-tag">' + esc(m[5]) + '</span>';
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      out += esc(raw.slice(last));
      return out;
    },
    /* file extension → highlighter language */
    extLang: function (name) {
      var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
      var ext = m ? m[1].toLowerCase() : '';
      return ({ html: 'html', htm: 'html', svg: 'html', xml: 'html', vue: 'html',
        css: 'css', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', json: 'js',
        py: 'py', rb: 'rb', sh: 'sh', bash: 'sh', zsh: 'sh', yml: 'yaml', yaml: 'yaml', toml: 'toml', conf: 'conf' })[ext] || '';
    },
    mdLite: function (s) {
      function inline(t) {
        var e = H.esc(t);
        e = e.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        e = e.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
        return e;
      }
      var parts = String(s).split(/```(\w*)\r?\n?([\s\S]*?)```/);
      var out = '';
      for (var i = 0; i < parts.length; i += 3) {
        out += inline(parts[i]);
        if (parts[i + 1] === undefined) break;
        var lang = parts[i + 1], code = parts[i + 2].replace(/\n$/, '');
        var lines = code.split('\n').length;
        var html = '<pre class="msgcode">' + H.hl(code, lang) + '</pre>';
        if (lines > 12) {
          out += '<details class="codecard"><summary><i data-lucide="file-code"></i>' + H.esc(lang || 'code') +
            ' · ' + lines + ' lines</summary>' + html + '</details>';
        } else out += html;
      }
      return out;
    },
    tok: function (s) { return Math.max(1, Math.ceil(String(s || '').length / 4)); },
    fmtK: function (n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); },
    ago: function (ts) {
      var d = Date.now() - ts;
      if (d < 60e3) return 'now';
      if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
      if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
      if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + 'd ago';
      return new Date(ts).toLocaleDateString();
    },
    timeHM: function (ts) {
      return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    },
    uid: function () { return Math.random().toString(36).slice(2, 9); }
  };

  /* toast */
  var toastEl, toastT;
  H.toast = function (msg) {
    if (!toastEl) toastEl = H.$('#toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2100);
  };

  /* navigation */
  /* full-screen overlays (the chat) hide the tab bar, sheet-style ones don't */
  function syncTabbar() {
    if (!phone) return;
    var open = H.$$('.ov.on');
    var top = open[open.length - 1];
    phone.classList.toggle('no-tabbar', !!(top && top.id === 'ov-chat'));
  }
  H.setTab = function (id) {
    H.$$('.ov.on').forEach(function (s) { s.classList.remove('on'); });
    H.$$('.tb').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === id); });
    H.$$('.tab-scr').forEach(function (s) { s.classList.toggle('on', s.id === 'scr-' + id); });
    H.closeSheets();
    syncTabbar();
    var scr = H.$('#scr-' + id); if (scr) scr.scrollTop = 0;
  };
  H.push = function (id) {
    H.closeSheets();
    var open = H.$$('.ov.on');
    var ov = document.getElementById(id);
    if (ov && open[open.length - 1] !== ov) {
      open.forEach(function (s) { s.classList.remove('on'); });
      ov.classList.add('on'); ov.scrollTop = 0;
    }
    syncTabbar();
  };
  H.pop = function () {
    var open = H.$$('.ov.on');
    if (open.length) open[open.length - 1].classList.remove('on');
    syncTabbar();
  };

  /* sheets */
  H.openSheet = function (id) {
    H.$$('.sheet.on').forEach(function (s) { s.classList.remove('on'); });
    var sh = document.getElementById(id);
    if (sh) { sh.classList.add('on'); H.$('#dim').classList.add('on'); }
  };
  H.closeSheets = function () {
    H.$$('.sheet.on').forEach(function (s) { s.classList.remove('on'); });
    var d = H.$('#dim'); if (d) d.classList.remove('on');
  };

  /* phone fit — full-bleed "native" mode on real phones, mockup on desktop */
  H.fit = function () {
    if (!root || !phone) return;
    var scaler = H.$('#scaler');
    var nativeMode = window.innerWidth <= 520;
    if (root.classList) root.classList.toggle('native', nativeMode);
    if (nativeMode) {
      phone.style.transform = '';
      scaler.style.width = '100%';
      scaler.style.height = '100%';
      return;
    }
    var w = Math.max(280, root.clientWidth - 6);
    var h = Math.max(480, window.innerHeight - 60);
    var s = Math.min(1, w / 390, h / 800);
    scaler.style.width = (390 * s) + 'px';
    scaler.style.height = (800 * s) + 'px';
    phone.style.transform = 'scale(' + s + ')';
  };

  /* long-press helper */
  H.longPress = function (el, fn) {
    var t;
    el.addEventListener('pointerdown', function (e) {
      t = setTimeout(function () { t = null; fn(e); }, 550);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(function (ev) {
      el.addEventListener(ev, function () { if (t) { clearTimeout(t); t = null; } }, { passive: true });
    });
  };

  H.copy = function (text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { H.toast('Copied to clipboard'); },
        function () { H.toast('Copy blocked by browser'); });
    } else H.toast('Clipboard unavailable');
  };
})();
