import * as THREE from 'three';
import { clamp, lerp, rand, choice, chance, angleLerp, deg2rad, physicsMove } from './util.js';
import { findPath } from './map.js';
import { audio } from './audio.js';

export const DIFFICULTY = {
  recruit: { reaction: 0.75, aimErr: 6.5, dmgMult: 0.65, speed: 3.4, burst: [2, 3], pause: [0.5, 1.1], label: 'Recruit' },
  regular: { reaction: 0.48, aimErr: 3.8, dmgMult: 0.9,  speed: 4.1, burst: [3, 5], pause: [0.35, 0.8], label: 'Regular' },
  veteran: { reaction: 0.30, aimErr: 2.2, dmgMult: 1.1,  speed: 4.6, burst: [4, 7], pause: [0.25, 0.55], label: 'Veteran' },
};

const SKIN = [0xc9a07a, 0x8a5f3d, 0xe0b88f, 0x6e4a2f];
const _geoC = {};
function bx(w, h, d) { const k = `b${w}|${h}|${d}`; if (!_geoC[k]) _geoC[k] = new THREE.BoxGeometry(w, h, d); return _geoC[k]; }

function buildSoldier(team) {
  const g = new THREE.Group();
  const teamCol = team === 'alpha' ? 0x2e6fd8 : 0xd8402e;
  const teamMat = new THREE.MeshStandardMaterial({ color: teamCol, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN[Math.floor(Math.random() * SKIN.length)], roughness: 0.8 });
  const parts = {};
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };
  parts.legL = add(new THREE.Mesh(bx(0.22, 0.8, 0.24), darkMat), -0.14, 0.4, 0);
  parts.legR = add(new THREE.Mesh(bx(0.22, 0.8, 0.24), darkMat), 0.14, 0.4, 0);
  parts.torso = add(new THREE.Mesh(bx(0.52, 0.62, 0.3), teamMat), 0, 1.11, 0);
  parts.armL = add(new THREE.Mesh(bx(0.16, 0.6, 0.18), teamMat), -0.36, 1.12, 0);
  parts.armR = add(new THREE.Mesh(bx(0.16, 0.6, 0.18), teamMat), 0.36, 1.12, 0);
  parts.head = add(new THREE.Mesh(bx(0.3, 0.3, 0.3), skinMat), 0, 1.58, 0);
  parts.helmet = add(new THREE.Mesh(bx(0.36, 0.18, 0.36), darkMat), 0, 1.72, 0);
  const gun = new THREE.Mesh(bx(0.09, 0.14, 0.85), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.5 }));
  gun.position.set(0.2, 1.25, -0.4); g.add(gun); parts.gun = gun;
  // pivot groups for limb swing
  for (const p of ['legL', 'legR', 'armL', 'armR']) {
    const m = parts[p];
    const pivot = new THREE.Group();
    pivot.position.set(m.position.x, p.startsWith('leg') ? 0.8 : 1.42, m.position.z);
    m.position.y -= pivot.position.y; m.position.x = 0;
    pivot.add(m); g.add(pivot); parts[p] = pivot;
  }
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return { group: g, parts };
}

export class Bot {
  constructor(game, team, name, difficulty, loadout) {
    this.game = game; this.isBot = true;
    this.name = name; this.team = team;
    // Bots carry a namespaced id so phase-2 identity-keyed systems (mute/report)
    // can treat every combatant uniformly. Real players get identity.playerId.
    this.playerId = 'bot:' + name; this.clanTag = ''; this.devTag = false;
    this.diff = difficulty; this.loadout = loadout;
    this.perks = new Set(loadout.perks);
    this.stats = loadout.primary.stats;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.health = 100; this.alive = true; this.respawnT = 0;
    this.actionKind = null; this.actionT = 0; this.sndRole = null; this.sndSite = null; this.ctfRole = null;
    this.magAmmo = this.stats.mag; this.reloadT = 0;
    this.kills = 0; this.deaths = 0; this.headshots = 0;
    this.score = 0; this.streakCount = 0; this.bestStreak = 0;
    // mode-specific stats for MW2-style scoreboards
    this.confirms = 0; this.denies = 0;   // kill confirmed
    this.plants = 0; this.defuses = 0;    // search & destroy
    this.captures = 0; this.returns = 0;  // capture the flag
    this.streakInv = [];
    this.state = 'patrol';
    this.target = null; this.lastKnown = new THREE.Vector3();
    this.reactionT = 0; this.burstLeft = 0; this.pauseT = 0; this.percT = rand(0, 0.3);
    this.path = []; this.pathI = 0; this.repathT = 0;
    this.strafeDir = 1; this.strafeT = 0;
    this.blindT = 0; this.stunT = 0;
    this.flinchT = 0;
    this.walkT = rand(0, 6);
    this.deathT = 0;
    this.lastShotT = -99;
    this._hitDir = 0; this._hitDirT = 0;
    const { group, parts } = buildSoldier(team);
    this.model = group; this.parts = parts;
    game.engine.scene.add(group);
  }
  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z); }
  get chestPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z); }

  giveStreak(id) {
    if (this.streakInv.length < 3 && !this.streakInv.find(s => s.id === id)) this.streakInv.push({ id, ready: true });
    // bots auto-use UAV, save others unused (keeps PVE fair)
    if (id === 'uav') this.game.activateStreak(this, this.streakInv.findIndex(s => s.id === 'uav'));
  }

  // nearest visible enemy combatant or damageable
  perceive() {
    const g = this.game;
    let best = null, bestD = 58;
    for (const c of g.combatants) {
      if (c === this || !c.alive) continue;
      if (g.hostile(this, c)) {
        const d = this.pos.distanceTo(c.pos);
        if (d < bestD && g.hasLOS(this.eyePos, c.chestPos || c.eyePos || c.pos)) {
          // cold-blooded / behind check: allow targeting but with penalty handled in reaction
          best = c; bestD = d;
        }
      }
    }
    // enemy sentries are valid targets too
    for (const s of g.sentries) {
      if (s.team !== this.team && s.hp > 0) {
        const d = this.pos.distanceTo(s.pos);
        if (d < bestD && g.hasLOS(this.eyePos, s.aimPos())) { best = s; bestD = d; }
      }
    }
    return best;
  }

  // Exact per-mode destination (may sit off the waypoint graph).
  rawObjectiveTarget() {
    const g = this.game;
    if (g.mode === 'kc' && g.tags.length) {
      // Kill Confirmed: hunt nearby tags — enemy tags (confirm) prioritized over
      // friendly tags (deny). Weighted so a close deny can still beat a far confirm.
      let best = null, bk = Infinity;
      for (const tag of g.tags) {
        const dx = tag.pos.x - this.pos.x, dz = tag.pos.z - this.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 45 * 45) continue;
        const key = tag.team !== this.team ? d2 : d2 * 3;
        if (key < bk) { bk = key; best = tag.pos; }
      }
      if (best) return best;
    }
    if (g.mode === 'snd' && g.snd) {
      const s = g.snd;
      if (s.phase !== 'live') return null;
      const b = s.bomb, atk = this.team === s.atk;
      if (atk && b.state === 'carried' && b.carrier === this) return this.sndSite ? this.sndSite.pos : null;
      if (atk && b.state === 'dropped') return b.pos;
      if (b.state === 'planted') return b.pos; // both teams converge on the bomb
      if (!atk && this.sndSite) return this.sndSite.pos;
      if (atk && b.state === 'carried' && b.carrier && this.sndRole === 'escort') return b.carrier.pos;
      return null;
    }
    if (g.mode === 'ctf' && g.ctf) {
      const foe = this.team === 'alpha' ? 'bravo' : 'alpha';
      const myFlag = g.ctf.flags[this.team], foeFlag = g.ctf.flags[foe];
      if (foeFlag.state === 'carried' && foeFlag.carrier === this) return g.map.ctfBases[this.team].pos;
      if (foeFlag.state === 'carried' && foeFlag.carrier && foeFlag.carrier.team === this.team) return foeFlag.carrier.pos;
      if (this.ctfRole === 'attack') return foeFlag.state !== 'carried' ? foeFlag.pos : null;
      if (myFlag.state === 'dropped') return myFlag.pos;
      if (myFlag.state === 'carried' && myFlag.carrier) return myFlag.carrier.pos;
      return myFlag.basePos;
    }
    return null;
  }

  objectiveTarget() {
    const g = this.game;
    if (g.mode === 'snd' && g.snd && g.snd.phase === 'freeze') return this.pos.clone(); // hold during freeze
    const raw = this.rawObjectiveTarget();
    if (raw) return raw;
    if (g.mode === 'dom') {
      // nearest flag not owned (or owned by enemy)
      let best = null, bd = Infinity;
      for (const f of g.map.flags) {
        if (f.owner === this.team) continue;
        const d = this.pos.distanceTo(f.pos);
        if (d < bd) { bd = d; best = f.pos; }
      }
      if (best) return best;
    }
    return this.objectiveDrift();
  }

  // SND plant/defuse holding when in position (movement handled by objective steering).
  sndAct(dt) {
    const g = this.game, s = g.snd;
    if (!s || s.phase !== 'live') return;
    const b = s.bomb;
    const atk = this.team === s.atk;
    let act = false;
    if (atk && b.state === 'carried' && b.carrier === this && this.sndSite && this.pos.distanceTo(this.sndSite.pos) <= 3.2) act = true;
    else if (!atk && b.state === 'planted' && this.sndRole === 'defuser' && this.pos.distanceTo(b.pos) <= 2.6) act = true;
    g.updateInteract(this, dt, act);
  }

  objectiveDrift() {
    // drift toward enemy side / random waypoint
    const g = this.game;
    const wp = g.map.waypoints.nodes;
    const enemyBias = this.team === 'alpha' ? 1 : -1;
    const cands = wp.filter(n => (n.z * enemyBias) > -10);
    return choice(cands.length ? cands : wp);
  }

  update(dt, now) {
    if (!this.alive) {
      this.deathT += dt;
      // fall-over + sink
      const k = clamp(this.deathT * 3, 0, 1);
      this.model.rotation.x = -k * Math.PI / 2 * 0.9;
      if (this.deathT > 2.5) this.model.position.y = this.pos.y - (this.deathT - 2.5) * 0.5;
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.game.respawnCombatant(this);
      return;
    }
    const g = this.game;
    if (this.blindT > 0) this.blindT -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.flinchT > 0) this.flinchT -= dt;

    // perception tick
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = 0.22;
      const seen = this.blindT <= 0 ? this.perceive() : null;
      if (seen) {
        if (this.target !== seen) {
          this.target = seen;
          this.reactionT = this.diff.reaction * rand(0.8, 1.3);
          if (seen.isBot === false) this.reactionT *= 0.9;
        }
        this.lastKnown.copy(seen.pos || seen.aimPos());
        this.state = 'engage';
      } else if (this.target) {
        // lost sight -> chase last known briefly
        this.state = 'chase'; this.chaseT = 2.5;
        this.target = null;
      }
    }

    let mvx = 0, mvz = 0, moving = false;
    const speedMul = this.stunT > 0 ? 0.45 : 1;

    if (this.state === 'engage' && this.target && (this.target.alive === undefined || this.target.alive) && (this.target.hp === undefined || this.target.hp > 0)) {
      const tp = this.target.pos || this.target.aimPos();
      const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz);
      const turnRate = this.blindT > 0 ? 0.5 : 5.5;
      this.yaw = angleLerp(this.yaw, wantYaw, clamp(turnRate * dt, 0, 1));
      const ty = clamp((tp.y + 1.1 - (this.pos.y + 1.55)) / Math.max(dist, 1), -1, 1);
      this.pitch = lerp(this.pitch, Math.asin(clamp(ty, -1, 1)), clamp(4 * dt, 0, 1));

      // strafe / keep distance
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.6, 1.6); this.strafeDir = choice([-1, 1]); if (chance(0.3)) this.strafeDir = 0; }
      const px = -dz / (dist || 1), pz = dx / (dist || 1);
      let ax = 0, az = 0;
      if (dist > 26) { ax = dx / dist; az = dz / dist; }
      else if (dist < 9) { ax = -dx / dist; az = -dz / dist; }
      mvx = (ax + px * this.strafeDir * 0.8); mvz = (az + pz * this.strafeDir * 0.8);
      moving = true;

      // fire control
      this.reactionT -= dt;
      if (this.reactionT <= 0 && this.blindT <= 0) {
        if (this.reloadT <= 0) {
          if (this.burstLeft <= 0 && this.pauseT <= 0) {
            this.burstLeft = rand(this.diff.burst[0], this.diff.burst[1]);
            this.pauseT = rand(this.diff.pause[0], this.diff.pause[1]);
          }
          const interval = 60 / this.stats.rpm;
          if (this.burstLeft > 0 && now - this.lastShotT >= interval) {
            this.burstLeft--; this.lastShotT = now;
            this.botFire(now);
            if (this.magAmmo <= 0) { this.reloadT = this.stats.reload * 1.15; }
          } else if (this.burstLeft <= 0) {
            this.pauseT -= dt;
          }
        }
      }
    } else {
      // patrol / chase — waypoint pathing to the objective, direct steering for the last leg
      let dir = null;
      this._lastLeg = false;
      if (this.state === 'chase') {
        this.chaseT -= dt;
        const d = this.lastKnown.distanceTo(this.pos);
        if (d < 3 || this.chaseT <= 0) { this.state = 'patrol'; this.path = []; }
        else dir = this.followPath(this.lastKnown, dt);
      } else {
        this.repathT -= dt;
        if (!this.path.length || this.pathI >= this.path.length || this.repathT <= 0) {
          const tgt = this.objectiveTarget();
          this.path = findPath(g.map.waypoints, this.pos, tgt);
          this.pathI = 0; this.repathT = 9;
        }
        dir = this.followPath(null, dt);
        if (!dir) {
          // last leg: push directly to the exact objective point (may be off-graph)
          const raw = this.rawObjectiveTarget();
          if (raw && this.pos.distanceTo(raw) > 3) {
            dir = this.followPath(raw, dt);
            this._lastLeg = true;
            if ((this._wallT || 0) > 0) {
              // slide around whatever we're pressed against
              const ang = (this._wallSign || 1) * 1.25, c = Math.cos(ang), s = Math.sin(ang);
              dir = { x: dir.x * c - dir.z * s, z: dir.x * s + dir.z * c };
            }
          }
        }
        moving = true;
        if (dir) { mvx = dir.x; mvz = dir.z; }
        // face movement
        if (Math.hypot(mvx, mvz) > 0.01) {
          const wy = Math.atan2(-mvx, -mvz);
          this.yaw = angleLerp(this.yaw, wy, clamp(4 * dt, 0, 1));
        }
        if (this.target && (this.target.alive === false || (this.target.hp !== undefined && this.target.hp <= 0))) this.target = null;
      }
    }

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.magAmmo = this.stats.mag;
    }

    // movement physics
    const sp = this.diff.speed * speedMul * (this.state === 'engage' ? 0.55 : 1);
    const ml = Math.hypot(mvx, mvz) || 1;
    this.vel.x = mvx / ml * sp * (moving ? 1 : 0);
    this.vel.z = mvz / ml * sp * (moving ? 1 : 0);
    this.vel.y -= 13 * dt;
    const pmRes = physicsMove(this.pos, this.vel, dt, 0.38, 1.8, g.map.colliders);
    this.pos.x = clamp(this.pos.x, -g.map.bounds, g.map.bounds);
    this.pos.z = clamp(this.pos.z, -g.map.bounds, g.map.bounds);
    // wall-slide memory for last-leg steering
    if (this._lastLeg && pmRes.hitWall) {
      this._wallT = 1.4;
      if (!this._wallSign) this._wallSign = Math.random() < 0.5 ? 1 : -1;
    } else if (!pmRes.hitWall && (this._wallT || 0) > 0) {
      this._wallT -= dt;
      if (this._wallT <= 0) { this._wallT = 0; this._wallSign = 0; }
    }
    // unstick backstop: barely moved while trying -> detour via a random waypoint
    if (moving && Math.hypot(mvx, mvz) > 0.1) {
      this._stickAcc = (this._stickAcc || 0) + dt;
      if (this._stickAcc >= 2.5) {
        const moved = Math.hypot(this.pos.x - (this._stickX ?? this.pos.x), this.pos.z - (this._stickZ ?? this.pos.z));
        if (moved < 0.6) {
          const wp = choice(g.map.waypoints.nodes);
          this.path = findPath(g.map.waypoints, this.pos, wp);
          this.pathI = 0; this.repathT = 6;
          this._wallSign = -(this._wallSign || 1); // try the other side next
        }
        this._stickAcc = 0; this._stickX = this.pos.x; this._stickZ = this.pos.z;
      }
    } else { this._stickAcc = 0; }
    // SND plant/defuse holding
    if (g.mode === 'snd') this.sndAct(dt);

    // model transform + walk anim
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    if (moving) {
      this.walkT += dt * sp * 1.6;
      const s = Math.sin(this.walkT) * 0.55;
      this.parts.legL.rotation.x = s; this.parts.legR.rotation.x = -s;
      this.parts.armL.rotation.x = -s * 0.7; this.parts.armR.rotation.x = -s * 0.7;
    } else {
      this.parts.legL.rotation.x *= 0.9; this.parts.legR.rotation.x *= 0.9;
    }
    if (this.state === 'engage') { this.parts.armR.rotation.x = -1.2; this.parts.armL.rotation.x = -1.2; }
  }

  // Returns a normalized {x,z} steering direction toward the destination, or null if arrived.
  followPath(staticTarget, dt) {
    let dest = staticTarget;
    if (!dest) {
      if (this.pathI >= this.path.length) return null;
      dest = this.path[this.pathI];
      if (Math.hypot(dest.x - this.pos.x, dest.z - this.pos.z) < 2.2) { this.pathI++; return null; }
    }
    const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }

  botFire(now) {
    if (this.magAmmo <= 0) return;
    this.magAmmo--;
    const g = this.game;
    const origin = this.eyePos;
    const tp = this.target.pos || this.target.aimPos();
    const aimAt = new THREE.Vector3(tp.x, tp.y + rand(0.6, 1.3), tp.z);
    const dir = aimAt.sub(origin).normalize();
    const err = deg2rad(this.diff.aimErr * (this.flinchT > 0 ? 2 : 1) * (this.stunT > 0 ? 1.8 : 1));
    dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() + Math.random() - 1) * err);
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() + Math.random() - 1) * err);
    // tracer fx from gun tip
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z);
    g.hitscan(this, origin, dir, {
      dmg: this.stats.dmg * this.diff.dmgMult, headMult: 1.5, range: this.stats.range,
      falloff: this.stats.falloff, pellets: 1, suppressed: false,
    }, this.stats.def.id, from);
    g.registerShot(this);
    // distant shot sound (quieter)
    const lp = g.localPlayer;
    if (lp && lp.alive) {
      const d = this.pos.distanceTo(lp.pos);
      if (d < 70) audio.shoot(this.stats.snd);
    }
  }

  takeDamage(amount, attacker, isHead, isExplosive, weaponId) {
    if (!this.alive) return;
    if (isExplosive && this.perks.has('flakjacket')) amount *= 0.6;
    this.health -= amount;
    this.flinchT = 0.25;
    if (attacker && attacker !== this && this.game.hostile(this, attacker)) {
      this.target = attacker;
      this.lastKnown.copy(attacker.pos);
      this.state = 'engage';
      this.reactionT = Math.min(this.reactionT, this.diff.reaction * 0.6);
    }
    if (this.health <= 0) this.game.onKill(this, attacker, isHead, weaponId);
  }
  die() {
    this.alive = false; this.deathT = 0;
    this.respawnT = 2.5 + rand(0, 1.5);
    this.streakCount = 0;
    this.target = null;
  }
  onRespawn(pos) {
    this.pos.copy(pos); this.vel.set(0, 0, 0);
    this.health = 100; this.alive = true;
    this.magAmmo = this.stats.mag; this.reloadT = 0;
    this.state = 'patrol'; this.target = null; this.path = []; this.pathI = 0;
    this.blindT = 0; this.stunT = 0;
    this.model.rotation.x = 0; this.model.position.copy(pos);
    this.model.visible = true;
  }
}
