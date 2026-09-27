import * as THREE from 'three';
import { clamp, rand, choice } from './util.js';
import { audio } from './audio.js';

export const STREAKS = {
  uav:       { name: 'UAV',         icon: '🛩', killReq: 3, scoreReq: 350,  desc: 'Reveals enemies on the minimap for 30s' },
  airstrike: { name: 'Airstrike',   icon: '💥', killReq: 5, scoreReq: 700,  desc: 'Crosshair-targeted line of 6 bombs' },
  sentry:    { name: 'Sentry Gun',  icon: '🔫', killReq: 7, scoreReq: 1050, desc: 'Auto-turret, 60s or until destroyed' },
  heli:      { name: 'Attack Heli', icon: '🚁', killReq: 9, scoreReq: 1400, desc: 'Circles the map shredding enemies for 45s' },
};
export const STREAK_IDS = Object.keys(STREAKS);

// Central activation entry: game.activateStreak(owner, slotIndex)
export function activateStreak(game, owner, slotIdx) {
  const inv = owner.streakInv;
  if (!inv || slotIdx < 0 || slotIdx >= inv.length) return false;
  const s = inv[slotIdx];
  if (!s || !s.ready || !owner.alive) { if (owner.isBot === false) audio.streakDenied(); return false; }
  const id = s.id;
  let ok = false;
  if (id === 'uav') ok = callUAV(game, owner);
  else if (id === 'airstrike') ok = callAirstrike(game, owner);
  else if (id === 'sentry') ok = deploySentry(game, owner);
  else if (id === 'heli') ok = callHeli(game, owner);
  if (ok) { s.ready = false; if (game.hud && owner.isBot === false) game.hud.updateStreaks(owner); }
  else if (owner.isBot === false) audio.streakDenied();
  return ok;
}

export function checkStreakAward(game, p) {
  const loadout = game.streakLoadout;
  for (const id of loadout.slots) {
    if (p.streakInv.find(s => s.id === id && s.ready)) continue;
    const req = loadout.type === 'kill' ? STREAKS[id].killReq : STREAKS[id].scoreReq;
    const val = loadout.type === 'kill' ? p.streakCount : p.score;
    if (val >= req) {
      p.giveStreak(id);
      if (p.isBot === false && game.hud) game.hud.banner(`${STREAKS[id].icon} ${STREAKS[id].name.toUpperCase()} READY — [${loadout.slots.indexOf(id) + 3}]`);
    }
  }
}

// ---------------- UAV ----------------
function callUAV(game, owner) {
  game.uav[owner.team] = 30;
  audio.uavSweep();
  if (game.hud) game.hud.banner(`${owner.team === game.localTeam ? 'FRIENDLY' : 'ENEMY'} UAV ONLINE`);
  game.log(`UAV online (${owner.team})`);
  return true;
}

// ---------------- Airstrike ----------------
function callAirstrike(game, owner) {
  const origin = owner.eyePos;
  const dir = owner.isBot === false
    ? new THREE.Vector3(0, 0, -1).applyEuler(game.engine.camera.rotation)
    : new THREE.Vector3(Math.sin(owner.yaw), 0, Math.cos(owner.yaw)).multiplyScalar(-1);
  const target = game.aimPoint(origin, dir, 90);
  if (!target) return false;
  audio.jetFlyby();
  if (game.hud) game.hud.banner('💥 AIRSTRIKE INBOUND');
  // red smoke marker
  game.fx.smokeMarker(target);
  const strikeDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  const perp = new THREE.Vector3(-strikeDir.z, 0, strikeDir.x);
  game.timers.push({
    t: 1.4, done: false,
    update(dt) {
      this.t -= dt;
      if (this.t <= 0 && !this.done) {
        this.done = true;
        for (let i = 0; i < 6; i++) {
          const at = target.clone().add(perp.clone().multiplyScalar((i - 2.5) * 7));
          game.timers.push({ t: i * 0.18, done: false, update(d) { this.t -= d; if (this.t <= 0 && !this.done) { this.done = true; game.explode(at, 8, 135, owner); } } });
        }
        return true;
      }
      return false;
    }
  });
  return true;
}

// ---------------- Sentry gun ----------------
class Sentry {
  constructor(game, owner) {
    this.game = game; this.owner = owner; this.team = owner.team;
    this.isBot = false; this.isSentry = true;
    this.hp = 150; this.maxHp = 150; this.life = 60;
    this.name = `${owner.name}'s Sentry`;
    const fwd = new THREE.Vector3(Math.sin(owner.yaw), 0, Math.cos(owner.yaw)).multiplyScalar(-1);
    this.pos = owner.pos.clone().add(fwd.multiplyScalar(1.6)); this.pos.y = 0;
    this.yaw = owner.yaw; this.target = null;
    this.fireT = 0; this.scanT = 0;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 }));
    base.position.y = 0.55; g.add(base);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), new THREE.MeshStandardMaterial({ color: 0x2a2d31 }));
    legs.position.y = 0.18; g.add(legs);
    this.head = new THREE.Group();
    const hgun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.1), new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.5, roughness: 0.4 }));
    hgun.position.z = -0.4; this.head.add(hgun);
    const hbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.4), new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.4, roughness: 0.5 }));
    this.head.add(hbox);
    this.head.position.y = 0.95; g.add(this.head);
    g.position.copy(this.pos); g.rotation.y = this.yaw;
    this.model = g;
    game.engine.scene.add(g);
    audio.streakReady();
  }
  aimPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.0, this.pos.z); }
  get alive() { return this.hp > 0; }
  get chestPos() { return this.aimPos(); }
  takeDamage(amount, attacker) {
    if (this.hp <= 0) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.game.explode(this.aimPos(), 4, 60, attacker);
      this.game.engine.scene.remove(this.model);
      this.game.log(`${this.name} destroyed`);
    }
  }
  update(dt) {
    if (this.hp <= 0) return true;
    this.life -= dt;
    if (this.life <= 0) { this.game.engine.scene.remove(this.model); this.hp = 0; return true; }
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.18;
      let best = null, bd = 48;
      for (const c of this.game.combatants) {
        if (!c.alive || !this.game.hostile(this, c)) continue;
        const d = this.pos.distanceTo(c.pos);
        if (d < bd && this.game.hasLOS(this.aimPos(), c.chestPos || c.eyePos)) { best = c; bd = d; }
      }
      this.target = best;
    }
    if (this.target && (!this.target.alive || this.pos.distanceTo(this.target.pos) > 50)) this.target = null;
    if (this.target) {
      const tp = this.target.pos;
      const want = Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z));
      let d = (want - this.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += clamp(d, -3 * dt, 3 * dt);
      this.head.rotation.y = 0; this.model.rotation.y = this.yaw;
      this.fireT -= dt;
      if (this.fireT <= 0 && Math.abs(d) < 0.1) {
        this.fireT = 0.12;
        const from = this.aimPos();
        const aim = new THREE.Vector3(tp.x, tp.y + 1.1, tp.z);
        const dir = aim.sub(from).normalize();
        dir.x += rand(-0.02, 0.02); dir.y += rand(-0.02, 0.02); dir.z += rand(-0.02, 0.02);
        dir.normalize();
        this.game.hitscan(this, from, dir, { dmg: 19, headMult: 1.5, range: 55, falloff: 55, pellets: 1, suppressed: false }, 'sentry', from);
        audio.shoot('smg');
      }
    } else {
      this.yaw += dt * 0.7; this.model.rotation.y = this.yaw;
    }
    return false;
  }
}
function deploySentry(game, owner) {
  if (game.sentries.filter(s => s.owner === owner && s.hp > 0).length >= 1) return false;
  const s = new Sentry(game, owner);
  game.sentries.push(s);
  if (game.hud) game.hud.banner('🔫 SENTRY GUN DEPLOYED');
  game.log(`${owner.name} deployed a sentry`);
  return true;
}

// ---------------- Attack helicopter ----------------
class Heli {
  constructor(game, owner) {
    this.game = game; this.owner = owner; this.team = owner.team;
    this.isBot = false; this.isHeli = true;
    this.hp = 500; this.maxHp = 500; this.life = 45;
    this.name = `${owner.name}'s Heli`;
    this.angle = rand(0, Math.PI * 2);
    this.fireT = 0; this.scanT = 0; this.target = null;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 5), bodyMat); g.add(body);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.2, metalness: 0.6 }));
    cockpit.position.set(0, 0.5, -1.4); g.add(cockpit);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5), bodyMat); tail.position.z = 4.5; g.add(tail);
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x14161a }));
    this.rotor.position.y = 0.9; g.add(this.rotor);
    this.model = g;
    game.engine.scene.add(g);
    audio.heliLoop();
    if (game.hud) game.hud.banner('🚁 ATTACK HELI INBOUND');
  }
  aimPos() { return this.model.position.clone(); }
  get pos() { return this.model.position; }
  get alive() { return this.hp > 0; }
  get chestPos() { return this.aimPos(); }
  takeDamage(amount, attacker) {
    if (this.hp <= 0) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.game.explode(this.aimPos(), 8, 120, attacker);
      this.game.engine.scene.remove(this.model);
      this.game.log(`${this.name} shot down`);
    }
  }
  update(dt) {
    if (this.hp <= 0) return true;
    this.life -= dt;
    if (this.life <= 0) { this.game.engine.scene.remove(this.model); this.hp = 0; return true; }
    this.angle += dt * 0.45;
    const r = 42;
    this.model.position.set(Math.cos(this.angle) * r, 36, Math.sin(this.angle) * r);
    this.model.rotation.y = -this.angle;
    this.rotor.rotation.y += dt * 22;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.7;
      let best = null, bd = 75;
      for (const c of this.game.combatants) {
        if (!c.alive || !this.game.hostile(this, c)) continue;
        const d = this.pos.distanceTo(c.pos);
        if (d < bd && this.game.hasLOS(this.aimPos(), c.chestPos || c.eyePos)) { best = c; bd = d; }
      }
      this.target = best;
    }
    if (this.target && !this.target.alive) this.target = null;
    this.fireT -= dt;
    if (this.target && this.fireT <= 0) {
      this.fireT = 0.9;
      // 5-round burst at target
      for (let i = 0; i < 5; i++) {
        this.game.timers.push({
          t: i * 0.09, done: false,
          update(d) {
            this.t -= d;
            if (this.t <= 0 && !this.done) {
              this.done = true;
              const h = this.heli, tgt = this.tgt, gm = this.game;
              if (h.hp > 0 && tgt.alive) {
                const from = h.aimPos();
                const aim = new THREE.Vector3(tgt.pos.x + rand(-1, 1), tgt.pos.y + rand(0.4, 1.4), tgt.pos.z + rand(-1, 1));
                const dir = aim.sub(from).normalize();
                gm.hitscan(h, from, dir, { dmg: 26, headMult: 1.5, range: 120, falloff: 120, pellets: 1, suppressed: false }, 'heli', from);
                audio.shoot('lmg');
              }
            }
            return this.done;
          },
          heli: this, tgt: this.target, game: this.game,
        });
      }
    }
    return false;
  }
}
function callHeli(game, owner) {
  game.helis.push(new Heli(game, owner));
  game.log(`${owner.name} called an attack heli`);
  return true;
}
