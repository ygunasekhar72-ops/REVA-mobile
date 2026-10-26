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

  /* one source with its own timeout — a slow source never stalls the
     others (all run in parallel) */
  function source(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (res) { setTimeout(function () { res(null); }, ms); })
    ]).catch(function () { return null; });
  }

  /* Smart parallel web search: six independent sources race at once, results
     are merged, deduped by domain, and interleaved so no single source owns
     the top slots. Sources: DDG-Lite (via reader), DDG Instant Answer,
     Wikipedia, HackerNews, GitHub, StackExchange. */
  async function search(query) {
    query = String(query || '').trim();
    if (!query) return { results: [], text: 'Error: empty query' };
    var q = encodeURIComponent(query);

    var ddgLite = source((async function () {
      var md = await get('https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=' + q, 15000, { 'x-with-links-summary': 'true' });
      var links = parseLinks(cleanJina(md), 6);
      var snippetSrc = cleanJina(md).replace(/\[([^\]\n]{4,120})\]\((https?:\/\/[^)\s]+)\)/g, '$1');
      return { results: links, text: snippetSrc.slice(0, 700), via: 'web' };
    })(), 16000);

    var ddgIa = source((async function () {
      var ia = JSON.parse(await get('https://api.duckduckgo.com/?q=' + q + '&format=json&no_html=1', 10000));
      if (!ia.AbstractText) return null;
      return { results: [], text: ia.AbstractText + (ia.AbstractURL ? '\nSource: ' + ia.AbstractURL : ''), via: 'ddg-answer', boost: true };
    })(), 11000);

    var wiki = source((async function () {
      var w = JSON.parse(await get('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + q + '&format=json&origin=*&srlimit=2', 10000));
      return (w.query && w.query.search || []).map(function (s) {
        return { title: s.title + ' (Wikipedia)', url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')), snippet: (s.snippet || '').replace(/<[^>]+>/g, '') };
      });
    })(), 11000);

    var hn = source((async function () {
      var h = JSON.parse(await get('https://hn.algolia.com/api/v1/search?query=' + q + '&hitsPerPage=3', 10000));
      return (h.hits || []).filter(function (x) { return x.title; }).map(function (x) {
        return { title: x.title + ' (HackerNews)', url: x.url || ('https://news.ycombinator.com/item?id=' + x.objectID) };
      });
    })(), 11000);

    var gh = source((async function () {
      var g = JSON.parse(await get('https://api.github.com/search/repositories?q=' + q + '&per_page=3', 10000));
      return (g.items || []).map(function (it) {
        return { title: it.full_name + ' (GitHub ★' + it.stargazers_count + ')', url: it.html_url, snippet: (it.description || '').slice(0, 140) };
      });
    })(), 11000);

    var se = source((async function () {
      var s = JSON.parse(await get('https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance&q=' + q + '&site=stackoverflow&pagesize=3&filter=default', 10000));
      return (s.items || []).map(function (it) {
        return { title: (it.title || 'StackOverflow') + ' (StackOverflow)', url: it.url || ('https://stackoverflow.com/q/' + it.question_id) };
      });
    })(), 11000);

    var all = await Promise.all([ddgLite, ddgIa, wiki, hn, gh, se]);
    var text = '', via = [], seen = {}, merged = [];
    all.forEach(function (r) {
      if (!r) return;
      if (r.text) text = (text ? text + '\n\n' : '') + r.text;
      if (r.via) via.push(r.via);
      (r.results || []).forEach(function (x) {
        var dom = '';
        try { dom = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) { }
        var key = dom + '|' + String(x.title).slice(0, 24);
        if (seen[key]) return;
        seen[key] = 1;
        merged.push(x);
      });
    });
    // interleave: DDG results stay primary, others slot in between
    var primary = all[0] && all[0].results ? all[0].results.length : 0;
    var head = merged.slice(0, primary), tail = merged.slice(primary);
    var interleaved = [], ti = 0;
    head.forEach(function (x, i) {
      interleaved.push(x);
      if (i % 2 === 1 && ti < tail.length) interleaved.push(tail[ti++]);
    });
    while (ti < tail.length) interleaved.push(tail[ti++]);
    if (!interleaved.length && !text) return { results: [], text: 'Error: search unavailable (network or rate limit)' };
    return { results: interleaved.slice(0, 14), text: text, via: via.join('+') };
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
