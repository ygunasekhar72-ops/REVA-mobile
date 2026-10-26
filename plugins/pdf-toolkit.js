/* PDF Toolkit plugin — real text extraction using poppler's pdftotext inside
   the REVA Linux guest. First use installs poppler-utils via pkg (apk). */
register({
  name: 'pdf_read',
  description: 'Extract the text of a PDF file (workspace path or /host path in REVA Linux). Uses pdftotext from poppler; installs it on first use.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, pages: { type: 'string', description: 'optional range like 1-5' } }, required: ['path'] },
  run: function (args) {
    if (!window.AgentExec) return Promise.resolve('Error: pdf_read needs the REVA Android app (agent shell)');
    var path = String(args.path || '');
    var pages = args.pages ? ' -f ' + String(args.pages).split('-')[0] + ' -l ' + String(args.pages).split('-')[1] : '';
    var toGuest = function (p) {
      if (p.indexOf('/host/') === 0) return p;
      if (p.indexOf('/') === 0) return '/host' + p; // absolute host app path
      return '/host/workspace/' + p; // relative = inside this chat's workspace
    };
    var gp = toGuest(path);
    return window.AgentExec.exec('command -v pdftotext || pkg install poppler-utils', { timeoutMs: 240000 }).then(function (r) {
      if (r.exit !== 0 && /No such file|not found/i.test(r.out || '')) return 'Error: could not install poppler-utils: ' + (r.out || '');
      return window.AgentExec.exec('pdftotext' + pages + ' -layout "' + gp.replace(/"/g, '') + '" - | head -c 16000', { timeoutMs: 120000 });
    }).then(function (r) {
      if (String(r.out || '').indexOf('Error:') === 0) return r.out;
      if (!r.out || !r.out.trim()) return 'No extractable text (scanned PDF?) — exit ' + r.exit;
      return r.out;
    });
  }
});
