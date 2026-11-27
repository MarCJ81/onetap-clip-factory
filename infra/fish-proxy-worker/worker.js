/* ============================================================================
   onetap-fish-proxy · Fish Audio TTS 용 무료 CORS 프록시 (Cloudflare Worker)
   ----------------------------------------------------------------------------
   목적
     29호기 '원탭 클립 팩토리'(https://marcj81.github.io/onetap-clip-factory/)가
     브라우저에서 https://api.fish.audio/v1/tts 를 직접 부르면 CORS 로 막힌다.
     이 Worker 가 그 요청을 대신 받아 Fish Audio 로 넘기고, 응답 오디오에
     CORS 헤더를 붙여 돌려준다.

   한 줄 원칙
     - 서버에 API 키를 저장하지 않는다. 브라우저가 보낸 Authorization 헤더를
       그대로 통과시키기만 한다(키는 사용자의 브라우저에만 있다).
     - 아무 주소로나 넘겨 주는 열린 프록시가 아니다. 목적지는 api.fish.audio 의
       TTS 경로 하나로 고정한다.
     - 허용한 출처(29호기 GitHub Pages + 로컬 개발)만 받는다.

   인터페이스
     GET  /                → 상태 JSON (배포 확인용)
     OPTIONS *             → 204 + CORS 프리플라이트 헤더
     POST /v1/tts | /      → https://api.fish.audio/v1/tts 로 중계 (오디오 스트림)
   ========================================================================== */

const VERSION = '1.0.0';
const SERVICE = 'onetap-fish-proxy';
const FISH_ORIGIN = 'https://api.fish.audio';
const FISH_TTS = FISH_ORIGIN + '/v1/tts';

// 이 출처에서 온 브라우저 요청만 받는다. GitHub Pages 는 경로와 무관하게 출처가 하나다.
const ALLOWED_ORIGINS = [
  'https://marcj81.github.io',
  'https://marcj81.github.io/onetap-clip-factory'
];

// 로컬에서 index.html 을 열어 시험할 때 (포트는 아무거나)
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  if (LOCAL_ORIGIN.test(origin)) return true;
  if (origin === 'null') return true; // file:// 로 연 로컬 사본
  return false;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, model, x-fish-target',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'content-type, content-length',
    'Vary': 'Origin'
  };
}

function json(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status: status, headers: headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // 프리플라이트
    if (request.method === 'OPTIONS') {
      if (!originAllowed(origin)) {
        return new Response(null, { status: 403, headers: { 'Vary': 'Origin' } });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // 배포 확인용 상태 페이지 (브라우저에서 주소만 열어도 보인다)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        service: SERVICE,
        version: VERSION,
        target: FISH_TTS,
        allowedOrigins: ALLOWED_ORIGINS,
        storesKeys: false
      }, 200, originAllowed(origin) ? origin : '');
    }

    if (request.method !== 'POST') {
      return json({ ok: false, reason: 'method_not_allowed', message: 'POST 만 받습니다.' }, 405,
        originAllowed(origin) ? origin : '');
    }

    // 출처가 허용 목록에 없으면 중계하지 않는다 (CORS 헤더도 주지 않는다)
    if (!originAllowed(origin)) {
      return json({ ok: false, reason: 'origin_not_allowed', message: '허용되지 않은 출처입니다.' }, 403, '');
    }

    // 경로는 /v1/tts 또는 / 만
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== '' && path !== '/v1/tts' && path !== '/tts') {
      return json({ ok: false, reason: 'not_found', message: '지원하지 않는 경로입니다. /v1/tts 로 보내 주세요.' }, 404, origin);
    }

    // 목적지는 x-fish-target 이 있으면 받되, api.fish.audio 의 TTS 만 허용
    let target = FISH_TTS;
    const rawTarget = (request.headers.get('x-fish-target') || '').trim();
    if (rawTarget) {
      let t = null;
      try { t = new URL(rawTarget); } catch (e) { t = null; }
      if (!t || t.protocol !== 'https:' || t.hostname !== 'api.fish.audio' || t.pathname !== '/v1/tts') {
        return json({ ok: false, reason: 'bad_target', message: 'x-fish-target 은 https://api.fish.audio/v1/tts 만 허용합니다.' }, 400, origin);
      }
      target = FISH_TTS;
    }

    const key = (request.headers.get('Authorization') || '').trim();
    if (!key) {
      return json({ ok: false, reason: 'missing_key', message: 'Fish Audio 키(Authorization: Bearer ...)가 없습니다.' }, 401, origin);
    }

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, reason: 'body_too_large', message: '본문이 너무 큽니다(최대 64KB).' }, 413, origin);
    }

    const upstreamHeaders = {
      'Authorization': key.startsWith('Bearer ') || key.startsWith('bearer ') ? key : 'Bearer ' + key,
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
      'Accept': request.headers.get('Accept') || '*/*'
    };
    const model = (request.headers.get('model') || '').trim();
    if (model) upstreamHeaders['model'] = model;

    const controller = new AbortController();
    const timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, UPSTREAM_TIMEOUT_MS);

    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers: upstreamHeaders,
        body: body,
        signal: controller.signal
      });
      clearTimeout(timer);

      const headers = corsHeaders(origin);
      headers['Content-Type'] = upstream.headers.get('Content-Type') || 'audio/mpeg';
      headers['Cache-Control'] = 'no-store';
      const len = upstream.headers.get('Content-Length');
      if (len) headers['Content-Length'] = len;

      // 키 오류 등 Fish Audio 의 에러 본문도 그대로 전달한다(앱이 401 을 '키 오류'로 구분).
      return new Response(upstream.body, { status: upstream.status, headers: headers });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err && err.name === 'AbortError';
      return json({
        ok: false,
        reason: aborted ? 'upstream_timeout' : 'upstream_error',
        message: aborted ? 'Fish Audio 응답이 시간 안에 오지 않았습니다.' : ('Fish Audio 연결 실패: ' + String(err && err.message || err).slice(0, 160))
      }, aborted ? 504 : 502, origin);
    }
  }
};
