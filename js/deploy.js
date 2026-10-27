/* REVA — deploy the workspace to a real host (PolyDev-style one-tap deploy).
   Two targets, both plain REST from the harness (BYOK token, stored locally,
   never sent to the model or any AI provider):
     · Vercel  — POST /v13/deployments with inline files (utf8 only)
     · Netlify — site + digest deploy API (SHA-1 digests, then PUT each file)
   Static text files only for v1 (html/css/js/json/md/svg/txt/csv/xml). */
(function () {
  var TEXT_RE = /\.(html?|css|js|mjs|json|md|txt|csv|xml|svg|webmanifest)$/i;
  var DENY_RE = /(^|\/)(\.reva-servers|node_modules|\.git)(\/|$)/i;

  function collectFiles() {
    var s = Store.ws();
    if (!s) return { files: {}, error: 'Start a chat first — each chat owns its workspace' };
    var out = {}, n = 0;
    Object.keys(s.vfsContent || {}).forEach(function (k) {
      var rel = k.replace(/^workspace\//, '');
      if (!rel || DENY_RE.test(rel) || !TEXT_RE.test(rel)) return;
      out['/' + rel] = String(s.vfsContent[k]);
      n++;
    });
    if (!n) return { files: null, error: 'No deployable text files in this workspace (html/css/js/json/…)' };
    if (!out['/index.html'] && !out['/index.htm']) return { files: null, error: 'No index.html in the workspace — static deploys need one at the root' };
    return { files: out };
  }

  function withTimeout(ms) {
    var c = ('AbortController' in window) ? new AbortController() : null;
    var t = c ? setTimeout(function () { c.abort(); }, ms) : null;
    return { signal: c ? c.signal : undefined, done: function () { if (t) clearTimeout(t); } };
  }
  async function req(url, opts, ms) {
    var to = withTimeout(ms || 60000);
    try {
      var r = await fetch(url, Object.assign({ signal: to.signal }, opts));
      var body = await r.text();
      var json = null;
      try { json = JSON.parse(body); } catch (e) { }
      if (!r.ok) {
        var msg = (json && (json.error && json.error.message || json.message)) || body.slice(0, 160) || ('HTTP ' + r.status);
        throw new Error('HTTP ' + r.status + ' — ' + msg);
      }
      return json || body;
    } finally { to.done(); }
  }

  /* ---------- Vercel ---------- */
  async function deployVercel(token, name, files, log) {
    var entries = Object.keys(files).map(function (p) {
      return { file: p.slice(1), data: files[p], encoding: 'utf8' };
    });
    log('Vercel: uploading ' + entries.length + ' file(s)…');
    var d = await req('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, files: entries, projectSettings: { framework: null } })
    }, 90000);
    var url = d.url || (d.alias || [])[0] || '';
    // poll until READY (usually a few seconds for static)
    for (var i = 0; i < 24; i++) {
      await new Promise(function (r) { setTimeout(r, 5000); });
      var st = await req('https://api.vercel.com/v13/deployments/' + encodeURIComponent(d.id), {
        headers: { 'Authorization': 'Bearer ' + token }
      }, 30000);
      log('Vercel: build state ' + st.readyState + '…');
      if (st.readyState === 'READY') return 'Deployed to https://' + (st.url || url);
      if (st.readyState === 'ERROR' || st.readyState === 'CANCELED') throw new Error('Vercel build ' + st.readyState);
    }
    return 'Deploy submitted — check https://' + url + ' (build still finishing)';
  }

  /* ---------- Netlify ---------- */
  function sha1hex(str) {
    var msg = unescape(encodeURIComponent(str));
    var ml = msg.length;
    msg += String.fromCharCode(0x80);
    while (msg.length % 64 !== 56) msg += String.fromCharCode(0);
    var bl = ml * 8;
    msg += String.fromCharCode(0, 0, 0, 0, (bl >>> 24) & 255, (bl >>> 16) & 255, (bl >>> 8) & 255, bl & 255);
    var H = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    for (var i = 0; i < msg.length; i += 64) {
      var w = new Array(80), j, k, t;
      for (j = 0; j < 16; j++) {
        w[j] = (msg.charCodeAt(i + j * 4) << 24) | (msg.charCodeAt(i + j * 4 + 1) << 16) | (msg.charCodeAt(i + j * 4 + 2) << 8) | msg.charCodeAt(i + j * 4 + 3);
      }
      for (k = 16; k < 80; k++) {
        var n = w[k - 3] ^ w[k - 8] ^ w[k - 14] ^ w[k - 16];
        w[k] = (n << 1) | (n >>> 31);
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];
      for (t = 0; t < 80; t++) {
        var f, K;
        if (t < 20) { f = (b & c) | (~b & d); K = 0x5A827999; }
        else if (t < 40) { f = b ^ c ^ d; K = 0x6ED9EBA1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); K = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; K = 0xCA62C1D6; }
        var tmp = (((a << 5) | (a >>> 27)) + f + e + K + w[t]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  async function deployNetlify(token, name, files, log) {
    var site = null;
    var existing = await req('https://api.netlify.com/api/v1/sites?name=' + encodeURIComponent(name), {
      headers: { 'Authorization': 'Bearer ' + token }
    }, 30000);
    if (Array.isArray(existing) && existing.length) site = existing[0];
    else {
      log('Netlify: creating site "' + name + '"…');
      site = await req('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      }, 45000);
    }
    var digests = {};
    Object.keys(files).forEach(function (p) { digests[p] = sha1hex(files[p]); });
    log('Netlify: creating deploy (' + Object.keys(files).length + ' files)…');
    var dep = await req('https://api.netlify.com/api/v1/sites/' + site.id + '/deploys', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: digests, async: false })
    }, 90000);
    var need = dep.required || [];
    for (var i = 0; i < need.length; i++) {
      var p = need[i];
      if (files[p] === undefined) continue;
      log('Netlify: uploading ' + p);
      await req('https://api.netlify.com/api/v1/deploys/' + dep.id + '/files' + p, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
        body: files[p]
      }, 60000);
    }
    for (var w = 0; w < 20; w++) {
      var st = await req('https://api.netlify.com/api/v1/deploys/' + dep.id, {
        headers: { 'Authorization': 'Bearer ' + token }
      }, 30000);
      log('Netlify: state ' + st.state + '…');
      if (st.state === 'ready') return 'Deployed to https://' + (st.ssl_url || st.url);
      if (st.state === 'error') throw new Error('Netlify deploy error');
      await new Promise(function (r) { setTimeout(r, 4000); });
    }
    return 'Deploy processing — check https://' + (dep.ssl_url || dep.url) + ' in a moment';
  }

  async function run(target, token, name, log) {
    if (!token) throw new Error('Paste your ' + target + ' token first (it stays on this device)');
    if (!name) throw new Error('Project name required');
    name = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!name) throw new Error('Project name needs at least one letter/digit');
    var c = collectFiles();
    if (c.error) throw new Error(c.error);
    var list = Object.keys(c.files).join(' ');
    log('Deploying ' + Object.keys(c.files).length + ' files: ' + list.slice(0, 200));
    if (target === 'Vercel') return deployVercel(token, name, c.files, log);
    if (target === 'Netlify') return deployNetlify(token, name, c.files, log);
    throw new Error('Unknown target ' + target);
  }

  window.REVADeploy = { run: run, collectFiles: collectFiles, sha1hex: sha1hex };
})();
