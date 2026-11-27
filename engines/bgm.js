/* ============================================================================
   bgm.js · 내장 BGM 합성기 (UMD, 의존성 0)
   ----------------------------------------------------------------------------
   외부 음원을 받지 않는다. OfflineAudioContext로 그 자리에서 만든다.
     calm : 낮은 패드 + 베이스 (설명·정보 영상)
     beat : 같은 화음에 가벼운 킥·햇 (살짝 리듬감)
   사용자가 올린 BGM 파일이 있으면 앱은 이 대신 그 파일을 쓴다.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ClipBgm = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var STYLES = [
    { id: 'calm', label: '차분한 패드', note: '설명·정보 영상' },
    { id: 'beat', label: '가벼운 비트', note: '리듬이 필요할 때' },
    { id: 'none', label: 'BGM 없음', note: '목소리만' }
  ];

  /* Am7 - Fmaj7 - Cmaj7 - G  (Hz) */
  var CHORDS = [
    [220.00, 261.63, 329.63, 392.00],
    [174.61, 261.63, 349.23, 440.00],
    [130.81, 196.00, 329.63, 493.88],
    [196.00, 246.94, 392.00, 587.33]
  ];

  function styleById(id) {
    return STYLES.filter(function (s) { return s.id === id; })[0] || STYLES[0];
  }

  /**
   * BGM 버퍼를 만든다.
   * @param {number} durationMs 필요한 길이
   * @param {object} opts {style:'calm'|'beat', bpm, volume}
   */
  function build(durationMs, opts) {
    var o = opts || {};
    var ms = Math.max(2000, Math.round(durationMs || 20000));
    var sr = 44100;
    var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctx) return Promise.resolve(null);
    var ctx = new Ctx(2, Math.round((ms / 1000) * sr), sr);
    var bpm = o.bpm || (o.style === 'beat' ? 92 : 78);
    var beat = 60 / bpm;
    var bar = beat * 4;
    var totalSec = ms / 1000;
    var master = ctx.createGain();
    master.gain.value = o.volume === undefined ? 0.9 : o.volume;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.style === 'beat' ? 5200 : 2600;
    lp.Q.value = 0.4;
    master.connect(lp);
    lp.connect(ctx.destination);

    function tone(freq, t0, dur, gain, type) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.4, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    function noiseHit(t0, dur, gain, hp) {
      var len = Math.max(1, Math.round(dur * sr));
      var buf = ctx.createBuffer(1, len, sr);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp || 5200;
      var g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
    }

    function kick(t0) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t0);
      osc.frequency.exponentialRampToValueAtTime(46, t0 + 0.16);
      g.gain.setValueAtTime(0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    }

    var bars = Math.ceil(totalSec / bar) + 1;
    var withBeat = o.style === 'beat';
    for (var b = 0; b < bars; b++) {
      var t = b * bar;
      var chord = CHORDS[b % CHORDS.length];
      /* 패드: 화음 4음을 길게 */
      for (var i = 0; i < chord.length; i++) {
        tone(chord[i], t, bar * 0.98, 0.075 / (1 + i * 0.25), i === 0 ? 'sine' : 'triangle');
      }
      /* 베이스 */
      tone(chord[0] / 2, t, beat * 1.8, 0.16, 'sine');
      tone(chord[0] / 2, t + beat * 2, beat * 1.6, 0.12, 'sine');
      if (withBeat) {
        for (var k = 0; k < 4; k++) {
          if (k === 0 || k === 2) kick(t + k * beat);
          noiseHit(t + k * beat + beat * 0.5, 0.07, 0.10, 6800);
          if (k === 3) noiseHit(t + k * beat + beat * 0.75, 0.05, 0.06, 8200);
        }
      } else {
        noiseHit(t + bar * 0.5, 0.24, 0.018, 3400);
      }
    }

    return ctx.startRendering().then(function (buffer) {
      return buffer;
    }).catch(function () { return null; });
  }

  return { STYLES: STYLES, styleById: styleById, build: build };
});
