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
    mdLite: function (s) {
      var e = H.esc(s);
      e = e.replace(/```(\w*)\n?([\s\S]*?)```/g, function (m, l, c) { return '<pre class="msgcode">' + c + '</pre>'; });
      e = e.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      e = e.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
      return e;
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

  /* phone fit */
  H.fit = function () {
    if (!root || !phone) return;
    var scaler = H.$('#scaler');
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
