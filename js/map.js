import * as THREE from 'three';
import { makeBox, rayAABB, rand } from './util.js';

export const MAP_SIZE = 140;
export const MAP_HALF = 68;

function groundTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#3a3f45'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const g = 50 + Math.random() * 30;
    c.fillStyle = `rgb(${g},${g + 3},${g + 6})`;
    c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, S); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(S, i * 64); c.stroke(); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(18, 18);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildMap(scene) {
  const colliders = [];
  const world = new THREE.Group();
  scene.add(world);

  // lighting / atmosphere
  scene.background = new THREE.Color(0x0d1420);
  scene.fog = new THREE.Fog(0x0d1420, 60, 170);
  const hemi = new THREE.HemisphereLight(0x8fb4d8, 0x2a2620, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b3, 1.15);
  sun.position.set(-40, 70, -30);
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  world.add(ground);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.9 });
  const concreteDark = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8a6d2f, roughness: 0.8 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5c36, roughness: 0.85 });
  const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x5c6b3c, roughness: 0.85 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x565b63, roughness: 0.9 });

  function solid(cx, cy, cz, sx, sy, sz, mat = concrete, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, cy, cz);
    world.add(m);
    if (collide) colliders.push(makeBox(cx, cy, cz, sx, sy, sz));
    return m;
  }

  // perimeter walls
  const H = 7;
  solid(0, H / 2, -70, 142, H, 2, concreteDark);
  solid(0, H / 2, 70, 142, H, 2, concreteDark);
  solid(-70, H / 2, 0, 2, H, 142, concreteDark);
  solid(70, H / 2, 0, 2, H, 142, concreteDark);

  // ---- 3 lanes along Z. Alpha spawns z<0 (south), Bravo z>0 (north) ----
  // West lane buildings (x=-45)
  solid(-45, 4, -28, 18, 8, 16, concrete);
  solid(-45, 8.4, -28, 18.6, 0.8, 16.6, accent, false);
  solid(-45, 4, 18, 18, 8, 16, concreteDark);
  solid(-45, 8.4, 18, 18.6, 0.8, 16.6, accent, false);
  // East lane buildings (x=+45)
  solid(45, 4, -28, 18, 8, 16, concreteDark);
  solid(45, 8.4, -28, 18.6, 0.8, 16.6, accent, false);
  solid(45, 4, 18, 18, 8, 16, concrete);
  solid(45, 8.4, 18, 18.6, 0.8, 16.6, accent, false);

  // Cross-lane connector walls at z=-18 and z=+18 with mid gap
  for (const z of [-18, 18]) {
    solid(-41, 2, z, 58, 4, 1.6, wallMat);
    solid(41, 2, z, 58, 4, 1.6, wallMat);
  }

  // Mid courtyard broken walls near center
  solid(-7, 1.5, 0, 1.4, 3, 12, wallMat);
  solid(7, 1.5, 0, 1.4, 3, 12, wallMat);
  solid(0, 1.1, -9, 12, 2.2, 1.4, wallMat);
  solid(0, 1.1, 9, 12, 2.2, 1.4, wallMat);

  // Crates scattered mid + lanes
  const crates = [
    [0, -32, 3.4, crateMat], [6, -26, 2.6, crateMat2], [-6, -26, 2.6, crateMat2],
    [0, 32, 3.4, crateMat2], [6, 26, 2.6, crateMat], [-6, 26, 2.6, crateMat],
    [-24, -44, 3, crateMat], [24, -44, 3, crateMat2], [-24, 44, 3, crateMat2], [24, 44, 3, crateMat],
    [-24, -8, 2.6, crateMat2], [24, 8, 2.6, crateMat], [-24, 8, 2.6, crateMat], [24, -8, 2.6, crateMat2],
    [-58, 0, 3, crateMat], [58, 0, 3, crateMat2], [-58, -52, 2.6, crateMat2], [58, 52, 2.6, crateMat],
  ];
  for (const [x, z, s, m] of crates) {
    const c = solid(x, s / 2, z, s, s, s, m);
    c.rotation.y = rand(-0.2, 0.2);
  }
  // stacked crates
  solid(-14, 1.5, -38, 3, 3, 3, crateMat); solid(-14, 4.2, -38, 2.6, 2.4, 2.6, crateMat2);
  solid(14, 1.5, 38, 3, 3, 3, crateMat2); solid(14, 4.2, 38, 2.6, 2.4, 2.6, crateMat);

  // barrels (visual only + box colliders)
  const barrelGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.8, 10);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a3b28, roughness: 0.7 });
  const barrelMat2 = new THREE.MeshStandardMaterial({ color: 0x2f5a3c, roughness: 0.7 });
  for (const [x, z, m] of [[-10, -50, 0], [-11.6, -49, 1], [10, 50, 1], [11.6, 49, 0], [-34, 30, 1], [34, -30, 0]]) {
    const b = new THREE.Mesh(barrelGeo, m ? barrelMat2 : barrelMat);
    b.position.set(x, 0.9, z); world.add(b);
    colliders.push(makeBox(x, 0.9, z, 1.4, 1.8, 1.4));
  }

  // distant skyline silhouettes
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x111a26 });
  for (let i = 0; i < 26; i++) {
    const w = rand(8, 20), h = rand(15, 45);
    const a = (i / 26) * Math.PI * 2;
    const r = 120;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyMat);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    world.add(m);
  }

  // ---- waypoints ----
  const nodePos = [];
  for (const z of [-55, -35, -15, 5, 25, 45, 60]) nodePos.push([-52, z]);
  for (const z of [-55, -35, -15, 15, 35, 55]) nodePos.push([0, z]);
  for (const z of [-55, -35, -15, 5, 25, 45, 60]) nodePos.push([52, z]);
  for (const [x, z] of [[-26, -18], [26, -18], [-26, 18], [26, 18], [0, -18], [0, 18], [-8, 0], [8, 0], [-30, -45], [30, -45], [-30, 45], [30, 45]]) nodePos.push([x, z]);
  const nodes = nodePos.map(([x, z]) => new THREE.Vector3(x, 0, z));
  // link nodes within 26m if clear LOS at eye height
  const adj = nodes.map(() => []);
  const tmpO = new THREE.Vector3(), tmpD = new THREE.Vector3();
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const d = nodes[i].distanceTo(nodes[j]);
    if (d > 26) continue;
    tmpO.copy(nodes[i]); tmpO.y = 1.0;
    tmpD.copy(nodes[j]).sub(nodes[i]).normalize();
    let blocked = false;
    for (const c of colliders) {
      const t = rayAABB(tmpO, tmpD, c, d);
      if (t < d - 1.5) { blocked = true; break; }
    }
    if (!blocked) { adj[i].push(j); adj[j].push(i); }
  }

  // ---- spawns ----
  const spawns = {
    alpha: [[-18, -62], [-8, -64], [0, -62], [8, -64], [18, -62], [-26, -58], [26, -58]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    bravo: [[-18, 62], [-8, 64], [0, 62], [8, 64], [18, 62], [-26, 58], [26, 58]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    ffa: [[-52, -55], [52, -55], [-52, 55], [52, 55], [0, -45], [0, 45], [-30, 0], [30, 0], [-60, -20], [60, 20]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  };

  // ---- domination flags ----
  const flags = [];
  const flagDefs = [{ id: 'A', x: 0, z: -44 }, { id: 'B', x: 0, z: 0 }, { id: 'C', x: 0, z: 44 }];
  for (const f of flagDefs) {
    const grp = new THREE.Group(); grp.position.set(f.x, 0, f.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 8), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    pole.position.y = 2.5; grp.add(pole);
    const bannerMat = new THREE.MeshBasicMaterial({ color: 0x999999, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), bannerMat);
    banner.position.set(0.85, 4.3, 0); grp.add(banner);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4, 32), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; grp.add(ring);
    const label = makeTextSprite(f.id);
    label.position.y = 5.6; grp.add(label);
    world.add(grp);
    flags.push({ id: f.id, pos: new THREE.Vector3(f.x, 0, f.z), owner: null, progress: 0, capturing: null, grp, bannerMat, ringMat });
  }

  // ---- SND bomb sites (visuals toggled by Game when mode==='snd') ----
  const bombSites = [];
  for (const f of [{ id: 'A', x: -26, z: -18 }, { id: 'B', x: 26, z: 18 }]) {
    const grp = new THREE.Group(); grp.position.set(f.x, 0, f.z);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 32), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; grp.add(ring);
    const label = makeTextSprite(f.id); label.position.y = 3.2; grp.add(label);
    grp.visible = false; world.add(grp);
    bombSites.push({ id: f.id, pos: new THREE.Vector3(f.x, 0, f.z), grp });
  }

  // ---- CTF bases (visuals toggled by Game when mode==='ctf') ----
  const ctfBases = {};
  for (const [team, x, z] of [['alpha', 0, -56], ['bravo', 0, 56]]) {
    const grp = new THREE.Group(); grp.position.set(x, 0, z);
    const col = team === 'alpha' ? 0x4da3ff : 0xff5a4d;
    const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 32), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; grp.add(ring);
    const label = makeTextSprite(team === 'alpha' ? '◈A' : '◈B'); label.position.y = 3.4; grp.add(label);
    grp.visible = false; world.add(grp);
    ctfBases[team] = { pos: new THREE.Vector3(x, 0, z), grp };
  }

  return {
    name: 'Strike Zone', colliders, waypoints: { nodes, adj }, spawns, flags, bombSites, ctfBases,
    bounds: MAP_HALF,
    setFlagOwner(flag, team) {
      flag.owner = team; flag.progress = 0; flag.capturing = null;
      const col = team === 'alpha' ? 0x4da3ff : team === 'bravo' ? 0xff5a4d : 0x999999;
      flag.bannerMat.color.setHex(col); flag.ringMat.color.setHex(col);
    },
    update(dt) {
      for (const f of flags) f.grp.children[1].rotation.y += dt * 0.8; // wave banner
    },
  };
}

function makeTextSprite(text) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.font = 'bold 44px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(cv);
  const m = new THREE.SpriteMaterial({ map: t, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(1.6, 1.6, 1);
  return s;
}

// BFS path on waypoint graph. Returns array of Vector3.
export function findPath(graph, from, to) {
  const { nodes, adj } = graph;
  let si = 0, sd = Infinity, ti = 0, td = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d1 = nodes[i].distanceToSquared(from), d2 = nodes[i].distanceToSquared(to);
    if (d1 < sd) { sd = d1; si = i; }
    if (d2 < td) { td = d2; ti = i; }
  }
  if (si === ti) return [nodes[ti].clone()];
  const prev = new Array(nodes.length).fill(-1);
  const q = [si]; prev[si] = si;
  while (q.length) {
    const cur = q.shift();
    if (cur === ti) break;
    for (const n of adj[cur]) if (prev[n] === -1) { prev[n] = cur; q.push(n); }
  }
  if (prev[ti] === -1) return [nodes[ti].clone()];
  const path = [];
  let cur = ti;
  while (cur !== si) { path.unshift(nodes[cur].clone()); cur = prev[cur]; }
  return path;
}
