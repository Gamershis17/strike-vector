import * as THREE from 'three';
import { randInt, choice } from './util.js';

// Camo definitions with per-weapon unlock challenges
export const CAMOS = [
  { id: 'default',  name: 'Default',           desc: 'Factory finish',            challenge: null },
  { id: 'woodland', name: 'Digital Woodland',  desc: '25 kills with this weapon', challenge: { kills: 25 } },
  { id: 'desert',   name: 'Desert Digital',    desc: '50 kills with this weapon', challenge: { kills: 50 } },
  { id: 'gold',     name: 'Gold',              desc: '25 headshots with this weapon', challenge: { headshots: 25 } },
  { id: 'diamond',  name: 'Diamond',           desc: '100 kills with this weapon', challenge: { kills: 100 } },
  { id: 'reactive', name: 'Reactive Core',     desc: '150 kills — glows with your streak', challenge: { kills: 150 }, animated: true },
];

const STORE_KEY = 'sv_camos_v1';
let store = { progress: {}, unlocked: {}, equipped: {} };
try { Object.assign(store, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) {}

function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {} }
function prog(weaponId) {
  if (!store.progress[weaponId]) store.progress[weaponId] = { kills: 0, headshots: 0 };
  return store.progress[weaponId];
}
function unlockedList(weaponId) {
  if (!store.unlocked[weaponId]) store.unlocked[weaponId] = ['default'];
  return store.unlocked[weaponId];
}

export function recordWeaponKill(weaponId, headshot) {
  const p = prog(weaponId);
  p.kills++; if (headshot) p.headshots++;
  const list = unlockedList(weaponId);
  for (const c of CAMOS) {
    if (!c.challenge || list.includes(c.id)) continue;
    const ch = c.challenge;
    if ((ch.kills && p.kills >= ch.kills) || (ch.headshots && p.headshots >= ch.headshots)) {
      list.push(c.id);
    }
  }
  save();
  return unlockedList(weaponId);
}
export function getUnlocked(weaponId) { return unlockedList(weaponId).slice(); }
export function getProgress(weaponId) { return { ...prog(weaponId) }; }
export function equipCamo(weaponId, camoId) {
  if (!unlockedList(weaponId).includes(camoId)) return false;
  store.equipped[weaponId] = camoId; save(); return true;
}
export function equippedCamo(weaponId) { return store.equipped[weaponId] || 'default'; }
export function challengeText(camo, weaponId) {
  if (!camo.challenge) return 'Unlocked';
  const p = prog(weaponId);
  const ch = camo.challenge;
  if (ch.kills) return `${Math.min(p.kills, ch.kills)}/${ch.kills} kills`;
  if (ch.headshots) return `${Math.min(p.headshots, ch.headshots)}/${ch.headshots} headshots`;
  return '';
}

// ---------- procedural camo painting ----------
function digitalCamo(ctx, S, palette, px) {
  ctx.fillStyle = palette[0]; ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += px) for (let x = 0; x < S; x += px) {
    if (Math.random() < 0.72) { ctx.fillStyle = choice(palette); ctx.fillRect(x, y, px, px); }
  }
}
function paintCamo(ctx, type, S) {
  if (type === 'default') {
    ctx.fillStyle = '#2a2d31'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#22252a';
    for (let i = 0; i < 40; i++) ctx.fillRect(randInt(0, S - 8), randInt(0, S - 8), randInt(4, 20), 3);
  } else if (type === 'woodland') {
    digitalCamo(ctx, S, ['#3d4a2a', '#2c3520', '#5a6337', '#1f2617', '#6b7250'], 16);
  } else if (type === 'desert') {
    digitalCamo(ctx, S, ['#c2a878', '#a98f60', '#d9c194', '#8a734e', '#b39b6d'], 16);
  } else if (type === 'gold') {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#8a6a1f'); g.addColorStop(0.4, '#f5d76e'); g.addColorStop(0.6, '#caa53d'); g.addColorStop(1, '#7a5f18');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 60; i++) ctx.fillRect(randInt(0, S - 4), randInt(0, S - 4), randInt(2, 8), 2);
    ctx.fillStyle = 'rgba(60,40,10,0.35)';
    for (let i = 0; i < 40; i++) ctx.fillRect(randInt(0, S - 4), randInt(0, S - 4), randInt(2, 10), 2);
  } else if (type === 'diamond') {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#5a7a96'); g.addColorStop(0.35, '#cfe8f7'); g.addColorStop(0.55, '#8fb6d4'); g.addColorStop(1, '#4a6a88');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    // facet lines
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      const x = randInt(0, S), y = randInt(0, S);
      ctx.moveTo(x, y); ctx.lineTo(x + randInt(-30, 30), y + randInt(-30, 30)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 50; i++) { const s = randInt(1, 3); ctx.fillRect(randInt(0, S - s), randInt(0, S - s), s, s); }
  } else if (type === 'reactive') {
    paintReactive(ctx, S, 0);
  }
}

// Animated reactive camo: dark base + energy veins; level 0..1 controls glow.
export function paintReactive(ctx, S, level) {
  ctx.fillStyle = '#0c0e14'; ctx.fillRect(0, 0, S, S);
  const glow = 0.25 + level * 0.75;
  ctx.strokeStyle = `rgba(0,220,255,${0.5 * glow})`; ctx.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    let x = randInt(0, S), y = randInt(0, S);
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += randInt(-40, 40); y += randInt(-40, 40); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(0,255,255,${0.5 * glow})`;
  for (let i = 0; i < 26; i++) { const s = randInt(2, 5); ctx.fillRect(randInt(0, S - s), randInt(0, S - s), s, s); }
}

const texCache = {};
export function getCamoTexture(type) {
  if (texCache[type]) return texCache[type];
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  paintCamo(cv.getContext('2d'), type, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache[type] = tex;
  return tex;
}
// Per-weapon reactive texture instance (animated independently)
export function makeReactiveTexture() {
  const S = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, cv, ctx: cv.getContext('2d'), size: S };
}
// Small preview canvas for the camo picker UI
export function paintCamoPreview(canvas, type) {
  const ctx = canvas.getContext('2d');
  paintCamo(ctx, type, canvas.width);
}
