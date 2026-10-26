/* HTTP Fetch plugin — registers a real `http_get` tool: raw text from any URL.
   On the Android APK requests go out directly (no CORS proxy needed). */
register({
  name: 'http_get',
  description: 'GET any URL and return the raw response text (up to 16KB). Use for REST APIs, JSON endpoints, health checks, raw files.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' }, headers_json: { type: 'string', description: 'optional JSON object of request headers' } },
    required: ['url']
  },
  run: function (args) {
    var url = String(args.url || '');
    if (!/^https?:\/\//.test(url)) return 'Error: url must start with http(s)://';
    var init = { method: 'GET', headers: {} };
    if (args.headers_json) {
      try { init.headers = JSON.parse(String(args.headers_json)); } catch (e) { return 'Error: headers_json is not valid JSON'; }
    }
    return fetch(url, init).then(function (r) {
      return r.text().then(function (t) {
        return 'HTTP ' + r.status + ' ' + (r.statusText || '') + '\n' + t.slice(0, 16384);
      });
    }).catch(function (e) {
      return 'Error: ' + (e && e.message || e) + ' (in desktop browsers this may be CORS; on the device it goes out directly)';
    });
  }
});
