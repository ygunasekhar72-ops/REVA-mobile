/* REVA — Fetch Client (original subsystems engine, subsystem #6).
   A production HTTP client the agent can import into its builds:
   - retry with exponential backoff (transient errors only)
   - single-flight dedup (concurrent GETs to the same URL share one promise)
   - interceptors: request and response transforms
   - abort propagation (AbortController per request, client-level cancel-all)
   - timeout per request
   - JSON auto-parse + error envelope normalisation
   - base URL resolution (env-config-server pattern)
   Pure UMD: identical code in node tests (with a mock fetch) and the WebView. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FETCHCLIENT = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /* createClient(opts)
     opts: { baseUrl, defaultHeaders, timeout (ms, default 15000),
             retries (default 2), retryDelay (base ms, default 500),
             requestInterceptors: [fn(config) → config],
             responseInterceptors: [fn(response) → response] } */
  function createClient(opts) {
    opts = opts || {};
    var baseUrl = opts.baseUrl || '';
    var defaultHeaders = Object.assign({}, opts.defaultHeaders);
    var defaultTimeout = opts.timeout || 15000;
    var defaultRetries = opts.retries !== undefined ? opts.retries : 2;
    var retryDelay = opts.retryDelay || 500;
    var reqInterceptors = (opts.requestInterceptors || []).slice();
    var resInterceptors = (opts.responseInterceptors || []).slice();
    var inflight = {}; // url → Promise (single-flight for GETs)
    var abortControllers = new Set();

    /* the fetch function — injectable for testing */
    var _fetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!_fetch) throw new Error('fetch is not available — provide opts.fetch for testing');

    function buildUrl(path) {
      if (/^https?:\/\//.test(path)) return path;
      if (!baseUrl) return path;
      /* resolve relative against base (URL API deep) */
      try { return new URL(path, baseUrl).href; }
      catch (e) { return baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, ''); }
    }

    function isTransient(status) {
      return status === 408 || status === 429 || status >= 500;
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    /* request(method, path, body, reqOpts) → {ok, status, data, headers, raw} */
    function request(method, path, body, reqOpts) {
      reqOpts = reqOpts || {};
      var url = buildUrl(path);
      var key = method.toUpperCase() + ' ' + url;

      /* single-flight: concurrent GETs to the same URL share one promise */
      if (method === 'GET' && inflight[key]) return inflight[key];

      var controller = new AbortController();
      abortControllers.add(controller);
      if (reqOpts.signal) {
        reqOpts.signal.addEventListener('abort', function () { controller.abort(); });
      }

      var config = {
        method: method.toUpperCase(),
        url: url,
        headers: Object.assign({}, defaultHeaders, reqOpts.headers || {}),
        body: body,
        timeout: reqOpts.timeout || defaultTimeout,
        retries: reqOpts.retries !== undefined ? reqOpts.retries : defaultRetries,
        signal: controller.signal,
        _controller: controller
      };

      /* request interceptors */
      for (var ri = 0; ri < reqInterceptors.length; ri++) {
        config = reqInterceptors[ri](config) || config;
      }

      var promise = execute(config, 0).then(function (result) {
        delete inflight[key];
        abortControllers.delete(controller);
        /* response interceptors */
        for (var rx = 0; rx < resInterceptors.length; rx++) {
          result = resInterceptors[rx](result) || result;
        }
        return result;
      }).catch(function (e) {
        delete inflight[key];
        abortControllers.delete(controller);
        throw e;
      });

      if (method === 'GET') inflight[key] = promise;
      return promise;
    }

    function execute(config, attempt) {
      var timeoutId = null;
      var fetchPromise = _fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body: config.body !== undefined ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body)) : undefined,
        signal: config.signal
      }).then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (isTransient(res.status) && attempt < config.retries) {
          var delay = retryDelay * Math.pow(2, attempt);
          return sleep(delay).then(function () { return execute(config, attempt + 1); });
        }
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { data = text; }
          var result = {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            data: data,
            headers: {},
            raw: res
          };
          res.headers.forEach(function (v, k) { result.headers[k] = v; });
          /* response interceptors */
          for (var rx = 0; rx < resInterceptors.length; rx++) {
            result = resInterceptors[rx](result) || result;
          }
          return result;
        });
      }).catch(function (e) {
        if (timeoutId) clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw e;
        /* network errors are transient — retry */
        if (attempt < config.retries) {
          var delay = retryDelay * Math.pow(2, attempt);
          return sleep(delay).then(function () { return execute(config, attempt + 1); });
        }
        throw e;
      });

      /* timeout wrapper */
      if (config.timeout > 0) {
        var origPromise = fetchPromise;
        fetchPromise = Promise.race([
          origPromise,
          new Promise(function (_, rej) {
            timeoutId = setTimeout(function () {
              if (config._controller) config._controller.abort();
              rej(new Error('timeout after ' + config.timeout + 'ms'));
            }, config.timeout);
          })
        ]);
      }

      return fetchPromise;
    }

    /* convenience methods */
    var client = {
      get: function (path, opts2) { return request('GET', path, undefined, opts2); },
      post: function (path, body, opts2) { return request('POST', path, body, opts2); },
      put: function (path, body, opts2) { return request('PUT', path, body, opts2); },
      patch: function (path, body, opts2) { return request('PATCH', path, body, opts2); },
      delete: function (path, opts2) { return request('DELETE', path, undefined, opts2); },
      request: request,

      /* addInterceptor(type, fn) — register at runtime */
      addRequestInterceptor: function (fn) { reqInterceptors.push(fn); },
      addResponseInterceptor: function (fn) { resInterceptors.push(fn); },

      /* abortAll: cancel every in-flight request */
      abortAll: function () {
        abortControllers.forEach(function (c) { c.abort(); });
        abortControllers.clear();
      },

      /* getBaseURL: for debugging */
      getBaseURL: function () { return baseUrl; }
    };

    return client;
  }

  return { createClient: createClient };
});
