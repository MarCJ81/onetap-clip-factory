/* ============================================================
   원탭 클립 팩토리 · media.js
   ------------------------------------------------------------
   원본을 읽고 재는 일만 한다. (화면은 app.js)
     · 파일 열기 · 길이/해상도 확인
     · Web Audio 로 소리 봉투 · 무음 구간
     · Canvas 표본 프레임으로 장면 컷 후보 · 피부톤/움직임 열 지도
     · 클립별 9:16 크롭 추적 곡선 · 썸네일
   모든 계산은 브라우저 메모리 안에서 끝난다. 파일은 전송되지 않는다.
   ============================================================ */
(function (root) {
  'use strict';

  var C = root.ClipCore;
  var STEP_MS = 20;
  var STAT_W = 128;
  var STAT_H = 72;
  var COLS = 64;
  var TRACK_FPS = 6;
  var TRACK_MAX = 96;

  function seekTo(video, seconds, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!video) { reject(new Error('비디오가 없습니다.')); return; }
      var dur = isFinite(video.duration) && video.duration > 0 ? video.duration : seconds + 1;
      var target = Math.max(0, Math.min(dur - 0.02, seconds));
      if (Math.abs(video.currentTime - target) < 0.004 && video.readyState >= 2) { resolve(target); return; }
      var done = false;
      var timer = setTimeout(function () { finish(new Error('탐색 시간 초과')); }, timeoutMs || 6000);
      function cleanup() {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      }
      function finish(err) {
        if (done) return;
        done = true;
        cleanup();
        if (err) reject(err); else resolve(target);
      }
      function onSeeked() { finish(null); }
      function onError() { finish(new Error('영상을 읽지 못했습니다.')); }
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      try { video.currentTime = target; } catch (e) { finish(e); }
    });
  }

  function waitMeta(video) {
    return new Promise(function (resolve, reject) {
      if (video.readyState >= 1 && video.duration) { resolve(video); return; }
      var timer = setTimeout(function () { finish(new Error('영상 정보를 읽지 못했습니다. 형식을 확인해 주세요.')); }, 15000);
      function cleanup() {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onErr);
      }
      function finish(err) {
        cleanup();
        if (err) reject(err); else resolve(video);
      }
      function onMeta() { finish(null); }
      function onErr() { finish(new Error('이 브라우저가 이 영상을 디코딩하지 못합니다.')); }
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('error', onErr);
    });
  }

  function probe(url) {
    var video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    return waitMeta(video).then(function () {
      return {
        video: video,
        durationMs: Math.max(0, Math.round((video.duration || 0) * 1000)),
        width: video.videoWidth || 0,
        height: video.videoHeight || 0
      };
    });
  }

  function nativeDecode(blob) {
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return Promise.resolve(null);
    var ctx;
    try { ctx = new Ctx(); } catch (e) { return Promise.resolve(null); }
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      try { ctx.close(); } catch (e) { /* noop */ }
    }
    return blob.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve) {
        try {
          var p = ctx.decodeAudioData(buf, function (b) { resolve(b); }, function () { resolve(null); });
          if (p && typeof p.then === 'function') p.then(resolve, function () { resolve(null); });
        } catch (e) { resolve(null); }
      });
    }).then(function (buffer) {
      close();
      return buffer;
    }).catch(function () { close(); return null; });
  }

  /** decodeAudioData 가 못 읽는 컨테이너(예: MP4+Opus)는 mediabunny로 직접 푼다. */
  function mediabunnyDecode(blob) {
    return import('./assets/vendor/mediabunny.min.mjs').then(function (mb) {
      var input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
      return input.getPrimaryAudioTrack().then(function (track) {
        if (!track) return null;
        var sink = new mb.AudioBufferSink(track);
        var chunks = [];
        var sampleRate = 0;
        var channels = 0;
        var totalFrames = 0;
        var iterator = sink.buffers();
        function pump() {
          return iterator.next().then(function (r) {
            if (r.done) return null;
            var v = r.value;
            if (v && v.buffer && v.buffer.length) {
              sampleRate = v.buffer.sampleRate || sampleRate;
              channels = Math.max(channels, v.buffer.numberOfChannels);
              var startFrame = Math.round((v.timestamp || 0) * sampleRate);
              chunks.push({ start: startFrame, buffer: v.buffer });
              totalFrames = Math.max(totalFrames, startFrame + v.buffer.length);
            }
            return pump();
          });
        }
        return pump().then(function () {
          if (!chunks.length || !sampleRate || !channels) return null;
          var out = null;
          try {
            out = new AudioBuffer({ numberOfChannels: channels, length: totalFrames, sampleRate: sampleRate });
          } catch (e) {
            var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
            out = new Ctx(1, 1, sampleRate).createBuffer(channels, totalFrames, sampleRate);
          }
          chunks.forEach(function (ch) {
            for (var c = 0; c < channels; c++) {
              var src = ch.buffer.getChannelData(Math.min(c, ch.buffer.numberOfChannels - 1));
              out.getChannelData(c).set(src, ch.start);
            }
          });
          return out;
        });
      });
    });
  }

  function loadAudio(blob) {
    if (!blob || !blob.size) return Promise.resolve(null);
    return nativeDecode(blob).then(function (buffer) {
      if (buffer) return buffer;
      return mediabunnyDecode(blob).catch(function () { return null; });
    });
  }

  function statsCanvas() {
    var canvas = document.createElement('canvas');
    canvas.width = STAT_W;
    canvas.height = STAT_H;
    var ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    return { canvas: canvas, ctx: ctx };
  }

  /** 한 프레임 → 밝기 히스토그램 · 피부톤 열 · 움직임 열 */
  function frameStats(video, sc, prev) {
    var ctx = sc.ctx;
    ctx.drawImage(video, 0, 0, STAT_W, STAT_H);
    var data = ctx.getImageData(0, 0, STAT_W, STAT_H).data;
    var hist = new Array(24).fill(0);
    var lum = 0;
    var rSum = 0, gSum = 0, bSum = 0;
    var skin = new Float32Array(COLS);
    var motion = new Float32Array(COLS);
    var colW = STAT_W / COLS;
    var prevLum = prev || null;
    var motionAcc = 0;
    var count = 0;

    for (var y = 0; y < STAT_H; y++) {
      for (var x = 0; x < STAT_W; x++) {
        var i = (y * STAT_W + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lum += l;
        rSum += r; gSum += g; bSum += b;
        hist[Math.min(15, l >> 4)] += 1;
        var col = Math.min(COLS - 1, Math.floor(x / colW));
        /* YCbCr 피부톤 (조명 차이를 흡수하는 넓은 창) */
        var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (l > 40 && cb >= 76 && cb <= 130 && cr >= 132 && cr <= 178) skin[col] += 1;
        /* 색조도 히스토그램에 넣는다 — 밝기가 비슷한 다른 장면을 구분하기 위해 */
        hist[16 + Math.min(7, Math.max(0, Math.floor((cb - 76) / 8)))] += 1;
        if (prevLum) {
          var d = Math.abs(l - prevLum[y * STAT_W + x]);
          motion[col] += d;
          motionAcc += d;
        }
        count++;
      }
    }
    var total = Math.max(1, count);
    for (var c = 0; c < COLS; c++) {
      skin[c] = skin[c] / (total / COLS);
      motion[c] = motion[c] / (total / COLS) / 255;
    }
    var lumSum = 0;
    for (var hb = 0; hb < 16; hb++) lumSum += hist[hb];
    lumSum = lumSum || 1;
    for (var hb2 = 0; hb2 < 16; hb2++) hist[hb2] = hist[hb2] / lumSum;
    var chromaSum = 0;
    for (var hb3 = 16; hb3 < 24; hb3++) chromaSum += hist[hb3];
    chromaSum = chromaSum || 1;
    for (var hb4 = 16; hb4 < 24; hb4++) hist[hb4] = hist[hb4] / chromaSum;
    var lumaGrid = new Float32Array(STAT_W * STAT_H);
    for (var yy = 0; yy < STAT_H; yy++) {
      for (var xx = 0; xx < STAT_W; xx++) {
        var ii = (yy * STAT_W + xx) * 4;
        lumaGrid[yy * STAT_W + xx] = 0.2126 * data[ii] + 0.7152 * data[ii + 1] + 0.0722 * data[ii + 2];
      }
    }
    /* 16×9 구조 서명 — 장면이 바뀌면 형태가 달라진다 */
    var sig = new Float32Array(16 * 9);
    for (var sy = 0; sy < 9; sy++) {
      for (var sx = 0; sx < 16; sx++) {
        var acc2 = 0;
        for (var by = 0; by < 8; by++) {
          for (var bx = 0; bx < 8; bx++) {
            acc2 += lumaGrid[(sy * 8 + by) * STAT_W + (sx * 8 + bx)];
          }
        }
        sig[sy * 16 + sx] = acc2 / 64 / 255;
      }
    }
    return {
      lum: (lum / total) / 255,
      color: [rSum / total / 255, gSum / total / 255, bSum / total / 255],
      hist: hist,
      sig: sig,
      skin: skin,
      motion: motion,
      motionScore: Math.min(1, (motionAcc / total) / 40),
      lumaGrid: lumaGrid
    };
  }

  function sampleFrames(video, times, onProgress, signal) {
    var sc = statsCanvas();
    var out = [];
    var prev = null;
    var i = 0;
    function step() {
      if (signal && signal.cancelled) return Promise.reject(new Error('canceled'));
      if (i >= times.length) return Promise.resolve(out);
      var t = times[i] / 1000;
      return seekTo(video, t).then(function () {
        var st = frameStats(video, sc, prev);
        prev = st.lumaGrid;
        out.push({ tMs: times[i], lum: st.lum, color: st.color, hist: st.hist, sig: st.sig, skin: st.skin, motion: st.motion, motionScore: st.motionScore });
        i++;
        if (onProgress) onProgress(i / times.length, times[i]);
        return step();
      });
    }
    return step();
  }

  /** 클립 안쪽을 촘촘히 훑어 크롭 중심 곡선을 만든다. */
  function sampleTrack(video, clip, onProgress, signal) {
    var fps = TRACK_FPS;
    var span = Math.max(1, clip.durationMs);
    var count = Math.min(TRACK_MAX, Math.max(6, Math.round((span / 1000) * fps)));
    var times = [];
    for (var i = 0; i < count; i++) {
      times.push(clip.startMs + Math.round((span * i) / Math.max(1, count - 1)));
    }
    var sc = statsCanvas();
    var points = [];
    var frames = [];
    var idx = 0;
    var prev = null;
    function step() {
      if (signal && signal.cancelled) return Promise.reject(new Error('canceled'));
      if (idx >= times.length) return Promise.resolve({ points: points, frames: frames });
      return seekTo(video, times[idx] / 1000).then(function () {
        var st = frameStats(video, sc, prev);
        prev = st.lumaGrid;
        frames.push({ tMs: times[idx], skin: st.skin, motion: st.motion, motionScore: st.motionScore });
        points.push({ tMs: times[idx], x: C.trackCenter({ skin: st.skin, motion: st.motion }, 'subject') });
        idx++;
        if (onProgress) onProgress(idx / times.length);
        return step();
      });
    }
    return step();
  }

  function thumb(video, tMs) {
    var canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 108;
    var ctx = canvas.getContext('2d');
    return seekTo(video, tMs / 1000).then(function () {
      var vw = video.videoWidth || 16, vh = video.videoHeight || 9;
      var scale = Math.min(canvas.width / vw, canvas.height / vh);
      var dw = vw * scale, dh = vh * scale;
      ctx.fillStyle = '#05070A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      try { return canvas.toDataURL('image/jpeg', 0.62); } catch (e) { return ''; }
    }).catch(function () { return ''; });
  }

  /* ── 전체 분석 ─────────────────────────────────────────── */
  function analyze(opts) {
    var o = opts || {};
    var video = o.video;
    var blob = o.blob;
    var durationMs = o.durationMs;
    var detect = o.detect || {};
    var onProgress = o.onProgress || function () {};
    var signal = o.signal || {};
    var t0 = performance.now();
    var audioBuffer = null;
    var levels = null;
    var silence = { regions: [], silentMs: 0, speechMs: durationMs, totalMs: durationMs, threshold: detect.silenceDb };
    var keep = [{ startMs: 0, endMs: durationMs, durMs: durationMs }];

    onProgress({ phase: 'audio', progress: 0.04, label: '소리를 읽는 중…' });
    var audioTask = o.audioBuffer ? Promise.resolve(o.audioBuffer) : loadAudio(blob);
    return audioTask.then(function (buffer) {
      audioBuffer = buffer;
      if (buffer) {
        var chans = [];
        for (var ci = 0; ci < buffer.numberOfChannels; ci++) chans.push(buffer.getChannelData(ci));
        levels = C.envelopeOfChannels(chans, buffer.sampleRate, STEP_MS);
        silence = C.detectSilence(levels, STEP_MS, {
          silenceDb: detect.silenceDb,
          minSilenceMs: detect.minSilenceMs
        });
        if (detect.removeSilence !== false) {
          keep = C.mergeSegments(C.keepSegments(silence.regions, durationMs, detect.padMs), 140);
        }
      }
      onProgress({ phase: 'frames', progress: 0.14, label: '장면을 표본으로 훑는 중…' });
      var times = C.sampleTimes(durationMs, 260, 220);
      return sampleFrames(video, times, function (p) {
        onProgress({ phase: 'frames', progress: 0.14 + 0.44 * p, label: '장면 표본 ' + Math.round(p * 100) + '%' });
      }, signal);
    }).then(function (frames) {
      var cuts = C.sceneCuts(frames, detect.sceneSensitivity);
      var clips = C.planClips(keep, {
        targetMs: detect.targetClipMs,
        minMs: detect.minClipMs,
        maxMs: detect.maxClipMs
      });
      clips = C.snapClips(clips, cuts, 1300);
      clips = C.scoreClips(clips, { frames: frames.map(function (f) { return { tMs: f.tMs, motion: f.motionScore }; }), segments: keep, cuts: cuts, targetMs: detect.targetClipMs });
      clips = C.pickHighlights(clips, detect.clipCount);

      var tracks = {};
      var thumbs = {};
      var list = clips.slice(0, 10);
      var i = 0;
      function trackStep() {
        if (signal.cancelled) return Promise.reject(new Error('canceled'));
        if (i >= list.length) return Promise.resolve();
        var clip = list[i];
        return sampleTrack(video, clip, function (p) {
          onProgress({
            phase: 'track',
            progress: 0.6 + 0.34 * ((i + p) / Math.max(1, list.length)),
            label: '클립 ' + (i + 1) + ' 추적 곡선 ' + Math.round(p * 100) + '%'
          });
        }, signal).then(function (res) {
          var smooth = o.smooth === undefined ? 0.72 : o.smooth;
          tracks[clip.id] = {
            curve: C.buildCurve(res.points, { smooth: smooth, maxStep: 0.055 }),
            frames: res.frames,
            points: res.points
          };
          return thumb(video, clip.startMs + clip.durationMs * 0.35);
        }).then(function (dataUrl) {
          thumbs[clip.id] = dataUrl;
          i++;
          return trackStep();
        });
      }

      return trackStep().then(function () {
        onProgress({ phase: 'done', progress: 1, label: '분석 완료' });
        return {
          audioBuffer: audioBuffer,
          levels: levels,
          stepMs: STEP_MS,
          silence: silence,
          keep: keep,
          frames: frames,
          cuts: cuts,
          clips: clips,
          tracks: tracks,
          thumbs: thumbs,
          stats: {
            durationMs: durationMs,
            speechMs: C.totalDuration(keep),
            silentMs: silence.silentMs,
            cutCount: cuts.length,
            clipCount: clips.length,
            analysisMs: Math.round(performance.now() - t0),
            samples: frames.length
          }
        };
      });
    });
  }

  /** 다시 감지(설정 변경) — 이미 읽은 소리/프레임으로 즉시 재계획. */
  function replan(analysis, detect) {
    var durationMs = analysis.stats.durationMs;
    var keep = analysis.keep;
    /* 감도 슬라이더도 즉시 반영한다 — 이미 읽은 표본으로 컷을 다시 계산 */
    analysis.cuts = C.sceneCuts(analysis.frames, detect.sceneSensitivity);
    if (detect.removeSilence !== false && analysis.levels) {
      var silence = C.detectSilence(analysis.levels, analysis.stepMs, {
        silenceDb: detect.silenceDb,
        minSilenceMs: detect.minSilenceMs
      });
      keep = C.mergeSegments(C.keepSegments(silence.regions, durationMs, detect.padMs), 140);
      analysis.silence = silence;
    } else {
      keep = [{ startMs: 0, endMs: durationMs, durMs: durationMs }];
      analysis.silence = { regions: [], silentMs: 0, speechMs: durationMs, totalMs: durationMs, threshold: detect.silenceDb };
    }
    analysis.keep = keep;
    var clips = C.planClips(keep, {
      targetMs: detect.targetClipMs,
      minMs: detect.minClipMs,
      maxMs: detect.maxClipMs
    });
    clips = C.snapClips(clips, analysis.cuts, 1300);
    clips = C.scoreClips(clips, {
      frames: analysis.frames.map(function (f) { return { tMs: f.tMs, motion: f.motionScore }; }),
      segments: keep, cuts: analysis.cuts, targetMs: detect.targetClipMs
    });
    clips = C.pickHighlights(clips, detect.clipCount);
    analysis.clips = clips;
    analysis.stats.speechMs = C.totalDuration(keep);
    analysis.stats.silentMs = analysis.silence.silentMs;
    analysis.stats.clipCount = clips.length;
    return analysis;
  }

  /** 미리보기용: 현재 시각의 크롭 위치 */
  function cropForClip(clip, tMs, mode, smooth, zoom, srcW, srcH, outW, outH, track) {
    var curve = track && track.curve ? track.curve : [];
    var x = mode === 'center' ? 0.5 : C.curveAt(curve, tMs);
    if (mode === 'center') x = 0.5;
    return C.cropRect(srcW, srcH, outW, outH, x, zoom);
  }

  root.ClipMedia = {
    STEP_MS: STEP_MS,
    seekTo: seekTo,
    waitMeta: waitMeta,
    probe: probe,
    loadAudio: loadAudio,
    sampleFrames: sampleFrames,
    sampleTrack: sampleTrack,
    thumb: thumb,
    analyze: analyze,
    replan: replan,
    cropForClip: cropForClip
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
