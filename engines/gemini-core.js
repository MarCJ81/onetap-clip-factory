/* ============================================================================
   gemini-core.js · 내 무료 Gemini 키로 부르는 공용 클라이언트 (UMD, 의존성 0)
   ----------------------------------------------------------------------------
   다른 원탭 앱의 /shared/gemini.js 패턴을 이 앱에 맞게 옮긴 것.
     · x-goog-api-key 헤더로 부른다 (?key= 쿼리보다 키가 로그에 덜 남는다)
     · 모델이 없거나 종료됐으면(404·400) 다음 모델로 자동 폴백
     · 429·500·503은 잠깐 쉬었다 한 번 더 (같은 모델, 최대 2회)
     · 무료 티어 한도(429)는 그대로 알려 주고, 앱은 무료 맛보기 → 로컬 규칙으로 내려간다

   키는 이 브라우저를 떠나지 않는다. 기본은 sessionStorage(탭을 닫으면 사라짐),
   사용자가 '이 브라우저에 기억'을 고른 경우에만 localStorage에 남는다.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GeminiCore = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var KEY_SESSION = 'clip-factory.gemini.key';
  var KEY_LOCAL = 'clip-factory.gemini.remember';
  var MODEL_PREFS = 'clip-factory.gemini.model';
  var CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];
  var RETRY_DELAY_MS = 800;
  var TIMEOUT_MS = 45000;

  var state = { key: '', remember: false, model: CHAIN[0], base: BASE, proxy: '' };
  var lastCall = { at: 0, model: '', ok: false, reason: '' };
  var listeners = [];

  function trim(v) { return String(v === null || v === undefined ? '' : v).replace(/^\s+|\s+$/g, ''); }

  function readStored() {
    try {
      var local = root.localStorage ? root.localStorage.getItem(KEY_LOCAL) : '';
      if (local) { state.key = local; state.remember = true; }
      if (!state.key && root.sessionStorage) {
        var sess = root.sessionStorage.getItem(KEY_SESSION);
        if (sess) state.key = sess;
      }
      if (root.localStorage) {
        var m = root.localStorage.getItem(MODEL_PREFS);
        if (m && CHAIN.indexOf(m) >= 0) state.model = m;
      }
    } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    return state.key;
  }

  function saveKey(key, remember) {
    state.key = trim(key);
    state.remember = !!remember;
    try {
      if (root.sessionStorage) {
        if (state.key) root.sessionStorage.setItem(KEY_SESSION, state.key);
        else root.sessionStorage.removeItem(KEY_SESSION);
      }
      if (root.localStorage) {
        if (state.key && state.remember) root.localStorage.setItem(KEY_LOCAL, state.key);
        else root.localStorage.removeItem(KEY_LOCAL);
      }
    } catch (e) { /* noop */ }
    emit();
    return hasKey();
  }

  function setModel(model) {
    var m = trim(model);
    if (!m) return state.model;
    state.model = m;
    try { if (root.localStorage) root.localStorage.setItem(MODEL_PREFS, m); } catch (e) { /* noop */ }
    return state.model;
  }

  function setEndpoint(base) {
    var b = trim(base);
    state.base = b ? b.replace(/\/+$/, '') + '/' : BASE;
    return state.base;
  }

  /** CORS 때문에 직접 못 부를 때 사용자가 넣는 프록시 주소(예: 내 Worker) */
  function setProxy(url) {
    state.proxy = trim(url);
    return state.proxy;
  }

  function hasKey() { if (!state.key) readStored(); return !!state.key; }

  function maskKey(k) {
    var s = trim(k || state.key);
    if (!s) return '';
    if (s.length <= 8) return '••••';
    return s.slice(0, 4) + '••••' + s.slice(-4);
  }

  function status() {
    readStoredOnce();
    return {
      version: VERSION,
      hasKey: !!state.key,
      masked: maskKey(),
      model: state.model,
      chain: CHAIN.slice(),
      remember: state.remember,
      proxy: state.proxy,
      base: state.base,
      last: lastCall
    };
  }

  var readOnce = false;
  function readStoredOnce() { if (!readOnce) { readStored(); readOnce = true; } }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  function emit() {
    var s = status();
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](s); } catch (e) { /* noop */ } }
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function reasonText(reason, status_) {
    switch (reason) {
      case 'no_key': return 'Gemini 키가 없습니다.';
      case 'bad_key': return 'Gemini 키가 거부됐습니다(401/403). 키를 다시 확인해 주세요.';
      case 'quota': return '무료 한도를 다 썼습니다(429). 잠시 뒤나 내일 다시 시도해 주세요.';
      case 'blocked': return '요청이 안전 필터에 걸렸습니다. 문구를 바꿔 보세요.';
      case 'network': return 'Gemini에 연결하지 못했습니다. 인터넷이나 프록시 주소를 확인해 주세요.';
      case 'timeout': return 'Gemini 응답이 늦습니다. 잠시 뒤 다시 시도해 주세요.';
      case 'empty': return 'Gemini가 빈 응답을 보냈습니다.';
      case 'model_gone': return '이 모델을 쓸 수 없습니다. 설정에서 다른 모델을 골라 주세요.';
      default: return status_ ? ('Gemini 오류 ' + status_) : 'Gemini 호출에 실패했습니다.';
    }
  }

  function buildBody(payload) {
    var p = payload || {};
    var opts = p.options || {};
    var body = {
      contents: [{ role: 'user', parts: [{ text: trim(p.prompt) }] }],
      generationConfig: {
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
        maxOutputTokens: Math.max(64, Math.min(4096, Math.round(opts.maxTokens || 1800)))
      }
    };
    if (trim(p.system)) body.systemInstruction = { parts: [{ text: trim(p.system) }] };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';
    return body;
  }

  function parseText(json) {
    if (!json || typeof json !== 'object') return { text: '', reason: 'empty' };
    if (json.error) {
      var msg = json.error.message || '';
      var code = json.error.code || 0;
      var reason = code === 429 ? 'quota' : (code === 401 || code === 403) ? 'bad_key' : (code === 404 ? 'model_gone' : '');
      return { text: '', reason: reason, message: msg, code: code };
    }
    if (json.promptFeedback && json.promptFeedback.blockReason) {
      return { text: '', reason: 'blocked', message: json.promptFeedback.blockReason };
    }
    var cand = json.candidates && json.candidates[0];
    if (!cand) return { text: '', reason: 'empty' };
    var parts = (cand.content && cand.content.parts) || [];
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && typeof parts[i].text === 'string' && trim(parts[i].text)) out.push(trim(parts[i].text));
    }
    if (!out.length) {
      return { text: '', reason: cand.finishReason === 'SAFETY' ? 'blocked' : 'empty', message: cand.finishReason || '' };
    }
    return { text: out.join('\n'), finish: cand.finishReason || '' };
  }

  function callModel(model, payload, opts) {
    var o = opts || {};
    var key = state.key;
    var base = state.proxy ? (state.proxy.replace(/\/+$/, '') + '/') : state.base;
    var url = state.proxy
      ? base + encodeURIComponent(model) + ':generateContent'
      : base + encodeURIComponent(model) + ':generateContent';
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(buildBody(payload))
    };
    var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = null;
    if (controller) {
      init.signal = controller.signal;
      timer = setTimeout(function () { try { controller.abort(); } catch (e) { /* noop */ } }, o.timeoutMs || TIMEOUT_MS);
    }
    return root.fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (!res.ok) {
          var parsed = parseText(json);
          return {
            ok: false,
            status: res.status,
            reason: parsed.reason || (res.status === 400 ? 'model_gone' : ''),
            message: parsed.message || (text ? text.slice(0, 200) : '')
          };
        }
        var out = parseText(json);
        if (!out.text) return { ok: false, status: res.status, reason: out.reason, message: out.message };
        var usage = json && json.usageMetadata ? { input: json.usageMetadata.promptTokenCount || 0, output: json.usageMetadata.candidatesTokenCount || 0 } : null;
        return { ok: true, text: out.text, usage: usage, model: model };
      });
    }).catch(function (err) {
      var aborted = controller && controller.signal && controller.signal.aborted;
      return { ok: false, reason: aborted ? 'timeout' : 'network', message: (err && err.message) || '' };
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    });
  }

  /**
   * 글 생성. 모델 체인을 순서대로 시도한다.
   * @returns {Promise<{ok, text?, model?, usage?, reason?, message?, attempts?}>}
   */
  function generate(payload, opts) {
    var o = opts || {};
    readStoredOnce();
    if (!trim(state.key)) return Promise.resolve({ ok: false, reason: 'no_key', message: reasonText('no_key') });
    var chain = (o.models && o.models.length) ? o.models.slice() : [state.model].concat(CHAIN.filter(function (m) { return m !== state.model; }));
    var attempts = [];
    var i = 0;

    function nextModel() {
      if (i >= chain.length) {
        var lastFail = attempts[attempts.length - 1] || {};
        return {
          ok: false,
          reason: lastFail.reason || 'failed',
          message: reasonText(lastFail.reason, lastFail.status),
          attempts: attempts
        };
      }
      var model = chain[i++];
      var tries = 0;
      function attempt() {
        return callModel(model, payload, o).then(function (res) {
          attempts.push({ model: model, status: res.status || 0, reason: res.reason || '', ok: !!res.ok });
          if (res.ok) {
            lastCall = { at: Date.now(), model: model, ok: true, reason: '' };
            return { ok: true, mode: 'gemini-key', text: res.text, model: model, usage: res.usage, attempts: attempts };
          }
          /* 일시 오류는 같은 모델에서 한 번 더 */
          var retriable = res.reason === 'quota' || res.status === 429 || res.status === 500 || res.status === 503 || res.reason === 'network';
          if (retriable && tries < (o.retries === undefined ? 1 : o.retries)) {
            tries++;
            return wait(RETRY_DELAY_MS * tries).then(attempt);
          }
          if (res.reason === 'bad_key') {
            lastCall = { at: Date.now(), model: model, ok: false, reason: 'bad_key' };
            return { ok: false, reason: 'bad_key', message: reasonText('bad_key'), status: res.status, attempts: attempts };
          }
          /* 모델이 없거나 응답이 비면 다음 모델로 */
          lastCall = { at: Date.now(), model: model, ok: false, reason: res.reason || '' };
          return nextModel();
        });
      }
      return attempt();
    }
    return nextModel();
  }

  /** JSON 응답 전용: 코드펜스·설명이 섞여도 본문만 떼어 낸다. */
  function generateJSON(payload, opts) {
    return generate(payload, opts).then(function (res) {
      if (!res.ok) return res;
      var text = String(res.text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
      var obj = null;
      try { obj = JSON.parse(text); } catch (e) { obj = null; }
      if (!obj) {
        var m = text.match(/\{[\s\S]*\}/);
        if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
      }
      res.json = obj;
      res.text = text;
      return res;
    });
  }

  /** 키가 살아 있는지 짧게 확인 (가장 싼 모델로 1토큰) */
  function test() {
    readStoredOnce();
    if (!state.key) return Promise.resolve({ ok: false, reason: 'no_key', message: reasonText('no_key') });
    return callModel(state.model, { prompt: 'ping', options: { maxTokens: 8, temperature: 0 } }, { retries: 0 }).then(function (res) {
      if (res.ok) return { ok: true, model: res.model, message: '키가 정상 동작합니다.' };
      return { ok: false, reason: res.reason, status: res.status, message: reasonText(res.reason, res.status) };
    });
  }

  function clear() {
    state.key = '';
    state.remember = false;
    try {
      if (root.sessionStorage) root.sessionStorage.removeItem(KEY_SESSION);
      if (root.localStorage) root.localStorage.removeItem(KEY_LOCAL);
    } catch (e) { /* noop */ }
    emit();
    return true;
  }

  readStoredOnce();

  return {
    VERSION: VERSION,
    CHAIN: CHAIN,
    status: status,
    hasKey: hasKey,
    setKey: saveKey,
    clear: clear,
    setModel: setModel,
    setProxy: setProxy,
    setEndpoint: setEndpoint,
    onChange: onChange,
    generate: generate,
    generateJSON: generateJSON,
    test: test,
    reasonText: reasonText
  };
});
