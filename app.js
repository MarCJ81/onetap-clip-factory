/* ============================================================
   원탭 클립 팩토리 · app.js
   ------------------------------------------------------------
   화면 조립과 상태 관리. 계산은 core/media, 인코딩은 render,
   데모는 demo, AI 는 free-ai + Pro 커넥터가 맡는다.
   여기서는 "무엇을 보여 주고 무엇을 저장할지"만 결정한다.
   ============================================================ */
(function () {
  'use strict';

  var C = window.ClipCore;
  var M = window.ClipMedia;
  var R = window.ClipRender;
  var D = window.ClipDemo;
  var Free = window.FreeAI;
  var Pro = window.ProConnector;
  var G = window.GeminiCore;
  var B = window.BlogSource;
  var T = window.ClipTts;
  var Bgm = window.ClipBgm;

  /** 화면 문구: 새로 추가한 동적 문자열은 L(한국어, English)로 바로 번역한다. */
  function detectLang() {
    try {
      var q = (location.search.match(/[?&]lang=(en|ko)\b/) || [])[1];
      if (q) return q;
      var saved = localStorage.getItem('onetap_lang');
      if (saved === 'en' || saved === 'ko') return saved;
    } catch (e) { /* noop */ }
    var n = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return n.indexOf('ko') === 0 ? 'ko' : 'en';
  }
  function isEn() {
    try {
      if (window.OneTapI18n && window.OneTapI18n.lang) return window.OneTapI18n.lang === 'en';
    } catch (e) { /* noop */ }
    /* i18n 스크립트가 아직 부팅 전이면 같은 규칙으로 먼저 판단한다. */
    return detectLang() === 'en';
  }
  function L(ko, en) { return isEn() ? en : ko; }

  /* ── 동적 문자열 번역 ─────────────────────────────────────
     로그·상태 문구는 숫자와 단위가 섞여 사전(DICT)에 그대로 담을 수 없다.
     영어 모드에서는 문구 표 + 단위 규칙으로 바꾸고, 바뀌지 않은 한글은
     그대로 둔다(사용자 콘텐츠는 건드리지 않는다). */
  var TR_PHRASES = [
    ['렌더가 끝난 뒤에 원본을 바꿀 수 있습니다.', 'You can change the source after the render finishes.'],
    ['렌더가 끝난 뒤에 감지를 바꿀 수 있습니다.', 'You can change detection after the render finishes.'],
    ['영상 파일(MP4·WebM·MOV)을 골라 주세요.', 'Choose a video file (MP4, WebM, MOV).'],
    ['1.6GB가 넘는 파일은 브라우저 메모리에 올리기 어렵습니다. 먼저 잘라 주세요.', 'Files over 1.6 GB are hard to hold in browser memory. Trim it first.'],
    ['데모 VOD 생성 시작 (32초 · 960×540 · H.264)', 'Demo VOD build started (32s · 960×540 · H.264)'],
    ['데모 VOD 준비 완료 · 무음 6구간 · 장면 5개', 'Demo VOD ready · 6 silent spans · 5 scenes'],
    ['데모 생성을 취소했습니다.', 'Demo build canceled.'],
    ['데모를 만들지 못했습니다: ', 'Could not build the demo: '],
    ['데모 생성 실패', 'Demo build failed'],
    ['이 파일에서는 소리를 읽지 못해 무음 제거를 건너뜁니다(화면 표본만 사용).', 'No audio could be read, so silence removal is skipped (frame samples only).'],
    ['분석이 취소되었습니다. 다시 시도해 주세요.', 'Analysis canceled. Please try again.'],
    ['분석 실패 · 형식이나 길이를 확인해 주세요.', 'Analysis failed · check the format or length.'],
    ['분석을 취소했습니다.', 'Analysis canceled.'],
    ['분석에 실패했습니다: ', 'Analysis failed: '],
    ['분석 완료 · 말소리 ', 'Analysis done · speech '],
    ['분석 완료 · 클립 ', 'Analysis done · clips '],
    ['장면 컷 후보: ', 'Scene-cut candidates: '],
    ['를 골랐습니다.', ' selected.'],
    ['분석 실패: ', 'Analysis failed: '],
    ['원본을 분석하는 중', 'Analyzing the source'],
    ['설정으로 다시 감지하는 중', 'Re-detecting with new settings'],
    ['이미 읽은 파형과 표본으로 클립을 다시 계획합니다.', 'Re-planning clips from the waveform and samples already read.'],
    ['소리와 장면을 표본으로 훑습니다. 영상은 밖으로 나가지 않습니다.', 'Scanning audio and scene samples. The video never leaves your browser.'],
    ['원본을 읽는 중… ', 'Reading the source… '],
    ['원본을 열지 못했습니다: ', 'Could not open the source: '],
    ['원본을 열지 못했습니다', 'Could not open the source'],
    ['원본을 여는 중', 'Opening the source'],
    ['원본 열기: ', 'Source opened: '],
    ['클립 삭제: ', 'Clip deleted: '],
    ['이미 렌더 중입니다. 끝난 뒤에 다시 눌러 주세요.', 'Already rendering. Try again when it finishes.'],
    ['먼저 원본을 넣어 주세요.', 'Add a source first.'],
    ['분석이 끝난 뒤에 렌더할 수 있습니다.', 'Render once analysis finishes.'],
    ['렌더할 클립을 선택해 주세요.', 'Select clips to render.'],
    ['렌더할 클립을 선택하세요', 'Select clips to render'],
    ['렌더 시작 · ', 'Render started · '],
    ['클립 완료: ', 'Clip done: '],
    ['렌더를 취소했습니다.', 'Render canceled.'],
    ['렌더 실패: ', 'Render failed: '],
    ['자막을 읽었습니다. 경고 ', 'Subtitles loaded. Warnings: '],
    ['자막 경고: ', 'Caption warning: '],
    ['자막 경고 ', 'Caption warnings '],
    ['자막 불러오기: ', 'Subtitles loaded: '],
    ['먼저 자막(.srt/.vtt)을 넣어 주세요.', 'Add subtitles (.srt/.vtt) first.'],
    ['자막 시간이나 원본 영상이 필요합니다.', 'Caption timing or a source video is needed.'],
    ['구간을 고르는 중…', 'Picking segments…'],
    ['스토리 구간 추천 · 자막 ', 'Story segments · captions '],
    ['스토리 추천 AI 실패 → 로컬 규칙: ', 'Story AI failed → local rules: '],
    ['AI 대신 자막 규칙으로 추천했습니다. 문장은 직접 다듬어 주세요.', 'Used caption rules instead of AI. Please polish the lines.'],
    ['스토리 추천 완료 · ', 'Story segments ready · '],
    ['스토리 응답 형식 오류 → 로컬 규칙: ', 'Story reply unreadable → local rules: '],
    ['스토리 추천 오류: ', 'Story error: '],
    ['클립으로 담으려면 원본 영상이 있어야 합니다. 데모 VOD를 먼저 만들어 주세요.', 'A source video is needed to keep clips. Build the demo VOD first.'],
    ['담을 구간을 선택해 주세요.', 'Select segments to keep.'],
    ['선택한 구간에 남길 말소리가 없습니다. 무음 임계치를 확인해 주세요.', 'No speech left in those segments. Check the silence threshold.'],
    ['추천 구간과 겹치는 기존 클립 ', 'Existing clips overlapping the suggestions '],
    ['개의 선택을 해제했습니다(삭제는 안 함).', ' deselected (not deleted).'],
    ['자막을 읽지 못했습니다. SRT·VTT 형식인지 확인해 주세요.', 'Could not read the subtitles. Check the SRT/VTT format.'],
    ['스토리용 자막 불러오기: ', 'Story subtitles loaded: '],
    ['해설 자막 삭제 · 클립 ', 'Commentary caption deleted · clip '],
    ['이 클립에는 자막이 없습니다.', 'This clip has no captions.'],
    ['해설 자막 초안 다시 만듦 · ', 'Commentary draft rebuilt · '],
    ['해설 자막 초안을 다시 만들었습니다.', 'Commentary draft rebuilt.'],
    ['Pro 연결 창을 열지 못했습니다.', 'Could not open the Pro dialog.'],
    ['AI 훅 요청 · 클립 ', 'AI hook request · clip '],
    ['AI 훅 실패: ', 'AI hook failed: '],
    ['AI 훅 응답 형식 오류: ', 'AI hook reply unreadable: '],
    ['AI 훅 적용 · ', 'AI hook applied · '],
    ['클립 제목·훅을 적용했습니다.', 'Clip title and hook applied.'],
    ['AI 훅 오류: ', 'AI hook error: '],
    ['영상+자막 명령을 복사했습니다. 터미널에 붙여 넣으세요.', 'Copied the video + subtitles command. Paste it in your terminal.'],
    ['복사하지 못했습니다. 명령을 직접 선택해 주세요.', 'Copy failed. Select the command manually.'],
    ['자막 모드: ', 'Caption mode: '],
    ['데모 VOD를 먼저 만들어 주세요.', 'Build the demo VOD first.'],
    ['데모 자막을 불러왔습니다.', 'Demo captions loaded.'],
    ['붙여넣은 자막이 없습니다.', 'No pasted subtitles.'],
    ['데모 자막(SRT)을 읽었습니다. 32초 데모 흐름과 같은 시간입니다.', 'Read the demo SRT — it matches the 32s demo timeline.'],
    ['자막을 넣고 AI 스토리 구간 찾기를 눌러 보세요.', 'Add subtitles, then press Find story segments.'],
    ['먼저 클립을 선택해 주세요.', 'Select a clip first.'],
    ['이 구간에는 남길 말소리가 없습니다.', 'No speech to keep in this range.'],
    ['수동 클립 추가: ', 'Clip added: '],
    ['이 구간을 클립으로 담았습니다.', 'Added this range as a clip.'],
    ['원본 모드로 돌아왔습니다.', 'Back to source mode.'],
    ['완료된 클립이 없습니다.', 'No finished clips yet.'],
    ['ZIP 저장 · ', 'ZIP saved · '],
    ['ZIP으로 묶었습니다.', 'Zipped.'],
    ['ZIP을 만들지 못했습니다: ', 'Could not build the ZIP: '],
    ['내보낼 자막이 없습니다.', 'No captions to export.'],
    ['자막 내보내기 · ', 'Captions exported · '],
    ['자막을 0.5초 밀었습니다.', 'Shifted captions by 0.5s.'],
    ['읽을 수 있는 자막이 없습니다. 형식을 확인해 주세요.', 'No readable captions. Check the format.'],
    ['현재 목록으로 원문을 다시 만들었습니다.', 'Rebuilt the SRT source from the list.'],
    ['공장 준비 완료 · 원본을 기다립니다', 'Factory ready · waiting for a source'],
    ['완료 · H.264 MP4', 'done · H.264 MP4'],
    ['완료된 클립 ', 'Finished clips '],
    ['개 ZIP으로 받기', ' → ZIP'],
    ['개를 만들었습니다. MP4로 받아 보세요.', ' created. Grab the MP4s.'],
    ['개 · H.264 MP4 · 브라우저에서 인코딩', ' · H.264 MP4 · encoded in your browser'],
    ['소리 없음 · 파형 없음', 'No audio · no waveform'],
    ['원본을 넣으면 자동으로 분석합니다.', 'Add a source and it analyzes automatically.'],
    ['원본을 넣으면 무음과 장면 컷을 읽어 하이라이트를 자동으로 골라 둡니다.', 'Add a source and it reads silence and scene cuts to pick highlights for you.'],
    ['자막을 넣으면 스토리·재미·반전 구간과 그 위에 얹을 해설 자막을 함께 골라 줍니다.', 'Add subtitles to pick story beats and the commentary captions layered on them.'],
    ['자막을 넣고 버튼을 누르면 추천 구간이 여기에 나옵니다.', 'Add subtitles and press the button to get suggested segments here.'],
    ['추천 구간을 찾지 못했습니다. 자막이 있는지 확인해 주세요.', 'No segments found. Check that captions exist.'],
    ['클립을 고르면 해설 자막이 여기에 나옵니다.', 'Pick a clip to see its commentary captions here.'],
    ['먼저 클립을 만드세요.', 'Create a clip first.'],
    ['이 클립에는 자막이 없어 해설 초안을 만들 수 없습니다. 자막을 올리면 자동으로 생깁니다.', 'No captions on this clip, so no commentary draft. Upload subtitles and it appears.'],
    ['아직 클립이 없습니다. 공장에서 원본을 분석하세요.', 'No clips yet. Analyze a source in the factory.'],
    ['선택한 클립이 여기에 쌓입니다. 순서대로 실제 MP4가 만들어집니다.', 'Selected clips queue here and become real MP4s in order.'],
    ['SRT/VTT를 올리거나, 데모 자막을 불러오세요.', 'Upload an SRT/VTT or load the demo captions.'],
    ['음성 인식은 넣지 않았습니다. 쓰던 자막 파일을 그대로 올리면 타임코드까지 살립니다.', 'No speech recognition. Upload the subtitle file you already have and the timecodes survive.'],
    ['이 브라우저에서는 MP4 렌더를 쓸 수 없습니다.', 'This browser cannot render MP4.'],
    ['Chrome 또는 Edge 최신 버전에서 열어 주세요.', 'Open it in the latest Chrome or Edge.'],
    ['인코더 확인에 실패했습니다. 그래도 분석·미리보기는 동작합니다.', 'Encoder check failed. Analysis and preview still work.'],
    ['훅을 만들지 못했습니다', 'Could not build a hook'],
    ['응답을 JSON으로 읽지 못했습니다. 다시 시도해 주세요.', 'Could not read the reply as JSON. Try again.'],
    ['AI 요청에 실패했습니다.', 'The AI request failed.'],
    ['응답을 받지 못했습니다.', 'No reply.'],
    ['의 자막으로 훅을 만드는 중…', ': building a hook from its captions…'],
    ['클립 없음', 'No clip'],
    ['제목 없음', 'Untitled'],
    ['태그 없음', 'no tags'],
    ['첫 2초 훅', 'first 2s hook'],
    ['해시태그 (공백 구분)', 'hashtags (space separated)'],
    ['제목 없음 — AI 훅으로 만들거나 직접 입력', 'No title — use AI hook or type one'],
    ['첫 2초에 읽을 문장', 'first line of the clip'],
    ['이 클립만 렌더', 'Render this clip'],
    ['다시 시도', 'Retry'],
    ['Pro 연결', 'Connect Pro'],
    ['카드에 적용됨', 'applied to the card'],
    ['무료 맛보기', 'Free taste'],
    ['무료 모드', 'Free mode'],
    ['연결됨', 'connected'],
    ['클릭해서 관리', 'click to manage'],
    ['클릭해서 API 연결', 'click to connect an API'],
    ['죽은 초 ', 'Dead air '],
    ['장면 컷 ', 'Scene cut '],
    ['크롭 ', 'crop '],
    ['표본 ', 'samples '],
    [' 표본', ' samples'],
    ['파형 없음', 'No waveform'],
    ['소리 없음', 'No audio'],
    ['렌더 중 ', 'rendering '],
    ['완료 · ', 'done · '],
    ['실패: ', 'failed: '],
    ['취소됨', 'canceled'],
    ['대기', 'waiting'],
    ['MP4 받기', 'Download MP4'],
    ['추천 ', 'Suggested '],
    ['로컬 규칙(자막 휴리스틱)', 'local rules (caption heuristic)'],
    ['로컬 규칙', 'local rules'],
    ['무료 AI 맛보기', 'free AI taste'],
    ['해설+대사', 'commentary + dialogue'],
    ['해설만', 'commentary only'],
    ['대사만', 'dialogue only'],
    ['죽은 초', 'Dead air'],
    ['말소리', 'speech'],
    ['무음', 'silence'],
    ['해설', 'commentary'],
    ['훅 · ', 'hook · '],
    ['담기', 'Keep'],
    ['구간', 'spans'],
    ['장면', 'scenes'],
    ['자막 없음', 'No captions'],
    ['미리보기', 'Preview'],
    ['렌더', 'Render'],
    ['삭제', 'Delete'],
    ['제목', 'title'],
    ['해시태그', 'hashtags'],
    ['클립 ', 'Clip '],
    ['자막 ', 'captions '],
    ['추천', 'Suggested']
  ];
  TR_PHRASES.sort(function (a, b) { return b[0].length - a[0].length; });

  function tr(text) {
    var s = String(text === null || text === undefined ? '' : text);
    if (!isEn() || !/[\uac00-\ud7a3]/.test(s)) return s;
    try {
      var hit = window.OneTapI18n && window.OneTapI18n.t ? window.OneTapI18n.t(s) : null;
      if (hit && hit !== s && !/[\uac00-\ud7a3]/.test(hit)) return hit;
    } catch (e) { /* noop */ }
    var out = s
      .replace(/(\d+(?:\.\d+)?)\s*개/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*곳/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*초/g, '$1s')
      .replace(/(\d+(?:\.\d+)?)\s*줄/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*큐/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*장/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*문단/g, '$1')
      .replace(/(\d+(?:\.\d+)?)\s*편/g, '$1');
    for (var i = 0; i < TR_PHRASES.length; i++) {
      if (out.indexOf(TR_PHRASES[i][0]) >= 0) out = out.split(TR_PHRASES[i][0]).join(TR_PHRASES[i][1]);
    }
    return out;
  }

  var PREFS_KEY = 'clip-factory.prefs.v1';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var on = function (el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts); };

  var state = {
    source: null,
    analysis: null,
    clips: [],
    cues: [],
    detect: null,
    styleId: 'yellow',
    mode: 'subject',
    smooth: 0.72,
    zoom: 1,
    activeClipId: '',
    playMode: 'source',
    playing: false,
    localMs: 0,
    playClock: 0,
    playStartLocal: 0,
    muteBefore: false,
    wave: null,
    wavePeaks: null,
    queue: [],
    rendering: false,
    renderSignal: null,
    analysisSignal: null,
    demoSignal: null,
    aiBusy: false,
    cueRevision: 0,
    cueCache: {},
    cap: null,
    dirty: true,
    lastFrame: 0,
    captionMode: 'both',
    commentaryStyle: 'badge',
    story: { segments: [], busy: false, source: '', note: '', why: '' },
    thumbing: false,
    auto: { busy: false, steps: {}, degraded: '' },
    film: {
      article: null,
      scenes: [],
      images: {},
      imageChoices: [],
      timeline: [],
      totalMs: 0,
      themeIndex: 0,
      styleId: 'karaoke',
      layoutId: 'topTitle',
      subtitle: null,
      audioBuffer: null,
      audioKey: '',
      audioBusy: null,
      previewAudio: null,
      refs: [],
      refId: '',
      ytKey: '',
      presetId: '720',
      scriptSource: '',
      scriptBusy: false,
      playing: false,
      tMs: 0,
      raf: 0,
      lastTs: 0,
      rendering: false,
      signal: null,
      result: null,
      narration: {},
      narrationNote: '',
      bgmBuffer: null,
      bgmName: '',
      pexelsPhotos: []
    }
  };

  /* ── 작은 도구 ─────────────────────────────────────────── */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { node.style[s] = v[s]; });
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (ch) {
      if (ch === null || ch === undefined || ch === false) return;
      node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
    });
    return node;
  }

  function fillRange(input) {
    if (!input) return;
    var min = Number(input.min || 0), max = Number(input.max || 100), v = Number(input.value || 0);
    var p = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', p + '%');
  }
  function refreshRanges() { $$('input[type="range"]').forEach(fillRange); }

  function toast(text, kind) {
    var root = $('#toast-root');
    if (!root) return;
    var node = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status' }, [tr(text)]);
    root.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      node.style.transition = 'opacity .2s ease, transform .2s ease';
      setTimeout(function () { node.remove(); }, 260);
    }, kind === 'error' ? 5200 : 3400);
  }

  function log(text, kind) {
    var list = $('#log-list');
    if (!list) return;
    var t = new Date();
    var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
    var item = el('li', { class: 'log-item' + (kind ? ' is-' + kind : '') }, [
      el('span', { class: 'log-time', text: hh }),
      el('span', { text: tr(text) })
    ]);
    list.insertBefore(item, list.firstChild);
    while (list.children.length > 40) list.removeChild(list.lastChild);
  }

  /* ── 환경 설정 저장 ───────────────────────────────────── */
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        theme: document.documentElement.getAttribute('data-theme'),
        styleId: state.styleId,
        mode: state.mode,
        smooth: state.smooth,
        zoom: state.zoom,
        preset: $('#sel-preset') ? $('#sel-preset').value : '1080',
        fps: $('#sel-fps') ? $('#sel-fps').value : '30',
        captions: $('#tg-captions') ? $('#tg-captions').checked : true,
        renderCaption: $('#tg-render-caption') ? $('#tg-render-caption').checked : true,
        safe: $('#tg-safe') ? $('#tg-safe').checked : true,
        loop: $('#tg-loop') ? $('#tg-loop').checked : true,
        captionMode: state.captionMode,
        commentaryStyle: state.commentaryStyle,
        storyCount: $('#sel-story-count') ? $('#sel-story-count').value : '4',
        storyLen: $('#sel-story-len') ? $('#sel-story-len').value : 'normal',
        detect: currentDetect(),
        film: {
          themeIndex: state.film.themeIndex,
          styleId: state.film.styleId,
          layoutId: state.film.layoutId || 'topTitle',
          presetId: state.film.presetId,
          countChoice: $('#sel-film-count') ? $('#sel-film-count').value : 'auto',
          subtitle: state.film.subtitle || null,
          tts: $('#sel-tts') ? $('#sel-tts').value : 'edge',
          bgm: $('#sel-bgm') ? $('#sel-bgm').value : 'lofi',
          bgmVol: $('#rg-bgm') ? $('#rg-bgm').value : '18',
          duck: $('#tg-duck') ? $('#tg-duck').checked : true,
          blogImages: $('#tg-blog-images') ? $('#tg-blog-images').checked : true,
          autoCrop: $('#sel-auto-crop') ? $('#sel-auto-crop').value : 'subject',
          autoSilence: $('#sel-auto-silence') ? $('#sel-auto-silence').value : '600',
          autoCount: $('#sel-auto-count') ? $('#sel-auto-count').value : '3',
          autoAi: $('#tg-auto-ai') ? $('#tg-auto-ai').checked : true
        }
      }));
    } catch (e) { /* 저장 실패는 조용히 */ }
  }

  function applyPrefs() {
    var p = loadPrefs();
    if (p.theme === 'light' || p.theme === 'dark') document.documentElement.setAttribute('data-theme', p.theme);
    if (p.styleId) state.styleId = p.styleId;
    if (p.mode) state.mode = p.mode;
    if (typeof p.smooth === 'number') state.smooth = p.smooth;
    if (typeof p.zoom === 'number') state.zoom = p.zoom;
    if (p.preset && $('#sel-preset')) $('#sel-preset').value = p.preset;
    if (p.fps && $('#sel-fps')) $('#sel-fps').value = p.fps;
    if (typeof p.captions === 'boolean' && $('#tg-captions')) $('#tg-captions').checked = p.captions;
    if (typeof p.renderCaption === 'boolean' && $('#tg-render-caption')) $('#tg-render-caption').checked = p.renderCaption;
    if (typeof p.safe === 'boolean' && $('#tg-safe')) $('#tg-safe').checked = p.safe;
    if (typeof p.loop === 'boolean' && $('#tg-loop')) $('#tg-loop').checked = p.loop;
    if (p.captionMode && ['both', 'commentary', 'dialogue'].indexOf(p.captionMode) >= 0) state.captionMode = p.captionMode;
    if (p.commentaryStyle && ['badge', 'plain'].indexOf(p.commentaryStyle) >= 0) state.commentaryStyle = p.commentaryStyle;
    if (p.storyCount && $('#sel-story-count')) $('#sel-story-count').value = String(p.storyCount);
    if (p.storyLen && $('#sel-story-len')) $('#sel-story-len').value = String(p.storyLen);
    if (p.detect) {
      var d = p.detect;
      if (typeof d.silenceDb === 'number') $('#rg-silence').value = d.silenceDb;
      if (typeof d.minSilenceMs === 'number') $('#rg-minside').value = d.minSilenceMs;
      if (typeof d.padMs === 'number') $('#rg-pad').value = d.padMs;
      if (typeof d.sceneSensitivity === 'number') $('#rg-scene').value = d.sceneSensitivity;
      if (typeof d.targetClipMs === 'number') $('#sel-target').value = String(d.targetClipMs);
      if (typeof d.clipCount === 'number') $('#sel-count').value = String(d.clipCount);
      if (typeof d.removeSilence === 'boolean') $('#tg-silence').checked = d.removeSilence;
    }
    if (p.film) {
      var f = p.film;
      if (typeof f.themeIndex === 'number' && C.FILM_THEMES[f.themeIndex]) state.film.themeIndex = f.themeIndex;
      if (f.styleId) state.film.styleId = f.styleId;
      if (f.layoutId && C.FILM_LAYOUTS.some(function (x) { return x.id === f.layoutId; })) state.film.layoutId = f.layoutId;
      if (f.presetId) state.film.presetId = f.presetId;
      if (f.countChoice) state.film.countChoice = String(f.countChoice);
      if (f.subtitle && typeof f.subtitle === 'object') state.film.subtitle = f.subtitle;
      if (f.tts && $('#sel-tts')) $('#sel-tts').value = f.tts;
      if (f.bgm && $('#sel-bgm')) $('#sel-bgm').value = f.bgm;
      if (f.bgmVol && $('#rg-bgm')) { $('#rg-bgm').value = f.bgmVol; if ($('#out-bgm')) $('#out-bgm').textContent = f.bgmVol + '%'; }
      if (typeof f.duck === 'boolean' && $('#tg-duck')) $('#tg-duck').checked = f.duck;
      if (typeof f.blogImages === 'boolean' && $('#tg-blog-images')) $('#tg-blog-images').checked = f.blogImages;
      if (f.autoCrop && $('#sel-auto-crop')) $('#sel-auto-crop').value = f.autoCrop;
      if (f.autoSilence && $('#sel-auto-silence')) $('#sel-auto-silence').value = f.autoSilence;
      if (f.autoCount && $('#sel-auto-count')) $('#sel-auto-count').value = f.autoCount;
      if (typeof f.autoAi === 'boolean' && $('#tg-auto-ai')) $('#tg-auto-ai').checked = f.autoAi;
    }
    refreshRanges();
    syncThemeLabel();
    syncSeg();
  }

  function currentDetect() {
    var target = Number($('#sel-target').value || 15000);
    return {
      silenceDb: Number($('#rg-silence').value),
      minSilenceMs: Number($('#rg-minside').value),
      padMs: Number($('#rg-pad').value),
      sceneSensitivity: Number($('#rg-scene').value),
      targetClipMs: target,
      minClipMs: Math.min(6000, Math.round(target * 0.45)),
      maxClipMs: Math.max(45000, target),
      clipCount: Number($('#sel-count').value),
      removeSilence: $('#tg-silence').checked
    };
  }

  function syncThemeLabel() {
    var dark = document.documentElement.getAttribute('data-theme') !== 'light';
    var b = $('#btn-theme');
    if (b) b.setAttribute('aria-label', dark ? '라이트 모드로 전환' : '다크 모드로 전환');
  }

  function syncSeg() {    $$('#track-modes .seg-btn').forEach(function (b) {
      var active = b.dataset.mode === state.mode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    var note = $('#mode-note');
    if (note) {
      note.textContent = state.mode === 'subject' ? L('피부톤 + 움직임 + 중앙 가중으로 크롭 중심을 부드럽게 따라갑니다.', 'Follows the crop center smoothly using skin tone, motion and a center bias.')
        : state.mode === 'motion' ? L('화면에서 가장 많이 움직이는 쪽을 따라갑니다. 손·제품 클로즈업에 유리합니다.', 'Follows the busiest part of the frame — good for hands and product close-ups.')
          : state.mode === 'blur' ? L('원본을 9:16으로 꽉 채워 흐리게 깔고, 안 잘린 원본을 가운데에 얹습니다.', 'Fills 9:16 with a blurred version and keeps the whole frame sharp in the middle.')
            : L('크롭을 가운데에 고정합니다. 화면이 안정적일 때 가장 깔끔합니다.', 'Locks the crop to the center — cleanest when the shot is steady.');
    }
    var chip = $('#out-mode');
    if (chip) chip.textContent = state.mode === 'subject' ? L('피사체 추적', 'Subject tracking')
      : state.mode === 'motion' ? L('움직임 추적', 'Motion tracking')
        : state.mode === 'blur' ? L('블러 배경', 'Blurred background') : L('중앙 고정', 'Fixed center');
  }

  function syncCaptionMode() {
    $$('#caption-modes .seg-btn').forEach(function (b) {
      var active = b.dataset.cmode === state.captionMode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    var note = $('#caption-mode-note');
    if (note) {
      note.textContent = state.captionMode === 'both'
        ? '해설 자막은 위, 원본 대사는 아래 — 두 층이 겹치지 않게 따로 그립니다.'
        : state.captionMode === 'commentary'
          ? '원본 대사 없이 해설만 얹습니다. 같은 장면이 새 해석의 콘텐츠가 됩니다.'
          : '원본 대사만 굽습니다. 해설 자막은 넣지 않습니다.';
    }
    var sel = $('#sel-comm-style');
    if (sel) sel.value = state.commentaryStyle;
  }

  /* ── 탭 ────────────────────────────────────────────────── */
  function setTab(name, push) {
    $$('.tab').forEach(function (t) {
      var active = t.dataset.tab === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.view').forEach(function (v) {
      var active = v.id === 'view-' + name;
      v.classList.toggle('is-active', active);
      if (active) v.removeAttribute('hidden'); else v.setAttribute('hidden', '');
    });
    if (name === 'clips') renderSheet();
    if (name === 'blog') { renderScenes(); filmDraw(state.film.tMs); }
    if (name !== 'blog' && state.film.playing) filmPause();
    if (push !== false) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* noop */ }
    }
  }

  /* ── 오버레이 ─────────────────────────────────────────── */
  var busyState = { active: false, cancel: null };
  function showBusy(title, text, cancelFn) {
    var b = $('#busy');
    busyState.active = true;
    busyState.cancel = cancelFn || null;
    $('#busy-title').textContent = title || '작업 중';
    $('#busy-text').textContent = text || '';
    $('#busy-bar').style.width = '0%';
    $('#btn-busy-cancel').hidden = !cancelFn;
    b.hidden = false;
  }
  function busyProgress(p, text) {
    $('#busy-bar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
    if (text) $('#busy-text').textContent = text;
  }
  function hideBusy() {
    busyState.active = false;
    busyState.cancel = null;
    $('#busy').hidden = true;
  }

  /* ── 원본 열기 ─────────────────────────────────────────── */
  function setSourceState(text, kind) {
    var box = $('#src-meta');
    var label = $('#src-state');
    if (label) label.textContent = tr(text);
    if (!box) return;
    box.classList.toggle('is-ready', kind === 'ready');
    box.classList.toggle('is-busy', kind === 'busy');
  }

  function clearSourceUi() {
    $('#src-res').textContent = '— × —';
    $('#src-fmt').textContent = '—';
    $('#src-audio').textContent = 'AUDIO —';
    $('#src-tc').textContent = '00:00:00:00';
    $('#src-badge').hidden = true;
    $('#screen-empty').hidden = false;
    $('#preview-empty').hidden = false;
    $('#src-crop-guide').hidden = true;
    $('#phone-live').hidden = true;
    ['#btn-play', '#btn-prev-cut', '#btn-next-cut', '#scrub', '#btn-add-clip', '#btn-redetect'].forEach(function (s) {
      var n = $(s); if (n) n.disabled = true;
    });
  }

  function openBlob(blob, name, opts) {
    var o = opts || {};
    if (!blob) return Promise.reject(new Error('파일이 비었습니다.'));
    if (state.rendering) {
      toast('렌더가 끝난 뒤에 원본을 바꿀 수 있습니다.', 'warn');
      return Promise.reject(new Error('렌더 중'));
    }
    pausePlayback();
    if (state.source && state.source.url) {
      try { URL.revokeObjectURL(state.source.url); } catch (e) { /* noop */ }
    }
    if (state.wave && state.wave.destroy) {
      try { state.wave.destroy(); } catch (e) { /* noop */ }
      state.wave = null;
    }
    state.analysis = null;
    state.clips = [];
    state.queue = [];
    state.thumbToken = (state.thumbToken || 0) + 1;
    state.activeClipId = '';
    state.playMode = 'source';
    state.localMs = 0;
    clearSourceUi();
    renderClips();
    renderQueue();
    renderTimeline();
    renderStats();
    var url = URL.createObjectURL(blob);
    var video = $('#src-video');
    video.pause();
    video.src = url;
    video.muted = false;
    setSourceState('원본을 읽는 중… ' + name, 'busy');
    showBusy('원본을 여는 중', name);
    return M.waitMeta(video).then(function () {
      var durationMs = Math.round((video.duration || 0) * 1000);
      if (!video.videoWidth || !durationMs) throw new Error('영상 정보를 읽지 못했습니다. 형식을 확인해 주세요.');
      state.source = {
        name: name,
        blob: blob,
        url: url,
        video: video,
        durationMs: durationMs,
        width: video.videoWidth,
        height: video.videoHeight,
        isDemo: !!o.isDemo,
        demo: o.demo || null,
        audioBuffer: o.audioBuffer || null
      };
      $('#screen-empty').hidden = true;
      $('#preview-empty').hidden = true;
      $('#src-badge').hidden = false;
      $('#src-res').textContent = video.videoWidth + ' × ' + video.videoHeight;
      $('#src-fmt').textContent = (blob.type || 'video').replace('video/', '').toUpperCase() + ' · ' + C.bytes(blob.size);
      $('#src-audio').textContent = 'AUDIO 확인 중';
      ['#btn-play', '#btn-prev-cut', '#btn-next-cut', '#scrub', '#btn-add-clip', '#btn-redetect'].forEach(function (s) {
        var n = $(s); if (n) n.disabled = false;
      });
      video.currentTime = 0;
      setSourceState(name + ' · ' + C.clock(durationMs) + ' · ' + video.videoWidth + '×' + video.videoHeight, 'ready');
      if (state.source.demo && state.source.demo.cues && state.source.demo.cues.length) {
        setCues(state.source.demo.cues, '데모 자막 ' + state.source.demo.cues.length + '개');
      }
      log('원본 열기: ' + name + ' · ' + C.clock(durationMs) + ' · ' + video.videoWidth + '×' + video.videoHeight, 'key');
      drawPreview(true);
      return runAnalysis(false);
    }).catch(function (err) {
      setSourceState('원본을 열지 못했습니다: ' + (err && err.message ? err.message : err), '');
      toast('원본을 열지 못했습니다: ' + (err && err.message ? err.message : err), 'error');
      throw err;
    }).finally(function () {
      hideBusy();
      syncAutoButton();
    });
  }

  function openFile(file) {
    if (!file) return;
    var okType = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|mkv|ogv)$/i.test(file.name);
    if (!okType) { toast('영상 파일(MP4·WebM·MOV)을 골라 주세요.', 'warn'); return; }
    if (file.size > 1.6 * 1024 * 1024 * 1024) {
      toast('1.6GB가 넘는 파일은 브라우저 메모리에 올리기 어렵습니다. 먼저 잘라 주세요.', 'warn');
      return;
    }
    openBlob(file, file.name, {}).catch(function () { /* already toasted */ });
  }

  function buildDemo() {
    if (busyState.active) return;
    pausePlayback();
    var signal = { cancelled: false };
    state.demoSignal = signal;
    showBusy('데모 VOD를 만드는 중', 'Canvas 장면 5개와 말소리 블록을 합성합니다.', function () {
      signal.cancelled = true;
    });
    log('데모 VOD 생성 시작 (32초 · 960×540 · H.264)');
    D.build({
      signal: signal,
      onProgress: function (p) {
        busyProgress(p.progress, p.label);
        setSourceState(p.label, 'busy');
      }
    }).then(function (demo) {
      hideBusy();
      return R.capability().then(function (cap) {
        state.cap = cap;
        return openBlob(demo.blob, demo.name, { isDemo: true, demo: demo, audioBuffer: demo.audioBuffer });
      });
    }).then(function () {
      log('데모 VOD 준비 완료 · 무음 6구간 · 장면 5개', 'key');
    }).catch(function (err) {
      hideBusy();
      if (err && err.message === 'canceled') {
        log('데모 생성을 취소했습니다.', 'warn');
        setSourceState('데모 생성을 취소했습니다.', '');
        return;
      }
      toast('데모를 만들지 못했습니다: ' + (err && err.message ? err.message : err), 'error');
      setSourceState('데모 생성 실패', '');
    }).finally(function () {
      state.demoSignal = null;
    });
  }

  /* ── 분석 ─────────────────────────────────────────────── */
  function runAnalysis(replanOnly) {
    if (!state.source) return Promise.resolve();
    if (state.rendering) {
      toast('렌더가 끝난 뒤에 감지를 바꿀 수 있습니다.', 'warn');
      return Promise.resolve();
    }
    pausePlayback();
    var detect = currentDetect();
    state.detect = detect;
    var signal = { cancelled: false };
    state.analysisSignal = signal;
    var isReplan = !!(replanOnly && state.analysis);
    showBusy(isReplan ? '설정으로 다시 감지하는 중' : '원본을 분석하는 중',
      isReplan ? '이미 읽은 파형과 표본으로 클립을 다시 계획합니다.' : '소리와 장면을 표본으로 훑습니다. 영상은 밖으로 나가지 않습니다.',
      function () { signal.cancelled = true; });
    var task = isReplan
      ? Promise.resolve(M.replan(state.analysis, detect))
      : M.analyze({
        video: state.source.video,
        blob: state.source.blob,
        audioBuffer: state.source.audioBuffer,
        durationMs: state.source.durationMs,
        detect: detect,
        smooth: state.smooth,
        signal: signal,
        onProgress: function (p) {
          busyProgress(p.progress, p.label);
          $('#tick-bar').style.width = Math.round(p.progress * 100) + '%';
        }
      });
    return task.then(function (analysis) {
      state.analysis = analysis;
      state.cueCache = {};
      var prevByRange = {};
      state.clips.forEach(function (c) { prevByRange[c.startMs + ':' + c.endMs] = c; });
      state.clips = analysis.clips.slice(0, 12).map(function (c) {
        var prev = prevByRange[c.startMs + ':' + c.endMs];
        return Object.assign({}, c, {
          title: prev ? prev.title : '',
          hook: prev ? prev.hook : '',
          hashtags: prev ? prev.hashtags.slice() : [],
          selected: prev ? prev.selected : c.selected,
          rendered: prev ? prev.rendered : null
        });
      });
      if (!state.activeClipId || !state.clips.some(function (c) { return c.id === state.activeClipId; })) {
        var first = state.clips.filter(function (c) { return c.selected; })[0] || state.clips[0];
        state.activeClipId = first ? first.id : '';
      }
      state.playMode = 'source';
      state.localMs = 0;
      buildWaveform();
      renderAll();
      log('분석 완료 · 말소리 ' + C.clock(analysis.stats.speechMs) + ' · 무음 ' + C.clock(analysis.stats.silentMs) +
        ' · 컷 ' + analysis.stats.cutCount + '곳 · 클립 ' + analysis.stats.clipCount + '개' +
        ' (' + analysis.stats.analysisMs + 'ms)', 'key');
      if (!analysis.audioBuffer) log('이 파일에서는 소리를 읽지 못해 무음 제거를 건너뜁니다(화면 표본만 사용).', 'warn');
      if (analysis.cuts.length) log('장면 컷 후보: ' + analysis.cuts.slice(0, 6).map(function (c) { return C.clock(c.tMs); }).join(', ') +
        (analysis.cuts.length > 6 ? ' 외 ' + (analysis.cuts.length - 6) + '곳' : ''));
      toast('분석 완료 · 클립 ' + state.clips.length + '개를 골랐습니다.', '');
      drawPreview(true);
      refreshThumbs();
      return analysis;
    }).catch(function (err) {
      if (err && err.message === 'canceled') {
        log('분석을 취소했습니다.', 'warn');
        setSourceState('분석이 취소되었습니다. 다시 시도해 주세요.', '');
        return null;
      }
      log('분석 실패: ' + (err && err.message ? err.message : err), 'error');
      toast('분석에 실패했습니다: ' + (err && err.message ? err.message : err), 'error');
      setSourceState('분석 실패 · 형식이나 길이를 확인해 주세요.', '');
      return null;
    }).finally(function () {
      state.analysisSignal = null;
      hideBusy();
      refreshRanges();
      syncAutoButton();
    });
  }

  /* ══════════════════════════════════════════════════════════
     V2 · 원버튼 자동 쇼츠 (영상 → 9:16)
     ══════════════════════════════════════════════════════════ */
  var AUTO_STEPS = ['analyze', 'cut', 'crop', 'text', 'render'];

  function autoStep(name, status) {
    var li = document.querySelector('#auto-steps li[data-step="' + name + '"]');
    if (!li) return;
    li.classList.remove('is-busy', 'is-done', 'is-warn');
    if (status) li.classList.add('is-' + status);
    state.auto.steps[name] = status || '';
  }

  function autoReset() {
    AUTO_STEPS.forEach(function (n) {
      var li = document.querySelector('#auto-steps li[data-step="' + n + '"]');
      if (li) li.classList.remove('is-busy', 'is-done', 'is-warn');
    });
    state.auto.steps = {};
    state.auto.degraded = '';
  }

  function autoStatus(text) {
    var node = $('#auto-hint');
    if (node) node.textContent = text;
  }

  function syncAutoButton() {
    var btn = $('#btn-auto-run');
    if (!btn) return;
    btn.disabled = !state.source || state.auto.busy || state.rendering || busyState.active;
  }

  /** 자동 패널의 선택을 기존 감지·리프레임 설정에 그대로 반영한다. */
  function applyAutoChoices() {
    var crop = $('#sel-auto-crop');
    var sil = $('#sel-auto-silence');
    var cnt = $('#sel-auto-count');
    if (crop && ['subject', 'motion', 'center', 'blur'].indexOf(crop.value) >= 0) state.mode = crop.value;
    var minSil = Number(sil ? sil.value : 600);
    if ($('#tg-silence')) $('#tg-silence').checked = minSil > 0;
    if (minSil > 0) {
      if ($('#rg-minside')) $('#rg-minside').value = String(minSil);
      if ($('#out-minside')) $('#out-minside').textContent = minSil + ' ms';
    }
    if (cnt && $('#sel-count')) $('#sel-count').value = String(Math.max(2, Math.min(8, Number(cnt.value) || 3)));
    refreshRanges();
    syncSeg();
    state.dirty = true;
  }

  /** 대본 → 자막 배분 (자막 파일이 없어도 된다) */
  function applyScriptToCues(silent) {
    var ta = $('#ta-script');
    var text = ta && ta.value ? ta.value.trim() : '';
    var status = $('#script-status');
    if (!text) {
      if (!silent) toast(L('대본을 먼저 붙여넣으세요.', 'Paste a script first.'), 'warn');
      return [];
    }
    var segs = (state.analysis && state.analysis.keep && state.analysis.keep.length)
      ? state.analysis.keep
      : [{ startMs: 0, endMs: state.source ? state.source.durationMs : Math.max(20000, text.length * 220) }];
    var cues = C.scriptToCues(text, {
      segments: segs,
      durationMs: state.source ? state.source.durationMs : Math.max(20000, text.length * 220)
    });
    if (!cues.length) {
      if (!silent) toast(L('대본을 자막으로 나누지 못했습니다.', 'Could not split the script into captions.'), 'warn');
      return [];
    }
    setCues(cues, L(cues.length + '줄 · 대본 배분', cues.length + ' lines · from script'));
    if (status) {
      status.textContent = state.analysis
        ? L('말소리 구간에 ' + cues.length + '줄을 배분했습니다. 타임코드는 직접 고칠 수 있습니다.', 'Placed ' + cues.length + ' lines across the speech segments. You can edit the timecodes.')
        : L('영상 분석 전이라 화면 길이에 고르게 배분했습니다. 영상을 넣으면 말소리 기준으로 다시 배분하세요.', 'Distributed evenly before analysis. Add the video and run it again for speech-based timing.');
    }
    log(L('대본 → 자막 ' + cues.length + '줄 배분', 'Script → ' + cues.length + ' caption lines'), 'key');
    if (!silent) toast(L('대본을 ' + cues.length + '줄 자막으로 나눴습니다.', 'Split the script into ' + cues.length + ' caption lines.'), '');
    return cues;
  }

  /** AI 제공자 순서: 내 Gemini 키 → Pro → 무료 맛보기 → 규칙 */
  function aiOrder() {
    var order = [];
    try { if (G && G.hasKey()) order.push('gemini'); } catch (e) { /* noop */ }
    try { if (Pro && typeof Pro.isConnected === 'function' && Pro.isConnected()) order.push('pro'); } catch (e2) { /* noop */ }
    if (Free && typeof Free.generate === 'function') order.push('free');
    order.push('local');
    return order;
  }

  /** 클립 하나의 제목·훅을 한 제공자로 시도하고, 실패하면 규칙으로 내려간다. */
  function hookOnce(clip, provider) {
    var captions = state.cues.filter(function (c) { return c.startMs < clip.endMs && c.endMs > clip.startMs; })
      .map(function (c) { return c.text; });
    var local = C.localHook(captions.length ? captions : [clip.title || ''], { note: 'local' });
    if (provider === 'local') return Promise.resolve({ ok: true, data: local, source: 'local' });
    var built = C.buildHookPrompt({
      durationMs: clip.durationMs,
      sourceName: state.source ? state.source.name : '',
      captions: captions
    });
    var payload = { prompt: built.prompt, system: built.system, options: { json: true, maxTokens: 700 } };
    var task;
    if (provider === 'gemini') {
      task = G.generate(payload).then(function (res) {
        if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'failed', provider: 'gemini' };
        var parsed = C.parseHookJSON(res.text);
        if (!parsed.ok) return { ok: false, reason: 'parse', provider: 'gemini' };
        return { ok: true, data: parsed, source: 'gemini', model: res.model };
      });
    } else if (provider === 'pro') {
      task = Promise.resolve(Pro.generate(payload)).then(function (res) {
        if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'failed', provider: 'pro' };
        var parsed = C.parseHookJSON(res.text);
        if (!parsed.ok) return { ok: false, reason: 'parse', provider: 'pro' };
        return { ok: true, data: parsed, source: 'pro' };
      });
    } else {
      task = Free.generate(payload).then(function (res) {
        if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'failed', provider: 'free', res: res };
        var parsed = C.parseHookJSON(res.text);
        if (!parsed.ok) return { ok: false, reason: 'parse', provider: 'free' };
        return { ok: true, data: parsed, source: 'free' };
      });
    }
    return task.catch(function () { return { ok: false, reason: 'error', provider: provider }; }).then(function (out) {
      if (out.ok) return out;
      return { ok: true, data: local, source: 'local', fellBack: out };
    });
  }

  function applyHook(clip, data, source) {
    if (!clip || !data) return;
    if (data.title) clip.title = data.title;
    if (data.hook) clip.hook = data.hook;
    if (data.hashtags && data.hashtags.length) clip.hashtags = data.hashtags;
    clip.hookSource = source || 'local';
  }

  /** 선택한 클립들에 제목·훅을 차례로 붙인다. */
  function autoHooksFor(clips, useAI) {
    if (!clips.length) return Promise.resolve();
    var order = useAI ? aiOrder() : ['local'];
    var provider = order[0];
    var failed = '';
    var i = 0;
    function step() {
      if (i >= clips.length) return Promise.resolve();
      var clip = clips[i];
      autoStatus(L('제목·훅 ' + (i + 1) + ' / ' + clips.length + ' · ' + provider, 'Title & hook ' + (i + 1) + ' / ' + clips.length + ' · ' + provider));
      return hookOnce(clip, failed ? 'local' : provider).then(function (out) {
        applyHook(clip, out.data, out.source);
        if (out.fellBack && !failed) {
          failed = out.fellBack.reason || 'failed';
          var idx = order.indexOf(provider);
          provider = order[Math.min(order.length - 1, idx + 1)] || 'local';
          state.auto.degraded = failed;
          log(L('AI 제목 실패(' + (out.fellBack.reason || 'error') + ') → ' + provider + '로 계속', 'AI title failed (' + (out.fellBack.reason || 'error') + ') → continuing with ' + provider), 'warn');
        }
        i++;
        renderClips();
        renderQueue();
        return step();
      });
    }
    return step();
  }

  /**
   * 영상 → 쇼츠 전 과정: 분석 → 무음·장면 컷 → 9:16 → 자막·제목 → MP4
   */
  function runAuto() {
    if (state.auto.busy) return;
    if (!state.source) { toast(L('영상 파일이나 데모 VOD를 먼저 넣어 주세요.', 'Add a video file or build the demo VOD first.'), 'warn'); return; }
    if (state.rendering) { toast(L('렌더가 끝난 뒤에 다시 눌러 주세요.', 'Try again after the current render finishes.'), 'warn'); return; }
    state.auto.busy = true;
    autoReset();
    applyAutoChoices();
    syncAutoButton();
    var script = ($('#ta-script') && $('#ta-script').value || '').trim();
    var count = Math.max(2, Math.min(8, Number($('#sel-auto-count') ? $('#sel-auto-count').value : 3) || 3));
    var useAI = $('#tg-auto-ai') ? $('#tg-auto-ai').checked : true;
    autoStep('analyze', 'busy');
    autoStatus(L('원본을 분석하는 중…', 'Analyzing the source…'));
    log(L('원버튼 자동 시작 · 무음 ' + ($('#sel-auto-silence').value || 0) + 'ms · ' + state.mode + ' · ' + count + '개', 'Auto run · silence ' + ($('#sel-auto-silence').value || 0) + 'ms · ' + state.mode + ' · ' + count + ' clips'), 'key');

    var picked = [];
    return runAnalysis(false).then(function (analysis) {
      if (!analysis) throw new Error(L('분석에 실패했습니다.', 'Analysis failed.'));
      autoStep('analyze', 'done');
      autoStep('cut', 'done');
      autoStep('crop', 'done');
      if (script) {
        autoStep('text', 'busy');
        var cues = applyScriptToCues(true);
        if (!cues.length) autoStep('text', 'warn');
      }
      picked = state.clips.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, count)
        .sort(function (a, b) { return a.startMs - b.startMs; });
      if (!picked.length) throw new Error(L('클립을 고르지 못했습니다. 무음 임계치를 낮춰 보세요.', 'No clips were selected. Try a stricter silence setting.'));
      state.clips.forEach(function (c) { c.selected = picked.indexOf(c) >= 0; });
      state.activeClipId = picked[0].id;
      state.playMode = 'clip';
      state.localMs = 0;
      syncQueueWithSelection();
      renderAll();
      attachThumbs();
      autoStep('text', 'busy');
      return autoHooksFor(picked, useAI);
    }).then(function () {
      autoStep('text', 'done');
      autoStep('render', 'busy');
      autoStatus(L('9:16 MP4로 뽑는 중…', 'Encoding 9:16 MP4…'));
      syncQueueWithSelection();
      renderQueue();
      return renderQueueRun(state.queue.slice());
    }).then(function () {
      autoStep('render', 'done');
      var done = state.queue.filter(function (q) { return q.status === 'done'; }).length;
      var title = picked[0] ? (picked[0].title || '') : '';
      autoStatus(done
        ? L('완료 · 클립 ' + done + '개를 MP4로 만들었습니다. 렌더 큐에서 받으세요.', 'Done · ' + done + ' clip(s) rendered. Download them from the render queue.')
        : L('렌더 결과가 없습니다. 렌더 큐를 확인해 주세요.', 'No rendered file. Check the render queue.'));
      log(L('원버튼 완료 · ' + done + '개 · ' + title, 'Auto run done · ' + done + ' clip(s) · ' + title), done ? 'key' : 'warn');
      if (done) toast(L('자동 완료 · MP4 ' + done + '개', 'Auto done · ' + done + ' MP4'), '');
      renderAll();
    }).catch(function (err) {
      var msg = (err && err.message) || String(err);
      if (msg === 'canceled') { autoStatus(L('취소했습니다.', 'Canceled.')); return; }
      autoStatus(L('자동 실행 실패: ' + msg, 'Auto run failed: ' + msg));
      log(L('원버튼 실패: ' + msg, 'Auto run failed: ' + msg), 'error');
      toast(L('자동 실행에 실패했습니다: ' + msg, 'Auto run failed: ' + msg), 'error');
    }).finally(function () {
      state.auto.busy = false;
      syncAutoButton();
    });
  }

  /* ── 파형 ─────────────────────────────────────────────── */
  function buildWaveform() {
    var host = $('#waveform');
    if (!host) return;
    host.innerHTML = '';
    if (state.wave && state.wave.destroy) {
      try { state.wave.destroy(); } catch (e) { /* noop */ }
      state.wave = null;
    }
    if (!state.analysis || !state.analysis.levels || !state.analysis.levels.length) {
      $('#wave-state').textContent = tr(state.analysis ? '소리 없음 · 파형 없음' : '원본 없음');
      drawFallbackWave();
      return;
    }
    var levels = state.analysis.levels;
    var step = state.analysis.stepMs;
    var durationMs = levels.length * step;
    var peaks = [];
    var bucket = Math.max(1, Math.floor(levels.length / 900));
    for (var i = 0; i < levels.length; i += bucket) {
      var mx = 0;
      for (var j = i; j < Math.min(levels.length, i + bucket); j++) if (levels[j] > mx) mx = levels[j];
      peaks.push(mx);
    }
    var max = peaks.reduce(function (a, b) { return Math.max(a, b); }, 0.0001);
    peaks = peaks.map(function (v) { return Math.min(1, v / max); });
    state.wavePeaks = peaks;
    $('#wave-state').textContent = tr(C.clock(durationMs) + ' · ' + C.bytes(state.source ? state.source.blob.size : 0));
    var WS = window.WaveSurfer;
    if (!WS) { drawFallbackWave(peaks); return; }
    try {
      state.wave = WS.create({
        container: host,
        height: 78,
        peaks: [peaks],
        duration: durationMs / 1000,
        waveColor: 'rgba(160, 173, 192, 0.55)',
        progressColor: 'rgba(255, 255, 255, 0)',
        cursorColor: 'rgba(255, 255, 255, 0)',
        cursorWidth: 0,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        normalize: true,
        interact: false,
        hideScrollbar: true,
        fillParent: true
      });
      $('#wave-meta').textContent = tr('표본 ' + peaks.length + ' · ' + Math.round(step) + 'ms');
    } catch (e) {
      drawFallbackWave(peaks);
    }
  }

  function drawFallbackWave(peaks) {
    var host = $('#waveform');
    if (!host) return;
    host.innerHTML = '';
    var data = peaks || [];
    var canvas = el('canvas', { width: 1200, height: 78, style: { width: '100%', height: '78px', display: 'block' } });
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data.length) {
      ctx.fillStyle = 'rgba(140,150,165,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText('파형 없음', 10, 44);
      return;
    }
    var bw = canvas.width / data.length;
    for (var i = 0; i < data.length; i++) {
      var h = Math.max(1, data[i] * 70);
      ctx.fillStyle = 'rgba(160,173,192,0.55)';
      ctx.fillRect(i * bw, (78 - h) / 2, Math.max(1, bw - 1), h);
    }
    $('#wave-meta').textContent = '표본 ' + data.length;
  }

  function renderWaveOverlay() {
    if (!state.analysis || !state.source) return;
    var dur = state.source.durationMs || 1;
    var silence = $('#silence-layer');
    var clips = $('#clip-layer');
    var cuts = $('#cut-layer');
    if (!silence || !clips || !cuts) return;
    silence.innerHTML = '';
    clips.innerHTML = '';
    cuts.innerHTML = '';
    (state.analysis.silence.regions || []).forEach(function (r) {
      silence.appendChild(el('div', {
        class: 'silence-block',
        style: { left: (r.startMs / dur) * 100 + '%', width: Math.max(0.15, (r.durMs / dur) * 100) + '%' },
        title: tr('죽은 초 ' + C.clock(r.durMs))
      }));
    });
    state.clips.forEach(function (c) {
      if (!c.selected) return;
      (c.ranges || []).forEach(function (r) {
        clips.appendChild(el('div', {
          class: 'clip-block' + (c.id === state.activeClipId ? ' is-current' : ''),
          style: { left: (r.startMs / dur) * 100 + '%', width: Math.max(0.2, (r.durMs / dur) * 100) + '%' }
        }));
      });
    });
    (state.analysis.cuts || []).forEach(function (cut) {
      cuts.appendChild(el('div', { class: 'cut-line', style: { left: (cut.tMs / dur) * 100 + '%' }, title: tr('장면 컷 ' + C.clock(cut.tMs)) }));
    });
  }

  /* ── 클립 카드 ─────────────────────────────────────────── */
  function clipById(id) {
    return state.clips.filter(function (c) { return c.id === id; })[0] || null;
  }

  function activeClip() {
    return clipById(state.activeClipId) || state.clips[0] || null;
  }

  function clipTrack(clip) {
    if (!clip) return null;
    if (state.analysis && state.analysis.tracks && state.analysis.tracks[clip.id]) return state.analysis.tracks[clip.id];
    /* 다시 감지한 클립은 표본 프레임으로 곡선을 즉시 만든다 */
    var frames = state.analysis ? state.analysis.frames : [];
    var pts = frames.filter(function (f) { return f.tMs >= clip.startMs && f.tMs <= clip.endMs; })
      .map(function (f) { return { tMs: f.tMs, x: C.trackCenter({ skin: f.skin, motion: f.motion }, state.mode) }; });
    if (!pts.length) return null;
    return { curve: C.buildCurve(pts, { smooth: state.smooth, maxStep: 0.06 }), frames: pts };
  }

  function defaultTitle(clip) {
    var cues = state.cues.filter(function (c) { return c.startMs >= clip.startMs && c.startMs < clip.endMs; });
    if (cues.length) return C.wrapCaption(cues[0].text, 18, 1)[0] || '';
    return '';
  }

  function retrackAll() {
    if (!state.analysis) return;
    Object.keys(state.analysis.tracks || {}).forEach(function (id) {
      var t = state.analysis.tracks[id];
      if (!t.frames || !t.frames.length) return;
      var pts = t.frames.map(function (f) { return { tMs: f.tMs, x: C.trackCenter({ skin: f.skin, motion: f.motion }, state.mode) }; });
      t.points = pts;
      t.curve = C.buildCurve(pts, { smooth: state.smooth, maxStep: 0.055 });
    });
    state.cueCache = {};
    drawPreview(true);
  }

  function renderClips() {
    var list = $('#clip-cards');
    if (!list) return;
    list.innerHTML = '';
    if (!state.clips.length) {
      list.appendChild(el('div', { class: 'empty-state', id: 'clips-empty' }, [
        el('p', {}, [el('strong', { text: '아직 클립이 없습니다. ' }), '원본을 넣으면 무음과 장면 컷을 읽어 하이라이트를 자동으로 골라 둡니다.'])
      ]));
      $('#clip-count').textContent = '0';
      $('#tab-clip-count').textContent = '0';
      return;
    }
    state.clips.forEach(function (clip, i) {
      var selected = !!clip.selected;
      var card = el('article', { class: 'clip-card' + (selected ? ' is-selected' : '') + (clip.id === state.activeClipId ? ' is-previewing' : ''), dataset: { id: clip.id } });
      var check = el('button', {
        type: 'button', class: 'clip-check', role: 'checkbox',
        'aria-checked': selected ? 'true' : 'false',
        'aria-label': '클립 ' + (i + 1) + ' 선택'
      });
      on(check, 'click', function (e) {
        e.stopPropagation();
        clip.selected = !clip.selected;
        syncQueueWithSelection();
        renderClips();
        renderQueue();
        renderTimeline();
        updateTicks();
        savePrefs();
      });

      var main = el('div', { class: 'clip-main' });
      var top = el('div', { class: 'clip-top' }, [
        el('span', { class: 'clip-index', text: 'CLIP ' + ('0' + (i + 1)).slice(-2) }),
        clip.source === 'story' ? el('span', { class: 'clip-src', text: 'STORY' }) : null,
        el('span', { class: 'clip-dur', text: tr((clip.durationMs / 1000).toFixed(1) + '초') }),
        el('span', { class: 'clip-range', text: C.clock(clip.startMs) + ' → ' + C.clock(clip.endMs) }),
        el('span', { class: 'clip-score' }, [
          el('i', {}, [el('b', { style: { width: (clip.score || 0) + '%' } })]),
          String(clip.score || 0)
        ])
      ]);
      var title = el('input', {
        type: 'text', class: 'clip-title', maxlength: '60',
        placeholder: '제목 없음 — AI 훅으로 만들거나 직접 입력',
        value: clip.title || '',
        'aria-label': '클립 ' + (i + 1) + ' 제목'
      });
      on(title, 'input', function () { clip.title = title.value; renderQueue(); });
      var hook = el('div', { class: 'clip-hook' }, [
        el('span', { class: 'mono-label', text: 'HOOK' }),
        el('input', {
          type: 'text', maxlength: '90', placeholder: '첫 2초에 읽을 문장',
          value: clip.hook || '', 'aria-label': '클립 ' + (i + 1) + ' 훅'
        })
      ]);
      on(hook.querySelector('input'), 'input', function (e) { clip.hook = e.target.value; });
      var tags = el('div', { class: 'clip-tags' }, (clip.hashtags && clip.hashtags.length ? clip.hashtags : ['']).map(function (t, ti) {
        return el('span', { class: 'clip-tag' + (t ? '' : ' empty'), text: t ? '#' + t : tr('#태그 없음') });
      }));
      main.appendChild(top);
      var mediaRow = el('div', { class: 'clip-media' });
      if (clip.thumb) {
        var img = el('img', {
          src: clip.thumb, alt: '클립 ' + (i + 1) + ' 9:16 미리보기',
          loading: 'lazy',
          class: 'clip-thumb'
        });
        mediaRow.appendChild(img);
      }
      var textCol = el('div', { class: 'clip-text' }, [title, hook, tags]);
      mediaRow.appendChild(textCol);
      main.appendChild(mediaRow);
      if (clip.rendered) {
        main.appendChild(el('span', { class: 'clip-render-status done', text: 'MP4 ' + C.bytes(clip.rendered.size) + ' · ' + (clip.rendered.encodeMs / 1000).toFixed(1) + '초 만에 완료' }));
      }
      if (clip.commentaryCues && clip.commentaryCues.length) {
        main.appendChild(el('span', {
          class: 'clip-comm',
          text: tr('해설 자막 ' + clip.commentaryCues.length + '줄 · ' +
            (clip.commentarySource === 'ai' ? 'AI' : clip.commentarySource === 'mixed' ? 'AI+초안' : '자막 초안'))
        }));
      }

      var actions = el('div', { class: 'clip-actions' });
      actions.appendChild(el('button', {
        type: 'button', class: 'btn btn-soft mini', text: '미리보기',
        onclick: function () { previewClip(clip); }
      }));
      actions.appendChild(el('button', {
        type: 'button', class: 'btn btn-soft mini', text: 'AI 훅',
        onclick: function () { makeHook(clip); }
      }));
      actions.appendChild(el('button', {
        type: 'button', class: 'btn btn-soft mini', text: '이 클립만 렌더',
        onclick: function () { renderOne(clip); }
      }));
      actions.appendChild(el('button', {
        type: 'button', class: 'btn btn-soft mini', text: '삭제',
        onclick: function () { removeClip(clip); }
      }));

      card.appendChild(check);
      card.appendChild(main);
      card.appendChild(actions);
      on(card, 'click', function (e) {
        if (e.target.closest('button, input')) return;
        previewClip(clip);
      });
      list.appendChild(card);
    });
    $('#clip-count').textContent = String(state.clips.length);
    $('#tab-clip-count').textContent = String(state.clips.length);
    renderTimeline();
  }

  function removeClip(clip) {
    state.clips = state.clips.filter(function (c) { return c.id !== clip.id; });
    if (state.activeClipId === clip.id) {
      var next = state.clips[0];
      state.activeClipId = next ? next.id : '';
    }
    syncQueueWithSelection();
    renderAll();
    log('클립 삭제: ' + (clip.title || clip.id), 'warn');
  }

  function previewClip(clip) {
    if (!clip || !state.source) return;
    state.activeClipId = clip.id;
    state.playMode = 'clip';
    state.localMs = 0;
    var v = state.source.video;
    state.muteBefore = v.muted;
    v.muted = true;
    try { v.currentTime = R.sourceTimeAt(clip, 0) / 1000; } catch (e) { /* noop */ }
    renderClips();
    drawPreview(true);
    renderCommentary();
    startPlayback();
  }

  function previewSource() {
    if (!state.source) return;
    pausePlayback();
    state.playMode = 'source';
    var v = state.source.video;
    v.muted = false;
    state.localMs = v.currentTime * 1000;
    state.dirty = true;
    renderClips();
    drawPreview(true);
    updateClock();
  }

  /* ── 재생 ─────────────────────────────────────────────── */
  function startPlayback() {
    var v = state.source && state.source.video;
    if (!v || !state.source) return;
    if (state.playMode === 'source') {
      v.muted = false;
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* 자동재생 차단 */ });
    } else {
      var clip = activeClip();
      if (!clip) return;
      v.muted = false;
      try { v.volume = Number($('#rg-vol') ? $('#rg-vol').value : 100) / 100; } catch (e) { /* noop */ }
      var pp = v.play();
      if (pp && pp.catch) pp.catch(function () { /* noop */ });
      state.playClock = performance.now();
      state.playStartLocal = state.localMs;
    }
    state.playing = true;
    state.lastFrame = performance.now();
    $('.transport').classList.add('is-playing');
    var playBtn = $('#btn-play');
    if (playBtn) playBtn.setAttribute('aria-label', '일시정지');
    requestTick();
  }

  function pausePlayback() {
    var v = state.source && state.source.video;
    if (v) v.pause();
    state.playing = false;
    $('.transport').classList.remove('is-playing');
    var playBtn = $('#btn-play');
    if (playBtn) playBtn.setAttribute('aria-label', '재생');
  }

  function togglePlay() {
    if (!state.source) return;
    if (state.playing) pausePlayback();
    else startPlayback();
  }

  var rafId = 0;
  function requestTick() {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    rafId = 0;
    if (!state.source) return;
    var v = state.source.video;
    var clip = state.playMode === 'clip' ? activeClip() : null;
    if (state.playing) {
      if (state.playMode === 'clip' && clip) {
        var local = state.playStartLocal + (performance.now() - state.playClock);
        if (local >= clip.durationMs) {
          if ($('#tg-loop').checked) {
            state.localMs = 0;
            state.playStartLocal = 0;
            state.playClock = performance.now();
            v.currentTime = R.sourceTimeAt(clip, 0) / 1000;
            local = 0;
          } else {
            state.localMs = clip.durationMs;
            pausePlayback();
            drawPreview(true);
            updateClock();
            return;
          }
        }
        state.localMs = local;
        var srcMs = R.sourceTimeAt(clip, local);
        var drift = Math.abs(v.currentTime * 1000 - srcMs);
        if (drift > 220) {
          try { v.currentTime = srcMs / 1000; } catch (e) { /* noop */ }
        }
      } else {
        state.localMs = v.currentTime * 1000;
        if (v.ended) {
          if ($('#tg-loop').checked && state.source) {
            v.currentTime = 0;
            v.play().catch(function () { /* noop */ });
          } else {
            pausePlayback();
          }
        }
      }
      state.dirty = true;
    }
    if (state.dirty) {
      drawPreview(false);
      updateClock();
      state.dirty = false;
    }
    if (state.playing) requestTick();
  }

  function updateClock() {
    var clip = state.playMode === 'clip' ? activeClip() : null;
    var localMs = state.localMs || 0;
    var srcMs = clip ? R.sourceTimeAt(clip, Math.min(localMs, clip.durationMs)) : (state.source ? state.source.video.currentTime * 1000 : 0);
    var total = clip ? clip.durationMs : (state.source ? state.source.durationMs : 0);
    $('#tc-main').textContent = C.timecode(localMs, Number($('#sel-fps').value || 30));
    $('#src-tc').textContent = C.timecode(srcMs, Number($('#sel-fps').value || 30));
    $('#out-tc').textContent = (localMs / 1000).toFixed(1) + 's / ' + (total / 1000).toFixed(1) + 's';
    var scrub = $('#scrub');
    if (scrub && document.activeElement !== scrub) scrub.value = String(total ? Math.round((localMs / total) * 1000) : 0);
    var ph = $('#wave-playhead');
    if (ph && state.source) ph.style.left = ((srcMs / state.source.durationMs) * 100) + '%';
    var tlph = $('#tl-playhead');
    if (tlph && state.source) {
      var trackW = $('#timeline') ? $('#timeline').clientWidth - 76 : 0;
      tlph.style.left = (62 + (srcMs / Math.max(1, state.source.durationMs)) * Math.max(0, trackW)) + 'px';
    }
    var outClip = $('#out-clip');
    if (outClip) outClip.textContent = clip ? 'CLIP ' + ('0' + (state.clips.indexOf(clip) + 1)).slice(-2) + ' · ' + (clip.durationMs / 1000).toFixed(1) + 's' : 'SOURCE';
  }

  /* ── 프리뷰 그리기 ─────────────────────────────────────── */
  function currentCues(clip) {
    var key = clip ? clip.id + ':' + state.cueRevision : 'source:' + state.cueRevision;
    if (state.cueCache[key]) return state.cueCache[key];
    var mapped = clip ? R.mapCues(clip, state.cues) : state.cues.map(function (c) { return { startMs: c.startMs, endMs: c.endMs, text: c.text }; });
    state.cueCache[key] = mapped;
    return mapped;
  }

  var sourceTrackCache = { key: '', track: null };
  /** 원본 전체를 훑은 추적 곡선 — 소스 모드 프리뷰도 피사체를 따라간다. */
  function sourceTrack() {
    var d = state.source ? state.source.durationMs : 1000;
    if (!state.analysis || !state.analysis.frames || !state.analysis.frames.length) {
      return { curve: [{ tMs: 0, x: 0.5 }, { tMs: Math.max(1000, d), x: 0.5 }] };
    }
    var key = state.mode + '|' + state.smooth;
    if (sourceTrackCache.key === key && sourceTrackCache.track) return sourceTrackCache.track;
    var pts = state.analysis.frames.map(function (f) {
      return { tMs: f.tMs, x: C.trackCenter({ skin: f.skin, motion: f.motion }, state.mode) };
    });
    var track = {
      curve: C.buildCurve(pts, { smooth: state.smooth, maxStep: 0.05 }),
      frames: pts
    };
    sourceTrackCache = { key: key, track: track };
    return track;
  }

  function syntheticClip() {
    var d = state.source ? state.source.durationMs : 1000;
    return { id: 'source', startMs: 0, endMs: d, durationMs: d, ranges: [{ startMs: 0, endMs: d, durMs: d }] };
  }

  function drawPreview(force) {
    if (!state.source) return;
    var canvas = $('#preview-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var clip = state.playMode === 'clip' ? activeClip() : syntheticClip();
    if (!clip) return;
    var localMs = state.playMode === 'clip' ? Math.min(state.localMs, clip.durationMs) : state.source.video.currentTime * 1000;
    var style = C.CAPTION_STYLES.filter(function (s) { return s.id === state.styleId; })[0] || C.CAPTION_STYLES[0];
    var out = R.drawFrame(ctx, {
      video: state.source.video,
      clip: clip,
      track: clip.id === 'source' ? sourceTrack() : clipTrack(clip),
      localMs: localMs,
      outW: canvas.width,
      outH: canvas.height,
      mode: state.mode,
      zoom: state.zoom,
      cues: currentCues(clip.id === 'source' ? null : clip),
      commentary: currentCommentary(clip.id === 'source' ? null : clip),
      captionMode: state.captionMode,
      commentaryStyle: state.commentaryStyle,
      captionOn: $('#tg-captions').checked,
      style: style
    });
    updateCropGuide(out.rect);
  }

  function updateCropGuide(rect) {
    if (!state.source || !rect) return;
    var guide = $('#src-crop-guide');
    if (!guide) return;
    var screen = $('#src-screen');
    if (!screen) return;
    var box = screen.getBoundingClientRect();
    var vw = state.source.width, vh = state.source.height;
    if (!vw || !vh || !box.width) { guide.hidden = true; return; }
    var scale = Math.min(box.width / vw, box.height / vh);
    var dw = vw * scale, dh = vh * scale;
    var ox = (box.width - dw) / 2, oy = (box.height - dh) / 2;
    guide.hidden = false;
    guide.style.left = (ox + rect.x * scale) + 'px';
    guide.style.top = (oy + rect.y * scale) + 'px';
    guide.style.width = (rect.w * scale) + 'px';
    guide.style.height = (rect.h * scale) + 'px';
    guide.style.bottom = 'auto';
    $('#out-crop').textContent = tr('크롭 ' + Math.round(rect.w) + '×' + Math.round(rect.h));
  }

  /* ── 통계·타임라인 ─────────────────────────────────────── */
  function renderStats() {
    var a = state.analysis;
    var s = a ? a.stats : null;
    $('#tick-source').textContent = state.source ? C.clock(state.source.durationMs) : '—';
    $('#tick-speech').textContent = s ? C.clock(s.speechMs) : '—';
    $('#tick-cuts').textContent = s ? tr(s.cutCount + '곳') : '—';
    $('#tick-clips').textContent = state.clips.length ? tr(state.clips.length + '개') : '—';
    var done = state.queue.filter(function (q) { return q.status === 'done'; }).length;
    $('#tick-queue').textContent = done + ' / ' + state.queue.length;
    var detectSummary = $('#detect-summary');
    if (detectSummary) {
      if (!s) detectSummary.textContent = tr('원본을 넣으면 자동으로 분석합니다.');
      else {
        var sil = a.silence.regions.length;
        detectSummary.textContent = tr('무음 ' + C.clock(a.silence.silentMs) + ' (' + sil + '곳) · 컷 ' + s.cutCount +
          '곳 · 말소리 ' + C.clock(s.speechMs) + ' · 클립 ' + state.clips.length + '개');
      }
    }
    var tlMeta = $('#tl-meta');
    if (tlMeta) tlMeta.textContent = state.source ? tr(C.clock(state.source.durationMs) + ' · ' + (s ? s.samples : 0) + ' 표본') : '—';
  }

  function renderTimeline() {
    if (!state.source) return;
    var dur = state.source.durationMs || 1;
    var keep = state.analysis ? state.analysis.keep : [{ startMs: 0, endMs: dur, durMs: dur }];
    function lane(host, list, cls) {
      if (!host) return;
      host.innerHTML = '';
      list.forEach(function (r) {
        host.appendChild(el('i', {
          class: cls,
          style: { left: (r.startMs / dur) * 100 + '%', width: Math.max(0.2, ((r.endMs - r.startMs) / dur) * 100) + '%' }
        }));
      });
    }
    lane($('#tl-video'), keep, 'tl-seg');
    lane($('#tl-speech'), keep, 'tl-seg');
    var cutHost = $('#tl-cut');
    if (cutHost) {
      cutHost.innerHTML = '';
      (state.analysis ? state.analysis.cuts : []).forEach(function (cut) {
        cutHost.appendChild(el('i', { class: 'tl-cut', style: { left: (cut.tMs / dur) * 100 + '%' } }));
      });
    }
    var outHost = $('#tl-out');
    if (outHost) {
      outHost.innerHTML = '';
      if (state.clips.length) {
        state.clips.forEach(function (c) {
          outHost.appendChild(el('i', {
            class: 'tl-seg' + (c.selected ? '' : ' dim'),
            style: { left: (c.startMs / dur) * 100 + '%', width: Math.max(0.2, ((c.endMs - c.startMs) / dur) * 100) + '%' }
          }));
        });
      } else {
        outHost.appendChild(el('i', { class: 'tl-seg dim', style: { left: '0%', width: '100%' } }));
      }
    }
    renderWaveOverlay();
    updateClock();
  }

  /* ── 큐 ───────────────────────────────────────────────── */
  function presetById(id) {
    return C.PRESETS.filter(function (p) { return p.id === id; })[0] || C.PRESETS[0];
  }

  function syncQueueWithSelection() {
    var selected = state.clips.filter(function (c) { return c.selected; });
    var byId = {};
    state.queue.forEach(function (q) { byId[q.clipId] = q; });
    state.queue = selected.map(function (c) {
      return byId[c.id] || { clipId: c.id, status: 'idle', progress: 0, result: null, error: '' };
    });
    updateTicks();
  }

  function renderQueue() {
    var list = $('#render-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.queue.length) {
      list.appendChild(el('div', { class: 'empty-state small' }, [
        el('p', { text: '선택한 클립이 여기에 쌓입니다. 순서대로 실제 MP4가 만들어집니다.' })
      ]));
    }
    state.queue.forEach(function (q, i) {
      var clip = clipById(q.clipId);
      if (!clip) return;
      var name = C.clipFileName(state.clips.indexOf(clip), clip.title || '', 'mp4');
      var item = el('div', { class: 'queue-item' + (q.status === 'rendering' ? ' is-rendering' : q.status === 'done' ? ' is-done' : q.status === 'error' ? ' is-error' : '') });
      item.appendChild(el('div', { class: 'queue-top' }, [
        el('span', { class: 'queue-name', text: ('0' + (i + 1)).slice(-2) + ' · ' + name }),
        el('span', { class: 'queue-meta', text: (clip.durationMs / 1000).toFixed(1) + 's' + (q.result ? ' · ' + C.bytes(q.result.size) : '') })
      ]));
      item.appendChild(el('div', { class: 'queue-bar' }, [el('i', { style: { width: Math.round((q.status === 'done' ? 1 : q.progress) * 100) + '%' } })]));
      var statusText = q.status === 'done' ? tr('완료 · H.264 MP4') : q.status === 'rendering' ? tr('렌더 중 ' + Math.round(q.progress * 100) + '%')
        : q.status === 'error' ? tr('실패: ') + q.error : q.status === 'canceled' ? tr('취소됨') : tr('대기');
      item.appendChild(el('div', { class: 'queue-status', text: statusText }));
      if (q.status === 'done' && q.result) {
        item.appendChild(el('div', { class: 'queue-actions' }, [
          el('button', { type: 'button', class: 'btn btn-soft', text: 'MP4 받기', onclick: function () { R.download(q.result.blob, name); } })
        ]));
      }
      list.appendChild(item);
    });
    var done = state.queue.filter(function (q) { return q.status === 'done'; }).length;
    $('#queue-count').textContent = done + ' / ' + state.queue.length;
    $('#btn-render').disabled = !state.queue.length || state.rendering || !(state.cap && state.cap.ok);
    var zipBtn = $('#btn-zip');
    zipBtn.hidden = !done;
    zipBtn.textContent = tr('완료된 클립 ' + done + '개 ZIP으로 받기');
    renderStats();
  }

  function updateTicks() {
    var done = state.queue.filter(function (q) { return q.status === 'done'; }).length;
    $('#tick-queue').textContent = done + ' / ' + state.queue.length;
  }

  /* ── 렌더 ─────────────────────────────────────────────── */
  function renderOptions() {
    var preset = presetById($('#sel-preset').value);
    return {
      preset: preset,
      fps: Number($('#sel-fps').value || 30),
      captionOn: $('#tg-render-caption').checked,
      mode: state.mode,
      zoom: state.zoom,
      style: C.CAPTION_STYLES.filter(function (s) { return s.id === state.styleId; })[0] || C.CAPTION_STYLES[0],
      captionMode: state.captionMode,
      commentaryStyle: state.commentaryStyle,
      cues: state.cues
    };
  }

  function renderOne(clip) {
    if (!clip || !state.source) return Promise.resolve(null);
    if (state.rendering) { toast('이미 렌더 중입니다. 끝난 뒤에 다시 눌러 주세요.', 'warn'); return Promise.resolve(null); }
    if (state.clips.indexOf(clip) < 0) return Promise.resolve(null);
    var q = state.queue.filter(function (x) { return x.clipId === clip.id; })[0];
    if (!q) {
      clip.selected = true;
      syncQueueWithSelection();
      q = state.queue.filter(function (x) { return x.clipId === clip.id; })[0];
    }
    renderClips();
    return renderQueueRun([q]);
  }

  function renderSelected() {
    if (!state.source) { toast('먼저 원본을 넣어 주세요.', 'warn'); return; }
    if (!state.analysis) { toast('분석이 끝난 뒤에 렌더할 수 있습니다.', 'warn'); return; }
    syncQueueWithSelection();
    if (!state.queue.length) { toast('렌더할 클립을 선택해 주세요.', 'warn'); return; }
    state.queue.forEach(function (q) {
      if (q.status === 'done' || q.status === 'error') { q.status = 'idle'; q.progress = 0; q.result = null; q.error = ''; }
    });
    renderQueue();
    renderQueueRun(state.queue.slice());
  }

  function renderQueueRun(items) {
    if (state.rendering || !items.length) return Promise.resolve();
    pausePlayback();
    state.rendering = true;
    var signal = { cancelled: false };
    state.renderSignal = signal;
    $('#btn-render').disabled = true;
    $('#btn-cancel-render').hidden = false;
    $('#btn-cancel-render').disabled = false;
    var cap = state.cap || { audioCodec: 'opus' };
    var opts = renderOptions();
    var total = items.length;
    var doneCount = 0;
    log('렌더 시작 · ' + total + '개 클립 · ' + opts.preset.label + ' · ' + opts.fps + 'fps · ' + (cap.audioCodec === 'aac' ? 'AAC' : 'Opus') + ' 오디오', 'key');
    $('#render-summary').textContent = tr('렌더 중… 0 / ' + total);

    function step() {
      if (signal.cancelled) return Promise.resolve();
      if (!items.length) return Promise.resolve();
      var q = items.shift();
      var clip = clipById(q.clipId);
      if (!clip) { return step(); }
      q.status = 'rendering';
      q.progress = 0;
      renderQueue();
      var cues = R.mapCues(clip, state.cues);
      return R.renderClip({
        video: state.source.video,
        audioBuffer: state.analysis.audioBuffer,
        clip: clip,
        track: clipTrack(clip),
        preset: opts.preset,
        fps: opts.fps,
        captionOn: opts.captionOn,
        mode: opts.mode,
        zoom: opts.zoom,
        style: opts.style,
        cues: cues,
        commentary: opts.captionMode === 'dialogue' ? [] : ensureCommentary(clip),
        captionMode: opts.captionMode,
        commentaryStyle: opts.commentaryStyle,
        signal: signal,
        onProgress: function (p) {
          q.progress = p.progress;
          $('#render-summary').textContent = tr('렌더 중… ') + (doneCount + 1) + ' / ' + total + ' · ' + Math.round(p.progress * 100) + '%';
          var elBar = document.querySelector('.queue-item.is-rendering .queue-bar i');
          if (elBar) elBar.style.width = Math.round(p.progress * 100) + '%';
          var st = document.querySelector('.queue-item.is-rendering .queue-status');
          if (st) st.textContent = tr('렌더 중 ') + Math.round(p.progress * 100) + '%';
        }
      }).then(function (result) {
        q.status = 'done';
        q.progress = 1;
        q.result = result;
        clip.rendered = result;
        doneCount++;
        log('클립 완료: ' + C.clipFileName(state.clips.indexOf(clip), clip.title, 'mp4') + ' · ' +
          C.bytes(result.size) + ' · ' + result.width + '×' + result.height + ' · ' + (result.encodeMs / 1000).toFixed(1) + '초', 'key');
        renderQueue();
        renderClips();
        return step();
      }).catch(function (err) {
        if (err && err.message === 'canceled') {
          q.status = 'canceled';
          q.error = '사용자 취소';
          log('렌더를 취소했습니다.', 'warn');
          renderQueue();
          signal.cancelled = true;
          return;
        }
        q.status = 'error';
        q.error = (err && err.message) ? err.message : String(err);
        log('렌더 실패: ' + q.error, 'error');
        toast('렌더 실패: ' + q.error, 'error');
        renderQueue();
        return step();
      });
    }

    return step().then(function () {
      state.rendering = false;
      state.renderSignal = null;
      $('#btn-cancel-render').hidden = true;
      var done = state.queue.filter(function (q) { return q.status === 'done'; }).length;
      $('#render-summary').textContent = done ? tr('완료 ' + done + '개 · H.264 MP4 · 브라우저에서 인코딩') : tr('렌더할 클립을 선택하세요');
      $('#tick-bar').style.width = '100%';
      renderQueue();
      renderClips();
      if (done) toast('클립 ' + done + '개를 만들었습니다. MP4로 받아 보세요.', '');
    });
  }

  /* ── 자막 ─────────────────────────────────────────────── */
  function setCues(cues, note) {
    state.cues = (cues || []).slice().sort(function (a, b) { return a.startMs - b.startMs; });
    state.cueRevision++;
    state.cueCache = {};
    renderCues();
    drawPreview(true);
    updateStoryControls();
    var status = $('#cue-status');
    if (status) status.textContent = note || (state.cues.length + ' 큐');
    var textarea = $('#cue-srt');
    if (textarea) textarea.value = state.cues.length ? C.serializeSRT(state.cues) : '';
  }

  function renderCues() {
    var list = $('#cue-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.cues.length) {
      list.appendChild(el('div', { class: 'empty-state small' }, [
        el('p', { text: 'SRT/VTT를 올리거나, 데모 자막을 불러오세요.' })
      ]));
      $('#cue-count').textContent = tr('0 큐');
      return;
    }
    state.cues.forEach(function (cue, i) {
      var row = el('div', { class: 'cue-row' });
      row.appendChild(el('span', { class: 'cue-no', text: String(i + 1) }));
      var start = el('input', { type: 'text', value: C.srtTime(cue.startMs), 'aria-label': '자막 ' + (i + 1) + ' 시작' });
      var end = el('input', { type: 'text', value: C.srtTime(cue.endMs), 'aria-label': '자막 ' + (i + 1) + ' 끝' });
      var text = el('input', { type: 'text', class: 'cue-text', value: cue.text, 'aria-label': '자막 ' + (i + 1) + ' 문장' });
      function applyTime(input, key) {
        var ms = C.parseTimecode(input.value);
        if (ms === null) { input.style.borderColor = 'var(--danger)'; return; }
        input.style.borderColor = '';
        cue[key] = ms;
        if (cue.endMs <= cue.startMs + 50) cue.endMs = cue.startMs + 500;
        state.cueRevision++;
        state.cueCache = {};
        renderCues();
        drawPreview(true);
      }
      on(start, 'change', function () { applyTime(start, 'startMs'); });
      on(end, 'change', function () { applyTime(end, 'endMs'); });
      on(text, 'input', function () {
        cue.text = text.value;
        state.cueRevision++;
        state.cueCache = {};
        drawPreview(true);
      });
      row.appendChild(start);
      row.appendChild(end);
      row.appendChild(text);
      row.appendChild(el('button', {
        type: 'button', class: 'cue-del', text: '×', 'aria-label': '자막 ' + (i + 1) + ' 삭제',
        onclick: function () {
          state.cues.splice(i, 1);
          setCues(state.cues, (state.cues.length) + ' 큐');
        }
      }));
      list.appendChild(row);
    });
    $('#cue-count').textContent = tr(state.cues.length + ' 큐');
    var status = $('#cue-status');
    if (status) status.textContent = tr(state.cues.length + ' 큐 · 클릭해서 타임코드 수정');
  }

  function loadSubtitleFile(file) {
    if (!file) return;
    file.text().then(function (text) {
      var parsed = C.parseSubtitles(text);
      setCues(parsed.cues, parsed.cues.length + ' 큐 · ' + parsed.format.toUpperCase());
      if (parsed.warnings.length) {
        toast('자막을 읽었습니다. 경고 ' + parsed.warnings.length + '건: ' + parsed.warnings[0], 'warn');
        parsed.warnings.slice(0, 3).forEach(function (w) { log('자막 경고: ' + w, 'warn'); });
      } else {
        toast('자막 ' + parsed.cues.length + '개를 불러왔습니다.', '');
      }
      log('자막 불러오기: ' + file.name + ' · ' + parsed.cues.length + '큐 · ' + parsed.format.toUpperCase());
    });
  }

  /* ── 자막 → 스토리 구간 · AI 해설 자막 ────────────────── */
  var STORY_LEN = {
    short: { minSec: 4, maxSec: 10 },
    normal: { minSec: 6, maxSec: 20 },
    long: { minSec: 10, maxSec: 30 }
  };

  function storyOptions() {
    var countEl = $('#sel-story-count');
    var lenEl = $('#sel-story-len');
    var range = STORY_LEN[(lenEl && lenEl.value) || 'normal'] || STORY_LEN.normal;
    return {
      count: Math.max(3, Math.min(6, Number((countEl && countEl.value) || 4))),
      minSec: range.minSec,
      maxSec: range.maxSec
    };
  }

  function storyDurationMs() {
    if (state.source) return state.source.durationMs;
    return state.cues.length ? state.cues[state.cues.length - 1].endMs : 0;
  }

  function updateStoryControls() {
    var run = $('#btn-story-run');
    var n = state.cues.length;
    if (run) {
      run.disabled = !n || state.story.busy;
      run.textContent = tr(state.story.busy ? '자막을 읽는 중…' : (n ? 'AI 스토리 구간 찾기 · 자막 ' + n + '줄' : 'AI 스토리 구간 찾기'));
    }
    var sub = $('#story-sub-state');
    if (sub) {
      sub.textContent = tr(n
        ? C.clock(state.cues[state.cues.length - 1].endMs) + '까지 ' + n + '줄'
        : '자막 없음');
    }
  }

  function setStoryStatus(text, kind) {
    var node = $('#story-status');
    if (!node) return;
    node.textContent = tr(text);
    node.className = 'story-status' + (kind ? ' is-' + kind : '');
  }

  /** 클립에 해설 자막이 없으면 자막 구조로 초안을 만든다(렌더·미리보기 공통). */
  function ensureCommentary(clip) {
    if (!clip) return [];
    if (clip.commentaryCues && clip.commentaryCues.length) return clip.commentaryCues;
    var texts = R.mapCues(clip, state.cues).map(function (c) { return c.text; });
    if (!texts.length) {
      texts = [clip.title || clip.hook || ''].filter(function (t) { return !!t; });
    }
    if (!texts.length) return [];
    clip.commentaryCues = C.localCommentary(texts, clip.durationMs);
    clip.commentarySource = 'local';
    return clip.commentaryCues;
  }

  function currentCommentary(clip) {
    if (!clip || clip.id === 'source') return [];
    if (state.captionMode === 'dialogue') return [];
    return ensureCommentary(clip);
  }

  function renderStory() {
    var host = $('#story-result');
    if (!host) return;
    host.innerHTML = '';
    var acts = $('#story-actions');
    var segs = state.story.segments || [];
    if (acts) acts.hidden = !segs.length;
    if (state.story.busy) {
      host.appendChild(el('div', { class: 'story-loading' }, [
        el('i', { class: 'story-spin', 'aria-hidden': 'true' }),
        el('span', { text: state.story.note || '자막을 읽고 스토리 구간을 고르는 중…' })
      ]));
      return;
    }
    if (!segs.length) {
      host.appendChild(el('div', { class: 'empty-state small' }, [
        el('p', { text: '자막을 넣고 위 버튼을 누르면 스토리·재미·반전 구간을 골라 줍니다.' })
      ]));
      return;
    }
    var chosen = segs.filter(function (s) { return s.selected !== false; }).length;
    var applyBtn = $('#btn-story-apply-all');
    if (applyBtn) applyBtn.textContent = tr('추천 ' + chosen + '개 클립으로 담기');
    segs.forEach(function (seg, i) {
      var on_ = seg.selected !== false;
      var card = el('div', { class: 'story-card' + (on_ ? ' is-on' : ''), dataset: { seg: String(i) } });
      var check = el('button', {
        type: 'button', class: 'clip-check', role: 'checkbox',
        'aria-checked': on_ ? 'true' : 'false', 'aria-label': '추천 구간 ' + (i + 1) + ' 선택'
      });
      on(check, 'click', function (e) {
        e.stopPropagation();
        seg.selected = !on_;
        renderStory();
      });
      var body = el('div', { class: 'story-body' });
      body.appendChild(el('div', { class: 'story-top' }, [
        el('span', { class: 'clip-index', text: 'SEG ' + ('0' + (i + 1)).slice(-2) }),
        el('span', { class: 'clip-dur', text: ((seg.endMs - seg.startMs) / 1000).toFixed(1) + '초' }),
        el('span', { class: 'clip-range', text: C.clock(seg.startMs) + ' → ' + C.clock(seg.endMs) }),
        el('span', { class: 'clip-score' }, [
          el('i', {}, [el('b', { style: { width: (seg.score || 0) + '%' } })]),
          String(seg.score || 0)
        ])
      ]));
      body.appendChild(el('strong', { class: 'story-title', text: seg.title || tr('제목 없음') }));
      if (seg.hook) body.appendChild(el('p', { class: 'story-hook', text: tr('훅 · ') + seg.hook }));
      if (seg.reason) body.appendChild(el('p', { class: 'story-reason', text: seg.reason }));
      if (seg.commentaryCues && seg.commentaryCues.length) {
        body.appendChild(el('p', { class: 'story-comm', text: tr('해설 자막 ' + seg.commentaryCues.length + '줄') + ' · ' + seg.commentaryCues[0].text }));
      }
      if (seg.hashtags && seg.hashtags.length) {
        body.appendChild(el('div', { class: 'clip-tags' }, seg.hashtags.map(function (t) {
          return el('span', { class: 'clip-tag', text: '#' + t });
        })));
      }
      var add = el('button', { type: 'button', class: 'story-add', text: '담기', 'aria-label': '추천 구간 ' + (i + 1) + ' 클립으로 담기' });
      on(add, 'click', function (e) { e.stopPropagation(); applyStorySegments([seg]); });
      card.appendChild(check);
      card.appendChild(body);
      card.appendChild(add);
      on(card, 'click', function (e) {
        if (e.target.closest('button')) return;
        previewStory(seg);
      });
      host.appendChild(card);
    });
  }

  function previewStory(seg) {
    if (!state.source || !seg) return;
    state.playMode = 'source';
    var v = state.source.video;
    v.muted = false;
    try { v.currentTime = Math.max(0, seg.startMs) / 1000; } catch (e) { /* noop */ }
    state.localMs = seg.startMs;
    state.dirty = true;
    renderClips();
    drawPreview(true);
    updateClock();
    startPlayback();
  }

  function setStorySegments(segments, source, provider, why) {
    state.story.segments = (segments || []).map(function (s, i) {
      var next = Object.assign({}, s);
      next.index = i;
      next.selected = true;
      return next;
    });
    state.story.source = source || 'local';
    state.story.why = why || '';
    state.story.busy = false;
    var tag = $('#story-tag');
    if (tag) tag.textContent = source === 'pro' ? 'AI · ' + (provider || 'Pro') : source === 'free' ? tr('AI · 무료') : tr('로컬 규칙');
    var count = state.story.segments.length;
    if (count) {
      var label = source === 'pro' ? 'AI(' + (provider || 'Pro') + ')' : source === 'free' ? tr('무료 AI 맛보기') : tr('로컬 규칙(자막 휴리스틱)');
      var comm = state.story.segments.filter(function (s) { return s.commentaryCues && s.commentaryCues.length; }).length;
      setStoryStatus('추천 ' + count + '개 · ' + label + ' · 해설 자막 ' + comm + '개 구간' + (why ? ' · ' + why : ''), source === 'local' ? 'warn' : 'ok');
    } else {
      setStoryStatus((why ? why + ' — ' : '') + '추천 구간을 찾지 못했습니다. 자막이 있는지 확인해 주세요.', 'warn');
    }
    var fallback = $('#story-fallback');
    if (fallback) fallback.hidden = state.story.source !== 'local';
    renderStory();
    updateStoryControls();
  }

  function localStoryFallback(durMs, opt, why) {
    var local = C.localStorySegments({
      cues: state.cues, durationMs: durMs,
      count: opt.count, minSec: opt.minSec, maxSec: opt.maxSec
    });
    setStorySegments(local.segments, 'local', '', why);
    return local;
  }

  function runStory() {
    if (state.story.busy) return;
    if (!state.cues.length) { toast('먼저 자막(.srt/.vtt)을 넣어 주세요.', 'warn'); return; }
    var durMs = storyDurationMs();
    if (!durMs) { toast('자막 시간이나 원본 영상이 필요합니다.', 'warn'); return; }
    var opt = storyOptions();
    var built = C.buildStoryPrompt({
      cues: state.cues, durationMs: durMs,
      sourceName: state.source ? state.source.name : '자막만',
      count: opt.count, minSec: opt.minSec, maxSec: opt.maxSec
    });
    state.story.busy = true;
    state.story.note = '자막 ' + state.cues.length + '줄을 읽고 ' + opt.count + '개 구간을 고르는 중…';
    state.story.segments = [];
    renderStory();
    updateStoryControls();
    setStoryStatus('구간을 고르는 중…', '');
    log('스토리 구간 추천 · 자막 ' + state.cues.length + '줄 · ' + opt.minSec + '~' + opt.maxSec + '초 · ' + opt.count + '개', 'key');

    var request = { task: 'text', prompt: built.prompt, system: built.system, options: { json: true, maxTokens: 900 } };
    var usePro = Pro && typeof Pro.isConnected === 'function' && Pro.isConnected();
    function viaFree() {
      if (Free && typeof Free.generate === 'function') {
        return Free.generate(request).then(function (res) {
          if (res && res.ok) return { ok: true, text: res.text, mode: 'free', res: res };
          return { ok: false, mode: 'free', res: res };
        });
      }
      if (Pro && typeof Pro.generateFree === 'function') {
        return Promise.resolve(Pro.generateFree(request, { app: 'clip-factory' })).then(function (res) {
          if (res && res.ok) return { ok: true, text: res.text, mode: 'free', res: res };
          return { ok: false, mode: 'free', res: res };
        });
      }
      return Promise.resolve({ ok: false, mode: 'none', res: { reason: 'no_client', message: '무료 AI 클라이언트를 찾지 못했습니다.' } });
    }
    var task = usePro
      ? Promise.resolve(Pro.generate(request)).then(function (res) {
        if (res && res.ok) return { ok: true, text: res.text, mode: 'pro', provider: res.provider, res: res };
        if (res && res.reason === 'not_connected') return viaFree();
        return { ok: false, mode: 'pro', res: res };
      })
      : viaFree();

    task.then(function (out) {
      if (!out.ok) {
        var why = (out.res && (out.res.message || out.res.reason)) || 'AI 응답 없음';
        var isQuota = out.res && /429|quota|한도|소진/.test(String(out.res.reason || '') + String(out.res.message || ''));
        localStoryFallback(durMs, opt, (isQuota ? '무료 AI 한도 초과' : 'AI 실패') + ' → 자막 규칙으로 추천');
        log('스토리 추천 AI 실패 → 로컬 규칙: ' + why, 'warn');
        toast('AI 대신 자막 규칙으로 추천했습니다. 문장은 직접 다듬어 주세요.', 'warn');
        renderAll();
        return;
      }
      var parsed = C.parseStoryJSON(out.text, { durationMs: durMs, minSec: 3, maxCount: 6 });
      if (parsed.ok) {
        setStorySegments(parsed.segments, out.mode, out.provider, '');
        log('스토리 추천 완료 · ' + parsed.segments.length + '개 · ' + (out.mode === 'pro' ? 'Pro' : '무료 AI'), 'key');
        toast('추천 구간 ' + parsed.segments.length + '개를 만들었습니다. 카드에서 담아 보세요.', '');
        renderAll();
        return;
      }
      localStoryFallback(durMs, opt, 'AI 응답을 읽지 못함 → 자막 규칙으로 추천');
      log('스토리 응답 형식 오류 → 로컬 규칙: ' + String(out.text || '').slice(0, 80), 'warn');
      renderAll();
    }).catch(function (err) {
      localStoryFallback(durMs, opt, '네트워크 오류 → 자막 규칙으로 추천');
      log('스토리 추천 오류: ' + ((err && err.message) || err), 'error');
      renderAll();
    });
  }

  function applyStorySegments(list) {
    if (!state.source) {
      toast('클립으로 담으려면 원본 영상이 있어야 합니다. 데모 VOD를 먼저 만들어 주세요.', 'warn');
      return;
    }
    var chosen = (list || state.story.segments || []).filter(function (s) { return s.selected !== false; });
    if (!chosen.length) { toast('담을 구간을 선택해 주세요.', 'warn'); return; }
    var keep = (state.analysis && state.analysis.keep && state.analysis.keep.length)
      ? state.analysis.keep
      : [{ startMs: 0, endMs: state.source.durationMs }];
    var drafts = C.segmentsToClips(chosen, {
      keep: keep, cues: state.cues, durationMs: state.source.durationMs,
      commentarySource: state.story.source === 'local' ? 'local' : 'ai'
    });
    if (!drafts.length) {
      toast('선택한 구간에 남길 말소리가 없습니다. 무음 임계치를 확인해 주세요.', 'warn');
      return;
    }
    var merged = C.mergeStoryClips(state.clips, drafts);
    state.clips = merged.clips;
    state.clips.forEach(function (c, i) { c.index = i; });
    if (merged.added.length) {
      state.activeClipId = merged.added[0].id;
      state.playMode = 'clip';
      state.localMs = 0;
    }
    var cleared = C.deselectOverlapping(state.clips, merged.added);
    if (cleared.length) log('추천 구간과 겹치는 기존 클립 ' + cleared.length + '개의 선택을 해제했습니다(삭제는 안 함).', 'warn');
    syncQueueWithSelection();
    renderAll();
    attachThumbs();
    renderCommentary();
    var comm = merged.added.reduce(function (a, c) { return a + ((c.commentaryCues || []).length); }, 0);
    var msg = '추천 구간 ' + merged.added.length + '개를 클립으로 담았습니다' +
      (comm ? ' · 해설 자막 ' + comm + '줄' : '') +
      (merged.skipped.length ? ' · ' + merged.skipped.length + '개는 이미 있음' : '') +
      (cleared.length ? ' · 겹친 기존 클립 ' + cleared.length + '개 선택 해제' : '');
    log(msg, 'key');
    toast(msg, '');
  }

  function loadStoryText(text, label) {
    var parsed = C.parseSubtitles(text);
    if (!parsed.cues.length) {
      toast('자막을 읽지 못했습니다. SRT·VTT 형식인지 확인해 주세요.', 'warn');
      return false;
    }
    setCues(parsed.cues, parsed.cues.length + ' 큐 · ' + String(parsed.format || 'srt').toUpperCase());
    if (parsed.warnings.length) {
      log('자막 경고 ' + parsed.warnings.length + '건: ' + parsed.warnings[0], 'warn');
    }
    log('스토리용 자막 불러오기: ' + label + ' · ' + parsed.cues.length + '줄 · ' + String(parsed.format || 'srt').toUpperCase());
    toast('자막 ' + parsed.cues.length + '줄을 읽었습니다. AI 스토리 구간 찾기를 눌러 보세요.', '');
    return true;
  }

  /* ── 해설 자막 편집(클립 시트) ────────────────────────── */
  function renderCommentary() {
    var host = $('#comm-list');
    if (!host) return;
    host.innerHTML = '';
    var clip = activeClip();
    var head = $('#comm-clip');
    var countEl = $('#comm-count');
    if (!clip) {
      if (head) head.textContent = tr('클립 없음');
      if (countEl) countEl.textContent = '0 큐';
      host.appendChild(el('div', { class: 'empty-state small' }, [el('p', { text: '먼저 클립을 만드세요.' })]));
      return;
    }
    if (head) head.textContent = 'CLIP ' + ('0' + (state.clips.indexOf(clip) + 1)).slice(-2) + ' · ' + (clip.title || tr('제목 없음'));
    var cues = ensureCommentary(clip);
    if (!cues.length) {
      if (countEl) countEl.textContent = '0 큐';
      host.appendChild(el('div', { class: 'empty-state small' }, [el('p', { text: '이 클립에는 자막이 없어 해설 초안을 만들 수 없습니다. 자막을 올리면 자동으로 생깁니다.' })]));
      return;
    }
    cues.forEach(function (cue, i) {
      var row = el('div', { class: 'comm-row' });
      var start = el('input', { type: 'text', value: C.vttTime(cue.startMs).slice(3), 'aria-label': '해설 ' + (i + 1) + ' 시작' });
      var end = el('input', { type: 'text', value: C.vttTime(cue.endMs).slice(3), 'aria-label': '해설 ' + (i + 1) + ' 끝' });
      var text = el('input', { type: 'text', class: 'comm-text', value: cue.text, maxlength: '80', 'aria-label': '해설 ' + (i + 1) + ' 문장' });
      function applyTime(input, key) {
        var ms = C.parseTimecode(input.value);
        if (ms === null) { input.style.borderColor = 'var(--danger)'; return; }
        input.style.borderColor = '';
        cue[key] = Math.round(Math.max(0, Math.min(clip.durationMs, ms)));
        if (cue.endMs <= cue.startMs + 300) cue.endMs = Math.min(clip.durationMs, cue.startMs + 1200);
        state.cueCache = {};
        renderCommentary();
        drawPreview(true);
      }
      on(start, 'change', function () { applyTime(start, 'startMs'); });
      on(end, 'change', function () { applyTime(end, 'endMs'); });
      on(text, 'input', function () {
        cue.text = text.value;
        clip.commentarySource = clip.commentarySource || 'local';
        drawPreview(true);
      });
      row.appendChild(el('span', { class: 'cue-no', text: String(i + 1) }));
      row.appendChild(start);
      row.appendChild(end);
      row.appendChild(text);
      row.appendChild(el('button', {
        type: 'button', class: 'cue-del', text: '×', 'aria-label': '해설 ' + (i + 1) + ' 삭제',
        onclick: function () {
          cues.splice(i, 1);
          renderCommentary();
          drawPreview(true);
          log('해설 자막 삭제 · 클립 ' + (state.clips.indexOf(clip) + 1), 'warn');
        }
      }));
      host.appendChild(row);
    });
    if (countEl) countEl.textContent = tr(cues.length + ' 큐');
  }

  function regenerateCommentary() {
    var clip = activeClip();
    if (!clip) return;
    var texts = R.mapCues(clip, state.cues).map(function (c) { return c.text; });
    if (!texts.length) { toast('이 클립에는 자막이 없습니다.', 'warn'); return; }
    clip.commentaryCues = C.localCommentary(texts, clip.durationMs);
    clip.commentarySource = 'local';
    renderCommentary();
    drawPreview(true);
    log('해설 자막 초안 다시 만듦 · ' + clip.commentaryCues.length + '줄', '');
    toast('해설 자막 초안을 다시 만들었습니다.', '');
  }

  /* ── AI 훅 ─────────────────────────────────────────────── */
  function openPro() {
    try { if (Pro) Pro.openModal(); } catch (e) { toast('Pro 연결 창을 열지 못했습니다.', 'error'); }
  }

  function showAiResult(result, mode, provider) {
    var host = $('#ai-out');
    if (!host) return;
    host.innerHTML = '';
    var box = el('div', { class: 'ai-result' });
    box.appendChild(el('strong', { text: result.title || tr('제목 없음') }));
    if (result.hook) box.appendChild(el('p', { text: result.hook }));
    if (result.hashtags && result.hashtags.length) {
      box.appendChild(el('div', { class: 'ai-tags' }, result.hashtags.map(function (t) { return el('span', { class: 'clip-tag', text: '#' + t }); })));
    }
    box.appendChild(el('span', { class: 'ai-meta', text: (mode === 'pro' ? 'Pro · ' + (provider || tr('연결됨')) : tr('무료 맛보기')) + ' · ' + tr('카드에 적용됨') }));
    host.appendChild(box);
  }

  function showAiError(msg, res) {
    var host = $('#ai-out');
    if (!host) return;
    host.innerHTML = '';
    var box = el('div', { class: 'ai-card' });
    box.appendChild(el('h4', { text: tr('훅을 만들지 못했습니다') }));
    box.appendChild(el('p', { text: msg }));
    var row = el('div', { class: 'btn-row' });
    if (res && (res.reason === 'free_quota_exceeded' || res.reason === 'global_daily_cap' || res.reason === 'shared_network_limit')) {
      var mount = el('div');
      box.appendChild(mount);
      host.appendChild(box);
      try {
        Free.mountUpgrade(mount, res, { onConnectKey: openPro, onBridge: openPro });
      } catch (e) { /* noop */ }
      return;
    }
    row.appendChild(el('button', { type: 'button', class: 'btn btn-soft btn-sm', text: '다시 시도', onclick: function () { var clip = activeClip(); if (clip) makeHook(clip); } }));
    row.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Pro 연결', onclick: openPro }));
    box.appendChild(row);
    host.appendChild(box);
  }

  function makeHook(clip) {
    if (!clip || state.aiBusy) return;
    if (!state.source) return;
    state.aiBusy = true;
    var host = $('#ai-out');
    if (host) {
      host.innerHTML = '';
      host.appendChild(el('p', { class: 'ai-placeholder', text: tr('클립 ') + (state.clips.indexOf(clip) + 1) + tr('의 자막으로 훅을 만드는 중…') }));
    }
    log('AI 훅 요청 · 클립 ' + (state.clips.indexOf(clip) + 1));
    var captions = state.cues.filter(function (c) { return c.startMs < clip.endMs && c.endMs > clip.startMs; }).map(function (c) { return c.text; });
    var built = C.buildHookPrompt({
      durationMs: clip.durationMs,
      sourceName: state.source.name,
      captions: captions
    });
    var request = { task: 'text', prompt: built.prompt, system: built.system, options: { json: true, maxTokens: 700 } };
    var usePro = Pro && typeof Pro.isConnected === 'function' && Pro.isConnected();

    function viaFree() {
      return Free.generate(request).then(function (res) {
        if (res.ok) return { ok: true, text: res.text, mode: 'free' };
        return { ok: false, res: res, mode: 'free' };
      });
    }

    var task = usePro
      ? Promise.resolve(Pro.generate(request)).then(function (res) {
        if (res && res.ok) return { ok: true, text: res.text, mode: 'pro', provider: res.provider };
        if (res && res.reason === 'not_connected') return viaFree();
        return { ok: false, res: res, mode: 'pro' };
      })
      : viaFree();

    task.then(function (out) {
      state.aiBusy = false;
      if (!out.ok) {
        var msg = (out.res && (out.res.message || out.res.reason)) || '응답을 받지 못했습니다.';
        showAiError(msg, out.res);
        log('AI 훅 실패: ' + msg, 'error');
        return;
      }
      var parsed = C.parseHookJSON(out.text);
      if (!parsed.ok) {
        showAiError('응답을 JSON으로 읽지 못했습니다. 다시 시도해 주세요.', null);
        log('AI 훅 응답 형식 오류: ' + String(out.text).slice(0, 80), 'warn');
        return;
      }
      if (parsed.title) clip.title = parsed.title;
      if (parsed.hook) clip.hook = parsed.hook;
      if (parsed.hashtags.length) clip.hashtags = parsed.hashtags;
      showAiResult(parsed, out.mode, out.provider);
      renderClips();
      renderQueue();
      log('AI 훅 적용 · ' + parsed.title + ' (' + (out.mode === 'pro' ? 'Pro' : '무료') + ')', 'key');
      toast('클립 제목·훅을 적용했습니다.', '');
    }).catch(function (err) {
      state.aiBusy = false;
      showAiError((err && err.message) || 'AI 요청에 실패했습니다.', null);
      log('AI 훅 오류: ' + ((err && err.message) || err), 'error');
    });
  }

  function updateAiBadge() {
    var badge = $('#ai-badge');
    if (!badge) return;
    try {
      badge.textContent = tr(Free && Free.badgeText ? Free.badgeText(null) : '무료 맛보기');
    } catch (e) { badge.textContent = tr('무료 맛보기'); }
  }

  function updateProBadge() {
    var b = $('#btn-pro-badge');
    var label = $('#pro-badge-label');
    if (!b || !label) return;
    var connected = false;
    var providerName = '';
    try {
      if (Pro) {
        connected = Pro.isConnected();
        if (connected) {
          var st = Pro.getState ? Pro.getState() : null;
          var pid = st && st.config ? st.config.provider : '';
          var p = pid && Pro.providerById ? Pro.providerById(pid) : null;
          providerName = p ? p.name : 'Pro';
        }
      }
    } catch (e) { connected = false; }
    b.classList.toggle('is-pro', connected);
    label.textContent = connected ? 'Pro · ' + providerName : tr('무료 모드');
    b.title = tr(connected ? 'Pro 연결됨 · 클릭해서 관리' : '무료 모드 · 클릭해서 API 연결');
  }

  /* ── 썸네일: 실제 9:16 크롭으로 만든다 ─────────────────── */
  function attachThumbs() {
    if (!state.analysis) return;
    state.clips.forEach(function (clip) {
      if (clip.thumb) return;
      var url = state.analysis.thumbs && state.analysis.thumbs[clip.id];
      if (url) clip.thumb = url;
    });
  }

  function refreshThumbs() {
    if (!state.analysis || !state.source || !R) return Promise.resolve();
    var video = state.source.video;
    var list = state.clips.slice(0, 10);
    var token = (state.thumbToken || 0) + 1;
    state.thumbToken = token;
    state.thumbing = true;
    var i = 0;
    function step() {
      if (i >= list.length || token !== state.thumbToken) return Promise.resolve();
      var clip = list[i];
      var localMs = clip.durationMs * 0.4;
      var canvas = document.createElement('canvas');
      canvas.width = 135;
      canvas.height = 240;
      var ctx = canvas.getContext('2d');
      return M.seekTo(video, R.sourceTimeAt(clip, localMs) / 1000).then(function () {
        R.drawFrame(ctx, {
          video: video, clip: clip, track: clipTrack(clip), localMs: localMs,
          outW: 135, outH: 240, mode: state.mode, zoom: state.zoom, cues: [], captionOn: false
        });
        try { clip.thumb = canvas.toDataURL('image/jpeg', 0.72); } catch (e) { /* noop */ }
        i++;
        return step();
      }).catch(function () { i++; return step(); });
    }
    return step().then(function () {
      if (token === state.thumbToken) {
        try { video.currentTime = 0; } catch (e) { /* noop */ }
        state.dirty = true;
        state.thumbing = false;
        renderClips();
      }
    });
  }

  /* ── 전체 렌더 ─────────────────────────────────────────── */
  function renderAll() {
    attachThumbs();
    syncQueueWithSelection();
    renderClips();
    renderQueue();
    renderTimeline();
    renderStats();
    renderCues();
    renderCommentary();
    renderSheet();
    drawPreview(true);
    syncAutoButton();
    $('#src-tc').textContent = C.timecode(state.source ? state.source.video.currentTime * 1000 : 0, 30);
    if (state.source) {
      $('#phone-live').hidden = false;
      $('#src-audio').textContent = state.analysis ? (state.analysis.audioBuffer ? 'AUDIO 2ch · ' + Math.round(state.analysis.audioBuffer.sampleRate / 1000) + 'kHz' : 'AUDIO 없음') : 'AUDIO —';
    }
    updateTicks();
  }

  /* ══════════════════════════════════════════════════════════
     V2 · 블로그 → 카드 쇼츠
     ══════════════════════════════════════════════════════════ */
  function filmTheme() { return C.FILM_THEMES[state.film.themeIndex] || C.FILM_THEMES[0]; }
  function filmStyle() {
    return C.CAPTION_STYLES.filter(function (s) { return s.id === state.film.styleId; })[0] || C.CAPTION_STYLES[4];
  }
  function filmPreset() {
    return C.PRESETS.filter(function (p) { return p.id === state.film.presetId; })[0] || C.PRESETS[1];
  }

  function filmLayout() {
    return state.film.layoutId || 'topTitle';
  }

  /** 장면 수: 'auto'면 글 길이로 추천, 아니면 3~15 */
  function filmCount() {
    var sel = $('#sel-film-count');
    var raw = sel ? sel.value : 'auto';
    if (raw === 'auto') {
      return state.film.article ? C.suggestSceneCount(state.film.article) : 7;
    }
    return Math.max(3, Math.min(15, Number(raw) || 7));
  }

  /** 자막 조절 UI → 렌더 옵션. 미리보기와 MP4가 같은 값을 쓴다. */
  function subtitleFromUI() {
    var d = C.SUBTITLE_DEFAULT || {};
    var get = function (sel, def) { var n = $(sel); return n ? n.value : def; };
    var pos = get('#sel-sub-pos', 'bottom');
    var box = $('#tg-sub-box') && $('#tg-sub-box').checked;
    return {
      sizePx: Number(get('#rg-sub-size', d.sizePx || 64)),
      color: get('#inp-sub-color', d.color || '#FFFFFF'),
      stroke: get('#inp-sub-stroke', d.stroke || '#0A0A0B'),
      strokeWidth: Number(get('#rg-sub-stroke', d.strokeWidth || 8)),
      box: box ? hexToRgba(get('#inp-sub-box', '#08090B'), 0.78) : '',
      pos: pos,
      posPct: Number(get('#rg-sub-pos', d.posPct || 84)),
      maxLines: 2,
      weight: 900
    };
  }

  function hexToRgba(hex, alpha) {
    var m = String(hex || '').replace('#', '');
    if (m.length === 3) m = m.charAt(0) + m.charAt(0) + m.charAt(1) + m.charAt(1) + m.charAt(2) + m.charAt(2);
    if (m.length !== 6) return 'rgba(8,9,11,' + alpha + ')';
    var r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function invalidateFilmAudio() {
    state.film.audioBuffer = null;
    state.film.audioKey = '';
    if (state.film.previewAudio) {
      try { state.film.previewAudio.stop(); } catch (e) { /* noop */ }
      state.film.previewAudio = null;
    }
  }

  function filmAudioKey() {
    var scenes = state.film.scenes.map(function (s) { return (s.caption || '') + '|' + (s.headline || ''); }).join('\u0001');
    return [
      $('#sel-tts') ? $('#sel-tts').value : 'edge',
      $('#sel-edge-voice') ? $('#sel-edge-voice').value : '',
      $('#sel-bgm') ? $('#sel-bgm').value : 'lofi',
      $('#rg-bgm') ? $('#rg-bgm').value : '18',
      $('#tg-duck') && $('#tg-duck').checked ? '1' : '0',
      state.film.bgmName || '',
      scenes
    ].join('\u0002');
  }

  function filmNote(text, kind) {
    var node = $('#film-render-summary');
    if (!node) return;
    node.textContent = text;
    node.className = 'render-summary' + (kind ? ' is-' + kind : '');
  }

  function setFilmScriptTag(text, kind) {
    var tag = $('#film-script-tag');
    if (!tag) return;
    tag.textContent = text;
    tag.className = 'panel-tag' + (kind ? ' is-' + kind : '');
  }

  function filmSyncTimeline() {
    var narr = state.film.scenes.map(function (s, i) {
      var b = state.film.narration[i];
      return b ? Math.round(b.duration * 1000) : 0;
    });
    state.film.timeline = C.filmTimeline(state.film.scenes, { narrationMs: narr });
    state.film.totalMs = state.film.timeline.length ? state.film.timeline[state.film.timeline.length - 1].endMs : 0;
    if (state.film.tMs > state.film.totalMs) state.film.tMs = 0;
    var time = $('#film-time');
    if (time) time.textContent = fmtClock(state.film.tMs) + ' / ' + fmtClock(state.film.totalMs);
    var scrub = $('#film-scrub');
    if (scrub) scrub.disabled = !state.film.totalMs;
    var play = $('#btn-film-play');
    if (play) play.disabled = !state.film.totalMs;
    var render = $('#btn-film-render');
    if (render) render.disabled = !state.film.scenes.length || state.film.rendering;
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    return ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ── 글 가져오기 ─────────────────────────────────────── */
  function renderBlogMeta() {
    var meta = $('#blog-meta');
    if (!meta) return;
    var a = state.film.article;
    if (!a) { meta.textContent = L('아직 글이 없습니다.', 'No article yet.'); return; }
    var via = a.via === 'url' ? L('URL에서 읽음', 'read from URL') : a.via === 'demo' ? L('샘플 글', 'sample article') : L('붙여넣기', 'pasted');
    meta.innerHTML = '';
    var strong = document.createElement('strong');
    strong.setAttribute('data-i18n-skip', '');
    strong.textContent = a.title || L('제목 없음', 'Untitled');
    meta.appendChild(strong);
    var span = document.createElement('span');
    span.textContent = ' · ' + L('본문 ' + a.paragraphs.length + '문단 · 사진 ' + (a.images || []).length + '장 · ' + via,
      a.paragraphs.length + ' paragraphs · ' + (a.images || []).length + ' photos · ' + via);
    meta.appendChild(span);
  }

  function proxyThumb(url, w) {
    if (!url || !/^https?:\/\//i.test(url)) return '';
    return B.IMG_PROXY + encodeURIComponent(url.replace(/^https?:\/\//, '')) + '&w=' + (w || 160) + '&output=jpg&q=70';
  }

  function renderBlogThumbs() {
    var host = $('#blog-thumbs');
    if (!host) return;
    host.innerHTML = '';
    var list = state.film.imageChoices || [];
    if (!list.length) {
      var empty = document.createElement('span');
      empty.className = 'thumb-empty';
      empty.textContent = L('사진 없음 · 그라데이션 카드로 만듭니다', 'No photos · gradient cards will be used');
      host.appendChild(empty);
      return;
    }
    list.slice(0, 10).forEach(function (item, i) {
      var img = document.createElement('img');
      img.alt = L('글 사진 ' + (i + 1), 'Article photo ' + (i + 1));
      img.loading = 'lazy';
      img.src = item.preview || proxyThumb(item.url, 160);
      host.appendChild(img);
    });
  }

  function setBlogArticle(article, via) {
    if (!article) return;
    var a = {
      title: article.title || L('제목 없음', 'Untitled'),
      paragraphs: (article.paragraphs || []).slice(),
      images: (article.images || []).slice(0, 12),
      via: via || article.via || 'paste'
    };
    state.film.article = a;
    state.film.imageChoices = a.images.slice();
    state.film.images = {};
    state.film.narration = {};
    state.film.result = null;
    renderBlogMeta();
    renderBlogThumbs();
    /* 바로 규칙 초안을 깔아 둔다 — 미리보기가 비지 않게 */
    var count = filmCount();
    applyFilmScript(C.localFilmScript(a, { count: count }), 'local');
    loadSceneImages();
    log(L('블로그 글 준비 · 본문 ' + a.paragraphs.length + '문단 · 사진 ' + a.images.length + '장',
      'Article ready · ' + a.paragraphs.length + ' paragraphs · ' + a.images.length + ' photos'), 'key');
  }

  function fetchBlog() {
    var input = $('#blog-url');
    var url = input ? input.value.trim() : '';
    var note = $('#blog-fetch-note');
    if (!url) {
      toast(L('블로그 주소를 넣어 주세요.', 'Enter a blog URL.'), 'warn');
      if (input) input.focus();
      return;
    }
    if (!B) { toast(L('읽기 모듈을 찾지 못했습니다.', 'Reader module missing.'), 'error'); return; }
    if (note) note.textContent = L('블로그를 읽는 중… (10초 안팎 걸릴 수 있습니다)', 'Reading the blog… (may take ~10s)');
    showBusy(L('블로그를 읽는 중', 'Reading the blog'), L('제목·본문·사진을 가져오고 있습니다. 막히면 바로 붙여넣기로 안내합니다.', 'Fetching title, body and photos. If it fails, paste mode opens right away.'));
    B.fetchArticle(url).then(function (res) {
      hideBusy();
      if (res && res.ok) {
        if (note) note.textContent = L('읽었습니다 · ' + (res.via === 'jina' ? '읽기 프록시' : res.via) + ' · ' + res.chars + '자', 'Read · ' + (res.via === 'jina' ? 'reader proxy' : res.via) + ' · ' + res.chars + ' chars');
        setBlogArticle({ title: res.title, paragraphs: res.paragraphs, images: res.images, via: 'url' }, 'url');
        toast(L('글을 읽었습니다. 장면 대본을 AI로 다듬어 보세요.', 'Article loaded. Try AI to polish the scene script.'), '');
      } else {
        var why = (res && res.message) || L('읽지 못했습니다.', 'Could not read it.');
        if (note) note.textContent = L(why + ' 본문을 아래에 붙여넣으면 바로 진행합니다.', why + ' Paste the body below to continue right away.');
        log(L('블로그 읽기 실패: ' + why, 'Blog read failed: ' + why), 'warn');
        toast(L('블로그를 읽지 못했습니다. 본문을 붙여넣어 주세요.', 'Could not read the blog. Paste the body instead.'), 'warn');
        var ta = $('#blog-text');
        if (ta) ta.focus();
      }
    }).catch(function (err) {
      hideBusy();
      var msg = (err && err.message) || '';
      if (note) note.textContent = L('읽기 오류: ' + msg + ' — 본문을 붙여넣어 주세요.', 'Read error: ' + msg + ' — paste the body instead.');
      toast(L('블로그를 읽지 못했습니다.', 'Could not read the blog.'), 'warn');
    });
  }

  function usePastedArticle() {
    var ta = $('#blog-text');
    var text = ta ? ta.value.trim() : '';
    if (!text) { toast(L('붙여넣은 본문이 없습니다.', 'Nothing pasted.'), 'warn'); if (ta) ta.focus(); return; }
    var res = B.fromPastedText(text);
    if (!res.ok) { toast(L('본문을 읽지 못했습니다. 한 줄에 너무 짧은 글인지 확인해 주세요.', 'Could not read the text. Check that it has proper paragraphs.'), 'warn'); return; }
    setBlogArticle({ title: res.title, paragraphs: res.paragraphs, images: res.images, via: 'paste' }, 'paste');
    toast(L('본문 ' + res.paragraphs.length + '문단으로 장면 초안을 만들었습니다.', 'Made a scene draft from ' + res.paragraphs.length + ' paragraphs.'), '');
  }

  function useDemoArticle() {
    setBlogArticle({ title: C.DEMO_ARTICLE.title, paragraphs: C.DEMO_ARTICLE.paragraphs.slice(), images: [], via: 'demo' }, 'demo');
    if ($('#blog-url')) $('#blog-url').value = '';
    log(L('샘플 글 불러오기 · ' + C.DEMO_ARTICLE.title, 'Sample article · ' + C.DEMO_ARTICLE.title), 'key');
    toast(L('샘플 글로 전 과정을 시험해 보세요.', 'Try the whole flow with the sample article.'), '');
  }

  /* ── 장면 대본 ──────────────────────────────────────── */
  function applyFilmScript(script, source, note) {
    var scenes = (script && script.scenes ? script.scenes : []).map(function (s, i) {
      return {
        kicker: ('0' + (i + 1)).slice(-2),
        headline: s.headline || '',
        sub: s.sub || '',
        caption: s.caption || s.headline || '',
        imageQuery: s.imageQuery || ''
      };
    });
    state.film.scenes = scenes;
    state.film.scriptSource = source || 'local';
    state.film.result = null;
    if (script && script.title && state.film.article) state.film.article.title = script.title;
    state.film.narration = {};
    invalidateFilmAudio();
    if (source === 'ai') setFilmScriptTag(note || L('AI 대본', 'AI script'));
    else if (source === 'local') setFilmScriptTag(L('규칙 초안', 'Rule draft'), 'warn');
    else setFilmScriptTag(note || source);
    renderScenes();
    filmSyncTimeline();
    filmDraw(state.film.tMs);
    renderBlogMeta();
    if ((state.film.imageChoices || []).length) loadSceneImages();
    var dl = $('#btn-film-download');
    if (dl) dl.hidden = true;
    if (scenes.length) filmNote(L('장면 ' + scenes.length + '개 · ' + fmtClock(state.film.totalMs) + ' · 렌더할 수 있습니다',
      scenes.length + ' scenes · ' + fmtClock(state.film.totalMs) + ' · ready to render'));
  }

  function filmGenerate(useAI) {
    if (state.film.scriptBusy) return;
    var a = state.film.article;
    var note = $('#film-script-note');
    if (!a) {
      toast(L('먼저 블로그 URL을 읽거나 본문을 붙여넣으세요.', 'Read a blog URL or paste the body first.'), 'warn');
      return;
    }
    var count = filmCount();
    if (!useAI) {
      applyFilmScript(C.localFilmScript(a, { count: count }), 'local');
      if (note) note.textContent = L('글 문단을 장면 수에 맞춰 나눠 초안을 만들었습니다. AI로 쓰면 문장이 더 매끄러워집니다.',
        'Split the paragraphs into scenes. AI can make the lines sharper.');
      log(L('장면 규칙 초안 · ' + count + '장면', 'Rule draft · ' + count + ' scenes'));
      return;
    }
    var order = aiOrder();
    var provider = order[0];
    state.film.scriptBusy = true;
    setFilmScriptTag(L('쓰는 중…', 'writing…'));
    if (note) note.textContent = L('AI가 ' + count + '장면을 쓰고 있습니다… (' + provider + ')', 'AI is writing ' + count + ' scenes… (' + provider + ')');
    var built = C.buildFilmPrompt({ title: a.title, body: a.paragraphs.join('\n\n'), count: count });
    var payload = { prompt: built.prompt, system: built.system, options: { json: true, maxTokens: 1600, temperature: 0.8 } };

    function tryProvider(p, attempt) {
      if (p === 'local') return Promise.resolve({ ok: false, reason: 'local' });
      var task;
      if (p === 'gemini') task = G.generateJSON(payload);
      else if (p === 'pro') task = Promise.resolve(Pro.generate(payload));
      else task = Free.generate(payload);
      return Promise.resolve(task).catch(function (err) { return { ok: false, reason: 'error', message: (err && err.message) || '' }; })
        .then(function (res) {
          if (res && res.ok && res.text) {
            var parsed = C.parseFilmJSON(res.text, { count: count, title: a.title });
            if (parsed.ok) return { ok: true, parsed: parsed, provider: p, model: res.model || '' };
            return { ok: false, reason: 'parse', message: '' };
          }
          return { ok: false, reason: (res && res.reason) || 'failed', message: (res && res.message) || '' };
        }).then(function (out) {
          if (out.ok) return out;
          var idx = order.indexOf(attempt) + 1;
          if (idx < order.length) return tryProvider(order[idx], order[idx]);
          return out;
        });
    }

    tryProvider(provider, provider).then(function (out) {
      state.film.scriptBusy = false;
      if (out.ok) {
        applyFilmScript(out.parsed, 'ai', 'AI · ' + (out.model || out.provider));
        if (note) note.textContent = L('AI가 ' + out.parsed.scenes.length + '장면을 썼습니다. 문장과 사진 검색어는 카드에서 고칠 수 있습니다.',
          'AI wrote ' + out.parsed.scenes.length + ' scenes. Edit lines and photo keywords on the cards.');
        log(L('장면 AI 대본 · ' + out.parsed.scenes.length + '장면 · ' + (out.model || out.provider),
          'AI scene script · ' + out.parsed.scenes.length + ' scenes · ' + (out.model || out.provider)), 'key');
        toast(L('AI 장면 대본을 만들었습니다.', 'AI scene script ready.'), '');
        loadSceneImages();
        return;
      }
      applyFilmScript(C.localFilmScript(a, { count: count }), 'local');
      var why = out.reason === 'no_key' ? L('Gemini 키가 없어', 'no Gemini key') : out.reason === 'parse' ? L('AI 응답을 읽지 못해', 'could not read the AI reply') : L('AI를 쓰지 못해', 'AI unavailable');
      if (note) note.textContent = L(why + ' 규칙 초안으로 만들었습니다. Gemini 키를 넣으면 더 매끄러운 문장이 나옵니다.',
        why + ' — used the rule draft instead. Add a Gemini key for sharper lines.');
      log(L('장면 AI 실패(' + (out.reason || 'error') + ') → 규칙 초안', 'AI scenes failed (' + (out.reason || 'error') + ') → rule draft'), 'warn');
      toast(L('AI 대신 규칙 초안으로 만들었습니다.', 'Used the rule draft instead of AI.'), 'warn');
      loadSceneImages();
    });
  }

  function renderScenes() {
    var host = $('#scene-list');
    if (!host) return;
    host.innerHTML = '';
    var scenes = state.film.scenes;
    if (!scenes.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state small';
      empty.innerHTML = '<p>' + L('글이 없습니다. 위에서 URL을 읽거나 본문을 붙여넣으세요.', 'No article yet. Read a URL or paste the body above.') + '</p>';
      host.appendChild(empty);
      return;
    }
    var active = C.filmAt(state.film.timeline, state.film.tMs);
    scenes.forEach(function (scene, i) {
      var card = el('div', { class: 'scene-card' + (active && active.index === i ? ' is-active' : ''), dataset: { i: String(i) } });
      card.appendChild(el('span', { class: 'scene-no', text: ('0' + (i + 1)).slice(-2) }));
      var fields = el('div', { class: 'scene-fields' });
      function field(label, value, tag, cls, max) {
        var input = el(tag === 'textarea' ? 'textarea' : 'input', {
          type: tag === 'textarea' ? undefined : 'text',
          class: cls, maxlength: max || '80',
          'aria-label': L('장면 ' + (i + 1) + ' ' + label, 'Scene ' + (i + 1) + ' ' + label)
        });
        input.value = value || '';
        on(input, 'input', function () {
          scene[cls === 'sc-headline' ? 'headline' : cls === 'sc-sub' ? 'sub' : cls === 'sc-caption' ? 'caption' : 'imageQuery'] = input.value;
          invalidateFilmAudio();
          filmSyncTimeline();
          filmDraw(state.film.tMs);
          filmNote(L('장면 ' + scenes.length + '개 · ' + fmtClock(state.film.totalMs), scenes.length + ' scenes · ' + fmtClock(state.film.totalMs)));
        });
        var wrap = el('label', {}, [el('span', { text: label }), input]);
        fields.appendChild(wrap);
        return input;
      }
      field(L('화면 제목', 'Headline'), scene.headline, 'input', 'sc-headline', '60');
      field(L('부제', 'Sub'), scene.sub, 'input', 'sc-sub', '90');
      field(L('자막', 'Caption'), scene.caption, 'textarea', 'sc-caption', '90');
      field(L('사진 검색어', 'Photo keyword'), scene.imageQuery, 'input', 'sc-image', '30');
      card.appendChild(fields);

      var img = state.film.images[i];
      var thumb = el('div', { class: 'scene-thumb' + (img ? ' has-img' : ''), style: img ? { backgroundImage: 'url(' + img.src + ')' } : {} });
      var btn = el('button', { type: 'button', text: img ? L('바꾸기', 'Change') : L('사진', 'Photo'), 'aria-label': L('장면 ' + (i + 1) + ' 사진 바꾸기', 'Change photo for scene ' + (i + 1)) });
      var file = el('input', { type: 'file', accept: 'image/*' });
      file.hidden = true;
      on(btn, 'click', function (e) { e.stopPropagation(); file.click(); });
      on(file, 'change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        loadLocalImage(f).then(function (im) {
          state.film.images[i] = im;
          renderScenes();
          filmDraw(state.film.tMs);
          log(L('장면 ' + (i + 1) + ' 사진 교체 · ' + f.name, 'Scene ' + (i + 1) + ' photo replaced · ' + f.name));
        }).catch(function () { toast(L('사진을 읽지 못했습니다.', 'Could not read that image.'), 'warn'); });
      });
      thumb.appendChild(btn);
      thumb.appendChild(file);
      card.appendChild(thumb);
      on(card, 'click', function (e) {
        if (e.target.closest('input, textarea, button')) return;
        var t = state.film.timeline[i];
        if (t) { filmSeek(t.startMs + 10); }
      });
      host.appendChild(card);
    });
  }

  function loadLocalImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('image')); };
      im.src = url;
    });
  }

  /** 장면에 쓸 사진을 프록시로 받아 캔버스에 안전하게 올린다. (작은 아이콘은 건너뜀) */
  function loadSceneImages() {
    var toggle = $('#tg-blog-images');
    if (toggle && !toggle.checked) {
      state.film.images = {};
      renderScenes();
      filmDraw(state.film.tMs);
      return;
    }
    var list = (state.film.imageChoices || []).filter(function (x) { return x && (x.url || x.preview); });
    var scenes = state.film.scenes;
    if (!list.length || !scenes.length) { renderScenes(); filmDraw(state.film.tMs); return; }
    state.film.images = {};
    var token = (state.film.imgToken || 0) + 1;
    state.film.imgToken = token;
    var cursor = 0;
    var i = 0;
    function next() {
      if (token !== state.film.imgToken || i >= scenes.length || cursor >= list.length) {
        if (token === state.film.imgToken) { renderScenes(); filmDraw(state.film.tMs); }
        return;
      }
      var item = list[cursor++];
      var task = item.preview ? loadLocalUrl(item.preview) : B.loadImage(item.url, { width: 1280 });
      task.then(function (img) {
        var w = img.naturalWidth || img.width || 0;
        if (w && w < 320) return next(); /* 아이콘·작은 썸네일은 장면 사진으로 안 쓴다 */
        if (token === state.film.imgToken) state.film.images[i++] = img;
        return next();
      }).catch(function () { return next(); });
    }
    next();
  }

  function loadLocalUrl(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('image')); };
      im.src = url;
    });
  }

  function uploadBlogImages(files) {
    var list = Array.prototype.slice.call(files || []).slice(0, 8);
    if (!list.length) return;
    Promise.all(list.map(loadLocalImage)).then(function (imgs) {
      state.film.images = {};
      imgs.forEach(function (im, i) { if (i < state.film.scenes.length) state.film.images[i] = im; });
      state.film.imageChoices = imgs.map(function (im) { return { url: '', preview: im.src }; });
      renderBlogThumbs();
      renderScenes();
      filmDraw(state.film.tMs);
      toast(L('내 사진 ' + imgs.length + '장을 장면에 넣었습니다.', 'Added ' + imgs.length + ' of your photos to the scenes.'), '');
      log(L('장면 사진 ' + imgs.length + '장 넣기', imgs.length + ' scene photos added'));
    });
  }

  function searchPexels() {
    var field = $('#pexels-field');
    var input = $('#inp-pexels-key');
    if (field && field.hidden) { field.hidden = false; if (input) input.focus(); return; }
    var key = input ? input.value.trim() : '';
    if (!key) { toast(L('Pexels 키를 넣어 주세요. 무료로 발급됩니다.', 'Add a Pexels key — it is free.'), 'warn'); return; }
    var q = state.film.scenes[0] && state.film.scenes[0].imageQuery ? state.film.scenes[0].imageQuery : (state.film.article ? state.film.article.title : '');
    if (!q) { toast(L('사진 검색어가 없습니다. 장면 카드에 검색어를 넣어 주세요.', 'No photo keyword. Add one on a scene card.'), 'warn'); return; }
    filmNote(L('Pexels에서 “' + q + '” 사진을 찾는 중…', 'Searching Pexels for “' + q + '”…'));
    B.searchPexels(q, key, { count: 8 }).then(function (res) {
      if (!res.ok || !res.photos.length) {
        filmNote(L('Pexels 결과가 없습니다. 다른 검색어를 써 보세요.', 'No Pexels results. Try another keyword.'));
        return;
      }
      state.film.pexelsPhotos = res.photos;
      state.film.imageChoices = res.photos.map(function (p) { return { url: p.url, alt: p.alt, credit: p.credit }; });
      renderBlogThumbs();
      loadSceneImages();
      filmNote(L('Pexels 사진 ' + res.photos.length + '장을 장면에 넣었습니다.', 'Added ' + res.photos.length + ' Pexels photos to the scenes.'));
      log(L('Pexels 사진 ' + res.photos.length + '장 · ' + q, 'Pexels photos · ' + q));
    });
  }

  /* ── YouTube 레퍼런스 수집 ───────────────────────────── */
  function ytKey() {
    try { return localStorage.getItem('clip-factory.yt.key') || ''; } catch (e) { return ''; }
  }

  function saveYtKey(v) {
    try {
      if (v) localStorage.setItem('clip-factory.yt.key', v);
      else localStorage.removeItem('clip-factory.yt.key');
    } catch (e) { /* noop */ }
  }

  function isoDurationSec(iso) {
    var m = String(iso || '').match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return 0;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  }

  function ytApi(path, params) {
    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch('https://www.googleapis.com/youtube/v3/' + path + '?' + qs, { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }

  function setRefNote(text, kind) {
    var n = $('#ref-note');
    if (!n) return;
    n.textContent = text;
    n.className = 'hint' + (kind ? ' is-' + kind : '');
  }

  function searchYouTubeRefs() {
    var q = $('#ref-query') ? $('#ref-query').value.trim() : '';
    if (!q) { toast(L('키워드를 넣어 주세요.', 'Type a keyword first.'), 'warn'); return; }
    var key = $('#inp-yt-key') && $('#inp-yt-key').value.trim() ? $('#inp-yt-key').value.trim() : ytKey();
    if (!key) {
      if ($('#inp-yt-key')) $('#inp-yt-key').focus();
      setRefNote(L('YouTube Data API 키가 필요합니다. 무료로 발급받아 아래 칸에 넣으면 이 브라우저에만 저장됩니다.', 'A free YouTube Data API key is needed. It stays in this browser only.'), 'warn');
      return;
    }
    saveYtKey(key);
    if ($('#inp-yt-key')) $('#inp-yt-key').value = '';
    if ($('#inp-yt-key')) $('#inp-yt-key').placeholder = L('저장됨 · 바꾸려면 새 키 입력', 'Saved · type a new key to replace');
    setRefNote(L('“' + q + '” 인기 쇼츠를 찾는 중…', 'Searching popular shorts for “' + q + '”…'));
    ytApi('search', {
      part: 'snippet', type: 'video', videoDuration: 'short', order: 'viewCount',
      maxResults: 12, q: q, regionCode: 'KR', relevanceLanguage: 'ko', key: key
    }).then(function (res) {
      if (!res.ok) {
        var msg = (res.body && res.body.error && (res.body.error.message || res.body.error.status)) || ('HTTP ' + res.status);
        setRefNote(L('수집 실패: ' + msg + ' — 키의 YouTube Data API 사용 설정을 확인하세요.', 'Collect failed: ' + msg + ' — check that YouTube Data API is enabled for the key.'), 'warn');
        return null;
      }
      var items = (res.body && res.body.items) || [];
      var ids = items.map(function (i) { return i.id && i.id.videoId; }).filter(Boolean);
      if (!ids.length) { setRefNote(L('결과가 없습니다. 다른 키워드를 써 보세요.', 'No results. Try another keyword.')); return null; }
      return ytApi('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(','), key: key }).then(function (d) {
        var list = (d.body && d.body.items) || [];
        state.film.refs = list.map(function (v) {
          var s = v.snippet || {};
          var st = v.statistics || {};
          var sec = isoDurationSec(v.contentDetails && v.contentDetails.duration);
          var thumb = (s.thumbnails && (s.thumbnails.medium || s.thumbnails.default) || {}).url || '';
          return {
            id: v.id,
            title: s.title || '',
            channel: s.channelTitle || '',
            views: Number(st.viewCount || 0),
            sec: sec,
            thumb: thumb,
            hook: s.title || '',
            url: 'https://www.youtube.com/shorts/' + v.id
          };
        }).filter(function (x) { return x.sec > 0 && x.sec <= 180; });
        renderRefs();
        setRefNote(L('쇼츠 ' + state.film.refs.length + '개를 모았습니다. 하나를 고르면 장면 수·리듬·레이아웃 프리셋이 적용됩니다.', 'Collected ' + state.film.refs.length + ' shorts. Pick one to apply its rhythm and layout preset.'));
        log(L('YouTube 레퍼런스 · ' + state.film.refs.length + '개 · ' + q, 'YouTube references · ' + state.film.refs.length + ' · ' + q), 'key');
        return null;
      });
    }).catch(function (err) {
      setRefNote(L('수집 실패: ' + ((err && err.message) || 'network'), 'Collect failed: ' + ((err && err.message) || 'network')), 'warn');
    });
  }

  function fmtViews(n) {
    if (n >= 100000000) return (n / 100000000).toFixed(1) + L('억', 'e8');
    if (n >= 10000) return (n / 10000).toFixed(1) + L('만', 'e4');
    return String(n);
  }

  function renderRefs() {
    var host = $('#ref-list');
    if (!host) return;
    host.innerHTML = '';
    var list = state.film.refs || [];
    if (!list.length) {
      host.appendChild(el('div', { class: 'ref-empty', text: L('아직 모은 레퍼런스가 없습니다.', 'No references collected yet.') }));
      return;
    }
    list.forEach(function (r) {
      var btn = el('button', { type: 'button', class: 'ref-item' + (state.film.refId === r.id ? ' is-active' : ''), 'aria-label': L('레퍼런스 적용 · ' + r.title, 'Apply reference · ' + r.title) });
      if (r.thumb) {
        var img = el('img', { class: 'ref-thumb', src: r.thumb, alt: '', loading: 'lazy' });
        btn.appendChild(img);
      } else {
        btn.appendChild(el('div', { class: 'ref-thumb' }));
      }
      var copy = el('div', { class: 'ref-copy' }, [
        el('strong', { text: r.title }),
        el('small', { text: r.sec + L('초 · 조회 ' + fmtViews(r.views), 's · ' + fmtViews(r.views) + ' views') })
      ]);
      btn.appendChild(copy);
      btn.appendChild(el('span', { class: 'ref-apply', text: L('적용', 'Apply') }));
      on(btn, 'click', function () { applyRef(r); });
      host.appendChild(btn);
    });
  }

  function applyRef(r) {
    state.film.refId = r.id;
    /* 리듬: 쇼츠 길이를 장면 수로 환산 (3~15) */
    var count = Math.max(3, Math.min(15, Math.round(r.sec / 3.2)));
    var t = (r.title || '').toLowerCase();
    var layout = /뉴스|속보|이슈|정부|발표|경제|주가/.test(t) ? 'newsCard'
      : /순위|top|랭킹|best|추천/.test(t) ? 'ranking'
      : r.sec <= 22 ? 'centerImpact' : 'topTitle';
    if ($('#sel-film-count')) { $('#sel-film-count').value = String(count); state.film.countChoice = String(count); }
    if ($('#sel-film-layout')) { $('#sel-film-layout').value = layout; state.film.layoutId = layout; }
    state.film.styleId = layout === 'newsCard' ? 'white' : layout === 'cinematic' ? 'white' : state.film.styleId;
    if ($('#sel-film-caption')) $('#sel-film-caption').value = state.film.styleId;
    if (state.film.article) filmGenerate(false);
    renderRefs();
    filmDraw(state.film.tMs);
    savePrefs();
    setRefNote(L('적용: ' + r.sec + '초 쇼츠 → ' + count + '장면 · ' + (C.FILM_LAYOUTS.filter(function (l) { return l.id === layout; })[0] || {}).label + ' · 훅 “' + (r.title || '').slice(0, 40) + '”',
      'Applied: ' + r.sec + 's short → ' + count + ' scenes · ' + layout + ' · hook “' + (r.title || '').slice(0, 40) + '”'), 'ok');
    log(L('레퍼런스 적용 · ' + r.title.slice(0, 30) + ' · ' + count + '장면', 'Reference applied · ' + r.title.slice(0, 30) + ' · ' + count + ' scenes'), 'key');
    toast(L('레퍼런스 리듬을 적용했습니다.', 'Reference rhythm applied.'), '');
  }

  function wireRef() {
    on($('#btn-ref-search'), 'click', searchYouTubeRefs);
    on($('#ref-query'), 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); searchYouTubeRefs(); } });
    on($('#inp-yt-key'), 'change', function () {
      saveYtKey($('#inp-yt-key').value.trim());
      if ($('#inp-yt-key').value.trim()) {
        $('#inp-yt-key').value = '';
        $('#inp-yt-key').placeholder = L('저장됨 · 바꾸려면 새 키 입력', 'Saved · type a new key to replace');
        setRefNote(L('키를 저장했습니다. 이제 수집을 누르세요.', 'Key saved. Press collect.'));
      }
    });
    on($('#btn-yt-key-clear'), 'click', function () {
      saveYtKey('');
      if ($('#inp-yt-key')) { $('#inp-yt-key').value = ''; $('#inp-yt-key').placeholder = 'AIza...'; }
      setRefNote(L('저장된 YouTube 키를 지웠습니다. 이 브라우저에 남아 있지 않습니다.', 'Cleared the saved YouTube key from this browser.'));
    });
    if ($('#inp-yt-key') && ytKey()) $('#inp-yt-key').placeholder = L('저장됨 · 바꾸려면 새 키 입력', 'Saved · type a new key to replace');
    renderRefs();
  }

  /* ── 미리보기 재생 ──────────────────────────────────── */
  function filmDraw(tMs) {
    var canvas = $('#film-canvas');
    if (!canvas) return;
    var empty = $('#film-empty');
    if (!state.film.scenes.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    var ctx = canvas.getContext('2d');
    var at = C.filmAt(state.film.timeline, tMs);
    if (!at) return;
    var scene = state.film.scenes[at.index] || {};
    R.drawFilmFrame(ctx, {
      w: canvas.width, h: canvas.height,
      scene: scene, index: at.index, total: state.film.scenes.length,
      progress: at.progress, overall: state.film.totalMs ? tMs / state.film.totalMs : 0,
      theme: filmTheme(), image: state.film.images[at.index] || null,
      captionStyle: filmStyle(), captionOn: true, captionProgress: at.progress,
      layout: filmLayout(), subtitle: subtitleFromUI(),
      hook: state.film.article ? state.film.article.title : '',
      hookMs: at.index === 0 ? at.localMs : 99999, hookDur: 1500
    });
    var chip = $('#film-scene-chip');
    if (chip) chip.textContent = 'SCENE ' + (at.index + 1) + ' / ' + state.film.scenes.length;
    var time = $('#film-time');
    if (time) time.textContent = fmtClock(tMs) + ' / ' + fmtClock(state.film.totalMs);
    var scrub = $('#film-scrub');
    if (scrub && document.activeElement !== scrub) scrub.value = String(state.film.totalMs ? Math.round((tMs / state.film.totalMs) * 1000) : 0);
    var cards = $$('#scene-list .scene-card');
    cards.forEach(function (c) { c.classList.toggle('is-active', Number(c.dataset.i) === at.index); });
  }

  function filmTick(now) {
    if (!state.film.playing) return;
    var dt = state.film.lastTs ? now - state.film.lastTs : 16;
    state.film.lastTs = now;
    state.film.tMs += Math.min(80, dt);
    if (state.film.tMs >= state.film.totalMs) {
      state.film.tMs = state.film.totalMs;
      filmDraw(state.film.tMs);
      filmPause();
      return;
    }
    filmDraw(state.film.tMs);
    state.film.raf = requestAnimationFrame(filmTick);
  }

  /* ── 미리보기 소리: 렌더와 같은 오디오 버퍼를 그대로 재생한다 ─────── */
  function stopFilmSound() {
    var pa = state.film.previewAudio;
    state.film.previewAudio = null;
    if (!pa) return;
    try { pa.src.stop(); } catch (e) { /* noop */ }
  }

  function playFilmSound(offsetMs) {
    stopFilmSound();
    var buf = state.film.audioBuffer;
    if (!buf || !buf.duration) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      if (!state.film.audioCtx) state.film.audioCtx = new Ctx();
      var ctx = state.film.audioCtx;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(ctx.destination);
      var off = Math.max(0, Math.min(Math.max(0, buf.duration - 0.05), (offsetMs || 0) / 1000));
      src.start(0, off);
      state.film.previewAudio = { src: src, ctx: ctx };
    } catch (e) { /* 오디오 장치가 없어도 화면은 계속 */ }
  }

  /** 렌더와 같은 오디오 버퍼를 준비한다(캐시). 목소리·BGM·길이가 바뀌면 다시 만든다. */
  function ensureFilmAudio(force) {
    var key = filmAudioKey();
    if (!force && state.film.audioBuffer && state.film.audioKey === key) return Promise.resolve(state.film.audioBuffer);
    if (!force && state.film.audioBusy && state.film.audioBusyKey === key) return state.film.audioBusy;
    var p = buildFilmAudio().then(function (buf) {
      if (state.film.audioBusy === p) {
        state.film.audioBuffer = buf || null;
        state.film.audioKey = buf ? key : '';
        state.film.audioBusy = null;
        state.film.audioBusyKey = '';
      }
      return buf;
    }).catch(function () {
      if (state.film.audioBusy === p) { state.film.audioBusy = null; state.film.audioBusyKey = ''; }
      return null;
    });
    state.film.audioBusy = p;
    state.film.audioBusyKey = key;
    return p;
  }

  function filmPlay() {
    if (!state.film.scenes.length || state.film.playing) return;
    if (state.film.tMs >= state.film.totalMs - 30) state.film.tMs = 0;
    state.film.playing = true;
    state.film.lastTs = 0;
    var btn = $('#btn-film-play');
    if (btn) { btn.classList.add('is-playing'); btn.setAttribute('aria-label', L('미리보기 일시정지', 'Pause preview')); }
    if (T && T.stopSpeaking) T.stopSpeaking();
    state.film.raf = requestAnimationFrame(filmTick);
    /* 소리는 준비되는 대로 현재 위치에 맞춰 붙는다(화면은 바로 시작) */
    var key = filmAudioKey();
    if (state.film.audioBuffer && state.film.audioKey === key) {
      playFilmSound(state.film.tMs);
      return;
    }
    filmNote(L('목소리·BGM을 준비하는 중…', 'Preparing voice and music…'));
    ensureFilmAudio().then(function (buf) {
      if (!state.film.playing) return;
      if (buf) {
        playFilmSound(state.film.tMs);
        filmNote(L('미리보기 · 소리 켜짐 (렌더와 같은 오디오)', 'Preview · sound on (same audio as the render)'));
      } else {
        filmNote(L('소리를 만들지 못해 화면만 재생합니다. 성우 서버·BGM을 확인하세요.', 'No audio this time — showing the picture only. Check the voice server and BGM.'));
      }
    });
  }

  function filmPause() {
    state.film.playing = false;
    if (state.film.raf) { cancelAnimationFrame(state.film.raf); state.film.raf = 0; }
    stopFilmSound();
    var btn = $('#btn-film-play');
    if (btn) { btn.classList.remove('is-playing'); btn.setAttribute('aria-label', L('미리보기 재생', 'Play preview')); }
    if (T && T.stopSpeaking) T.stopSpeaking();
  }

  function filmSeek(tMs) {
    state.film.tMs = Math.max(0, Math.min(state.film.totalMs, tMs));
    filmDraw(state.film.tMs);
    if (state.film.playing) playFilmSound(state.film.tMs);
  }

  /* ── 더빙·BGM → 하나의 오디오 트랙 ─────────────────────── */
  function narrationText(scene) {
    return (scene && (scene.caption || scene.headline)) || '';
  }

  function narrationVoice() {
    var mode = $('#sel-tts') ? $('#sel-tts').value : 'edge';
    if (mode === 'edge') {
      return { mode: 'edge', voice: $('#sel-edge-voice') ? $('#sel-edge-voice').value : (T.DEFAULT_EDGE_VOICE || 'ko-KR-SunHiNeural'), rate: $('#rg-edge-rate') ? $('#rg-edge-rate').value : '+0%' };
    }
    return { mode: 'fish', voice: $('#inp-fish-voice') ? $('#inp-fish-voice').value : '', rate: '+0%' };
  }

  function synthLine(text, v) {
    var cache = state.film.narrationCache || (state.film.narrationCache = {});
    var key = v.mode + '|' + v.voice + '|' + (v.rate || '') + '|' + text;
    if (cache[key]) return Promise.resolve({ ok: true, buffer: cache[key], cached: true });
    var task = v.mode === 'edge'
      ? T.synthesizeEdge(text, { voice: v.voice, rate: v.rate })
      : T.synthesizeFish(text, { model: $('#sel-fish-model') ? $('#sel-fish-model').value : undefined });
    return Promise.resolve(task).then(function (res) {
      if (res && res.ok && res.buffer) cache[key] = res.buffer;
      return res;
    });
  }

  function buildNarration() {
    var mode = $('#sel-tts') ? $('#sel-tts').value : 'edge';
    var scenes = state.film.scenes;
    state.film.narration = {};
    state.film.narrationNote = '';
    if (!T || mode === 'silent' || mode === 'browser' || !scenes.length) {
      if (mode === 'browser') state.film.narrationNote = 'browser';
      return Promise.resolve();
    }
    var v = narrationVoice();
    var next = 0;
    var done = 0;
    var firstError = null;
    /* 4개씩 병렬로 받는다 — 순서는 인덱스로 고정되므로 섞이지 않는다 */
    function worker() {
      if (firstError || next >= scenes.length) return Promise.resolve();
      var i = next++;
      var text = narrationText(scenes[i]);
      if (!text) return worker();
      return synthLine(text, v).then(function (res) {
        if (res && res.ok) {
          state.film.narration[i] = res.buffer;
        } else if (!firstError) {
          firstError = res || { reason: 'failed' };
        }
        done++;
        if (!firstError) filmNote(L((v.mode === 'edge' ? '무료 성우' : 'Fish 성우') + ' 더빙 ' + done + ' / ' + scenes.length + '…',
          (v.mode === 'edge' ? 'Free voice' : 'Fish voice') + ' ' + done + ' / ' + scenes.length + '…'));
        return worker();
      });
    }
    var lanes = [];
    for (var li = 0; li < 4; li++) lanes.push(worker());
    return Promise.all(lanes).then(function () {
      if (firstError) {
        state.film.narrationNote = firstError.reason || 'failed';
        state.film.narrationNoteMessage = firstError.message || '';
      }
    });
  }

  function bgmStyleId() {
    var v = $('#sel-bgm') ? $('#sel-bgm').value : 'lofi';
    if (v === 'upload' || v === 'none') return v;
    return v;
  }

  function uploadBgm(file) {
    if (!file) return;
    file.arrayBuffer().then(function (buf) {
      return T.decodeAudio(buf);
    }).then(function (audio) {
      if (!audio) { toast(L('BGM 파일을 읽지 못했습니다.', 'Could not read that BGM file.'), 'warn'); return; }
      state.film.bgmBuffer = audio;
      state.film.bgmName = file.name;
      toast(L('BGM을 넣었습니다 · ' + file.name, 'BGM loaded · ' + file.name), '');
      log(L('BGM 파일 · ' + file.name, 'BGM file · ' + file.name));
    });
  }

  /** BGM을 덕킹(말할 때 줄이기)해서 버퍼에 섞는다 */
  function mixBgmDucked(dst, src, opts) {
    if (!dst || !src) return;
    var o = opts || {};
    var base = o.gain === undefined ? 0.18 : o.gain;
    var duck = base * (o.duckRatio === undefined ? 0.42 : o.duckRatio);
    var ranges = o.duckRanges || [];
    var sr = dst.sampleRate;
    var ratio = src.sampleRate / sr;
    var len = src.length;
    var step = 1 / Math.max(1, 0.12 * sr);
    function target(tMs) {
      for (var i = 0; i < ranges.length; i++) {
        if (tMs >= ranges[i][0] - 120 && tMs <= ranges[i][1] + 220) return duck;
      }
      return base;
    }
    for (var c = 0; c < dst.numberOfChannels; c++) {
      var out = dst.getChannelData(c);
      var data = src.getChannelData(Math.min(c, src.numberOfChannels - 1));
      var g = base;
      for (var i2 = 0; i2 < out.length; i2++) {
        var t = (i2 / sr) * 1000;
        var tg = target(t);
        if (g < tg) g = Math.min(tg, g + step); else if (g > tg) g = Math.max(tg, g - step);
        var pos = (i2 * ratio) % len;
        var i0 = Math.floor(pos);
        var frac = pos - i0;
        var a = data[i0] || 0;
        var b = data[i0 + 1] === undefined ? a : data[i0 + 1];
        out[i2] += (a + (b - a) * frac) * g;
      }
    }
  }

  function buildFilmAudio() {
    if (!T) return Promise.resolve(null);
    return buildNarration().then(function () {
      filmSyncTimeline();
      var totalMs = state.film.totalMs;
      if (!totalMs) return null;
      var hasNarration = Object.keys(state.film.narration).length > 0;
      var bgmSel = bgmStyleId();
      var bgmTask = Promise.resolve(null);
      if (bgmSel === 'upload' && state.film.bgmBuffer) bgmTask = Promise.resolve(state.film.bgmBuffer);
      else if (bgmSel !== 'none' && bgmSel !== 'upload') bgmTask = Bgm ? Bgm.build(totalMs + 400, { style: bgmSel }) : Promise.resolve(null);
      return bgmTask.then(function (bgm) {
        if (!hasNarration && !bgm) return null;
        var buf = T.makeBuffer(totalMs + 260, 44100, 2);
        var duckRanges = [];
        state.film.scenes.forEach(function (s, i) {
          var n = state.film.narration[i];
          var tl = state.film.timeline[i];
          if (!n || !tl) return;
          T.placeBuffer(buf, n, tl.startMs + 140, 1, 55);
          duckRanges.push([tl.startMs + 140, tl.startMs + 140 + Math.round(n.duration * 1000)]);
        });
        if (bgm) {
          var vol = Number($('#rg-bgm') ? $('#rg-bgm').value : 18) / 100;
          var duckOn = $('#tg-duck') ? $('#tg-duck').checked : true;
          mixBgmDucked(buf, bgm, { gain: vol, duckRanges: duckOn ? duckRanges : [] });
        }
        return buf;
      });
    });
  }

  function renderFilmNow() {
    if (state.film.rendering) return;
    if (!state.film.scenes.length) {
      toast(L('먼저 글을 넣고 장면 대본을 만드세요.', 'Add an article and build the scene script first.'), 'warn');
      return;
    }
    if (state.cap && !state.cap.ok) {
      toast(L('이 브라우저에서는 MP4 렌더를 쓸 수 없습니다.', 'This browser cannot encode MP4.'), 'error');
      return;
    }
    filmPause();
    state.film.rendering = true;
    state.film.result = null;
    var signal = { cancelled: false };
    state.film.signal = signal;
    var preset = filmPreset();
    var ttsMode = $('#sel-tts') ? $('#sel-tts').value : 'silent';
    var btn = $('#btn-film-render');
    var cancel = $('#btn-film-cancel');
    if (btn) btn.disabled = true;
    if (cancel) { cancel.hidden = false; cancel.disabled = false; }
    showBusy(L('카드 쇼츠를 렌더하는 중', 'Rendering card shorts'), L('9:16 캔버스에 장면과 자막을 그려 H.264 MP4로 만듭니다.', 'Drawing scenes and captions to a 9:16 H.264 MP4.'), function () { signal.cancelled = true; });
    log(L('카드 쇼츠 렌더 시작 · ' + state.film.scenes.length + '장면 · ' + preset.label + ' · ' + ttsMode, 'Card shorts render · ' + state.film.scenes.length + ' scenes · ' + preset.label + ' · ' + ttsMode), 'key');

    buildFilmAudio().then(function (audioBuffer) {
      if (state.film.narrationNote) {
        var why = state.film.narrationNote === 'no_key' ? L('Fish 키가 없어 BGM만으로 렌더합니다.', 'No Fish key — rendering with music only.')
          : state.film.narrationNote === 'browser' ? L('브라우저 음성은 MP4에 담을 수 없어 BGM만 넣습니다.', 'Browser speech cannot be recorded into MP4 — adding music only.')
          : L('더빙을 쓰지 못해 BGM만으로 렌더합니다.', 'Voice-over failed — rendering with music only.');
        filmNote(why);
        log(why, 'warn');
      }
      return R.renderFilm({
        scenes: state.film.scenes,
        timeline: state.film.timeline,
        images: state.film.images,
        audioBuffer: audioBuffer,
        preset: preset,
        fps: 30,
        theme: filmTheme(),
        style: filmStyle(),
        layout: filmLayout(),
        subtitle: subtitleFromUI(),
        hook: state.film.article ? state.film.article.title : '',
        hookDur: 1500,
        captionOn: true,
        signal: signal,
        onProgress: function (p) {
          busyProgress(p.progress, L('프레임 ' + p.frame + ' / ' + p.frames, 'Frame ' + p.frame + ' / ' + p.frames));
          filmNote(L('렌더 ' + Math.round(p.progress * 100) + '% · ' + p.frame + '/' + p.frames + ' 프레임', 'Rendering ' + Math.round(p.progress * 100) + '% · ' + p.frame + '/' + p.frames + ' frames'));
        }
      });
    }).then(function (result) {
      hideBusy();
      state.film.rendering = false;
      state.film.signal = null;
      if (cancel) cancel.hidden = true;
      if (btn) btn.disabled = false;
      if (!result) { filmNote(L('렌더 결과가 없습니다.', 'No render result.'), 'warn'); return; }
      state.film.result = result;
      var dl = $('#btn-film-download');
      if (dl) dl.hidden = false;
      filmNote(L('완료 · ' + result.width + '×' + result.height + ' · ' + (result.durationMs / 1000).toFixed(1) + '초 · ' + C.bytes(result.size) +
        (result.hasAudio ? ' · 오디오 ' + result.audioCodec.toUpperCase() : ' · 무음'),
        'Done · ' + result.width + '×' + result.height + ' · ' + (result.durationMs / 1000).toFixed(1) + 's · ' + C.bytes(result.size) +
        (result.hasAudio ? ' · audio ' + result.audioCodec.toUpperCase() : ' · silent')));
      log(L('카드 쇼츠 완료 · ' + C.bytes(result.size) + ' · ' + (result.encodeMs / 1000).toFixed(1) + '초',
        'Card shorts done · ' + C.bytes(result.size) + ' · ' + (result.encodeMs / 1000).toFixed(1) + 's'), 'key');
      toast(L('9:16 MP4를 만들었습니다.', '9:16 MP4 is ready.'), '');
    }).catch(function (err) {
      hideBusy();
      state.film.rendering = false;
      state.film.signal = null;
      if (cancel) cancel.hidden = true;
      if (btn) btn.disabled = false;
      var msg = (err && err.message) || String(err);
      if (msg === 'canceled') { filmNote(L('렌더를 취소했습니다.', 'Render canceled.')); log(L('카드 쇼츠 렌더 취소', 'Card shorts render canceled'), 'warn'); return; }
      filmNote(L('렌더 실패: ' + msg, 'Render failed: ' + msg), 'warn');
      log(L('카드 쇼츠 렌더 실패: ' + msg, 'Card shorts render failed: ' + msg), 'error');
      toast(L('렌더에 실패했습니다: ' + msg, 'Render failed: ' + msg), 'error');
    });
  }

  function downloadFilm() {
    if (!state.film.result) return;
    var name = C.filmFileName(state.film.article ? state.film.article.title : 'shorts', 'mp4');
    R.download(state.film.result.blob, name);
    log(L('카드 쇼츠 내려받기 · ' + name, 'Card shorts download · ' + name), 'key');
  }

  function playBufferPreview(buffer) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !buffer) return;
    try {
      var ctx = new Ctx();
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      src.onended = function () { try { ctx.close(); } catch (e) { /* noop */ } };
    } catch (e) { /* noop */ }
  }

  function testVoice() {
    var scenes = state.film.scenes;
    if (!scenes.length) { toast(L('먼저 장면 대본을 만드세요.', 'Build the scene script first.'), 'warn'); return; }
    var mode = $('#sel-tts') ? $('#sel-tts').value : 'edge';
    var text = narrationText(scenes[0]);
    if (mode === 'edge') {
      var v = narrationVoice();
      filmNote(L('무료 성우 음성을 받는 중…', 'Fetching the free voice…'));
      T.synthesizeEdge(text, { voice: v.voice, rate: v.rate }).then(function (res) {
        if (!res.ok) {
          filmNote(L('더빙 실패: ' + (res.message || res.reason), 'Voice failed: ' + (res.message || res.reason)), 'warn');
          toast(L('무료 성우를 받지 못했습니다. 성우 서버 주소를 확인하세요.', 'Could not get the free voice. Check the voice server.'), 'warn');
          return;
        }
        playBufferPreview(res.buffer);
        filmNote(L('미리 듣기 · ' + (res.voice || v.voice), 'Preview · ' + (res.voice || v.voice)));
      });
      return;
    }
    if (mode === 'browser') {
      if (!T.speechSupported()) { toast(L('이 브라우저에는 음성 합성이 없습니다.', 'This browser has no speech synthesis.'), 'warn'); return; }
      T.speak(text).then(function (r) {
        if (!r.ok) toast(L('음성 재생을 시작하지 못했습니다.', 'Could not start speech.'), 'warn');
      });
      return;
    }
    if (mode === 'fish') {
      filmNote(L('첫 장면 성우 음성을 받는 중…', 'Fetching the voice-over for scene 1…'));
      T.synthesizeFish(text).then(function (res) {
        if (!res.ok) {
          filmNote(L('더빙 실패: ' + (res.message || res.reason), 'Voice-over failed: ' + (res.message || res.reason)), 'warn');
          toast(L('더빙을 받지 못했습니다. 프록시/키를 확인하세요.', 'Could not get the voice-over. Check key/proxy.'), 'warn');
          return;
        }
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        var ctx = new Ctx();
        var src = ctx.createBufferSource();
        src.buffer = res.buffer;
        src.connect(ctx.destination);
        src.start();
        src.onended = function () { try { ctx.close(); } catch (e) { /* noop */ } };
        filmNote(L('더빙 미리 듣기 · ' + (res.model || ''), 'Voice preview · ' + (res.model || '')));
      });
      return;
    }
    toast(L('무음 모드입니다. 자막 타이밍만으로 렌더합니다.', 'Silent mode — timing comes from the captions.'), '');
  }

  /* ── 이벤트 연결 ───────────────────────────────────────── */
  function wireTabs() {
    $$('.tab').forEach(function (t) {
      on(t, 'click', function () { setTab(t.dataset.tab); });
    });
    $$('[data-tab-link]').forEach(function (a) {
      on(a, 'click', function (e) {
        e.preventDefault();
        setTab(a.dataset.tabLink);
      });
    });
    on($('#btn-clips-to-factory'), 'click', function () { setTab('factory'); });
    on($('#btn-clips-render'), 'click', function () { setTab('factory'); renderSelected(); });
  }

  function wireSource() {
    var input = $('#file-input');
    on($('#btn-pick'), 'click', function () { input.click(); });
    on($('#btn-pick-hero'), 'click', function () { input.click(); });
    on($('#dropzone'), 'click', function () { input.click(); });
    on($('#dropzone'), 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    on(input, 'change', function () {
      if (input.files && input.files[0]) openFile(input.files[0]);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      on($('#dropzone'), ev, function (e) {
        e.preventDefault();
        $('#dropzone').classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      on($('#dropzone'), ev, function (e) {
        e.preventDefault();
        $('#dropzone').classList.remove('is-over');
      });
    });
    on($('#dropzone'), 'drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openFile(f);
    });
    ['dragover', 'drop'].forEach(function (ev) {
      on(window, ev, function (e) { e.preventDefault(); });
    });
    on($('#btn-demo'), 'click', buildDemo);
    on($('#btn-demo-hero'), 'click', buildDemo);
    on($('#btn-copy-cmd'), 'click', function () {
      var url = ($('#yt-url').value || '').trim() || 'https://www.youtube.com/watch?v=...';
      var cmd = ytCommand(url);
      var cmdBox = $('#yt-cmd');
      cmdBox.textContent = cmd;
      var done = function () { toast('영상+자막 명령을 복사했습니다. 터미널에 붙여 넣으세요.', ''); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(done).catch(function () { fallbackCopy(cmd, done); });
      } else fallbackCopy(cmd, done);
    });
  }

  /** 유튜브 링크 하나로 영상과 자막(.srt)을 같이 받는 명령 */
  function ytCommand(url) {
    var u = (url || 'https://www.youtube.com/watch?v=...').trim();
    return 'yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" ' +
      '--write-subs --write-auto-subs --sub-langs "ko.*,en.*" --convert-subs srt ' +
      '-o "%(title)s.%(ext)s" "' + u + '"';
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) { toast('복사하지 못했습니다. 명령을 직접 선택해 주세요.', 'error'); }
  }

  function wireDetect() {
    var pairs = [
      ['#rg-silence', '#out-silence', function (v) { return v + ' dB'; }],
      ['#rg-minside', '#out-minside', function (v) { return v + ' ms'; }],
      ['#rg-pad', '#out-pad', function (v) { return v + ' ms'; }],
      ['#rg-scene', '#out-scene', function (v) { return Number(v).toFixed(2); }]
    ];
    pairs.forEach(function (p) {
      var input = $(p[0]);
      on(input, 'input', function () {
        fillRange(input);
        $(p[1]).textContent = p[2](input.value);
      });
    });
    var replanTimer = 0;
    function scheduleReplan() {
      savePrefs();
      if (!state.analysis) return;
      clearTimeout(replanTimer);
      replanTimer = setTimeout(function () {
        runAnalysis(true);
      }, 220);
    }
    ['#rg-silence', '#rg-minside', '#rg-pad', '#rg-scene'].forEach(function (sel) {
      on($(sel), 'input', function () {
        fillRange($(sel));
        var out = { '#rg-silence': '#out-silence', '#rg-minside': '#out-minside', '#rg-pad': '#out-pad', '#rg-scene': '#out-scene' }[sel];
        $(out).textContent = sel === '#rg-scene' ? Number($(sel).value).toFixed(2) : $(sel).value + (sel === '#rg-silence' ? ' dB' : ' ms');
        scheduleReplan();
      });
    });
    on($('#tg-silence'), 'change', scheduleReplan);
    ['#sel-target', '#sel-count'].forEach(function (sel) {
      on($(sel), 'change', function () { savePrefs(); if (state.analysis) runAnalysis(true); });
    });
    on($('#btn-redetect'), 'click', function () {
      if (state.source) runAnalysis(false);
    });
  }

  function wireReframe() {
    $$('#track-modes .seg-btn').forEach(function (b) {
      on(b, 'click', function () {
        state.mode = b.dataset.mode;
        syncSeg();
        savePrefs();
        sourceTrackCache = { key: '', track: null };
        retrackAll();
        renderAll();
      });
    });
    on($('#rg-smooth'), 'input', function () {
      state.smooth = Number($('#rg-smooth').value);
      $('#out-smooth').textContent = state.smooth.toFixed(2);
      fillRange($('#rg-smooth'));
      if (state.analysis) {
        Object.keys(state.analysis.tracks).forEach(function (id) {
          var t = state.analysis.tracks[id];
          t.curve = C.buildCurve(t.points, { smooth: state.smooth, maxStep: 0.055 });
        });
      }
      sourceTrackCache = { key: '', track: null };
      state.dirty = true;
      requestTick();
    });
    on($('#rg-smooth'), 'change', savePrefs);
    on($('#rg-zoom'), 'input', function () {
      state.zoom = Number($('#rg-zoom').value);
      $('#out-zoom').textContent = state.zoom.toFixed(2) + '×';
      fillRange($('#rg-zoom'));
      state.dirty = true;
      requestTick();
    });
    on($('#rg-zoom'), 'change', savePrefs);
    on($('#tg-safe'), 'change', function () {
      savePrefs();
      $('.monitor-out').classList.toggle('show-safe', $('#tg-safe').checked);
    });
    $('.monitor-out').classList.toggle('show-safe', $('#tg-safe').checked);
  }

  function wireCaption() {
    var grid = $('#caption-styles');
    C.CAPTION_STYLES.forEach(function (style) {
      var card = el('button', {
        type: 'button', class: 'style-card' + (state.styleId === style.id ? ' is-active' : ''),
        role: 'radio', 'aria-checked': state.styleId === style.id ? 'true' : 'false',
        dataset: { style: style.id }
      }, [
        el('span', {
          class: 'style-swatch',
          text: style.id === 'kicker' ? L('키커', 'Kick') : L('가나다', 'Aa'),
          style: { background: style.box || '#111419', color: style.fill }
        }),
        el('span', { class: 'style-name', text: style.label })
      ]);
      on(card, 'click', function () {
        state.styleId = style.id;
        $$('#caption-styles .style-card').forEach(function (c) {
          var active = c.dataset.style === style.id;
          c.classList.toggle('is-active', active);
          c.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        savePrefs();
        drawPreview(true);
      });
      grid.appendChild(card);
    });
    on($('#tg-captions'), 'change', function () { savePrefs(); drawPreview(true); });
    $$('#caption-modes .seg-btn').forEach(function (b) {
      on(b, 'click', function () {
        state.captionMode = b.dataset.cmode || 'both';
        syncCaptionMode();
        savePrefs();
        drawPreview(true);
        log('자막 모드: ' + (state.captionMode === 'both' ? '해설+대사' : state.captionMode === 'commentary' ? '해설만' : '대사만'), '');
      });
    });
    on($('#tg-render-caption'), 'change', savePrefs);
    on($('#btn-srt-open'), 'click', function () { $('#srt-input').click(); });
    on($('#srt-input'), 'change', function () {
      if ($('#srt-input').files[0]) loadSubtitleFile($('#srt-input').files[0]);
      $('#srt-input').value = '';
    });
    function loadDemoCues() {
      if (!state.source) { toast('데모 VOD를 먼저 만들어 주세요.', 'warn'); return; }
      var cues = (state.source.demo && state.source.demo.cues) || D.cues();
      setCues(cues, cues.length + ' 큐 · 데모');
      toast('데모 자막을 불러왔습니다.', '');
    }
    on($('#btn-demo-srt'), 'click', loadDemoCues);
    on($('#btn-cue-demo'), 'click', loadDemoCues);
  }

  function wireStory() {
    var input = $('#story-file');
    var drop = $('#story-drop');
    if (drop) {
      on(drop, 'click', function () { if (input) input.click(); });
      on(drop, 'keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (input) input.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        on(drop, ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        on(drop, ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
      });
      on(drop, 'drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && f.text) f.text().then(function (t) { loadStoryText(t, f.name); });
      });
    }
    on(input, 'change', function () {
      var f = input.files && input.files[0];
      if (f) f.text().then(function (t) { loadStoryText(t, f.name); });
      input.value = '';
    });
    on($('#btn-story-text'), 'click', function () {
      var ta = $('#story-text');
      var text = (ta && ta.value ? ta.value : '').trim();
      if (!text) { toast('붙여넣은 자막이 없습니다.', 'warn'); return; }
      if (loadStoryText(text, '붙여넣기')) ta.value = '';
    });
    on($('#btn-story-demo'), 'click', function () {
      loadStoryText(C.demoSrt(), '데모 자막');
      log('데모 자막(SRT)을 읽었습니다. 32초 데모 흐름과 같은 시간입니다.', 'key');
    });
    on($('#btn-story-run'), 'click', runStory);
    on($('#btn-story-apply-all'), 'click', function () { applyStorySegments(); });
    on($('#btn-story-clear'), 'click', function () {
      state.story = { segments: [], busy: false, source: '', note: '', why: '' };
      renderStory();
      updateStoryControls();
      setStoryStatus('자막을 넣고 AI 스토리 구간 찾기를 눌러 보세요.', '');
    });
    on($('#btn-story-pro'), 'click', openPro);
    ['#sel-story-count', '#sel-story-len'].forEach(function (sel) { on($(sel), 'change', savePrefs); });
    renderStory();
    updateStoryControls();
  }

  function wireCommentary() {
    on($('#btn-comm-add'), 'click', function () {
      var clip = activeClip();
      if (!clip) { toast('먼저 클립을 선택해 주세요.', 'warn'); return; }
      var cues = ensureCommentary(clip);
      var start = cues.length ? cues[cues.length - 1].endMs + 120 : 0;
      if (start >= clip.durationMs - 400) start = Math.max(0, clip.durationMs - 2200);
      cues.push({ startMs: Math.round(start), endMs: Math.round(Math.min(clip.durationMs, start + 1800)), text: '' });
      clip.commentarySource = clip.commentarySource || 'local';
      renderCommentary();
      drawPreview(true);
      var rows = $$('#comm-list .comm-row');
      if (rows.length) rows[rows.length - 1].querySelector('.comm-text').focus();
    });
    on($('#btn-comm-regen'), 'click', regenerateCommentary);
    on($('#sel-comm-style'), 'change', function () {
      var v = $('#sel-comm-style').value;
      state.commentaryStyle = v === 'plain' ? 'plain' : 'badge';
      savePrefs();
      drawPreview(true);
    });
  }

  function wireTransport() {
    on($('#btn-play'), 'click', togglePlay);
    on($('#scrub'), 'input', function () {
      var clip = state.playMode === 'clip' ? activeClip() : null;
      var total = clip ? clip.durationMs : (state.source ? state.source.durationMs : 0);
      if (!total) return;
      var localMs = (Number($('#scrub').value) / 1000) * total;
      if (clip) {
        state.localMs = localMs;
        state.playStartLocal = localMs;
        state.playClock = performance.now();
        try { state.source.video.currentTime = R.sourceTimeAt(clip, localMs) / 1000; } catch (e) { /* noop */ }
      } else if (state.source) {
        try { state.source.video.currentTime = localMs / 1000; } catch (e) { /* noop */ }
      }
      state.dirty = true;
      drawPreview(true);
      updateClock();
    });
    ['#btn-prev-cut', '#btn-next-cut'].forEach(function (sel) {
      on($(sel), 'click', function () {
        if (!state.analysis || !state.source) return;
        var now = state.source.video.currentTime * 1000;
        var cuts = (state.analysis.cuts || []).map(function (c) { return c.tMs; }).concat([0, state.source.durationMs]);
        cuts.sort(function (a, b) { return a - b; });
        var target = null;
        if (sel === '#btn-next-cut') {
          for (var i = 0; i < cuts.length; i++) if (cuts[i] > now + 80) { target = cuts[i]; break; }
        } else {
          for (var j = cuts.length - 1; j >= 0; j--) if (cuts[j] < now - 80) { target = cuts[j]; break; }
        }
        if (target !== null && state.source) {
          state.playMode = 'source';
          state.source.video.muted = false;
          state.source.video.currentTime = target / 1000;
          state.dirty = true;
          drawPreview(true);
          updateClock();
        }
      });
    });
    on($('#btn-add-clip'), 'click', function () {
      if (!state.source) return;
      var total = state.source.durationMs;
      var center = state.playMode === 'clip' && activeClip() ? activeClip().startMs + activeClip().durationMs / 2 : state.source.video.currentTime * 1000;
      var target = Number($('#sel-target').value || 15000);
      var start = Math.max(0, Math.round(center - target / 3));
      var end = Math.min(total, start + target);
      var ranges = [];
      (state.analysis ? state.analysis.keep : [{ startMs: 0, endMs: total }]).forEach(function (s) {
        var a = Math.max(s.startMs, start), b = Math.min(s.endMs, end);
        if (b - a > 200) ranges.push({ startMs: a, endMs: b, durMs: b - a });
      });
      if (!ranges.length) { toast('이 구간에는 남길 말소리가 없습니다.', 'warn'); return; }
      var durationMs = ranges.reduce(function (acc, r) { return acc + r.durMs; }, 0);
      var clip = {
        id: C.uid('clip'), index: state.clips.length, startMs: ranges[0].startMs, endMs: ranges[ranges.length - 1].endMs,
        durationMs: durationMs, ranges: ranges, score: 0, title: '', hook: '', hashtags: [],
        selected: true, speechRatio: 1, source: 'manual', thumb: ''
      };
      state.clips.push(clip);
      state.clips.sort(function (a, b) { return a.startMs - b.startMs; });
      state.clips.forEach(function (c, i) { c.index = i; });
      state.activeClipId = clip.id;
      syncQueueWithSelection();
      renderAll();
      log('수동 클립 추가: ' + C.clock(clip.startMs) + ' → ' + C.clock(clip.endMs) + ' · ' + (clip.durationMs / 1000).toFixed(1) + '초', 'key');
      toast('이 구간을 클립으로 담았습니다.', '');
    });
    function backToSource() {
      if (state.playMode === 'clip') { previewSource(); toast('원본 모드로 돌아왔습니다.', ''); }
    }
    on($('#src-screen'), 'click', backToSource);
    on($('#src-screen'), 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); backToSource(); }
    });
    on($('#tg-loop'), 'change', savePrefs);
    $('.wave-wrap') && on($('.wave-wrap'), 'click', function (e) {
      if (!state.source) return;
      var box = this.getBoundingClientRect();
      var p = (e.clientX - box.left - 12) / Math.max(1, box.width - 24);
      p = Math.max(0, Math.min(1, p));
      state.playMode = 'source';
      state.source.video.muted = false;
      try { state.source.video.currentTime = (p * state.source.durationMs) / 1000; } catch (err) { /* noop */ }
      state.localMs = p * state.source.durationMs;
      state.dirty = true;
      drawPreview(true);
      updateClock();
    });
  }

  function wireClips() {
    on($('#btn-select-all'), 'click', function () {
      var allOn = state.clips.every(function (c) { return c.selected; });
      state.clips.forEach(function (c) { c.selected = !allOn; });
      syncQueueWithSelection();
      renderClips();
      renderQueue();
      renderTimeline();
      updateTicks();
    });
    on($('#btn-clear-clips'), 'click', function () {
      state.clips.forEach(function (c) { c.selected = false; });
      state.queue = [];
      state.activeClipId = '';
      renderClips();
      renderQueue();
      renderTimeline();
      updateTicks();
    });
  }

  function wireQueue() {
    on($('#btn-render'), 'click', renderSelected);
    on($('#btn-cancel-render'), 'click', function () {
      if (state.renderSignal) state.renderSignal.cancelled = true;
      var btn = $('#btn-cancel-render');
      if (btn) btn.disabled = true;
    });
    on($('#btn-zip'), 'click', function () {
      var files = state.queue.filter(function (q) { return q.status === 'done' && q.result; }).map(function (q) {
        var clip = clipById(q.clipId);
        return { name: C.clipFileName(state.clips.indexOf(clip), clip ? clip.title : '', 'mp4'), blob: q.result.blob };
      });
      if (!files.length) { toast('완료된 클립이 없습니다.', 'warn'); return; }
      R.zip(files).then(function (blob) {
        R.download(blob, C.zipName());
        log('ZIP 저장 · ' + files.length + '개 · ' + C.bytes(blob.size), 'key');
        toast('ZIP으로 묶었습니다.', '');
      }).catch(function (err) {
        toast('ZIP을 만들지 못했습니다: ' + ((err && err.message) || err), 'error');
      });
    });
    on($('#sel-preset'), 'change', savePrefs);
    on($('#sel-fps'), 'change', function () { savePrefs(); drawPreview(true); });
  }

  function wireSubtitles() {
    on($('#btn-cue-add'), 'click', function () {
      var base = state.cues.length ? state.cues[state.cues.length - 1].endMs + 200 : 0;
      state.cues.push({ startMs: base, endMs: base + 1500, text: '' });
      setCues(state.cues, state.cues.length + ' 큐');
      var rows = $$('#cue-list .cue-row');
      if (rows.length) rows[rows.length - 1].querySelector('.cue-text').focus();
    });
    on($('#btn-srt-export'), 'click', function () {
      if (!state.cues.length) { toast('내보낼 자막이 없습니다.', 'warn'); return; }
      var blob = new Blob([C.serializeSRT(state.cues)], { type: 'text/plain;charset=utf-8' });
      R.download(blob, 'clip-factory-captions.srt');
      log('자막 내보내기 · ' + state.cues.length + '큐');
    });
    on($('#btn-cue-shift'), 'click', function () {
      state.cues.forEach(function (c) { c.startMs += 500; c.endMs += 500; });
      setCues(state.cues, state.cues.length + ' 큐');
      log('자막을 0.5초 밀었습니다.', '');
    });
    on($('#btn-srt-apply'), 'click', function () {
      var parsed = C.parseSubtitles($('#cue-srt').value);
      if (!parsed.cues.length) { toast('읽을 수 있는 자막이 없습니다. 형식을 확인해 주세요.', 'warn'); return; }
      setCues(parsed.cues, parsed.cues.length + ' 큐 · 원문 적용');
      log('자막 원문 적용 · ' + parsed.cues.length + '큐' + (parsed.warnings.length ? ' · 경고 ' + parsed.warnings.length : ''));
    });
    on($('#btn-srt-refresh'), 'click', function () {
      $('#cue-srt').value = state.cues.length ? C.serializeSRT(state.cues) : '';
      toast('현재 목록으로 원문을 다시 만들었습니다.', '');
    });
  }

  /* ── V2 배선: 자동 · 대본 · 블로그 · Gemini ───────────────── */
  /** 자동 패널 셀렉트의 짧은 라벨 — 좁은 레일에서 영어가 잘리지 않게 */
  function applyAutoLabels() {
    var crop = $('#sel-auto-crop');
    if (crop && crop.options.length === 3) {
      var cropText = [['피사체 추적', 'Subject'], ['중앙 고정', 'Center'], ['블러 배경', 'Blur']];
      for (var i = 0; i < 3; i++) crop.options[i].text = isEn() ? cropText[i][1] : cropText[i][0];
    }
    var sil = $('#sel-auto-silence');
    if (sil && sil.options.length === 4) {
      var silText = [['자르지 않음', 'No cut'], ['0.4초 이상', '0.4s+'], ['0.6초 이상', '0.6s+'], ['1.0초 이상', '1.0s+']];
      for (var j = 0; j < 4; j++) sil.options[j].text = isEn() ? silText[j][1] : silText[j][0];
    }
    var cnt = $('#sel-auto-count');
    if (cnt && cnt.options.length === 3) {
      var cntText = ['2', '3', '5'];
      for (var k = 0; k < 3; k++) cnt.options[k].text = isEn() ? cntText[k] : cntText[k] + '개';
    }
  }

  function wireAuto() {
    on($('#btn-auto-run'), 'click', runAuto);
    ['#sel-auto-crop', '#sel-auto-silence', '#sel-auto-count'].forEach(function (sel) {
      on($(sel), 'change', function () {
        applyAutoChoices();
        syncAutoButton();
        autoStep('crop', 'idle');
        autoReset();
        autoStatus(L('설정을 반영했습니다. 원버튼을 누르면 이 값으로 다시 돌립니다.', 'Settings applied. Press the button to run with these values.'));
      });
    });
    on($('#tg-auto-ai'), 'change', savePrefs);
    applyAutoLabels();
    /* i18n 은 이 파일 뒤에 로드되어 DOMContentLoaded 에서 언어를 정한다.
       load 시점에 한 번 더 맞춰 두면 어떤 순서에서도 영어 라벨이 유지된다. */
    on(window, 'load', applyAutoLabels);
    on(document, 'onetap:langready', applyAutoLabels);
    syncAutoButton();
  }

  function wireScript() {
    on($('#btn-script-apply'), 'click', function () { applyScriptToCues(false); });
    on($('#btn-script-clear'), 'click', function () {
      var ta = $('#ta-script');
      if (ta) ta.value = '';
      var st = $('#script-status');
      if (st) st.textContent = L('자막 파일이 없어도 됩니다. 배분한 뒤 타임코드는 직접 고칠 수 있습니다.', 'No subtitle file needed. You can edit the timecodes after distributing.');
    });
  }

  function buildThemeSeg() {
    var host = $('#film-themes');
    if (!host) return;
    host.innerHTML = '';
    C.FILM_THEMES.forEach(function (theme, i) {
      var active = i === state.film.themeIndex;
      var btn = el('button', {
        type: 'button', class: 'seg-btn' + (active ? ' is-active' : ''),
        role: 'radio', 'aria-checked': active ? 'true' : 'false',
        text: L(theme.label, theme.id === 'editorial' ? 'Editorial dark' : theme.id === 'lime' ? 'Lime pop' : 'Warm paper')
      });
      on(btn, 'click', function () {
        state.film.themeIndex = i;
        buildThemeSeg();
        filmDraw(state.film.tMs);
        savePrefs();
      });
      host.appendChild(btn);
    });
  }

  function bindSubtitleControls() {
    var d = C.SUBTITLE_DEFAULT || {};
    var size = $('#rg-sub-size'), pos = $('#sel-sub-pos'), pct = $('#rg-sub-pos');
    var color = $('#inp-sub-color'), stroke = $('#inp-sub-stroke'), box = $('#inp-sub-box');
    var width = $('#rg-sub-stroke'), boxOn = $('#tg-sub-box');
    if (!size) return;
    size.value = d.sizePx || 64;
    color.value = (d.color || '#FFFFFF').toLowerCase();
    stroke.value = (d.stroke || '#0A0A0B').toLowerCase();
    box.value = '#08090B';
    width.value = d.strokeWidth || 8;
    pct.value = d.posPct || 84;
    pos.value = d.pos || 'bottom';
    boxOn.checked = false;
    var outSize = $('#out-sub-size'), outPos = $('#out-sub-pos'), outStroke = $('#out-sub-stroke');
    function syncLabels() {
      if (outSize) outSize.textContent = size.value + 'px';
      if (outPos) outPos.textContent = pct.value + '%';
      if (outStroke) outStroke.textContent = width.value;
      pct.disabled = pos.value !== 'custom';
    }
    function apply() {
      state.film.subtitle = subtitleFromUI();
      syncLabels();
      filmDraw(state.film.tMs);
      savePrefs();
    }
    ['input', 'change'].forEach(function (evt) {
      [size, pct, color, stroke, box, width].forEach(function (node) { on(node, evt, apply); });
    });
    on(pos, 'change', function () {
      if (pos.value === 'top') pct.value = '13';
      else if (pos.value === 'center') pct.value = '50';
      else if (pos.value === 'bottom') pct.value = '84';
      apply();
    });
    on(boxOn, 'change', apply);
    on($('#btn-sub-reset'), 'click', function () {
      size.value = d.sizePx || 64;
      color.value = (d.color || '#FFFFFF').toLowerCase();
      stroke.value = (d.stroke || '#0A0A0B').toLowerCase();
      width.value = d.strokeWidth || 8;
      pos.value = d.pos || 'bottom';
      pct.value = d.posPct || 84;
      boxOn.checked = false;
      apply();
      toast(L('자막을 기본값으로 되돌렸습니다.', 'Subtitle settings reset.'), '');
    });
    syncLabels();
    state.film.subtitle = subtitleFromUI();
  }

  /** 저장된 자막 설정을 UI 에 되돌린다 */
  function applySavedSubtitle() {
    var sub = state.film.subtitle;
    if (!sub) return;
    var set = function (sel, v) { var n = $(sel); if (n && v !== undefined && v !== null) n.value = v; };
    set('#rg-sub-size', sub.sizePx);
    set('#rg-sub-stroke', sub.strokeWidth);
    set('#sel-sub-pos', sub.pos);
    set('#rg-sub-pos', sub.posPct);
    if (sub.color && $('#inp-sub-color')) $('#inp-sub-color').value = sub.color;
    if (sub.stroke && $('#inp-sub-stroke')) $('#inp-sub-stroke').value = sub.stroke;
    if ($('#tg-sub-box')) $('#tg-sub-box').checked = !!sub.box;
    if ($('#out-sub-size')) $('#out-sub-size').textContent = ($('#rg-sub-size').value || '64') + 'px';
    if ($('#out-sub-pos')) $('#out-sub-pos').textContent = ($('#rg-sub-pos').value || '84') + '%';
    if ($('#out-sub-stroke')) $('#out-sub-stroke').textContent = $('#rg-sub-stroke').value || '8';
    if ($('#rg-sub-pos')) $('#rg-sub-pos').disabled = $('#sel-sub-pos').value !== 'custom';
    state.film.subtitle = subtitleFromUI();
  }

  function buildFilmSelects() {
    var count = $('#sel-film-count');
    if (count && !count.options.length) {
      count.appendChild(el('option', { value: 'auto', text: L('자동 추천 (글 길이)', 'Auto (by length)') }));
      for (var n = 3; n <= 15; n++) {
        count.appendChild(el('option', { value: String(n), text: L(n + '장면', n + ' scenes') }));
      }
      count.value = state.film.countChoice || 'auto';
      on(count, 'change', function () {
        state.film.countChoice = count.value;
        if (state.film.article) filmGenerate(false);
        savePrefs();
      });
    }
    var layout = $('#sel-film-layout');
    if (layout && !layout.options.length) {
      C.FILM_LAYOUTS.forEach(function (l) {
        layout.appendChild(el('option', { value: l.id, text: L(l.label, l.id === 'topTitle' ? 'Top title + bottom captions'
          : l.id === 'centerImpact' ? 'Center impact keyword' : l.id === 'newsCard' ? 'News / magazine card'
          : l.id === 'ranking' ? 'Ranking countdown' : 'Cinematic minimal') }));
      });
      layout.value = state.film.layoutId || 'topTitle';
      state.film.layoutId = layout.value;
      on(layout, 'change', function () {
        state.film.layoutId = layout.value;
        filmDraw(state.film.tMs);
        savePrefs();
      });
    }
    var edgeVoice = $('#sel-edge-voice');
    if (edgeVoice && !edgeVoice.options.length) {
      var voices = (T && T.EDGE_VOICES) || [];
      voices.forEach(function (v) {
        edgeVoice.appendChild(el('option', { value: v.id, text: L(v.label, v.id === 'ko-KR-SunHiNeural' ? 'SunHi · Korean female'
          : v.id === 'ko-KR-InJoonNeural' ? 'InJoon · Korean male'
          : v.id === 'ko-KR-HyunsuMultilingualNeural' ? 'Hyunsu · Korean male (multilingual)'
          : v.id === 'en-US-EmmaMultilingualNeural' ? 'Emma · English female' : 'Andrew · English male') }));
      });
      var st0 = T ? T.status() : null;
      edgeVoice.value = (st0 && st0.edgeVoice) || (T && T.DEFAULT_EDGE_VOICE) || 'ko-KR-SunHiNeural';
      on(edgeVoice, 'change', function () {
        if (T) T.save({ edgeVoice: edgeVoice.value });
        invalidateFilmAudio();
        savePrefs();
      });
    }
    bindSubtitleControls();
    applySavedSubtitle();
    var cap = $('#sel-film-caption');
    if (cap && !cap.options.length) {
      C.CAPTION_STYLES.forEach(function (s) {
        cap.appendChild(el('option', { value: s.id, text: L(s.label, s.id === 'yellow' ? 'Yellow impact' : s.id === 'white' ? 'Clean white' : s.id === 'box' ? 'Black box' : s.id === 'kicker' ? 'Kicker lime' : 'Karaoke highlight') }));
      });
      cap.value = state.film.styleId;
      on(cap, 'change', function () {
        state.film.styleId = cap.value;
        filmDraw(state.film.tMs);
        savePrefs();
      });
    }
    var preset = $('#sel-film-preset');
    if (preset && !preset.options.length) {
      C.PRESETS.forEach(function (p) {
        preset.appendChild(el('option', { value: p.id, text: p.label }));
      });
      preset.value = state.film.presetId;
      on(preset, 'change', function () { state.film.presetId = preset.value; savePrefs(); });
    }
  }

  function wireBlog() {
    on($('#btn-blog-fetch'), 'click', fetchBlog);
    on($('#blog-url'), 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fetchBlog(); } });
    on($('#btn-blog-use'), 'click', usePastedArticle);
    on($('#btn-blog-demo'), 'click', useDemoArticle);
    on($('#btn-blog-clear'), 'click', function () {
      if ($('#blog-text')) $('#blog-text').value = '';
      if ($('#blog-url')) $('#blog-url').value = '';
      state.film.article = null;
      state.film.scenes = [];
      state.film.images = {};
      state.film.imageChoices = [];
      state.film.result = null;
      renderBlogMeta();
      renderBlogThumbs();
      renderScenes();
      filmSyncTimeline();
      filmDraw(0);
    });
    on($('#btn-blog-images'), 'click', function () { $('#blog-images').click(); });
    on($('#blog-images'), 'change', function () {
      var files = $('#blog-images').files;
      uploadBlogImages(files);
      $('#blog-images').value = '';
    });
    on($('#btn-blog-pexels'), 'click', searchPexels);
    on($('#tg-blog-images'), 'change', function () {
      if (!$('#tg-blog-images').checked) {
        state.film.images = {};
        renderScenes();
        filmDraw(state.film.tMs);
      } else loadSceneImages();
      savePrefs();
    });
    on($('#btn-film-ai'), 'click', function () { filmGenerate(true); });
    on($('#btn-film-local'), 'click', function () { filmGenerate(false); });
    on($('#sel-film-count'), 'change', function () {
      if (state.film.article) filmGenerate(false);
    });
    on($('#sel-tts'), 'change', function () {
      var v = $('#sel-tts').value;
      if ($('#fish-fields')) $('#fish-fields').hidden = v !== 'fish';
      if ($('#edge-fields')) $('#edge-fields').hidden = v !== 'edge';
      var tag = $('#tts-tag');
      if (tag) tag.textContent = v === 'edge' ? L('무료 성우', 'Free voice') : v === 'fish' ? 'Fish Audio' : v === 'browser' ? L('브라우저 음성', 'Browser voice') : L('무음 자막', 'Silent captions');
      invalidateFilmAudio();
      savePrefs();
    });
    on($('#inp-edge-proxy'), 'change', function () {
      if (!T) return;
      T.save({ edgeProxy: $('#inp-edge-proxy').value });
      invalidateFilmAudio();
      savePrefs();
    });
    on($('#rg-edge-rate'), 'change', function () { invalidateFilmAudio(); savePrefs(); });
    ['#inp-fish-key', '#inp-fish-voice', '#inp-fish-proxy'].forEach(function (sel) {
      on($(sel), 'change', function () {
        if (!T) return;
        T.save({ key: $('#inp-fish-key').value, voice: $('#inp-fish-voice').value, proxy: $('#inp-fish-proxy').value, model: $('#sel-fish-model').value });
        log(L('Fish 설정 저장 · 모델 ' + $('#sel-fish-model').value, 'Fish settings saved · model ' + $('#sel-fish-model').value));
      });
    });
    on($('#sel-fish-model'), 'change', function () {
      if (T) T.save({ model: $('#sel-fish-model').value });
    });
    on($('#btn-tts-test'), 'click', testVoice);
    on($('#sel-bgm'), 'change', function () {
      if ($('#sel-bgm').value === 'upload') $('#bgm-file').click();
      invalidateFilmAudio();
      savePrefs();
    });
    on($('#bgm-file'), 'change', function () {
      var f = $('#bgm-file').files && $('#bgm-file').files[0];
      if (f) uploadBgm(f);
      $('#bgm-file').value = '';
    });
    on($('#rg-bgm'), 'input', function () {
      fillRange($('#rg-bgm'));
      $('#out-bgm').textContent = $('#rg-bgm').value + '%';
    });
    on($('#rg-bgm'), 'change', function () { invalidateFilmAudio(); savePrefs(); });
    on($('#tg-duck'), 'change', function () { invalidateFilmAudio(); savePrefs(); });
    on($('#btn-film-play'), 'click', function () { state.film.playing ? filmPause() : filmPlay(); });
    on($('#film-scrub'), 'input', function () {
      var r = Number($('#film-scrub').value) / 1000;
      filmSeek(r * state.film.totalMs);
    });
    on($('#btn-film-render'), 'click', renderFilmNow);
    on($('#btn-blog-top-render'), 'click', renderFilmNow);
    on($('#btn-film-cancel'), 'click', function () {
      if (state.film.signal) state.film.signal.cancelled = true;
      $('#btn-film-cancel').disabled = true;
    });
    on($('#btn-film-download'), 'click', downloadFilm);
    buildThemeSeg();
    buildFilmSelects();
    if (T) {
      var st = T.status();
      if (st.hasKey) { $('#inp-fish-key').value = ''; $('#inp-fish-key').placeholder = st.masked + L(' 저장됨', ' saved'); }
      if (st.voice) $('#inp-fish-voice').value = st.voice;
      if (st.proxy) $('#inp-fish-proxy').value = st.proxy;
      if (st.model) $('#sel-fish-model').value = st.model;
      if (st.edgeProxy && $('#inp-edge-proxy')) $('#inp-edge-proxy').value = st.edgeProxy;
      var ttsMode = $('#sel-tts') ? $('#sel-tts').value : 'edge';
      if ($('#edge-fields')) $('#edge-fields').hidden = ttsMode !== 'edge';
      if ($('#fish-fields')) $('#fish-fields').hidden = ttsMode !== 'fish';
      var ttag = $('#tts-tag');
      if (ttag) ttag.textContent = ttsMode === 'edge' ? L('무료 성우', 'Free voice') : ttsMode === 'fish' ? 'Fish Audio' : ttsMode === 'browser' ? L('브라우저 음성', 'Browser voice') : L('무음 자막', 'Silent captions');
    }
    renderBlogMeta();
    renderBlogThumbs();
    renderScenes();
    filmSyncTimeline();
  }

  function updateGeminiBadge() {
    var label = $('#gemini-badge-label');
    var btn = $('#btn-gemini');
    if (!label || !btn) return;
    var on_ = false;
    try { on_ = !!(G && G.hasKey()); } catch (e) { on_ = false; }
    label.textContent = on_ ? L('Gemini 연결', 'Gemini on') : L('Gemini 키', 'Gemini key');
    btn.classList.toggle('is-on', on_);
    btn.title = on_ ? L('내 Gemini 키 연결됨 · 눌러서 관리', 'Your Gemini key is connected · click to manage') : L('무료 Gemini 키를 넣으면 AI가 더 좋아집니다', 'Add a free Gemini key for better AI');
  }

  function openGemini() {
    var modal = $('#gemini-modal');
    if (!modal) return;
    modal.hidden = false;
    try {
      var s = G.status();
      $('#inp-gemini-key').value = '';
      $('#inp-gemini-key').placeholder = s.hasKey ? s.masked : 'AIza...';
      $('#tg-gemini-remember').checked = !!s.remember;
      $('#sel-gemini-model').value = s.model || 'gemini-2.5-flash';
      $('#inp-gemini-proxy').value = s.proxy || '';
      var st = $('#gemini-status');
      st.className = 'modal-status' + (s.hasKey ? ' is-ok' : '');
      st.textContent = s.hasKey
        ? L('연결됨 · ' + s.masked + ' · 모델 ' + s.model, 'Connected · ' + s.masked + ' · model ' + s.model)
        : L('아직 저장된 키가 없습니다. 키 없이도 무료 맛보기 → 규칙 순서로 동작합니다.', 'No key saved yet. Without one, the app falls back to the free taste and then to rules.');
    } catch (e) { /* noop */ }
    var first = $('#inp-gemini-key');
    if (first) first.focus();
  }

  function closeGemini() {
    var modal = $('#gemini-modal');
    if (modal) modal.hidden = true;
  }

  function setGeminiStatus(text, kind) {
    var st = $('#gemini-status');
    if (!st) return;
    st.className = 'modal-status' + (kind ? ' is-' + kind : '');
    st.textContent = text;
  }

  function wireGemini() {
    on($('#btn-gemini'), 'click', openGemini);
    on($('#btn-gemini-close'), 'click', closeGemini);
    on($('#gemini-modal'), 'click', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close')) closeGemini();
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape') closeGemini();
    });
    on($('#btn-gemini-save'), 'click', function () {
      if (!G) return;
      var key = $('#inp-gemini-key').value.trim();
      var remember = $('#tg-gemini-remember').checked;
      if (key) G.setKey(key, remember);
      G.setModel($('#sel-gemini-model').value);
      G.setProxy($('#inp-gemini-proxy').value.trim());
      $('#inp-gemini-key').value = '';
      var s = G.status();
      $('#inp-gemini-key').placeholder = s.hasKey ? s.masked : 'AIza...';
      setGeminiStatus(s.hasKey
        ? L('저장했습니다 · ' + s.masked + ' · 모델 ' + s.model, 'Saved · ' + s.masked + ' · model ' + s.model)
        : L('키가 비어 있습니다. 키 없이도 무료 맛보기로 동작합니다.', 'The key is empty. The free taste still works.'), s.hasKey ? 'ok' : 'warn');
      if (s.hasKey) {
        log(L('Gemini 키 저장 · ' + s.model + (remember ? ' · 이 브라우저에 기억' : ' · 이 탭에서만'), 'Gemini key saved · ' + s.model + (remember ? ' · remembered' : ' · this tab only')), 'key');
        toast(L('Gemini 키를 저장했습니다.', 'Gemini key saved.'), '');
      }
      updateGeminiBadge();
    });
    on($('#btn-gemini-test'), 'click', function () {
      if (!G) return;
      if ($('#inp-gemini-key').value.trim()) {
        G.setKey($('#inp-gemini-key').value.trim(), $('#tg-gemini-remember').checked);
        G.setModel($('#sel-gemini-model').value);
        G.setProxy($('#inp-gemini-proxy').value.trim());
        $('#inp-gemini-key').value = '';
      }
      setGeminiStatus(L('연결을 확인하는 중…', 'Checking the connection…'));
      G.test().then(function (res) {
        if (res.ok) {
          setGeminiStatus(L('정상 · 모델 ' + res.model + ' 응답 확인', 'OK · model ' + res.model + ' replied'), 'ok');
          toast(L('Gemini 키가 정상 동작합니다.', 'The Gemini key works.'), '');
          log(L('Gemini 연결 확인 · ' + res.model, 'Gemini check · ' + res.model), 'key');
        } else {
          setGeminiStatus((res.message || res.reason) + (res.status ? ' (' + res.status + ')' : ''), 'warn');
          log(L('Gemini 연결 실패: ' + (res.message || res.reason), 'Gemini check failed: ' + (res.message || res.reason)), 'warn');
        }
        updateGeminiBadge();
      });
    });
    on($('#btn-gemini-clear'), 'click', function () {
      if (!G) return;
      G.clear();
      setGeminiStatus(L('키를 지웠습니다. 이 브라우저에 더 이상 남아 있지 않습니다.', 'Key removed. It is no longer stored in this browser.'), 'ok');
      $('#inp-gemini-key').placeholder = 'AIza...';
      updateGeminiBadge();
      log(L('Gemini 키 삭제', 'Gemini key cleared'), 'warn');
    });
    updateGeminiBadge();
  }

  function wireMisc() {
    on($('#btn-theme'), 'click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      syncThemeLabel();
      savePrefs();
      setTimeout(function () { drawPreview(true); }, 30);
    });
    on($('#btn-pro-badge'), 'click', function () { openPro(); });
    on($('#btn-clear-log'), 'click', function () { $('#log-list').innerHTML = ''; });
    on($('#btn-busy-cancel'), 'click', function () {
      if (busyState.cancel) busyState.cancel();
      hideBusy();
    });
    on(window, 'resize', function () {
      clearTimeout(window.__cropTimer);
      window.__cropTimer = setTimeout(function () { drawPreview(true); }, 120);
    });
    on(document, 'keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Space' && state.source) { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight' && state.source) { state.source.video.currentTime = Math.min(state.source.durationMs / 1000, state.source.video.currentTime + 2); state.dirty = true; }
      if (e.key === 'ArrowLeft' && state.source) { state.source.video.currentTime = Math.max(0, state.source.video.currentTime - 2); state.dirty = true; }
    });
    on($('#src-video'), 'timeupdate', function () {
      if (state.playMode === 'source') { state.dirty = true; requestTick(); }
    });
    on($('#src-video'), 'seeked', function () { state.dirty = true; requestTick(); });
    on($('#src-video'), 'loadeddata', function () { state.dirty = true; requestTick(); });
  }

  function wirePro() {
    if (Pro) {
      try {
        Pro.mountModal(null, {});
        Pro.subscribe && Pro.subscribe(function () { updateProBadge(); });
      } catch (e) { /* noop */ }
    }
    updateProBadge();
    setInterval(updateProBadge, 2500);
  }

  /* ── 편집 시트 ─────────────────────────────────────────── */
  function renderSheet() {
    var list = $('#sheet-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.clips.length) {
      list.appendChild(el('div', { class: 'empty-state' }, [el('p', { text: tr('아직 클립이 없습니다. 공장에서 원본을 분석하세요.') })]));
      $('#sheet-count').textContent = '0';
      return;
    }
    state.clips.forEach(function (clip, i) {
      var row = el('div', { class: 'sheet-row' + (clip.selected ? ' is-selected' : '') });
      var check = el('button', {
        type: 'button', class: 'clip-check', role: 'checkbox',
        'aria-checked': clip.selected ? 'true' : 'false', 'aria-label': '클립 ' + (i + 1) + ' 선택'
      });
      on(check, 'click', function () {
        clip.selected = !clip.selected;
        syncQueueWithSelection();
        renderSheet();
        renderClips();
        renderQueue();
      });
      var body = el('div');
      body.appendChild(el('div', { class: 'sheet-head' }, [
        el('span', { class: 'clip-index', text: 'CLIP ' + ('0' + (i + 1)).slice(-2) }),
        el('span', { class: 'clip-dur', text: tr((clip.durationMs / 1000).toFixed(1) + '초') }),
        el('span', { class: 'clip-range', text: C.clock(clip.startMs) + ' → ' + C.clock(clip.endMs) }),
        el('span', { class: 'clip-range', text: tr((clip.ranges || []).length + '구간') })
      ]));
      var fields = el('div', { class: 'sheet-fields' });
      var title = el('input', { type: 'text', value: clip.title || '', maxlength: '60', placeholder: '제목', 'aria-label': '제목' });
      var hook = el('input', { type: 'text', value: clip.hook || '', maxlength: '90', placeholder: '첫 2초 훅', 'aria-label': '훅' });
      var tags = el('input', { type: 'text', value: (clip.hashtags || []).join(' '), maxlength: '120', placeholder: '해시태그 (공백 구분)', 'aria-label': '해시태그' });
      on(title, 'input', function () { clip.title = title.value; renderClips(); renderQueue(); });
      on(hook, 'input', function () { clip.hook = hook.value; renderClips(); });
      on(tags, 'input', function () { clip.hashtags = C.normalizeTags(tags.value.split(/\s+/)); renderClips(); });
      fields.appendChild(el('label', {}, [el('span', { text: '제목' }), title]));
      fields.appendChild(el('label', {}, [el('span', { text: '훅' }), hook]));
      fields.appendChild(el('label', { class: 'wide' }, [el('span', { text: '해시태그' }), tags]));
      body.appendChild(fields);
      var actions = el('div', { class: 'sheet-actions' }, [
        el('button', { type: 'button', class: 'btn btn-soft', text: '미리보기', onclick: function () { setTab('factory'); previewClip(clip); } }),
        el('button', { type: 'button', class: 'btn btn-soft', text: 'AI 훅', onclick: function () { setTab('factory'); makeHook(clip); } }),
        el('button', { type: 'button', class: 'btn btn-soft', text: '렌더', onclick: function () { renderOne(clip); } })
      ]);
      body.appendChild(actions);
      row.appendChild(check);
      row.appendChild(body);
      list.appendChild(row);
    });
    $('#sheet-count').textContent = String(state.clips.length);
  }

  /* ── 시작 ─────────────────────────────────────────────── */
  function init() {
    var presets = $('#sel-preset');
    C.PRESETS.forEach(function (p) {
      presets.appendChild(el('option', { value: p.id, text: p.label + ' · ' + p.note }));
    });
    applyPrefs();
    refreshRanges();
    wireTabs();
    wireSource();
    wireAuto();
    wireScript();
    wireStory();
    wireDetect();
    wireReframe();
    wireCaption();
    wireCommentary();
    wireTransport();
    wireClips();
    wireQueue();
    wireSubtitles();
    wireBlog();
    wireRef();
    wireGemini();
    on($('#btn-gemini'), 'click', updateGeminiBadge);
    wireMisc();
    wirePro();
    setCues([], tr('자막 없음'));
    renderClips();
    renderQueue();
    renderStats();
    syncSeg();
    syncCaptionMode();
    renderCommentary();
    updateAiBadge();
    $('.monitor-out').classList.add('show-safe');

    var hash = (location.hash || '').replace('#', '');
    if (hash && ['factory', 'blog', 'clips', 'guide'].indexOf(hash) >= 0) setTab(hash, false);

    document.addEventListener('onetap:langchange', function () {
      try {
        syncSeg();
        syncCaptionMode();
        applyAutoLabels();
        buildThemeSeg();
        buildFilmSelects();
        renderClips();
        renderQueue();
        renderCues();
        renderCommentary();
        renderStory();
        renderSheet();
        renderBlogMeta();
        renderBlogThumbs();
        renderScenes();
        filmSyncTimeline();
        filmDraw(state.film.tMs);
        syncAutoButton();
        updateAiBadge();
        updateGeminiBadge();
        updateProBadge();
      } catch (e) { /* noop */ }
    });

    R.capability().then(function (cap) {
      state.cap = cap;
      var note = $('#cap-note');
      if (!note) return;
      if (cap.ok) {
        note.hidden = true;
        note.className = 'cap-note';
        note.textContent = '';
        $('#render-summary').textContent = 'H.264 · MP4 · ' + (cap.audioCodec === 'aac' ? 'AAC' : 'Opus') + ' 오디오 · 브라우저에서 인코딩';
      } else {
        note.hidden = false;
        note.className = 'cap-note warn';
        note.textContent = tr(cap.reason) + ' — ' + tr('Chrome 또는 Edge 최신 버전에서 열어 주세요.');
        $('#render-summary').textContent = tr('이 브라우저에서는 MP4 렌더를 쓸 수 없습니다.');
      }
      renderQueue();
    }).catch(function () {
      var note = $('#cap-note');
      if (note) { note.className = 'cap-note warn'; note.textContent = tr('인코더 확인에 실패했습니다. 그래도 분석·미리보기는 동작합니다.'); }
    });

    if (Free) Free.configure({ app: 'clip-factory' });
    updateAiBadge();
    log('공장 준비 완료 · 원본을 기다립니다');
    // 첫 화면에서 파형 영역이 비어 있지 않도록 안내선을 그린다.
    drawFallbackWave();
  }

  /* 검사(E2E)와 디버깅을 위한 읽기 전용 창구 — 비밀 값은 담지 않는다. */
  window.ClipFactoryApp = {
    version: '2.0.0',
    getFilm: function () {
      var f = state.film;
      return {
        article: f.article ? { title: f.article.title, paragraphs: f.article.paragraphs.length, images: f.article.images.length, via: f.article.via } : null,
        scenes: f.scenes.map(function (s) { return { headline: s.headline, sub: s.sub, caption: s.caption, imageQuery: s.imageQuery }; }),
        scriptSource: f.scriptSource,
        timeline: f.timeline.map(function (t) { return [t.startMs, t.endMs]; }),
        totalMs: f.totalMs,
        theme: filmTheme().id,
        styleId: f.styleId,
        preset: filmPreset().id,
        images: Object.keys(f.images).length,
        narration: Object.keys(f.narration).length,
        narrationNote: f.narrationNote,
        playing: f.playing,
        rendering: f.rendering,
        result: f.result ? { size: f.result.size, width: f.result.width, height: f.result.height, header: f.result.header, hasAudio: f.result.hasAudio, encodeMs: f.result.encodeMs } : null
      };
    },
    getAuto: function () {
      return { busy: state.auto.busy, steps: state.auto.steps, degraded: state.auto.degraded };
    },
    gemini: function () {
      try { return G.status(); } catch (e) { return { hasKey: false }; }
    },
    getState: function () {
      return {
        source: state.source ? {
          name: state.source.name, durationMs: state.source.durationMs,
          width: state.source.width, height: state.source.height, isDemo: state.source.isDemo,
          hasAudioBuffer: !!state.source.audioBuffer
        } : null,
        analysis: state.analysis ? {
          stats: state.analysis.stats,
          audio: state.analysis.audioBuffer ? {
            duration: state.analysis.audioBuffer.duration,
            channels: state.analysis.audioBuffer.numberOfChannels,
            sampleRate: state.analysis.audioBuffer.sampleRate,
            peak: (function () {
              var ch = state.analysis.audioBuffer.getChannelData(0);
              var mx = 0;
              for (var i = 0; i < ch.length; i += 50) { var a = Math.abs(ch[i]); if (a > mx) mx = a; }
              return Math.round(mx * 1000) / 1000;
            })()
          } : null,
          levels: state.analysis.levels ? state.analysis.levels.length : 0,
          diffs: C.sceneDiffs(state.analysis.frames).sort(function (a, b) { return b.score - a.score; }).slice(0, 8).map(function (d) {
            return { t: d.tMs, score: Math.round(d.score * 1000) / 1000, struct: Math.round(d.struct * 1000) / 1000,
              hist: Math.round(d.hist * 1000) / 1000, color: Math.round(d.color * 1000) / 1000 };
          }),
          silence: state.analysis.silence.regions.map(function (r) { return [r.startMs, r.endMs]; }),
          cuts: state.analysis.cuts.map(function (c) { return c.tMs; }),
          keep: state.analysis.keep.map(function (s) { return [s.startMs, s.endMs]; })
        } : null,
        clips: state.clips.map(function (c) {
          return {
            id: c.id, startMs: c.startMs, endMs: c.endMs, durationMs: c.durationMs,
            score: c.score, selected: c.selected, title: c.title,
            ranges: c.ranges.map(function (r) { return [r.startMs, r.endMs]; }),
            source: c.source || 'auto',
            commentary: c.commentaryCues ? c.commentaryCues.length : 0,
            commentarySource: c.commentarySource || '',
            rendered: c.rendered ? { size: c.rendered.size, width: c.rendered.width, height: c.rendered.height, encodeMs: c.rendered.encodeMs } : null
          };
        }),
        queue: state.queue.map(function (q) {
          return { clipId: q.clipId, status: q.status, progress: q.progress, error: q.error,
            size: q.result ? q.result.size : 0, header: q.result ? q.result.header : '' };
        }),
        cues: state.cues.length,
        captionMode: state.captionMode,
        commentaryStyle: state.commentaryStyle,
        activeClipId: state.activeClipId,
        commTexts: (function () {
          var c = activeClip();
          return c && c.commentaryCues ? c.commentaryCues.map(function (x) { return x.text; }) : [];
        })(),
        story: {
          segments: state.story.segments.length,
          source: state.story.source,
          busy: state.story.busy,
          withCommentary: state.story.segments.filter(function (s) { return s.commentaryCues && s.commentaryCues.length; }).length,
          spans: state.story.segments.map(function (s) { return [s.startMs, s.endMs]; })
        },
        playing: state.playing,
        playMode: state.playMode,
        mode: state.mode,
        styleId: state.styleId,
        thumbing: !!state.thumbing,
        auto: { busy: state.auto.busy, steps: state.auto.steps },
        filmScenes: state.film.scenes.length,
        cap: state.cap,
        rendering: state.rendering
      };
    },
    previewSignature: function () {
      var c = document.querySelector('#preview-canvas');
      if (!c) return 0;
      var d = c.toDataURL();
      var h = 2166136261;
      for (var i = 0; i < d.length; i += 3) { h ^= d.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
