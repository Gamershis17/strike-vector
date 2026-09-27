import * as THREE from 'three';

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choice = arr => arr[Math.floor(Math.random() * arr.length)];
export const chance = p => Math.random() < p;
export const TAU = Math.PI * 2;
export const deg2rad = d => d * Math.PI / 180;
export const rad2deg = r => r * 180 / Math.PI;

// Shortest-arc angle lerp
export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * clamp(t, 0, 1);
}

// Axis-aligned bounding box
export function makeBox(cx, cy, cz, sx, sy, sz) {
  return {
    min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    cx, cy, cz, sx, sy, sz
  };
}

// Ray vs AABB (slab). Returns distance t or Infinity.
export function rayAABB(o, d, box, maxT = Infinity) {
  let tmin = 0, tmax = maxT;
  const ox = o.x, oy = o.y, oz = o.z;
  // X
  let inv = 1 / (d.x || 1e-12), t0 = (box.min.x - ox) * inv, t1 = (box.max.x - ox) * inv;
  if (inv < 0) { const t = t0; t0 = t1; t1 = t; }
  tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
  if (tmax < tmin) return Infinity;
  // Y
  inv = 1 / (d.y || 1e-12); t0 = (box.min.y - oy) * inv; t1 = (box.max.y - oy) * inv;
  if (inv < 0) { const t = t0; t0 = t1; t1 = t; }
  tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
  if (tmax < tmin) return Infinity;
  // Z
  inv = 1 / (d.z || 1e-12); t0 = (box.min.z - oz) * inv; t1 = (box.max.z - oz) * inv;
  if (inv < 0) { const t = t0; t0 = t1; t1 = t; }
  tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
  if (tmax < tmin) return Infinity;
  return tmin;
}

// Move a capsule (feet pos, radius, height) with per-axis AABB resolution.
// Mutates pos and vel. Returns {onGround, hitWall}.
export function physicsMove(pos, vel, dt, radius, height, colliders) {
  const res = { onGround: false, hitWall: false };
  const eps = 0.001;
  // X axis
  pos.x += vel.x * dt;
  for (const c of colliders) {
    if (overlap(pos, radius, height, c)) {
      if (vel.x > 0) pos.x = c.min.x - radius - eps; else if (vel.x < 0) pos.x = c.max.x + radius + eps;
      else pos.x += (pos.x < (c.min.x + c.max.x) / 2 ? -1 : 1) * eps;
      vel.x = 0; res.hitWall = true;
    }
  }
  // Z axis
  pos.z += vel.z * dt;
  for (const c of colliders) {
    if (overlap(pos, radius, height, c)) {
      if (vel.z > 0) pos.z = c.min.z - radius - eps; else if (vel.z < 0) pos.z = c.max.z + radius + eps;
      else pos.z += (pos.z < (c.min.z + c.max.z) / 2 ? -1 : 1) * eps;
      vel.z = 0; res.hitWall = true;
    }
  }
  // Y axis
  pos.y += vel.y * dt;
  for (const c of colliders) {
    if (overlap(pos, radius, height, c)) {
      if (vel.y <= 0 && pos.y > c.max.y - 1.2) { pos.y = c.max.y + eps; vel.y = 0; res.onGround = true; }
      else if (vel.y > 0) { pos.y = c.min.y - height - eps; vel.y = 0; }
      else { // side overlap while falling beside: push out horizontally minimal
        const dx1 = c.max.x + radius - pos.x, dx2 = pos.x - (c.min.x - radius);
        const dz1 = c.max.z + radius - pos.z, dz2 = pos.z - (c.min.z - radius);
        const m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) pos.x = c.max.x + radius + eps;
        else if (m === dx2) pos.x = c.min.x - radius - eps;
        else if (m === dz1) pos.z = c.max.z + radius + eps;
        else pos.z = c.min.z - radius - eps;
      }
    }
  }
  if (pos.y <= 0) { pos.y = 0; vel.y = 0; res.onGround = true; }
  return res;
}

function overlap(pos, r, h, c) {
  return pos.x + r > c.min.x && pos.x - r < c.max.x &&
         pos.y + h > c.min.y && pos.y < c.max.y &&
         pos.z + r > c.min.z && pos.z - r < c.max.z;
}

export const BOT_NAMES = ['Viper','Ghost','Reaper','Nova','Blitz','Onyx','Falcon','Rogue','Titan','Echo','Havoc','Jinx','Krait','Lynx','Maverick','Nyx','Orion','Pixel','Quake','Raptor','Sable','Talon','Umbra','Vandal','Wraith','Xeno','Yukon','Zephyr','Bandit','Cipher'];
