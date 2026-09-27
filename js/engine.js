import * as THREE from 'three';
import { getQuality, qualityPixelRatio, qualityAA } from './quality.js';

export class Engine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.headless = !!opts.headless;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(opts.fov || 80, 1, 0.05, 600);
    this.scene.add(this.camera);
    this.input = {
      keys: new Set(), pressed: new Set(),
      mouseDX: 0, mouseDY: 0,
      buttons: [false, false, false], pressedBtn: [false, false, false],
      wheel: 0,
    };
    this.locked = false;
    this.onLockChange = null;
    this._raf = 0; this._last = 0;
    this._fpsAcc = 0; this._fpsN = 0; this.fps = 60;

    if (!this.headless) {
      this._aa = qualityAA(getQuality());
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this._aa, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(qualityPixelRatio(getQuality()));
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.bindInput();
    } else {
      this.renderer = null;
    }
  }
  // Re-read the quality setting and apply it. Pixel ratio applies live;
  // anti-aliasing needs a fresh renderer, so it is rebuilt when it changes.
  // Called at match start so a settings change never interrupts a live match.
  syncQuality() {
    if (this.headless || !this.renderer) return;
    const q = getQuality();
    this.renderer.setPixelRatio(qualityPixelRatio(q));
    const wantAA = qualityAA(q);
    if (wantAA !== this._aa) {
      this._aa = wantAA;
      this.renderer.dispose();
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this._aa, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(qualityPixelRatio(q));
      this.resize();
    }
  }
  newMatchScene() {
    this.scene = new THREE.Scene();
    this.scene.add(this.camera);
    this.syncQuality();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.renderer) this.renderer.setSize(w, h, false);
  }
  bindInput() {
    const inp = this.input;
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      inp.keys.add(e.code);
      inp.pressed.add(e.code);
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => inp.keys.delete(e.code));
    window.addEventListener('blur', () => { inp.keys.clear(); inp.buttons = [false, false, false]; });
    document.addEventListener('mousemove', e => {
      if (this.locked) { inp.mouseDX += e.movementX; inp.mouseDY += e.movementY; }
    });
    document.addEventListener('mousedown', e => {
      if (e.target !== this.canvas) return;
      inp.buttons[e.button] = true; inp.pressedBtn[e.button] = true;
    });
    document.addEventListener('mouseup', e => { inp.buttons[e.button] = false; });
    document.addEventListener('wheel', e => { inp.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    // Never show the browser/PC right-click menu over the game — right mouse
    // is aim-down-sights. Suppress on the canvas always, and document-wide
    // while pointer-locked (locked clicks can land off-canvas).
    document.addEventListener('contextmenu', e => {
      if (this.locked || e.target === this.canvas) e.preventDefault();
    });
    this.canvas.addEventListener('click', () => { if (!this.locked && this._lockWanted) this.requestLock(); });
  }
  requestLock() {
    if (this.headless || !this.renderer) return;
    this._lockWanted = true;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
  exitLock() {
    this._lockWanted = false;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  }
  consumeFrame() {
    const inp = this.input;
    const frame = {
      keys: inp.keys, pressed: inp.pressed,
      dx: inp.mouseDX, dy: inp.mouseDY,
      buttons: inp.buttons.slice(), pressedBtn: inp.pressedBtn.slice(),
      wheel: inp.wheel,
    };
    inp.pressed.clear();
    inp.mouseDX = 0; inp.mouseDY = 0;
    inp.pressedBtn = [false, false, false];
    inp.wheel = 0;
    return frame;
  }
  start(update) {
    this._last = performance.now();
    const loop = now => {
      this._raf = requestAnimationFrame(loop);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > 0.1) dt = 0.1;
      this._fpsAcc += dt; this._fpsN++;
      if (this._fpsAcc >= 0.5) { this.fps = Math.round(this._fpsN / this._fpsAcc); this._fpsAcc = 0; this._fpsN = 0; }
      update(dt);
      if (this.renderer) this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this._raf); }
}
