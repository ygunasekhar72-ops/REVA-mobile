/* REVA — live web access for the agent (and UI helpers).
   Keyless, CORS-friendly chain:
     search: DuckDuckGo-lite via the r.jina.ai reader  → links + snippets
             + DuckDuckGo Instant Answer + Wikipedia (topic queries)
     read:   r.jina.ai reader → clean markdown of any page
   All requests time out; r.jina.ai 429s degrade to the JSON sources only. */
(function () {
  function withTimeout(ms) {
    var c = ('AbortController' in window) ? new AbortController() : null;
    var t = c ? setTimeout(function () { c.abort(); }, ms) : null;
    return { signal: c ? c.signal : undefined, done: function () { if (t) clearTimeout(t); } };
  }
  async function get(url, ms, headers) {
    var to = withTimeout(ms || 15000);
    try {
      var r = await fetch(url, { signal: to.signal, headers: headers });
      if (r.status === 429) { await new Promise(function (res) { setTimeout(res, 1200); }); r = await fetch(url, { signal: to.signal, headers: headers }); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } finally { to.done(); }
  }
  function cleanJina(md) {
    return String(md)
      .replace(/^Title:.*$/m, '')
      .replace(/^URL Source:.*$/m, '')
      .replace(/^Published Time:.*$/m, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function unwrap(u) {
    // duckduckgo wraps results in redirect URLs: .../l/?uddg=<encoded>
    var m = /[?&]uddg=([^&]+)/.exec(u || '');
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    return u;
  }
  function parseLinks(md, max) {
    var out = [], seen = {};
    var re = /\[([^\]\n]{4,120})\]\((https?:\/\/[^)\s]+)\)/g, m;
    while ((m = re.exec(md)) !== null && out.length < (max || 6)) {
      var url = unwrap(m[2]);
      if (/duckduckgo\.com|jina\.ai/.test(url)) continue;
      if (seen[url]) continue;
      seen[url] = 1;
      out.push({ title: m[1].replace(/\s+/g, ' ').trim(), url: url });
    }
    return out;
  }

  async function search(query) {
    query = String(query || '').trim();
    if (!query) return { results: [], text: 'Error: empty query' };
    var text = '', results = [], via = [];
    try {
      var md = await get('https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), 15000, { 'x-with-links-summary': 'true' });
      results = parseLinks(cleanJina(md), 6);
      var snippetSrc = cleanJina(md).replace(/\[([^\]\n]{4,120})\]\((https?:\/\/[^)\s]+)\)/g, '$1');
      text = snippetSrc.slice(0, 700);
      if (results.length) via.push('web');
    } catch (e) { /* degrade to JSON sources */ }
    try {
      var ia = JSON.parse(await get('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1', 10000));
      if (ia.AbstractText) {
        text = (text ? text + '\n\n' : '') + ia.AbstractText + (ia.AbstractURL ? '\nSource: ' + ia.AbstractURL : '');
        via.push('ddg-answer');
      }
    } catch (e) {}
    try {
      var w = JSON.parse(await get('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
        encodeURIComponent(query) + '&format=json&origin=*&srlimit=2', 10000));
      (w.query && w.query.search || []).forEach(function (s) {
        results.push({ title: s.title + ' (Wikipedia)', url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')) });
      });
      if (w.query && w.query.search && w.query.search.length) via.push('wikipedia');
    } catch (e) {}
    if (!results.length && !text) return { results: [], text: 'Error: search unavailable (network or rate limit)' };
    return { results: results, text: text, via: via.join('+') };
  }

  async function read(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return 'Error: provide a full http(s) URL';
    try {
      var md = cleanJina(await get('https://r.jina.ai/' + url, 20000));
      if (!md) return 'Error: empty page';
      return md.slice(0, 8000);
    } catch (e) {
      return 'Error: could not read ' + url + ' (' + String(e.message || e).slice(0, 80) + ')';
    }
  }

  window.WebSearch = { search: search, read: read, parseLinks: parseLinks };
})();
