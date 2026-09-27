import * as THREE from 'three';
import { clamp, lerp, rand } from './util.js';
import { getCamoTexture, makeReactiveTexture, paintReactive } from './camos.js';

// ================= WEAPON DEFINITIONS =================
export const WEAPONS = [
  { id: 'vk7',         name: 'Vector-7',      cls: 'AR',      dmg: 27, headMult: 1.6, rpm: 720, mag: 30, reserve: 120, range: 35,  falloff: 60,  hip: 3.4, ads: 0.5,  adsTime: 0.28, reload: 2.1, recP: 0.55, recY: 0.28, auto: true,  moveMult: 0.96, snd: 'ar',       len: 0.78 },
  { id: 'reaver',      name: 'Reaver-47',      cls: 'AR',      dmg: 33, headMult: 1.6, rpm: 540, mag: 30, reserve: 120, range: 40,  falloff: 65,  hip: 3.8, ads: 0.6,  adsTime: 0.30, reload: 2.3, recP: 0.72, recY: 0.32, auto: true,  moveMult: 0.94, snd: 'ar',       len: 0.82 },
  { id: 'hornet',      name: 'Hornet-9',       cls: 'SMG',     dmg: 22, headMult: 1.5, rpm: 860, mag: 32, reserve: 128, range: 22,  falloff: 40,  hip: 2.8, ads: 0.7,  adsTime: 0.22, reload: 1.9, recP: 0.45, recY: 0.36, auto: true,  moveMult: 1.00, snd: 'smg',      len: 0.62 },
  { id: 'wasp',        name: 'Wasp-45',        cls: 'SMG',     dmg: 26, headMult: 1.5, rpm: 700, mag: 28, reserve: 112, range: 24,  falloff: 42,  hip: 3.0, ads: 0.7,  adsTime: 0.24, reload: 2.0, recP: 0.52, recY: 0.30, auto: true,  moveMult: 1.00, snd: 'smg',      len: 0.66 },
  { id: 'bulwark',     name: 'Bulwark-60',     cls: 'LMG',     dmg: 30, headMult: 1.6, rpm: 520, mag: 75, reserve: 150, range: 38,  falloff: 70,  hip: 4.4, ads: 0.8,  adsTime: 0.38, reload: 3.4, recP: 0.60, recY: 0.26, auto: true,  moveMult: 0.90, snd: 'lmg',      len: 0.92 },
  { id: 'longshot',    name: 'Longshot-8',     cls: 'Sniper',  dmg: 130, headMult: 2.0, rpm: 42, mag: 5,  reserve: 25,  range: 120, falloff: 160, hip: 7.5, ads: 0.05, adsTime: 0.45, reload: 3.0, recP: 2.4,  recY: 0.40, auto: false, moveMult: 0.92, snd: 'sniper',   len: 1.05, zoomFov: 0.32 },
  { id: 'breacher',    name: 'Breacher-12',    cls: 'Shotgun', dmg: 11, headMult: 1.4, rpm: 75,  mag: 6,  reserve: 30,  range: 12,  falloff: 26,  hip: 4.6, ads: 2.6,  adsTime: 0.26, reload: 2.6, recP: 1.7,  recY: 0.55, auto: false, moveMult: 0.97, snd: 'shotgun',  len: 0.80, pellets: 8 },
  { id: 'p9',          name: 'P9 Sidearm',     cls: 'Pistol',  dmg: 24, headMult: 1.6, rpm: 380, mag: 12, reserve: 48,  range: 20,  falloff: 36,  hip: 2.6, ads: 0.6,  adsTime: 0.20, reload: 1.5, recP: 0.50, recY: 0.22, auto: false, moveMult: 1.02, snd: 'pistol',   len: 0.34 },
  { id: 'handcannon',  name: '.44 Handcannon', cls: 'Pistol',  dmg: 46, headMult: 1.7, rpm: 200, mag: 8,  reserve: 40,  range: 24,  falloff: 42,  hip: 3.2, ads: 0.7,  adsTime: 0.24, reload: 1.8, recP: 0.95, recY: 0.32, auto: false, moveMult: 1.00, snd: 'pistol',   len: 0.40 },
];
export const weaponById = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];

// ================= ATTACHMENTS (real stat mods) =================
export const ATTACHMENTS = {
  optic: [
    { id: 'none',   name: 'None',        mods: {} },
    { id: 'reddot', name: 'Red Dot',     desc: 'Faster ADS, tighter ADS spread', mods: { adsTime: 0.9, ads: 0.88 } },
    { id: 'holo',   name: 'Holographic', desc: 'Much tighter ADS spread',        mods: { adsTime: 1.06, ads: 0.75 } },
    { id: 'acog',   name: '2x Scope',    desc: 'Zoomed ADS, slower ADS',         mods: { adsTime: 1.22, ads: 0.7, zoomMult: 0.72 } },
  ],
  barrel: [
    { id: 'none',    name: 'None',       mods: {} },
    { id: 'supp',   name: 'Suppressor',  desc: 'Hidden from minimap, -recoil, -range', mods: { range: 0.9, recP: 0.88, recY: 0.88, suppressed: true } },
    { id: 'long',   name: 'Long Barrel', desc: '+25% range, slower ADS',         mods: { range: 1.25, falloff: 1.2, adsTime: 1.12 } },
    { id: 'short',  name: 'Short Barrel',desc: 'Faster ADS, -range',             mods: { adsTime: 0.86, range: 0.8, moveMult: 1.03 } },
  ],
  grip: [
    { id: 'none',  name: 'None',         mods: {} },
    { id: 'vert',  name: 'Vertical Grip',desc: '-25% recoil',                   mods: { recP: 0.75, recY: 0.75 } },
    { id: 'angled',name: 'Angled Grip',  desc: 'Faster ADS, tighter hipfire',    mods: { adsTime: 0.9, hip: 0.9 } },
  ],
  mag: [
    { id: 'none', name: 'None',          mods: {} },
    { id: 'ext',  name: 'Extended Mag',  desc: '+50% mag size, slower reload',   mods: { magMult: 1.5, reload: 1.12 } },
    { id: 'fast', name: 'Fast Mag',      desc: '25% faster reload',              mods: { reload: 0.75 } },
  ],
};
export const ATTACH_SLOTS = ['optic', 'barrel', 'grip', 'mag'];

// ================= PERKS =================
export const PERKS = {
  fasthands:   { name: 'Fast Hands',   desc: '20% faster ADS/reload, 35% faster weapon swap' },
  scavenger:   { name: 'Scavenger',    desc: 'Kills restore one magazine of reserve ammo' },
  coldblooded: { name: 'Cold-Blooded', desc: 'Invisible to enemy UAV' },
  lightweight: { name: 'Lightweight',  desc: '+7% movement speed' },
  flakjacket:  { name: 'Flak Jacket',  desc: '40% less explosive damage' },
  dexterity:   { name: 'Dexterity',    desc: '25% less recoil' },
};

// ================= EQUIPMENT =================
export const LETHALS = {
  frag:          { name: 'Frag Grenade',  desc: '2.0s fuse, large blast', fuse: 2.0, radius: 7, dmg: 150 },
  semtex:        { name: 'Semtex',        desc: '1.0s fuse, sticks to cover, smaller blast', fuse: 1.0, radius: 5, dmg: 130 },
  throwingknife: { name: 'Throwing Knife',desc: 'Instant 100 dmg on direct hit', fuse: 0, radius: 0.5, dmg: 100 },
};
export const TACTICALS = {
  flash: { name: 'Flashbang', desc: 'Blinds enemies looking at it' },
  stun:  { name: 'Stun Grenade', desc: 'Slows and scrambles enemy aim' },
  smoke: { name: 'Smoke', desc: 'Blocks bot line-of-sight for 14s' },
};

// Effective stats after attachments + perks
export function computeStats(weaponId, attachments = {}, perkIds = []) {
  const def = weaponById(weaponId);
  const s = {
    weaponId, def,
    dmg: def.dmg, headMult: def.headMult, rpm: def.rpm,
    mag: def.mag, reserve: def.reserve, range: def.range, falloff: def.falloff,
    hip: def.hip, ads: def.ads, adsTime: def.adsTime, reload: def.reload,
    recP: def.recP, recY: def.recY, auto: def.auto, pellets: def.pellets || 1,
    moveMult: def.moveMult, snd: def.snd, zoomFov: def.zoomFov || 0.62,
    zoomMult: 1, suppressed: false, swapTime: 0.35,
    attachIds: {},
  };
  for (const slot of ATTACH_SLOTS) {
    const att = (ATTACHMENTS[slot] || []).find(a => a.id === (attachments[slot] || 'none'));
    s.attachIds[slot] = att ? att.id : 'none';
    if (!att) continue;
    const m = att.mods;
    for (const k of ['adsTime', 'ads', 'hip', 'range', 'falloff', 'recP', 'recY', 'reload', 'moveMult', 'zoomMult'])
      if (m[k] !== undefined) s[k] *= m[k];
    if (m.magMult) s.mag = Math.round(s.mag * m.magMult);
    if (m.suppressed) s.suppressed = true;
  }
  const has = p => perkIds.includes(p);
  if (has('fasthands')) { s.adsTime *= 0.8; s.reload *= 0.8; s.swapTime *= 0.65; }
  if (has('lightweight')) s.moveMult *= 1.07;
  if (has('dexterity')) { s.recP *= 0.75; s.recY *= 0.75; }
  return s;
}

// ================= PROCEDURAL VIEWMODEL =================
const _geoCache = {};
function box(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!_geoCache[k]) _geoCache[k] = new THREE.BoxGeometry(w, h, d);
  return _geoCache[k];
}

export function buildViewmodel(def, camoType) {
  const group = new THREE.Group();
  const isReactive = camoType === 'reactive';
  let camoTex, reactive = null;
  if (isReactive) { reactive = makeReactiveTexture(); camoTex = reactive.tex; }
  else camoTex = getCamoTexture(camoType);

  const bodyMat = new THREE.MeshStandardMaterial({ map: camoTex, roughness: camoType === 'gold' || camoType === 'diamond' ? 0.25 : 0.6, metalness: camoType === 'gold' || camoType === 'diamond' ? 0.75 : 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.9, metalness: 0.05 });

  const L = def.len;
  const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); group.add(mesh); return mesh; };
  const B = (w, h, d, mat = bodyMat) => new THREE.Mesh(box(w, h, d), mat);

  // receiver
  add(B(0.075, 0.11, L * 0.45), 0, 0, -L * 0.1);
  // barrel
  const barrelLen = L * 0.42;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, barrelLen, 10), darkMat);
  barrel.rotation.x = Math.PI / 2; add(barrel, 0, 0.012, -L * 0.32 - barrelLen / 2 + L * 0.12);
  // muzzle tip
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -L * 0.32 - barrelLen + L * 0.12);
  group.add(muzzle);
  // stock
  add(B(0.06, 0.09, L * 0.28), 0, -0.01, L * 0.22, 0.06);
  // pistol grip
  add(B(0.055, 0.13, 0.06, gripMat), 0, -0.1, L * 0.02, 0.35);
  // magazine
  const magMesh = add(B(0.06, 0.16, 0.09, darkMat), 0, -0.12, -L * 0.08, 0.18);
  // foregrip / handguard
  add(B(0.07, 0.07, L * 0.22, gripMat), 0, -0.03, -L * 0.28);
  // rear sight + front sight / optic mount
  add(B(0.03, 0.035, 0.03, darkMat), 0, 0.075, L * 0.08);
  add(B(0.016, 0.04, 0.016, darkMat), 0, 0.07, -L * 0.42);
  if (def.cls === 'Sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.16, 12), darkMat);
    scope.rotation.x = Math.PI / 2; add(scope, 0, 0.1, -L * 0.12);
  }
  // side rails detail
  add(B(0.085, 0.015, L * 0.3, darkMat), 0, 0.062, -L * 0.05);

  // first-person arms: uniform sleeves + gloved hands (operator look applied later)
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x4a5d23, roughness: 0.9 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.9 });
  const armTo = (side, hand) => {
    const elbow = new THREE.Vector3(side * 0.19, -0.4, 0.3);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 1), sleeveMat);
    const mid = elbow.clone().lerp(hand, 0.5);
    fore.position.copy(mid);
    fore.lookAt(hand);
    fore.scale.z = elbow.distanceTo(hand);
    fore.frustumCulled = false;
    group.add(fore);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.11), gloveMat);
    palm.position.copy(hand); palm.frustumCulled = false;
    group.add(palm);
  };
  armTo(1, new THREE.Vector3(0.015, -0.13, 0.03));   // right hand on pistol grip
  armTo(-1, new THREE.Vector3(-0.01, -0.055, -L * 0.28)); // left hand on foregrip

  // charm anchor (right side of receiver) + sticker mount (left side)
  const charmAnchor = new THREE.Object3D();
  charmAnchor.position.set(0.052, -0.01, -0.03);
  group.add(charmAnchor);
  const stickerMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.095, 0.095),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 })
  );
  stickerMesh.position.set(-0.0385, 0.005, -0.06);
  stickerMesh.rotation.y = -Math.PI / 2;
  stickerMesh.visible = false;
  group.add(stickerMesh);

  // muzzle flash: additive plane + point light
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc866, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
  flash.position.copy(muzzle.position); flash.position.z -= 0.08;
  group.add(flash);
  const flashLight = new THREE.PointLight(0xffb84d, 0, 9);
  flashLight.position.copy(muzzle.position);
  group.add(flashLight);

  group.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group, muzzle, magMesh, flash, flashMat, flashLight, reactive, sleeveMat, gloveMat, charmAnchor, stickerMesh };
}

// Weapon instance: ammo state + viewmodel animation state
export class WeaponInstance {
  constructor(def, stats, camoType) {
    this.def = def; this.stats = stats;
    this.magAmmo = stats.mag; this.reserveAmmo = stats.reserve;
    this.reloading = false; this.reloadT = 0;
    this.lastShot = -99; this.adsK = 0; this.bloom = 0;
    this.kick = 0; this.swapT = 0; this.flashT = 0;
    this.view = buildViewmodel(def, camoType);
    this.camoType = camoType;
    this.hipPos = new THREE.Vector3(0.27, -0.27, -0.45);
    this.adsPos = new THREE.Vector3(0, -0.156, -0.32);
    this.baseFov = 80;
  }
  get interval() { return 60 / this.stats.rpm; }
  canFire(now) { return !this.reloading && this.swapT <= 0 && this.magAmmo > 0 && now - this.lastShot >= this.interval - 1e-4; }
  onFired(now) {
    this.lastShot = now; this.magAmmo--;
    this.bloom = Math.min(this.bloom + (this.stats.ads < 1 ? 0.5 : 0.35), 3.2);
    this.kick = Math.min(this.kick + 1, 2.2);
    this.flashT = 0.055;
  }
  startReload(perkFast) {
    if (this.reloading || this.magAmmo >= this.stats.mag || this.reserveAmmo <= 0) return false;
    this.reloading = true;
    this.reloadT = this.stats.reload * (perkFast ? 0.8 : 1);
    return true;
  }
  updateReload(dt) {
    if (!this.reloading) return false;
    this.reloadT -= dt;
    if (this.reloadT <= 0) {
      const need = this.stats.mag - this.magAmmo;
      const take = Math.min(need, this.reserveAmmo);
      this.magAmmo += take; this.reserveAmmo -= take;
      this.reloading = false;
      return true;
    }
    return false;
  }
  // Animate viewmodel; returns nothing. adsTarget 0..1.
  updateView(dt, adsTarget, moving, sprinting, now) {
    const v = this.view;
    const adsSpeed = 1 / Math.max(0.05, this.stats.adsTime);
    this.adsK = clamp(this.adsK + (adsTarget > this.adsK ? dt * adsSpeed : -dt * adsSpeed * 1.4), 0, 1);
    const k = this.adsK * this.adsK * (3 - 2 * this.adsK); // smoothstep
    const pos = new THREE.Vector3().lerpVectors(this.hipPos, this.adsPos, k);
    // sprint lowers weapon
    const sprintK = sprinting ? 1 : 0;
    this._sprintK = lerp(this._sprintK || 0, sprintK, dt * 8);
    pos.y -= this._sprintK * 0.12; pos.x += this._sprintK * 0.06;
    // reload dip
    if (this.reloading) { pos.y -= 0.1 * Math.sin(Math.PI * clamp(1 - this.reloadT / this.stats.reload, 0, 1)); }
    // walk bob
    this._bobT = (this._bobT || 0) + dt * (moving ? 9 : 2);
    const bobA = moving ? 0.012 * (1 - k * 0.8) : 0.003;
    pos.x += Math.cos(this._bobT) * bobA; pos.y += Math.abs(Math.sin(this._bobT)) * bobA;
    // recoil kick
    this.kick = Math.max(0, this.kick - dt * 7);
    pos.z += this.kick * 0.03; pos.y += this.kick * 0.012;
    v.group.position.copy(pos);
    v.group.rotation.set(this.kick * 0.06 + this._sprintK * 0.5, 0, this._sprintK * 0.25);
    // muzzle flash decay
    this.flashT -= dt;
    const f = this.flashT > 0 ? 1 : 0;
    v.flashMat.opacity = f * 0.95;
    v.flashLight.intensity = f * 26;
    if (f) { v.flash.rotation.z = rand(0, Math.PI); const s = rand(0.8, 1.3); v.flash.scale.set(s, s, 1); }
    // reactive camo glow follows streak level (throttled repaint)
    if (v.reactive && this.reactiveLevel !== undefined) {
      const lvl = clamp(this.reactiveLevel, 0, 1);
      this._reactiveTick = (this._reactiveTick || 0) + 1;
      if (Math.abs(lvl - (this._reactiveLvl || -1)) > 0.04 || this._reactiveTick % 20 === 0) {
        this._reactiveLvl = lvl;
        paintReactive(v.reactive.ctx, v.reactive.size, lvl);
        v.reactive.tex.needsUpdate = true;
      }
    }
    this.bloom = Math.max(0, this.bloom - dt * 5);
    if (this.swapT > 0) this.swapT -= dt;
    // charm sway
    if (v.charmAnchor) {
      v.charmAnchor.rotation.x = Math.sin(now * 2.3) * 0.28;
      v.charmAnchor.rotation.z = Math.cos(now * 1.8) * 0.28;
    }
  }
  setReactiveLevel(l) { this.reactiveLevel = l; }
  currentSpread(moving, inAir) {
    let s = lerp(this.stats.hip, this.stats.ads, this.adsK);
    s *= 1 + this.bloom * 0.28;
    if (moving) s *= 1.45;
    if (inAir) s *= 2.2;
    return s; // degrees
  }
}
