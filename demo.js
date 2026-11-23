/* ============================================================
   원탭 클립 팩토리 · demo.js
   ------------------------------------------------------------
   내장 데모 VOD 생성기.
   실제 영상이 필요하지만 외부 파일을 받아 오지 않는다.
   Canvas(장면 5개 + 움직이는 피사체) + OfflineAudioContext(말소리 5블록 +
   죽은 초 6구간)로 32초 960×540 영상을 만든 뒤,
   mediabunny(WebCodecs)로 진짜 H.264 MP4 + 오디오로 인코딩한다.
   생성된 파일은 메모리 안에서만 존재하고, 원본과 똑같은 경로로 분석된다.
   ============================================================ */
(function (root) {
  'use strict';

  var C = root.ClipCore;
  var PLAN = C.DEMO;

  function loadMediabunny() {
    if (root.__clipMediabunny) return Promise.resolve(root.__clipMediabunny);
    return import('./assets/vendor/mediabunny.min.mjs').then(function (mod) {
      root.__clipMediabunny = mod;
      return mod;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ── 소리: 말소리처럼 들리는 음절 합성 ───────────────────
     무음 구간은 정확히 0으로 둬야 '죽은 초' 감지가 실제로 잡힌다. */
  function renderAudio() {
    var sr = 44100;
    var total = PLAN.durationMs / 1000;
    var ac = new root.OfflineAudioContext(2, Math.round(sr * total), sr);

    var master = ac.createGain();
    master.gain.value = 1.0;
    master.connect(ac.destination);

    /* 아주 옅은 룸톤은 넣지 않는다 — 무음이 무음이어야 한다. */

    PLAN.speech.forEach(function (block, bi) {
      var start = block.startMs / 1000;
      var end = block.endMs / 1000;
      var t = start + 0.08;
      var syllable = 0;
      var pitch = bi === 2 ? 196 : (bi === 4 ? 168 : 148);
      while (t < end - 0.12) {
        var dur = 0.13 + (syllable % 3) * 0.02;
        if (t + dur > end) dur = Math.max(0.08, end - t);
        var f0 = pitch * (1 + 0.06 * Math.sin(syllable * 0.9) + (bi === 2 ? 0.05 : 0));
        /* 성대: 톱니 + 사인, 포먼트: 밴드패스 2개 */
        [
          { type: 'sawtooth', gain: 0.52, f: 620 + (syllable % 4) * 90, q: 2.2 },
          { type: 'sawtooth', gain: 0.26, f: 1420 + (syllable % 3) * 160, q: 3 }
        ].forEach(function (v) {
          var osc = ac.createOscillator();
          var bp = ac.createBiquadFilter();
          var g = ac.createGain();
          osc.type = v.type;
          osc.frequency.setValueAtTime(f0, t);
          osc.frequency.linearRampToValueAtTime(f0 * (0.94 + (syllable % 5) * 0.02), t + dur);
          bp.type = 'bandpass';
          bp.frequency.value = v.f;
          bp.Q.value = v.q;
          osc.connect(bp); bp.connect(g); g.connect(master);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(v.gain, t + 0.022);
          g.gain.setValueAtTime(v.gain, t + dur * 0.7);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          osc.start(t);
          osc.stop(t + dur + 0.02);
        });
        /* 자음 느낌의 짧은 노이즈 */
        var noiseLen = Math.round(sr * 0.03);
        var nb = ac.createBuffer(1, noiseLen, sr);
        var nd = nb.getChannelData(0);
        for (var i = 0; i < noiseLen; i++) nd[i] = (Math.sin(i * 12.9898 + syllable * 78.233) * 43758.5453 % 1) * 0.5;
        var ns = ac.createBufferSource();
        var hp = ac.createBiquadFilter();
        var ng = ac.createGain();
        hp.type = 'highpass'; hp.frequency.value = 2600;
        ng.gain.value = 0.12;
        ns.buffer = nb; ns.connect(hp); hp.connect(ng); ng.connect(master);
        ns.start(t);

        syllable++;
        t += dur + (syllable % 4 === 0 ? 0.18 : 0.075);
      }
    });

    return ac.startRendering();
  }

  /* ── 그림: 장면 5개 ──────────────────────────────────── */
  function makePainter(ctx) {
    var W = PLAN.width, H = PLAN.height;
    var cache = {};

    function bg(scene) {
      if (cache[scene.key]) return cache[scene.key];
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, scene.bg);
      g.addColorStop(0.55, shade(scene.bg, 0.82));
      g.addColorStop(1, '#06070A');
      cache[scene.key] = g;
      return g;
    }
    function shade(hex, k) {
      var h = hex.replace('#', '');
      var r = Math.round(parseInt(h.slice(0, 2), 16) * k);
      var g = Math.round(parseInt(h.slice(2, 4), 16) * k);
      var b = Math.round(parseInt(h.slice(4, 6), 16) * k);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function person(x, y, scale, shirt, skin, t, talking) {
      var bob = Math.sin(t * 2.1) * 2 * scale;
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(scale, scale);
      /* 어깨 */
      ctx.fillStyle = shirt;
      roundRect(ctx, -58, 26, 116, 86, 26);
      ctx.fill();
      /* 목 */
      ctx.fillStyle = shade(skin, 0.86);
      ctx.fillRect(-13, 4, 26, 30);
      /* 얼굴 */
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(0, -12, 34, 40, 0, 0, Math.PI * 2);
      ctx.fill();
      /* 머리 */
      ctx.fillStyle = '#1A1712';
      ctx.beginPath();
      ctx.ellipse(0, -30, 35, 26, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-35, -32, 70, 8);
      /* 눈 */
      ctx.fillStyle = '#211D18';
      var blink = (Math.sin(t * 1.7) > 0.97) ? 1 : 5;
      ctx.beginPath(); ctx.ellipse(-12, -12, 4, blink, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(12, -12, 4, blink, 0, 0, Math.PI * 2); ctx.fill();
      /* 입 */
      if (talking) {
        ctx.fillStyle = '#5C2A28';
        var open = 3 + Math.abs(Math.sin(t * 9.5)) * 7;
        ctx.beginPath(); ctx.ellipse(0, 12, 8, open * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    function drawScene0(t, local) {
      var s = PLAN.scenes[0];
      ctx.fillStyle = bg({ key: 's0', bg: s.bg });
      ctx.fillRect(0, 0, W, H);
      /* 스튜디오 조명 */
      var g = ctx.createRadialGradient(W * 0.66, H * 0.28, 10, W * 0.66, H * 0.28, W * 0.6);
      g.addColorStop(0, 'rgba(62,232,208,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      /* 배경 패널 */
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (var i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(60 + i * 26, 60);
        ctx.lineTo(20 + i * 26, H - 60);
        ctx.stroke();
      }
      person(W * (0.5 + 0.16 * Math.sin(t * 0.6)), H * 0.66, 1.05, '#2C6FE0', '#E8B98F', t, local < 5.4);
      /* 데스크 */
      ctx.fillStyle = 'rgba(10,16,24,0.92)';
      ctx.fillRect(0, H * 0.84, W, H * 0.16);
      ctx.fillStyle = 'rgba(62,232,208,0.5)';
      ctx.fillRect(0, H * 0.84, W, 2);
      /* 좌하단 로고 */
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '700 16px "PlexKR", sans-serif';
      ctx.fillText('ONETAP STUDIO', 32, H * 0.92);
      ctx.fillStyle = 'rgba(62,232,208,0.85)';
      ctx.fillRect(32, H * 0.945, 42, 2);
    }

    function drawScene1(t, local) {
      var s = PLAN.scenes[1];
      ctx.fillStyle = bg({ key: 's1', bg: s.bg });
      ctx.fillRect(0, 0, W, H);
      /* 화면 공유 창 */
      var wx = W * 0.12, wy = H * 0.14, ww = W * 0.76, wh = H * 0.6;
      ctx.fillStyle = 'rgba(8,10,16,0.86)';
      roundRect(ctx, wx, wy, ww, wh, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,61,114,0.5)';
      ctx.stroke();
      /* 창 상단 */
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(wx, wy, ww, 26);
      ['#FF5F57', '#FEBC2E', '#28C840'].forEach(function (c, i) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(wx + 14 + i * 13, wy + 13, 3.6, 0, Math.PI * 2);
        ctx.fill();
      });
      /* 막대 차트 */
      var baseY = wy + wh - 26;
      for (var i = 0; i < 9; i++) {
        var hgt = 40 + Math.abs(Math.sin(i * 1.3 + t * 0.6)) * 130;
        ctx.fillStyle = i % 3 === 0 ? 'rgba(255,61,114,0.9)' : 'rgba(255,255,255,0.28)';
        ctx.fillRect(wx + 40 + i * 52, baseY - hgt, 30, hgt);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.moveTo(wx + 30, baseY); ctx.lineTo(wx + ww - 30, baseY); ctx.stroke();
      /* 지표 카드 */
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '800 30px "PlexKR", sans-serif';
      ctx.fillText('−42%', wx + 30, wy + 78);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 13px "PlexKR", sans-serif';
      ctx.fillText('편집 시간', wx + 30, wy + 98);
      /* 움직이는 커서 */
      var cx = wx + 120 + ((t * 55) % (ww - 260));
      var cy = wy + 130 + Math.sin(t * 1.4) * 46;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + 9, cy + 20); ctx.lineTo(cx + 13, cy + 12); ctx.lineTo(cx + 21, cy + 9);
      ctx.closePath(); ctx.fill();
      /* 발표자 (작게, 오른쪽) */
      person(W * 0.84, H * 0.9, 0.62, '#3D2B6B', '#D9A878', t, true);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '500 12px "PlexKR", sans-serif';
      ctx.fillText('LIVE SHARE', wx + 12, wy + wh + 22);
    }

    function drawScene2(t, local) {
      var s = PLAN.scenes[2];
      ctx.fillStyle = bg({ key: 's2', bg: s.bg });
      ctx.fillRect(0, 0, W, H);
      /* 분할 화면 */
      ctx.strokeStyle = 'rgba(200,244,65,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(W / 2, 40); ctx.lineTo(W / 2, H - 70); ctx.stroke();
      var speaker = Math.floor((t * 1.1) % 2);
      person(W * 0.38, H * 0.7, 1.0, '#1E4F44', '#E7B48C', t, speaker === 0);
      person(W * 0.62, H * 0.7, 1.0, '#5A2536', '#C98F62', t + 2.2, speaker === 1);
      /* 마이크 */
      [0.38, 0.62].forEach(function (x) {
        ctx.fillStyle = 'rgba(12,16,14,0.9)';
        ctx.fillRect(W * x - 3, H * 0.55, 6, 34);
        ctx.fillStyle = '#28322C';
        ctx.beginPath(); ctx.arc(W * x, H * 0.55, 7, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 12px "PlexKR", sans-serif';
      ctx.fillText('GUEST 01', W * 0.38 - 30, H * 0.9);
      ctx.fillText('GUEST 02', W * 0.62 - 30, H * 0.9);
    }

    function drawScene3(t, local) {
      var s = PLAN.scenes[3];
      ctx.fillStyle = bg({ key: 's3', bg: s.bg });
      ctx.fillRect(0, 0, W, H);
      /* 지나가는 도시 블록 */
      var off = (t * 46) % 180;
      for (var i = -1; i < 8; i++) {
        var bx = i * 180 - off;
        var bh = 90 + ((i + 3) * 37) % 150;
        ctx.fillStyle = 'rgba(12,14,20,0.85)';
        ctx.fillRect(bx, H - 90 - bh, 120, bh);
        for (var wy = 0; wy < 5; wy++) {
          for (var wx = 0; wx < 3; wx++) {
            if ((i + wy + wx) % 3 === 0) {
              ctx.fillStyle = 'rgba(255,176,32,' + (0.18 + 0.14 * Math.sin(t * 2 + i + wy)) + ')';
              ctx.fillRect(bx + 14 + wx * 32, H - 80 - bh + wy * 46, 16, 10);
            }
          }
        }
      }
      /* 지나가는 빛 */
      for (var k = 0; k < 3; k++) {
        var lx = ((t * (120 + k * 45) + k * 300) % (W + 300)) - 150;
        var lg = ctx.createLinearGradient(lx - 120, 0, lx + 120, 0);
        lg.addColorStop(0, 'rgba(255,176,32,0)');
        lg.addColorStop(0.5, 'rgba(255,176,32,0.35)');
        lg.addColorStop(1, 'rgba(255,176,32,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(lx - 120, H * 0.72, 240, 3);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.font = '600 13px "PlexKR", sans-serif';
      ctx.fillText('B-ROLL / NIGHT RUN', 32, H * 0.9);
    }

    function drawScene4(t, local) {
      var s = PLAN.scenes[4];
      ctx.fillStyle = bg({ key: 's4', bg: s.bg });
      ctx.fillRect(0, 0, W, H);
      var g = ctx.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.4, W * 0.5);
      g.addColorStop(0, 'rgba(139,92,246,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      /* 9:16 프레임이 좁아지는 애니메이션 */
      var p = Math.min(1, local / 2.2);
      var fw = 150 + (1 - p) * 120, fh = fw * 16 / 9;
      ctx.strokeStyle = 'rgba(200,244,65,' + (0.35 + 0.4 * p) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      roundRect(ctx, W * 0.78 - fw / 2, H / 2 - fh / 2, fw * 0.62, fh, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      person(W * 0.78, H * 0.72, 0.9, '#3A2D63', '#E4B287', t, true);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 54px "PlexKR", sans-serif';
      ctx.fillText('업로드만', W * 0.12, H * 0.42);
      ctx.fillText('남았습니다', W * 0.12, H * 0.42 + 62);
      ctx.fillStyle = 'rgba(200,244,65,0.95)';
      ctx.font = '700 16px "PlexKR", sans-serif';
      ctx.fillText('9:16 · 15초 · 자막까지', W * 0.12, H * 0.42 + 96);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '500 13px "PlexKR", sans-serif';
      ctx.fillText('ONETAP CLIP FACTORY', W * 0.12, H * 0.9);
    }

    var drawers = [drawScene0, drawScene1, drawScene2, drawScene3, drawScene4];

    return function paint(tMs) {
      var t = tMs / 1000;
      var sceneIdx = 0;
      for (var i = 0; i < PLAN.speech.length; i++) {
        if (tMs >= PLAN.speech[i].startMs - 900) sceneIdx = Math.min(PLAN.scenes.length - 1, i);
      }
      var sceneStart = 0;
      for (var j = 0; j < PLAN.speech.length; j++) {
        if (tMs >= PLAN.speech[j].startMs - 900) sceneStart = PLAN.speech[j].startMs - 900;
      }
      var scene = PLAN.scenes[sceneIdx];
      drawers[sceneIdx](t, Math.max(0, (tMs - sceneStart) / 1000));

      /* 공통 HUD */
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.fillRect(0, 0, W, 54);
      ctx.fillStyle = '#FF3B72';
      ctx.beginPath(); ctx.arc(28, 27, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.font = '700 14px "PlexKR", sans-serif';
      ctx.fillText('REC  ' + scene.title, 42, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '600 12px "PlexKR", sans-serif';
      ctx.fillText(scene.sub, W - 220, 32);
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(0, H - 42, W, 42);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 12px "PlexKR", sans-serif';
      ctx.fillText('SCENE 0' + (sceneIdx + 1) + ' / 05', 24, H - 16);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('960×540 · 30fps · DEMO VOD', W - 236, H - 16);

      /* 비네트 */
      var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    };
  }

  /* 데모 자막: 말소리 블록을 반으로 나눠 실제 큐 2개씩 만든다. */
  function demoCues() {
    var cues = [];
    PLAN.speech.forEach(function (sp) {
      var words = sp.line.split(' ');
      var mid = Math.ceil(words.length / 2);
      var head = words.slice(0, mid).join(' ');
      var tail = words.slice(mid).join(' ');
      var cut = sp.startMs + Math.round((sp.endMs - sp.startMs) * 0.52);
      if (tail) {
        cues.push({ startMs: sp.startMs, endMs: cut, text: head });
        cues.push({ startMs: cut + 40, endMs: sp.endMs, text: tail });
      } else {
        cues.push({ startMs: sp.startMs, endMs: sp.endMs, text: head });
      }
    });
    return cues;
  }

  function build(opts) {
    var o = opts || {};
    var signal = o.signal || {};
    var onProgress = typeof o.onProgress === 'function' ? o.onProgress : function () {};
    var mb = null;
    var started = performance.now();

    return loadMediabunny().then(function (mod) {
      mb = mod;
      onProgress({ phase: 'audio', progress: 0.04, label: '데모 오디오를 합성하는 중…' });
      return renderAudio();
    }).then(function (audioBuffer) {
      if (signal.cancelled) throw new Error('canceled');
      return mb.canEncodeAudio('aac').then(function (aac) {
        return aac ? 'aac' : 'opus';
      }).then(function (audioCodec) {
        var canvas = document.createElement('canvas');
        canvas.width = PLAN.width;
        canvas.height = PLAN.height;
        var ctx = canvas.getContext('2d', { alpha: false });
        var paint = makePainter(ctx);
        var output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
        var video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 1600000 });
        output.addVideoTrack(video, { frameRate: PLAN.fps });
        var audio = new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128000 });
        output.addAudioTrack(audio);

        return output.start().then(function () {
          return audio.add(audioBuffer).then(function () {
            var frames = Math.round((PLAN.durationMs / 1000) * PLAN.fps);
            var i = 0;
            function step() {
              if (signal.cancelled) throw new Error('canceled');
              if (i >= frames) return Promise.resolve();
              var tMs = (i * 1000) / PLAN.fps;
              paint(tMs);
              return video.add(i / PLAN.fps, 1 / PLAN.fps).then(function () {
                i++;
                if (i % 30 === 0 || i === frames) {
                  onProgress({
                    phase: 'encode',
                    progress: 0.08 + 0.9 * (i / frames),
                    label: '데모 VOD 인코딩 ' + Math.round((i / frames) * 100) + '%'
                  });
                }
                return step();
              });
            }
            return step();
          }).then(function () {
            return output.finalize();
          }).then(function () {
            var buf = output.target.buffer;
            if (!buf) throw new Error('데모 인코딩 결과가 비었습니다.');
            var blob = new Blob([buf], { type: 'video/mp4' });
            var bytes = new Uint8Array(buf);
            if (!C.isMp4(bytes)) throw new Error('데모 파일이 MP4 헤더가 아닙니다.');
            onProgress({ phase: 'done', progress: 1, label: '데모 VOD 준비 완료' });
            return {
              blob: blob,
              audioBuffer: audioBuffer,
              name: 'demo-studio-talk.mp4',
              durationMs: PLAN.durationMs,
              width: PLAN.width,
              height: PLAN.height,
              audioCodec: audioCodec,
              cues: demoCues(),
              scenes: PLAN.scenes.length,
              speechMs: PLAN.speech.reduce(function (a, s) { return a + (s.endMs - s.startMs); }, 0),
              encodeMs: Math.round(performance.now() - started),
              size: blob.size
            };
          });
        });
      });
    });
  }

  root.ClipDemo = { build: build, cues: demoCues, PLAN: PLAN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
