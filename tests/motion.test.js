/* Motion contract test — the ZCode motion port must keep, forever:
   every new keyframe exists, every family has its reduced-motion guard,
   the token system is defined, and the hidden-document pause is wired. */
'use strict';
const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('css/motion-v2.css', 'utf8');
const app = fs.readFileSync('css/app.css', 'utf8');
const both = css + '\n' + app;
const indexHtml = fs.readFileSync('index.html', 'utf8');
const appJs = fs.readFileSync('js/app.js', 'utf8');

(async () => {
  // 1. the motion token system is defined with the four durations + beat
  assert.ok(/--mp-fast:\s*120ms/.test(css), 'fast token');
  assert.ok(/--mp-base:\s*160ms/.test(css), 'base token');
  assert.ok(/--mp-enter:\s*200ms/.test(css), 'enter token');
  assert.ok(/--mp-ink:\s*320ms/.test(css), 'ink token');
  assert.ok(/--mp-beat:\s*1\.6s/.test(css), 'heartbeat token');
  assert.ok(/--mp-ease:\s*cubic-bezier\(0\.22,\s*0\.61,\s*0\.36,\s*1\)/.test(css), 'the one easing family');

  // 2. every family keyframe exists
  const required = [
    'rv2-swap-old', 'rv2-swap-new', 'rv2-land', 'rv2-beat', 'rv2-marker-in',
    'rv2-ring', 'rv2-charge', 'rv2-countdown', 'rv2-mq', 'rv2-blink', 'rv2-hop',
    'rv2-float', 'rv2-shake'
  ];
  required.forEach(k => assert.ok(css.indexOf('@keyframes ' + k) >= 0, 'keyframes ' + k + ' missing'));

  // 3. reduced-motion guards: the file declares the media query and it
  //    mentions the flagship classes (spot-check, not exhaustive)
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(css), 'reduced-motion guard present');
  const guardZone = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
  ['rv2-beat', 'rv2-charge', 'rv2-face'].forEach(k => assert.ok(guardZone.indexOf(k) >= 0, 'guard covers ' + k));

  // 4. the hidden-document motion pause lives in the motion stylesheet
  assert.ok(css.indexOf('data-document-hidden') >= 0, 'hidden-document selector present');
  assert.ok(/animation:\s*none\s*!important/.test(css), 'pause kills animation while hidden');

  // 5. the hidden-doc attribute is actually toggled by the app
  assert.ok(appJs.indexOf('data-document-hidden') >= 0, 'app toggles the hidden attribute');
  assert.ok(appJs.indexOf("visibilitychange") >= 0, 'visibilitychange listener wired');

  // 6. stylesheet order: motion-v2.css loads after app.css (the takeover rule)
  const iApp = indexHtml.indexOf('css/app.css');
  const iMv2 = indexHtml.indexOf('css/motion-v2.css');
  assert.ok(iApp >= 0 && iMv2 > iApp, 'motion-v2.css loads after app.css');

  // 7. the face component ships in the hero empty state
  assert.ok(indexHtml.indexOf('rv2-face') >= 0, 'hero face present in the shell');

  console.log('motion: 7/7 contract checks PASS (tokens, keyframes, guards, pause, order, face)');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
