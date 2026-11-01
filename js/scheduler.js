/* REVA — Task Scheduler Engine (original subsystems engine, subsystem #9).
   A cron-capable scheduler for the harness's deferred work: the goal loop's
   queued follow-ups, quota-window resets, any recurring chore. Features:
   - cron-style 5-field expressions (min hour dom mon dow) with * / , - and
     the vixie semantics (dom+dow both restricted = OR)
   - next-run computed as ABSOLUTE wall-clock targets — no setInterval drift
   - one-off timers ({at}), fixed intervals ({every}) and cron tasks
   - missed-run policy per task: 'skip' (recompute from now) or 'once' (fire
     once at the next tick) — mobile OSes freeze WebView timers for hours,
     so this is a first-class concern, not an edge case
   - injectable clock for deterministic tests; serializable task records
   Pure UMD: identical code in node tests and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCHEDULER = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* expandField('*&#47;15', 0, 59) -> [0,15,30,45]; supports *, a, a-b, a/step,
     *&#47;step, a-b/step, comma lists ( '&#47;' = the slash ). Values outside
     [min,max] throw. */
  function expandField(field, min, max) {
    var out = [];
    String(field).split(',').forEach(function (item) {
      var step = 1, range = item, m;
      if (item.indexOf('/') >= 0) {
        m = item.split('/');
        range = m[0];
        step = parseInt(m[1], 10);
        if (!step || step < 1) throw new Error('cron step must be >= 1: ' + item);
      }
      var lo, hi;
      if (range === '*') { lo = min; hi = max; }
      else if (range.indexOf('-') >= 0) {
        var p = range.split('-');
        lo = parseInt(p[0], 10); hi = parseInt(p[1], 10);
      } else {
        lo = parseInt(range, 10);
        if (isNaN(lo)) throw new Error('cron bad value: ' + item);
        hi = step > 1 ? max : lo; /* vixie: "5/15" means 5-max step 15 */
      }
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi) {
        throw new Error('cron value out of range [' + min + '-' + max + ']: ' + item);
      }
      for (var v = lo; v <= hi; v += step) out.push(v);
    });
    var sorted = out.sort(function (a, b) { return a - b; });
    return sorted.filter(function (v, i) { return i === 0 || sorted[i - 1] !== v; });
  }

  /* parseCron('every-5-min 9-17 * * 1-5') -> {mins, hours, doms, months, dows,
     domRestricted, dowRestricted}. Dow 7 folds to 0 (Sunday). */
  function parseCron(expr) {
    var parts = String(expr).trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('cron needs 5 fields: ' + expr);
    return {
      mins: expandField(parts[0], 0, 59),
      hours: expandField(parts[1], 0, 23),
      doms: expandField(parts[2], 1, 31),
      months: expandField(parts[3], 1, 12),
      dows: expandField(parts[4], 0, 7).map(function (d) { return d % 7; }),
      domRestricted: parts[2] !== '*',
      dowRestricted: parts[4] !== '*'
    };
  }

  /* cronNext(expr, from): next matching minute >= from+1min, or null if no
     match within a leap-year cycle. Field-jumping search (not minute-by-minute). */
  function cronNext(expr, from) {
    var c = parseCron(expr);
    var t = new Date(from instanceof Date ? from.getTime() : from);
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() + 1);
    var limit = 366 * 24 * 60; /* a full leap-year of minutes, worst case */
    while (limit-- > 0) {
      if (c.months.indexOf(t.getMonth() + 1) < 0) {
        /* jump to the 1st of the next month, 00:00 */
        t.setMonth(t.getMonth() + 1, 1);
        t.setHours(0, 0, 0, 0);
        continue;
      }
      var domHit = c.doms.indexOf(t.getDate()) >= 0;
      var dowHit = c.dows.indexOf(t.getDay()) >= 0;
      var dayOk = (c.domRestricted && c.dowRestricted) ? (domHit || dowHit)
                : c.domRestricted ? domHit
                : c.dowRestricted ? dowHit
                : true;
      if (!dayOk) {
        t.setDate(t.getDate() + 1);
        t.setHours(0, 0, 0, 0);
        limit -= 59; /* we just skipped up to 59 minutes */
        continue;
      }
      if (c.hours.indexOf(t.getHours()) < 0) {
        t.setHours(t.getHours() + 1, 0, 0, 0);
        continue;
      }
      if (c.mins.indexOf(t.getMinutes()) < 0) { t.setMinutes(t.getMinutes() + 1); continue; }
      return t.getTime();
    }
    return null;
  }

  /* createScheduler(opts): opts = { tickMs, now(), onError(err, taskName) }
     Task definitions: { at: ms } | { every: ms } | { cron: expr },
     plus runMissed: 'skip' (default) | 'once'. */
  function createScheduler(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var tasks = {}; /* name -> { def, fn, nextRun, target } */
    var timer = null;

    function ensureFuture(next, def) {
      /* runMissed policy: a nextRun already in the past is either skipped
         (recompute from now) or kept (fires once at the very next tick) */
      if (next > now()) return next;
      if (def && def.runMissed === 'once') return now(); /* fire at next tick */
      if (def.cron) { var n = cronNext(def.cron, now()); if (n) return n; }
      if (def.every) return now() + def.every;
      return null; /* one-off in the past: dropped */
    }

    function schedule(name, fn, def) {
      if (typeof fn !== 'function') throw new Error('scheduler needs a function: ' + name);
      def = def || {};
      var next;
      if (def.at !== undefined) {
        next = def.at;
      } else if (def.cron) {
        next = cronNext(def.cron, now());
        if (!next) throw new Error('cron never matches within a year: ' + def.cron);
      } else if (def.every) {
        next = now() + def.every;
      } else {
        throw new Error('scheduler task needs at|cron|every: ' + name);
      }
      next = ensureFuture(next, def);
      if (next === null) return null; /* stale one-off: not scheduled */
      tasks[name] = { def: def, fn: fn, nextRun: next, target: next };
      return next;
    }

    function cancel(name) { var had = !!tasks[name]; delete tasks[name]; return had; }
    function pending() { return Object.keys(tasks).length; }
    function list() {
      return Object.keys(tasks).map(function (name) {
        var t = tasks[name];
        return { name: name, def: t.def, nextRun: t.nextRun };
      });
    }

    /* tick(t): fire every task whose nextRun <= t, oldest target first.
       Handler isolation: a throwing fn never breaks the loop. Returns the
       fired task names in fire order. */
    function tick(t) {
      if (t === undefined) t = now();
      var due = Object.keys(tasks).filter(function (name) { return tasks[name].nextRun <= t; });
      due.sort(function (a, b) { return tasks[a].nextRun - tasks[b].nextRun; });
      var fired = [];
      due.forEach(function (name) {
        var task = tasks[name];
        if (!task) return; /* a one-off cancelled mid-tick */
        try { task.fn(t); } catch (e) { if (opts.onError) opts.onError(e, name); }
        fired.push(name);
        if (task.def.at !== undefined) { delete tasks[name]; return; }
        if (task.def.every) {
          /* drift-correcting: anchored to the previous TARGET, not the fire
             time — and a long freeze resyncs instead of burst-firing */
          task.target = task.target + task.def.every;
          var missed = 0;
          while (task.target <= t && missed < 4) { task.target += task.def.every; missed++; }
          if (task.target <= t) task.target = t + task.def.every;
          task.nextRun = task.target;
        }
        if (task.def.cron) {
          var n = cronNext(task.def.cron, t);
          if (n) task.nextRun = n; else delete tasks[name];
        }
        if (opts.onFire) opts.onFire(name, t);
      });
      return fired;
    }

    function start() {
      if (timer) return;
      timer = setInterval(function () { tick(); }, opts.tickMs || 1000);
      if (timer.unref) timer.unref();
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    /* Persistence: fns are not serializable — toJSON returns the records,
       fromJSON restores them with fn=null; the caller re-registers fns by
       scheduling the same name again (upsert). */
    function toJSON() {
      return Object.keys(tasks).map(function (name) {
        var t = tasks[name];
        return { name: name, def: t.def, nextRun: t.nextRun };
      });
    }
    function fromJSON(records) {
      (records || []).forEach(function (r) {
        if (!r || !r.name || !r.def) return;
        var next = r.nextRun;
        if (r.def.at !== undefined && next <= now()) return; /* stale one-off: dropped */
        if (next <= now()) {
          if (r.def.runMissed === 'once') next = now(); /* fires next tick */
          else if (r.def.cron) { next = cronNext(r.def.cron, now()); if (!next) return; }
          else if (r.def.every) next = now() + r.def.every;
          else return;
        }
        tasks[r.name] = { def: r.def, fn: null, nextRun: next, target: next };
      });
    }

    return { schedule: schedule, cancel: cancel, pending: pending, list: list,
             tick: tick, start: start, stop: stop, toJSON: toJSON, fromJSON: fromJSON };
  }

  return { parseCron: parseCron, cronNext: cronNext, createScheduler: createScheduler };
});
