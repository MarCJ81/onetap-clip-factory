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
    if (opts.baseY !== undefined) baseY = opts.baseY;
    else if (style.pos === 'center') baseY = h * 0.5 - blockH / 2 + fs * 0.82;
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

    /* 카라오케: 지금 읽는 글자까지 색을 입힌다. 진행률은 글자 수로 환산한다. */
    var karaoke = !!style.karaoke && typeof opts.progress === 'number';
    var spokenTotal = karaoke ? C.spokenChars(lines.join(' '), opts.progress) : 0;
    var perLine = [];
    if (karaoke) {
      var acc = 0;
      lines.forEach(function (l) {
        var room = Math.max(0, spokenTotal - acc);
        perLine.push(Math.min(l.length, room));
        acc += l.length + 1;
      });
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
      var n = karaoke ? perLine[i] : 0;
      if (n > 0) {
        var fullW = ctx.measureText(line).width;
        var leftX = style.id === 'kicker' ? x : x - fullW / 2;
        var preW = ctx.measureText(line.slice(0, n)).width;
        ctx.save();
        ctx.beginPath();
        ctx.rect(leftX - fs * 0.12, y - fs * 1.1, preW + fs * 0.24, fs * 1.42);
        ctx.clip();
        if (style.stroke) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(4, Math.round(fs * 0.13));
          ctx.strokeStyle = style.stroke;
          ctx.strokeText(line, x, y);
        }
        ctx.fillStyle = style.accent || '#FFE81A';
        ctx.fillText(line, x, y);
        ctx.restore();
      }
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

  /* ── AI 해설 자막 (원본 대사와 다른 층) ───────────────── */
  /**
   * 클립 위에 얹는 '새 해석' 자막. 대사 자막과 겹치지 않도록 위쪽 밴드에 그린다.
   * style: 'badge'(어두운 배지 + 라임 바) | 'plain'(외곽선 글자만)
   */
  function drawCommentary(ctx, o) {
    var lines = o.lines && o.lines.length ? o.lines : (o.text ? C.wrapCaption(o.text, 18, 2) : []);
    if (!lines.length) return;
    var w = o.w, h = o.h;
    var band = o.band || null;
    var fs = Math.round(band ? band.size : h * 0.042);
    var lh = band ? band.lh : fs * 1.24;
    var baseY = band ? band.baseY : h * 0.34;
    var plain = o.style === 'plain';
    var pad = Math.round(fs * 0.46);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 ' + fs + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
    var widest = 0;
    lines.forEach(function (l) {
      var m = ctx.measureText(l).width;
      if (m > widest) widest = m;
    });
    var blockH = (lines.length - 1) * lh + fs * 1.18;
    if (!plain) {
      var boxW = Math.min(w * 0.9, widest + pad * 2);
      var boxX = (w - boxW) / 2;
      var boxY = baseY - fs * 0.95;
      ctx.fillStyle = 'rgba(7, 8, 11, 0.74)';
      rounded(ctx, boxX, boxY, boxW, blockH + pad * 0.5, Math.round(fs * 0.34));
      ctx.fill();
      ctx.fillStyle = 'rgba(200, 244, 65, 0.95)';
      rounded(ctx, boxX + Math.round(fs * 0.16), boxY + Math.round(fs * 0.28), Math.max(3, Math.round(fs * 0.12)), blockH + pad * 0.5 - Math.round(fs * 0.56), 2);
      ctx.fill();
    }
    lines.forEach(function (line, i) {
      var y = baseY + i * lh;
      if (plain) {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(4, Math.round(fs * 0.16));
        ctx.strokeStyle = 'rgba(4, 5, 7, 0.85)';
        ctx.strokeText(line, w / 2, y);
      }
      ctx.fillStyle = plain ? '#EAFB9A' : '#F6F8FC';
      ctx.fillText(line, w / 2, y);
    });
    ctx.restore();
  }

  /*
   * 대사·해설 두 층을 함께 그린다. 밴드 계산은 core.captionBands 하나만 쓴다
   * → 미리보기와 렌더 결과가 픽셀 단위로 같다.
   * mode: 'both' | 'commentary' | 'dialogue'
   */
  function drawCaptions(ctx, o) {
    var style = o.style || C.CAPTION_STYLES[0];
    var mode = o.mode || 'both';
    var w = o.w, h = o.h;
    var dCue = (mode !== 'commentary' && o.cues && o.cues.length) ? C.cueAt(o.cues, o.localMs) : null;
    var cCue = (mode !== 'dialogue' && o.commentary && o.commentary.length) ? C.cueAt(o.commentary, o.localMs) : null;
    if (!dCue && !cCue) return null;
    var fs = Math.round(h * style.size);
    var maxChars = Math.max(6, Math.floor(w / (fs * 0.94)));
    var dLines = dCue ? C.wrapCaption(dCue.text, maxChars, 2) : [];
    var cSize = Math.round(h * 0.042);
    var cMaxChars = Math.max(8, Math.floor(w / (cSize * 0.98)));
    var cLines = cCue ? C.wrapCaption(cCue.text, cMaxChars, 2) : [];
    var bands = C.captionBands({
      w: w, h: h,
      dialogueOn: dLines.length > 0, dialogueLines: dLines.length || 1,
      dialogueSize: fs, dialogueGap: style.lineGap, dialoguePos: style.pos,
      commentaryLines: cLines.length || 1, commentarySize: cSize
    });
    if (cLines.length) drawCommentary(ctx, { lines: cLines, w: w, h: h, band: bands.commentary, style: o.commentaryStyle });
    if (dLines.length) drawCaption(ctx, {
        text: dCue.text, w: w, h: h, style: style, baseY: bands.dialogue.baseY,
        progress: o.captionProgress
      });
    return bands;
  }

  /* ── 9:16 프레임 그리기 (미리보기·렌더 공용) ─────────── */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o {video, clip, track, localMs, outW, outH, mode, zoom, cues, captionOn, style,
   *                     commentary, captionMode, commentaryStyle}
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
      if (o.mode === 'blur') {
        /* 블러 배경: 원본을 9:16으로 꽉 채워 흐리게 깔고, 안 잘린 원본을 가운데에 얹는다. */
        var bg = C.cropRect(srcW, srcH, cw, ch, 0.5, 1);
        ctx.save();
        if ('filter' in ctx) ctx.filter = 'blur(' + Math.max(8, Math.round(cw * 0.028)) + 'px) brightness(0.62) saturate(1.1)';
        try { ctx.drawImage(o.video, bg.x, bg.y, bg.w, bg.h, 0, 0, cw, ch); } catch (e) { /* noop */ }
        ctx.restore();
        var fitH = ch * 0.86;
        var fitW = Math.min(cw, fitH * (srcW / Math.max(1, srcH)));
        fitH = fitW * (srcH / Math.max(1, srcW));
        try {
          ctx.drawImage(o.video, 0, 0, srcW, srcH, (cw - fitW) / 2, (ch - fitH) / 2, fitW, fitH);
        } catch (e2) { /* noop */ }
        rect = { x: 0, y: 0, w: srcW, h: srcH };
      } else {
        try {
          ctx.drawImage(o.video, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);
        } catch (e) { /* 한 프레임 실패는 계속 */ }
      }
    }
    if (o.captionOn !== false && ((o.cues && o.cues.length) || (o.commentary && o.commentary.length))) {
      var dCue = (o.captionMode !== 'commentary' && o.cues && o.cues.length) ? C.cueAt(o.cues, localMs) : null;
      drawCaptions(ctx, {
        w: cw, h: ch, localMs: localMs,
        cues: o.cues, commentary: o.commentary,
        mode: o.captionMode || 'both', style: o.style, commentaryStyle: o.commentaryStyle,
        captionProgress: dCue ? C.progressAt(dCue.startMs, dCue.endMs, localMs) : undefined
      });
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
                zoom: o.zoom || 1, cues: cues, captionOn: o.captionOn !== false, style: style,
                commentary: o.commentary, captionMode: o.captionMode, commentaryStyle: o.commentaryStyle
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

  /* ════════════════════════════════════════════════════════
     카드 쇼츠(블로그 → 쇼츠) 프레임 · 인코딩
     --------------------------------------------------------
     장면(문구 + 이미지)을 9:16 캔버스에 캔번즈로 그린다.
     미리보기와 MP4가 같은 함수를 쓰므로 WYSIWYG.
     ════════════════════════════════════════════════════════ */

  /** 캔버스 폭에 맞춰 글을 줄바꿈 (큰 제목용) */
  function wrapWidth(ctx, text, maxWidth, maxLines) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    var words = s.split(' ');
    var lines = [];
    var cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    /* 한 단어가 너무 길면 글자로 자른다 */
    var flat = [];
    lines.forEach(function (line) {
      if (ctx.measureText(line).width <= maxWidth) { flat.push(line); return; }
      var buf = '';
      for (var i = 0; i < line.length; i++) {
        if (ctx.measureText(buf + line.charAt(i)).width > maxWidth && buf) { flat.push(buf); buf = line.charAt(i); }
        else buf += line.charAt(i);
      }
      if (buf) flat.push(buf);
    });
    var max = Math.max(1, maxLines || 3);
    if (flat.length > max) {
      flat = flat.slice(0, max);
      flat[max - 1] = flat[max - 1].replace(/\s*\S*$/, '') + '…';
    }
    return flat;
  }

  /** 장면 배경: 이미지가 있으면 캔번즈, 없으면 그라데이션 + 도형 */
  function drawFilmBackdrop(ctx, o) {
    var w = o.w, h = o.h;
    var theme = o.theme || C.FILM_THEMES[0];
    var g = ctx.createLinearGradient(0, 0, w * 0.35, h);
    g.addColorStop(0, theme.bg);
    g.addColorStop(1, theme.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (o.image) {
      var kb = C.kenBurns(o.progress, o.index, 0.12);
      var iw = o.image.width || o.image.naturalWidth || 16;
      var ih = o.image.height || o.image.naturalHeight || 9;
      var r = C.coverRect(iw, ih, w, h, kb.zoom, kb.dx, kb.dy);
      ctx.save();
      ctx.globalAlpha = 0.98;
      try { ctx.drawImage(o.image, r.x, r.y, r.w, r.h); } catch (e) { /* noop */ }
      ctx.restore();
      /* 글자 가독성을 위한 위·아래 스크림 */
      var scrim = ctx.createLinearGradient(0, 0, 0, h);
      scrim.addColorStop(0, 'rgba(4,5,8,0.72)');
      scrim.addColorStop(0.38, 'rgba(4,5,8,0.28)');
      scrim.addColorStop(0.62, 'rgba(4,5,8,0.52)');
      scrim.addColorStop(1, 'rgba(4,5,8,0.88)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);
      return;
    }

    /* 이미지 없음: 그라데이션 카드 + 도형 (테마 색) */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(w * 0.86, h * 0.16, Math.min(w, h) * 0.30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(w * 0.1, h * 0.92, Math.min(w, h) * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = Math.max(1, w * 0.004);
    for (var i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.1 + i * w * 0.18, h);
      ctx.lineTo(w * 0.35 + i * w * 0.18, 0);
      ctx.stroke();
    }
    /* 큰 번호 고스트 */
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = theme.accent;
    ctx.font = '900 ' + Math.round(h * 0.46) + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(('0' + (o.index + 1)).slice(-2), w * 0.94, h * 0.92);
    ctx.restore();
  }

  /**
   * 카드 쇼츠 한 프레임.
   * o: {w,h,scene,index,total,progress,theme,image,captionStyle,captionProgress,
   *     hook, hookMs, captionOn, brand}
   */
  function drawFilmFrame(ctx, o) {
    var w = o.w, h = o.h;
    var theme = o.theme || C.FILM_THEMES[0];
    var scene = o.scene || {};
    drawFilmBackdrop(ctx, o);

    var mx = Math.round(w * 0.075);
    var inner = w - mx * 2;
    var top = Math.round(h * 0.085);

    /* 상단: 번호 + 브랜드 */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.accent;
    ctx.fillRect(mx, top, Math.round(w * 0.09), Math.max(3, Math.round(h * 0.006)));
    ctx.font = '700 ' + Math.round(h * 0.021) + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
    ctx.fillStyle = theme.sub;
    ctx.fillText(('0' + (o.index + 1)).slice(-2) + ' / ' + ('0' + (o.total || 1)).slice(-2), mx, top + h * 0.036);
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.sub;
    ctx.globalAlpha = 0.72;
    ctx.fillText(o.brand || 'ONETAP', w - mx, top + h * 0.036);
    ctx.restore();

    /* 제목 */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var hLen = (scene.headline || '').length;
    var headSize = Math.round(h * (hLen <= 16 ? 0.074 : hLen <= 26 ? 0.064 : hLen <= 40 ? 0.054 : 0.047));
    ctx.font = '900 ' + headSize + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
    var headLines = wrapWidth(ctx, scene.headline || '', inner, 3);
    var y = h * 0.34;
    var lh = headSize * 1.16;
    headLines.forEach(function (line, i) {
      /* 형광 밑줄: 마지막 줄에만, 글자 아래에 또렷하게 */
      if (i === headLines.length - 1) {
        var tw = ctx.measureText(line).width;
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.95;
        ctx.fillRect(mx - Math.round(w * 0.008), y + headSize * 0.26, Math.min(inner, tw + w * 0.016), Math.max(4, Math.round(headSize * 0.07)));
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = theme.ink;
      ctx.fillText(line, mx, y);
      y += lh;
    });
    ctx.restore();

    /* 부제 */
    if (scene.sub) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var subSize = Math.round(h * 0.028);
      ctx.font = '500 ' + subSize + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
      ctx.fillStyle = theme.sub;
      var subLines = wrapWidth(ctx, scene.sub, inner, 2);
      var sy = h * 0.34 + headLines.length * lh + subSize * 0.5;
      /* 자막 밴드(0.845h)와 부딪히지 않게 위로 당긴다 */
      var subBottom = sy + (subLines.length - 1) * subSize * 1.42;
      if (subBottom > h * 0.76) sy -= (subBottom - h * 0.76);
      subLines.forEach(function (line) {
        ctx.fillText(line, mx, sy);
        sy += subSize * 1.42;
      });
      ctx.restore();
    }

    /* 장면 자막 (카라오케) */
    if (o.captionOn !== false && scene.caption) {
      drawCaption(ctx, {
        text: scene.caption, w: w, h: h,
        style: o.captionStyle || C.CAPTION_STYLES[4],
        baseY: h * 0.845,
        progress: o.captionProgress
      });
    }

    /* 첫 장면 훅: 앞 1.4초만 크게 */
    if (o.hook && o.hookMs !== undefined && o.hookMs < (o.hookDur || 1500)) {
      var a = Math.max(0, Math.min(1, ((o.hookDur || 1500) - o.hookMs) / 400));
      ctx.save();
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(0, h * 0.155, w, Math.round(h * 0.115));
      ctx.fillStyle = theme.accentInk;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var hookSize = Math.round(h * 0.048);
      var hookLines = [];
      for (var hs = hookSize; hs > h * 0.03; hs -= 2) {
        ctx.font = '900 ' + hs + 'px "PlexKR", "Apple SD Gothic Neo", sans-serif';
        hookLines = wrapWidth(ctx, o.hook, w * 0.84, 1);
        if (hookLines.join(' ').length === String(o.hook).replace(/\s+/g, ' ').trim().length) break;
      }
      if (hookLines.length) ctx.fillText(hookLines[0], w / 2, h * 0.155 + h * 0.058);
      ctx.restore();
    }

    /* 진행 막대 */
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, 0, w, Math.max(2, Math.round(h * 0.004)));
    ctx.fillStyle = theme.accent;
    ctx.fillRect(0, 0, Math.round(w * Math.max(0, Math.min(1, o.overall || 0))), Math.max(2, Math.round(h * 0.004)));
    ctx.restore();
  }

  /**
   * 카드 쇼츠 MP4 렌더.
   * @param {object} opts {scenes, timeline, images:{[index]:img}, audioBuffer, preset, fps,
   *                       theme, style, hook, captionOn, onProgress, signal}
   */
  function renderFilm(opts) {
    var o = opts || {};
    var scenes = o.scenes || [];
    var timeline = o.timeline || C.filmTimeline(scenes);
    var preset = o.preset || C.PRESETS[0];
    var fps = Math.max(12, Math.min(60, Math.round(o.fps || 30)));
    var onProgress = o.onProgress || function () {};
    var signal = o.signal || {};
    var totalMs = timeline.length ? timeline[timeline.length - 1].endMs : 0;
    var started = performance.now();
    if (!scenes.length || !totalMs) return Promise.reject(new Error('장면이 없습니다.'));
    var canvas = document.createElement('canvas');
    canvas.width = preset.w;
    canvas.height = preset.h;
    var ctx = canvas.getContext('2d', { alpha: false });

    return capability().then(function (cap) {
      if (!cap.ok) throw new Error(cap.reason || 'MP4를 만들 수 없습니다.');
      return loadMediabunny().then(function (mb) {
        var output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
        var videoSource = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: preset.bitrate || 4200000 });
        output.addVideoTrack(videoSource, { frameRate: fps });
        var audioSource = null;
        if (o.audioBuffer && cap.audioCodec) {
          try {
            audioSource = new mb.AudioBufferSource({ codec: cap.audioCodec, bitrate: 128000 });
            output.addAudioTrack(audioSource);
          } catch (e) { audioSource = null; }
        }
        var frames = Math.max(1, Math.round((totalMs / 1000) * fps));

        return output.start().then(function () {
          if (!audioSource) return null;
          return audioSource.add(o.audioBuffer).then(function () { return null; });
        }).then(function () {
          var i = 0;
          function step() {
            if (signal.cancelled) throw new Error('canceled');
            if (i >= frames) return Promise.resolve();
            var tMs = (i * 1000) / fps;
            var at = C.filmAt(timeline, tMs);
            if (at) {
              var scene = scenes[at.index] || {};
              drawFilmFrame(ctx, {
                w: preset.w, h: preset.h,
                scene: scene, index: at.index, total: scenes.length,
                progress: at.progress, overall: tMs / totalMs,
                theme: o.theme, image: (o.images || {})[at.index] || null,
                captionStyle: o.style, captionOn: o.captionOn, captionProgress: at.progress,
                hook: o.hook, hookMs: at.index === 0 ? at.localMs : 99999, hookDur: o.hookDur
              });
            }
            return videoSource.add(i / fps, 1 / fps).then(function () {
              i++;
              if (i % 4 === 0 || i === frames) {
                onProgress({ progress: i / frames, frame: i, frames: frames });
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
            blob: blob, size: blob.size,
            header: String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]),
            width: preset.w, height: preset.h, fps: fps, durationMs: totalMs,
            audioCodec: audioSource ? cap.audioCodec : '', hasAudio: !!audioSource,
            videoCodec: 'avc', encodeMs: Math.round(performance.now() - started),
            scenes: scenes.length
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
    drawCommentary: drawCommentary,
    drawCaptions: drawCaptions,
    drawFrame: drawFrame,
    drawFilmFrame: drawFilmFrame,
    wrapWidth: wrapWidth,
    renderFilm: renderFilm,
    clipAudio: clipAudio,
    renderClip: renderClip,
    zip: zip,
    download: download
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
