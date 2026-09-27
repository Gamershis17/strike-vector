import * as THREE from 'three';
import { Engine } from './engine.js';
import { buildMap } from './map.js';
import { Game, MODE_INFO } from './modes.js';
import { HUD } from './hud.js';
import { Menus, settings, setLobbyData } from './menus.js';
import { getActiveClass, resolveLoadout, getStreakLoadout } from './classes.js';
import { audio } from './audio.js';
import { applyIdentityTo, plainTagName } from './identity.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game-canvas');

let engine = null, game = null, hud = null, menus = null;
let paused = false, inMatch = false;
let lastMode = 'tdm';

// ---------------- match lifecycle ----------------
// prepareMatch builds everything (engine, map, game, player, bots, HUD) but does
// NOT start the simulation — the VS/deploy screen sits between prepare and launch.
function prepareMatch(mode) {
  lastMode = mode;
  if (!engine) engine = new Engine(canvas, { fov: settings.fov });
  else engine.newMatchScene();
  engine.camera.fov = settings.fov; engine.camera.updateProjectionMatrix();
  audio.init();
  audio.setVolumes(settings.vol, settings.mus);

  const map = buildMap(engine.scene);
  game = new Game({
    mode, engine, map,
    streakLoadout: getStreakLoadout(),
    difficulty: settings.difficulty,
    settings, headless: false,
    onEnd: onMatchEnd,
  });
  const player = game.addLocalPlayer(resolveLoadout(getActiveClass()));
  applyIdentityTo(player); // display name, clan tag, dev badge from profile
  game.teamSize = settings.teamSize || 6;
  game.addBots(settings.botCount);
  hud = new HUD(game);
  game.hud = hud;
  hud.el.hud.classList.add('hidden'); // stays hidden behind the VS screen until launch
}
function launchMatch() {
  const mode = lastMode;
  hud.el.hud.classList.remove('hidden');
  game.startMatch();
  hud.updateStreaks(game.localPlayer);
  hud.banner(MODE_INFO[mode].name.toUpperCase() + ' — CLICK TO LOCK MOUSE', 4);
  hud.hint('WASD move · SHIFT sprint · RMB aim · R reload · G frag · Q tactical · V knife · 3/4/5 streaks · TAB score', 7);

  inMatch = true; paused = false;
  menus.hideAll();
  engine._lockWanted = true;
  engine.onLockChange = locked => {
    if (!locked && inMatch && !game.over && !paused && !game.killcam) {
      paused = true;
      menus.show('screen-pause');
    }
  };
  const now0 = performance.now() / 1000;
  engine.start(dt => {
    const frame = engine.consumeFrame();
    if (!paused && !game.over) game.update(dt, frame, now0 + performance.now() / 1000 - now0);
  });
}
// startMatch = prepare + launch immediately (quick-restart, test shots).
function startMatch(mode) { prepareMatch(mode); launchMatch(); }

// Esc skips the killcam (overlay click also skips; wired in HUD).
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && game && game.killcam) game.skipKillcam();
});

function onMatchEnd(g) {
  if (g.killcam) g.endKillcam();
  engine.exitLock();
  inMatch = false;
  captureLobbyData(g);
  hud.showScoreboard(true, true);
}

// Snapshot the finished match for the lobby leaderboard (pre/post-match use).
function captureLobbyData(g) {
  setLobbyData({
    mode: g.mode,
    at: new Date().toLocaleString(),
    scores: { ...g.scores },
    roundWins: { ...g.roundWins },
    ctfScore: { ...g.ctfScore },
    winner: typeof g.winner === 'string' ? g.winner : (g.winner && g.winner.name) || null,
    players: g.combatants.map(c => ({
      name: plainTagName(c), team: c.team,
      level: (c.card && c.card.level) || c.level || 1,
      score: c.score, kills: c.kills, deaths: c.deaths,
      spm: g.time > 10 ? Math.round(c.score / (g.time / 60)) : 0,
      ping: c.ping != null ? c.ping : 50,
      confirms: c.confirms || 0, denies: c.denies || 0,
      plants: c.plants || 0, defuses: c.defuses || 0,
      captures: c.captures || 0, returns: c.returns || 0,
    })),
  });
}

function quitToMenu() {
  location.href = location.pathname; // clean reload
}

// ---------------- menus ----------------
menus = new Menus({
  onDeploy: mode => { prepareMatch(mode); menus.showVs(game, mode, () => launchMatch()); },
  onResume: () => { menus.hideAll(); paused = false; engine.requestLock(); },
  onRestart: () => { location.href = location.pathname + '?quick=' + lastMode; },
  onQuitToMenu: quitToMenu,
  onCloseScoreboard: () => { if (hud) hud.showScoreboard(false, false); },
  onLobbyBoard: () => { if (hud) hud.showScoreboard(false, true); menus.openLobby('screen-scoreboard'); },
});

// ---------------- test / screenshot hooks ----------------
function runSim(mode) {
  console.log('SIM_START', mode);
  const simEngine = new Engine(document.createElement('canvas'), { headless: true, fov: 80 });
  const map = buildMap(simEngine.scene);
  // speed up: lower score targets for the sim
  const saved = MODE_INFO[mode].target;
  MODE_INFO[mode].target = mode === 'dom' ? 30 : mode === 'snd' ? 2 : mode === 'ctf' ? 2 : 12;
  const g = new Game({
    mode, engine: simEngine, map,
    streakLoadout: { type: 'kill', slots: ['uav', 'airstrike', 'sentry'] },
    difficulty: 'regular', settings, headless: true,
    onEnd: gm => {
      const w = gm.winner;
      console.log('SIM_RESULT ' + JSON.stringify({
        mode, steps,
        winner: typeof w === 'string' ? w : (w && w.name),
        scores: gm.scores,
        roundWins: gm.roundWins, ctfScore: gm.ctfScore,
        totalKills: gm.combatants.reduce((a, c) => a + c.kills, 0),
        log: gm.logLines.slice(-12),
      }));
      MODE_INFO[mode].target = saved;
    },
  });
  g.teamSize = 6;
  g.addBots(7);
  g.startMatch();
  const dt = 1 / 20;
  let steps = 0;
  const maxSteps = 40000;
  const diag = params.has('diag');
  try {
    const t0 = performance.now();
    while (!g.over && steps < maxSteps) {
      g.update(dt, null, steps * dt);
      steps++;
      if (steps % 1000 === 0 && steps <= 3000) console.log('SIM_DIAG PROF step=' + steps + ' wallms=' + Math.round(performance.now() - t0));
      if (steps === 5 && mode === 'ctf') {
        const b0 = g.combatants.find(c => c.isBot);
        console.log('SIM_DIAG CTFDBG ctf=' + !!g.ctf + ' role=' + b0.ctfRole + ' steer=' + JSON.stringify(b0.ctfSteer(dt)) + ' pos=' + b0.pos.x.toFixed(1) + ',' + b0.pos.z.toFixed(1));
      }
      if (steps % 5000 === 0) console.log('SIM_STEP', steps, JSON.stringify(g.scores));
      if (mode === 'ctf' && steps % 500 === 0 && steps <= 4000) {
        const atk = g.combatants.find(c => c.isBot && c.ctfRole === 'attack' && c.team === 'bravo');
        console.log(`SIM_DIAG CTFTRACK step=${steps} ${atk.name} pos=(${atk.pos.x.toFixed(1)},${atk.pos.z.toFixed(1)}) state=${atk.state} alive=${atk.alive}`);
      }
      if (mode === 'ctf' && steps % 3000 === 0 && steps > 0) {
        const fl = Object.values(g.ctf.flags).map(f => `${f.team}:${f.state}${f.carrier ? '(' + f.carrier.name + ')' : ''}@(${f.pos.x.toFixed(0)},${f.pos.z.toFixed(0)})`).join(' ');
        const kills = g.combatants.reduce((a, c) => a + c.kills, 0);
        const states = {};
        for (const c of g.combatants) states[c.state] = (states[c.state] || 0) + 1;
        console.log(`SIM_DIAG CTFSTAT step=${steps} kills=${kills} states=${JSON.stringify(states)} flags: ${fl}`);
      }
      if (diag && steps % 2000 === 0) {
        console.log('SIM_DIAG ' + steps + ' ' + g.combatants.map(c =>
          `${c.name}@(${c.pos.x.toFixed(0)},${c.pos.z.toFixed(0)})[${c.isBot ? c.state : 'human'}]t=${c.target ? c.target.name || 'dev' : '-'}`).join(' '));
      }
    }
    if (!g.over) console.log('SIM_TIMEOUT', steps, JSON.stringify(g.scores));
  } catch (e) {
    console.log('SIM_ERROR', e && e.stack || e);
  }
}

function runShot(kind) {
  if (params.has('ping')) fetch('/__ping?shot=' + kind).catch(() => {});
  if (kind === 'class') { menus.refreshClassEditor(); menus.show('screen-class'); }
  else if (kind === 'streaks') { menus.refreshStreakPicker(); menus.show('screen-streaks'); }
  else if (kind === 'camos') { menus.refreshCamos(); menus.show('screen-camos'); }
  else if (kind === 'settings') { menus.refreshSettings(); menus.show('screen-settings'); }
  else if (kind === 'operator') { menus.refreshOperator(); menus.show('screen-operator'); }
  else if (kind === 'gunstyle') { menus.refreshGunStyle(); menus.show('screen-gunstyle'); }
  else if (kind === 'sbtag') {
    // TEMP validation shot: clan tag in scoreboard + killfeed
    Promise.all([import('./identity.js')]).then(([{ identity, applyIdentityTo }]) => {
      identity.name = 'HARBOR'; identity.clanTag = 'SV77';
      startMatch('tdm');
      setTimeout(() => {
        try {
          applyIdentityTo(game.localPlayer);
          const bots = game.combatants.filter(c => c.isBot);
          game.onKill(bots[1], bots[0], false, 'm4a1');
          game.onKill(bots[0], game.localPlayer, true, 'ak47');
          hud.showScoreboard(true, false);
          console.log('SHOT_READY');
        } catch (e) { console.log('SHOT_ERROR', e); }
      }, 2500);
    });
  }
  else if (kind === 'hud') {    startMatch('tdm');
    // stage a firefight in view after load
    setTimeout(() => {
      try {
        const p = game.localPlayer;
        p.pos.set(0, 0, -24); p.yaw = Math.PI; p.pitch = 0;
        // pull 3 bots into view
        const bots = game.combatants.filter(c => c.isBot).slice(0, 3);
        bots.forEach((b, i) => {
          b.pos.set((i - 1) * 6, 0, -6 - i * 3);
          b.onRespawn(b.pos);
          b.yaw = 0;
        });
        hud.banner('STRIKE ZONE — TDM', 3);
        console.log('SHOT_READY');
      } catch (e) { console.log('SHOT_ERROR', e); }
    }, 2500);
  }
  else if (kind === 'kc-sb') {
    // Kill Confirmed scoreboard shot: live match + staged kills/tags/confirms
    startMatch('kc');
    setTimeout(() => {
      try {
        const bots = game.combatants.filter(c => c.isBot);
        const liveA = bots.filter(b => b.team === 'alpha' && b.alive);
        const liveB = bots.filter(b => b.team === 'bravo' && b.alive);
        if (liveA[0] && liveB[0]) game.onKill(liveA[0], liveB[0], false, 'm4a1');
        if (liveA[1] && liveB[1]) game.onKill(liveA[1], liveB[1], true, 'ak47');
        if (liveB[2] && liveA[2]) game.onKill(liveB[2], liveA[2], false, 'm4a1');
        if (liveB[3]) game.onKill(liveB[3], game.localPlayer, false, 'm4a1');
        // local player confirms an enemy tag and denies a friendly one
        const take = t => {
          game.tags.splice(game.tags.indexOf(t), 1);
          if (t.mesh) game.engine.scene.remove(t.mesh);
          game.collectTag(game.localPlayer, t);
        };
        const et = game.tags.find(t => t.team !== game.localPlayer.team);
        if (et) take(et);
        const ft = game.tags.find(t => t.team === game.localPlayer.team);
        if (ft) take(ft);
        hud.showScoreboard(true, false);
        console.log('SHOT_READY');
      } catch (e) { console.log('SHOT_ERROR', e); }
    }, 4500);
  }
  else if (kind === 'lobby') {    // Lobby leaderboard shot: fast-forwarded KC match snapshot
    startMatch('kc');
    setTimeout(() => {
      try {
        const bots = game.combatants.filter(c => c.isBot);
        const liveA = bots.filter(b => b.team === 'alpha' && b.alive);
        const liveB = bots.filter(b => b.team === 'bravo' && b.alive);
        if (liveB[0]) game.onKill(liveB[0], game.localPlayer, false, 'm4a1');
        if (liveA[1] && liveB[1]) game.onKill(liveA[1], liveB[1], true, 'ak47');
        const dt = 1 / 20;
        for (let i = 0; i < 2400 && !game.over; i++) game.update(dt, null, i * dt);
        captureLobbyData(game);
        menus.openLobby('screen-menu');
        console.log('SHOT_READY');
      } catch (e) { console.log('SHOT_ERROR', e); }
    }, 3000);
  }
  else if (kind === 'card') { menus.refreshCard(); menus.show('screen-card'); }
  else if (kind === 'titles') { menus.refreshTitles(); menus.show('screen-titles'); }
  else if (kind === 'vs') { prepareMatch('tdm'); menus.showVs(game, 'tdm', () => {}); }
  else if (kind === 'killcam') {
    // staged death: a bravo bot guns down the local player -> killcam replay
    startMatch('tdm');
    setTimeout(() => {
      try {
        const bot = game.combatants.find(c => c.isBot && c.team === 'bravo' && c.alive);
        const p = game.localPlayer;
        if (!p.alive) p.respawn(); // ensure the staged kill actually lands
        bot.pos.set(p.pos.x + 3, 0, p.pos.z + 3);
        bot.yaw = Math.atan2(p.pos.x - bot.pos.x, p.pos.z - bot.pos.z);
        game.onKill(p, bot, false, 'ak47');
        setTimeout(() => console.log('SHOT_READY'), 1500);
      } catch (e) { console.log('SHOT_ERROR', e); }
    }, 3000);
  }
  else if (kind === 'killedby') {
    // same staged death, but the screenshot lands on the Killed-By card
    startMatch('tdm');
    setTimeout(() => {
      try {
        const bot = game.combatants.find(c => c.isBot && c.team === 'bravo' && c.alive);
        const p = game.localPlayer;
        if (!p.alive) p.respawn(); // ensure the staged kill actually lands
        bot.pos.set(p.pos.x + 3, 0, p.pos.z + 3);
        bot.yaw = Math.atan2(p.pos.x - bot.pos.x, p.pos.z - bot.pos.z);
        game.onKill(p, bot, false, 'ak47');
        setTimeout(() => console.log('SHOT_READY'), 12000);
      } catch (e) { console.log('SHOT_ERROR', e); }
    }, 3000);
  }
  if (kind === 'menu' || !kind) console.log('SHOT_READY');
  else if (kind !== 'hud' && kind !== 'kc-sb' && kind !== 'lobby' && kind !== 'killcam' && kind !== 'killedby') setTimeout(() => console.log('SHOT_READY'), 800);
}

// ---------------- boot ----------------
// Query-param test hooks (?asdev, ?sim, ?shot, ?quick) were removed for the
// public build. The menu is the only entry point.
console.log('STRIKE VECTOR menu ready');
