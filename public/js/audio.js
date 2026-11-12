// Sound engine: original synthesized sounds (Web Audio), each one overridable by
// dropping a file into public/sounds/ named e.g. think.mp3, daily-double.mp3.
//
// Sound names: board-fill, tick, correct, wrong, daily-double, times-up, think, fanfare, buzz-in, reveal

let ctx = null;
let master = null;
let muted = false;
let volume = 0.8;
const overrides = {};   // name -> url
const playing = new Set(); // active HTMLAudio elements / stop functions for long sounds

export async function initAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    try {
      const { sounds } = await fetch('/api/assets').then(r => r.json());
      for (const f of sounds) {
        const m = f.match(/^(.+)\.(mp3|ogg|wav|m4a)$/i);
        if (m) overrides[m[1].toLowerCase()] = `/sounds/${encodeURIComponent(f)}`;
      }
    } catch { /* offline: synth only */ }
  }
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}
export const audioReady = () => !!ctx && ctx.state === 'running';
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : volume; playing.forEach(p => { if (p.volume != null) p.muted = m; }); }
export function setVolume(v) { volume = v; if (master && !muted) master.gain.value = v; }
export const isMuted = () => muted;

export function stopAll() {
  for (const p of playing) {
    if (typeof p === 'function') p();
    else { p.pause(); p.currentTime = 0; }
  }
  playing.clear();
}

export function play(name) {
  if (!ctx || muted) return;
  if (overrides[name]) {
    const el = new Audio(overrides[name]);
    el.volume = volume;
    el.play().catch(() => {});
    playing.add(el);
    el.onended = () => playing.delete(el);
    return;
  }
  const fn = SYNTH[name];
  if (fn) {
    const stop = fn(ctx.currentTime + 0.02);
    if (typeof stop === 'function') { playing.add(stop); }
  }
}

// ---------------------------------------------------------------------------
// Synth primitives

function tone(t, freq, dur, { type = 'sine', gain = 0.3, attack = 0.005, release = dur, detune = 0, dest = master } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + release);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + release + 0.05);
  return o;
}

function bell(t, freq, dur = 1.2, gain = 0.22, dest = master) {
  tone(t, freq, dur, { gain, dest });
  tone(t, freq * 2, dur * 0.7, { gain: gain * 0.35, dest });
  tone(t, freq * 3.01, dur * 0.45, { gain: gain * 0.15, dest });
}

function noiseBurst(t, dur, { gain = 0.2, freq = 2000, q = 1 } = {}) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const N = s => 440 * Math.pow(2, (s - 9) / 12); // semitones from C4 -> Hz (C4 = 0)

// ---------------------------------------------------------------------------
// Sounds

const SYNTH = {
  tick(t) { tone(t, 1800, 0.05, { type: 'square', gain: 0.04 }); },

  'board-fill'(t) {
    // Shimmering rising arpeggio while the tiles light up.
    const scale = [0, 4, 7, 12, 16, 19, 24, 28];
    for (let i = 0; i < 24; i++) {
      const s = scale[i % scale.length] + 12 * Math.floor(i / scale.length) / 2;
      bell(t + i * 0.065, N(s + 7), 0.35, 0.07);
    }
  },

  reveal(t) {
    noiseBurst(t, 0.35, { gain: 0.12, freq: 1200, q: 0.7 });
    tone(t, 300, 0.3, { type: 'triangle', gain: 0.06 });
  },

  'buzz-in'(t) {
    tone(t, N(19), 0.18, { type: 'square', gain: 0.08 });
    tone(t + 0.09, N(24), 0.25, { type: 'square', gain: 0.08 });
  },

  correct(t) {
    [N(12), N(16), N(19), N(24)].forEach((f, i) => bell(t + i * 0.07, f, 1.0, 0.16));
  },

  wrong(t) {
    for (const det of [-12, 12]) tone(t, 110, 0.55, { type: 'sawtooth', gain: 0.12, detune: det, attack: 0.01 });
    tone(t, 82, 0.55, { type: 'square', gain: 0.06 });
  },

  'times-up'(t) {
    for (const k of [0, 0.32]) {
      for (const det of [-8, 8]) tone(t + k, 150, 0.26, { type: 'sawtooth', gain: 0.1, detune: det, attack: 0.01 });
    }
  },

  'daily-double'(t) {
    // Swirling sparkle sweep + bright chord.
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(2400, t + 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.85);
    for (let i = 0; i < 14; i++) bell(t + 0.05 * i + Math.random() * 0.03, N(24 + [0, 4, 7, 11, 14][i % 5]), 0.4, 0.05);
    [N(7), N(11), N(14), N(19)].forEach(f => bell(t + 0.8, f, 1.8, 0.12));
  },

  fanfare(t) {
    const seq = [[0, 0.15], [4, 0.15], [7, 0.15], [12, 0.45], [7, 0.15], [12, 0.9]];
    let x = t;
    for (const [s, d] of seq) {
      tone(x, N(s + 12), d + 0.1, { type: 'sawtooth', gain: 0.07, attack: 0.02 });
      tone(x, N(s + 19), d + 0.1, { type: 'triangle', gain: 0.06, attack: 0.02 });
      x += d;
    }
    for (let i = 0; i < 20; i++) bell(x + i * 0.06, N(24 + (i * 5) % 17), 0.5, 0.05);
  },

  // Original 30-second "thinking" tune: a gentle Bhupali-flavoured melody over a clock tick.
  think(t) {
    const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
    const beat = 0.5; // 120 bpm, 60 beats = 30 s
    // Bhupali (major pentatonic): Sa Re Ga Pa Dha  -> C D E G A
    const phrase = [
      [12, 1], [14, 1], [16, 1], [19, 1], [21, 2], [19, 2],
      [16, 1], [19, 1], [16, 1], [14, 1], [12, 4],
      [16, 1], [19, 1], [21, 1], [24, 1], [21, 2], [19, 2],
      [21, 1], [19, 1], [16, 1], [14, 1], [16, 4],
    ]; // 32 beats
    const bass = [0, 0, 7, 7, 9, 9, 7, 7]; // per 4 beats
    let x = t;
    const end = t + beat * 60;
    let i = 0;
    while (x < end - 0.01) {
      const [s, len] = phrase[i % phrase.length];
      const d = Math.min(len * beat, end - x);
      if (i >= phrase.length && i % phrase.length < 4) {
        // second pass: add a soft harmony a third below
        tone(x, N(s - 3), d, { type: 'triangle', gain: 0.03, attack: 0.02, dest: bus });
      }
      tone(x, N(s), d, { type: 'triangle', gain: 0.08, attack: 0.02, release: d * 0.95, dest: bus });
      tone(x, N(s + 12), d * 0.6, { type: 'sine', gain: 0.015, attack: 0.01, dest: bus });
      x += d; i++;
    }
    for (let b = 0; b < 60; b++) {
      const bt = t + b * beat;
      tone(bt, b % 2 ? 1500 : 1900, 0.04, { type: 'square', gain: 0.025, dest: bus });
      if (b % 4 === 0) {
        const s = bass[(b / 4) % bass.length];
        tone(bt, N(s - 24), beat * 3.8, { type: 'sine', gain: 0.12, attack: 0.03, dest: bus });
      }
    }
    // final "time's up" chord
    [N(0), N(4), N(7), N(12)].forEach(f => tone(end, f, 1.2, { type: 'sawtooth', gain: 0.04, dest: bus }));
    return () => { try { bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => bus.disconnect(), 300); } catch { /* ignore */ } };
  },
};
