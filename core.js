/* ============================================================
   원탭 클립 팩토리 · core.js  v1.0.0
   ------------------------------------------------------------
   화면(DOM) 없이도 돌아가는 순수 계산 계층.
     · 오디오 레벨 → 무음(죽은 초) 구간 → 남길 구간
     · 장면 컷(히스토그램 급변) → 하이라이트 클립 계획
     · 피사체/움직임 추적 곡선 → 9:16 크롭 좌표
     · SRT/VTT 파싱·직렬화·자막 줄바꿈
     · AI 훅 프롬프트/응답 파싱, 파일 이름, MP4 헤더 확인
   node 에서 require('./core.js'), 브라우저에서 window.ClipCore 로 쓴다.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClipCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.1.0';

  /* ── 기본값 ───────────────────────────────────────────── */
  var DETECT = {
    silenceDb: -38,        // 이보다 조용하면 무음으로 본다 (dBFS)
    minSilenceMs: 380,     // 이보다 짧은 틈은 컷하지 않는다(숨소리 보호)
    padMs: 90,             // 말소리 앞뒤로 남기는 여백
    sceneSensitivity: 0.34,// 장면 컷 감도 0~1 (낮을수록 예민)
    targetClipMs: 15000,   // 클립 한 개 목표 길이
    minClipMs: 6000,
    maxClipMs: 45000,
    clipCount: 3           // 자동 선택 개수
  };

  var PRESETS = [
    { id: '1080', label: '1080 × 1920', w: 1080, h: 1920, bitrate: 5200000, note: '릴스·쇼츠·틱톡 기본' },
    { id: '720', label: '720 × 1280', w: 720, h: 1280, bitrate: 2800000, note: '가볍게 여러 개' },
    { id: '608', label: '608 × 1080', w: 608, h: 1080, bitrate: 1900000, note: '초안·검수용' }
  ];

  var TRACK_MODES = [
    { id: 'subject', label: '피사체 추적', desc: '피부톤 + 움직임 + 중앙 가중' },
    { id: 'motion', label: '움직임 추적', desc: '화면에서 가장 많이 움직이는 쪽' },
    { id: 'center', label: '중앙 고정', desc: '크롭을 가운데에 둡니다' }
  ];

  var CAPTION_STYLES = [
    { id: 'yellow', label: '옐로 임팩트', fill: '#FFE81A', stroke: '#0A0A0B', box: '', weight: 900, size: 0.062, pos: 'bottom', lineGap: 1.12 },
    { id: 'white', label: '클린 화이트', fill: '#FFFFFF', stroke: 'rgba(0,0,0,0.72)', box: '', weight: 800, size: 0.058, pos: 'center', lineGap: 1.16 },
    { id: 'box', label: '블랙 박스', fill: '#FFFFFF', stroke: '', box: 'rgba(8,9,11,0.78)', weight: 800, size: 0.060, pos: 'bottom', lineGap: 1.2 },
    { id: 'kicker', label: '키커 라임', fill: '#0A0B0D', stroke: '', box: '#C8F441', weight: 900, size: 0.058, pos: 'bottom', lineGap: 1.2 }
  ];

  /* 데모 VOD 계획 — 화면과 소리를 같은 대본에서 만든다.
     0.0s 부터 32.0s. 말소리 5블록 + 무음 6구간(죽은 초). */
  var DEMO = {
    durationMs: 32000,
    fps: 30,
    width: 960,
    height: 540,
    speech: [
      { startMs: 1000, endMs: 7200, scene: 0, line: '긴 영상 하나로 숏폼 3개를 뽑는다고?' },
      { startMs: 8000, endMs: 12400, scene: 1, line: '컷 찾고, 무음 지우고, 세로로 다시 잡고' },
      { startMs: 13600, endMs: 19800, scene: 2, line: '자막까지 붙이면 퇴근이 두 시간 늦어져요' },
      { startMs: 20600, endMs: 25000, scene: 3, line: '이제 업로드만 남았습니다. 진짜로요' },
      { startMs: 26200, endMs: 31000, scene: 4, line: '브라우저에서 끝. 영상은 밖으로 안 나갑니다' }
    ],
    scenes: [
      { title: 'STUDIO TALK', sub: '카메라 1 · 진행자', bg: '#12213A', accent: '#3EE8D0' },
      { title: 'SCREEN SHARE', sub: '차트 · 지표', bg: '#1B1430', accent: '#FF3D77' },
      { title: 'INTERVIEW', sub: '게스트 2인', bg: '#101E1A', accent: '#C8F441' },
      { title: 'B-ROLL', sub: '현장 컷', bg: '#2A1712', accent: '#FFB020' },
      { title: 'OUTRO', sub: '구독 · 다음 편', bg: '#141821', accent: '#8B5CF6' }
    ]
  };

  /* ── 작은 도구 ─────────────────────────────────────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function round(v, n) { var p = Math.pow(10, n || 0); return Math.round(v * p) / p; }
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mad(arr, med) {
    if (!arr.length) return 0;
    var m = med === undefined ? median(arr) : med;
    var dev = arr.map(function (v) { return Math.abs(v - m); });
    return median(dev);
  }
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }
  function bytes(n) {
    var v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KB';
    return (v / 1024 / 1024).toFixed(v < 10485760 ? 1 : 0) + ' MB';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) {
    var t = Math.max(0, Math.round(ms || 0));
    var s = Math.floor(t / 1000);
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    var rest = t % 1000;
    if (h > 0) return h + ':' + pad2(m % 60) + ':' + pad2(s % 60);
    return pad2(m) + ':' + pad2(s % 60) + (rest >= 500 ? '' : '');
  }
  function timecode(ms, fps) {
    var f = Math.max(1, Math.round(fps || 30));
    var t = Math.max(0, ms || 0);
    var totalFrames = Math.round((t / 1000) * f);
    var ff = totalFrames % f;
    var totalSec = Math.floor(totalFrames / f);
    return pad2(Math.floor(totalSec / 3600)) + ':' + pad2(Math.floor(totalSec / 60) % 60) + ':' +
      pad2(totalSec % 60) + ':' + pad2(ff);
  }
  function srtTime(ms) {
    var t = Math.max(0, Math.round(ms || 0));
    var h = Math.floor(t / 3600000);
    var m = Math.floor(t / 60000) % 60;
    var s = Math.floor(t / 1000) % 60;
    var r = t % 1000;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + ('00' + r).slice(-3);
  }
  function vttTime(ms) {
    return srtTime(ms).replace(',', '.');
  }
  function parseTimecode(text) {
    var s = String(text || '').trim().replace(',', '.');
    var m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(s);
    if (!m) return null;
    var ms = 0;
    if (m[1] !== undefined) ms += Number(m[1]) * 3600000;
    ms += Number(m[2]) * 60000;
    ms += Number(m[3]) * 1000;
    if (m[4]) ms += Number((m[4] + '00').slice(0, 3));
    return ms;
  }

  /* ── 오디오: 레벨 봉투 ─────────────────────────────────── */
  /** AudioBuffer 채널 → 20ms 단위 RMS(0~1) 배열. 소리는 여기서만 읽는다. */
  function envelope(channel, sampleRate, stepMs) {
    var step = Math.max(1, Math.round((sampleRate * (stepMs || 20)) / 1000));
    var n = Math.floor(channel.length / step);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var acc = 0;
      var base = i * step;
      for (var j = 0; j < step; j++) {
        var v = channel[base + j] || 0;
        acc += v * v;
      }
      out[i] = Math.sqrt(acc / step);
    }
    return out;
  }

  function levelToDb(v) {
    if (!(v > 0)) return -120;
    return 20 * Math.log10(Math.min(1, v));
  }

  /** 여러 채널 → 가장 큰 레벨을 쓰는 모노 봉투 */
  function envelopeOfChannels(channels, sampleRate, stepMs) {
    var list = (channels || []).filter(function (ch) { return ch && ch.length; });
    if (!list.length) return new Float32Array(0);
    var envs = list.map(function (ch) { return envelope(ch, sampleRate, stepMs); });
    if (envs.length === 1) return envs[0];
    var len = Math.min.apply(null, envs.map(function (e) { return e.length; }));
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var mx = 0;
      for (var c = 0; c < envs.length; c++) if (envs[c][i] > mx) mx = envs[c][i];
      out[i] = mx;
    }
    return out;
  }

  /* ── 무음 구간 ─────────────────────────────────────────── */
  /**
   * 임계치 아래가 minSilenceMs 이상 이어지면 '죽은 초'로 기록한다.
   * @returns {{regions:Array, silentMs:number, speechMs:number, threshold:number}}
   */
  function detectSilence(levels, stepMs, opts) {
    var o = opts || {};
    var silenceDb = o.silenceDb === undefined ? DETECT.silenceDb : o.silenceDb;
    var minSilenceMs = o.minSilenceMs === undefined ? DETECT.minSilenceMs : o.minSilenceMs;
    var step = stepMs || 20;
    var thr = Math.pow(10, silenceDb / 20);
    var regions = [];
    var start = -1;
    var totalMs = levels.length * step;
    for (var i = 0; i < levels.length; i++) {
      var quiet = levels[i] <= thr;
      if (quiet && start < 0) start = i;
      if ((!quiet || i === levels.length - 1) && start >= 0) {
        var end = quiet ? i + 1 : i;
        var s = start * step;
        var e = end * step;
        if (e - s >= minSilenceMs) {
          var acc = 0;
          for (var k = start; k < end; k++) acc += levels[k];
          regions.push({
            startMs: s,
            endMs: e,
            durMs: e - s,
            avgDb: round(levelToDb(acc / Math.max(1, end - start)), 1),
            peakDb: round(levelToDb(Math.max.apply(null, Array.prototype.slice.call(levels, start, end))), 1)
          });
        }
        start = -1;
      }
    }
    var silentMs = sum(regions.map(function (r) { return r.durMs; }));
    return {
      regions: regions,
      silentMs: silentMs,
      speechMs: Math.max(0, totalMs - silentMs),
      threshold: round(levelToDb(thr), 1),
      totalMs: totalMs
    };
  }

  /** 무음의 여집합 = 남길 구간. 말소리 앞뒤로 padMs 만큼 남긴다. */
  function keepSegments(regions, totalMs, padMs, minKeepMs) {
    var pad = padMs === undefined ? DETECT.padMs : padMs;
    var minKeep = minKeepMs === undefined ? 260 : minKeepMs;
    var segs = [];
    var cursor = 0;
    var sorted = (regions || []).slice().sort(function (a, b) { return a.startMs - b.startMs; });
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      var start = cursor;
      var end = Math.max(start, r.startMs);
      if (end - start >= minKeep) segs.push({ startMs: start, endMs: end });
      cursor = Math.max(cursor, r.endMs);
    }
    if ((totalMs || 0) - cursor >= minKeep) segs.push({ startMs: cursor, endMs: totalMs });
    /* pad 를 무음 쪽으로 밀어 넣어 말끝이 잘리지 않게 한다 */
    return segs.map(function (s, idx) {
      var start = Math.max(0, s.startMs - pad);
      var end = Math.min(totalMs, s.endMs + pad);
      if (idx > 0) start = Math.max(start, segs[idx - 1].endMs + 1);
      return { startMs: Math.round(start), endMs: Math.round(end), durMs: Math.round(end - start) };
    }).filter(function (s) { return s.durMs >= minKeep; });
  }

  function totalDuration(segs) {
    return sum((segs || []).map(function (s) { return Math.max(0, s.endMs - s.startMs); }));
  }

  /** 아주 가까운 구간(기본 120ms 이하)은 붙인다 → 클립 경계가 덜게 된다. */
  function mergeSegments(segs, gapMs) {
    var gap = gapMs === undefined ? 120 : gapMs;
    var out = [];
    (segs || []).forEach(function (s) {
      var last = out[out.length - 1];
      if (last && s.startMs - last.endMs <= gap) {
        last.endMs = Math.max(last.endMs, s.endMs);
        last.durMs = last.endMs - last.startMs;
      } else {
        out.push({ startMs: s.startMs, endMs: s.endMs, durMs: s.endMs - s.startMs });
      }
    });
    return out;
  }

  /* ── 클립 계획 ─────────────────────────────────────────── */
  /**
   * 남길 구간들을 모아 targetMs 안팎의 클립으로 나눈다.
   * 무음이 제거된 타임라인 기준이라, 클립은 여러 원본 구간을 이어 붙인다.
   */
  function planClips(segments, opts) {
    var o = opts || {};
    var target = o.targetMs || DETECT.targetClipMs;
    var minMs = o.minMs || DETECT.minClipMs;
    var maxMs = o.maxMs || DETECT.maxClipMs;
    var segs = (segments || []).filter(function (s) { return s.endMs > s.startMs; });
    var clips = [];
    var cur = null;
    var cap = Math.min(target, maxMs);

    function flush(force) {
      if (!cur) return;
      if (cur.durationMs >= minMs || force) clips.push(cur);
      else if (clips.length) {
        /* 마지막 꼬리는 버리지 않고 앞 클립에 붙인다 */
        var prev = clips[clips.length - 1];
        cur.ranges.forEach(function (r) { prev.ranges.push(r); prev.durationMs += r.durMs; });
        prev.endMs = Math.max(prev.endMs, cur.endMs);
      }
      cur = null;
    }

    segs.forEach(function (seg) {
      var pos = seg.startMs;
      while (pos < seg.endMs - 1) {
        if (!cur) cur = { startMs: pos, endMs: pos, ranges: [], durationMs: 0 };
        var room = cap - cur.durationMs;
        var left = seg.endMs - pos;
        var take;
        if (left <= room) take = left;
        else if (cur.durationMs + room >= minMs) take = Math.max(0, room);
        else take = Math.min(left, maxMs - cur.durationMs);
        if (take < 1) { flush(false); continue; }
        cur.ranges.push({ startMs: pos, endMs: pos + take, durMs: take });
        cur.durationMs += take;
        cur.endMs = pos + take;
        pos += take;
        if (cur.durationMs >= cap - 1 || cur.durationMs >= maxMs) flush(false);
      }
    });
    /* 마지막 자투리는 앞 클립에 붙인다(2초짜리 꼬리 클립 방지) */
    flush(clips.length === 0);
    if (clips.length > 1) {
      var tail = clips[clips.length - 1];
      if (tail.durationMs < minMs) {
        clips.pop();
        var host = clips[clips.length - 1];
        if (host.durationMs + tail.durationMs <= maxMs) {
          tail.ranges.forEach(function (r) { host.ranges.push(r); host.durationMs += r.durMs; });
          host.endMs = Math.max(host.endMs, tail.endMs);
        } else {
          clips.push(tail);
        }
      }
    }
    clips = clips.filter(function (c) { return c.durationMs >= 250; });
    return clips.map(function (c, i) {
      var startMs = c.ranges.length ? c.ranges[0].startMs : c.startMs;
      var endMs = c.ranges.length ? c.ranges[c.ranges.length - 1].endMs : c.endMs;
      return {
        id: 'clip-' + (i + 1),
        index: i,
        startMs: startMs,
        endMs: endMs,
        durationMs: Math.round(c.durationMs),
        ranges: c.ranges.map(function (r) {
          return { startMs: Math.round(r.startMs), endMs: Math.round(r.endMs), durMs: Math.round(r.endMs - r.startMs) };
        }),
        score: 0,
        title: '',
        hook: '',
        hashtags: [],
        selected: false,
        speechRatio: 1,
        source: 'auto'
      };
    });
  }

  /* ── 장면 컷 ───────────────────────────────────────────── */
  function histDiff(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    var sa = 0, sb = 0, d = 0;
    for (var i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; d += Math.abs(a[i] - b[i]); }
    var norm = Math.max(1e-6, sa + sb);
    return clamp(d / norm, 0, 1);
  }

  function sigDiff(a, b) {
    if (!a || !b || !a.length || a.length !== b.length) return 0;
    var acc = 0;
    for (var i = 0; i < a.length; i++) acc += Math.abs(a[i] - b[i]);
    return clamp(acc / a.length, 0, 1);
  }

  /** 두 표본 프레임의 차이 성분(구조·히스토그램·색·밝기) */
  function frameDiff(a, b) {
    var struct = sigDiff(a.sig, b.sig);
    var hist = histDiff(a.hist, b.hist);
    var lum = Math.abs((a.lum || 0) - (b.lum || 0));
    var color = 0;
    if (a.color && b.color && a.color.length === 3) {
      color = (Math.abs(a.color[0] - b.color[0]) + Math.abs(a.color[1] - b.color[1]) + Math.abs(a.color[2] - b.color[2])) / 3;
    }
    return {
      tMs: b.tMs,
      struct: struct,
      hist: hist,
      lum: lum,
      color: color,
      score: clamp(struct * 0.52 + hist * 0.26 + color * 1.6 + lum * 0.18, 0, 1)
    };
  }

  /** 연속 표본의 차이 목록 — 감도 조절과 검사에 함께 쓴다. */
  function sceneDiffs(frames) {
    var list = (frames || []).slice().sort(function (a, b) { return a.tMs - b.tMs; });
    var out = [];
    for (var i = 1; i < list.length; i++) out.push(frameDiff(list[i - 1], list[i]));
    return out;
  }

  /**
   * 표본 프레임의 구조·색·밝기 변화로 장면 전환 후보를 찾는다.
   * 고정 임계치가 아니라 '이 영상 안에서의 튐'을 본다(중앙값 + 2.8×MAD).
   */
  function sceneCuts(frames, sensitivity) {
    var list = (frames || []).slice().sort(function (a, b) { return a.tMs - b.tMs; });
    if (list.length < 3) return [];
    var diffs = sceneDiffs(list);
    var values = diffs.map(function (d) { return d.score; });
    var med = median(values);
    var spread = mad(values, med) || 0.012;
    var sens = sensitivity === undefined ? DETECT.sceneSensitivity : sensitivity;
    var base = 0.045 + clamp(sens, 0, 1) * 0.11;
    var thr = Math.max(base, med + 2.8 * spread);
    var cuts = [];
    diffs.forEach(function (d) {
      if (d.score < thr) return;
      var last = cuts[cuts.length - 1];
      if (last && d.tMs - last.tMs < 700) {
        if (d.score > last.strength) { last.tMs = d.tMs; last.strength = d.score; }
        return;
      }
      cuts.push({ tMs: d.tMs, strength: round(d.score, 3), struct: round(d.struct, 3), color: round(d.color, 3) });
    });
    return cuts;
  }

  /** 클립 경계를 가까운 장면 컷에 붙인다(최대 windowMs). */
  function snapClips(clips, cuts, windowMs) {
    var win = windowMs === undefined ? 1400 : windowMs;
    if (!cuts || !cuts.length) return clips;
    return (clips || []).map(function (c) {
      var bestStart = null, bestEnd = null;
      cuts.forEach(function (cut) {
        if (Math.abs(cut.tMs - c.startMs) <= win && (bestStart === null || Math.abs(cut.tMs - c.startMs) < Math.abs(bestStart - c.startMs))) bestStart = cut.tMs;
        if (Math.abs(cut.tMs - c.endMs) <= win && (bestEnd === null || Math.abs(cut.tMs - c.endMs) < Math.abs(bestEnd - c.endMs))) bestEnd = cut.tMs;
      });
      if (bestStart === null && bestEnd === null) return c;
      var start = bestStart === null ? c.startMs : bestStart;
      var end = bestEnd === null ? c.endMs : bestEnd;
      if (end - start < 2500) return c;
      var next = Object.assign({}, c);
      next.startMs = start;
      next.endMs = end;
      next.snapped = true;
      /* 경계가 바뀌면 이어 붙이는 구간도 다시 계산한다 */
      next.ranges = trimRanges(c.ranges, start, end);
      next.durationMs = Math.round(totalDuration(next.ranges));
      return next;
    });
  }

  /** 원본 구간 목록을 [start,end] 창에 맞춰 자른다(무음 제거 타임라인 유지). */
  function trimRanges(ranges, startMs, endMs) {
    var out = [];
    (ranges || []).forEach(function (r) {
      var s = Math.max(r.startMs, startMs);
      var e = Math.min(r.endMs, endMs);
      if (e - s > 30) out.push({ startMs: Math.round(s), endMs: Math.round(e), durMs: Math.round(e - s) });
    });
    return out;
  }

  /* ── 점수 ─────────────────────────────────────────────── */
  function rangeOverlap(aStart, aEnd, bStart, bEnd) {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  }

  /**
   * 클립 점수(0~100): 말이 빽빽한가 + 움직임 + 장면 전환 + 길이 적합도.
   * frames: [{tMs, motion:number}] (motion 은 0~1 표본)
   */
  function scoreClips(clips, ctx) {
    var c = ctx || {};
    var frames = c.frames || [];
    var cuts = c.cuts || [];
    var target = c.targetMs || DETECT.targetClipMs;
    return (clips || []).map(function (clip) {
      var speechRatio = 1;
      if (clip.ranges && clip.ranges.length && c.segments) {
        var speech = 0;
        clip.ranges.forEach(function (r) {
          speech += (c.segments || []).reduce(function (acc, s) { return acc + rangeOverlap(r.startMs, r.endMs, s.startMs, s.endMs); }, 0);
        });
        speechRatio = clamp(speech / Math.max(1, clip.durationMs), 0, 1);
      }
      var inside = frames.filter(function (f) { return f.tMs >= clip.startMs && f.tMs <= clip.endMs; });
      var motion = inside.length ? sum(inside.map(function (f) { return f.motion || 0; })) / inside.length : 0;
      var cutCount = cuts.filter(function (x) { return x.tMs > clip.startMs && x.tMs < clip.endMs; }).length;
      var fit = 1 - clamp(Math.abs(clip.durationMs - target) / Math.max(target, 1), 0, 1);
      var score = 100 * (0.34 * speechRatio + 0.30 * clamp(motion * 3.2, 0, 1) + 0.16 * clamp(cutCount / 2, 0, 1) + 0.20 * fit);
      var next = Object.assign({}, clip);
      next.speechRatio = round(speechRatio, 3);
      next.motion = round(motion, 3);
      next.cutCount = cutCount;
      next.score = Math.round(clamp(score, 1, 99));
      return next;
    });
  }

  /** 점수 상위 n개를 고르되 화면에는 시간 순서로 보여 준다. */
  function pickHighlights(clips, n) {
    var count = Math.max(1, Math.min(clips.length, n || DETECT.clipCount));
    var ranked = clips.map(function (c, i) { return { i: i, score: c.score || 0 }; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, count)
      .map(function (x) { return x.i; });
    return clips.map(function (c, i) {
      var next = Object.assign({}, c);
      next.selected = ranked.indexOf(i) >= 0;
      return next;
    });
  }

  /* ── 리프레임(9:16 크롭 추적) ─────────────────────────── */
  function normalizeCols(arr) {
    var max = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    if (!(max > 0)) return new Float32Array(arr.length);
    var out = new Float32Array(arr.length);
    for (var j = 0; j < arr.length; j++) out[j] = arr[j] / max;
    return out;
  }

  function smoothProfile(arr) {
    var out = new Float32Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      out[i] = 0.25 * (arr[i - 1] || 0) + 0.5 * arr[i] + 0.25 * (arr[i + 1] || 0);
    }
    return out;
  }

  /**
   * 한 프레임의 열(column) 점수 → 크롭 중심 x(0~1).
   * skin/motion 은 같은 길이의 배열(열별 값). mode: subject|motion|center
   */
  function trackCenter(frame, mode) {
    var cols = (frame && frame.skin && frame.skin.length) || 64;
    if (mode === 'center' || !frame) return 0.5;
    var skin = normalizeCols(frame.skin || new Float32Array(cols));
    var motion = normalizeCols(frame.motion || new Float32Array(cols));
    var profile = new Float32Array(cols);
    var centerPrior = new Float32Array(cols);
    for (var i = 0; i < cols; i++) {
      var x = (i + 0.5) / cols;
      centerPrior[i] = Math.max(0, 1 - Math.abs(x - 0.5) * 1.9);
      var w = mode === 'motion'
        ? 0.72 * motion[i] + 0.18 * skin[i] + 0.10 * centerPrior[i]
        : 0.60 * skin[i] + 0.30 * motion[i] + 0.10 * centerPrior[i];
      profile[i] = w;
    }
    var feature = 0;
    for (var f = 0; f < cols; f++) {
      if ((frame.skin && frame.skin[f] > feature) || (frame.motion && frame.motion[f] > feature)) {
        feature = Math.max(frame.skin ? frame.skin[f] : 0, frame.motion ? frame.motion[f] : 0);
      }
    }
    if (feature < 0.08) return 0.5; // 피부톤도 움직임도 없으면 중앙
    profile = smoothProfile(profile);
    var best = 0;
    for (var k = 1; k < cols; k++) if (profile[k] > profile[best]) best = k;
    if (profile[best] < 0.06) return 0.5;
    var lo = Math.max(0, best - 8);
    var hi = Math.min(cols - 1, best + 8);
    var weight = 0, acc = 0;
    for (var j = lo; j <= hi; j++) {
      var wj = profile[j] * profile[j];
      weight += wj;
      acc += wj * (j + 0.5) / cols;
    }
    return weight > 0 ? clamp(acc / weight, 0, 1) : 0.5;
  }

  /**
   * 표본별 중심점 → 부드러운 카메라 곡선.
   * opts: {smooth 0~1, deadzone, maxStep(표본당 최대 이동)}
   */
  function buildCurve(points, opts) {
    var o = opts || {};
    var smooth = clamp(o.smooth === undefined ? 0.72 : o.smooth, 0, 0.98);
    var deadzone = o.deadzone === undefined ? 0.012 : o.deadzone;
    var maxStep = o.maxStep === undefined ? 0.055 : o.maxStep;
    var pts = (points || []).slice().sort(function (a, b) { return a.tMs - b.tMs; });
    if (!pts.length) return [];
    var alpha = clamp(1 - smooth * 0.92, 0.08, 1);
    var out = [];
    var y = clamp(pts[0].x, 0, 1);
    var last = y;
    pts.forEach(function (p) {
      var target = clamp(p.x, 0, 1);
      if (Math.abs(target - y) > deadzone) {
        y += alpha * (target - y);
      }
      if (y - last > maxStep) y = last + maxStep;
      if (last - y > maxStep) y = last - maxStep;
      out.push({ tMs: p.tMs, x: clamp(y, 0, 1) });
      last = y;
    });
    /* 뒤에서 한 번 더 다듬어 앞서가는 느낌을 줄인다(비대칭 없이) */
    for (var i = out.length - 2; i >= 0; i--) {
      out[i].x = clamp(out[i].x * 0.72 + out[i + 1].x * 0.28, 0, 1);
    }
    return out.map(function (p) { return { tMs: p.tMs, x: round(p.x, 4) }; });
  }

  function curveAt(curve, tMs) {
    if (!curve || !curve.length) return 0.5;
    if (tMs <= curve[0].tMs) return curve[0].x;
    var last = curve[curve.length - 1];
    if (tMs >= last.tMs) return last.x;
    var lo = 0, hi = curve.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (curve[mid].tMs <= tMs) lo = mid; else hi = mid;
    }
    var a = curve[lo], b = curve[hi];
    var t = (tMs - a.tMs) / Math.max(1, b.tMs - a.tMs);
    return clamp(lerp(a.x, b.x, t), 0, 1);
  }

  /** 16:9(또는 임의 비율) 원본 → 9:16 크롭 사각형. centerX 0~1, zoom 1~2 */
  function cropRect(srcW, srcH, outW, outH, centerX, zoom, centerY) {
    var aspect = outW / outH;
    var z = clamp(zoom || 1, 1, 2.5);
    var cropW, cropH;
    if (srcW / srcH > aspect) {
      cropH = srcH / z;
      cropW = cropH * aspect;
    } else {
      cropW = srcW / z;
      cropH = cropW / aspect;
    }
    cropW = Math.min(cropW, srcW);
    cropH = Math.min(cropH, srcH);
    var cx = clamp(centerX === undefined ? 0.5 : centerX, 0, 1) * srcW;
    var cy = clamp(centerY === undefined ? 0.5 : centerY, 0, 1) * srcH;
    var x = clamp(cx - cropW / 2, 0, Math.max(0, srcW - cropW));
    var y = clamp(cy - cropH / 2, 0, Math.max(0, srcH - cropH));
    return { x: x, y: y, w: cropW, h: cropH };
  }

  /* ── 자막 ─────────────────────────────────────────────── */
  var TAG_RE = /<[^>]+>/g;

  function cleanCueText(text) {
    return String(text || '')
      .replace(TAG_RE, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/\u200b/g, '')
      .replace(/\r/g, '')
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  /**
   * SRT / VTT 를 같은 모양으로 읽는다.
   * @returns {{format:'srt'|'vtt'|'', cues:Array, warnings:string[]}}
   */
  function parseSubtitles(text) {
    var raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var warnings = [];
    var format = '';
    if (/^\s*WEBVTT/.test(raw)) { format = 'vtt'; raw = raw.replace(/^\s*WEBVTT[^\n]*\n/, ''); }
    else if (/-->/.test(raw)) format = 'srt';
    var blocks = raw.split(/\n{2,}/);
    var cues = [];
    blocks.forEach(function (block) {
      var lines = block.split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) return;
      if (/^NOTE\b/.test(lines[0]) || /^STYLE\b/.test(lines[0])) return;
      var timeIdx = lines.findIndex(function (l) { return l.indexOf('-->') >= 0; });
      if (timeIdx < 0) return;
      var m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[timeIdx]);
      if (!m) { warnings.push('시간 표기를 읽지 못한 블록이 있습니다: ' + lines[timeIdx].slice(0, 40)); return; }
      var startMs = parseTimecode(m[1]);
      var endMs = parseTimecode(m[2]);
      if (startMs === null || endMs === null) { warnings.push('시간 값이 비어 있는 블록을 건너뛰었습니다.'); return; }
      if (endMs <= startMs) { warnings.push('끝이 시작보다 빠른 자막을 건너뛰었습니다: ' + srtTime(startMs)); return; }
      var body = cleanCueText(lines.slice(timeIdx + 1).join('\n'));
      if (!body) return;
      cues.push({ startMs: startMs, endMs: endMs, text: body });
    });
    cues.sort(function (a, b) { return a.startMs - b.startMs; });
    for (var i = 1; i < cues.length; i++) {
      if (cues[i].startMs < cues[i - 1].endMs - 30) {
        warnings.push('겹치는 자막이 있습니다: ' + srtTime(cues[i].startMs));
        break;
      }
    }
    return { format: format, cues: cues, warnings: warnings };
  }

  function serializeSRT(cues) {
    return (cues || []).map(function (c, i) {
      return (i + 1) + '\n' + srtTime(c.startMs) + ' --> ' + srtTime(c.endMs) + '\n' + String(c.text || '').trim() + '\n';
    }).join('\n');
  }

  function serializeVTT(cues) {
    return 'WEBVTT\n\n' + (cues || []).map(function (c) {
      return vttTime(c.startMs) + ' --> ' + vttTime(c.endMs) + '\n' + String(c.text || '').trim() + '\n';
    }).join('\n');
  }

  /** 전체 타임라인 자막 → 클립 안쪽 자막(0초 기준). */
  function clipCues(cues, startMs, endMs) {
    var out = [];
    (cues || []).forEach(function (c) {
      var s = Math.max(c.startMs, startMs);
      var e = Math.min(c.endMs, endMs);
      if (e - s < 60) return;
      out.push({ startMs: Math.round(s - startMs), endMs: Math.round(e - startMs), text: c.text });
    });
    return out;
  }

  function cueAt(cues, tMs) {
    for (var i = 0; i < (cues || []).length; i++) {
      var c = cues[i];
      if (tMs >= c.startMs && tMs < c.endMs) return c;
    }
    return null;
  }

  /** 쇼츠 자막 줄바꿈: 한 줄 maxChars, 최대 maxLines. 넘치면 말줄임. */
  function wrapCaption(text, maxChars, maxLines) {
    var limit = Math.max(6, maxChars || 13);
    var lines = Math.max(1, maxLines || 2);
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    var words = clean.split(' ');
    var out = [];
    var cur = '';
    words.forEach(function (w) {
      if (!cur) { cur = w; return; }
      if ((cur + ' ' + w).length <= limit) cur += ' ' + w;
      else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    /* 한 단어가 너무 길면 글자 단위로 자른다 */
    var flat = [];
    out.forEach(function (line) {
      if (line.length <= limit) { flat.push(line); return; }
      for (var i = 0; i < line.length; i += limit) flat.push(line.slice(i, i + limit));
    });
    if (flat.length > lines) {
      flat = flat.slice(0, lines);
      var last = flat[lines - 1];
      flat[lines - 1] = last.length > limit - 1 ? last.slice(0, limit - 1) + '…' : last + '…';
    }
    return flat;
  }

  /* ── AI 훅 ─────────────────────────────────────────────── */
  function buildHookPrompt(meta) {
    var m = meta || {};
    var lines = (m.captions || []).join(' / ').slice(0, 900);
    var system = '너는 한국어 숏폼 편집자다. 과장·AI 말투 없이, 실제 영상에 나온 말만 근거로 쓴다.';
    var prompt = [
      '아래는 긴 영상에서 잘라 낸 9:16 클립의 정보와 자막이다.',
      '클립 길이: ' + ((m.durationMs || 0) / 1000).toFixed(1) + '초',
      '원본 제목: ' + (m.sourceName || '이름 없음'),
      '자막: ' + (lines || '(자막 없음 — 장면 흐름만 참고)'),
      '',
      '다음을 JSON 하나로만 답해라. 설명, 코드펜스, 인사말 금지.',
      '{"title":"20자 이내 제목","hook":"첫 2초에 읽을 한 문장(24자 이내)","hashtags":["태그1","태그2","태그3"],"caption":"업로드용 한 줄 설명(60자 이내)"}',
      '규칙: 숫자·고유명사는 주어진 정보에 있을 때만. 없는 사실을 만들지 마라. 해시태그는 3~5개, # 없이.'
    ].join('\n');
    return { system: system, prompt: prompt };
  }

  function stripFence(text) {
    var raw = String(text || '').trim();
    var fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(raw);
    if (fence && fence[1].trim()) return fence[1].trim();
    return raw;
  }

  function normalizeTags(list) {
    var out = [];
    (list || []).forEach(function (t) {
      var v = String(t === null || t === undefined ? '' : t).replace(/^#+/, '').replace(/[^\w가-힣]/g, '').trim();
      if (v && v.length <= 20 && out.indexOf(v) < 0) out.push(v);
    });
    return out.slice(0, 6);
  }

  /** 모델 응답(설명 섞임/코드펜스 허용) → 훅 묶음 */
  function parseHookJSON(text) {
    var body = stripFence(text);
    var value = null;
    try { value = JSON.parse(body); } catch (e) { value = null; }
    if (!value) {
      var s = body.indexOf('{');
      var e2 = body.lastIndexOf('}');
      if (s >= 0 && e2 > s) {
        try { value = JSON.parse(body.slice(s, e2 + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e3) { value = null; }
      }
    }
    if (!value || typeof value !== 'object') {
      return { ok: false, reason: 'not_json', title: '', hook: '', hashtags: [], caption: '' };
    }
    var title = String(value.title || value.제목 || '').trim().slice(0, 60);
    var hook = String(value.hook || value.훅 || '').trim().slice(0, 90);
    var caption = String(value.caption || value.설명 || '').trim().slice(0, 160);
    var tags = normalizeTags(value.hashtags || value.tags || value.해시태그 || []);
    if (!title && !hook && !tags.length) {
      return { ok: false, reason: 'empty_fields', title: title, hook: hook, hashtags: tags, caption: caption };
    }
    return { ok: true, reason: '', title: title, hook: hook, hashtags: tags, caption: caption };
  }

  /* ══ 자막 → 스토리·재미 구간 추천 ════════════════════════
     자막 타임코드 + 대사만 보고 숏폼으로 잘라 쓸 구간을 고른다.
     AI 가 있으면 AI 가, 없으면 아래 규칙(휴리스틱)이 같은 모양으로 답한다.
     구간마다 '새로 쓴 설명 자막'(commentaryCues)을 함께 만든다 —
     원본 대사를 그대로 옮기는 것이 아니라 클립 안에서 해석·요약·반전을 짚는 자막이다. */
  var STORY = {
    count: 4,
    countMin: 3,
    countMax: 6,
    minSec: 6,
    maxSec: 20,
    commentaryMax: 4,
    commentaryStyle: 'badge',
    promptChars: 1900
  };

  var STORY_SIGNAL_WORDS = {
    question: /\?|(까|나요|죠|을까|ㄹ까)\s*$/,
    number: /[0-9]|(한|두|세|네|다섯|백|천|만|퍼센트|프로)\s|%/,
    contrast: /(근데|그런데|하지만|그러나|사실|반대로|아니라|못 |안 )/,
    emotion: /(진짜|대박|미쳤|충격|놀라|빨라|늦어|힘들|쉽|어렵|무섭|최고|최악|완전|딱)/,
    reveal: /(포인트|핵심|이유|비결|방법|결국|정답|비밀|바로)/,
    cta: /(끝|시작|지금|한 번에|구독|저장)/
  };

  var STORY_TAG_WEIGHT = {
    question: 1.15, number: 0.8, contrast: 0.72, emotion: 0.85, reveal: 0.6, cta: 0.35
  };

  var STORY_REASON = {
    question: '질문으로 열어 끝까지 궁금하게 만드는 구간입니다',
    number: '숫자가 들어 있어 스크롤을 멈추게 하는 구간입니다',
    contrast: '앞말을 뒤집는 반전이 있어 잘린 클립에서도 힘이 있습니다',
    emotion: '감정이 드러나는 한마디가 훅 역할을 합니다',
    reveal: '핵심을 짚는 대목이라 정보 가치가 큽니다',
    cta: '마무리 문장이 남아 다음 행동을 부릅니다'
  };

  /** 데모 VOD 대본 → 자막 큐. 화면·소리·자막이 같은 대본에서 나온다. */
  function demoCues() {
    var cues = [];
    (DEMO.speech || []).forEach(function (sp) {
      var words = String(sp.line || '').split(' ');
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

  function demoSrt() {
    return serializeSRT(demoCues());
  }

  /** 한 구간에 걸친 자막을 한 줄로 — 훅·이유·해설 초안의 재료. */
  function cueRangeText(cues, startMs, endMs, maxChars) {
    var parts = [];
    (cues || []).forEach(function (c) {
      if (c.endMs <= startMs || c.startMs >= endMs) return;
      var t = String(c.text || '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    });
    var joined = parts.join(' ');
    var limit = Math.max(4, maxChars || 80);
    if (joined.length > limit) joined = joined.slice(0, limit - 1).trim() + '…';
    return joined;
  }

  /**
   * AI 프롬프트에 넣을 자막을 글자 수 예산 안으로 압축한다.
   * 예산이 넘으면 앞에서부터 균등 간격으로 솎아 낸다(시간 범위는 유지).
   */
  function compactCues(cues, maxChars) {
    var limit = Math.max(200, maxChars || STORY.promptChars);
    var list = (cues || []).filter(function (c) { return c && c.text; })
      .slice().sort(function (a, b) { return a.startMs - b.startMs; });
    if (!list.length) return { text: '', lines: [], kept: 0, total: 0, step: 1 };
    function lineFor(c) {
      var t = String(c.text).replace(/\s+/g, ' ').trim().slice(0, 70);
      return '[' + (c.startMs / 1000).toFixed(1) + '-' + (c.endMs / 1000).toFixed(1) + '] ' + t;
    }
    var step = 1;
    var lines = list.map(lineFor);
    var total = lines.join('\n').length;
    while (total > limit && step < list.length) {
      step++;
      lines = list.filter(function (_, i) { return i % step === 0 || i === list.length - 1; }).map(lineFor);
      total = lines.join('\n').length;
    }
    var text = lines.join('\n');
    if (text.length > limit) text = text.slice(0, limit - 16) + '\n…(자막 일부 생략)';
    return { text: text, lines: lines, kept: lines.length, total: list.length, step: step };
  }

  /** AI 에 보낼 스토리 구간 추천 프롬프트. 무료 맛보기 2,000자 제한 안쪽으로 만든다. */
  function buildStoryPrompt(meta) {
    var m = meta || {};
    var cues = m.cues || [];
    var durMs = m.durationMs || (cues.length ? cues[cues.length - 1].endMs : 0);
    var count = clamp(Math.round(m.count || STORY.count), STORY.countMin, STORY.countMax);
    var minSec = m.minSec || STORY.minSec;
    var maxSec = m.maxSec || STORY.maxSec;
    var packed = compactCues(cues, (m.promptChars || STORY.promptChars) - 780);
    var system = '너는 한국어 숏폼 편집자다. 주어진 자막만 근거로 쓰고, 없는 사실·숫자·이름은 만들지 않는다.';
    var prompt = [
      '긴 영상 원본을 9:16 숏폼 클립으로 다시 잘라 새 콘텐츠로 만들려고 한다.',
      '영상 길이: ' + (durMs / 1000).toFixed(1) + '초',
      '원본 제목: ' + (m.sourceName || '이름 없음'),
      '원하는 구간 수: ' + count + '개 (3~6개)',
      '구간 길이: ' + minSec + '~' + maxSec + '초',
      '',
      '자막(시작-끝 | 대사):',
      packed.text,
      '',
      '다음 형식의 JSON 배열 하나로만 답해라. 설명·코드펜스·인사말 금지.',
      '[{"startSec":0,"endSec":8.4,"title":"20자 이내 제목","hook":"첫 2초에 읽을 한 문장(24자 이내)","reason":"왜 스토리·재미·반전 포인트인지 한 줄","hashtags":["태그","태그","태그"],"score":87,"commentaryCues":[{"offsetSec":0,"endOffsetSec":2.4,"text":"상황을 짚는 설명 자막"},{"offsetSec":3.2,"endOffsetSec":6.5,"text":"핵심 포인트 해설"}]}]',
      '',
      '규칙:',
      '- startSec·endSec는 위 자막 시간(초) 안에서 고르고, 구간끼리 겹치지 않는다.',
      '- title·hook·commentaryCues는 원본 대사를 그대로 베끼지 말고, 시청자가 바로 이해하도록 새로 쓴 해석·설명으로 만든다.',
      '- commentaryCues는 구간마다 2~4개. offsetSec은 클립 시작 기준 초이며 클립 길이를 넘지 않는다.',
      '- 첫 해설은 상황 요약, 가운데는 핵심 포인트, 마지막은 한 줄 해석으로 배치한다.'
    ].join('\n');
    return { system: system, prompt: prompt, packed: packed, count: count, minSec: minSec, maxSec: maxSec, durationMs: durMs };
  }

  function pickKey(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  }

  function numberOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (/:/.test(s)) { var t = parseTimecode(s); return t === null ? null : t; }
    var n = Number(s.replace(/,/g, '.').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  /** 초/밀리초가 섞여 오는 응답을 영상 길이에 맞춰 초로 정리한다. */
  function secondsOf(v, durMs) {
    var n = numberOrNull(v);
    if (n === null) return null;
    if (n > 3600000) n = n / 1000; // 시간 표기를 초로 읽은 경우
    /* 영상보다 긴 값인데 ms 로 보이면(1,000 이상) ms 로 읽는다. */
    if (durMs && n > (durMs / 1000) * 1.08 && n >= 1000 && n <= durMs * 1.05) n = n / 1000;
    return n;
  }

  /** 모델이 준 해설 큐를 클립 안 타임라인(ms)으로 정리한다. */
  function normalizeCommentary(list, durMs) {
    var out = [];
    var total = Math.max(1000, durMs || 0);
    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (!item) return;
      if (typeof item === 'string') {
        var plain = String(item).trim();
        if (plain) out.push({ startMs: 0, endMs: Math.min(total, 2200), text: plain.slice(0, 80) });
        return;
      }
      var text = pickKey(item, ['text', 'caption', 'line', '문장', '해설', '내용', '자막']);
      if (text === null) return;
      text = String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!text) return;
      /* startMs/endMs 는 이미 밀리초, offsetSec/startSec 는 초로 읽는다. */
      var explicitMs = numberOrNull(pickKey(item, ['startMs', 'offsetMs']));
      var explicitEndMs = numberOrNull(pickKey(item, ['endMs', 'endOffsetMs']));
      var off = explicitMs === null
        ? numberOrNull(pickKey(item, ['offsetSec', 'startSec', 'offset', 'start', '시작', '시작초']))
        : null;
      var endOff = explicitEndMs === null
        ? numberOrNull(pickKey(item, ['endOffsetSec', 'endSec', 'endOffset', 'end', '끝', '끝초']))
        : null;
      var startMs;
      var endMs;
      if (explicitMs !== null) {
        startMs = Math.round(clamp(explicitMs, 0, total));
      } else {
        if (off === null) off = 0;
        if (off > total * 1.08 && off <= total * 1.6) off = off / 1000;
        startMs = Math.round(clamp(off * 1000, 0, total));
      }
      if (explicitEndMs !== null) {
        endMs = Math.round(clamp(explicitEndMs, 0, total));
      } else {
        if (endOff === null) endOff = (explicitMs !== null ? explicitMs / 1000 : off) + 2.2;
        if (endOff > total * 1.08 && endOff <= total * 1.6) endOff = endOff / 1000;
        endMs = Math.round(clamp(endOff * 1000, 0, total));
      }
      if (endMs - startMs < 400) endMs = Math.min(total, startMs + 1800);
      if (endMs - startMs < 300) return;
      out.push({ startMs: startMs, endMs: endMs, text: text });
    });
    out.sort(function (a, b) { return a.startMs - b.startMs; });
    /* 겹치는 해설은 뒤엣것을 밀어 겹치지 않게 한다 */
    for (var i = 1; i < out.length; i++) {
      if (out[i].startMs < out[i - 1].endMs) out[i].startMs = Math.min(out[i].endMs - 200, out[i - 1].endMs);
      if (out[i].endMs <= out[i].startMs) out[i].endMs = Math.min(total, out[i].startMs + 800);
    }
    return out.slice(0, STORY.commentaryMax);
  }

  /**
   * 모델 응답(설명 섞임·코드펜스·한글 키 허용) → 스토리 구간 목록.
   * @returns {{ok:boolean, reason:string, segments:Array}}
   */
  function parseStoryJSON(text, opts) {
    var o = opts || {};
    var durMs = Math.max(0, o.durationMs || 0);
    var minMs = Math.max(1000, Math.round((o.minSec || 3) * 1000));
    var maxCount = o.maxCount || STORY.countMax;
    var body = stripFence(text);
    var raw = null;
    var arrStart = body.indexOf('[');
    var arrEnd = body.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      try { raw = JSON.parse(body.slice(arrStart, arrEnd + 1).replace(/,\s*([}\]]])/g, '$1')); } catch (e) { raw = null; }
    }
    if (!raw) {
      var s = body.indexOf('{');
      var e2 = body.lastIndexOf('}');
      if (s >= 0 && e2 > s) {
        try { raw = JSON.parse(body.slice(s, e2 + 1).replace(/,\s*([}\]]])/g, '$1')); } catch (e3) { raw = null; }
      }
    }
    if (raw && !Array.isArray(raw)) {
      var list = pickKey(raw, ['segments', 'clips', '구간', 'items', 'shots', 'result', 'highlights']);
      raw = Array.isArray(list) ? list : null;
    }
    if (!Array.isArray(raw) || !raw.length) return { ok: false, reason: 'not_json', segments: [] };

    var segs = [];
    raw.forEach(function (item, idx) {
      if (!item || typeof item !== 'object') return;
      var explicitStart = numberOrNull(pickKey(item, ['startMs', 'start_ms']));
      var explicitEnd = numberOrNull(pickKey(item, ['endMs', 'end_ms']));
      var start = explicitStart !== null ? explicitStart / 1000 : secondsOf(pickKey(item, ['startSec', 'start', '시작초', '시작', 'startTime']), durMs);
      var end = explicitEnd !== null ? explicitEnd / 1000 : secondsOf(pickKey(item, ['endSec', 'end', '끝초', '끝', 'endTime']), durMs);
      if (start === null || end === null) return;
      var startMs = Math.round(start * 1000);
      var endMs = Math.round(end * 1000);
      if (durMs) { startMs = clamp(startMs, 0, durMs); endMs = clamp(endMs, 0, durMs); }
      if (endMs <= startMs) return;
      if (endMs - startMs < minMs) return;
      var commentary = normalizeCommentary(
        pickKey(item, ['commentaryCues', 'commentary', '해설자막', '해설', 'commentCues']),
        endMs - startMs
      );
      var score = numberOrNull(pickKey(item, ['score', '추천도', 'rating']));
      segs.push({
        startMs: startMs,
        endMs: endMs,
        startSec: round(startMs / 1000, 1),
        endSec: round(endMs / 1000, 1),
        durationMs: endMs - startMs,
        title: String(pickKey(item, ['title', '제목', 'headline']) || '').trim().slice(0, 60),
        hook: String(pickKey(item, ['hook', '훅', 'firstLine']) || '').trim().slice(0, 90),
        reason: String(pickKey(item, ['reason', '이유', 'why']) || '').trim().slice(0, 140),
        hashtags: normalizeTags(pickKey(item, ['hashtags', 'tags', '해시태그']) || []),
        score: score === null ? Math.max(40, 95 - idx * 7) : Math.round(clamp(score, 1, 99)),
        commentaryCues: commentary
      });
    });
    if (!segs.length) return { ok: false, reason: 'no_valid_segment', segments: [] };
    segs.sort(function (a, b) { return a.startMs - b.startMs; });
    var kept = [];
    segs.forEach(function (s) {
      var dup = kept.some(function (k) {
        var ov = rangeOverlap(k.startMs, k.endMs, s.startMs, s.endMs);
        return ov > 0.6 * Math.min(k.durationMs, s.durationMs);
      });
      if (!dup) kept.push(s);
    });
    kept = kept.slice(0, maxCount);
    kept.forEach(function (s, i) { s.index = i; });
    return { ok: true, reason: '', segments: kept };
  }

  /** 대사 한 줄의 신호(질문·숫자·반전·감정·핵심·마무리) */
  function cueSignals(text) {
    var t = String(text || '');
    var hits = [];
    var score = 0;
    Object.keys(STORY_SIGNAL_WORDS).forEach(function (tag) {
      if (STORY_SIGNAL_WORDS[tag].test(t)) {
        hits.push(tag);
        score += STORY_TAG_WEIGHT[tag] || 0.3;
      }
    });
    var len = t.replace(/\s/g, '').length;
    if (len >= 5 && len <= 26) score += 0.3;
    else if (len < 4) score -= 0.25;
    return { score: round(score, 3), tags: hits };
  }

  function shortenText(text, limit) {
    var s = String(text || '').replace(/\s+/g, ' ').replace(/[.?!,]+$/, '').trim();
    if (s.length <= limit) return s;
    var cut = s.slice(0, limit - 1);
    var sp = cut.lastIndexOf(' ');
    if (sp > limit * 0.5) cut = cut.slice(0, sp);
    return cut.trim() + '…';
  }

  var STORY_STOPWORDS = ['그리고', '그래서', '하지만', '그런데', '이제', '정말', '진짜', '이거', '저거', '그거', '우리', '여기', '거기', '그냥', '다시', '때문', '합니다', '했습니다', '니다'];
  var KOREAN_PARTICLES = ['으로서', '으로써', '에서는', '에게서', '이라고', '에서는', '에서', '에게', '까지', '부터', '보다', '처럼', '마다', '조차', '밖에', '으로', '로', '은', '는', '이', '가', '을', '를', '의', '에', '도', '와', '과', '만', '랑'];

  /** 낱말 끝의 조사를 떼어 낸다 — 해시태그·해설 초안이 '3개를'처럼 남지 않게. */
  function stripParticle(word) {
    var w = String(word || '');
    for (var i = 0; i < KOREAN_PARTICLES.length; i++) {
      var p = KOREAN_PARTICLES[i];
      /* '밖으로' → '밖으' 같은 잘린 꼴을 만들지 않는다 */
      if (p === '로' && w.slice(-2) === '으로') {
        if (w.length - 2 >= 2) return w.slice(0, w.length - 2);
        continue;
      }
      if (w.length - p.length >= 2 && w.slice(-p.length) === p) return w.slice(0, w.length - p.length);
    }
    return w;
  }

  function keyPhrases(texts, limit) {
    var counts = Object.create(null);
    (texts || []).forEach(function (t) {
      String(t || '').split(/[^0-9A-Za-z가-힣%]+/).forEach(function (w) {
        var v = stripParticle(w.replace(/[.?!,]+$/, ''));
        if (v.length < 2 || STORY_STOPWORDS.indexOf(v) >= 0) return;
        if (/(요|다|고|까|죠|며|서|면|니|러|게|지|함|됨)$/.test(v)) return;
        counts[v] = (counts[v] || 0) + 1;
      });
    });
    return Object.keys(counts)
      .sort(function (a, b) { return (counts[b] - counts[a]) || (b.length - a.length); })
      .slice(0, limit || 3);
  }

  /** 로컬 폴백 해설: 자막 구조에서 뽑은 초안. AI 없이도 '새 자막'이 붙는다. */
  function localCommentary(texts, durMs) {
    var list = (texts || []).map(function (t) { return String(t || '').trim(); }).filter(Boolean);
    var total = Math.max(1000, Math.round(durMs || 0));
    if (!list.length) return [];
    var lead = list[0];
    var leadSig = cueSignals(lead);
    var best = list[0];
    var bestScore = -1;
    list.forEach(function (t) {
      var sg = cueSignals(t);
      if (sg.score > bestScore) { bestScore = sg.score; best = t; }
    });
    var phrases = keyPhrases(list, 4);
    var out = [];
    var opener;
    if (leadSig.tags.indexOf('question') >= 0) opener = '질문 하나로 시작합니다';
    else if (leadSig.tags.indexOf('number') >= 0) opener = '숫자부터 짚고 갑니다';
    else if (leadSig.tags.indexOf('contrast') >= 0) opener = '여기서 말이 바뀝니다';
    else if (leadSig.tags.indexOf('emotion') >= 0) opener = '이 한마디가 핵심입니다';
    else opener = '상황부터 짚고 갑니다';
    out.push({ startMs: 0, endMs: Math.round(Math.min(2600, total * 0.34)), text: opener });

    if (total > 5200) {
      var focus = phrases.length
        ? '핵심은 "' + shortenText(phrases[0], 12) + '"'
        : '흐름이 바뀌는 지점입니다';
      out.push({ startMs: Math.round(total * 0.34), endMs: Math.round(total * 0.64), text: focus });
    }
    var closeText = phrases.length
      ? '한 줄 정리: ' + shortenText(phrases.slice(0, 2).join(' '), 18)
      : '한 줄 정리: ' + shortenText(list[list.length - 1], 16);
    out.push({ startMs: Math.round(total * 0.66), endMs: total, text: closeText });
    return normalizeCommentary(out, total);
  }

  /**
   * AI 없이 자막만으로 구간을 고른다(네트워크 실패·한도 초과 폴백).
   * 질문/숫자/반전/감정/핵심 표현과 발화 밀도·길이 적합도로 점수를 낸다.
   */
  function localStorySegments(meta) {
    var m = meta || {};
    var cues = (m.cues || []).filter(function (c) { return c && c.text && c.endMs > c.startMs; })
      .slice().sort(function (a, b) { return a.startMs - b.startMs; });
    var durMs = m.durationMs || (cues.length ? cues[cues.length - 1].endMs : 0);
    if (!cues.length || !durMs) return { segments: [], signals: [] };
    var count = clamp(Math.round(m.count || STORY.count), 1, STORY.countMax);
    var minMs = Math.max(2000, Math.round((m.minSec || STORY.minSec) * 1000));
    var maxMs = Math.max(minMs + 1000, Math.round((m.maxSec || STORY.maxSec) * 1000));
    /* 목표 길이는 '영상 길이 ÷ 원하는 개수'에 맞춘다 — 짧은 영상에서 긴 구간만 남지 않게. */
    var ideal = clamp((durMs / Math.max(1, count)) * 0.95, minMs, maxMs);
    var sig = cues.map(function (c) { return cueSignals(c.text); });

    var cands = [];
    for (var i = 0; i < cues.length; i++) {
      var best = null;
      for (var j = i; j < cues.length; j++) {
        var len = cues[j].endMs - cues[i].startMs;
        if (len > maxMs) break;
        if (len < minMs) {
          if (j < cues.length - 1) continue;
          if (len < minMs * 0.6) break; /* 꼬리 자투리(최소 길이의 60% 미만)는 구간으로 만들지 않는다 */
        }
        var cueMs = 0;
        var peak = 0;
        var peakText = cues[i].text;
        var tags = [];
        for (var k = i; k <= j; k++) {
          cueMs += cues[k].endMs - cues[k].startMs;
          if (sig[k].score > peak) { peak = sig[k].score; peakText = cues[k].text; }
          sig[k].tags.forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
        }
        var density = clamp(cueMs / Math.max(1, len), 0, 1);
        var fit = 1 - clamp(Math.abs(len - ideal) / ideal, 0, 1);
        var reveal = tags.some(function (t) { return t === 'reveal' || t === 'emotion' || t === 'contrast'; }) ? 1 : 0.3;
        var score = 100 * clamp(
          0.28 * clamp(peak / 1.6, 0, 1) +
          0.14 * clamp(sig[i].score / 1.6, 0, 1) +
          0.16 * density +
          0.22 * fit +
          0.20 * reveal, 0, 1);
        var cand = {
          startMs: cues[i].startMs,
          endMs: cues[j].endMs,
          durationMs: len,
          score: Math.round(clamp(score, 1, 99)),
          peakText: peakText,
          peakTags: tags,
          leadTags: sig[i].tags,
          leadText: cues[i].text,
          texts: cues.slice(i, j + 1).map(function (c) { return c.text; })
        };
        if (!best || cand.score > best.score) best = cand;
      }
      if (best) cands.push(best);
    }
    if (!cands.length) return { segments: [], signals: [] };

    cands.sort(function (a, b) { return b.score - a.score; });
    var picked = [];
    cands.forEach(function (c) {
      if (picked.length >= count) return;
      var clash = picked.some(function (p) {
        var ov = rangeOverlap(p.startMs, p.endMs, c.startMs, c.endMs);
        return ov > 0.22 * Math.min(p.durationMs, c.durationMs);
      });
      if (!clash) picked.push(c);
    });
    picked.sort(function (a, b) { return a.startMs - b.startMs; });

    return {
      signals: picked.map(function (c) { return c.peakTags; }),
      segments: picked.map(function (c, idx) {
        var tag = c.leadTags.concat(c.peakTags).filter(function (t) { return t !== 'cta'; })[0] || '';
        var phrases = keyPhrases(c.texts, 4);
        var tags = normalizeTags(['숏폼'].concat(phrases.slice(0, 3)));
        return {
          startMs: c.startMs,
          endMs: c.endMs,
          startSec: round(c.startMs / 1000, 1),
          endSec: round(c.endMs / 1000, 1),
          durationMs: c.durationMs,
          title: shortenText(c.peakText, 20),
          hook: shortenText(c.leadText, 24),
          reason: STORY_REASON[tag] || '대사 밀도가 높고 앞뒤가 끊기지 않는 구간입니다',
          hashtags: tags,
          score: c.score,
          commentaryCues: localCommentary(c.texts, c.durationMs),
          index: idx
        };
      })
    };
  }

  /**
   * 추천 구간 → 클립(기존 클립과 같은 모양).
   * 무음이 빠진 keep 구간에 맞춰 ranges 를 다시 계산하므로 렌더·자막 매핑이 그대로 호환된다.
   */
  function segmentsToClips(segments, opts) {
    var o = opts || {};
    var keep = (o.keep || []).filter(function (s) { return s && s.endMs > s.startMs; });
    var cues = o.cues || [];
    var durMs = o.durationMs || 0;
    var out = [];
    (segments || []).forEach(function (seg, i) {
      var s = Math.round(seg.startMs !== undefined && seg.startMs !== null ? seg.startMs : (seg.startSec || 0) * 1000);
      var e = Math.round(seg.endMs !== undefined && seg.endMs !== null ? seg.endMs : (seg.endSec || 0) * 1000);
      if (durMs) { s = clamp(s, 0, durMs); e = clamp(e, 0, durMs); }
      if (e - s < 500) return;
      var ranges;
      if (keep.length) {
        ranges = trimRanges(keep, s, e);
        if (!ranges.length) return; /* 전부 죽은 초면 클립으로 만들지 않는다 */
      } else {
        ranges = [{ startMs: s, endMs: e, durMs: e - s }];
      }
      var durationMs = Math.round(totalDuration(ranges));
      if (durationMs < 400) return;
      var speechMs = 0;
      cues.forEach(function (c) { speechMs += rangeOverlap(s, e, c.startMs, c.endMs); });
      var commentary = normalizeCommentary(seg.commentaryCues || [], durationMs);
      out.push({
        id: uid('clip'),
        index: i,
        startMs: ranges[0].startMs,
        endMs: ranges[ranges.length - 1].endMs,
        durationMs: durationMs,
        ranges: ranges,
        score: Math.round(clamp(numberOrNull(seg.score) || 50, 1, 99)),
        title: String(seg.title || '').slice(0, 60),
        hook: String(seg.hook || '').slice(0, 90),
        hashtags: normalizeTags(seg.hashtags || []),
        selected: true,
        speechRatio: round(clamp(speechMs / Math.max(1, durationMs), 0, 1), 3),
        source: 'story',
        reason: String(seg.reason || '').slice(0, 140),
        commentaryCues: commentary,
        commentarySource: o.commentarySource || (commentary.length ? 'ai' : 'local')
      });
    });
    return out;
  }

  /** 같은 구간을 두 번 담지 않도록 스토리 클립끼리 겹침을 걸러 낸다. */
  function mergeStoryClips(existing, incoming, opts) {
    var o = opts || {};
    var tol = o.overlap === undefined ? 0.5 : o.overlap;
    var list = (existing || []).slice();
    var added = [];
    var skipped = [];
    (incoming || []).forEach(function (c) {
      var dup = list.some(function (x) {
        if (x.source !== 'story' && !o.includeAll) return false;
        var ov = rangeOverlap(x.startMs, x.endMs, c.startMs, c.endMs);
        return ov > tol * Math.min(x.durationMs || 1, c.durationMs || 1);
      });
      if (dup) { skipped.push(c); return; }
      list.push(c);
      added.push(c);
    });
    list.sort(function (a, b) { return a.startMs - b.startMs; });
    list.forEach(function (c, i) { c.index = i; });
    return { clips: list, added: added, skipped: skipped };
  }

  /** 스토리 클립과 겹치는 자동·수동 클립은 지우지 않고 선택만 해제한다. */
  function deselectOverlapping(clips, applied, opts) {
    var o = opts || {};
    var ratio = o.overlap === undefined ? 0.4 : o.overlap;
    var cleared = [];
    (clips || []).forEach(function (c) {
      if (c.source === 'story') return;
      var clash = (applied || []).some(function (s) {
        var ov = rangeOverlap(c.startMs, c.endMs, s.startMs, s.endMs);
        return ov > ratio * Math.min(c.durationMs || 1, s.durationMs || 1);
      });
      if (clash && c.selected) { c.selected = false; cleared.push(c); }
    });
    return cleared;
  }

  /**
   * 자막 두 층(대사·해설)이 겹치지 않도록 세로 밴드를 계산한다.
   * 미리보기와 렌더가 같은 값을 쓴다.
   */
  function captionBands(o) {
    var opt = o || {};
    var w = opt.w || 1080;
    var h = opt.h || 1920;
    var out = { dialogue: null, commentary: null };
    var dSize = opt.dialogueSize || Math.round(h * 0.06);
    var dLines = Math.max(1, opt.dialogueLines || 1);
    var dLh = dSize * (opt.dialogueGap || 1.14);
    if (opt.dialogueOn !== false) {
      var dBase = opt.dialoguePos === 'center'
        ? h * 0.5 - (dLines * dLh) / 2 + dSize * 0.82
        : h * 0.80 - (dLines - 1) * dLh;
      out.dialogue = {
        y0: dBase - dSize * 0.95,
        y1: dBase + (dLines - 1) * dLh + dSize * 0.22,
        baseY: dBase, size: dSize, lh: dLh
      };
    }
    var cSize = opt.commentarySize || Math.round(h * 0.042);
    var cLines = Math.max(1, opt.commentaryLines || 1);
    var cLh = cSize * 1.24;
    var blockH = cLines * cLh;
    var cBase;
    if (out.dialogue) {
      /* 해설은 화면 위쪽(훅 자리)에 두고, 대사와는 최소 간격을 둔다. */
      var ceiling = out.dialogue.y0 - cSize * 0.9;
      cBase = Math.min(h * 0.44, ceiling) - (cLines - 1) * cLh;
      if (cBase - cSize * 0.95 < h * 0.14) cBase = h * 0.14 + cSize * 0.95 + (cLines - 1) * cLh;
      var bottom = cBase + (cLines - 1) * cLh + cSize * 0.22;
      if (bottom > ceiling) cBase -= (bottom - ceiling);
    } else {
      cBase = h * 0.34 - blockH / 2 + cSize * 0.82;
    }
    out.commentary = {
      y0: cBase - cSize * 0.95,
      y1: cBase + (cLines - 1) * cLh + cSize * 0.22,
      baseY: cBase, size: cSize, lh: cLh
    };
    return out;
  }

  /* ── 파일·검증 ─────────────────────────────────────────── */
  function safeName(text, fallback) {
    var base = String(text || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 48);
    return base || (fallback || 'clip');
  }

  function clipFileName(index, title, ext) {
    var n = ('0' + (index + 1)).slice(-2);
    return 'clip-' + n + (title ? '-' + safeName(title, '') : '') + '.' + (ext || 'mp4');
  }

  function zipName(date) {
    var d = date || new Date();
    return 'onetap-clips-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + '.zip';
  }

  /** 파일 앞부분이 MP4(ftyp) 인지. 실제 렌더 결과 검증에 쓴다. */
  function isMp4(bytesOrU8) {
    if (!bytesOrU8 || bytesOrU8.length < 12) return false;
    var b = bytesOrU8;
    function ch(i) { return String.fromCharCode(b[i]); }
    return ch(4) === 'f' && ch(5) === 't' && ch(6) === 'y' && ch(7) === 'p';
  }

  function mp4Boxes(u8, limit) {
    var out = [];
    var view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var off = 0;
    var end = Math.min(u8.length, limit || u8.length);
    while (off + 8 <= end && out.length < 24) {
      var size = view.getUint32(off);
      var type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      out.push({ type: type, size: size, at: off });
      if (size <= 0) break;
      off += size;
    }
    return out;
  }

  /* ── 표본 계획 ─────────────────────────────────────────── */
  /** 긴 영상도 분석이 감당되도록 표본 수를 제한한다. */
  function sampleTimes(durationMs, maxSamples, minGapMs) {
    var dur = Math.max(0, durationMs || 0);
    var cap = Math.max(8, maxSamples || 240);
    var gap = Math.max(minGapMs || 250, dur / cap);
    var times = [];
    for (var t = Math.min(500, dur / 2); t < dur; t += gap) times.push(Math.round(t));
    if (!times.length) times.push(0);
    return times;
  }

  function estimateAnalysisSamples(durationMs) {
    return sampleTimes(durationMs, 240, 250).length;
  }

  return {
    VERSION: VERSION,
    STORY: STORY,
    DETECT: DETECT,
    PRESETS: PRESETS,
    TRACK_MODES: TRACK_MODES,
    CAPTION_STYLES: CAPTION_STYLES,
    DEMO: DEMO,

    clamp: clamp,
    lerp: lerp,
    round: round,
    sum: sum,
    median: median,
    mad: mad,
    uid: uid,
    bytes: bytes,
    clock: clock,
    timecode: timecode,
    srtTime: srtTime,
    vttTime: vttTime,
    parseTimecode: parseTimecode,

    envelope: envelope,
    levelToDb: levelToDb,
    envelopeOfChannels: envelopeOfChannels,
    detectSilence: detectSilence,
    keepSegments: keepSegments,
    totalDuration: totalDuration,
    mergeSegments: mergeSegments,
    planClips: planClips,

    histDiff: histDiff,
    sigDiff: sigDiff,
    frameDiff: frameDiff,
    sceneDiffs: sceneDiffs,
    sceneCuts: sceneCuts,
    snapClips: snapClips,
    trimRanges: trimRanges,
    scoreClips: scoreClips,
    pickHighlights: pickHighlights,

    normalizeCols: normalizeCols,
    smoothProfile: smoothProfile,
    trackCenter: trackCenter,
    buildCurve: buildCurve,
    curveAt: curveAt,
    cropRect: cropRect,

    parseSubtitles: parseSubtitles,
    serializeSRT: serializeSRT,
    serializeVTT: serializeVTT,
    clipCues: clipCues,
    cueAt: cueAt,
    wrapCaption: wrapCaption,
    cleanCueText: cleanCueText,

    buildHookPrompt: buildHookPrompt,
    parseHookJSON: parseHookJSON,
    normalizeTags: normalizeTags,

    demoCues: demoCues,
    demoSrt: demoSrt,
    cueRangeText: cueRangeText,
    compactCues: compactCues,
    buildStoryPrompt: buildStoryPrompt,
    parseStoryJSON: parseStoryJSON,
    cueSignals: cueSignals,
    keyPhrases: keyPhrases,
    localCommentary: localCommentary,
    localStorySegments: localStorySegments,
    segmentsToClips: segmentsToClips,
    mergeStoryClips: mergeStoryClips,
    deselectOverlapping: deselectOverlapping,
    normalizeCommentary: normalizeCommentary,
    captionBands: captionBands,

    safeName: safeName,
    clipFileName: clipFileName,
    zipName: zipName,
    isMp4: isMp4,
    mp4Boxes: mp4Boxes,
    sampleTimes: sampleTimes,
    estimateAnalysisSamples: estimateAnalysisSamples
  };
});
