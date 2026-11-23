/* ============================================================
   원탭 클립 팩토리 · render.js
   ------------------------------------------------------------
   실제 파일을 만드는 층.
     · 9:16 캔버스에 원본 프레임을 크롭·리프레임해 그린다
     · 자막은 미리보기와 같은 함수로 굽는다 (WYSIWYG)
     · WebCodecs H.264 + mediabunny 로 MP4 컨테이너에 먹싱한다
     · 여러 클립을 ZIP 으로 묶는다 (JSZip, 로컬)
   미리보기(app.js)도 이 파일의 drawFrame/drawCaption 을 그대로 쓴다.
   ============================================================ */
(function (root) {
  'use strict';

  var C = root.ClipCore;
  var MB = { module: null, promise: null, cap: null };

  function loadMediabunny() {
    if (MB.module) return Promise.resolve(MB.module);
    if (MB.promise) return MB.promise;
    MB.promise = import('./assets/vendor/mediabunny.min.mjs').then(function (mod) {
      MB.module = mod;
      return mod;
    });
    return MB.promise;
  }

  function capability() {
    if (MB.cap) return Promise.resolve(MB.cap);
    if (!root.VideoEncoder || !root.AudioEncoder) {
      MB.cap = { ok: false, reason: '이 브라우저에는 WebCodecs 인코더가 없습니다(Chrome·Edge 최신 권장).' };
      return Promise.resolve(MB.cap);
    }
    return loadMediabunny().then(function (mb) {
      return mb.canEncodeVideo('avc').then(function (avc) {
        if (!avc) {
          MB.cap = { ok: false, reason: '이 브라우저의 H.264 인코더를 쓸 수 없습니다.' };
          return MB.cap;
        }
        return mb.canEncodeAudio('aac').then(function (aac) {
          MB.cap = { ok: true, videoCodec: 'avc', audioCodec: aac ? 'aac' : 'opus', audioNote: aac ? 'AAC' : 'Opus(H.264는 그대로)' };
          return MB.cap;
        });
      });
    }).catch(function (e) {
      MB.cap = { ok: false, reason: (e && e.message) || 'mediabunny 로드 실패' };
      return MB.cap;
    });
  }

  /* ── 프레임 매핑: 무음이 빠진 클립 타임라인 ───────────── */
  /** 클립 안 출력 시각(ms) → 원본 시각(ms) */
  function sourceTimeAt(clip, localMs) {
    var ranges = clip.ranges || [];
    if (!ranges.length) return clip.startMs + localMs;
    var acc = 0;
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (localMs < acc + r.durMs) return r.startMs + (localMs - acc);
      acc += r.durMs;
    }
    var last = ranges[ranges.length - 1];
    return last.endMs;
  }

  /** 원본 시각(ms) → 클립 안 출력 시각(ms). 구간 사이(죽은 초)는 null. */
  function localTimeAt(clip, srcMs) {
    var ranges = clip.ranges || [];
    var acc = 0;
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (srcMs >= r.startMs && srcMs <= r.endMs) return acc + (srcMs - r.startMs);
      acc += r.durMs;
    }
    return null;
  }

  /** 전체 타임라인 자막 → 이 클립의 출력 타임라인 자막 */
  function mapCues(clip, cues) {
    var out = [];
    (cues || []).forEach(function (cue) {
      var ranges = clip.ranges || [];
      var mapped = [];
      ranges.forEach(function (r) {
        var s = Math.max(cue.startMs, r.startMs);
        var e = Math.min(cue.endMs, r.endMs);
        if (e - s < 80) return;
        var localStart = localTimeAt(clip, s);
        if (localStart === null) return;
        mapped.push({ startMs: localStart, endMs: localStart + (e - s), text: cue.text });
      });
      /* 한 큐가 두 구간에 걸치면 앞 구간만 쓴다(문장이 잘게 쪼개지는 것 방지) */
      if (mapped.length) out.push(mapped[0]);
    });
    return out.sort(function (a, b) { return a.startMs - b.startMs; });
  }

  /* ── 자막 그리기 (미리보기·렌더 공용) ─────────────────── */
  function drawCaption(ctx, opts) {
    var text = opts && opts.text;
    if (!text) return;
    var w = opts.w, h = opts.h;
    var style = opts.style || C.CAPTION_STYLES[0];
    var fs = Math.round(h * style.size);
    var maxChars = Math.max(6, Math.floor(w / (fs * 0.94)));
    var lines = C.wrapCaption(text, maxChars, 2);
    if (!lines.length) return;

    ctx.save();
    ctx.textAlign = style.id === 'kicker' ? 'left' : 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '900 ' + fs + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
    var lh = fs * (style.lineGap || 1.14);
    var pad = Math.round(fs * 0.3);
    var widest = 0;
    lines.forEach(function (l) {
      var m = ctx.measureText(l).width;
      if (m > widest) widest = m;
    });

    var blockH = lines.length * lh;
    var baseY;
    if (style.pos === 'center') baseY = h * 0.5 - blockH / 2 + fs * 0.82;
    else baseY = h * 0.80 - (lines.length - 1) * lh;

    if (style.box) {
      var boxW = widest + pad * 2;
      var boxX = style.id === 'kicker' ? w * 0.07 : (w - boxW) / 2;
      var boxY = baseY - fs * 0.92 - (lines.length - 1) * 0;
      var boxH = blockH + pad * 1.1;
      ctx.fillStyle = style.box;
      rounded(ctx, boxX, boxY - pad * 0.2, boxW, boxH, Math.round(fs * 0.14));
      ctx.fill();
      ctx.textAlign = 'left';
    }

    lines.forEach(function (line, i) {
      var y = baseY + i * lh;
      var x = style.id === 'kicker' ? w * 0.07 + pad : w / 2;
      if (style.stroke) {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(4, Math.round(fs * 0.13));
        ctx.strokeStyle = style.stroke;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = style.fill;
      ctx.fillText(line, x, y);
    });
    ctx.restore();
  }

  function rounded(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ── 9:16 프레임 그리기 (미리보기·렌더 공용) ─────────── */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o {video, clip, track, localMs, outW, outH, mode, zoom, cues, captionOn, style}
   */
  function drawFrame(ctx, o) {
    var cw = o.outW, ch = o.outH;
    var srcW = o.video.videoWidth || 16, srcH = o.video.videoHeight || 9;
    var localMs = o.localMs;
    var curve = o.track && o.track.curve ? o.track.curve : [];
    var centerX = o.mode === 'center' ? 0.5 : C.curveAt(curve, sourceTimeAt(o.clip, localMs));
    var rect = C.cropRect(srcW, srcH, cw, ch, centerX, o.zoom || 1);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (o.video.readyState >= 2) {
      try {
        ctx.drawImage(o.video, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);
      } catch (e) { /* 한 프레임 실패는 계속 */ }
    }
    if (o.captionOn !== false && o.cues && o.cues.length) {
      var cue = C.cueAt(o.cues, localMs);
      if (cue) drawCaption(ctx, { text: cue.text, w: cw, h: ch, style: o.style });
    }
    return { rect: rect, centerX: centerX };
  }

  /* ── 오디오 자르기·이어 붙이기 ─────────────────────────── */
  function clipAudio(audioBuffer, clip) {
    if (!audioBuffer) return null;
    var sr = audioBuffer.sampleRate;
    var channels = audioBuffer.numberOfChannels;
    var frames = Math.max(1, Math.round((clip.durationMs / 1000) * sr));
    var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var scratch = new Ctx(1, 1, sr);
    var out = scratch.createBuffer(channels, frames, sr);
    var offset = 0;
    (clip.ranges || []).forEach(function (r) {
      var start = Math.max(0, Math.round((r.startMs / 1000) * sr));
      var count = Math.max(0, Math.round((r.durMs / 1000) * sr));
      if (!count) return;
      var room = frames - offset;
      var n = Math.min(count, room);
      for (var ch = 0; ch < channels; ch++) {
        var src = audioBuffer.getChannelData(ch);
        var dst = out.getChannelData(ch);
        dst.set(src.subarray(start, Math.min(src.length, start + n)), offset);
      }
      offset += n;
    });
    return out;
  }

  /**
   * 클립 하나를 실제 MP4 로 렌더한다.
   * @returns {Promise<{blob, size, width, height, fps, durationMs, audioCodec, encodeMs}>}
   */
  function renderClip(opts) {
    var o = opts || {};
    var clip = o.clip;
    var video = o.video;
    var cues = o.cues || [];
    var preset = o.preset || C.PRESETS[0];
    var fps = Math.max(12, Math.min(60, Math.round(o.fps || 30)));
    var onProgress = o.onProgress || function () {};
    var signal = o.signal || {};
    var style = o.style || C.CAPTION_STYLES[0];
    var started = performance.now();
    var canvas = document.createElement('canvas');
    canvas.width = preset.w;
    canvas.height = preset.h;
    var ctx = canvas.getContext('2d', { alpha: false });

    if (!clip || !clip.durationMs) return Promise.reject(new Error('렌더할 클립이 없습니다.'));
    if (!video || !video.videoWidth) return Promise.reject(new Error('원본 영상이 준비되지 않았습니다.'));

    return capability().then(function (cap) {
      if (!cap.ok) throw new Error(cap.reason || 'MP4를 만들 수 없습니다.');
      return loadMediabunny().then(function (mb) {
        var bitrate = preset.bitrate || 4200000;
        var output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
        var videoSource = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: bitrate });
        output.addVideoTrack(videoSource, { frameRate: fps });
        var audioBuffer = null;
        var audioSource = null;
        if (o.audioBuffer && cap.audioCodec) {
          try {
            audioBuffer = clipAudio(o.audioBuffer, clip);
            audioSource = new mb.AudioBufferSource({ codec: cap.audioCodec, bitrate: 128000 });
            output.addAudioTrack(audioSource);
          } catch (e) { audioSource = null; }
        }
        var frames = Math.max(1, Math.round((clip.durationMs / 1000) * fps));
        var totalMs = clip.durationMs;

        return output.start().then(function () {
          if (!audioSource) return null;
          return audioSource.add(audioBuffer).then(function () { return null; });
        }).then(function () {
          var i = 0;
          var media = root.ClipMedia;
          function step() {
            if (signal.cancelled) throw new Error('canceled');
            if (i >= frames) return Promise.resolve();
            var localMs = (i * 1000) / fps;
            var srcMs = sourceTimeAt(clip, localMs);
            return media.seekTo(video, srcMs / 1000).then(function () {
              drawFrame(ctx, {
                video: video, clip: clip, track: o.track, localMs: localMs,
                outW: preset.w, outH: preset.h, mode: o.mode || 'subject',
                zoom: o.zoom || 1, cues: cues, captionOn: o.captionOn !== false, style: style
              });
              return videoSource.add(i / fps, 1 / fps);
            }).then(function () {
              i++;
              if (i % 4 === 0 || i === frames) {
                onProgress({ progress: i / frames, frame: i, frames: frames, localMs: localMs });
              }
              return step();
            });
          }
          return step();
        }).then(function () {
          return output.finalize();
        }).then(function () {
          var buf = output.target.buffer;
          if (!buf) throw new Error('인코딩 결과가 비었습니다.');
          var bytes = new Uint8Array(buf);
          var blob = new Blob([bytes], { type: 'video/mp4' });
          if (!C.isMp4(bytes)) throw new Error('결과 파일이 MP4 헤더가 아닙니다.');
          return {
            blob: blob,
            size: blob.size,
            header: String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]),
            width: preset.w,
            height: preset.h,
            fps: fps,
            durationMs: totalMs,
            audioCodec: audioSource ? cap.audioCodec : '',
            hasAudio: !!audioSource,
            videoCodec: 'avc',
            encodeMs: Math.round(performance.now() - started)
          };
        });
      });
    });
  }

  /* ── ZIP ───────────────────────────────────────────────── */
  function loadJSZip() {
    if (root.JSZip) return Promise.resolve(root.JSZip);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'assets/vendor/jszip.min.js';
      s.async = true;
      s.onload = function () { root.JSZip ? resolve(root.JSZip) : reject(new Error('JSZip 없음')); };
      s.onerror = function () { reject(new Error('JSZip을 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }

  /** files: [{name, blob}] */
  function zip(files) {
    return loadJSZip().then(function (JSZip) {
      var z = new JSZip();
      (files || []).forEach(function (f) {
        z.file(f.name, f.blob);
      });
      return z.generateAsync({ type: 'blob', compression: 'STORE' });
    });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
  }

  root.ClipRender = {
    capability: capability,
    sourceTimeAt: sourceTimeAt,
    localTimeAt: localTimeAt,
    mapCues: mapCues,
    drawCaption: drawCaption,
    drawFrame: drawFrame,
    clipAudio: clipAudio,
    renderClip: renderClip,
    zip: zip,
    download: download
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
