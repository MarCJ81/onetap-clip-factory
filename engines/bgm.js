/* ============================================================================
   bgm.js · 내장 BGM 합성기 (UMD, 의존성 0)
   ----------------------------------------------------------------------------
   외부 음원을 받지 않는다. OfflineAudioContext로 그 자리에서 만든다.
   저작권·Content ID 클레임 걱정이 없는 100% 합성 음악 6종:

     lofi      · Lo-fi Chill      — 따뜻한 화음 + 느린 드럼 + 바이닐 노이즈
     upbeat    · Upbeat Vlog      — 밝은 화음 + 포온더플로어 + 클랩
     cinematic · Cinematic Tension— 낮은 드론 + 불협 화음 + 스웰
     news      · News Briefing    — 뚜렷한 펄스 + 시계 초침 + 짧은 모티프
     playful   · Playful Marimba  — 마림바 아르페지오 + 셰이커
     warm      · Warm Acoustic    — 어쿠스틱 느낌의 아르페지오 + 부드러운 베이스

   예전 저장값 calm/beat 은 lofi/upbeat 로 이어 받는다.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ClipBgm = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var STYLES = [
    { id: 'lofi', label: 'Lo-fi Chill', note: '차분한 설명·브이로그' },
    { id: 'upbeat', label: 'Upbeat Vlog', note: '밝고 경쾌한 일상' },
    { id: 'cinematic', label: 'Cinematic Tension', note: '긴장·다큐·브랜드' },
    { id: 'news', label: 'News Briefing', note: '정보·이슈·랭킹' },
    { id: 'playful', label: 'Playful Marimba', note: '귀여운 팁·리스트' },
    { id: 'warm', label: 'Warm Acoustic', note: '따뜻한 이야기·감성' },
    { id: 'none', label: 'BGM 없음', note: '목소리만' }
  ];

  var ALIAS = { calm: 'lofi', beat: 'upbeat' };

  /* 화음 진행 (Hz) — 스타일마다 다른 조성 */
  var CHORDS = {
    lofi: [
      [174.61, 220.00, 261.63, 329.63],
      [130.81, 164.81, 220.00, 261.63],
      [146.83, 174.61, 220.00, 293.66],
      [196.00, 233.08, 293.66, 349.23]
    ],
    upbeat: [
      [261.63, 329.63, 392.00, 523.25],
      [196.00, 246.94, 392.00, 493.88],
      [220.00, 261.63, 329.63, 440.00],
      [174.61, 220.00, 349.23, 440.00]
    ],
    cinematic: [
      [55.00, 82.41, 110.00, 164.81],
      [58.27, 87.31, 116.54, 174.61],
      [55.00, 82.41, 110.00, 155.56],
      [49.00, 73.42, 98.00, 146.83]
    ],
    news: [
      [196.00, 293.66, 392.00, 493.88],
      [174.61, 261.63, 349.23, 440.00],
      [164.81, 246.94, 329.63, 415.30],
      [146.83, 220.00, 293.66, 369.99]
    ],
    playful: [
      [261.63, 329.63, 392.00, 523.25],
      [293.66, 349.23, 440.00, 587.33],
      [329.63, 392.00, 493.88, 659.25],
      [261.63, 329.63, 392.00, 523.25]
    ],
    warm: [
      [130.81, 196.00, 261.63, 329.63],
      [174.61, 220.00, 261.63, 349.23],
      [196.00, 246.94, 293.66, 392.00],
      [146.83, 220.00, 293.66, 349.23]
    ]
  };

  var BPM = { lofi: 76, upbeat: 112, cinematic: 60, news: 120, playful: 104, warm: 88 };

  function styleById(id) {
    var key = ALIAS[id] || id;
    return STYLES.filter(function (s) { return s.id === key; })[0] || STYLES[0];
  }

  /**
   * BGM 버퍼를 만든다.
   * @param {number} durationMs 필요한 길이
   * @param {object} opts {style, bpm, volume}
   */
  function build(durationMs, opts) {
    var o = opts || {};
    var id = ALIAS[o.style] || o.style || 'lofi';
    if (id === 'none') return Promise.resolve(null);
    if (!CHORDS[id]) id = 'lofi';
    var ms = Math.max(2000, Math.round(durationMs || 20000));
    var sr = 44100;
    var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctx) return Promise.resolve(null);

    var ctx = new Ctx(2, Math.round((ms / 1000) * sr), sr);
    var bpm = o.bpm || BPM[id] || 90;
    var beat = 60 / bpm;
    var bar = beat * 4;
    var totalSec = ms / 1000;
    var master = ctx.createGain();
    master.gain.value = o.volume === undefined ? 0.85 : o.volume;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = id === 'lofi' ? 2400 : id === 'cinematic' ? 1800 : id === 'news' ? 5200 : 6400;
    lp.Q.value = 0.5;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp);
    comp.connect(lp);
    lp.connect(ctx.destination);

    function tone(freq, t0, dur, gain, type, glideTo) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur * 0.8);
      var peak = Math.max(0.0002, gain);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.24, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    /* 마림바·어쿠스틱 플럭: 짧게 튕기고 빨리 사라진다 */
    function pluck(freq, t0, gain, type) {
      var osc = ctx.createOscillator();
      var osc2 = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'sine';
      osc2.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      osc2.frequency.setValueAtTime(freq * 2.01, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      osc.connect(g);
      osc2.connect(g);
      g.connect(master);
      osc.start(t0); osc2.start(t0);
      osc.stop(t0 + 0.5); osc2.stop(t0 + 0.5);
    }

    function noise(t0, dur, gain, hp, lpFreq) {
      var len = Math.max(1, Math.round(dur * sr));
      var buf = ctx.createBuffer(1, len, sr);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp || 5200;
      var g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f);
      if (lpFreq) {
        var l = ctx.createBiquadFilter();
        l.type = 'lowpass';
        l.frequency.value = lpFreq;
        f.connect(l);
        l.connect(g);
      } else {
        f.connect(g);
      }
      g.connect(master);
      src.start(t0);
    }

    function kick(t0, gain) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(130, t0);
      osc.frequency.exponentialRampToValueAtTime(44, t0 + 0.15);
      g.gain.setValueAtTime(gain === undefined ? 0.55 : gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    }

    function clap(t0, gain) {
      noise(t0, 0.12, gain === undefined ? 0.16 : gain, 1200, 5200);
      noise(t0 + 0.018, 0.10, (gain === undefined ? 0.16 : gain) * 0.7, 1400, 5200);
    }

    function hat(t0, gain) {
      noise(t0, 0.045, gain === undefined ? 0.07 : gain, 7600);
    }

    /* 바이닐 노이즈: lo-fi 전용 얇은 잡음 바닥 */
    if (id === 'lofi') {
      var vlen = Math.round(totalSec * sr);
      var vbuf = ctx.createBuffer(1, vlen, sr);
      var vd = vbuf.getChannelData(0);
      var last = 0;
      for (var vi = 0; vi < vlen; vi++) {
        var white = Math.random() * 2 - 1;
        last = last * 0.92 + white * 0.08;
        vd[vi] = last * 0.05;
      }
      var vs = ctx.createBufferSource();
      vs.buffer = vbuf;
      var vg = ctx.createGain();
      vg.gain.value = 0.5;
      vs.connect(vg);
      vg.connect(master);
      vs.start(0);
    }

    var bars = Math.ceil(totalSec / bar) + 1;
    var chordList = CHORDS[id];

    for (var b = 0; b < bars; b++) {
      var t = b * bar;
      var chord = chordList[b % chordList.length];

      if (id === 'cinematic') {
        /* 낮은 드론 + 느린 스웰 + 불협 2도 */
        for (var ci = 0; ci < chord.length; ci++) {
          tone(chord[ci], t, bar * 1.05, 0.075 / (1 + ci * 0.4), ci === 0 ? 'sine' : 'triangle');
        }
        tone(chord[0] * 1.06, t + bar * 0.5, bar * 0.9, 0.02, 'sine');
        if (b % 2 === 0) noise(t + bar * 0.25, bar * 0.8, 0.012, 800, 2400);
        if (b % 4 === 2) tone(chord[chord.length - 1] * 1.5, t + bar * 0.4, bar * 0.6, 0.03, 'sine');
      } else if (id === 'news') {
        /* 뚜렷한 펄스 + 초침 + 짧은 모티프 */
        for (var ni = 0; ni < 4; ni++) {
          tone(chord[0], t + ni * beat, beat * 0.55, 0.10, 'square');
          hat(t + ni * beat + beat * 0.5, 0.05);
        }
        pluck(chord[2] * 2, t, 0.05, 'triangle');
        pluck(chord[3] * 2, t + beat, 0.045, 'triangle');
        pluck(chord[2] * 2, t + beat * 2.5, 0.05, 'triangle');
        pluck(chord[1] * 2, t + beat * 3, 0.04, 'triangle');
        if (b % 2 === 0) kick(t, 0.42);
      } else if (id === 'playful') {
        /* 마림바 아르페지오 + 셰이커 */
        var seq = [0, 2, 1, 3, 2, 1, 3, 2];
        for (var pi = 0; pi < 8; pi++) {
          pluck(chord[seq[pi]] * 2, t + pi * (beat / 2), 0.11, 'sine');
          if (pi % 2 === 1) noise(t + pi * (beat / 2), 0.05, 0.045, 6800);
        }
        tone(chord[0] / 2, t, beat * 1.7, 0.10, 'sine');
        if (b % 2 === 0) kick(t + beat * 0.5, 0.28);
      } else if (id === 'warm') {
        /* 어쿠스틱 아르페지오 + 부드러운 베이스 */
        var wseq = [0, 1, 2, 3, 2, 1, 2, 3];
        for (var wi = 0; wi < 8; wi++) {
          pluck(chord[wseq[wi]], t + wi * (beat / 2), 0.085, 'triangle');
        }
        tone(chord[0] / 2, t, beat * 2.1, 0.10, 'sine');
        tone(chord[0] / 2, t + beat * 2, beat * 1.8, 0.08, 'sine');
        if (b % 2 === 1) noise(t + bar * 0.4, 0.3, 0.012, 2600);
      } else if (id === 'upbeat') {
        /* 포온더플로어 + 클랩 + 8분 베이스 */
        for (var ui = 0; ui < 4; ui++) {
          kick(t + ui * beat, 0.5);
          if (ui === 1 || ui === 3) clap(t + ui * beat, 0.14);
          hat(t + ui * beat + beat * 0.5, 0.07);
          hat(t + ui * beat + beat * 0.25, 0.035);
        }
        for (var si = 0; si < 8; si++) {
          tone(chord[0] / 2, t + si * (beat / 2), beat * 0.4, 0.09, 'triangle');
        }
        for (var ti = 0; ti < chord.length; ti++) {
          tone(chord[ti], t, bar * 0.95, 0.05 / (1 + ti * 0.3), ti === 0 ? 'sine' : 'triangle');
        }
        noise(t + bar * 0.75, 0.18, 0.03, 3200);
      } else {
        /* lofi: 따뜻한 패드 + 느린 스네어 + 살짝 늦는 하이햇 */
        for (var li = 0; li < chord.length; li++) {
          tone(chord[li], t, bar * 0.98, 0.07 / (1 + li * 0.28), li === 0 ? 'sine' : 'triangle');
        }
        tone(chord[0] / 2, t, beat * 2, 0.14, 'sine');
        tone(chord[0] / 2, t + beat * 2, beat * 1.7, 0.10, 'sine');
        kick(t, 0.4);
        kick(t + beat * 2.5, 0.3);
        noise(t + beat, 0.14, 0.05, 1600, 4200);
        noise(t + beat * 3, 0.14, 0.05, 1600, 4200);
        hat(t + beat * 1.5, 0.035);
        hat(t + beat * 3.5, 0.035);
        if (b % 2 === 0) pluck(chord[2] * 2, t + beat * 2, 0.05, 'sine');
      }
    }

    /* 끝 페이드아웃 */
    var fade = ctx.createGain();
    master.disconnect();
    master.connect(fade);
    fade.connect(comp);
    fade.gain.setValueAtTime(1, Math.max(0, totalSec - 1.4));
    fade.gain.linearRampToValueAtTime(0.0001, totalSec);

    return ctx.startRendering().then(function (buffer) {
      return buffer;
    }).catch(function () { return null; });
  }

  return { STYLES: STYLES, styleById: styleById, build: build };
});
