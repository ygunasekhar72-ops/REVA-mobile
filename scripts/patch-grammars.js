/* Inject the legacy "tree-sitter" section into each grammar-sources package
   for tree-sitter-cli 0.22.6 (the ABI-14 forge), which requires it — modern
   grammar packages ship only tree-sitter.json, which 0.22.x does not read.
   Idempotent; run after scripts/vendor-grammars.sh. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GS = path.join(ROOT, 'grammar-sources');
if (!fs.existsSync(GS)) { console.error('no grammar-sources/'); process.exit(1); }
let patched = 0, skipped = 0;
for (const dir of fs.readdirSync(GS)) {
  const pj = path.join(GS, dir, 'package.json');
  if (!fs.existsSync(pj)) continue;
  const meta = JSON.parse(fs.readFileSync(pj, 'utf8'));
  if (meta['tree-sitter']) { skipped++; continue; }
  const lang = dir.replace(/^tree-sitter-/, '');
  meta['tree-sitter'] = [{
    scope: 'source.' + lang,
    'file-types': [lang],
    'injection-regex': '^' + lang + '$'
  }];
  fs.writeFileSync(pj, JSON.stringify(meta, null, 2) + '\n');
  patched++;
  console.log('patched ' + dir);
}
console.log('done — ' + patched + ' patched, ' + skipped + ' already had the section');
