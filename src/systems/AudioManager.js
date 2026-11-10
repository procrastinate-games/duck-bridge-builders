// Procedural Web Audio: one-shot SFX + a cozy looping BGM sequencer.
// Zero audio files. AudioContext is created on the first user gesture.

import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.noiseBuf = null;
    this.musicTimer = null;
    this.musicMode = null;
    this.step = 0;
    this.nextTime = 0;
    this.lastPlayed = {};
    this.unlock = this.unlock.bind(this);
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    this.wire();
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    // gentle room reverb for music
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.6);
    const rv = this.ctx.createGain();
    rv.gain.value = 0.25;
    this.musicGain.connect(this.reverb).connect(rv).connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    if (this.pendingMusic) this.playMusic(this.pendingMusic);
  }

  impulse(sec) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(2, rate * sec, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = gameState.settings;
    this.musicGain.gain.setTargetAtTime(s.music * 0.35, this.ctx.currentTime, 0.1);
    this.sfxGain.gain.setTargetAtTime(s.sfx, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- primitives

  tone({ freq = 440, type = 'sine', dur = 0.2, vol = 0.3, attack = 0.005, slide = 0, delay = 0, filter = 0, q = 1, out = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(out || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, type = 'bandpass', freq = 1000, q = 1, slide = 0, delay = 0, attack = 0.003, out = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || this.sfxGain);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  throttle(key, ms) {
    const now = performance.now();
    if (this.lastPlayed[key] && now - this.lastPlayed[key] < ms) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  // ---------------------------------------------------------------- SFX

  play(name, opts = {}) {
    if (!this.ctx) return;
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'step':
        if (!this.throttle('step', 140)) return;
        this.noise({ dur: 0.06, vol: 0.06 * (opts.vol ?? 1), freq: opts.wood ? 900 : 500, q: 1.5 });
        if (opts.wood) this.tone({ freq: r(180, 220), type: 'triangle', dur: 0.05, vol: 0.05 });
        break;
      case 'pickup':
        this.tone({ freq: 220, type: 'triangle', dur: 0.12, vol: 0.25, slide: 1.5 });
        this.noise({ dur: 0.08, vol: 0.12, freq: 1400, q: 2 });
        break;
      case 'place':
        this.tone({ freq: 140, type: 'triangle', dur: 0.18, vol: 0.35, slide: 0.7 });
        this.noise({ dur: 0.12, vol: 0.18, freq: 700, q: 1 });
        break;
      case 'hammer':
        this.tone({ freq: r(1700, 2100), type: 'square', dur: 0.05, vol: 0.08, filter: 4000 });
        this.tone({ freq: 160, type: 'triangle', dur: 0.09, vol: 0.25, slide: 0.6 });
        this.noise({ dur: 0.05, vol: 0.12, freq: 2500, q: 3 });
        break;
      case 'clank':
        this.tone({ freq: 1250, type: 'triangle', dur: 0.35, vol: 0.18 });
        this.tone({ freq: 1870, type: 'sine', dur: 0.3, vol: 0.12 });
        break;
      case 'chomp':
        for (let i = 0; i < 3; i++) this.noise({ dur: 0.05, vol: 0.18, freq: 2200, q: 4, delay: i * 0.07 });
        break;
      case 'deny':
        if (!this.throttle('deny', 250)) return;
        this.tone({ freq: 240, type: 'square', dur: 0.09, vol: 0.08, filter: 1200 });
        this.tone({ freq: 180, type: 'square', dur: 0.12, vol: 0.08, filter: 1200, delay: 0.09 });
        break;
      case 'drop':
        this.tone({ freq: 110, type: 'triangle', dur: 0.2, vol: 0.3, slide: 0.6 });
        break;
      case 'recycle':
        this.tone({ freq: 520, type: 'sine', dur: 0.1, vol: 0.2 });
        this.tone({ freq: 780, type: 'sine', dur: 0.14, vol: 0.2, delay: 0.08 });
        break;
      case 'creak': {
        if (!this.throttle('creak', 420)) return;
        const base = r(90, 160);
        const o = this.ctx.createOscillator();
        const f = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        const t = this.ctx.currentTime;
        const dur = r(0.35, 0.7);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(base, t);
        o.frequency.linearRampToValueAtTime(base * r(1.2, 1.6), t + dur);
        f.type = 'bandpass';
        f.frequency.value = r(600, 1100);
        f.Q.value = 8;
        const lfo = this.ctx.createOscillator();
        const lg = this.ctx.createGain();
        lfo.frequency.value = r(18, 30);
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(g.gain);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12 * (opts.vol ?? 1), t + 0.08);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(this.sfxGain);
        o.start(t);
        lfo.start(t);
        o.stop(t + dur + 0.05);
        lfo.stop(t + dur + 0.05);
        break;
      }
      case 'crack':
        this.noise({ dur: 0.12, vol: 0.45, freq: 2600, q: 0.8, type: 'highpass' });
        this.noise({ dur: 0.35, vol: 0.3, freq: 800, q: 1.2, slide: 0.4, delay: 0.02 });
        this.tone({ freq: 90, type: 'triangle', dur: 0.25, vol: 0.3, slide: 0.5 });
        break;
      case 'loosen':
        this.noise({ dur: 0.15, vol: 0.2, freq: 1400, q: 5, slide: 0.6 });
        this.tone({ freq: 300, type: 'triangle', dur: 0.15, vol: 0.12, slide: 0.6 });
        break;
      case 'splash':
        this.noise({ dur: opts.big ? 1.1 : 0.45, vol: opts.big ? 0.6 : 0.3, type: 'lowpass', freq: opts.big ? 2400 : 3500, slide: 0.15, attack: 0.01 });
        this.noise({ dur: 0.25, vol: 0.12, freq: 5000, q: 1, type: 'highpass', delay: 0.05 });
        if (opts.big) this.tone({ freq: 70, type: 'sine', dur: 0.7, vol: 0.4, slide: 0.5 });
        break;
      case 'plop':
        this.tone({ freq: r(500, 700), type: 'sine', dur: 0.12, vol: 0.18, slide: 2.2 });
        break;
      case 'quack': {
        if (!opts.force && !this.throttle('quack', 180)) return;
        const pitch = opts.pitch ?? r(0.9, 1.25);
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const f1 = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(620 * pitch, t);
        o.frequency.exponentialRampToValueAtTime(420 * pitch, t + 0.13);
        f1.type = 'bandpass';
        f1.frequency.value = 1300 * pitch;
        f1.Q.value = 3;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(f1).connect(g).connect(this.sfxGain);
        o.start(t);
        o.stop(t + 0.2);
        break;
      }
      case 'hippoStep':
        this.tone({ freq: 55, type: 'sine', dur: 0.35, vol: 0.55, slide: 0.6 });
        this.noise({ dur: 0.2, vol: 0.15, type: 'lowpass', freq: 300 });
        break;
      case 'hippoHmm':
        this.tone({ freq: 130, type: 'sawtooth', dur: 0.6, vol: 0.12, filter: 500, slide: 1.15 });
        this.tone({ freq: 150, type: 'sawtooth', dur: 0.5, vol: 0.1, filter: 500, slide: 0.9, delay: 0.55 });
        break;
      case 'hippoYay':
        [196, 247, 294, 392].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.25, vol: 0.12, filter: 900, delay: i * 0.1 }));
        break;
      case 'gulp':
        this.tone({ freq: 400, type: 'sine', dur: 0.15, vol: 0.2, slide: 0.5 });
        break;
      case 'beep':
        this.tone({ freq: opts.go ? 1046 : 660, type: 'square', dur: opts.go ? 0.35 : 0.15, vol: 0.12, filter: 3000 });
        break;
      case 'rescue':
        this.tone({ freq: 784 + (opts.n || 0) * 40, type: 'triangle', dur: 0.15, vol: 0.18 });
        this.tone({ freq: 1046 + (opts.n || 0) * 50, type: 'triangle', dur: 0.2, vol: 0.15, delay: 0.08 });
        break;
      case 'victory':
        [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.2, delay: i * 0.12 }));
        [262, 330, 392].forEach((f) => this.tone({ freq: f, type: 'sine', dur: 1.4, vol: 0.12, delay: 0.84 }));
        for (let i = 0; i < 8; i++) this.noise({ dur: 0.05, vol: 0.1, freq: 6000, q: 1, type: 'highpass', delay: 0.9 + i * 0.07 });
        break;
      case 'fail':
        [392, 349, 311, 262].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.32, vol: 0.18, delay: i * 0.22, slide: i === 3 ? 0.8 : 1 }));
        break;
      case 'star':
        this.tone({ freq: 880 * (1 + (opts.n || 0) * 0.25), type: 'triangle', dur: 0.3, vol: 0.2 });
        this.tone({ freq: 1760 * (1 + (opts.n || 0) * 0.25), type: 'sine', dur: 0.3, vol: 0.08, delay: 0.03 });
        break;
      case 'click':
        this.tone({ freq: 900, type: 'triangle', dur: 0.05, vol: 0.12 });
        break;
      case 'jump':
        this.tone({ freq: 300, type: 'sine', dur: 0.15, vol: 0.12, slide: 1.8 });
        break;
      case 'tick':
        this.tone({ freq: 1500, type: 'square', dur: 0.04, vol: 0.06, filter: 3000 });
        break;
      case 'whoosh':
        this.noise({ dur: 0.5, vol: 0.12, freq: 600, q: 0.8, slide: 3 });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- music

  playMusic(mode) {
    this.pendingMusic = mode;
    if (!this.ctx || this.musicMode === mode) return;
    this.musicMode = mode;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (!this.musicTimer) this.musicTimer = setInterval(() => this.schedule(), 50);
  }

  stopMusic() {
    this.musicMode = null;
    this.pendingMusic = null;
  }

  schedule() {
    if (!this.ctx || !this.musicMode) return;
    const tempo = this.musicMode === 'test' ? 128 : this.musicMode === 'victory' ? 140 : 104;
    const stepDur = 60 / tempo / 2; // eighth notes
    while (this.nextTime < this.ctx.currentTime + 0.25) {
      this.musicStep(this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  musicStep(step, t, sd) {
    const delay = Math.max(0, t - this.ctx.currentTime);
    const out = this.musicGain;
    const bar = Math.floor(step / 8) % 8;
    const chords = this.musicMode === 'test' ? [0, -3, 5, 7, 0, -3, 2, 7] : [0, 5, -3, 7, 0, 5, 2, 7];
    const root = 60 + chords[bar];
    const s = step % 8;
    // bass on beats
    if (s % 4 === 0) this.tone({ freq: midi(root - 24), type: 'triangle', dur: sd * 3, vol: 0.32, delay, out, filter: 600 });
    if (s === 6 && this.musicMode !== 'menu') this.tone({ freq: midi(root - 17), type: 'triangle', dur: sd * 1.5, vol: 0.2, delay, out, filter: 600 });
    // plucky pentatonic melody (seeded by step so it loops musically)
    const seed = Math.sin((step % 64) * 12.9898 + bar) * 43758.5453;
    const rnd = seed - Math.floor(seed);
    const density = this.musicMode === 'test' ? 0.6 : 0.45;
    if (rnd < density) {
      const deg = PENTA[Math.floor(rnd * 97) % 5];
      const oct = rnd < 0.15 ? 12 : 0;
      this.tone({ freq: midi(root + deg + oct + 12), type: 'triangle', dur: sd * 1.6, vol: 0.13, delay, out, attack: 0.004 });
    }
    // soft pad chord every bar
    if (s === 0) {
      for (const iv of [0, 4, 7]) this.tone({ freq: midi(root + iv), type: 'sine', dur: sd * 8, vol: 0.045, delay, out, attack: 0.3 });
    }
    // light percussion
    if (this.musicMode !== 'menu') {
      if (s % 2 === 1) this.noise({ dur: 0.03, vol: 0.035, freq: 7000, type: 'highpass', delay, out });
      if (s === 4) this.noise({ dur: 0.08, vol: 0.06, freq: 1800, q: 1, delay, out });
    }
    if (this.musicMode === 'test' && s % 4 === 0) this.tone({ freq: 60, type: 'sine', dur: 0.12, vol: 0.25, slide: 0.5, delay, out });
  }

  // ---------------------------------------------------------------- wiring

  wire() {
    eventBus.on(Events.AUDIO_SETTINGS, () => this.applyVolumes());
    eventBus.on(Events.UI_CLICK, () => this.play('click'));
    eventBus.on(Events.ITEM_PICKED, () => this.play('pickup'));
    eventBus.on(Events.ITEM_PLACED, () => this.play('place'));
    eventBus.on(Events.ITEM_DROPPED, () => this.play('drop'));
    eventBus.on(Events.ITEM_RECYCLED, () => this.play('recycle'));
    eventBus.on(Events.PIECE_TRIMMED, () => this.play('chomp'));
    eventBus.on(Events.PLACE_DENIED, () => this.play('deny'));
    eventBus.on(Events.NODE_HAMMERED, () => this.play('hammer'));
    eventBus.on(Events.NODE_REINFORCED, () => this.play('clank'));
    eventBus.on(Events.MEMBER_REMOVED, () => this.play('pickup'));
    eventBus.on(Events.JOINT_LOOSENED, () => this.play('loosen'));
    eventBus.on(Events.JOINT_DETACHED, () => this.play('crack'));
    eventBus.on(Events.MEMBER_SNAPPED, () => this.play('crack'));
    eventBus.on(Events.STRUCTURE_CREAK, (d) => this.play('creak', d));
    eventBus.on(Events.SPLASH, (d) => this.play('splash', d));
    eventBus.on(Events.QUACK, (d) => this.play('quack', d));
    eventBus.on(Events.FOOTSTEP, (d) => this.play('step', d));
    eventBus.on(Events.HIPPO_STEP, () => this.play('hippoStep'));
    eventBus.on(Events.JUMP, () => this.play('jump'));
    eventBus.on(Events.TEST_COUNTDOWN, (n) => this.play('beep', { go: n === 0 }));
    eventBus.on(Events.DUCK_RESCUED, (n) => this.play('rescue', { n }));
    eventBus.on(Events.TIMER_WARNING, () => this.play('tick'));
  }
}
