/* ============================================================================
   blog-source.js · 블로그 글 읽기 (UMD, 의존성 0)
   ----------------------------------------------------------------------------
   브라우저는 남의 블로그 HTML을 직접 읽을 수 없다(CORS). 그래서 읽기 전용
   프록시를 쓴다. 이 앱은 아래 순서로 시도하고, 모두 실패하면 앱이 곧바로
   '본문 붙여넣기(Ctrl+V)' 폴백을 띄운다 — 절대 먹통이 되지 않게.

     1) r.jina.ai      글을 렌더해 마크다운으로 돌려준다 (CORS 허용)
     2) images.weserv.nl  사진을 CORS 허용 헤더와 함께 중계 (캔버스 오염 방지)

   읽어 온 URL·본문은 이 함수 밖으로 나가지 않는다. 서버는 우리 것이 아니다.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.BlogSource = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var JINA = 'https://r.jina.ai/';
  var IMG_PROXY = 'https://images.weserv.nl/?url=';
  var PEXELS = 'https://api.pexels.com/v1/search';
  var TIMEOUT_MS = 30000;

  function trim(v) { return String(v === null || v === undefined ? '' : v).replace(/^\s+|\s+$/g, ''); }

  function isHttp(u) { return /^https?:\/\/[^\s]+$/i.test(trim(u)); }

  function withTimeout(promise, ms, onTimeout) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(onTimeout || { ok: false, reason: 'timeout' });
      }, ms || TIMEOUT_MS);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      }).catch(function (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: 'network', message: (e && e.message) || '' });
      });
    });
  }

  /** 블로그 URL 정규화: blog.naver.com/{id}/{logNo} → PostView */
  function normalizeUrl(url) {
    var u = trim(url);
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    var m = u.match(/^https?:\/\/blog\.naver\.com\/([A-Za-z0-9_.-]+)\/(\d+)/i);
    if (m) return 'https://blog.naver.com/PostView.naver?blogId=' + m[1] + '&logNo=' + m[2];
    var m2 = u.match(/^https?:\/\/m\.blog\.naver\.com\/([A-Za-z0-9_.-]+)\/(\d+)/i);
    if (m2) return 'https://blog.naver.com/PostView.naver?blogId=' + m2[1] + '&logNo=' + m2[2];
    if (/^https?:\/\/blog\.naver\.com\/PostView\.naver/i.test(u)) return u;
    return u;
  }

  var JUNK_LINE = /^(구독|좋아요|공감|댓글|이웃추가|이웃 추가|공유하기|신고|블로그 홈|카테고리|전체보기|TOP|맨 위로|URL Source:|Published Time:|Markdown Content:|Title:|Warning:|This page|Access|Cookie)/i;

  /** 마크다운(또는 평문) → 제목·문단·사진 */
  function parseMarkdown(md) {
    var text = String(md || '').replace(/\r/g, '');
    var title = '';
    var tm = text.match(/^\s*Title:\s*(.+)$/m);
    if (tm) title = trim(tm[1]);
    var images = [];
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (all, alt, src) {
      if (isHttp(src)) images.push({ url: trim(src), alt: trim(alt) });
      return ' ';
    });
    text = text.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, function (all, src) {
      if (isHttp(src)) images.push({ url: trim(src), alt: '' });
      return ' ';
    });
    var body = text;
    var ci = body.indexOf('Markdown Content:');
    if (ci >= 0) body = body.slice(ci + 'Markdown Content:'.length);
    body = body.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '$1');
    body = body.replace(/^\s{0,3}#{1,6}\s*/gm, '');
    body = body.replace(/[*_`>]/g, '');

    var paragraphs = [];
    var seen = {};
    body.split(/\n{2,}/).forEach(function (block) {
      var lines = block.split(/\n/);
      lines.forEach(function (line) {
        var s = trim(line).replace(/\s+/g, ' ');
        if (!s || s.length < 14) return;
        if (JUNK_LINE.test(s)) return;
        if (/^[-=]{3,}$/.test(s)) return;
        if (/^(https?:)?\/\//.test(s)) return;
        if (seen[s]) return;
        seen[s] = 1;
        paragraphs.push(s);
      });
    });
    if (!title) {
      var h = text.match(/^\s*#\s+(.+)$/m);
      if (h) title = trim(h[1]);
    }
    if (!title && paragraphs.length) title = paragraphs[0].slice(0, 80);
    return { title: title, paragraphs: paragraphs, images: images };
  }

  /** fetch 프록시로 글 읽기 */
  function viaJina(url, opts) {
    var o = opts || {};
    var target = JINA + normalizeUrl(url);
    var init = {
      method: 'GET',
      headers: { accept: 'text/plain' },
      credentials: 'omit',
      cache: 'no-store'
    };
    if (o.signal) init.signal = o.signal;
    return withTimeout(root.fetch(target, init).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          return { ok: false, reason: 'http_' + res.status, status: res.status, message: text.slice(0, 160) };
        }
        return { ok: true, text: text, via: 'jina' };
      });
    }), o.timeoutMs || TIMEOUT_MS, { ok: false, reason: 'timeout' });
  }

  /**
   * 블로그 URL → {ok, title, paragraphs, images, via}
   * 실패는 조용히 돌려준다(앱이 붙여넣기 폴백을 띄운다).
   */
  function fetchArticle(url, opts) {
    var o = opts || {};
    var u = normalizeUrl(url);
    if (!isHttp(u)) return Promise.resolve({ ok: false, reason: 'bad_url', message: '주소가 올바르지 않습니다.' });
    return viaJina(u, o).then(function (res) {
      if (!res.ok) {
        return {
          ok: false,
          reason: res.reason || 'failed',
          status: res.status,
          message: res.reason === 'timeout'
            ? '블로그가 제때 응답하지 않았습니다.'
            : '블로그가 읽기를 막았거나 주소를 확인해야 합니다.'
        };
      }
      var parsed = parseMarkdown(res.text);
      if (!parsed.paragraphs.length) {
        return { ok: false, reason: 'empty', message: '본문을 찾지 못했습니다(스크립트로만 그리는 페이지일 수 있습니다).' };
      }
      return {
        ok: true,
        url: u,
        title: parsed.title,
        paragraphs: parsed.paragraphs,
        images: parsed.images.slice(0, 12),
        via: res.via,
        chars: parsed.paragraphs.join(' ').length
      };
    }).catch(function (err) {
      return { ok: false, reason: 'network', message: (err && err.message) || '' };
    });
  }

  /** 붙여넣은 글 → 같은 모양 */
  function fromPastedText(text, titleHint) {
    var parsed = parseMarkdown(text);
    var paras = parsed.paragraphs;
    if (!paras.length) {
      paras = String(text || '').split(/\n+/).map(function (s) { return trim(s).replace(/\s+/g, ' '); })
        .filter(function (s) { return s.length >= 8; });
    }
    var title = trim(titleHint) || parsed.title || (paras[0] || '').slice(0, 80);
    return { ok: paras.length > 0, title: title, paragraphs: paras, images: parsed.images.slice(0, 12), via: 'paste' };
  }

  /** CORS 안전한 이미지 로드: 직접 → weserv 프록시 순서 */
  function loadImage(url, opts) {
    var o = opts || {};
    var src = trim(url);
    if (!src) return Promise.reject(new Error('이미지 주소 없음'));
    function attempt(u, cross) {
      return new Promise(function (resolve, reject) {
        var img = new root.Image();
        if (cross) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        var timer = setTimeout(function () { reject(new Error('timeout')); }, o.timeoutMs || 20000);
        img.onload = function () { clearTimeout(timer); resolve(img); };
        img.onerror = function () { clearTimeout(timer); reject(new Error('load_failed')); };
        img.src = u;
      });
    }
    var proxied = IMG_PROXY + encodeURIComponent(src.replace(/^https?:\/\//, '')) + '&w=' + (o.width || 1280) + '&output=jpg&q=82';
    /* 프록시 먼저: 원본 호스트가 ACAO를 안 주면 브라우저 콘솔에 CORS 오류가 남고,
       캔버스를 오염시킬 수도 있다. 프록시는 항상 CORS 헤더를 준다. */
    return attempt(proxied, true).catch(function () {
      return attempt(src, true);
    });
  }

  /** Pexels 무료 키로 장면 사진 찾기 (선택) */
  function searchPexels(query, apiKey, opts) {
    var o = opts || {};
    var q = trim(query);
    var key = trim(apiKey);
    if (!q || !key) return Promise.resolve({ ok: false, reason: 'no_key', photos: [] });
    var url = PEXELS + '?query=' + encodeURIComponent(q) + '&per_page=' + Math.max(1, Math.min(15, o.count || 6)) + '&orientation=portrait';
    return withTimeout(root.fetch(url, {
      method: 'GET',
      headers: { Authorization: key, accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) return { ok: false, reason: 'http_' + res.status, photos: [], message: (json && json.error) || '' };
        var photos = (json.photos || []).map(function (p) {
          return {
            id: p.id,
            url: (p.src && (p.src.large2x || p.src.large || p.src.portrait)) || '',
            thumb: (p.src && (p.src.medium || p.src.small)) || '',
            alt: p.alt || '',
            credit: p.photographer || ''
          };
        }).filter(function (p) { return isHttp(p.url); });
        return { ok: true, photos: photos };
      });
    }), o.timeoutMs || 15000, { ok: false, reason: 'timeout', photos: [] });
  }

  return {
    JINA: JINA,
    IMG_PROXY: IMG_PROXY,
    normalizeUrl: normalizeUrl,
    parseMarkdown: parseMarkdown,
    fetchArticle: fetchArticle,
    fromPastedText: fromPastedText,
    loadImage: loadImage,
    searchPexels: searchPexels
  };
});
