// Procedural WebAudio SFX — zero external assets.
export class AudioSys {
  constructor() {
    this.ctx = null; this.master = null; this.sfx = null; this.music = null;
    // PHASE 2 VOICE HOOK: dedicated voice bus, created in init() and routed
    // voice -> master. Kept separate from the sfx/music graph so future P2P
    // voice chat can attach remote MediaStreams here without touching game
    // audio. No voice UI or capture exists in this build (bots only).
    this.voice = null;
    this.vol = 0.8; this.musVol = 0.4; this.enabled = true;
    this._noiseBuf = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
      this.music = this.ctx.createGain(); this.music.connect(this.master);
      this.voice = this.ctx.createGain(); this.voice.connect(this.master);
      this.setVolumes(this.vol, this.musVol);
      const len = this.ctx.sampleRate * 1.2;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbience();
    } catch (e) { this.ctx = null; }
  }
  setVolumes(v, m) {
    this.vol = v; this.musVol = m;
    if (!this.ctx) return;
    this.master.gain.value = 1;
    this.sfx.gain.value = v;
    this.music.gain.value = m;
  }
  get ready() { return !!this.ctx; }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  _noise(dur, filterType, freq, q, gain, when = 0, decay = true) {
    if (!this.ready) return;
    const t = this.now() + when;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + dur + 0.05);
  }
  _tone(freq, dur, type, gain, when = 0, slideTo = null, dest = null) {
    if (!this.ready) return;
    const t = this.now() + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  shoot(kind) {
    if (!this.ready) return;
    switch (kind) {
      case 'ar': this._noise(0.14, 'lowpass', 3200, 1, 0.5); this._tone(160, 0.1, 'square', 0.25, 0, 60); break;
      case 'smg': this._noise(0.1, 'lowpass', 4200, 1, 0.4); this._tone(220, 0.08, 'square', 0.2, 0, 80); break;
      case 'lmg': this._noise(0.18, 'lowpass', 2400, 1, 0.55); this._tone(120, 0.14, 'square', 0.28, 0, 50); break;
      case 'sniper': this._noise(0.35, 'lowpass', 5000, 1, 0.7); this._tone(90, 0.25, 'sawtooth', 0.3, 0, 40); break;
      case 'shotgun': this._noise(0.22, 'lowpass', 2600, 1, 0.7); this._tone(110, 0.16, 'square', 0.32, 0, 55); break;
      case 'pistol': this._noise(0.09, 'lowpass', 4800, 1, 0.35); this._tone(260, 0.07, 'square', 0.18, 0, 90); break;
      default: this._noise(0.12, 'lowpass', 3200, 1, 0.45);
    }
  }
  dryFire() { this._tone(1400, 0.04, 'square', 0.12); }
  reload() { this._noise(0.06, 'bandpass', 1800, 2, 0.25); this._noise(0.06, 'bandpass', 1200, 2, 0.25, 0.18); this._noise(0.08, 'bandpass', 2400, 2, 0.3, 0.45); }
  hitmarker(kill, headshot) {
    if (!this.ready) return;
    this._tone(headshot ? 2100 : 1600, 0.05, 'square', 0.16);
    if (kill) { this._tone(900, 0.09, 'square', 0.2, 0.05); this._tone(1350, 0.1, 'square', 0.18, 0.1); }
  }
  hurt() { this._noise(0.18, 'lowpass', 500, 1, 0.5); this._tone(110, 0.15, 'sine', 0.3, 0, 60); }
  killConfirm() { this._tone(700, 0.08, 'square', 0.2); this._tone(1050, 0.12, 'square', 0.2, 0.07); }
  explosion(big = 1) {
    this._noise(0.7 * big, 'lowpass', 700, 1, 0.8 * big);
    this._tone(60, 0.5 * big, 'sine', 0.6 * big, 0, 28);
  }
  grenadeBounce() { this._tone(500, 0.05, 'triangle', 0.15); }
  pinPull() { this._noise(0.05, 'highpass', 3000, 1, 0.2); }
  melee() { this._noise(0.12, 'bandpass', 2500, 3, 0.35); }
  uavSweep() { this._tone(1200, 0.4, 'sine', 0.12, 0, 1200); }
  streakReady() { this._tone(880, 0.1, 'square', 0.2); this._tone(1174, 0.14, 'square', 0.2, 0.1); }
  streakDenied() { this._tone(300, 0.15, 'square', 0.2); }
  flagTick() { this._tone(660, 0.06, 'square', 0.12); }
  flagCaptured(friendly) { this._tone(friendly ? 784 : 392, 0.15, 'square', 0.22); this._tone(friendly ? 1046 : 311, 0.2, 'square', 0.22, 0.12); }
  roundEnd(won) { this._tone(won ? 660 : 330, 0.2, 'square', 0.25); this._tone(won ? 880 : 220, 0.3, 'square', 0.25, 0.18); }
  capture() { this.flagCaptured(true); this._tone(1318, 0.25, 'square', 0.2, 0.25); }
  uiClick() { this._tone(700, 0.05, 'square', 0.12); }
  uiHover() { this._tone(500, 0.03, 'square', 0.06); }
  footstep() { this._noise(0.07, 'lowpass', 700, 1, 0.12); }
  jetFlyby() { this._noise(1.6, 'bandpass', 900, 2, 0.4); this._tone(180, 1.6, 'sawtooth', 0.1, 0, 90); }
  heliLoop() { /* one-shot chop */ this._noise(0.9, 'lowpass', 400, 1, 0.3); }
  flashRing() { this._tone(2400, 0.5, 'sine', 0.15, 0, 2400); }

  startAmbience() {
    if (!this.ready || this._amb) return;
    this._amb = true;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    // slow LFO on wind
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lg = this.ctx.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.music);
    src.start(); lfo.start();
  }
  // ---- PHASE 2 VOICE HOOKS (not built yet) ----
  // Attach a remote player's MediaStream to the voice bus; returns the nodes so
  // the caller can disconnect them on mute/leave. Per-player gain gives us the
  // phase-2 mute control for free (gain 0 = muted). No callers in phase 1.
  attachVoiceStream(stream) {
    if (!this.ready || !stream) return null;
    const src = this.ctx.createMediaStreamSource(stream);
    const g = this.ctx.createGain(); g.gain.value = 1;
    src.connect(g); g.connect(this.voice);
    return { src, gain: g };
  }
  detachVoiceStream(handle) {
    if (!handle) return;
    try { handle.src.disconnect(); handle.gain.disconnect(); } catch (e) {}
  }
  // Mute control hook: phase-2 mute lists keyed by combatant.playerId will call
  // this with 0/1. No callers in phase 1.
  setVoiceGain(handle, v) { if (handle) handle.gain.gain.value = v ? 1 : 0; }
}
export const audio = new AudioSys();
