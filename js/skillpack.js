/* REVA — Skillpack batch 1 (skills factory, engine #3 of the 600K map).
   20 expert build skills merged into the seeding flow (app.js merges
   SKILLPACK.descs/bodies into BUILD_SKILL_DESCS/BUILD_SKILL_BODIES), so
   every chat's workspace gets them and load_skill/auto-match pick them up.
   Every body: a dense expert procedure — patterns, real code, pitfalls,
   and the verify step. No filler; the matcher scores against name+desc,
   so descriptions are trigger-rich by contract (tested). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SKILLPACK = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  var descs = {
    'flexbox-layouts': 'flexbox flex layout row column center align justify gap wrap navbar footer sidebar card list spacing distribute',
    'css-grid-layouts': 'css grid layout template columns rows areas gallery auto-fit minmax holy grail dashboard masonry page structure',
    'responsive-fluid-design': 'responsive mobile desktop breakpoint clamp fluid typography media query container viewport fit content adapt',
    'localstorage-state': 'localstorage persist save state session storage schema version migration json serialize quota try catch reload',
    'web-audio-synth': 'web audio oscillator synth sound music note frequency envelope gain melody beep tone waveform audiocontext schedule',
    'canvas-particles': 'particles particle emitter burst sparks smoke fire trail pool effects canvas gravity fade spawn velocity',
    'game-physics-2d': 'physics gravity velocity acceleration collision aabb circle bounce restitution friction impulse jump platformer verlet integration',
    'a-star-pathfinding': 'pathfinding a-star astar path grid maze shortest route heuristic open set closed walls enemy ai navigation',
    'game-juice': 'juice screenshake hitstop squash stretch flash freeze polish impact feedback game feel punch land dash effects',
    'procedural-dungeons': 'dungeon generator rooms corridors cave cellular automata bsp maze carve tiles level generation random walk',
    'color-theory-ui': 'color palette hue harmony contrast accessibility oklch hsl saturation tint shade dark mode scheme swatch',
    'typography-systems': 'typography font scale modular line height rhythm variable system stack serif sans reading measure hierarchy',
    'svg-craft': 'svg icon path viewBox stroke fill animate stroke-dashoffset vector logo inline sprite symbol crisp',
    'js-core-patterns': 'javascript patterns closure module class factory curry compose memoize debounce immutable pure function scope prototype',
    'async-patterns': 'async await promise all settled race queue semaphore cancellation abort retry concurrency waterfall sequential batch',
    'error-handling-ux': 'error handling try catch boundary recovery user message toast fallback graceful degradation logging honest failure',
    'date-time-mastery': 'date time countdown timer timezone intl format relative calendar duration elapsed days hours minutes localization',
    'regex-cookbook': 'regex regular expression pattern match validate email phone url slug replace capture group escaped redos safe',
    'accessibility-a11y': 'accessibility a11y aria screen reader focus keyboard contrast semantic roles alt text tab order inclusive',
    'performance-budgets': 'performance budget fps jank layout thrash reflow repaint requestanimationframe batch debounce lazy virtual list memory leak'
  };

  var bodies = {};
  bodies['flexbox-layouts'] = [
    'Flexbox solves ONE axis — rows or columns. When content wraps into multiple rows that must ALIGN, that is grid, not flex.',
    '',
    'The five patterns that cover 90% of layouts:',
    '1. Perfect centering: display:flex; align-items:center; justify-content:center on the parent.',
    '2. Bar with push-right item: .bar{display:flex; align-items:center; gap:12px} .bar .push{margin-left:auto} — margin:auto EATS free space, no spacer divs.',
    '3. Sidebar + content: .row{display:flex} .side{width:220px; flex:none} .main{flex:1; min-width:0} — min-width:0 lets content shrink instead of overflowing.',
    '4. Equal cards: .cards{display:flex; gap:16px} .card{flex:1} — different content heights stay equal because align-items defaults to stretch.',
    '5. Wrap gallery: .list{display:flex; flex-wrap:wrap; gap:10px} .item{flex:1 1 180px} — items grow to fill, wrap when under 180px.',
    '',
    'Pitfalls: gap beats margin hacks everywhere. flex:1 means flex:1 1 0 — children with long text need min-width:0 or the row overflows. align-items:center on a tall-flexing row kills stretch — set it per-row. Percentage heights inside flex children need the parent sized.',
    '',
    'Verify: squeeze to 320px — nothing may overflow; every row keeps its gap; the pushed item stays pushed.'
  ].join('\n');
  bodies['css-grid-layouts'] = [
    'Grid = two axes at once. Page shells, dashboards, galleries — grid; bars and single rows — flex.',
    '',
    'Page shell (the whole app in 5 lines):',
    'body{display:grid; grid-template-rows:auto 1fr auto; min-height:100vh} — header, flexible main, footer.',
    '',
    'Named areas (self-documenting):',
    '.app{display:grid; grid-template-areas:"side main" "side foot"; grid-template-columns:220px 1fr; gap:16px}',
    '.side{grid-area:side} — on mobile flip with one media query: grid-template-areas:"main" "side" "foot".',
    '',
    'Responsive gallery WITHOUT media queries: .gallery{display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:12px} — auto-fill packs as many 160px columns as fit; use auto-fit when few items should stretch wide.',
    '',
    'Dashboard: grid-template-columns:repeat(12, 1fr) + .card{grid-column:span 4} for weighted tiles; a featured tile gets grid-column:span 8; grid-row:span 2 for tall ones.',
    '',
    'Pitfalls: 1fr is not auto — a 1fr column with an unbreakable wide child overflows (fix minmax(0,1fr) or min-width:0). Grid items stretch by default — align-items/justify-items for exceptions. Subgrid support is good now but avoid it for compatibility.',
    '',
    'Verify: resize 320→1280px; the gallery reflows with zero breakpoints and no horizontal scrollbar.'
  ].join('\n');
  bodies['responsive-fluid-design'] = [
    'Fluid design: the layout adapts CONTINUOUSLY — breakpoints only for structural flips, not for every size.',
    '',
    'Fluid type (no breakpoint jumps): h1{font-size:clamp(1.75rem, 1rem + 3vw, 3rem)} — floor, slope, ceiling. The slope (3vw) makes it grow smoothly between them. Use the same pattern for paddings: clamp(16px, 4vw, 48px).',
    '',
    'Container-based components: .card{container-type:inline-size} on the PARENT, then @container (min-width: 420px){ .card{flex-direction:row} } — components respond to their own box, not the viewport. This kills the "widget works on the page but breaks in the sidebar" class of bug.',
    '',
    'Breakpoint policy: choose 2-3 structure flips (stack→row at ~720px, sidebar appears at ~1024px). NEVER max-width:480px{} for every tweak — that is the breakpoint zoo. Mobile-first: base styles = phone, min-width queries add complexity.',
    '',
    'The 320px audit (do it every build): set the viewport to 320px; fix EVERY horizontal overflow — long words need overflow-wrap:anywhere; tables need overflow-x:auto on a wrapper; canvases max-width:100%.',
    '',
    'Media matters: img{max-width:100%; height:auto; display:block}; prefer aspect-ratio:16/9 over fixed heights; height:100dvh for full-screen apps (100vh lies on mobile with dynamic toolbars).',
    '',
    'Verify: run_check at default (phone) width, then load at 1280px in the browser overlay — both must look intentional.'
  ].join('\n');
  bodies['localstorage-state'] = [
    'localStorage persistence that survives schema changes and quota errors:',
    '',
    'Namespacing: ONE key per app ("myapp:save:v2") — never scatter keys. Values are JSON with try/catch on BOTH directions:',
    'function load(def){ try{ var raw=localStorage.getItem(KEY); return raw? Object.assign({}, def, JSON.parse(raw)) : def; }catch(e){ return def; } }',
    'function save(st){ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){ /* quota/private mode: app still works this session */ } }',
    '',
    'Schema versioning: store {v:2, data:{...}}. On load, run migrations newest-first: if(v===1){ data.oldField = data.legacyName; v=2 } — an app that cannot read its old saves LOSES THE USER\'S WORK.',
    '',
    'Debounced writes: save() on visibilitychange and on an input debounce (400ms) — writing every keystroke wastes the main thread.',
    '',
    'Quota reality: ~5MB, strings only. Large binary/data → IndexedDB (the harness\'s own Store does this). Catching quota errors is not optional: private-mode Safari THROWS on every setItem.',
    '',
    'Pitfalls: Dates do not survive JSON (store ISO strings); undefined fields vanish (validate after load); never store derived data — recompute it. Clean up with removeItem on "reset progress".',
    '',
    'Verify: build → interact → reload the preview → state restored exactly; corrupt the raw string manually → the app boots on defaults without crashing.'
  ].join('\n');
  bodies['web-audio-synth'] = [
    'Procedural sound with the Web Audio API — no files needed:',
    '',
    'One AudioContext, created lazily on first user gesture (browsers block autoplay):',
    'var ctx; function ac(){ if(!ctx) ctx = new (window.AudioContext||window.webkitAudioContext)(); if(ctx.state==="suspended") ctx.resume(); return ctx; }',
    '',
    'A note with an envelope (the difference between a beep and an instrument):',
    'function note(freq, dur, type){ var o=ac().createOscillator(), g=ac().createGain(); o.type=type||"triangle"; o.frequency.value=freq;',
    '  g.gain.setValueAtTime(0.0001, ac().currentTime); g.gain.exponentialRampToValueAtTime(0.3, ac().currentTime+0.02);',
    '  g.gain.exponentialRampToValueAtTime(0.0001, ac().currentTime+dur); o.connect(g).connect(ac().destination); o.start(); o.stop(ac().currentTime+dur+0.05); }',
    '',
    'Notes → frequencies: f = 440 * Math.pow(2, (midi - 69) / 12). A melody = scheduled notes: note(freq, 0.15) with ctx.currentTime offsets for timing.',
    '',
    'Sound design recipes: coin = square 988Hz→1319Hz slide (o.frequency.exponentialRampToValueAtTime); explosion = white-noise buffer + lowpass sweep down; jump = triangle 150→400Hz rise in 80ms; UI click = 8ms sine blip.',
    '',
    'Pitfalls: exponentialRamp cannot hit 0 — ramp to 0.0001. Every oscillator needs start() AND stop() or they leak. Master volume: one GainNode as a compressor-lite, mute on visibilitychange.',
    '',
    'Verify: run_check with seconds:3 — the console must be clean (AudioContext warnings = creating it before a gesture).'
  ].join('\n');
  bodies['canvas-particles'] = [
    'A pooled particle system — one array, zero per-frame allocation:',
    '',
    'var parts = Array.from({length: 300}, function(){ return {x:0,y:0,vx:0,vy:0,life:0,size:0,color:""}; });',
    'function emit(x, y, n, opts){ var c=0; for(var i=0;i<parts.length && c<n;i++){ var p=parts[i]; if(p.life>0) continue; c++;',
    '  p.x=x; p.y=y; var a=Math.random()*Math.PI*2, s=(opts.speed||120)*(0.4+Math.random()*0.6);',
    '  p.vx=Math.cos(a)*s+(opts.vx||0); p.vy=Math.sin(a)*s+(opts.vy||0); p.life=p.maxLife=opts.life||0.6; p.size=opts.size||3; p.color=opts.color||"#fff"; } }',
    '',
    'Update+draw in the loop: p.life-=dt; if(p.life<=0) skip; p.vy+=opts.gravity*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; alpha=p.life/p.maxLife; ctx.globalAlpha=alpha; fillRect or arc; ctx.globalAlpha=1 after.',
    '',
    'Recipes: sparks = speed 200, life 0.4, gravity 300, color gold; smoke = speed 30, life 1.6, gravity -40 (rises), size grows over life; explosion = 24 particles + a shockwave ring (arc stroke expanding, alpha fading); trail = emit 1 particle per frame at the position.',
    '',
    'Rules: pools never grow — emit() SKIPS live particles (burst truncation is invisible at 300). Never draw with shadowBlur (it melts mobile GPUs) — fake glow with a second larger translucent circle. One system object per game, emitters as parameters.',
    '',
    'Verify: 10 bursts in a row — no frame drops, particles vanish (no zombies stuck on screen).'
  ].join('\n');
  bodies['game-physics-2d'] = [
    '2D physics that feel right — semi-implicit Euler is the workhorse:',
    'vy += gravity * dt; vy *= (1 - drag*dt); x += vx * dt; y += vy * dt;  // velocity FIRST, then position — explicit Euler explodes on bounce',
    '',
    'AABB collision + response (the platformer core): on overlap with a solid, resolve the SMALLEST penetration axis, zero that velocity component. Landing: if(pen.y < 0 && vy > 0){ y -= pen.y... grounded = true; vy = 0 }.',
    '',
    'Bounce (restitution): vy = -vy * rest with rest ~0.55 for a ball; multiply tangential velocity by (1 - friction*dt) so rolls die out. Restitution <1 everywhere or the simulation gains energy.',
    '',
    'Circle vs AABB (balls vs walls): clamp the circle center to the box (cx=clamp(x, bx, bx+bw)), if distance < r there is a hit — push out along the center-to-clamp normal, reflect velocity about it.',
    '',
    'Jump feel constants: gravity 1800-2600 px/s², jump velocity -(sqrt(2*g*jumpHeight)), variable height = cut vy*0.45 on key release, coyote time 80ms, jump buffer 100ms. These five numbers ARE platformer feel.',
    '',
    'Timestep: fixed STEP=1/60 with an accumulator (see game-architecture) — physics must be deterministic; a variable dt breaks stacks and tunnels fast bullets (fix with substeps when speed*dt > half the wall thickness).',
    '',
    'Verify: build the sandbox (a ball in a box) — it must settle to rest WITHOUT jitter after 3 seconds.'
  ].join('\n');
  bodies['a-star-pathfinding'] = [
    'A* on a grid — the enemy-AI workhorse:',
    '',
    'Node = {i, g (cost so far), f (g + h), parent}. Open set as a simple array with min-f scan (fine to ~2000 nodes); closed as a Set. Heuristic h = Manhattan distance for 4-dir movement, octile for 8-dir: dx+dy + (sqrt(2)-2)*min(dx,dy).',
    '',
    'function findPath(grid, sx, sy, tx, ty){ /* open=[{i:start,g:0,f:h}], gScore={} */ }',
    'Neighbors: 4-dir steps cost 1; diagonals cost 1.4 AND require both adjacent orthogonals open (no corner cutting through walls).',
    '',
    'Reconstruct by walking parent links from the goal, reverse, then SMOOTH: skip-ahead line-of-sight (Bresenham) removes the zigzag stair pattern — enemies walk straight lines until a wall forces a turn.',
    '',
    'Performance: run at most 1-2 paths per frame (stagger enemies across frames); cache paths until the target moves >1 tile. Grid ≤ 64x64 stays instant; bigger needs the array-scan replaced by a binary heap.',
    '',
    'Unreachable target: cap iterations (e.g. 2000 pops), return null → enemy walks toward the target greedily instead of freezing.',
    '',
    'Verify: draw the walls, click two points — the path hugs corners via smoothing and never crosses a wall; click inside a sealed area → greedy fallback, no hang.'
  ].join('\n');
  bodies['game-juice'] = [
    'Juice = the 10% of code that makes the 90% feel finished. Priority order:',
    '',
    '1. Screen shake: var shake=0; on hit shake=Math.min(8, shake+3); per frame: ctx.translate((Math.random()-0.5)*shake, ...) and shake*=Math.pow(0.001, dt) (exponential decay). NEVER random without decay — a permanently shaking camera is nausea.',
    '2. Hit-stop: freeze the game for 40-70ms on big impacts (skip update, keep render). This single trick makes hits feel MASSIVE — it is the cheapest luxury in games.',
    '3. Squash & stretch: scale the sprite — jump: 1.25x/0.75y on launch, 0.8x/1.2y for 3 frames on landing, ease back with lerp(scale, 1, dt*12).',
    '4. Flash white on damage: draw the sprite, then globalCompositeOperation="source-atop" fill white at alpha — 2 frames only.',
    '5. Particles on every event (see canvas-particles): land dust, hit sparks, death burst.',
    '',
    'Micro details: camera lerp 10%/frame; brief zoom-in on kill (1.0→1.06→1.0 over 200ms); freeze-frame + zoom = combo; slow-mo (timeScale 0.3) for 200ms on the final blow — multiply dt, never skip frames.',
    '',
    'Restraint: juice on IMPACT events only. Constant effects stop registering in 5 seconds.',
    '',
    'Verify: play 30 seconds — does hitting something FEEL heavier than before? If not, raise hit-stop before adding more particles.'
  ].join('\n');
  bodies['procedural-dungeons'] = [
    'Deterministic dungeon generation (seeded — see procedural-worlds for the RNG):',
    '',
    'Rooms + corridors (the Zelda/roguelike standard): place N=8-14 non-overlapping rects (attempt 100 times: w=4-10, h=4-8; reject if intersecting an existing room inflated by 1). Connect room centers in sequence with L-corridors (carve horizontal then vertical, 2 tiles wide so movement never snags).',
    '',
    'Cellular-automata caves (organic caverns): fill 45% walls at random (SEEDED), then 4-5 smoothing passes: a wall with ≥5 wall neighbors stays, else opens; an open with ≥4 wall neighbors becomes wall. This produces connected-looking caves; flood-fill from the largest region and fill the rest.',
    '',
    'BSP (guaranteed-clean trees): split the rect alternately at 0.35-0.65 until min size, place one room per leaf, connect siblings — the layout always connects.',
    '',
    'Populate AFTER geometry: player spawn = first room center; enemies per remaining room (1-3, distance-weighted so spawn stays safe); treasure in dead-end corridors; exit = farthest room from spawn (BFS distance).',
    '',
    'Tile → geometry: merge adjacent floor tiles into few meshes (greedy meshing) or keep tile-boxes — under 2000 boxes is fine.',
    '',
    'Verify: generate 20 seeds — zero disconnected rooms, spawn never adjacent to an enemy, every treasure reachable.'
  ].join('\n');
  bodies['color-theory-ui'] = [
    'Build palettes structurally, not by taste:',
    '',
    'HSL is the tool: hsl(H, S%, L%). One hue family: primary H; build the scale by L-steps (dark 20 → base 45 → light 85) with slight S reduction at the extremes. Dark mode: keep H, lower S ~10%, L gets INVERTED steps — never just swap two values.',
    '',
    'Harmony recipes that always work: monochrome (one H, many L — the safe default); analogous (H±30 — cohesive, needs one accent at H+180 for CTAs); complement pair (H, H+180 — use one at 90% dominance). Three+ hues = a designed system, fewer = a template.',
    '',
    'Contrast is math, not vibes: body text needs 4.5:1 against its background, large text 3:1. Grey-on-dark fails constantly — text at L≥85% on L≤20% surfaces passes. Check the ACCENT too: white text on a mid-tone accent is the classic 3.2:1 fail.',
    '',
    '60-30-10: surfaces 60%, secondary 30%, accent 10%. If everything is accent, nothing is.',
    '',
    'Semantic naming in CSS variables: --bg, --surface, --ink, --accent, --danger, --ok — components reference ROLES, never raw hex; themes become a variable swap.',
    '',
    'Verify: screenshot the app, desaturate it mentally — hierarchy must survive; run a contrast check on every text/surface pair.'
  ].join('\n');
  bodies['typography-systems'] = [
    'Type carries hierarchy — get the system right and pages look designed:',
    '',
    'Modular scale: base 16px, ratio 1.25 → 12.8 / 16 / 20 / 25 / 31 / 39. Three weights max (400/500/700). Line-height 1.5 body, 1.15-1.25 headings. Letter-spacing: slightly negative on big headings (-0.01em), never on body.',
    '',
    'Measure (line length): 45-75 characters — on a phone that means padding ≥20px around prose. max-width: 65ch on text blocks (ch = the width of "0" — it scales with the font).',
    '',
    'Fluid size without breakpoints: font-size: clamp(15px, 0.9rem + 0.6vw, 18px) for body; bigger clamps for display text. Line-height INVERSE to size: 1.6 on small, 1.1 on display.',
    '',
    'Stacks that need zero downloads: system-ui for app UI; for character, one Google Font max — pair a display face (headings) with the system stack (body) — page weight stays tiny, identity still lands. font-display: swap always.',
    '',
    'Numeric data: font-variant-numeric: tabular-nums on timers/scores/tables — digits that change width every frame look broken.',
    '',
    'Verify: squint at the page — 3 levels must survive (title vs section vs body); check the 320px audit and tabular numbers on any live counter.'
  ].join('\n');
  bodies['svg-craft'] = [
    'Inline SVG = crisp icons + animations with zero requests:',
    '',
    'Every icon: viewBox="0 0 24 24", stroke="currentColor" (inherits text color — one icon recolors everywhere), stroke-width="2", fill="none", stroke-linecap/linejoin="round". Size with width/height in CSS, never hardcode against the viewBox.',
    '',
    'Hand-built icons: grid the 24x24 mentally into 2px units; primitives first (rect/circle/line/path). A gear is a circle + 8 short lines rotated: <g transform="rotate(a 12 12)">. Paths: M moveto, L lineto, A arc, Z close — relative (lowercase) commands keep numbers small.',
    '',
    'Animations: stroke-dasharray + stroke-dashoffset draw-in (dasharray = path length, offset from length→0 with transition) — signatures, progress rings, loading spinners. CSS transform-box: fill-box; transform-origin: center makes rotate/scale behave per-shape.',
    '',
    'Sprites: define once <symbol id="ic-heart">…</symbol> in a hidden svg, use everywhere <svg><use href="#ic-heart"/></svg> — zero duplication.',
    '',
    'Pitfalls: viewBox is NOT the size (CSS sizes it); fills with currentColor for shapes, stroke for line-icons — mixing looks inconsistent; stroke-width 1.5 renders blurry at 16px — round to 2.',
    '',
    'Verify: icons at 16px, 24px, 48px — crisp at all three; recolor via CSS color on the parent — no fill="..." hardcodes.'
  ].join('\n');
  bodies['js-core-patterns'] = [
    'The patterns that separate structured code from spaghetti:',
    '',
    'Module = closure returning an API (the harness itself runs on this): (function(){ var priv = 0; function inc(){ return ++priv; } return { inc: inc }; })() — state stays private, no globals.',
    '',
    'Factory over class when objects are data: function makeEnemy(x, y){ return { x: x, y: y, hp: 10, update: updateEnemy }; } — plain objects, shared functions, no `this` confusion. Classes when you genuinely need inheritance.',
    '',
    'Memoize pure functions: var cache={}; function fib(n){ if(n<2) return n; return cache[n] || (cache[n] = fib(n-1) + fib(n-2)); } — key by JSON.stringify for object args.',
    '',
    'Debounce (wait for quiet) vs throttle (max one per window) — debounce input handlers, throttle scroll/resize: see performance-budgets for the implementations.',
    '',
    'Immutable updates kill whole bug classes: list = list.filter(x => x.id !== id); item = Object.assign({}, item, {done: true}); — never splice/mutate shared state; UI re-renders become trivial.',
    '',
    'compose/curry sparingly — readable > clever: var pipeline = function(v){ return step3(step2(step1(v))); }.',
    '',
    'Pitfalls: == coerces (use ===); var hoists (use let/const); default params beat `a = a || {}` (which fails on 0/"").',
    '',
    'Verify: any function longer than ~30 lines or nested 3+ deep is a candidate to extract — name it, test it, move on.'
  ].join('\n');
  bodies['async-patterns'] = [
    'Async beyond the basics:',
    '',
    'Promise.all — fail-fast parallel (one rejection rejects everything, others keep running orphaned). Promise.allSettled — when EVERY result matters (batch fetches): results.forEach(r => r.status === "fulfilled" ? use(r.value) : log(r.reason)).',
    '',
    'Sequential vs parallel matters: for..of + await = sequential (ordered API writes); Promise.all(items.map(fetch)) = parallel (independent reads). ten 100ms calls: 1s vs 100ms.',
    '',
    'Cancellation: AbortController — pass signal to fetch; controller.abort() on unmount/new-search. The classic bug: a slow response from a PREVIOUS search overwrites the fresh one (store the controller, compare generation ids).',
    '',
    'Timeout wrapper: function withTimeout(p, ms){ return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]); } — every network call gets one.',
    '',
    'Concurrency semaphore (max N in flight): a simple counter + wait queue — parallel uploads without melting the connection. Retry with backoff: attempt, catch, delay 500*2^n, max 3, only on transient errors.',
    '',
    'Pitfalls: async functions ALWAYS return promises (await them); an async error is swallowed until awaited — top-level .catch or try/catch inside; forEach ignores awaits (use for..of).',
    '',
    'Verify: kill the network mid-flow — the UI shows an error + retry, no spinner hangs forever, no stale data overwrites fresh.'
  ].join('\n');
  bodies['error-handling-ux'] = [
    'Errors are a feature surface — design them:',
    '',
    'Taxonomy: EXPECTED (bad input, network down, empty results) gets inline UI; UNEXPECTED (bugs, invariant breaks) gets caught + logged + an honest generic message. Treating bugs as user input errors (or vice versa) is how apps feel broken.',
    '',
    'The honest message formula: what happened + why + what to do. "Could not save — you appear to be offline. Your edits are kept; try again when connected." Never raw codes alone ("Error: 500"), never blame ("You broke it").',
    '',
    'Where errors live: field errors inline at the input; section errors as a banner with Retry; global failures as a toast + state preserved. NEVER alert() in a loop; never a modal for something a banner solves.',
    '',
    'Recovery beats reporting: save state BEFORE risky operations (the harness checkpoints for the same reason); Retry buttons re-run the exact failed step; optimistic UI rolls back visibly on failure.',
    '',
    'Boundaries: wrap event handlers and async chains — one uncaught rejection in a game loop kills every frame after it: try { update(dt) } catch(e){ console.error(e); pause(); showOops(e); }.',
    '',
    'Log with context (what, where, inputs) — console.error at minimum; the run_check tool surfaces these, so a clean console IS the verify step.',
    '',
    'Verify: break each dependency deliberately (offline, corrupt storage, empty data) — every one shows the designed message, never a blank screen or an infinite spinner.'
  ].join('\n');
  bodies['date-time-mastery'] = [
    'Dates: everything is an ISO string in storage, a Date object in memory, Intl for display:',
    '',
    'Storage: new Date().toISOString() — parse with new Date(str). NEVER store locale strings ("10/31/2026" parses differently by browser).',
    '',
    'Countdown/timer (the classic): const end = Date.now() + 90*1000; per frame: const left = Math.max(0, end - Date.now()); mm:ss = String(Math.floor(left/60000)).padStart(2,"0") + ":" + ... — store the END, not the remaining value (a stored remaining value freezes when the tab throttles).',
    '',
    'Relative time ("2h ago"): Math.round((Date.now() - then) / 60000) → minutes; buckets: <1 "just now", <60 "Nm ago", <1440 "Nh ago", else "Nd ago" — or Intl.RelativeTimeFormat (built in, localizes free).',
    '',
    'Display: Intl.DateTimeFormat(locale, {dateStyle:"medium", timeStyle:"short"}) — never hand-rolled month arrays; toLocaleDateString(undefined, {weekday:"short", day:"numeric", month:"short"}) for compact lists.',
    '',
    'Pitfalls: months are 0-indexed (Date(2026, 10, 31) is NOVEMBER 31 → Dec 1); getDay() is 0=Sunday; comparing dates needs .getTime(); "today" boundaries use local midnight, not UTC.',
    '',
    'Verify: set the device clock forward a day — countdowns hold, "ago" labels shift, nothing NaNs.'
  ].join('\n');
  bodies['regex-cookbook'] = [
    'Practical validation patterns — and knowing their limits:',
    '',
    'Trusted workhorses: slug /^[a-z0-9-]+$/; hex color /^#([0-9a-f]{3}|[0-9a-f]{6})$/i; digits-only /^\\d+$/; username /^[a-z0-9_]{3,20}$/. These define formats — they are exact and safe.',
    '',
    'Email: FULL validation is impossible with regex (the RFC is a turing swamp). Ship /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/ (structure sanity), then VERIFY by sending a confirmation. Long regexes that "fully validate" email are a Red Flag, not a feature.',
    '',
    'URL: prefer new URL(str) (built-in parser, throws on garbage) over any regex. Extract parts from URL: url.pathname, url.searchParams.get("q") — no regex needed.',
    '',
    'Escaping user text into a regex: str.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") — building RegExp from UNESCAPED user input breaks or worse (the harness wraps this in one bounded doorway for the same reason).',
    '',
    'ReDoS awareness: nested quantifiers on overlapping classes ((a+)+$) explode on crafted input. Never accept a regex pattern from users and run it on long strings without a length cap.',
    '',
    'Greedy vs lazy: <.*> eats to the LAST >; <.*?> stops at the first. Parsing HTML with regex is always wrong — use the DOM.',
    '',
    'Verify: test the TRUE negatives (empty, unicode, spaces) not just positives — a validator that never rejects is decoration.'
  ].join('\n');
  bodies['accessibility-a11y'] = [
    'Accessibility is correctness, not charity — and most of it is free:',
    '',
    'Semantics first: button for actions, a[href] for navigation, label for every input (for=id), heading order h1→h2→h3 without skips, nav/main/footer landmarks. A clickable div is a bug — it is invisible to keyboards and screen readers.',
    '',
    'Keyboard: everything reachable by Tab in a sane order; visible focus (:focus-visible with a 2px outline — never outline:none); Enter activates buttons; Escape closes modals. Test: unplug the mouse, use the app.',
    '',
    'ARIA is for the REMAINING gaps: aria-label on icon-only buttons ("Close", not "X"); aria-live="polite" on toasts/status so changes get announced; role only when semantics fail. Wrong ARIA is worse than none.',
    '',
    'Images: alt text describing PURPOSE ("Team score: 12" not "image"); alt="" for decoration. Contrast 4.5:1 body / 3:1 large (see color-theory-ui).',
    '',
    'Focus management in modals: on open, focus the first control; trap Tab inside; on close, restore focus to the trigger. Losing focus after a modal = keyboard users lost on the page.',
    '',
    'Motion: @media (prefers-reduced-motion: reduce){ *{animation:none!important; transition:none!important} } — vestibular disorders are real; the harness itself guards every animation with this.',
    '',
    'Verify: tab through the whole flow (eyes closed test — can you fill the form?); check contrast on every text pair; run with animations off.'
  ].join('\n');
  bodies['performance-budgets'] = [
    'Performance = keeping the frame budget (16.6ms) and not doing work you skipped:',
    '',
    'Layout thrash (the #1 web perf bug): interleaved reads/writes force reflow each time. BATCH: read all (offsetWidth, getBoundingClientRect) THEN write all. Writing styles inside a read loop is a guaranteed jank.',
    '',
    'rAF batching: DOM/canvas work happens in requestAnimationFrame callbacks; resize/scroll/pointermove get THROTTLED through rAF: var queued=false; addEventListener("scroll", function(){ if(queued) return; queued=true; requestAnimationFrame(function(){ work(); queued=false; }); }).',
    '',
    'Debounce inputs: function debounce(fn, ms){ var t; return function(){ var a=arguments, s=this; clearTimeout(t); t=setTimeout(function(){ fn.apply(s, a); }, ms); }; } — search-as-you-type at 250ms, autosave at 800ms.',
    '',
    'Lazy everything below the fold: content-visibility:auto on long lists (instant); images loading="lazy" + width/height set (no layout shift); heavy init deferred with setTimeout(…, 0) or requestIdleCallback.',
    '',
    'Memory leaks = detached DOM + forgotten timers/listeners: every setInterval/addEventListener on a temp element needs its clear/remove on teardown; re-rendered lists must remove old listeners. A tab that climbs 20MB/min is a leak.',
    '',
    'Measure honestly: performance.now() around suspicious blocks; the console timeline shows long tasks; on canvas, a dropped-frame counter (see webgl-performance).',
    '',
    'Verify: scroll the longest list at phone speed — zero stutter; open + close a heavy view 10 times — memory returns.'
  ].join('\n');

  return { descs: descs, bodies: bodies, names: Object.keys(bodies) };
});
