/* ============================================================================
   tts.js · 더빙 3단 (UMD, 의존성 0)
   ----------------------------------------------------------------------------
   1) silent  — 0원. 소리는 없지만 자막 타이밍을 글자 수로 계산해 영상은 완성된다.
   2) browser — Web Speech API. 미리 듣기만 된다(<audio>로 녹음 불가 → 렌더 불가).
   3) fish    — Fish Audio API 키를 넣으면 s2.1-pro-free / s2.1-pro 성우 더빙.
                브라우저 직접 호출은 CORS로 막힌다. 그래서 무료 공용 프록시
                (DEFAULT_PROXY, Cloudflare Worker)를 기본으로 쓰고, 주소 칸에서
                다른 프록시로 바꿀 수 있다. 실패하면 조용히 silent로 내려간다.
   4) edge    — Microsoft Edge 신경망 성우. 키 없이 무료. 같은 프록시의
                /v1/edge-tts 가 마이크로소프트와 WebSocket 으로 붙어 MP3 를 준다.
                한국어 여성(선히)·남성(인준)과 영어 멀티링구얼 성우를 쓴다.

   키는 sessionStorage(선택 시 localStorage)에만 있고 이 브라우저를 떠나지 않는다.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ClipTts = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var FISH_ENDPOINT = 'https://api.fish.audio/v1/tts';
  // 무료 공용 프록시 (infra/fish-proxy-worker). 키를 저장하지 않고 Authorization 만 통과시킨다.
  var DEFAULT_PROXY = 'https://onetap-fish-proxy.onetap-ai.workers.dev';
  var KEY_SESSION = 'clip-factory.fish.key';
  var KEY_REMEMBER = 'clip-factory.fish.remember';
  var VOICE_PREF = 'clip-factory.fish.voice';
  var MODEL_PREF = 'clip-factory.fish.model';
  var PROXY_PREF = 'clip-factory.fish.proxy';
  var EDGE_VOICE_PREF = 'clip-factory.edge.voice';
  var EDGE_PROXY_PREF = 'clip-factory.edge.proxy';

  var EDGE_VOICES = [
    { id: 'ko-KR-SunHiNeural', label: '선히 · 한국어 여성' },
    { id: 'ko-KR-InJoonNeural', label: '인준 · 한국어 남성' },
    { id: 'ko-KR-HyunsuMultilingualNeural', label: '현수 · 한국어 남성(다국어)' },
    { id: 'en-US-EmmaMultilingualNeural', label: 'Emma · English female' },
    { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew · English male' }
  ];
  var state = {
    key: '', remember: false, voice: '', model: 's2.1-pro-free', proxy: DEFAULT_PROXY,
    edgeVoice: EDGE_VOICES[0].id, edgeProxy: DEFAULT_PROXY
  };
  var LOCAL_NONE = 'none'; // 프록시를 비우겠다는 표시(저장값 ''와 '아직 설정 안 함'을 구분)
  var loaded = false;

  function trim(v) { return String(v === null || v === undefined ? '' : v).replace(/^\s+|\s+$/g, ''); }

  function load() {
    if (loaded) return state;
    loaded = true;
    try {
      var l = root.localStorage;
      var s = root.sessionStorage;
      if (l) {
        var rk = l.getItem(KEY_REMEMBER);
        if (rk) { state.key = rk; state.remember = true; }
        var v = l.getItem(VOICE_PREF); if (v) state.voice = v;
        var m = l.getItem(MODEL_PREF); if (m) state.model = m;
        var p = l.getItem(PROXY_PREF); if (p !== null) state.proxy = p === LOCAL_NONE ? '' : p;
        var ev = l.getItem(EDGE_VOICE_PREF); if (ev) state.edgeVoice = ev;
        var ep = l.getItem(EDGE_PROXY_PREF); if (ep) state.edgeProxy = ep;
      }
      if (!state.key && s) {
        var sk = s.getItem(KEY_SESSION);
        if (sk) state.key = sk;
      }
    } catch (e) { /* noop */ }
    return state;
  }

  function save(opts) {
    load();
    var o = opts || {};
    if (o.key !== undefined) state.key = trim(o.key);
    if (o.remember !== undefined) state.remember = !!o.remember;
    if (o.voice !== undefined) state.voice = trim(o.voice);
    if (o.model !== undefined) state.model = trim(o.model) || 's2.1-pro-free';
    if (o.proxy !== undefined) state.proxy = trim(o.proxy);
    if (o.edgeVoice !== undefined) state.edgeVoice = trim(o.edgeVoice) || EDGE_VOICES[0].id;
    if (o.edgeProxy !== undefined) state.edgeProxy = trim(o.edgeProxy) || DEFAULT_PROXY;
    try {
      if (root.sessionStorage) {
        if (state.key) root.sessionStorage.setItem(KEY_SESSION, state.key);
        else root.sessionStorage.removeItem(KEY_SESSION);
      }
      if (root.localStorage) {
        if (state.key && state.remember) root.localStorage.setItem(KEY_REMEMBER, state.key);
        else root.localStorage.removeItem(KEY_REMEMBER);
        if (state.voice) root.localStorage.setItem(VOICE_PREF, state.voice);
        if (state.model) root.localStorage.setItem(MODEL_PREF, state.model);
        root.localStorage.setItem(PROXY_PREF, state.proxy || LOCAL_NONE);
        if (state.edgeVoice) root.localStorage.setItem(EDGE_VOICE_PREF, state.edgeVoice);
        if (state.edgeProxy) root.localStorage.setItem(EDGE_PROXY_PREF, state.edgeProxy);
      }
    } catch (e) { /* noop */ }
    return status();
  }

  function clear() {
    state.key = '';
    state.remember = false;
    try {
      if (root.sessionStorage) root.sessionStorage.removeItem(KEY_SESSION);
      if (root.localStorage) root.localStorage.removeItem(KEY_REMEMBER);
    } catch (e) { /* noop */ }
    return status();
  }

  function status() {
    load();
    return {
      hasKey: !!state.key,
      masked: state.key ? (state.key.slice(0, 3) + '••••' + state.key.slice(-3)) : '',
      voice: state.voice,
      model: state.model,
      proxy: state.proxy,
      proxyDefault: DEFAULT_PROXY,
      edgeVoice: state.edgeVoice || EDGE_VOICES[0].id,
      edgeProxy: state.edgeProxy || DEFAULT_PROXY,
      edgeVoices: EDGE_VOICES
    };
  }

  /** 글자 수로 읽는 시간을 어림한다 (한국어 약 5.2자/초, 여백 포함) */
  function estimateMs(text, cps) {
    var s = trim(text);
    var rate = cps || 5.2;
    if (!s) return 0;
    return Math.max(900, Math.round((s.length / rate) * 1000) + 260);
  }

  /* ── 1) Web Speech (미리 듣기 전용) ───────────────────── */
  var utter = null;

  function speechSupported() {
    return !!(root.speechSynthesis && root.SpeechSynthesisUtterance);
  }

  function pickVoice(lang) {
    if (!speechSupported()) return null;
    var voices = root.speechSynthesis.getVoices() || [];
    var want = (lang || 'ko-KR').toLowerCase();
    var ko = voices.filter(function (v) { return (v.lang || '').toLowerCase().indexOf('ko') === 0; });
    if (want.indexOf('en') === 0) {
      var en = voices.filter(function (v) { return (v.lang || '').toLowerCase().indexOf('en') === 0; });
      return en[0] || voices[0] || null;
    }
    return ko[0] || voices[0] || null;
  }

  /** 미리 듣기. 끝나면 resolve. 여러 장면을 이어 읽을 때는 speakSequence를 쓴다. */
  function speak(text, opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      if (!speechSupported()) { resolve({ ok: false, reason: 'unsupported' }); return; }
      var s = trim(text);
      if (!s) { resolve({ ok: false, reason: 'empty' }); return; }
      try { root.speechSynthesis.cancel(); } catch (e) { /* noop */ }
      var u = new root.SpeechSynthesisUtterance(s.slice(0, 600));
      var v = pickVoice(o.lang);
      if (v) u.voice = v;
      u.lang = o.lang || (v && v.lang) || 'ko-KR';
      u.rate = o.rate === undefined ? 1.02 : o.rate;
      u.pitch = o.pitch === undefined ? 1 : o.pitch;
      u.onend = function () { utter = null; resolve({ ok: true }); };
      u.onerror = function (e) { utter = null; resolve({ ok: false, reason: (e && e.error) || 'error' }); };
      utter = u;
      root.speechSynthesis.speak(u);
    });
  }

  function stopSpeaking() {
    utter = null;
    try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* noop */ }
  }

  /* ── 2) Fish Audio 더빙 ───────────────────────────────── */
  function decodeAudio(arrayBuffer) {
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return Promise.resolve(null);
    var ctx;
    try { ctx = new Ctx(); } catch (e) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var done = false;
      var closed = false;
      function finish(value) {
        if (done) return false;
        done = true;
        if (!closed) { closed = true; try { ctx.close(); } catch (e) { /* noop */ } }
        resolve(value);
        return true;
      }
      try {
        var p = ctx.decodeAudioData(arrayBuffer, function (b) { finish(b); },
          function () { finish(null); });
        if (p && typeof p.then === 'function') {
          p.then(function (b) { finish(b); }, function () { finish(null); });
        }
      } catch (e) {
        finish(null);
      }
    });
  }

  /**
   * 한 문장을 성우 음성으로. 성공하면 AudioBuffer.
   * opts: {key, model, voice, proxy, format, timeoutMs}
   */
  function synthesizeFish(text, opts) {
    load();
    var o = opts || {};
    var key = trim(o.key || state.key);
    var s = trim(text);
    if (!s) return Promise.resolve({ ok: false, reason: 'empty' });
    if (!key) return Promise.resolve({ ok: false, reason: 'no_key', message: 'Fish Audio 키가 없습니다.' });
    var proxy = trim(o.proxy === undefined ? state.proxy : o.proxy);
    var endpoint = proxy || FISH_ENDPOINT;
    var body = {
      text: s.slice(0, 1800),
      format: o.format || 'mp3',
      mp3_bitrate: 128,
      latency: 'normal',
      normalize: true
    };
    var voice = trim(o.voice || state.voice);
    if (voice) body.reference_id = voice;
    var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
      model: trim(o.model || state.model) || 's2.1-pro-free'
    };
    if (proxy) headers['x-fish-target'] = FISH_ENDPOINT;
    var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = null;
    var init = { method: 'POST', headers: headers, body: JSON.stringify(body), credentials: 'omit', mode: 'cors', cache: 'no-store' };
    if (controller) {
      init.signal = controller.signal;
      timer = setTimeout(function () { try { controller.abort(); } catch (e) { /* noop */ } }, o.timeoutMs || 60000);
    }
    return root.fetch(endpoint, init).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          return {
            ok: false,
            reason: res.status === 401 || res.status === 403 ? 'bad_key' : 'http_' + res.status,
            status: res.status,
            message: (t || '').slice(0, 200)
          };
        });
      }
      return res.arrayBuffer().then(function (buf) {
        if (!buf || !buf.byteLength) return { ok: false, reason: 'empty' };
        return decodeAudio(buf).then(function (audioBuffer) {
          if (!audioBuffer) return { ok: false, reason: 'decode', message: '음성을 해석하지 못했습니다.' };
          return { ok: true, buffer: audioBuffer, bytes: buf.byteLength, model: headers.model };
        });
      });
    }).catch(function (err) {
      var aborted = controller && controller.signal && controller.signal.aborted;
      return {
        ok: false,
        reason: aborted ? 'timeout' : 'cors',
        message: aborted ? '응답 시간이 초과됐습니다.' : proxy ?
          L('프록시(' + proxy + ')에 연결하지 못했습니다. 주소와 네트워크를 확인해 주세요.', 'Could not reach the proxy (' + proxy + '). Check the address and network.') :
          '브라우저에서 Fish Audio로 직접 연결이 막혔습니다(CORS). 프록시 주소를 비우지 말고 기본 프록시를 쓰세요.'
      };
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    });
  }

  /* ── 3) Edge TTS (무료 한국어 성우) ───────────────────── */
  /**
   * 한 문장을 키 없이 마이크로소프트 Edge 성우로. 성공하면 AudioBuffer.
   * opts: {voice, rate, pitch, volume, proxy, timeoutMs}
   */
  function synthesizeEdge(text, opts) {
    load();
    var o = opts || {};
    var s = trim(text);
    if (!s) return Promise.resolve({ ok: false, reason: 'empty' });
    var proxy = trim(o.proxy === undefined ? state.edgeProxy : o.proxy) || DEFAULT_PROXY;
    var url = proxy.replace(/\/+$/, '') + '/v1/edge-tts';
    var body = {
      text: s.slice(0, 2000),
      voice: trim(o.voice || state.edgeVoice) || EDGE_VOICES[0].id,
      rate: o.rate || '+0%',
      pitch: o.pitch || '+0Hz',
      volume: o.volume || '+0%'
    };
    var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = null;
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store'
    };
    if (controller) {
      init.signal = controller.signal;
      timer = setTimeout(function () { try { controller.abort(); } catch (e) { /* noop */ } }, o.timeoutMs || 30000);
    }
    return root.fetch(url, init).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var parsed = null;
          try { parsed = JSON.parse(t); } catch (e) { parsed = null; }
          return {
            ok: false,
            reason: (parsed && parsed.reason) || ('http_' + res.status),
            status: res.status,
            message: (parsed && parsed.message) || (t || '').slice(0, 160)
          };
        });
      }
      return res.arrayBuffer().then(function (buf) {
        if (!buf || !buf.byteLength) return { ok: false, reason: 'empty' };
        return decodeAudio(buf).then(function (audioBuffer) {
          if (!audioBuffer) return { ok: false, reason: 'decode', message: '음성을 해석하지 못했습니다.' };
          return { ok: true, buffer: audioBuffer, bytes: buf.byteLength, voice: body.voice };
        });
      });
    }).catch(function (err) {
      var aborted = controller && controller.signal && controller.signal.aborted;
      return {
        ok: false,
        reason: aborted ? 'timeout' : 'network',
        message: aborted ? '응답 시간이 초과됐습니다.' : L('무료 성우 서버(' + proxy + ')에 연결하지 못했습니다.', 'Could not reach the free voice server (' + proxy + ').')
      };
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    });
  }

  /* ── 3) 오디오 믹싱 도우미 ───────────────────────────── */

  /** 빈 스테레오 버퍼 */
  function makeBuffer(durationMs, sampleRate, channels) {
    var sr = sampleRate || 44100;
    var ch = channels || 2;
    var len = Math.max(1, Math.round((durationMs / 1000) * sr));
    try {
      return new root.AudioBuffer({ numberOfChannels: ch, length: len, sampleRate: sr });
    } catch (e) {
      var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
      return new Ctx(1, 1, sr).createBuffer(ch, len, sr);
    }
  }

  /** src 버퍼를 dst의 offsetMs 지점에 섞는다(선형 리샘플 + 페이드) */
  function placeBuffer(dst, src, offsetMs, gain, fadeMs) {
    if (!src || !dst) return;
    var sr = dst.sampleRate;
    var startFrame = Math.max(0, Math.round((offsetMs / 1000) * sr));
    var ratio = src.sampleRate / sr;
    var frames = Math.min(dst.length - startFrame, Math.round(src.length / ratio));
    if (frames <= 0) return;
    var fadeFrames = Math.max(1, Math.round(((fadeMs === undefined ? 18 : fadeMs) / 1000) * sr));
    var g = gain === undefined ? 1 : gain;
    for (var c = 0; c < dst.numberOfChannels; c++) {
      var out = dst.getChannelData(c);
      var srcData = src.getChannelData(Math.min(c, src.numberOfChannels - 1));
      for (var i = 0; i < frames; i++) {
        var pos = i * ratio;
        var i0 = Math.floor(pos);
        var frac = pos - i0;
        var a = srcData[i0] || 0;
        var b = srcData[i0 + 1] === undefined ? a : srcData[i0 + 1];
        var v = (a + (b - a) * frac) * g;
        var edge = 1;
        if (i < fadeFrames) edge = i / fadeFrames;
        else if (i > frames - fadeFrames) edge = Math.max(0, (frames - i) / fadeFrames);
        out[startFrame + i] += v * edge;
      }
    }
  }

  function L(ko, en) {
    try {
      var i18n = root.OneTapI18n;
      if (i18n && typeof i18n.lang === 'string') return i18n.lang === 'en' ? en : ko;
      var q = String((root.location && root.location.search) || '');
      if (/[?&]lang=en\b/.test(q)) return en;
      var h = root.document && root.document.documentElement;
      if (h && h.getAttribute('lang') === 'en') return en;
    } catch (e) { /* noop */ }
    return ko;
  }

  return {
    FISH_ENDPOINT: FISH_ENDPOINT,
    DEFAULT_PROXY: DEFAULT_PROXY,
    status: status,
    save: save,
    clear: clear,
    estimateMs: estimateMs,
    speechSupported: speechSupported,
    speak: speak,
    stopSpeaking: stopSpeaking,
    synthesizeFish: synthesizeFish,
    synthesizeEdge: synthesizeEdge,
    EDGE_VOICES: EDGE_VOICES,
    DEFAULT_EDGE_VOICE: EDGE_VOICES[0].id,
    decodeAudio: decodeAudio,
    makeBuffer: makeBuffer,
    placeBuffer: placeBuffer
  };
});
