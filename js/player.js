import * as THREE from 'three';
import { clamp, lerp, rand, deg2rad, physicsMove } from './util.js';
import { WeaponInstance, LETHALS, TACTICALS } from './weapons.js';
import { audio } from './audio.js';
import { applyOperatorToViewmodel } from './operator.js';
import { applyGunStyleToViewmodel } from './gunstyle.js';

const EYE = 1.62, RADIUS = 0.38, HEIGHT = 1.8;

export class Player {
  constructor(game, loadout, team, name) {
    this.game = game; this.isBot = false;
    this.name = name; this.team = team;
    // Filled by applyIdentityTo(): stable playerId + clanTag + devTag.
    this.playerId = null; this.clanTag = ''; this.devTag = false;
    this.loadout = loadout;
    this.perks = new Set(loadout.perks);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.health = 100; this.alive = true; this.respawnT = 0;
    this.actionKind = null; this.actionT = 0; this.sndRole = null; this.sndSite = null; this.ctfRole = null;
    this.lastDamageT = -99;
    this.weapons = [
      new WeaponInstance(loadout.primary.stats.def, loadout.primary.stats, loadout.primary.camo),
      new WeaponInstance(loadout.secondary.stats.def, loadout.secondary.stats, loadout.secondary.camo),
    ];
    this.cur = 0;
    for (const w of this.weapons) {
      applyOperatorToViewmodel(w.view);
      applyGunStyleToViewmodel(w.view);
    }
    this.lethal = loadout.lethal; this.tactical = loadout.tactical;
    this.lethalCount = 1; this.tacCount = 1;
    this.sprinting = false; this.adsHeld = false;
    this.meleeT = 0; this.meleeCD = 0;
    this.flashT = 0; this.stunT = 0;
    this.kills = 0; this.deaths = 0; this.headshots = 0;
    this.score = 0; this.streakCount = 0; this.bestStreak = 0;
    // mode-specific stats for MW2-style scoreboards
    this.confirms = 0; this.denies = 0;
    this.plants = 0; this.defuses = 0;
    this.captures = 0; this.returns = 0;
    this.streakInv = []; // {id, ready}
    this.onGround = true;
    this.stepT = 0;
    this._hitDir = 0; this._hitDirT = 0;
    this.fovK = 0;
    // knife viewmodel
    const kg = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.9, roughness: 0.3 }));
    blade.position.z = -0.2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.16), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    grip.position.z = -0.02;
    kg.add(blade, grip); kg.visible = false;
    this.knifeView = kg;
  }
  get weapon() { return this.weapons[this.cur]; }
  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }
  get moveMult() { return this.weapon.stats.moveMult * (this.perks.has('lightweight') ? 1.07 : 1); }

  attachView(camera) {
    for (const w of this.weapons) { camera.add(w.view.group); w.view.group.visible = false; }
    this.weapons[this.cur].view.group.visible = true;
    camera.add(this.knifeView);
    this.knifeView.position.set(0.27, -0.27, -0.45);
  }

  giveStreak(id) {
    const slot = this.streakInv.find(s => s.id === id);
    if (slot) slot.ready = true;
    else if (this.streakInv.length < 3) this.streakInv.push({ id, ready: true });
    else { const empty = this.streakInv.find(s => !s.ready); if (empty) { empty.id = id; empty.ready = true; } }
    if (this.game.hud) this.game.hud.flashStreaks();
    audio.streakReady();
  }

  update(dt, frame, now) {
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.game.respawnCombatant(this);
      return;
    }
    // regen
    if (now - this.lastDamageT > 4.5 && this.health < 100)
      this.health = Math.min(100, this.health + 32 * dt);

    // look
    const sens = this.game.settings.sens * (this.weapon.adsK > 0.5 ? 0.7 : 1);
    let dx = frame.dx * 0.0022 * sens, dy = frame.dy * 0.0022 * sens;
    if (this.stunT > 0) { dx += Math.sin(now * 31) * 0.02; dy += Math.cos(now * 27) * 0.02; }
    this.yaw -= dx;
    this.pitch -= dy * (this.game.settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);

    // move
    const k = frame.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const moving = fwd !== 0 || str !== 0;
    this.adsHeld = frame.buttons[2] && !this.weapon.reloading;
    const wantSprint = k.has('ShiftLeft') && fwd > 0 && !this.adsHeld && this.weapon.adsK < 0.3;
    this.sprinting = wantSprint;
    let speed = 5.2 * this.moveMult * (this.stunT > 0 ? 0.45 : 1);
    if (this.sprinting) speed *= 1.38;
    if (this.weapon.adsK > 0) speed *= lerp(1, 0.55, this.weapon.adsK);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wishX = (-sy * fwd + cy * str), wishZ = (-cy * fwd - sy * str);
    const wl = Math.hypot(wishX, wishZ) || 1;
    const accel = this.onGround ? 40 : 8;
    this.vel.x = lerp(this.vel.x, wishX / wl * speed * (moving ? 1 : 0), clamp(accel * dt / Math.max(speed, 1), 0, 1));
    this.vel.z = lerp(this.vel.z, wishZ / wl * speed * (moving ? 1 : 0), clamp(accel * dt / Math.max(speed, 1), 0, 1));
    if (k.has('Space') && this.onGround) { this.vel.y = 4.6; this.onGround = false; }
    this.vel.y -= 13 * dt;
    const res = physicsMove(this.pos, this.vel, dt, RADIUS, HEIGHT, this.game.map.colliders);
    this.onGround = res.onGround;
    this.pos.x = clamp(this.pos.x, -this.game.map.bounds, this.game.map.bounds);
    this.pos.z = clamp(this.pos.z, -this.game.map.bounds, this.game.map.bounds);

    if (moving && this.onGround) { this.stepT -= dt * (this.sprinting ? 2.2 : 1.4); if (this.stepT <= 0) { audio.footstep(); this.stepT = 0.42; } }

    // weapon swap
    if (frame.pressed.has('Digit1')) this.swapTo(0);
    if (frame.pressed.has('Digit2')) this.swapTo(1);
    if (frame.wheel !== 0) this.swapTo(1 - this.cur);
    // streak keys
    if (frame.pressed.has('Digit3')) this.game.activateStreak(this, 0);
    if (frame.pressed.has('Digit4')) this.game.activateStreak(this, 1);
    if (frame.pressed.has('Digit5')) this.game.activateStreak(this, 2);

    const w = this.weapon;
    // ADS
    const adsTarget = (this.adsHeld && !this.sprinting) ? 1 : 0;
    // fire
    const wantFire = w.stats.auto ? frame.buttons[0] : frame.pressedBtn[0];
    if (wantFire && this.meleeT <= 0 && !this.actionKind && w.canFire(now)) this.fire(now);
    else if (wantFire && w.magAmmo === 0 && !w.reloading) { audio.dryFire(); this.tryReload(); }
    // reload
    if (frame.pressed.has('KeyR')) this.tryReload();
    if (w.updateReload(dt)) audio.reload();
    // melee
    this.meleeCD -= dt;
    if (frame.pressed.has('KeyV') && this.meleeCD <= 0 && this.meleeT <= 0) this.startMelee();
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      const t = 1 - this.meleeT / 0.45;
      this.knifeView.visible = true;
      this.knifeView.position.set(lerp(0.27, 0.05, t), lerp(-0.27, -0.2, t), -0.45);
      this.knifeView.rotation.x = -t * 1.6;
      if (!this._meleeHit && t > 0.35) { this._meleeHit = true; this.meleeStrike(); }
      if (this.meleeT <= 0) { this.knifeView.visible = false; this.knifeView.rotation.x = 0; }
    }
    // grenades
    if (frame.pressed.has('KeyG')) this.throwLethal();
    if (frame.pressed.has('KeyQ')) this.throwTactical();
    // SND interact (hold E to plant/defuse)
    if (this.game.mode === 'snd') {
      const st = this.game.updateInteract(this, dt, frame.keys.has('KeyE'));
      if (this.actionKind && wantFire) { this.actionKind = null; this.actionT = 0; } // firing cancels the action
    }
    // scoreboard
    if (frame.pressed.has('Tab')) this.game.showScoreboard(true);
    if (!frame.keys.has('Tab') && this.game._sbHeld) this.game.showScoreboard(false);

    // reactive camo follows streak
    w.setReactiveLevel(this.streakCount / 9);
    w.updateView(dt, adsTarget, moving, this.sprinting, now);

    // camera
    const cam = this.game.engine.camera;
    cam.position.copy(this.eyePos);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw; cam.rotation.x = this.pitch; cam.rotation.z = 0;
    const targetFov = lerp(this.game.settings.fov, this.game.settings.fov * w.stats.zoomFov * w.stats.zoomMult, w.adsK);
    if (Math.abs(cam.fov - targetFov) > 0.1) { cam.fov = lerp(cam.fov, targetFov, clamp(dt * 14, 0, 1)); cam.updateProjectionMatrix(); }

    // timers
    this.flashT = Math.max(0, this.flashT - dt * 0.5);
    this.stunT = Math.max(0, this.stunT - dt);
    this._hitDirT = Math.max(0, this._hitDirT - dt);
    if (this.game.hud) this.game.hud.updatePlayer(this, dt);
  }

  swapTo(i) {
    if (i === this.cur || this.weapons[i].swapT > 0) return;
    const w = this.weapon;
    if (w.reloading) { w.reloading = false; }
    w.view.group.visible = false;
    this.cur = i;
    const nw = this.weapon;
    nw.swapT = nw.stats.swapTime * (this.perks.has('fasthands') ? 0.65 : 1);
    nw.view.group.visible = true;
    audio.reload();
  }
  tryReload() {
    const w = this.weapon;
    if (w.startReload(this.perks.has('fasthands'))) audio.reload();
  }
  fire(now) {
    const w = this.weapon;
    w.onFired(now);
    audio.shoot(w.stats.snd);
    const spreadDeg = w.currentSpread(Math.hypot(this.vel.x, this.vel.z) > 1.2, !this.onGround);
    const pellets = w.stats.pellets;
    for (let i = 0; i < pellets; i++) {
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.game.engine.camera.rotation);
      // apply spread in camera space
      const rx = (Math.random() + Math.random() - 1) * deg2rad(spreadDeg);
      const ry = (Math.random() + Math.random() - 1) * deg2rad(spreadDeg);
      dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), rx);
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      dir.normalize();
      // recoil
      this.pitch += deg2rad(w.stats.recP * rand(0.8, 1.25));
      this.yaw += deg2rad(w.stats.recY * rand(-1, 1));
      this.game.hitscan(this, this.eyePos, dir, w.stats, w.def.id);
    }
    if (!w.stats.suppressed) this.game.registerShot(this);
    if (this.game.hud) this.game.hud.onFired(spreadDeg);
  }
  startMelee() {
    this.meleeT = 0.45; this.meleeCD = 0.9; this._meleeHit = false;
    audio.melee();
  }
  meleeStrike() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const hit = this.game.hitscanMelee(this, this.eyePos, dir, 2.5, 60);
    if (hit && this.game.hud) this.game.hud.hitmarker(false, false);
  }
  throwLethal() {
    if (this.lethalCount <= 0) { audio.streakDenied(); return; }
    const L = LETHALS[this.lethal];
    this.lethalCount--;
    audio.pinPull();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.game.throwGrenade(this, this.lethal, this.eyePos.clone().add(dir.clone().multiplyScalar(0.5)), dir.multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)));
    if (this.game.hud) this.game.hud.updatePlayer(this, 0);
  }
  throwTactical() {
    if (this.tacCount <= 0) { audio.streakDenied(); return; }
    this.tacCount--;
    audio.pinPull();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.game.throwGrenade(this, this.tactical, this.eyePos.clone().add(dir.clone().multiplyScalar(0.5)), dir.multiplyScalar(12).add(new THREE.Vector3(0, 3.6, 0)));
    if (this.game.hud) this.game.hud.updatePlayer(this, 0);
  }
  takeDamage(amount, attacker, isHead, isExplosive, weaponId) {
    if (!this.alive) return;
    if (isExplosive && this.perks.has('flakjacket')) amount *= 0.6;
    this.health -= amount;
    this.lastDamageT = this.game.time;
    if (this.game.hud) {
      this.game.hud.damageFlash();
      if (attacker && attacker.pos) {
        const a = Math.atan2(attacker.pos.x - this.pos.x, attacker.pos.z - this.pos.z);
        this.game.hud.damageFrom(a - this.yaw + Math.PI);
      }
    }
    audio.hurt();
    if (this.health <= 0) this.game.onKill(this, attacker, isHead, weaponId);
  }
  die() {
    this.alive = false;
    this.health = 0;
    this.respawnT = 2.5;
    this.streakCount = 0;
    for (const w of this.weapons) w.view.group.visible = false;
  }
  respawnPoint() { return this.game.pickSpawn(this); }
  onRespawn(pos) {
    this.pos.copy(pos); this.vel.set(0, 0, 0);
    this.health = 100; this.alive = true;
    this.lethalCount = 1; this.tacCount = 1;
    this.flashT = 0; this.stunT = 0;
    for (const w of this.weapons) {
      w.magAmmo = w.stats.mag;
      w.reserveAmmo = Math.max(w.reserveAmmo, w.stats.reserve);
      w.reloading = false;
    }
    this.weapons[this.cur].view.group.visible = true;
  }
}

// Grenade projectile (frag/semtex/knife/flash/stun/smoke)
export class Grenade {
  constructor(game, owner, kind, pos, vel) {
    this.game = game; this.owner = owner; this.kind = kind;
    this.pos = pos.clone(); this.vel = vel.clone();
    this.fuse = (LETHALS[kind] || { fuse: 1.6 }).fuse;
    this.bounces = 0;
    const col = kind === 'flash' || kind === 'stun' ? 0xdddddd : kind === 'smoke' ? 0x88aa88 : 0x2a4d2a;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(kind === 'throwingknife' ? 0.09 : 0.14, 8, 8),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
    this.mesh.position.copy(this.pos);
    game.engine.scene.add(this.mesh);
  }
  update(dt) {
    this.vel.y -= 13 * dt;
    const before = this.pos.clone();
    const res = physicsMove(this.pos, this.vel, dt, 0.14, 0.28, this.game.map.colliders);
    if (res.hitWall || res.onGround) {
      if (this.bounces < 4) { audio.grenadeBounce(); this.bounces++; }
      this.vel.multiplyScalar(0.35);
      if (res.onGround) { this.vel.x *= 0.7; this.vel.z *= 0.7; }
    }
    if (this.kind === 'throwingknife') {
      // instant-hit check along path
      const stepDir = this.vel.clone().normalize();
      const segLen = this.pos.distanceTo(before);
      const hit = this.game.hitscan(this.owner, before, stepDir, { dmg: 100, headMult: 1.5, range: 60, falloff: 60, pellets: 1, suppressed: true }, 'throwingknife', before, Math.max(segLen, 0.5));
      if (hit) { this.detonate(true); return true; }
    }
    this.mesh.position.copy(this.pos);
    this.fuse -= dt;
    if (this.fuse <= 0 && this.kind !== 'throwingknife') { this.detonate(false); return true; }
    if (this.kind === 'throwingknife' && (res.hitWall || res.onGround)) { this.detonate(false); return true; }
    return false;
  }
  detonate(hitSomething) {
    const g = this.game;
    g.engine.scene.remove(this.mesh);
    if (this.kind === 'frag' || this.kind === 'semtex') {
      const L = LETHALS[this.kind];
      g.explode(this.pos, L.radius, L.dmg, this.owner);
    } else if (this.kind === 'flash') {
      g.flashbang(this.pos, this.owner);
    } else if (this.kind === 'stun') {
      g.stunBlast(this.pos, this.owner);
    } else if (this.kind === 'smoke') {
      g.addSmoke(this.pos, this.owner.team);
    } else if (this.kind === 'throwingknife' && !hitSomething) {
      // missed knife — small puff
    }
  }
  dispose() { this.game.engine.scene.remove(this.mesh); }
}
