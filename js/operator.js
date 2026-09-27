import * as THREE from 'three';

// ================= OPERATOR CUSTOMIZATION (procedural, zero assets) =================
// Profile: uniform pattern, headgear, glove color. Persists in localStorage.
const OP_KEY = 'sv_operator_v1';
export let operator = { uniform: 'woodland', headgear: 'helmet', gloves: 'black' };
try { Object.assign(operator, JSON.parse(localStorage.getItem(OP_KEY) || '{}')); } catch (e) {}
export function saveOperator() { try { localStorage.setItem(OP_KEY, JSON.stringify(operator)); } catch (e) {} }

export const UNIFORMS = [
  { id: 'woodland', name: 'Woodland', desc: 'Green/brown temperate camo' },
  { id: 'desert',   name: 'Desert',   desc: 'Tan arid camo' },
  { id: 'urban',    name: 'Urban',    desc: 'Gray city camo' },
  { id: 'night',    name: 'Night Ops',desc: 'Dark navy/black stealth' },
  { id: 'dev',      name: 'Dev Ops',  desc: 'Exclusive developer uniform', devOnly: true },
];
export const HEADGEAR = [
  { id: 'helmet', name: 'Combat Helmet', desc: 'Standard ballistic helmet' },
  { id: 'cap',    name: 'Patrol Cap',    desc: 'Soft patrol cap' },
  { id: 'hood',   name: 'Hood',          desc: 'Balaclava-style hood' },
  { id: 'boonie', name: 'Boonie Hat',    desc: 'Wide-brim field hat' },
];
export const GLOVES = [
  { id: 'black',  name: 'Black',      color: '#1b1b1e' },
  { id: 'coyote', name: 'Coyote',     color: '#a08050' },
  { id: 'olive',  name: 'OD Green',   color: '#4a5d23' },
  { id: 'gray',   name: 'Wolf Gray',  color: '#6b6f75' },
  { id: 'tan',    name: 'Desert Tan', color: '#c2a878' },
  { id: 'navy',   name: 'Navy',       color: '#232a3a' },
];
export function gloveColor(id) { const g = GLOVES.find(g => g.id === id); return g ? g.color : '#1b1b1e'; }

// ---- procedural uniform canvas textures ----
const _texCache = {};
export function uniformTexture(id) {
  if (_texCache[id]) return _texCache[id];
  const palettes = {
    woodland: ['#4a5d23', '#2f3d1a', '#6b5b3e', '#1f2a12'],
    desert:   ['#c2a878', '#a88f5f', '#8a7350', '#d9c194'],
    urban:    ['#6b6f75', '#4a4d52', '#8b8f94', '#3a3d42'],
    night:    ['#232a3a', '#1a2030', '#2f3a52', '#12161f'],
    dev:      ['#1a1405', '#f5b301', '#8a6500', '#3a2c08'],
  };
  const pal = palettes[id] || palettes.woodland;
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = pal[0]; x.fillRect(0, 0, S, S);
  let seed = id.length * 7919 + 13;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    x.fillStyle = pal[1 + Math.floor(rnd() * (pal.length - 1))];
    const bx = rnd() * S, by = rnd() * S, r = 8 + rnd() * 30;
    x.beginPath();
    x.ellipse(bx, by, r, r * (0.4 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _texCache[id] = tex;
  return tex;
}

// ---- low-poly 3D operator model (menu preview) ----
export function buildOperatorModel(op) {
  const g = new THREE.Group();
  const uniTex = uniformTexture(op.uniform);
  const uniMat = new THREE.MeshStandardMaterial({ map: uniTex, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.7 });
  const vestMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.9 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(gloveColor(op.gloves)), roughness: 0.9 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.95 });
  const B = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  // legs + boots
  const legL = B(0.19, 0.72, 0.21, uniMat); legL.position.set(-0.12, 0.36, 0); g.add(legL);
  const legR = B(0.19, 0.72, 0.21, uniMat); legR.position.set(0.12, 0.36, 0); g.add(legR);
  const bootL = B(0.2, 0.12, 0.3, bootMat); bootL.position.set(-0.12, 0.06, 0.04); g.add(bootL);
  const bootR = B(0.2, 0.12, 0.3, bootMat); bootR.position.set(0.12, 0.06, 0.04); g.add(bootR);
  // torso
  const torso = B(0.52, 0.62, 0.3, uniMat); torso.position.set(0, 1.03, 0); g.add(torso);
  // vest
  const vest = B(0.56, 0.42, 0.36, vestMat); vest.position.set(0, 1.05, 0); g.add(vest);
  const vestF = B(0.4, 0.3, 0.05, vestMat); vestF.position.set(0, 1.02, 0.19); g.add(vestF);
  // arms (sleeves) + gloved hands
  const armL = B(0.15, 0.58, 0.17, uniMat); armL.position.set(-0.35, 1.0, 0); g.add(armL);
  const armR = B(0.15, 0.58, 0.17, uniMat); armR.position.set(0.35, 1.0, 0); g.add(armR);
  const handL = B(0.13, 0.14, 0.15, gloveMat); handL.position.set(-0.35, 0.66, 0); g.add(handL);
  const handR = B(0.13, 0.14, 0.15, gloveMat); handR.position.set(0.35, 0.66, 0); g.add(handR);
  // head
  const head = B(0.26, 0.28, 0.26, skinMat); head.position.set(0, 1.48, 0); g.add(head);
  // headgear
  const hg = op.headgear;
  if (hg === 'helmet') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x4a5232, roughness: 0.7 }));
    dome.position.set(0, 1.52, 0); g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 14), dome.material);
    brim.position.set(0, 1.55, 0); g.add(brim);
  } else if (hg === 'cap') {
    const crown = B(0.27, 0.12, 0.27, uniMat); crown.position.set(0, 1.64, 0); g.add(crown);
    const brim = B(0.24, 0.03, 0.22, uniMat); brim.position.set(0, 1.6, 0.22); g.add(brim);
  } else if (hg === 'hood') {
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 12), uniMat);
    hood.position.set(0, 1.5, -0.02); g.add(hood);
    const face = B(0.2, 0.2, 0.05, skinMat); face.position.set(0, 1.47, 0.14); g.add(face);
  } else if (hg === 'boonie') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), uniMat);
    dome.position.set(0, 1.58, 0); g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16), uniMat);
    brim.position.set(0, 1.58, 0); g.add(brim);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// Apply operator look to the local player's first-person viewmodels (sleeves + gloves).
export function applyOperatorToViewmodel(view) {
  if (!view) return;
  if (view.sleeveMat) { view.sleeveMat.map = uniformTexture(operator.uniform); view.sleeveMat.needsUpdate = true; }
  if (view.gloveMat) { view.gloveMat.color.set(gloveColor(operator.gloves)); }
}
