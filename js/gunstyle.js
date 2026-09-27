import * as THREE from 'three';

// ================= GUN STYLE: charms, stickers, reticles =================
// Persists in localStorage alongside classes/camos.
const GS_KEY = 'sv_gunstyle_v1';
export let gunStyle = { charm: 'none', sticker: 'none', reticle: 'dot', reticleColor: '#ff3b30' };
try { Object.assign(gunStyle, JSON.parse(localStorage.getItem(GS_KEY) || '{}')); } catch (e) {}
export function saveGunStyle() { try { localStorage.setItem(GS_KEY, JSON.stringify(gunStyle)); } catch (e) {} }

export const CHARMS = [
  { id: 'none',  name: 'None' },
  { id: 'skull', name: 'Skull', desc: 'Tiny lucky skull' },
  { id: 'star',  name: 'Star',  desc: 'Gold star' },
  { id: 'dice',  name: 'Dice',  desc: 'Pair of dice' },
];
export const STICKERS = [
  { id: 'none',  name: 'None' },
  { id: 'skull', name: 'Skull' },
  { id: 'bolt',  name: 'Lightning' },
  { id: 'sv',    name: 'SV Mark' },
  { id: 'stripe',name: 'Warning Stripes' },
];
export const RETICLES = [
  { id: 'dot',     name: 'Dot' },
  { id: 'cross',   name: 'Cross' },
  { id: 'chevron', name: 'Chevron' },
];
export const RETICLE_COLORS = [
  { id: '#ff3b30', name: 'Red' }, { id: '#30ff6b', name: 'Green' },
  { id: '#ffd24d', name: 'Amber' }, { id: '#4da3ff', name: 'Blue' },
  { id: '#ffffff', name: 'White' },
];

// ---- charm low-poly models (hang from the gun) ----
export function buildCharm(id) {
  const g = new THREE.Group();
  if (id === 'none') return g;
  // cord
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
  cord.position.y = -0.035; g.add(cord);
  const hang = new THREE.Group(); hang.position.y = -0.07; g.add(hang);
  if (id === 'skull') {
    const bone = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.8 });
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), bone);
    hang.add(cranium);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.02, 0.03), bone);
    jaw.position.set(0, -0.024, 0.008); hang.add(jaw);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), eyeM);
      eye.position.set(sx * 0.012, 0.004, 0.022); hang.add(eye);
    }
  } else if (id === 'star') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.7, roughness: 0.3 });
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), gold);
    star.scale.set(1, 1, 0.4); hang.add(star);
  } else if (id === 'dice') {
    const dieM = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const d1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), dieM);
    d1.position.set(-0.016, -0.012, 0); d1.rotation.set(0.4, 0.5, 0.2); hang.add(d1);
    const d2 = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.026), dieM);
    d2.position.set(0.016, -0.03, 0.01); d2.rotation.set(-0.3, 0.7, 0.5); hang.add(d2);
  }
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}

// ---- sticker decals (canvas textures on the receiver) ----
const _stCache = {};
export function stickerTexture(id) {
  if (id === 'none') return null;
  if (_stCache[id]) return _stCache[id];
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, S, S);
  if (id === 'skull') {
    x.fillStyle = '#e8e0cc';
    x.beginPath(); x.arc(64, 58, 30, 0, Math.PI * 2); x.fill();
    x.fillRect(42, 78, 44, 22);
    x.fillStyle = '#101010';
    x.beginPath(); x.arc(52, 54, 9, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(76, 54, 9, 0, Math.PI * 2); x.fill();
  } else if (id === 'bolt') {
    x.fillStyle = '#ffd24d';
    x.beginPath(); x.moveTo(74, 8); x.lineTo(40, 74); x.lineTo(60, 74);
    x.lineTo(50, 120); x.lineTo(90, 52); x.lineTo(68, 52); x.closePath(); x.fill();
  } else if (id === 'sv') {
    x.fillStyle = '#4da3ff'; x.font = 'bold 64px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SV', 64, 68);
  } else if (id === 'stripe') {
    x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#ffd24d';
    for (let i = -2; i < 6; i++) {
      x.save(); x.translate(i * 32, 0); x.rotate(Math.PI / 4);
      x.fillRect(0, -40, 14, 220); x.restore();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  _stCache[id] = tex;
  return tex;
}

// Apply charm + sticker to a weapon viewmodel.
export function applyGunStyleToViewmodel(view) {
  if (!view) return;
  if (view.charmAnchor) {
    while (view.charmAnchor.children.length) view.charmAnchor.remove(view.charmAnchor.children[0]);
    if (gunStyle.charm !== 'none') view.charmAnchor.add(buildCharm(gunStyle.charm));
  }
  if (view.stickerMesh) {
    const tex = stickerTexture(gunStyle.sticker);
    view.stickerMesh.visible = !!tex;
    if (tex) { view.stickerMesh.material.map = tex; view.stickerMesh.material.needsUpdate = true; }
  }
}

// Reticle HUD: returns HTML for the selected reticle style/color.
export function reticleHTML() {
  const c = gunStyle.reticleColor;
  const s = gunStyle.reticle;
  const ring = `border:2px solid ${c};border-radius:50%;width:54px;height:54px;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:.9`;
  if (s === 'dot') return `<div style="${ring}"></div><div style="position:absolute;left:50%;top:50%;width:6px;height:6px;background:${c};border-radius:50%;transform:translate(-50%,-50%)"></div>`;
  if (s === 'cross') return `<div style="${ring}"></div>` +
    `<div style="position:absolute;left:50%;top:50%;width:2px;height:26px;background:${c};transform:translate(-50%,-50%)"></div>` +
    `<div style="position:absolute;left:50%;top:50%;width:26px;height:2px;background:${c};transform:translate(-50%,-50%)"></div>`;
  // chevron
  return `<div style="${ring}"></div>` +
    `<div style="position:absolute;left:50%;top:50%;width:16px;height:16px;border-top:4px solid ${c};border-right:4px solid ${c};transform:translate(-50%,-30%) rotate(-45deg)"></div>`;
}
