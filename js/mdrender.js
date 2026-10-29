/* REVA — chat markdown renderer.
   markdown-it (vendored UMD, MIT) renders AI replies as real markdown;
   html:false so model output can NEVER inject raw HTML. Code fences paint
   instantly via the regex highlighter, then the vendored highlight.js
   engine swaps in (stale-guarded). The constructor is dependency-injected,
   so node tests run this exact pipeline against the real engines. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MDRENDER = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  var MD_VER = 'markdown-it 14.1.0';

  /* createInstance(MarkdownIt, esc, hl) — DI for tests; the browser path
     uses window.markdownit + util.js H.esc/H.hl. html:false is a SECURITY
     decision: markdown-it escapes raw HTML in model output. */
  function createInstance(MarkdownIt, esc, hl) {
    var md = MarkdownIt({
      html: false,        // never trust model HTML
      linkify: false,     // bare URLs stay text — tap targets are explicit links only
      breaks: true,       // chat convention: single newline breaks
      highlight: function (str, lang) {
        return hl(String(str), lang || '');
      }
    });
    /* fence rule: keep the msgcode/codecard UX (long code collapses) */
    md.renderer.rules.fence = function (tokens, idx) {
      var tok = tokens[idx];
      var lang = (tok.info || '').trim().split(/\s+/)[0] || '';
      var code = tok.content.replace(/\n$/, '');
      var lines = code.split('\n').length;
      var html = '<pre class="msgcode"><code class="language-' + esc(lang) + '">' + hl(code, lang) + '</code></pre>';
      if (lines > 12) {
        return '<details class="codecard"><summary><i data-lucide="file-code"></i>' + esc(lang || 'code') +
          ' · ' + lines + ' lines</summary>' + html + '</details>\n';
      }
      return html + '\n';
    };
    return md;
  }

  /* browser instance (lazy) */
  var _md = null;
  function instance() {
    if (typeof window === 'undefined' || !window.markdownit || typeof H === 'undefined') return null;
    if (!_md) _md = createInstance(window.markdownit, H.esc, H.hl);
    return _md;
  }

  function render(src) {
    var m = instance();
    if (!m) return null; // caller keeps the sync fallback
    try { return m.render(String(src || '')); } catch (e) { return null; }
  }

  /* swap regex-painted code blocks for engine output as languages load */
  function enhance(mdBodyEl) {
    if (!mdBodyEl || typeof window === 'undefined' || !window.HLJS) return;
    var codes = mdBodyEl.querySelectorAll('pre.msgcode code');
    for (var i = 0; i < codes.length; i++) {
      (function (code) {
        var m = /language-([\w+#.-]+)/.exec(code.className || '');
        var text = code.textContent;
        window.HLJS.highlight(text, m ? m[1] : '').then(function (html) {
          if (html && code.textContent === text) code.innerHTML = html;
        });
      })(codes[i]);
    }
  }

  return { render: render, enhance: enhance, createInstance: createInstance, MD_VER: MD_VER };
});
