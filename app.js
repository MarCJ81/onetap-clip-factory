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
    thumbing: false
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
    var node = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status' }, [text]);
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
      el('span', { text: text })
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
        detect: currentDetect()
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
      note.textContent = state.mode === 'subject' ? '피부톤 + 움직임 + 중앙 가중으로 크롭 중심을 부드럽게 따라갑니다.'
        : state.mode === 'motion' ? '화면에서 가장 많이 움직이는 쪽을 따라갑니다. 손·제품 클로즈업에 유리합니다.'
          : '크롭을 가운데에 고정합니다. 화면이 안정적일 때 가장 깔끔합니다.';
    }
    var chip = $('#out-mode');
    if (chip) chip.textContent = state.mode === 'subject' ? '피사체 추적' : state.mode === 'motion' ? '움직임 추적' : '중앙 고정';
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
    if (label) label.textContent = text;
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
      $('#wave-state').textContent = state.analysis ? '소리 없음 · 파형 없음' : '원본 없음';
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
    $('#wave-state').textContent = C.clock(durationMs) + ' · ' + C.bytes(state.source ? state.source.blob.size : 0);
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
      $('#wave-meta').textContent = '표본 ' + peaks.length + ' · ' + Math.round(step) + 'ms';
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
        title: '죽은 초 ' + C.clock(r.durMs)
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
      cuts.appendChild(el('div', { class: 'cut-line', style: { left: (cut.tMs / dur) * 100 + '%' }, title: '장면 컷 ' + C.clock(cut.tMs) }));
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
        el('span', { class: 'clip-dur', text: (clip.durationMs / 1000).toFixed(1) + '초' }),
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
        return el('span', { class: 'clip-tag' + (t ? '' : ' empty'), text: t ? '#' + t : '#태그 없음' });
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
          text: '해설 자막 ' + clip.commentaryCues.length + '줄 · ' +
            (clip.commentarySource === 'ai' ? 'AI' : clip.commentarySource === 'mixed' ? 'AI+초안' : '자막 초안')
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
      v.muted = true;
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
    $('#out-crop').textContent = '크롭 ' + Math.round(rect.w) + '×' + Math.round(rect.h);
  }

  /* ── 통계·타임라인 ─────────────────────────────────────── */
  function renderStats() {
    var a = state.analysis;
    var s = a ? a.stats : null;
    $('#tick-source').textContent = state.source ? C.clock(state.source.durationMs) : '—';
    $('#tick-speech').textContent = s ? C.clock(s.speechMs) : '—';
    $('#tick-cuts').textContent = s ? s.cutCount + '곳' : '—';
    $('#tick-clips').textContent = state.clips.length ? state.clips.length + '개' : '—';
    var done = state.queue.filter(function (q) { return q.status === 'done'; }).length;
    $('#tick-queue').textContent = done + ' / ' + state.queue.length;
    var detectSummary = $('#detect-summary');
    if (detectSummary) {
      if (!s) detectSummary.textContent = '원본을 넣으면 자동으로 분석합니다.';
      else {
        var sil = a.silence.regions.length;
        detectSummary.textContent = '무음 ' + C.clock(a.silence.silentMs) + ' (' + sil + '곳) · 컷 ' + s.cutCount +
          '곳 · 말소리 ' + C.clock(s.speechMs) + ' · 클립 ' + state.clips.length + '개';
      }
    }
    var tlMeta = $('#tl-meta');
    if (tlMeta) tlMeta.textContent = state.source ? C.clock(state.source.durationMs) + ' · ' + (s ? s.samples : 0) + ' 표본' : '—';
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
      var statusText = q.status === 'done' ? '완료 · H.264 MP4' : q.status === 'rendering' ? '렌더 중 ' + Math.round(q.progress * 100) + '%'
        : q.status === 'error' ? '실패: ' + q.error : q.status === 'canceled' ? '취소됨' : '대기';
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
    zipBtn.textContent = '완료된 클립 ' + done + '개 ZIP으로 받기';
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
    $('#render-summary').textContent = '렌더 중… 0 / ' + total;

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
          $('#render-summary').textContent = '렌더 중… ' + (doneCount + 1) + ' / ' + total + ' · ' + Math.round(p.progress * 100) + '%';
          var elBar = document.querySelector('.queue-item.is-rendering .queue-bar i');
          if (elBar) elBar.style.width = Math.round(p.progress * 100) + '%';
          var st = document.querySelector('.queue-item.is-rendering .queue-status');
          if (st) st.textContent = '렌더 중 ' + Math.round(p.progress * 100) + '%';
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
      $('#render-summary').textContent = done ? '완료 ' + done + '개 · H.264 MP4 · 브라우저에서 인코딩' : '렌더할 클립을 선택하세요';
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
      $('#cue-count').textContent = '0 큐';
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
    $('#cue-count').textContent = state.cues.length + ' 큐';
    var status = $('#cue-status');
    if (status) status.textContent = state.cues.length + ' 큐 · 클릭해서 타임코드 수정';
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
      run.textContent = state.story.busy ? '자막을 읽는 중…' : (n ? 'AI 스토리 구간 찾기 · 자막 ' + n + '줄' : 'AI 스토리 구간 찾기');
    }
    var sub = $('#story-sub-state');
    if (sub) {
      sub.textContent = n
        ? C.clock(state.cues[state.cues.length - 1].endMs) + '까지 ' + n + '줄'
        : '자막 없음';
    }
  }

  function setStoryStatus(text, kind) {
    var node = $('#story-status');
    if (!node) return;
    node.textContent = text;
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
    if (applyBtn) applyBtn.textContent = '추천 ' + chosen + '개 클립으로 담기';
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
      body.appendChild(el('strong', { class: 'story-title', text: seg.title || '제목 없음' }));
      if (seg.hook) body.appendChild(el('p', { class: 'story-hook', text: '훅 · ' + seg.hook }));
      if (seg.reason) body.appendChild(el('p', { class: 'story-reason', text: seg.reason }));
      if (seg.commentaryCues && seg.commentaryCues.length) {
        body.appendChild(el('p', { class: 'story-comm', text: '해설 ' + seg.commentaryCues.length + '줄 · ' + seg.commentaryCues[0].text }));
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
    if (tag) tag.textContent = source === 'pro' ? 'AI · ' + (provider || 'Pro') : source === 'free' ? 'AI · 무료' : '로컬 규칙';
    var count = state.story.segments.length;
    if (count) {
      var label = source === 'pro' ? 'AI(' + (provider || 'Pro') + ')' : source === 'free' ? '무료 AI 맛보기' : '로컬 규칙(자막 휴리스틱)';
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
      if (head) head.textContent = '클립 없음';
      if (countEl) countEl.textContent = '0 큐';
      host.appendChild(el('div', { class: 'empty-state small' }, [el('p', { text: '먼저 클립을 만드세요.' })]));
      return;
    }
    if (head) head.textContent = 'CLIP ' + ('0' + (state.clips.indexOf(clip) + 1)).slice(-2) + ' · ' + (clip.title || '제목 없음');
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
    if (countEl) countEl.textContent = cues.length + ' 큐';
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
    box.appendChild(el('strong', { text: result.title || '제목 없음' }));
    if (result.hook) box.appendChild(el('p', { text: result.hook }));
    if (result.hashtags && result.hashtags.length) {
      box.appendChild(el('div', { class: 'ai-tags' }, result.hashtags.map(function (t) { return el('span', { class: 'clip-tag', text: '#' + t }); })));
    }
    box.appendChild(el('span', { class: 'ai-meta', text: (mode === 'pro' ? 'Pro · ' + (provider || '연결됨') : '무료 맛보기') + ' · 카드에 적용됨' }));
    host.appendChild(box);
  }

  function showAiError(msg, res) {
    var host = $('#ai-out');
    if (!host) return;
    host.innerHTML = '';
    var box = el('div', { class: 'ai-card' });
    box.appendChild(el('h4', { text: '훅을 만들지 못했습니다' }));
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
      host.appendChild(el('p', { class: 'ai-placeholder', text: '클립 ' + (state.clips.indexOf(clip) + 1) + '의 자막으로 훅을 만드는 중…' }));
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
      badge.textContent = Free && Free.badgeText ? Free.badgeText(null) : '무료 맛보기';
    } catch (e) { badge.textContent = '무료 맛보기'; }
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
    label.textContent = connected ? 'Pro · ' + providerName : '무료 모드';
    b.title = connected ? 'Pro 연결됨 · 클릭해서 관리' : '무료 모드 · 클릭해서 API 연결';
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
    $('#src-tc').textContent = C.timecode(state.source ? state.source.video.currentTime * 1000 : 0, 30);
    if (state.source) {
      $('#phone-live').hidden = false;
      $('#src-audio').textContent = state.analysis ? (state.analysis.audioBuffer ? 'AUDIO 2ch · ' + Math.round(state.analysis.audioBuffer.sampleRate / 1000) + 'kHz' : 'AUDIO 없음') : 'AUDIO —';
    }
    updateTicks();
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
          text: style.id === 'yellow' ? '가나다' : style.id === 'white' ? '가나다' : style.id === 'box' ? '가나다' : '키커',
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
      list.appendChild(el('div', { class: 'empty-state' }, [el('p', { text: '아직 클립이 없습니다. 공장에서 원본을 분석하세요.' })]));
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
        el('span', { class: 'clip-dur', text: (clip.durationMs / 1000).toFixed(1) + '초' }),
        el('span', { class: 'clip-range', text: C.clock(clip.startMs) + ' → ' + C.clock(clip.endMs) }),
        el('span', { class: 'clip-range', text: (clip.ranges || []).length + '구간' })
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
    wireStory();
    wireDetect();
    wireReframe();
    wireCaption();
    wireCommentary();
    wireTransport();
    wireClips();
    wireQueue();
    wireSubtitles();
    wireMisc();
    wirePro();
    setCues([], '자막 없음');
    renderClips();
    renderQueue();
    renderStats();
    syncSeg();
    syncCaptionMode();
    renderCommentary();
    updateAiBadge();
    $('.monitor-out').classList.add('show-safe');

    var hash = (location.hash || '').replace('#', '');
    if (hash && ['factory', 'clips', 'guide'].indexOf(hash) >= 0) setTab(hash, false);

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
        note.textContent = cap.reason + ' — Chrome 또는 Edge 최신 버전에서 열어 주세요.';
        $('#render-summary').textContent = '이 브라우저에서는 MP4 렌더를 쓸 수 없습니다.';
      }
      renderQueue();
    }).catch(function () {
      var note = $('#cap-note');
      if (note) { note.className = 'cap-note warn'; note.textContent = '인코더 확인에 실패했습니다. 그래도 분석·미리보기는 동작합니다.'; }
    });

    if (Free) Free.configure({ app: 'clip-factory' });
    updateAiBadge();
    log('공장 준비 완료 · 원본을 기다립니다');
    // 첫 화면에서 파형 영역이 비어 있지 않도록 안내선을 그린다.
    drawFallbackWave();
  }

  /* 검사(E2E)와 디버깅을 위한 읽기 전용 창구 — 비밀 값은 담지 않는다. */
  window.ClipFactoryApp = {
    version: '1.1.0',
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
