/* REVA — Permission Core (foundation ladder #5: the tool policy engine).
   A pure decision layer between the agent and the tools:
   - tool CLASSES (read / write / exec / external) with per-class defaults
   - ordered rules: first match wins — tool-level or per-argument (glob-lite
     patterns with * wildcards), decision allow | deny | ask
   - an audit ring (capped) of every decision with the rule that caused it
   - serializable (rules live in the store; the engine is stateless otherwise)
   Launch default: ALL classes allow with zero rules — the engine is inert
   until the user (or a mode) adds rules. Pure UMD. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PERMCORE = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* tool classes — the safety taxonomy. Anything unknown counts as 'exec'
     (fail closed for the dangerous default, but the launch default policy
     still allows exec, so nothing changes until rules exist). */
  var CLASSES = {
    read: 'read_file list_files workspace_search code_symbols memory_search lint test_data todo_scan word_count math_eval encode_decode diff_texts diff_words hash_text json_query csv_parse json_schema_check uuid_key test_gen cron_next text_stats rss_parse html_to_markdown markdown_to_html qr_generate mime_lookup csv_stats roman_convert list_diff sort_lines byte_size todo_write'.split(' '),
    write: 'write_file edit_file apply_patch delete_file create_directory init_project format_json checkpoint rollback optimize_image sfx image_export pdf_generation camera_capture geolocation_apps ai_chat streaming voice maps search_sys gen_art text_edit import_wiz report_gen app_update'.split(' '),
    external: 'http_request web_search web_read browser_open browser_read fetch_asset'.split(' '),
    exec: 'run_command shell_exec stop_server bg_exec run_server'.split(' ')
  };
  var CLASS_OF = {};
  Object.keys(CLASSES).forEach(function (c) {
    CLASSES[c].forEach(function (t) { CLASS_OF[t] = c; });
  });

  function classify(tool) {
    return CLASS_OF[String(tool || '')] || 'exec';
  }

  /* globToRe('npm *'): * wildcards → anchored regex (built without quote
     characters in the literal — scanner law). */
  function globToRe(pattern) {
    var src = String(pattern || '').split('').map(function (ch) {
      if (ch === '*') return '[\\s\\S]*';
      return '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
    }).join('');
    return new RegExp('^' + src + '$', 'i');
  }

  /* ruleMatches(rule, tool, args): tool-level rules match every call; rules
     with an arg constraint match only when that arg's string form matches. */
  function ruleMatches(rule, tool, args) {
    if (rule.tool !== tool) return false;
    if (!rule.arg) return true;
    var val = args ? args[rule.arg] : undefined;
    var s = (val === undefined || val === null) ? '' : String(val);
    if (rule.exact !== undefined) return s === String(rule.exact);
    if (rule.pattern) return globToRe(rule.pattern).test(s);
    return true;
  }

  function createPolicy(opts) {
    opts = opts || {};
    var defaults = Object.assign({ read: 'allow', write: 'allow', exec: 'allow', external: 'allow' }, opts.defaults || {});
    var rules = (opts.rules || []).slice();
    var audit = [];
    var AUDIT_CAP = 200;

    function decide(tool, args) {
      tool = String(tool || '');
      var matched = null;
      for (var i = 0; i < rules.length; i++) {
        if (ruleMatches(rules[i], tool, args)) { matched = rules[i]; break; }
      }
      var decision = matched ? matched.decision : (defaults[classify(tool)] || 'ask');
      var entry = {
        at: Date.now(),
        tool: tool,
        decision: decision,
        via: matched ? ('rule:' + (matched.id || i)) : 'default:' + classify(tool),
        arg: matched && matched.arg ? String(matched.arg) : undefined
      };
      audit.unshift(entry);
      if (audit.length > AUDIT_CAP) audit.length = AUDIT_CAP;
      return entry;
    }

    function addRule(rule) {
      if (!rule || !rule.tool || ['allow', 'deny', 'ask'].indexOf(rule.decision) < 0) return null;
      var r = {
        id: rule.id || 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        tool: String(rule.tool),
        decision: rule.decision
      };
      if (rule.arg) r.arg = String(rule.arg);
      if (rule.exact !== undefined) r.exact = String(rule.exact);
      if (rule.pattern) r.pattern = String(rule.pattern);
      rules.unshift(r); /* newest rules first — first match wins */
      return r;
    }
    function removeRule(id) {
      var before = rules.length;
      rules = rules.filter(function (r) { return r.id !== id; });
      return rules.length < before;
    }
    function listRules() { return rules.slice(); }
    function auditLog() { return audit.slice(); }
    function toJSON() { return { v: 1, defaults: defaults, rules: rules }; }
    function fromJSON(s) {
      if (!s || s.v !== 1) return;
      if (s.defaults) Object.assign(defaults, s.defaults);
      if (Array.isArray(s.rules)) rules = s.rules.slice();
    }

    return {
      decide: decide, classify: classify,
      addRule: addRule, removeRule: removeRule, listRules: listRules,
      auditLog: auditLog, toJSON: toJSON, fromJSON: fromJSON
    };
  }

  return { createPolicy: createPolicy, classify: classify, globToRe: globToRe, CLASSES: CLASSES };
});
