/* Unit test: skillpack (js/skillpack.js) — the skills-factory data contract.
   Every skill: trigger-rich desc (the matcher scores against name+desc — a
   name-only desc can never auto-match), dense body with real code, unique
   slugs, no overlap with the pre-existing build-skill set. */
'use strict';
const assert = require('assert');
const P = require('../js/skillpack.js');

(async () => {
  const EXISTING = ['ui-design-system', 'animation-motion', 'canvas-2d-games', 'shaders-glsl', 'data-viz', 'forms-validation', 'api-integration', 'pwa-offline', 'copywriting', 'three-js-3d', 'webgl-performance', 'game-architecture', 'procedural-worlds', 'mobile-optimization', 'asset-pipeline', 'linux-toolchain'];

  // 1. batch size + shape (batches 1+2)
  const names = P.names;
  assert.strictEqual(names.length, 120, 'batches 1-6 = 120 skills, got ' + names.length);
  assert.strictEqual(new Set(names).size, names.length, 'slugs unique');
  names.forEach(n => {
    assert.ok(P.descs[n], 'desc present for ' + n);
    assert.ok(P.bodies[n], 'body present for ' + n);
  });

  // 2. no overlap with the existing build-skill set
  const clash = names.filter(n => EXISTING.indexOf(n) >= 0);
  assert.strictEqual(clash.length, 0, 'no duplicates against existing skills: ' + clash);

  // 3. trigger-rich descs: ≥6 words, distinct from the slug, real domain words
  names.forEach(n => {
    const d = P.descs[n];
    const words = d.toLowerCase().split(/\s+/).filter(Boolean);
    assert.ok(words.length >= 6, n + ' desc trigger-rich (' + words.length + ' words)');
    assert.notStrictEqual(d.toLowerCase().trim(), n, n + ' desc is not just its name');
    /* desc tokens must EXCEED the slug's own tokens (matching surface area) */
    const slugToks = n.split('-').length;
    assert.ok(words.length > slugToks, n + ' desc adds matching surface');
  });

  // 4. bodies: dense, coded, structured
  names.forEach(n => {
    const b = P.bodies[n];
    assert.ok(b.length >= 900, n + ' body dense enough (' + b.length + ' chars)');
    /* real code = JS tokens, a code fence, a CSS declaration (prop: value;)
       or CSS custom properties — data: URIs excluded by the trailing ; */
    assert.ok(/```|\bvar \b|\bfunction\b|\bconst \b|=>|\+=|\*=|\{\./.test(b) ||
      /[\w-]+\s*:\s*[^;\n]{2,};/.test(b) || /--[\w-]+/.test(b), n + ' body contains real code');
    /* organized = paragraph sections AND/OR a numbered top-level list */
    const sections = (b.match(/\n\n/g) || []).length + (b.match(/\n\d+\. /g) || []).length;
    assert.ok(sections >= 4, n + ' body has sections (' + sections + ')');
    assert.ok(/Verify|verify/.test(b), n + ' body ends with a verify step');
  });

  // 5. matching sanity: each desc carries ≥2 DISTINCTIVE tokens (not shared
  //    by >30% of the pack) — the IDF premise the matcher runs on
  const tok = s => new Set((s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 4));
  const dfs = {};
  names.forEach(n => tok(P.descs[n]).forEach(w => { dfs[w] = (dfs[w] || 0) + 1; }));
  names.forEach(n => {
    const distinctive = [...tok(P.descs[n])].filter(w => dfs[w] <= Math.max(2, names.length * 0.3)).length;
    assert.ok(distinctive >= 2, n + ' has ≥2 distinctive desc tokens (got ' + distinctive + ')');
  });

  console.log('skillpack: 5/5 scenario groups PASS (' + names.length + ' skills, ' +
    names.reduce((a, n) => a + P.bodies[n].length, 0) + ' body chars, all descs trigger-rich)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
