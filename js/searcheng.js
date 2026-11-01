/* REVA — Search Engine (original subsystems engine, subsystem #2).
   Our own inverted-index search — not a wrapper:
   - createIndex: token → docId postings WITH positions (phrase queries)
   - addDoc/removeDoc: incremental, field-weighted (title tokens count ×3)
   - search: AND semantics with graceful OR fallback, TF-IDF-lite ranking,
     phrase support, field-hit reporting
   - fuzzy: bounded Levenshtein fallback when a term has no exact posting
   - suggest: vocabulary prefix scan (search-as-you-type)
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SEARCHENG = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  var STOP = /^(the|a|an|and|or|of|to|in|on|for|with|is|are|was|be|it|this|that|as|at|by|from|not|but|if|then|so|do|does|did|my|your|its|their|our|has|have|had|can|will|would|should)$/;
  var MIN_LEN = 2;

  function stem(w) {
    w = w.replace(/([^aeiou])s$/, '$1');  // cats→cat (before e-strip)
    if (w.length > 4) w = w.replace(/(ing|ed)$/, '');
    if (w.length > 3) w = w.replace(/e$/, '');
    if (w.length > 3) w = w.replace(/([^aeiou])\1$/, '$1'); // running→runn→run
    return w;
  }
  function tokenize(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(function (w) { return w.length >= MIN_LEN && !STOP.test(w); })
      .map(stem)
      .filter(Boolean);
  }
  /* position-preserving tokens for indexing: raw order INCLUDING stopwords,
     so phrase adjacency reflects the real text ('quick the brown' is NOT
     the phrase 'quick brown' even though 'the' is a stopword) */
  function indexTokens(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map(function (w) {
        if (w.length < MIN_LEN || STOP.test(w)) return null;
        return stem(w);
      });
  }

  function createIndex() {
    return {
      docs: {},          // docId → {fields: {name: raw}, tokens: {token: {field: [positions]}}}
      postings: {},      // token → Set(docId) (plain object as set)
      vocab: {},         // token → true (for suggest)
      df: {},            // token → doc frequency
      total: 0
    };
  }

  /* addDoc(ix, id, fields): fields = {title: '…', body: '…'} — title tokens
     are weighted ×3 by triple-insertion (tf reflects field importance). */
  function addDoc(ix, id, fields) {
    removeDoc(ix, id); // idempotent re-add
    var doc = { fields: fields || {}, tokens: {} };
    var bag = {};
    Object.keys(fields || {}).forEach(function (fname) {
      var weight = fname === 'title' ? 3 : 1;
      indexTokens(fields[fname]).forEach(function (t, pos) {
        if (!t) return; // stopword/short — position consumed, nothing stored
        if (!doc.tokens[t]) doc.tokens[t] = {};
        if (!doc.tokens[t][fname]) doc.tokens[t][fname] = [];
        doc.tokens[t][fname].push(pos);
        bag[t] = (bag[t] || 0) + weight;
      });
    });
    doc.tokens.__bag = bag; // per-doc term frequencies (weighted)
    ix.docs[id] = doc;
    ix.total++;
    Object.keys(bag).forEach(function (t) {
      if (!ix.postings[t]) { ix.postings[t] = {}; ix.df[t] = 0; }
      if (!ix.postings[t][id]) ix.df[t]++;
      ix.postings[t][id] = 1;
      ix.vocab[t] = true;
    });
    return ix;
  }

  function removeDoc(ix, id) {
    var doc = ix.docs[id];
    if (!doc) return ix;
    Object.keys(doc.tokens.__bag || {}).forEach(function (t) {
      if (ix.postings[t]) {
        delete ix.postings[t][id];
        ix.df[t] = Math.max(0, (ix.df[t] || 1) - 1);
        if (ix.df[t] === 0) { delete ix.postings[t]; delete ix.df[t]; delete ix.vocab[t]; }
      }
    });
    delete ix.docs[id];
    ix.total = Math.max(0, ix.total - 1);
    return ix;
  }

  /* bounded Levenshtein — early exit past maxDist */
  function editDistance(a, b, maxDist) {
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
    var prev = [], cur = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      var rowMin = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (cur[k] < rowMin) rowMin = cur[k];
      }
      if (rowMin > maxDist) return maxDist + 1; // early exit — the row bottomed out
      var swap = prev; prev = cur; cur = swap;
    }
    return prev[b.length];
  }

  /* phrase check: do the query tokens appear CONSECUTIVELY in one field? */
  function phraseAt(ix, id, toks) {
    var doc = ix.docs[id];
    if (!doc) return false;
    var first = doc.tokens[toks[0]];
    if (!first) return false;
    return Object.keys(first).some(function (fname) {
      var starts = first[fname];
      return starts.some(function (pos) {
        for (var k = 1; k < toks.length; k++) {
          var nk = doc.tokens[toks[k]];
          if (!nk || !nk[fname] || nk[fname].indexOf(pos + k) < 0) return false;
        }
        return true;
      });
    });
  }

  /* search(ix, query, opts):
     opts: {fields: ['title','body'], fuzzy: true, limit: 20, any: false}
     Returns [{id, score, matched, fields}] best-first, AND semantics with
     OR fallback when AND yields nothing (unless opts.strict). */
  function search(ix, query, opts) {
    opts = opts || {};
    var qToks = tokenize(query);
    if (!qToks.length) return [];
    var N = Math.max(1, ix.total);
    var limit = opts.limit || 20;

    function resolve(tok) {
      if (ix.postings[tok]) return tok;
      if (opts.fuzzy !== false && tok.length >= 4) {
        /* fuzzy fallback: nearest vocabulary term within distance 2 */
        var best = null, bestD = 3;
        Object.keys(ix.vocab).forEach(function (v) {
          if (Math.abs(v.length - tok.length) > 2) return;
          var d = editDistance(tok, v, bestD);
          if (d < bestD) { bestD = d; best = v; }
        });
        return best;
      }
      return null;
    }

    function scoreDocs(requiredToks) {
      var acc = {}; // docId → {score, matched:{}}
      requiredToks.forEach(function (rawTok) {
        var tok = resolve(rawTok);
        if (!tok) return;
        var df = ix.df[tok] || 1;
        var idf = Math.log(1 + N / df);
        Object.keys(ix.postings[tok] || {}).forEach(function (id) {
          var doc = ix.docs[id];
          var tf = (doc.tokens.__bag || {})[tok] || 1;
          var docLen = Object.keys(doc.tokens.__bag || {}).reduce(function (s, t) { return s + (doc.tokens.__bag || {})[t]; }, 0) || 1;
          var norm = tf / Math.sqrt(docLen);
          if (!acc[id]) acc[id] = { id: id, score: 0, matched: {} };
          acc[id].score += norm * idf;
          acc[id].matched[rawTok] = tok;
        });
      });
      return acc;
    }

    function finish(acc) {
      var out = Object.keys(acc).map(function (id) {
        var r = acc[id];
        var fieldsHit = {};
        Object.keys(r.matched).forEach(function (q) {
          var tok = r.matched[q];
          var dt = ix.docs[id].tokens[tok] || {};
          Object.keys(dt).forEach(function (f) { fieldsHit[f] = true; });
        });
        return { id: id, score: Math.round(r.score * 1000) / 1000, matched: Object.keys(r.matched), fields: Object.keys(fieldsHit) };
      });
      out.sort(function (a, b) { return b.score - a.score || (a.id < b.id ? -1 : 1); });
      return out.slice(0, limit);
    }

    /* phrase attempt first: consecutive tokens outrank bag-of-words */
    if (qToks.length > 1) {
      var phraseAcc = {};
      var candidates = scoreDocs(qToks);
      Object.keys(candidates).forEach(function (id) {
        if (phraseAt(ix, id, qToks)) { phraseAcc[id] = candidates[id]; phraseAcc[id].score += 2; } // phrase boost
      });
      if (Object.keys(phraseAcc).length) return finish(phraseAcc);
    }

    var and = scoreDocs(qToks);
    var andIds = Object.keys(and).filter(function (id) {
      return Object.keys(and[id].matched).length === qToks.length;
    });
    if (andIds.length) {
      var full = {};
      andIds.forEach(function (id) { full[id] = and[id]; });
      return finish(full); // full matches only — partials are the fallback's job
    }

    if (opts.strict) return [];
    /* OR fallback: any term matches — partials ranked by score */
    return finish(and);
  }

  /* suggest(ix, prefix, limit): vocabulary words starting with the prefix */
  function suggest(ix, prefix, limit) {
    var p = String(prefix || '').toLowerCase();
    if (p.length < MIN_LEN) return [];
    var out = [];
    Object.keys(ix.vocab).forEach(function (t) {
      if (t.indexOf(p) === 0 && out.length < (limit || 8)) out.push(t);
    });
    return out.sort();
  }

  return {
    tokenize: tokenize,
    createIndex: createIndex,
    addDoc: addDoc,
    removeDoc: removeDoc,
    search: search,
    suggest: suggest,
    editDistance: editDistance
  };
});
