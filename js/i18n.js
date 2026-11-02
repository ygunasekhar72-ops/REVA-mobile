/* REVA — i18n Engine (original subsystems engine, subsystem #10).
   Translation + locale formatting for the harness and built projects:
   - flat-key catalogs with a locale fallback chain (pt-BR -> pt -> en)
   - {name} interpolation with optional HTML escaping (model/user data never
     lands raw in markup)
   - plural CATEGORIES (zero/one/two/few/many/other) with real CLDR-style
     rules for the common families: english (one/other), french (one includes
     0), slavic (one/few/many), arabic (all six)
   - number/currency/percent formatting by locale group (grouping + decimal
     separators + symbol placement), no Intl dependency (works everywhere)
   - bestLocale negotiation: exact > prefix > fallback
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* locale groups: groupingChar + decimalChar. Everything not listed = en-style. */
  var GROUPS = {
    en: [',', '.'], ja: [',', '.'], ko: [',', '.'], zh: [',', '.'], hi: [',', '.'],
    de: ['.', ','], es: ['.', ','], it: ['.', ','], nl: ['.', ','], tr: ['.', ','],
    pt: ['.', ','], da: ['.', ','], sv: ['.', ','], pl: ['.', ','], ru: [' ', ','],
    fr: [' ', ','], fi: [' ', ','], sv2: [' ', ',']
  };

  /* plural category per count. Returns 'zero'|'one'|'two'|'few'|'many'|'other'. */
  function pluralCategory(locale, count) {
    var lang = String(locale || 'en').split('-')[0];
    var n = Math.abs(count);
    var i = Math.floor(n);
    if (lang === 'ar') {
      if (n === 0) return 'zero';
      if (n === 1) return 'one';
      if (n === 2) return 'two';
      if (i >= 3 && i <= 10) return 'few';
      if (i >= 11 && i <= 99) return 'many';
      return 'other';
    }
    if (lang === 'ru' || lang === 'uk') {
      var mod10 = i % 10, mod100 = i % 100;
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';
    }
    if (lang === 'pl') {
      var m10 = i % 10, m100 = i % 100;
      if (i === 1) return 'one';
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
      return 'many';
    }
    if (lang === 'fr') {
      return (i === 0 || i === 1) ? 'one' : 'other';
    }
    if (lang === 'ja' || lang === 'zh' || lang === 'ko' || lang === 'th' || lang === 'vi') {
      return 'other'; /* no inflection */
    }
    return n === 1 ? 'one' : 'other'; /* en, es, de, … */
  }

  function interpolate(str, params, sanitize) {
    return String(str).replace(/\{(\w+)\}/g, function (whole, name) {
      if (!params || !(name in params)) return whole; /* keep the slot visible */
      var v = params[name];
      if (sanitize && typeof v === 'string') {
        return v.replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
      return String(v);
    });
  }

  function createI18n(opts) {
    opts = opts || {};
    var locale = opts.locale || 'en';
    var fallback = opts.fallback || 'en';
    var catalogs = opts.catalogs || {}; /* locale -> { key: string | pluralObj } */
    var sanitize = opts.sanitize !== false;
    var listeners = [];
    var missing = []; /* every (locale, key) miss, for tooling/QA */

    function lookup(loc, key) {
      var cat = catalogs[loc];
      if (cat && Object.prototype.hasOwnProperty.call(cat, key)) return cat[key];
      return undefined;
    }

    /* the fallback chain: pt-BR -> pt -> en (deduped, order-stable) */
    function chain() {
      var locs = [locale];
      if (locale.indexOf('-') >= 0) locs.push(locale.split('-')[0]);
      if (locs.indexOf(fallback) < 0) locs.push(fallback);
      if (fallback.indexOf('-') >= 0) {
        var fb = fallback.split('-')[0];
        if (locs.indexOf(fb) < 0) locs.push(fb);
      }
      return locs;
    }

    /* t(key, params): resolve through the fallback chain, interpolate.
       Misses call onMissing and return the KEY ITSELF (never empty markup). */
    function t(key, params) {
      var v, locs = chain();
      for (var i = 0; i < locs.length && v === undefined; i++) v = lookup(locs[i], key);
      if (v === undefined) {
        missing.push({ locale: locale, key: key });
        if (opts.onMissing) opts.onMissing(key, locale);
        return key;
      }
      if (typeof v !== 'string') {
        /* a plural object handed to t(): the 'other' form is the neutral one */
        v = (v && typeof v.other === 'string') ? v.other : key;
      }
      return interpolate(v, params, sanitize);
    }

    /* plural(key, count, params): category lookup. The resolved entry may be
       a string (uninflected) — then it is used for every count. {n} and
       {count} slots are injected automatically. */
    function plural(key, count, params) {
      var p = Object.assign({}, params, { n: count, count: count });
      var entry, locs = chain();
      for (var i = 0; i < locs.length && entry === undefined; i++) entry = lookup(locs[i], key);
      if (entry === undefined) {
        missing.push({ locale: locale, key: key });
        if (opts.onMissing) opts.onMissing(key, locale);
        return interpolate(key, p, sanitize);
      }
      if (typeof entry === 'string') return interpolate(entry, p, sanitize);
      var cat = pluralCategory(locale, count);
      var form = (entry && entry[cat] !== undefined) ? entry[cat]
               : (entry && entry.other !== undefined) ? entry.other
               : key;
      return interpolate(form, p, sanitize);
    }

    function mergeCatalog(loc, partial) {
      if (!catalogs[loc]) catalogs[loc] = {};
      Object.keys(partial || {}).forEach(function (k) { catalogs[loc][k] = partial[k]; });
    }

    function setLocale(loc) {
      if (loc === locale) return;
      locale = loc;
      listeners.forEach(function (fn) { try { fn(loc); } catch (_) {} });
    }

    /* bestLocale(available, requested[]): exact match > language-prefix match
       (pt-BR request takes pt; pt request takes pt-BR) > fallback. */
    function bestLocale(available, requested) {
      var req = requested || [];
      for (var r = 0; r < req.length; r++) {
        var want = String(req[r] || '');
        if (available.indexOf(want) >= 0) return want;
        var base = want.split('-')[0];
        for (var a = 0; a < available.length; a++) {
          if (available[a].split('-')[0] === base) return available[a];
        }
      }
      return fallback;
    }

    function fmtParts(loc) {
      var lang = String(loc || 'en').split('-')[0];
      return GROUPS[lang] || [',', '.'];
    }

    /* formatNumber('de', 1234.5, {decimals: 1}) -> '1.234,5' */
    function formatNumber(loc, n, o) {
      o = o || {};
      var dec = o.decimals;
      var neg = n < 0;
      var fixed = (dec !== undefined ? Math.abs(n).toFixed(dec) : String(Math.abs(n)));
      var dot = fixed.indexOf('.');
      var intPart = dot >= 0 ? fixed.slice(0, dot) : fixed;
      var fracPart = dot >= 0 ? fixed.slice(dot + 1) : '';
      var gp = fmtParts(loc);
      var grouped = '';
      for (var i = 0; i < intPart.length; i++) {
        var fromEnd = intPart.length - i;
        grouped += intPart[i];
        if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) grouped += gp[0];
      }
      var out = grouped + (fracPart ? gp[1] + fracPart : '');
      return (neg ? '-' : '') + out;
    }

    /* formatCurrency('de', 1234.5, 'EUR') -> '1.234,50 €' */
    var SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹' };
    function formatCurrency(loc, n, cur) {
      var sym = SYMBOLS[cur] || cur;
      var lang = String(loc || 'en').split('-')[0];
      var num = formatNumber(loc, n, { decimals: cur === 'JPY' ? 0 : 2 });
      var before = (lang === 'en' || lang === 'ja' || lang === 'zh' || cur === 'USD' || cur === 'GBP' || cur === 'JPY' || cur === 'INR');
      if (cur === 'INR') before = true;
      if (lang === 'en' && cur === 'USD') return sym + num;      /* $1,234.56 */
      if (before) return sym + num;
      return num + ' ' + sym;                                     /* 1.234,56 € */
    }

    /* formatPercent('fr', 0.123, 1) -> '12,3 %' */
    function formatPercent(loc, ratio, decimals) {
      return formatNumber(loc, ratio * 100, { decimals: decimals }) + ' %';
    }

    return {
      t: t, plural: plural, pluralCategory: pluralCategory,
      mergeCatalog: mergeCatalog, setLocale: setLocale,
      getLocale: function () { return locale; },
      bestLocale: bestLocale,
      formatNumber: formatNumber, formatCurrency: formatCurrency, formatPercent: formatPercent,
      onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
      missingKeys: function () { return missing.slice(); }
    };
  }

  return {
    createI18n: createI18n,
    pluralCategory: pluralCategory,
    bestLocale: function (available, requested, fallback) {
      var i = createI18n({ fallback: fallback || 'en' });
      return i.bestLocale(available, requested);
    }
  };
});
