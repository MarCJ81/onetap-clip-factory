/* ============================================================================
   onetap-fish-proxy · 29호기 '원탭 클립 팩토리' 무료 음성 프록시 (Cloudflare Worker)
   ----------------------------------------------------------------------------
   두 가지 일을 한다.
     1) POST /v1/tts        → Fish Audio TTS 중계 (사용자가 넣은 키를 그대로 통과)
     2) POST /v1/edge-tts   → Microsoft Edge 신경망 성우 TTS (키 없이 무료)
        GET  /v1/edge-tts   → 같은 기능을 URL 로 (미리듣기·curl 확인용)
        GET  /v1/edge-tts/voices → 쓸 수 있는 성우 목록

   한 줄 원칙
     - 서버에 API 키를 저장하지 않는다. Fish 키는 브라우저가 보낸 Authorization
       헤더를 그대로 통과시키기만 한다.
     - 아무 주소로나 넘겨 주는 열린 프록시가 아니다. 목적지는 api.fish.audio 의
       TTS 경로 하나와, 마이크로소프트 Edge 읽기용 TTS 하나로 고정한다.
     - 허용한 출처(29호기 GitHub Pages + 로컬 개발)만 받는다.

   Edge TTS 는 브라우저에서 직접 붙으면 핸드셰이크가 막히고(실측), Workers 의
   new WebSocket() 은 User-Agent 를 지정할 수 없어 마이크로소프트가 403 을 준다.
   그래서 이 Worker 는 TLS 소켓(connect)으로 WebSocket 핸드셰이크를 직접 하고
   필요한 헤더(Edge UA·Origin)를 붙인 뒤, 오디오 프레임만 골라 흘려보낸다.
   텍스트는 저장하지 않는다.
   ========================================================================== */

import { connect } from 'cloudflare:sockets';

const VERSION = '1.2.0';
const SERVICE = 'onetap-fish-proxy';
const FISH_ORIGIN = 'https://api.fish.audio';
const FISH_TTS = FISH_ORIGIN + '/v1/tts';

/* ── Edge TTS 상수 ───────────────────────────────────────────────────────── */
const EDGE_HOST = 'speech.platform.bing.com';
const EDGE_PATH = '/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// Edge(Chromium) 버전 표기. 서비스가 이 값을 검사한다. (edge-tts 7.x 와 동일)
const EDGE_VERSION = '2-143.0.3650.75';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' +
  ' (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const WIN_EPOCH = 11644473600;
const MAX_TEXT = 2000;

const EDGE_VOICES = [
  { id: 'ko-KR-SunHiNeural', lang: 'ko-KR', gender: 'Female', label: '선히 (한국어 여성)' },
  { id: 'ko-KR-InJoonNeural', lang: 'ko-KR', gender: 'Male', label: '인준 (한국어 남성)' },
  { id: 'ko-KR-HyunsuMultilingualNeural', lang: 'ko-KR', gender: 'Male', label: '현수 (한국어 남성·다국어)' },
  { id: 'en-US-EmmaMultilingualNeural', lang: 'en-US', gender: 'Female', label: 'Emma (English, female)' },
  { id: 'en-US-AndrewMultilingualNeural', lang: 'en-US', gender: 'Male', label: 'Andrew (English, male)' },
  { id: 'en-US-AvaMultilingualNeural', lang: 'en-US', gender: 'Female', label: 'Ava (English, female)' },
  { id: 'en-US-BrianMultilingualNeural', lang: 'en-US', gender: 'Male', label: 'Brian (English, male)' },
  { id: 'ja-JP-NanamiNeural', lang: 'ja-JP', gender: 'Female', label: 'Nanami (日本語 女性)' },
  { id: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', gender: 'Female', label: '晓晓 (中文 女声)' }
];

// 이 출처에서 온 브라우저 요청만 받는다. GitHub Pages 는 경로와 무관하게 출처가 하나다.
const ALLOWED_ORIGINS = [
  'https://marcj81.github.io',
  'https://marcj81.github.io/onetap-clip-factory'
];

// 로컬에서 index.html 을 열어 시험할 때 (포트는 아무거나)
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;
const EDGE_TIMEOUT_MS = 30000;

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, model, x-fish-target',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'content-type, content-length, x-edge-voice',
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

/* ── Sec-MS-GEC v2 (Edge 143) ────────────────────────────────────────────────
   마이크로소프트가 토큰 형식을 바꿨다: "<CS64 16hex>-<SHA256 64hex>".
   표준 SHA-256 이 아니라 고정 접두 블록의 중간 상태에서 시작하는 변형이라
   아래 상수를 그대로 써야 한다. (edge-tts 7.3.1 drm.py 와 같은 값, 실측 일치)
   ─────────────────────────────────────────────────────────────────────────── */
const K256 = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
];
const SHA_INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
const SHA_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
const SHA_SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491,
  0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
const SHA_ADJ = 0xC9DC06A7;
const SIG0_ADJ = 0x059C0B80;
const SIG1_ADJ = 0x000B92C0;
const CS64_COEF = [
  [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167]
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJ0 = 0xF2F90B1A;
const CS64_ADJ1 = 0x0B1A0000;

const U32 = 0xFFFFFFFF;
const imul = Math.imul;
function rotl16(v) { return ((v << 16) | (v >>> 16)) & U32; }
function rotr(v, n) { return ((v >>> n) | (v << (32 - n))) & U32; }
function sig1py(x) { return ((x >>> 17) ^ ((x << 15) & U32) ^ (x >>> 19) ^ ((x << 13) & U32) ^ (x >>> 10)) & U32; }
function sig0py(y) { return ((y >>> 7) ^ ((y << 25) & U32) ^ (y >>> 18) ^ ((y << 14) & U32) ^ (y >>> 3)) & U32; }

function shaExpand(words, from) {
  for (let i = from; i < 64; i++) {
    words.push((sig1py(words[i - 2]) + words[i - 7] + sig0py(words[i - 15]) + words[i - 16]) & U32);
  }
}

function shaRounds(state, words, firstRound) {
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = firstRound; i < 64; i++) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25));
    const ch = (g ^ (e & (f ^ g)));
    const kc = (firstRound === 14 && i === 14) ? SHA_ADJ : K256[i];
    const t1 = (h + s1 + ch + kc + words[i]) & U32;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22));
    const maj = ((a & b) | (c & (a | b)));
    const t2 = (s0 + maj) & U32;
    h = g; g = f; f = e; e = (d + t1) & U32; d = c; c = b; b = a; a = (t1 + t2) & U32;
  }
  return [a, b, c, d, e, f, g, h];
}

function shaInit(first7) {
  const words = new Array(14).fill(0);
  words[14] = ((first7[0] << 16) | (first7[1] << 8) | first7[2]) >>> 0;
  words[15] = ((first7[3] << 24) | (first7[4] << 16) | (first7[5] << 8) | first7[6]) >>> 0;
  for (let i = 16; i < 30; i++) {
    let value = SHA_SCHEDULE[i - 16];
    if (i - 2 >= 14) {
      let sv = sig1py(words[i - 2]);
      if (i === 16) sv ^= SIG1_ADJ;
      value += sv;
    }
    if (i - 7 >= 14) value += words[i - 7];
    if (i - 15 >= 14) {
      let sv = sig0py(words[i - 15]);
      if (i === 29) sv ^= SIG0_ADJ;
      value += sv;
    }
    words.push(value & U32);
  }
  words.push((sig1py(words[28]) + words[23] + sig0py(words[15]) + words[14] + SHA_ADJ - K256[14]) & U32);
  shaExpand(words, 31);
  const working = shaRounds(SHA_STATE, words, 14);
  return working.map(function (x, i) { return (x + SHA_INITIAL[i]) & U32; });
}

/** 고정 접두 블록을 쓰는 변형 SHA-256 (edge-tts drm.py 와 동일) — 32바이트 반환 */
function shaDigest(data) {
  const len = 57 + data.length;
  const padLen = ((55 - len) % 64 + 64) % 64;
  const body = data.slice(7);
  body.push(0x80);
  for (let i = 0; i < padLen; i++) body.push(0);
  const bitLen = len * 8;
  const hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
  body.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
    (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  let state = shaInit(data.slice(0, 7));
  for (let off = 0; off < body.length; off += 64) {
    const words = [];
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      words.push(((body[p] << 24) | (body[p + 1] << 16) | (body[p + 2] << 8) | body[p + 3]) >>> 0);
    }
    shaExpand(words, 16);
    const working = shaRounds(state, words, 0);
    state = working.map(function (x, i) { return (x + state[i]) & U32; });
  }
  const out = [];
  state.forEach(function (w) {
    out.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255);
  });
  return out;
}

function leWords(buf) {
  const padded = buf.slice();
  while (padded.length % 4) padded.push(0);
  const words = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push((padded[i] | (padded[i + 1] << 8) | (padded[i + 2] << 16) | (padded[i + 3] << 24)) >>> 0);
  }
  if (words.length % 2) words.push(0);
  return words;
}

function cs64Digest(data, digest) {
  let keyA = (digest[0] | (digest[1] << 8) | (digest[2] << 16) | (digest[3] << 24)) >>> 0;
  let keyB = (digest[4] | (digest[5] << 8) | (digest[6] << 16) | (digest[7] << 24)) >>> 0;
  keyA |= 1; keyB |= 1;
  const factors = [imul(keyA, CS64_FACTOR) >>> 0, imul(keyB, CS64_FACTOR) >>> 0];
  const terms = [];
  const offsets = [];
  CS64_COEF.forEach(function (c, i) {
    terms.push(imul(c[0], factors[i % 2]) >>> 0);
    offsets.push(c[1]);
  });
  const buf = [0].concat(data);
  leWords(buf).forEach(function (word, i) {
    let term = imul(word, i % 2 === 0 ? keyA : keyB) >>> 0;
    let offset = imul(rotl16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB) >>> 0;
    if (i === 0) {
      term = (term + imul(CS64_ADJ0, factors[0])) >>> 0;
      offset = (offset + CS64_ADJ1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rotl16((offsets[i] + x) & U32);
    let q = imul(t, 0x76F50F34) >>> 0;
    swapAcc = (swapAcc + ((imul(rotl16(q), 0xC3EFEA97) + q) >>> 0)) >>> 0;
    t = rotl16((offsets[i + 1] + y) & U32);
    q = imul(t, 0x1881CE3C) >>> 0;
    swapLast = (imul(rotl16(q), 0x35BD1EC9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = imul(state, keyA) >>> 0;
    state = (state + x) >>> 0;
    state = imul(rotl16(state), 0xCF98B111) >>> 0;
    state = imul(rotl16(state), 0x87085B9F) >>> 0;
    state = imul(rotl16(state), 0x12CEB96D) >>> 0;
    state = imul(rotl16(state), 0x257E1D83) >>> 0;
    acc = (acc + state) >>> 0;
    t = (imul(state, keyB) + y) >>> 0;
    t = imul(rotl16(t), 0xA27416F5) >>> 0;
    t = imul(rotl16(t), 0xD38396FF) >>> 0;
    state = imul(rotl16(imul(rotl16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0;
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function leHex(n) {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
    .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').toUpperCase();
}

/** Sec-MS-GEC v2: "<CS64 16hex>-<SHA256 64hex>" */
function secMsGecV2() {
  let ticks = Date.now() / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks = Math.round(ticks * 1e7);
  const str = String(ticks) + EDGE_TOKEN;
  const data = [];
  for (let i = 0; i < str.length; i++) data.push(str.charCodeAt(i) & 255);
  const digest = shaDigest(data);
  const cs = cs64Digest(data, digest);
  return leHex(cs[0]) + leHex(cs[1]) + '-' +
    digest.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').toUpperCase();
}

/* ── 최소 WebSocket 클라이언트 (TLS 소켓 위에서 직접) ─────────────────────── */

function concatBytes(a, b) {
  if (!a || !a.length) return b;
  if (!b || !b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function base64Of(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function wsFrame(opcode, payload) {
  const len = payload.length;
  const mask = new Uint8Array(4);
  crypto.getRandomValues(mask);
  let head;
  if (len < 126) {
    head = new Uint8Array([0x80 | opcode, 0x80 | len]);
  } else if (len < 65536) {
    head = new Uint8Array([0x80 | opcode, 0x80 | 126, (len >>> 8) & 255, len & 255]);
  } else {
    head = new Uint8Array(10);
    head[0] = 0x80 | opcode;
    head[1] = 0x80 | 127;
    const hi = Math.floor(len / 4294967296), lo = len >>> 0;
    head[2] = (hi >>> 24) & 255; head[3] = (hi >>> 16) & 255; head[4] = (hi >>> 8) & 255; head[5] = hi & 255;
    head[6] = (lo >>> 24) & 255; head[7] = (lo >>> 16) & 255; head[8] = (lo >>> 8) & 255; head[9] = lo & 255;
  }
  const masked = new Uint8Array(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return concatBytes(concatBytes(head, mask), masked);
}

function indexOfHeaderEnd(buf) {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

/**
 * Edge TTS WebSocket 에 붙는다. 101 이 아니면 throw.
 * 반환: { sendText, close } — 수신은 onText/onBinary 콜백으로.
 */
async function edgeConnect(onText, onBinary, onClose) {
  const connId = randomHex(16);
  const gec = secMsGecV2();
  const path = EDGE_PATH + '?TrustedClientToken=' + EDGE_TOKEN +
    '&ConnectionId=' + connId +
    '&Sec-MS-GEC=' + encodeURIComponent(gec) +
    '&Sec-MS-GEC-Version=' + EDGE_VERSION;
  const keyBytes = new Uint8Array(16);
  crypto.getRandomValues(keyBytes);
  const key = base64Of(keyBytes);
  const req = 'GET ' + path + ' HTTP/1.1\r\n' +
    'Host: ' + EDGE_HOST + '\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Key: ' + key + '\r\n' +
    'Sec-WebSocket-Version: 13\r\n' +
    'User-Agent: ' + EDGE_UA + '\r\n' +
    'Origin: ' + EDGE_ORIGIN + '\r\n' +
    'Pragma: no-cache\r\n' +
    'Cache-Control: no-cache\r\n' +
    'Accept-Language: en-US,en;q=0.9\r\n\r\n';

  const socket = connect({ hostname: EDGE_HOST, port: 443 }, { secureTransport: 'on', allowHalfOpen: true });
  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode(req));
  const reader = socket.readable.getReader();

  let buf = new Uint8Array(0);
  let head = '';
  while (true) {
    const step = await reader.read();
    if (step.done) throw new Error('연결이 핸드셰이크 중 닫혔습니다.');
    buf = concatBytes(buf, step.value);
    const idx = indexOfHeaderEnd(buf);
    if (idx >= 0) {
      head = new TextDecoder().decode(buf.subarray(0, idx));
      buf = buf.slice(idx + 4);
      break;
    }
    if (buf.length > 16384) throw new Error('핸드셰이크 응답이 너무 큽니다.');
  }
  const statusLine = (head.split('\r\n')[0] || '');
  if (statusLine.indexOf(' 101') === -1) {
    try { await socket.close(); } catch (e) { /* noop */ }
    throw new Error('핸드셰이크 거절: ' + statusLine.slice(0, 80));
  }

  let closed = false;
  let sending = Promise.resolve();
  let fragOpcode = 0;
  let fragParts = [];

  function sendRaw(opcode, payload) {
    if (closed) return Promise.resolve();
    const frame = wsFrame(opcode, payload);
    sending = sending.then(function () { return writer.write(frame); }).catch(function () { /* noop */ });
    return sending;
  }

  function sendText(text) {
    return sendRaw(1, new TextEncoder().encode(text));
  }

  function close() {
    if (closed) return;
    closed = true;
    sendRaw(8, new Uint8Array(0));
    setTimeout(function () { try { socket.close(); } catch (e) { /* noop */ } }, 150);
  }

  function dispatch(opcode, payload) {
    if (opcode === 0x1 && onText) onText(new TextDecoder().decode(payload));
    else if (opcode === 0x2 && onBinary) onBinary(payload);
    else if (opcode === 0x8) { close(); if (onClose) onClose(); }
    else if (opcode === 0x9) sendRaw(0xA, payload);
  }

  function parse() {
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0F;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7F;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = (buf[2] << 8) | buf[3];
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const hi = (buf[2] * 16777216) + (buf[3] << 16) + (buf[4] << 8) + buf[5];
        const lo = ((buf[6] << 24) >>> 0) + (buf[7] << 16) + (buf[8] << 8) + buf[9];
        len = hi * 4294967296 + lo;
        off = 10;
      }
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const mask = buf.subarray(off - 4, off);
        const copy = new Uint8Array(len);
        for (let i = 0; i < len; i++) copy[i] = payload[i] ^ mask[i % 4];
        payload = copy;
      } else {
        payload = payload.slice();
      }
      buf = buf.slice(off + len);
      if (opcode === 0x0) {
        fragParts.push(payload);
        if (fin) {
          let whole = new Uint8Array(0);
          fragParts.forEach(function (p) { whole = concatBytes(whole, p); });
          fragParts = [];
          dispatch(fragOpcode, whole);
        }
      } else if (opcode === 0x1 || opcode === 0x2) {
        if (!fin) {
          fragOpcode = opcode;
          fragParts = [payload];
        } else {
          dispatch(opcode, payload);
        }
      } else {
        dispatch(opcode, payload);
      }
    }
  }

  async function pump() {
    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        buf = concatBytes(buf, step.value);
        parse();
        if (closed) break;
      }
    } catch (e) { /* 소켓 오류 */ }
    if (!closed) {
      closed = true;
      if (onClose) onClose();
    }
  }
  const pumped = pump();

  return { sendText: sendText, sendConfig: sendText, close: close, connId: connId, done: pumped };
}

function edgeTimestamp() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + p(d.getUTCDate()) + ' ' +
    d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) +
    ' GMT+0000 (Coordinated Universal Time)';
}

function randomHex(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function voiceAllowed(voice) {
  return EDGE_VOICES.some(function (v) { return v.id === voice; });
}

function clampPct(v, min, max, def) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  const m = s.match(/^([+-]?\d{1,3})%$/);
  if (!m) return def;
  const n = Math.max(min, Math.min(max, parseInt(m[1], 10)));
  return (n >= 0 ? '+' : '') + n + '%';
}

function clampHz(v, def) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  const m = s.match(/^([+-]?\d{1,4})Hz$/);
  if (!m) return def;
  const n = Math.max(-100, Math.min(100, parseInt(m[1], 10)));
  return (n >= 0 ? '+' : '') + n + 'Hz';
}

/**
 * Edge TTS 합성 스트림. 성공하면 audio/mpeg 스트림, 실패하면 JSON 오류.
 * opts: {text, voice, rate, pitch, volume}
 */
async function edgeSynth(opts, origin) {
  const text = String(opts.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return json({ ok: false, reason: 'empty_text', message: '읽을 글(text)이 없습니다.' }, 400, origin);
  if (text.length > MAX_TEXT) {
    return json({ ok: false, reason: 'text_too_long', message: '텍스트는 ' + MAX_TEXT + '자까지입니다.' }, 413, origin);
  }
  const voice = voiceAllowed(opts.voice) ? opts.voice : 'ko-KR-SunHiNeural';
  const rate = clampPct(opts.rate, -50, 100, '+0%');
  const volume = clampPct(opts.volume, -50, 50, '+0%');
  const pitch = clampHz(opts.pitch, '+0Hz');
  const lang = (EDGE_VOICES.filter(function (v) { return v.id === voice; })[0] || EDGE_VOICES[0]).lang;

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let closed = false;
  let bytes = 0;
  let conn = null;

  function finish(closeStream) {
    if (closed) return;
    closed = true;
    if (conn) conn.close();
    if (closeStream) writer.close().catch(function () { /* noop */ });
    else writer.abort().catch(function () { /* noop */ });
  }

  const timer = setTimeout(function () { finish(bytes > 0); }, EDGE_TIMEOUT_MS);

  try {
    conn = await edgeConnect(function onText(msg) {
      if (msg.indexOf('Path:turn.end') !== -1) {
        clearTimeout(timer);
        finish(true);
      }
    }, function onBinary(payload) {
      if (closed || payload.length < 2) return;
      const headerLen = (payload[0] << 8) | payload[1];
      if (headerLen > payload.length - 2) return;
      const header = new TextDecoder().decode(payload.subarray(2, 2 + headerLen));
      if (header.indexOf('Path:audio') === -1) return;
      const audio = payload.subarray(2 + headerLen);
      if (!audio.length) return;
      bytes += audio.length;
      writer.write(audio).catch(function () { /* client gone */ });
    }, function onClose() {
      clearTimeout(timer);
      finish(true);
    });
  } catch (err) {
    clearTimeout(timer);
    try { writer.abort(); } catch (e) { /* noop */ }
    return json({
      ok: false, reason: 'handshake',
      message: 'Edge TTS 연결 실패: ' + String((err && err.message) || err).slice(0, 160)
    }, 502, origin);
  }

  const ts = edgeTimestamp();
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + lang + "'>" +
    "<voice name='" + voice + "'><prosody pitch='" + pitch + "' rate='" + rate + "' volume='" + volume + "'>" +
    escapeXml(text) + '</prosody></voice></speak>';
  const config = 'X-Timestamp:' + ts + '\r\n' +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
  const ssmlMsg = 'X-RequestId:' + conn.connId + '\r\n' +
    'Content-Type:application/ssml+xml\r\n' +
    'X-Timestamp:' + ts + 'Z\r\n' +
    'Path:ssml\r\n\r\n' + ssml;

  try {
    await conn.sendText(config);
    await conn.sendText(ssmlMsg);
  } catch (err) {
    clearTimeout(timer);
    finish(false);
    return json({
      ok: false, reason: 'send_failed',
      message: '요청 전송 실패: ' + String((err && err.message) || err).slice(0, 160)
    }, 502, origin);
  }

  const headers = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'X-Edge-Voice': voice
  };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(stream.readable, { status: 200, headers: headers });
}

/* ── Worker 엔트리 ───────────────────────────────────────────────────────── */
export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (err) {
      return json({
        ok: false, reason: 'worker_exception',
        message: String((err && err.stack) || err).slice(0, 400)
      }, 500, '');
    }
  }
};

async function handle(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const okOrigin = originAllowed(origin) ? origin : '';

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
      edgeTts: 'wss://' + EDGE_HOST + EDGE_PATH,
      edgeVoices: EDGE_VOICES.length,
      allowedOrigins: ALLOWED_ORIGINS,
      storesKeys: false
    }, 200, okOrigin);
  }

  /* ── Edge TTS (키 없이 무료) ───────────────────────────────────────── */
  if (url.pathname === '/v1/edge-tts/voices') {
    return json({ ok: true, voices: EDGE_VOICES }, 200, okOrigin);
  }
  if (url.pathname === '/v1/edge-tts' || url.pathname === '/v1/edge-tts/') {
    if (!originAllowed(origin)) {
      return json({ ok: false, reason: 'origin_not_allowed', message: '허용되지 않은 출처입니다.' }, 403, '');
    }
    let opts = {
      text: url.searchParams.get('text') || '',
      voice: url.searchParams.get('voice') || '',
      rate: url.searchParams.get('rate') || '',
      pitch: url.searchParams.get('pitch') || '',
      volume: url.searchParams.get('volume') || ''
    };
    if (request.method === 'POST') {
      const raw = await request.arrayBuffer();
      if (raw.byteLength > MAX_BODY_BYTES) {
        return json({ ok: false, reason: 'body_too_large', message: '본문이 너무 큽니다(최대 64KB).' }, 413, origin);
      }
      let body = null;
      try { body = JSON.parse(new TextDecoder().decode(raw) || '{}'); } catch (e) { body = null; }
      if (!body || typeof body !== 'object') {
        return json({ ok: false, reason: 'bad_json', message: 'JSON 본문이 필요합니다.' }, 400, origin);
      }
      opts = {
        text: body.text || '',
        voice: body.voice || '',
        rate: body.rate || '',
        pitch: body.pitch || '',
        volume: body.volume || ''
      };
    } else if (request.method !== 'GET') {
      return json({ ok: false, reason: 'method_not_allowed', message: 'GET 또는 POST 만 받습니다.' }, 405, origin);
    }
    return edgeSynth(opts, origin);
  }

  /* ── Fish Audio TTS 중계 ──────────────────────────────────────────── */
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'method_not_allowed', message: 'POST 만 받습니다.' }, 405, okOrigin);
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
  const timer = setTimeout(function () { try { controller.abort(); } catch (e) { /* noop */ } }, UPSTREAM_TIMEOUT_MS);

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
