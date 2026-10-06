// Procedural Web Audio sound effects and ambient music (no external assets).
export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.music = null;
    this.musicNodes = null;
    this.last = new Map();
    this.listener = { x: 0, y: 0 };
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
    } catch {
      return false;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.connect(this.master);
    const comp = this.ctx.createDynamicsCompressor();
    this.sfx.disconnect();
    this.sfx.connect(comp);
    comp.connect(this.master);
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    return true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.masterVolume ?? 0.8;
    this.sfx.gain.value = s.sfxVolume ?? 0.8;
    this.music.gain.value = (s.musicVolume ?? 0.4) * 0.5;
  }

  setListener(x, y) {
    this.listener.x = x;
    this.listener.y = y;
  }

  // distance attenuation for world sounds
  gainAt(x, y) {
    if (x === undefined) return 1;
    const d = Math.hypot(x - this.listener.x, y - this.listener.y);
    return Math.max(0, 1 - d / 45);
  }

  throttle(key, ms) {
    const now = performance.now();
    const l = this.last.get(key) || 0;
    if (now - l < ms) return false;
    this.last.set(key, now);
    return true;
  }

  tone({ freq = 440, freq2, type = 'sine', dur = 0.15, vol = 0.2, attack = 0.005, delay = 0, filter }) {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 2000;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.2, freq = 1200, freq2, q = 1, type = 'bandpass', delay = 0 }) {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  play(name, x, y) {
    const v = this.gainAt(x, y);
    if (v <= 0.01) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 880, freq2: 1320, dur: 0.06, vol: 0.08 });
        break;
      case 'select-shaper':
        if (!this.throttle(name, 120)) return;
        this.tone({ freq: 1200, freq2: 1800, dur: 0.08, vol: 0.07, type: 'triangle' });
        this.tone({ freq: 1600, freq2: 2400, dur: 0.07, vol: 0.05, type: 'triangle', delay: 0.07 });
        break;
      case 'select-lancer':
        if (!this.throttle(name, 120)) return;
        this.tone({ freq: 220, freq2: 330, dur: 0.18, vol: 0.09, type: 'sawtooth', filter: { freq: 900 } });
        this.tone({ freq: 660, dur: 0.12, vol: 0.05, type: 'triangle', delay: 0.06 });
        break;
      case 'select-building':
        if (!this.throttle(name, 120)) return;
        this.tone({ freq: 330, freq2: 495, dur: 0.25, vol: 0.07, type: 'triangle' });
        break;
      case 'ack':
        if (!this.throttle(name, 90)) return;
        this.tone({ freq: 740, freq2: 980, dur: 0.07, vol: 0.06, type: 'triangle' });
        break;
      case 'swing':
        if (!this.throttle(`swing${Math.floor(x)}`, 60)) return;
        this.noise({ dur: 0.16, vol: 0.12 * v, freq: 600, freq2: 2600, q: 0.8 });
        break;
      case 'hit-barrier':
        if (!this.throttle(name, 45)) return;
        this.tone({ freq: 1800, freq2: 900, dur: 0.1, vol: 0.05 * v, type: 'square', filter: { freq: 3000 } });
        break;
      case 'hit':
        if (!this.throttle(name, 45)) return;
        this.noise({ dur: 0.08, vol: 0.12 * v, freq: 2400, q: 3 });
        this.tone({ freq: 180, freq2: 90, dur: 0.08, vol: 0.06 * v });
        break;
      case 'death-unit':
        if (!this.throttle(name, 60)) return;
        this.noise({ dur: 0.45, vol: 0.2 * v, freq: 900, freq2: 120, type: 'lowpass' });
        this.tone({ freq: 140, freq2: 40, dur: 0.4, vol: 0.12 * v });
        break;
      case 'death-building':
        this.noise({ dur: 1.4, vol: 0.35 * v, freq: 700, freq2: 60, type: 'lowpass' });
        this.tone({ freq: 90, freq2: 30, dur: 1.2, vol: 0.2 * v });
        break;
      case 'lunge':
        if (!this.throttle(name, 80)) return;
        this.noise({ dur: 0.25, vol: 0.12 * v, freq: 300, freq2: 3000, q: 1.5 });
        break;
      case 'warp':
        this.tone({ freq: 200, freq2: 1200, dur: 0.6, vol: 0.08 * v, type: 'sawtooth', filter: { freq: 1600 } });
        break;
      case 'build-start':
        this.tone({ freq: 300, freq2: 900, dur: 0.4, vol: 0.07 * v, type: 'triangle' });
        break;
      case 'build-done':
        [523, 659, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.25, vol: 0.06, type: 'triangle', delay: i * 0.08 }));
        break;
      case 'trained':
        if (!this.throttle(name, 150)) return;
        this.tone({ freq: 600, freq2: 900, dur: 0.15, vol: 0.05, type: 'triangle' });
        break;
      case 'research':
        [392, 523, 659, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.3, vol: 0.06, type: 'sine', delay: i * 0.1 }));
        break;
      case 'error':
        if (!this.throttle(name, 250)) return;
        this.tone({ freq: 160, dur: 0.18, vol: 0.09, type: 'square', filter: { freq: 700 } });
        break;
      case 'alert':
        if (!this.throttle(name, 1500)) return;
        this.tone({ freq: 880, dur: 0.14, vol: 0.09, type: 'square', filter: { freq: 2000 } });
        this.tone({ freq: 660, dur: 0.18, vol: 0.09, type: 'square', filter: { freq: 2000 }, delay: 0.16 });
        break;
      case 'victory':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, dur: 0.6, vol: 0.08, type: 'triangle', delay: i * 0.15 }));
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 0.7, vol: 0.08, type: 'sawtooth', filter: { freq: 900 }, delay: i * 0.22 }));
        break;
      case 'overclock':
        this.tone({ freq: 500, freq2: 1500, dur: 0.35, vol: 0.06, type: 'sawtooth', filter: { freq: 2500 } });
        break;
      default:
        break;
    }
  }

  // Slow evolving ambient pad
  startMusic() {
    if (!this.ensure() || this.musicNodes) return;
    const ctx = this.ctx;
    const out = ctx.createBiquadFilter();
    out.type = 'lowpass';
    out.frequency.value = 900;
    out.connect(this.music);
    const chords = [
      [110, 164.8, 220, 277.2],
      [98, 146.8, 196, 246.9],
      [87.3, 130.8, 174.6, 220],
      [103.8, 155.6, 207.7, 261.6],
    ];
    const voices = [];
    for (let i = 0; i < 4; i++) {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'sawtooth';
      o2.detune.value = 9;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      o1.connect(g);
      o2.connect(g);
      g.connect(out);
      o1.start();
      o2.start();
      voices.push({ o1, o2, g });
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 400;
    lfo.connect(lfoGain);
    lfoGain.connect(out.frequency);
    lfo.start();
    let idx = 0;
    const setChord = () => {
      const ch = chords[idx++ % chords.length];
      const t = ctx.currentTime;
      voices.forEach((v, i) => {
        v.o1.frequency.setTargetAtTime(ch[i], t, 1.5);
        v.o2.frequency.setTargetAtTime(ch[i] * 1.002, t, 1.5);
      });
    };
    setChord();
    const timer = setInterval(setChord, 9000);
    this.musicNodes = { voices, lfo, timer, out };
  }

  stopMusic() {
    if (!this.musicNodes) return;
    clearInterval(this.musicNodes.timer);
    for (const v of this.musicNodes.voices) {
      v.o1.stop();
      v.o2.stop();
    }
    this.musicNodes.lfo.stop();
    this.musicNodes = null;
  }
}
