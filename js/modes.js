import * as THREE from 'three';
import { clamp, lerp, rand, choice, rayAABB, BOT_NAMES } from './util.js';
import { gainXP, bumpStat, setBestStreak, buildPlayerCard, botCard, getLevel } from './progression.js';

// XP + lifetime-stat feedback for the local player only. Shows level-up and
// challenge-unlock toasts. Safe to call when there is no HUD (headless sims).
function announceUnlocks(game, u) {
  if (!game.hud || !u) return;
  for (const t of u.titles || []) game.hud.banner(`🏷 TITLE UNLOCKED: ${t.name.toUpperCase()}`, 2.5);
  for (const e of u.emblems || []) game.hud.banner(`🎖 EMBLEM UNLOCKED: ${e.name.toUpperCase()}`, 2.5);
}
export function awardLocal(game, xp, stats) {
  if (game.headless || !game.localPlayer) return;
  if (stats) for (const [k, n] of Object.entries(stats)) announceUnlocks(game, bumpStat(k, n));
  if (xp > 0) {
    const r = gainXP(xp);
    if (r.leveled) {
      if (game.hud) game.hud.banner(`⬆ LEVEL UP — LEVEL ${r.level}`, 3);
      import('./audio.js').then(m => m.audio.streakReady());
      game.localPlayer.level = r.level;
      game.localPlayer.card = buildPlayerCard();
    }
  }
}
import { WEAPONS, weaponById } from './weapons.js';
import { recordWeaponKill } from './camos.js';
import { randomBotLoadout } from './classes.js';
import { Bot, DIFFICULTY } from './bots.js';
import { Player, Grenade } from './player.js';
import { checkStreakAward, activateStreak } from './streaks.js';
import { audio } from './audio.js';

export const MODE_INFO = {
  tdm: { name: 'Team Deathmatch', target: 75, time: 600, desc: '6v6 vs bots · First to 75' },
  ffa: { name: 'Free-for-All', target: 30, time: 600, desc: 'You vs bots · First to 30' },
  dom: { name: 'Domination', target: 200, time: 600, desc: '6v6 vs bots · Hold A B C · First to 200' },
  snd: { name: 'Search & Destroy', target: 6, time: 900, desc: '6v6 vs bots · One life per round · First to 6' },
  ctf: { name: 'Capture the Flag', target: 3, time: 600, desc: '6v6 vs bots · First to 3 captures' },
  kc: { name: 'Kill Confirmed', target: 65, time: 600, desc: '6v6 vs bots · Confirm tags · First to 65' },
};
export const TEAM_MODES = ['tdm', 'dom', 'kc', 'snd', 'ctf'];

// ---------- ray vs sphere ----------
function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < maxT ? t : Infinity;
}

// ---------- pooled FX ----------
class FX {
  constructor(game) {
    this.game = game;
    this.tracers = [];
    this.particles = [];
    this.lights = [];
    const tg = new THREE.BoxGeometry(0.025, 0.025, 1);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.frustumCulled = false;
      game.engine.scene.add(m);
      this.tracers.push({ m, t: 0 });
    }
    for (let i = 0; i < 14; i++) {
      const n = 26;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffcc88, size: 0.14, transparent: true, opacity: 0, depthWrite: false }));
      pts.visible = false; pts.frustumCulled = false;
      game.engine.scene.add(pts);
      this.particles.push({ pts, vel: new Float32Array(n * 3), t: 0, life: 0.5, n });
    }
  }
  tracer(from, to) {
    const t = this.tracers.find(t => t.t <= 0) || this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.m.visible = true;
    t.m.position.copy(from).lerp(to, 0.5);
    t.m.lookAt(to);
    t.m.scale.set(1, 1, len);
    t.m.material.opacity = 0.85;
    t.t = 0.07;
  }
  burst(pos, color = 0xffcc88, speed = 5, life = 0.5) {
    const p = this.particles.find(p => p.t <= 0) || this.particles[0];
    const arr = p.pts.geometry.attributes.position.array;
    for (let i = 0; i < p.n; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z;
      const th = rand(0, Math.PI * 2), ph = rand(-1, 1);
      const s = rand(0.3, 1) * speed;
      p.vel[i * 3] = Math.cos(th) * s; p.vel[i * 3 + 1] = Math.abs(Math.sin(ph)) * s * 0.9; p.vel[i * 3 + 2] = Math.sin(th) * s;
    }
    p.pts.geometry.attributes.position.needsUpdate = true;
    p.pts.material.color.setHex(color);
    p.pts.material.opacity = 1;
    p.pts.visible = true;
    p.t = life; p.life = life;
  }
  explosionLight(pos) {
    const l = new THREE.PointLight(0xff9a3d, 60, 26);
    l.position.copy(pos); l.position.y += 1;
    this.game.engine.scene.add(l);
    this.lights.push({ l, t: 0.35 });
  }
  smokeMarker(pos) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.copy(pos); m.position.y += 1;
    this.game.engine.scene.add(m);
    this.game.timers.push({ t: 2.2, done: false, update(dt) { this.t -= dt; m.position.y += dt * 3; m.material.opacity = Math.max(0, this.t / 2.2) * 0.55; if (this.t <= 0 && !this.done) { this.done = true; this.game.engine.scene.remove(m); } return this.done; }, game: this.game });
  }
  update(dt) {
    for (const t of this.tracers) {
      if (t.t > 0) { t.t -= dt; t.m.material.opacity = Math.max(0, t.t / 0.07) * 0.85; if (t.t <= 0) t.m.visible = false; }
    }
    for (const p of this.particles) {
      if (p.t > 0) {
        p.t -= dt;
        const arr = p.pts.geometry.attributes.position.array;
        for (let i = 0; i < p.n; i++) {
          arr[i * 3] += p.vel[i * 3] * dt; arr[i * 3 + 1] += p.vel[i * 3 + 1] * dt; arr[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
          p.vel[i * 3 + 1] -= 9 * dt;
        }
        p.pts.geometry.attributes.position.needsUpdate = true;
        p.pts.material.opacity = Math.max(0, p.t / p.life);
        if (p.t <= 0) p.pts.visible = false;
      }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.t -= dt; l.l.intensity = Math.max(0, l.t / 0.35) * 60;
      if (l.t <= 0) { this.game.engine.scene.remove(l.l); this.lights.splice(i, 1); }
    }
  }
}

export class Game {
  // ---------------------------------------------------------------------------
  // ARCHITECTURE NOTE (Phase 2 PvP readiness):
  // - Game.update(dt, frame, now) is the SINGLE entry point for all simulation
  //   state changes. A future net layer can hook here: snapshot/diff
  //   combatants[], sentries[], helis[], grenades[], scores, uav, flags.
  // - Player input is decoupled: Player.update(dt, inputFrame, now) consumes a
  //   plain input frame {keys, pressed, dx, dy, buttons, ...}. Remote players
  //   (Phase 2) will use a different controller class producing the same
  //   combatant interface, fed by network input frames instead of local input.
  // - No singleton assumes one local player: game.localPlayer is a convenience
  //   reference only; all logic iterates combatants[].
  // - Deterministic-friendly: combat resolution lives in hitscan()/explode()/
  //   onKill(); RNG is the only nondeterminism (seedable later).
  // ---------------------------------------------------------------------------
  constructor(opts) {
    this.mode = opts.mode;
    this.engine = opts.engine;
    this.map = opts.map;
    this.streakLoadout = opts.streakLoadout;
    this.difficulty = DIFFICULTY[opts.difficulty] || DIFFICULTY.regular;
    this.settings = opts.settings;
    this.headless = !!opts.headless;
    this.onEnd = opts.onEnd || (() => {});
    this.time = 0; this.over = false;
    this.combatants = [];
    this.sentries = []; this.helis = []; this.grenades = []; this.smokes = [];
    this.timers = []; this.recentShots = [];
    this.uav = { alpha: 0, bravo: 0 };
    this.scores = { alpha: 0, bravo: 0 };
    this.timeLeft = MODE_INFO[this.mode].time;
    this.localPlayer = null; this.localTeam = 'alpha';
    this.hud = null;
    this._sbHeld = false;
    this._domTick = 0;
    this.fx = this.headless ? null : new FX(this);
    this.logLines = [];
    // team size for team modes (6v6 default)
    this.teamSize = opts.teamSize || 6;
    // SND / CTF state
    this.roundWins = { alpha: 0, bravo: 0 };
    this.snd = null; this.sndRound = 0;
    this.ctf = null; this.ctfScore = { alpha: 0, bravo: 0 };
    // Kill Confirmed: dropped dog tags awaiting collection
    this.tags = [];
    // Killcam: ring buffer of combatant snapshots (last ~6s), replay state
    this.kcBuf = [];
    this.killcam = null;
  }
  log(m) { this.logLines.push(`[${this.time.toFixed(1)}] ${m}`); if (this.logLines.length > 60) this.logLines.shift(); }

  hostile(a, b) {
    if (a === b) return false;
    if (this.mode === 'ffa') return true;
    return a.team !== b.team;
  }

  addLocalPlayer(loadout, name = 'YOU') {
    const p = new Player(this, loadout, 'alpha', name);
    p.attachView(this.engine.camera);
    p.level = getLevel(); p.ping = 12; // real persistent level; simulated ping
    p.card = buildPlayerCard();
    this.localPlayer = p; this.localTeam = 'alpha';
    this.combatants.push(p);
    this.spawnCombatant(p);
    return p;
  }
  addBots() {
    const names = shuffle([...BOT_NAMES]);
    let ni = 0;
    const mkTeam = team => {
      const b = new Bot(this, team, names[ni++ % names.length] + (ni > BOT_NAMES.length ? '-' + ni : ''), this.difficulty, randomBotLoadout());
      // scoreboard identity: stable-ish level + simulated ping (MW2-style columns)
      b.level = rand(4, 50) | 0;
      b.ping = rand(18, 95) | 0;
      b.card = botCard(b.name, b.level); // flavor title/emblem/banner for cards, VS, killcam
      this.combatants.push(b);
      this.spawnCombatant(b);
      return b;
    };
    if (this.mode === 'ffa') {
      const n = this.settings.botCount ?? 7;
      for (let i = 0; i < n; i++) mkTeam('solo' + i);
    } else {
      // 6v6 default: human takes one alpha slot when present
      const alphaBots = this.teamSize - (this.localPlayer ? 1 : 0);
      for (let i = 0; i < alphaBots; i++) mkTeam('alpha');
      for (let i = 0; i < this.teamSize; i++) mkTeam('bravo');
    }
  }

  // Called once after local player + bots are added. Per-mode setup.
  startMatch() {
    this.tags = [];
    if (this.mode === 'snd') {
      for (const s of this.map.bombSites) s.grp.visible = true;
      this.startSndRound();
    } else if (this.mode === 'ctf') {
      this.map.ctfBases.alpha.grp.visible = true;
      this.map.ctfBases.bravo.grp.visible = true;
      this.initCtf();
    }
  }

  pickSpawn(c) {
    const m = this.map;
    let pool;
    if (this.mode === 'ffa') pool = m.spawns.ffa;
    else pool = c.team === 'alpha' ? m.spawns.alpha : m.spawns.bravo;
    const enemies = this.combatants.filter(o => o !== c && o.alive && this.hostile(c, o));
    const scored = pool.map(p => {
      let md = Infinity;
      for (const e of enemies) md = Math.min(md, p.distanceTo(e.pos));
      return { p, s: md + rand(0, 6) };
    });
    scored.sort((a, b) => b.s - a.s);
    const pick = choice(scored.slice(0, Math.min(3, scored.length))).p;
    return pick;
  }
  spawnCombatant(c) {
    const p = this.pickSpawn(c);
    c.onRespawn(p);
    c.yaw = Math.atan2(-(0 - p.x), -(0 - p.z)); // face center
  }
  respawnCombatant(c) {
    if (this.over) return;
    if (this.mode === 'snd') return; // one life per round; rounds respawn everyone
    this.spawnCombatant(c);
  }

  // ---- hold-to-interact for SND plant/defuse (shared player/bot logic) ----
  // held: whether the interact input is held this tick. Returns 'active'|'done'|null.
  updateInteract(c, dt, held) {
    if (this.mode !== 'snd' || !this.snd || this.snd.phase !== 'live' || !c.alive) { c.actionKind = null; c.actionT = 0; return null; }
    const s = this.snd, b = s.bomb;
    let want = null, wantSite = null;
    if (b.state === 'carried' && b.carrier === c && c.sndSite && c.pos.distanceTo(c.sndSite.pos) <= 3.4) {
      want = 'plant'; wantSite = c.sndSite;
    } else if (b.state === 'planted' && c.team === s.def && c.pos.distanceTo(b.pos) <= 2.8) {
      want = 'defuse';
    }
    if (!want) { c.actionKind = null; c.actionT = 0; return null; }
    if (held) {
      if (c.actionKind !== want) { c.actionKind = want; c.actionT = 0; }
      c.actionT += dt / (want === 'plant' ? 3.2 : 5);
      if (c.actionT >= 1) {
        c.actionKind = null; c.actionT = 0;
        if (want === 'plant') this.plantBomb(c, wantSite);
        else this.defuseBomb(c);
        return 'done';
      }
      return 'active';
    }
    if (c.actionKind === want) c.actionT = Math.max(0, c.actionT - dt * 0.5);
    return null;
  }

  // Prompt for the local player HUD (ignores held).
  interactPrompt(c) {
    if (this.mode !== 'snd' || !this.snd || this.snd.phase !== 'live' || !c.alive || c !== this.localPlayer) return null;
    const s = this.snd, b = s.bomb;
    if (b.state === 'carried' && b.carrier === c && c.sndSite && c.pos.distanceTo(c.sndSite.pos) <= 3.4) return 'plant';
    if (b.state === 'planted' && c.team === s.def && c.pos.distanceTo(b.pos) <= 2.8) return 'defuse';
    return null;
  }

  // ==================== SND (Search & Destroy) ====================
  startSndRound() {
    this.sndRound++;
    // halftime side swap after round 6
    const atk = this.sndRound <= 6 ? 'alpha' : 'bravo';
    const def = atk === 'alpha' ? 'bravo' : 'alpha';
    // clear devices between rounds
    for (const s of this.sentries) s.dispose && s.dispose();
    for (const h of this.helis) h.dispose && h.dispose();
    this.sentries = []; this.helis = []; this.grenades = [];
    this.removeBombMesh();
    // pick carrier: player sometimes, else random attacker bot
    const attackers = this.combatants.filter(c => c.team === atk);
    let carrier = null;
    if (this.localPlayer && this.localPlayer.team === atk && Math.random() < 0.35) carrier = this.localPlayer;
    if (!carrier) {
      const bots = attackers.filter(c => c.isBot);
      carrier = bots[Math.floor(Math.random() * bots.length)] || attackers[0];
    }
    const carrierSite = choice(this.map.bombSites);
    const atkBots = attackers.filter(c => c.isBot);
    const defTeam = this.combatants.filter(c => c.team === def);
    let ai = 0, di = 0;
    for (const c of this.combatants) {
      this.spawnCombatant(c);
      c.streakCount = 0; c.plantT = 0; c.defuseT = 0; c.actionT = 0; c.actionKind = null;
      if (c.team === atk) {
        c.sndRole = c === carrier ? 'carrier' : (c.isBot ? (ai++ % 3 === 0 ? 'escort' : 'hunter') : 'hunter');
        c.sndSite = c === carrier ? carrierSite : choice(this.map.bombSites);
      } else {
        c.sndRole = 'guard';
        c.sndSite = this.map.bombSites[di++ % this.map.bombSites.length];
      }
    }
    this.snd = {
      phase: 'freeze', t: 4, atk, def,
      bomb: { state: 'carried', carrier, site: null, pos: new THREE.Vector3(), explodeT: 0, mesh: null, planter: null },
      roundTime: 100,
    };
    this.log(`[SND] Round ${this.sndRound}: ${atk} attacks`);
    if (this.hud) {
      this.hud.banner(`ROUND ${this.sndRound} — ${atk === this.localTeam ? '💣 PLANT THE BOMB' : '🛡 DEFEND THE SITES'}`, 3);
      this.hud.updateStreaks(this.localPlayer);
    }
  }

  removeBombMesh() {
    if (this.snd && this.snd.bomb.mesh) {
      this.engine.scene.remove(this.snd.bomb.mesh);
      this.snd.bomb.mesh = null;
    }
  }

  plantBomb(by, site) {
    const s = this.snd;
    if (!s || s.phase !== 'live') return;
    if (s.bomb.state !== 'carried' && s.bomb.state !== 'dropped') return;
    if (s.bomb.state === 'carried' && s.bomb.carrier !== by) return;
    s.bomb.state = 'planted'; s.bomb.site = site; s.bomb.planter = by;
    s.bomb.pos.copy(by.pos); s.bomb.explodeT = 45;
    by.sndRole = 'guard-bomb';
    by.plants++;
    if (by === this.localPlayer) awardLocal(this, 150, { plants: 1 });
    if (!this.headless) {
      const grp = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.26, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x1c1c1c, emissive: 0xff2200, emissiveIntensity: 2 })
      );
      box.position.y = 0.14; grp.add(box);
      grp.position.copy(s.bomb.pos);
      this.engine.scene.add(grp);
      s.bomb.mesh = grp;
    }
    this.log(`[SND] Bomb planted at ${site.id} by ${by.name}`);
    if (this.hud) this.hud.banner(by.team === this.localTeam ? '💣 BOMB PLANTED — DEFEND IT' : '💣 BOMB PLANTED — DEFUSE IT', 3);
    import('./audio.js').then(m => m.audio.streakReady());
    // defenders converge: nearest becomes defuser
    const defs = this.combatants.filter(c => c.team === s.def && c.alive);
    defs.sort((a, b) => a.pos.distanceTo(s.bomb.pos) - b.pos.distanceTo(s.bomb.pos));
    defs.forEach((c, i) => { c.sndRole = i === 0 ? 'defuser' : 'guard-bomb'; });
    for (const c of this.combatants) if (c.team === s.atk && c.alive && c !== by) c.sndRole = 'guard-bomb';
  }

  defuseBomb(by) {
    const s = this.snd;
    if (!s || s.phase !== 'live' || s.bomb.state !== 'planted') return;
    this.removeBombMesh();
    s.bomb.state = 'defused';
    if (by) by.defuses++;
    if (by === this.localPlayer) awardLocal(this, 150, { defuses: 1 });
    this.winSndRound(s.def, 'Bomb defused');
  }

  dropBomb(carrier) {
    const s = this.snd;
    if (!s || s.bomb.state !== 'carried' || s.bomb.carrier !== carrier) return;
    s.bomb.state = 'dropped'; s.bomb.carrier = null;
    s.bomb.pos.copy(carrier.pos);
    this.log(`[SND] Bomb dropped by ${carrier.name}`);
  }

  pickupBomb(by) {
    const s = this.snd;
    if (!s || s.phase !== 'live' || s.bomb.state !== 'dropped') return;
    if (by.team !== s.atk || !by.alive) return;
    s.bomb.state = 'carried'; s.bomb.carrier = by;
    by.sndRole = 'carrier';
    if (!by.sndSite) by.sndSite = choice(this.map.bombSites);
    if (this.hud && by === this.localPlayer) this.hud.banner('💣 YOU HAVE THE BOMB', 2);
  }

  winSndRound(team, reason) {
    const s = this.snd;
    if (!s || s.phase === 'end' || this.over) return;
    s.phase = 'end'; s.t = 4.5;
    this.roundWins[team]++;
    for (const c of this.combatants) if (c.team === team && c.alive) c.score += 150;
    this.log(`[SND] Round ${this.sndRound} → ${team} (${reason}) [${this.roundWins.alpha}-${this.roundWins.bravo}]`);
    if (this.hud) this.hud.banner(`${team === this.localTeam ? '✓ ROUND WON' : '✗ ROUND LOST'} — ${reason}`, 3.5);
    import('./audio.js').then(m => m.audio.roundEnd(team === this.localTeam));
  }

  finishSndMatch() {
    const { alpha, bravo } = this.roundWins;
    this.removeBombMesh();
    this.endMatch(alpha === bravo ? 'draw' : alpha > bravo ? 'alpha' : 'bravo');
  }

  updateSnd(dt) {
    const s = this.snd;
    if (!s || this.over) return;
    if (s.phase === 'freeze') {
      s.t -= dt;
      if (s.t <= 0) {
        s.phase = 'live';
        if (this.hud) this.hud.banner(s.atk === this.localTeam ? 'PLANT THE BOMB AT A OR B' : 'DEFEND A AND B', 2);
      }
      return;
    }
    if (s.phase === 'end') {
      s.t -= dt;
      if (s.t <= 0) {
        if (this.roundWins.alpha >= MODE_INFO.snd.target || this.roundWins.bravo >= MODE_INFO.snd.target || this.sndRound >= 11) this.finishSndMatch();
        else this.startSndRound();
      }
      return;
    }
    // ---- live ----
    const bomb = s.bomb;
    if (bomb.state === 'planted') {
      bomb.explodeT -= dt;
      if (bomb.mesh) bomb.mesh.children[0].material.emissiveIntensity = 1.5 + Math.sin(this.time * 9) * 1.2;
      if (bomb.explodeT <= 0) {
        const bpos = bomb.pos.clone(); bpos.y += 0.5;
        this.explode(bpos, 15, 500, bomb.planter);
        this.winSndRound(s.atk, 'Target destroyed');
        return;
      }
    } else {
      s.roundTime -= dt;
      if (s.roundTime <= 0) { this.winSndRound(s.def, 'Time expired'); return; }
      // dropped bomb pickup by proximity
      if (bomb.state === 'dropped') {
        for (const c of this.combatants) {
          if (c.team === s.atk && c.alive && c.pos.distanceTo(bomb.pos) < 1.6) { this.pickupBomb(c); break; }
        }
      }
      // reassign carrier role if carrier died without drop handling (safety)
      if (bomb.state === 'carried' && (!bomb.carrier || !bomb.carrier.alive)) this.dropBomb(bomb.carrier);
    }
    // elimination
    const atkAlive = this.combatants.some(c => c.team === s.atk && c.alive);
    const defAlive = this.combatants.some(c => c.team === s.def && c.alive);
    if (!atkAlive && !defAlive) this.winSndRound(s.def, 'Mutual elimination');
    else if (!atkAlive) this.winSndRound(s.def, 'Attackers eliminated');
    else if (!defAlive) this.winSndRound(s.atk, 'Defenders eliminated');
  }

  // ==================== KILL CONFIRMED ====================
  // Enemies drop dog tags on death. Collecting an enemy tag = confirm (+1 team
  // score); collecting a fallen teammate's tag = deny. First team to the target wins.
  spawnTag(victim) {
    const pos = victim.pos.clone(); pos.y = 0.15;
    const tag = { team: victim.team, pos, t: 30, mesh: null };
    if (!this.headless) {
      // original procedural dog-tag: gold plate + team-colored ring, gently bobbing
      const grp = new THREE.Group();
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.44, 0.045),
        new THREE.MeshStandardMaterial({ color: 0xd8a920, metalness: 0.85, roughness: 0.3, emissive: 0x553a00, emissiveIntensity: 0.8 })
      );
      plate.position.y = 0.35; grp.add(plate);
      const ringCol = victim.team === 'alpha' ? 0x4da3ff : 0xff5a4d;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.028, 8, 18),
        new THREE.MeshStandardMaterial({ color: ringCol, emissive: ringCol, emissiveIntensity: 1.2 })
      );
      ring.position.y = 0.66; grp.add(ring);
      grp.position.copy(pos);
      this.engine.scene.add(grp);
      tag.mesh = grp;
    }
    this.tags.push(tag);
    // cap: oldest tags evaporate
    if (this.tags.length > 24) {
      const old = this.tags.shift();
      if (old.mesh && !this.headless) this.engine.scene.remove(old.mesh);
    }
  }

  collectTag(c, tag) {
    if (c.team !== tag.team) {
      c.confirms++;
      c.score += 100;
      this.scores[c.team]++;
      this.log(`[KC] ${c.name} confirmed a tag (${this.scores.alpha}-${this.scores.bravo})`);
      if (this.hud && c === this.localPlayer) this.hud.hint('✓ TAG CONFIRMED +100');
      if (c === this.localPlayer) awardLocal(this, 100, { confirms: 1 });
      import('./audio.js').then(m => m.audio.capture());
    } else {
      c.denies++;
      c.score += 50;
      this.log(`[KC] ${c.name} denied a tag`);
      if (this.hud && c === this.localPlayer) this.hud.hint('✗ TAG DENIED +50');
      if (c === this.localPlayer) awardLocal(this, 50, { denies: 1 });
    }
    this.checkWin();
  }

  updateKc(dt) {
    if (this.over) return;
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const tag = this.tags[i];
      tag.t -= dt;
      if (tag.mesh) {
        tag.mesh.position.y = tag.pos.y + Math.sin(this.time * 3 + i * 1.7) * 0.1;
        tag.mesh.rotation.y += dt * 2.2;
      }
      let gone = tag.t <= 0;
      if (!gone) {
        for (const c of this.combatants) {
          if (!c.alive) continue;
          const dx = c.pos.x - tag.pos.x, dz = c.pos.z - tag.pos.z;
          if (dx * dx + dz * dz < 6.25) { // 2.5 m pickup radius
            this.collectTag(c, tag);
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        if (tag.mesh) this.engine.scene.remove(tag.mesh);
        this.tags.splice(i, 1);
      }
    }
  }

  // ==================== CTF (Capture the Flag) ====================
  initCtf() {
    const mk = team => {
      const basePos = this.map.ctfBases[team].pos.clone();
      let mesh = null;
      if (!this.headless) {
        mesh = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xd8d8d8 }));
        pole.position.y = 1.3; mesh.add(pole);
        const col = team === 'alpha' ? 0x4da3ff : 0xff5a4d;
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.7), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
        flag.position.set(0.58, 2.15, 0); mesh.add(flag);
        this.engine.scene.add(mesh);
      }
      return { team, state: 'base', carrier: null, pos: basePos, basePos, returnT: 0, mesh };
    };
    this.ctf = { flags: { alpha: mk('alpha'), bravo: mk('bravo') } };
    for (const c of this.combatants) if (c.isBot) c.ctfRole = Math.random() < 0.55 ? 'attack' : 'defend';
    this.log('[CTF] Flags placed — first to 3 captures');
  }

  carryingFlag(c) {
    if (!this.ctf) return null;
    return Object.values(this.ctf.flags).find(f => f.state === 'carried' && f.carrier === c) || null;
  }

  grabCtfFlag(flag, c) {
    flag.state = 'carried'; flag.carrier = c;
    this.log(`[CTF] ${c.name} took the ${flag.team} flag`);
    if (this.hud && c === this.localPlayer) this.hud.banner('⚑ YOU HAVE THE ENEMY FLAG — RETURN TO BASE', 3);
  }

  dropCtfFlag(flag) {
    if (flag.state !== 'carried') return;
    flag.state = 'dropped'; flag.carrier = null; flag.returnT = 30;
    this.log(`[CTF] ${flag.team} flag dropped`);
  }

  returnCtfFlag(flag, by) {
    flag.state = 'base'; flag.carrier = null; flag.pos.copy(flag.basePos);
    if (by) {
      const c = typeof by === 'string' ? null : by;
      if (c) c.returns++;
      if (c === this.localPlayer) awardLocal(this, 100, { returns: 1 });
      this.log(`[CTF] ${flag.team} flag returned by ${typeof by === 'string' ? by : by.name}`);
    }
  }

  updateCtf(dt) {
    if (!this.ctf || this.over) return;
    const { alpha, bravo } = this.ctf.flags;
    for (const flag of [alpha, bravo]) {
      const foe = flag.team === 'alpha' ? 'bravo' : 'alpha';
      if (flag.state === 'carried') {
        const car = flag.carrier;
        if (!car || !car.alive) { this.dropCtfFlag(flag); continue; }
        flag.pos.copy(car.pos);
        // capture: carrier reaches own base while own flag is home
        const own = this.ctf.flags[car.team];
        if (car.pos.distanceTo(this.map.ctfBases[car.team].pos) < 3 && own.state === 'base') {
          this.ctfScore[car.team]++;
          car.score += 200;
          car.captures++;
          if (car === this.localPlayer) awardLocal(this, 200, { captures: 1 });
          this.log(`[CTF] ${car.name} captured the ${flag.team} flag (${this.ctfScore.alpha}-${this.ctfScore.bravo})`);
          if (this.hud) this.hud.banner(car.team === this.localTeam ? '⚑ FLAG CAPTURED! +200' : '⚑ ENEMY CAPTURED A FLAG', 2.5);
          import('./audio.js').then(m => m.audio.capture());
          this.returnCtfFlag(flag);
          if (this.ctfScore[car.team] >= MODE_INFO.ctf.target) { this.endMatch(car.team); return; }
        }
      } else {
        for (const c of this.combatants) {
          if (!c.alive || c.pos.distanceTo(flag.pos) > 2.2) continue;
          if (c.team === foe) {
            if (!this.carryingFlag(c)) { this.grabCtfFlag(flag, c); break; }
          } else if (flag.state === 'dropped') {
            this.returnCtfFlag(flag, c);
            if (this.hud && c === this.localPlayer) this.hud.banner('⚑ FLAG RETURNED', 2);
            break;
          }
        }
        if (flag.state === 'dropped') {
          flag.returnT -= dt;
          if (flag.returnT <= 0) this.returnCtfFlag(flag);
        }
      }
      if (flag.mesh) {
        flag.mesh.position.set(flag.pos.x, flag.pos.y, flag.pos.z);
        flag.mesh.rotation.y += dt * 1.5;
      }
    }
  }

  // ---------- combat resolution ----------
  hasLOS(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const dist = d.length();
    if (dist < 0.001) return true;
    d.normalize();
    for (const c of this.map.colliders) {
      if (rayAABB(a, d, c, dist) < dist - 0.3) return false;
    }
    // smoke blocks sight
    for (const s of this.smokes) {
      if (raySphere(a, d, s.pos, 4.2, dist) < dist) return false;
    }
    return true;
  }
  aimPoint(origin, dir, maxDist) {
    let best = maxDist;
    for (const c of this.map.colliders) best = Math.min(best, rayAABB(origin, dir, c, best));
    if (dir.y < -0.001) { const t = -origin.y / dir.y; if (t > 0 && t < best) best = t; }
    if (best >= maxDist) return null;
    return origin.clone().add(dir.clone().multiplyScalar(best));
  }

  hitscan(shooter, origin, dir, stats, weaponId, tracerFrom, maxDist = 130) {
    let bestT = maxDist, hit = null;
    const o = origin, d = dir;
    for (const c of this.map.colliders) {
      const t = rayAABB(o, d, c, bestT);
      if (t < bestT) { bestT = t; hit = null; }
    }
    const testCombatant = (c) => {
      if (c === shooter || !c.alive || !this.hostile(shooter, c)) return;
      const bp = c.pos;
      const head = { x: bp.x, y: bp.y + 1.62, z: bp.z };
      const chest = { x: bp.x, y: bp.y + 1.1, z: bp.z };
      const legs = { x: bp.x, y: bp.y + 0.45, z: bp.z };
      let t = raySphere(o, d, head, 0.24, bestT);
      let isHead = true;
      if (t === Infinity) { t = raySphere(o, d, chest, 0.44, bestT); isHead = false; }
      if (t === Infinity) { t = raySphere(o, d, legs, 0.42, bestT); isHead = false; }
      if (t < bestT) { bestT = t; hit = { type: 'combatant', target: c, head: isHead }; }
    };
    for (const c of this.combatants) testCombatant(c);
    for (const s of [...this.sentries, ...this.helis]) {
      if (s === shooter || !this.hostile(shooter, s)) continue;
      const ap = s.aimPos();
      const r = s.isHeli ? 2.6 : 0.65;
      const t = raySphere(o, d, ap, r, bestT);
      if (t < bestT) { bestT = t; hit = { type: 'device', target: s, head: false }; }
    }
    const end = o.clone().add(d.clone().multiplyScalar(bestT));
    if (!this.headless && this.fx) {
      this.fx.tracer(tracerFrom || o, end);
      if (bestT < maxDist - 0.01 && !hit) this.fx.burst(end, 0xd8cfa8, 3.5, 0.35);
      else if (hit) this.fx.burst(end, 0xff5544, 4.5, 0.4);
    }
    if (hit) {
      let dmg = stats.dmg;
      if (bestT > stats.range) dmg *= clamp(1 - (bestT - stats.range) / Math.max(stats.falloff - stats.range, 1) * 0.55, 0.45, 1);
      if (hit.type === 'combatant') {
        const wasAlive = hit.target.alive;
        hit.target.takeDamage(dmg * (hit.head ? stats.headMult : 1), shooter, hit.head, false, weaponId);
        if (shooter === this.localPlayer && wasAlive) {
          if (hit.target.alive) { if (this.hud) this.hud.hitmarker(false, false); audio.hitmarker(false, false); }
        }
      } else {
        hit.target.takeDamage(dmg, shooter);
        if (shooter === this.localPlayer && this.hud) this.hud.hitmarker(false, false);
      }
    }
    return hit;
  }
  hitscanMelee(owner, origin, dir, range, dmg) {
    for (const c of this.combatants) {
      if (c === owner || !c.alive || !this.hostile(owner, c)) continue;
      const to = new THREE.Vector3().subVectors(c.chestPos || c.eyePos, origin);
      if (to.length() < range + 0.6 && to.normalize().dot(dir) > 0.5) {
        c.takeDamage(dmg, owner, false, false, 'knife');
        return c;
      }
    }
    return null;
  }
  explode(pos, radius, maxDmg, owner) {
    if (!this.headless && this.fx) { this.fx.burst(pos, 0xffa030, 11, 0.7); this.fx.burst(pos, 0x555555, 6, 1.1); this.fx.explosionLight(pos); }
    audio.explosion(1);
    if (this.localPlayer && this.localPlayer.alive) {
      const d = pos.distanceTo(this.localPlayer.pos);
      if (d < radius * 3.5) this.shake = Math.min(1, (1 - d / (radius * 3.5)) * 1.2);
    }
    for (const c of this.combatants) {
      if (!c.alive) continue;
      const d = pos.distanceTo(new THREE.Vector3(c.pos.x, c.pos.y + 1, c.pos.z));
      if (d < radius) {
        const dmg = maxDmg * (1 - d / radius * 0.7);
        const friendly = owner && !this.hostile(owner, c) && c !== owner;
        c.takeDamage(dmg, friendly ? null : owner, false, true, 'frag');
      }
    }
    for (const s of [...this.sentries, ...this.helis]) {
      if (s.hp === undefined || s.hp <= 0) continue;
      const d = pos.distanceTo(s.aimPos());
      if (d < radius && (!owner || this.hostile(owner, s))) s.takeDamage(maxDmg * (1 - d / radius * 0.5), owner);
    }
  }
  flashbang(pos, owner) {
    audio.flashRing();
    if (!this.headless && this.fx) this.fx.explosionLight(pos);
    for (const c of this.combatants) {
      if (!c.alive || (owner && !this.hostile(owner, c))) continue;
      const cEye = c.eyePos;
      const d = pos.distanceTo(cEye);
      if (d > 26) continue;
      if (!this.hasLOS(pos, cEye)) continue;
      // facing check
      const toFlash = new THREE.Vector3().subVectors(pos, cEye).normalize();
      const fwd = c.isBot === false
        ? new THREE.Vector3(0, 0, -1).applyEuler(this.engine.camera.rotation)
        : new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      const facing = toFlash.dot(fwd);
      const strength = clamp(1 - d / 26, 0.15, 1) * (facing > 0.2 ? 1 : 0.35);
      if (c.isBot === false) { c.flashT = Math.max(c.flashT, strength * 2.2); }
      else c.blindT = Math.max(c.blindT, strength * 3.2);
    }
  }
  stunBlast(pos, owner) {
    audio.explosion(0.5);
    for (const c of this.combatants) {
      if (!c.alive || (owner && !this.hostile(owner, c))) continue;
      const d = pos.distanceTo(c.pos);
      if (d < 12) c.stunT = Math.max(c.stunT || 0, 3.5 * (1 - d / 14));
    }
  }
  addSmoke(pos, team) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(4.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.75, depthWrite: false }));
    m.position.set(pos.x, 1.6, pos.z);
    this.engine.scene.add(m);
    this.smokes.push({ pos: m.position.clone(), mesh: m, t: 14, team });
  }
  throwGrenade(owner, kind, pos, vel) {
    this.grenades.push(new Grenade(this, owner, kind, pos, vel));
  }
  registerShot(c) {
    if (c.stats && c.stats.suppressed) return;
    const pos = c.pos || (c.aimPos && c.aimPos());
    if (pos) this.recentShots.push({ x: pos.x, z: pos.z, team: c.team, t: this.time });
  }

  onKill(victim, killer, isHead, weaponId) {
    if (victim.alive === false) return;
    victim.die();
    victim.deaths++;
    const suicide = !killer || killer === victim;
    const teamkill = !suicide && !this.hostile(killer, victim);
    const wname = weaponId === 'knife' ? 'Combat Knife' : weaponId === 'frag' || weaponId === 'semtex' ? 'Frag' : weaponId === 'sentry' ? 'Sentry Gun' : weaponId === 'heli' ? 'Attack Heli' : (weaponById(weaponId).name || weaponId);
    if (this.hud) this.hud.killfeed(killer, victim, isHead, wname, suicide || teamkill);

    if (!suicide && !teamkill && killer) {
      killer.kills++;
      if (isHead) killer.headshots++;
      killer.streakCount++;
      killer.bestStreak = Math.max(killer.bestStreak || 0, killer.streakCount);
      const pts = 100 + (isHead ? 25 : 0);
      if (this.mode === 'tdm' || this.mode === 'dom') {
        this.scores[killer.team]++;
        killer.score += pts;
      } else {
        killer.score += pts;
      }
      // scavenger
      if (killer.perks && killer.perks.has('scavenger') && killer.isBot === false) {
        killer.weapon.reserveAmmo += killer.weapon.stats.mag;
        if (this.hud) this.hud.hint('SCAVENGER: ammo restocked');
      }
      // camo progress for local player gun kills
      if (killer === this.localPlayer && WEAPONS.some(w => w.id === weaponId)) {
        const newly = recordWeaponKill(weaponId, isHead);
        if (this.hud) this.hud.checkCamoUnlock(weaponId, newly);
      }
      checkStreakAward(this, killer);
      if (killer === this.localPlayer) {
        if (this.hud) this.hud.hitmarker(true, isHead); audio.hitmarker(true, isHead); audio.killConfirm();
        // XP + lifetime stats + challenge unlocks
        awardLocal(this, 100 + (isHead ? 25 : 0), isHead ? { kills: 1, headshots: 1 } : { kills: 1 });
        announceUnlocks(this, setBestStreak(killer.bestStreak || 0));
      }
    } else if (this.mode === 'ffa' && suicide && killer) {
      killer.score = Math.max(0, killer.score - 100);
    }
    // objective drops
    if (this.mode === 'snd' && this.snd) {
      if (this.snd.bomb.state === 'carried' && this.snd.bomb.carrier === victim) this.dropBomb(victim);
    }
    if (this.mode === 'ctf') {
      const f = this.carryingFlag(victim);
      if (f) this.dropCtfFlag(f);
    }
    if (this.mode === 'kc') this.spawnTag(victim);
    if (this.mode !== 'snd' && this.mode !== 'ctf') this.checkWin();
    // killcam for the local player's death (real matches only)
    if (!this.headless && victim === this.localPlayer) this.startKillcam(killer, wname, suicide || teamkill);
  }

  activateStreak(owner, slotIdx) { return activateStreak(this, owner, slotIdx); }

  checkWin() {
    if (this.over) return;
    const t = MODE_INFO[this.mode].target;
    if (this.mode === 'tdm' || this.mode === 'dom' || this.mode === 'kc') {
      // team score wins: kills (tdm/dom) or confirms (kc)
      if (this.scores.alpha >= t) this.endMatch('alpha');
      else if (this.scores.bravo >= t) this.endMatch('bravo');
    } else {
      for (const c of this.combatants) {
        if (c.kills >= t) { this.endMatch(c); return; }
      }
    }
  }

  endMatch(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.log('Match over: ' + (typeof winner === 'string' ? winner : winner.name));
    // local-player match XP + lifetime stats (real matches only)
    if (!this.headless && this.localPlayer) {
      const won = typeof winner === 'string' ? winner === this.localTeam
        : this.mode === 'ffa' ? winner === this.localPlayer : false;
      awardLocal(this, winner === 'draw' ? 300 : won ? 500 : 200,
        { matches: 1, wins: won ? 1 : 0 });
    }
    this.onEnd(this);
  }

  showScoreboard(show) {
    this._sbHeld = show;
    if (this.hud) this.hud.showScoreboard(show, false);
  }

  // ---------------- KILLCAM (snapshot-buffer replay) ----------------
  // Every frame we record a compact snapshot of all combatants. On local-player
  // death we freeze the sim and replay the killer's recorded perspective for a
  // few seconds (skippable), then show the Killed-By card.
  recordKcSnapshot() {
    this.kcBuf.push({ t: this.time, s: this.combatants.map(c => [c.pos.x, c.pos.y, c.pos.z, c.yaw, c.pitch || 0, c.alive ? 1 : 0]) });
    while (this.kcBuf.length && this.time - this.kcBuf[0].t > 6.5) this.kcBuf.shift();
  }
  startKillcam(killer, wname, suicide) {
    if (this.killcam || this.over) return;
    const ki = this.combatants.indexOf(killer);
    const valid = !suicide && ki >= 0;
    this.killcam = {
      rt: this.time - 5, dur: 4.5, elapsed: 0,
      ki: valid ? ki : -1, wname: wname || 'Unknown', suicide: !!suicide,
      deathPos: this.localPlayer.pos.clone(),
      phase: 'replay', kbT: 0,
    };
    if (this.hud) this.hud.showKillcam(true, valid ? killer : null, wname, suicide);
  }
  killerCard(kc) {
    const k = kc.ki >= 0 ? this.combatants[kc.ki] : null;
    if (k && k.card) return k.card;
    if (k) return botCard(k.name, k.level || 1);
    return { name: kc.suicide ? 'YOURSELF' : 'THE ARENA', clanTag: '', devTag: false, level: 1, title: '', emblem: 'chevron', banner: 'midnight' };
  }
  skipKillcam() {
    const kc = this.killcam; if (!kc) return;
    if (kc.phase === 'replay') {
      kc.phase = 'killedby'; kc.kbT = 3.5;
      if (this.hud) this.hud.showKilledBy(this.killerCard(kc), kc.wname);
    } else this.endKillcam();
  }
  endKillcam() {
    this.killcam = null;
    if (this.hud) this.hud.showKillcam(false);
    // restore bot models to live state
    for (const c of this.combatants) {
      if (c.isBot && c.model) { c.model.position.copy(c.pos); c.model.rotation.set(0, c.yaw, 0); c.model.visible = c.alive; }
    }
  }
  updateKillcam(dt) {
    const kc = this.killcam;
    if (!kc) return;
    kc.elapsed += dt;
    if (kc.phase === 'replay') {
      kc.rt += dt;
      if (kc.rt >= this.time - 0.35 || kc.elapsed >= kc.dur) {
        kc.phase = 'killedby'; kc.kbT = 3.5;
        if (this.hud) this.hud.showKilledBy(this.killerCard(kc), kc.wname);
        return;
      }
      this.renderKillcam(kc.rt, kc);
    } else {
      kc.kbT -= dt;
      if (kc.kbT <= 0) this.endKillcam();
    }
  }
  renderKillcam(rt, kc) {
    const buf = this.kcBuf;
    if (!buf.length) return;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= rt && buf[i + 1].t >= rt) { a = buf[i]; b = buf[i + 1]; break; }
    }
    const span = Math.max(1e-6, b.t - a.t);
    const f = Math.min(1, Math.max(0, (rt - a.t) / span));
    // pose every bot model from the replay buffer
    for (let i = 0; i < this.combatants.length; i++) {
      const c = this.combatants[i];
      if (!c.isBot || !c.model) continue;
      const s0 = a.s[i], s1 = b.s[i];
      if (!s0 || !s1) continue;
      c.model.position.set(
        s0[0] + (s1[0] - s0[0]) * f,
        s0[1] + (s1[1] - s0[1]) * f,
        s0[2] + (s1[2] - s0[2]) * f);
      c.model.rotation.set(0, s0[3] + (s1[3] - s0[3]) * f, 0);
      c.model.visible = (s0[5] + (s1[5] - s0[5]) * f) > 0.5;
    }
    const cam = this.engine.camera;
    cam.rotation.order = 'YXZ';
    if (kc.ki >= 0 && a.s[kc.ki]) {
      // killer's perspective
      const s0 = a.s[kc.ki], s1 = b.s[kc.ki];
      cam.position.set(
        s0[0] + (s1[0] - s0[0]) * f,
        s0[1] + (s1[1] - s0[1]) * f + 1.55,
        s0[2] + (s1[2] - s0[2]) * f);
      cam.rotation.y = s0[3] + (s1[3] - s0[3]) * f;
      cam.rotation.x = s0[4] + (s1[4] - s0[4]) * f;
      cam.rotation.z = 0;
    } else {
      // overhead/static replay for streak/suicide deaths
      const d = kc.deathPos;
      cam.position.set(d.x, d.y + 16, d.z + 0.5);
      cam.lookAt(d.x, d.y, d.z);
    }
  }

  update(dt, frame, now) {
    if (this.over) return;
    if (this.killcam) { this.updateKillcam(dt); return; } // frozen sim, replaying killcam
    this.time += dt;
    if (this.mode === 'snd') {
      // round-based; updateSnd handles timing and completion
      this.updateSnd(dt);
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        if (this.mode === 'ffa') {
          let best = null;
          for (const c of this.combatants) if (!best || c.kills > best.kills) best = c;
          this.endMatch(best);
        } else if (this.mode === 'ctf') {
          const { alpha, bravo } = this.ctfScore;
          this.endMatch(alpha === bravo ? 'draw' : alpha > bravo ? 'alpha' : 'bravo');
        } else {
          this.endMatch(this.scores.alpha === this.scores.bravo ? 'draw' : this.scores.alpha > this.scores.bravo ? 'alpha' : 'bravo');
        }
        return;
      }
    }
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].update(dt)) this.timers.splice(i, 1);
    }
    // uav decay
    for (const t of ['alpha', 'bravo']) this.uav[t] = Math.max(0, this.uav[t] - dt);
    // recent shots decay
    for (let i = this.recentShots.length - 1; i >= 0; i--) if (this.time - this.recentShots[i].t > 2.5) this.recentShots.splice(i, 1);

    // combatants
    for (const c of this.combatants) {
      if (c.isBot) c.update(dt, now);
      else if (c === this.localPlayer && frame) c.update(dt, frame, now);
    }
    // killcam snapshot (visual matches only; sims run headless and skip this)
    if (!this.headless) this.recordKcSnapshot();
    // camera shake
    if (this.shake > 0 && this.localPlayer && !this.headless) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const cam = this.engine.camera;
      cam.rotation.x += rand(-1, 1) * 0.02 * this.shake;
      cam.rotation.y += rand(-1, 1) * 0.02 * this.shake;
    }
    // sentries / helis
    for (let i = this.sentries.length - 1; i >= 0; i--) if (this.sentries[i].update(dt)) this.sentries.splice(i, 1);
    for (let i = this.helis.length - 1; i >= 0; i--) if (this.helis[i].update(dt)) this.helis.splice(i, 1);
    // grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      if (this.grenades[i].update(dt)) { this.grenades[i].dispose(); this.grenades.splice(i, 1); }
    }
    // smokes
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt;
      s.mesh.material.opacity = Math.min(0.75, s.t / 3 * 0.75);
      s.mesh.scale.setScalar(1 + (14 - s.t) * 0.03);
      if (s.t <= 0) { this.engine.scene.remove(s.mesh); this.smokes.splice(i, 1); }
    }
    // domination
    if (this.mode === 'dom') this.updateDomination(dt);
    // ctf
    if (this.mode === 'ctf') this.updateCtf(dt);
    // kill confirmed tags
    if (this.mode === 'kc') this.updateKc(dt);
    if (!this.headless) this.map.update(dt);
    if (this.fx) this.fx.update(dt);
    if (this.hud) this.hud.update(this, dt);
  }

  updateDomination(dt) {
    for (const f of this.map.flags) {
      let na = 0, nb = 0;
      const capturers = [];
      for (const c of this.combatants) {
        if (!c.alive || c.isBot === undefined) continue;
        if (c.isBot === false && !c.alive) continue;
        const d = Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z);
        if (d < 4.5) {
          if (c.team === 'alpha') na++; else if (c.team === 'bravo') nb++;
          capturers.push(c);
        }
      }
      const contested = na > 0 && nb > 0;
      const capTeam = !contested ? (na > 0 ? 'alpha' : nb > 0 ? 'bravo' : null) : null;
      if (capTeam && f.owner !== capTeam) {
        if (f.capturing !== capTeam) { f.capturing = capTeam; f.progress = 0; }
        f.progress += dt / 8;
        if (f.progress >= 1) {
          this.map.setFlagOwner(f, capTeam);
          for (const c of capturers) if (c.team === capTeam) { c.score += 150; checkStreakAward(this, c); if (c === this.localPlayer) awardLocal(this, 100); }
          audio.flagCaptured(capTeam === this.localTeam);
          if (this.hud) this.hud.banner(`${capTeam === this.localTeam ? '✓' : '✗'} FLAG ${f.id} ${f.owner === this.localTeam ? 'SECURED' : 'LOST'}`);
          this.log(`Flag ${f.id} -> ${capTeam}`);
        }
      } else if (!capTeam) { f.progress = Math.max(0, f.progress - dt / 10); if (f.progress === 0) f.capturing = null; }
    }
    // score tick
    this._domTick -= dt;
    if (this._domTick <= 0) {
      this._domTick = 1.5;
      for (const f of this.map.flags) if (f.owner) { this.scores[f.owner]++; }
      audio.flagTick();
      this.checkWin();
    }
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
