import { clamp, lerp } from './util.js';
import { MODE_INFO } from './modes.js';
import { STREAKS } from './streaks.js';
import { CAMOS, getUnlocked } from './camos.js';
import { weaponById } from './weapons.js';
import { reticleHTML, gunStyle } from './gunstyle.js';
import { nameplate } from './identity.js';
import { cardHTML, rowCardHTML } from './progression.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      dmgVig: $('dmg-vignette'), dmgDir: $('dmg-dir'), flash: $('flash-overlay'),
      hint: $('hint'), banner: $('banner'),
      scoreA: $('score-alpha'), scoreMid: $('score-mid'), scoreB: $('score-bravo'),
      flags: $('flags'), killfeed: $('killfeed'), minimap: $('minimap'),
      streakBar: $('streak-bar'), weaponName: $('weapon-name'),
      ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
      lethalPip: $('lethal-pip'), tacPip: $('tac-pip'),
      healthFill: $('health-fill'), healthNum: $('health-num'),
      respawn: $('respawn-overlay'), respawnTimer: $('respawn-timer'),
      fps: $('fps-counter'),
      sb: $('screen-scoreboard'), sbTitle: $('sb-title'), sbWinner: $('sb-winner'), sbTable: $('sb-table'),
      kc: $('killcam-overlay'), kcLabel: $('killcam-label'),
      kb: $('killedby-overlay'), kbCard: $('killedby-card'), kbWeapon: $('killedby-weapon'),
      obj: null, objPrompt: null, objFill: null,
    };
    // objective prompt + progress bar (SND plant/defuse)
    const obj = document.createElement('div');
    obj.id = 'obj';
    obj.innerHTML = `<div id="obj-prompt"></div><div id="obj-bar"><div id="obj-fill"></div></div>`;
    $('hud').appendChild(obj);
    this.el.obj = obj; this.el.objPrompt = obj.querySelector('#obj-prompt'); this.el.objFill = obj.querySelector('#obj-fill');
    // custom optic reticle overlay
    const ret = document.createElement('div');
    ret.id = 'reticle'; ret.style.display = 'none';
    $('hud').appendChild(ret);
    this.el.reticle = ret; this._retKey = '';
    this.mm = this.el.minimap.getContext('2d');
    this._mmT = 0; this._bannerT = 0; this._hintT = 0; this._dmgT = 0;
    this._seenCamos = new Set();
    this.el.hud.classList.remove('hidden');
  }

  onFired(spreadDeg) {
    this.el.crosshair.style.setProperty('--gap', `${8 + spreadDeg * 4}px`);
  }
  hitmarker(kill, headshot) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill', 'headshot');
    void h.offsetWidth;
    h.classList.add('show');
    if (kill) h.classList.add('kill');
    if (headshot) h.classList.add('headshot');
  }
  damageFlash() { this._dmgT = 1; }
  damageFrom(angleRad) {
    const d = this.el.dmgDir;
    d.style.transform = `rotate(${angleRad}rad)`;
    d.style.opacity = 1;
    clearTimeout(this._ddT);
    this._ddT = setTimeout(() => d.style.opacity = 0, 700);
  }
  killfeed(killerC, victimC, headshot, weapon, isTK) {
    const div = document.createElement('div');
    div.className = 'kf';
    const kTeam = killerC ? killerC.team : null, vTeam = victimC ? victimC.team : null;
    const kc = kTeam === 'alpha' ? '#4da3ff' : kTeam === 'bravo' ? '#ff5a4d' : '#9db4c6';
    const vc = vTeam === 'alpha' ? '#4da3ff' : vTeam === 'bravo' ? '#ff5a4d' : '#9db4c6';
    const kName = killerC ? nameplate(killerC) : '💀';
    const vName = victimC ? nameplate(victimC) : '💀';
    div.innerHTML = `<b class="k" style="color:${kc}">${kName}</b> <span class="${headshot ? 'hs' : ''}">${headshot ? '🎯' : '🔫'} ${esc(weapon)}</span> <b style="color:${vc}">${vName}</b>${isTK ? ' <i style="color:#888">[TK]</i>' : ''}`;
    const kf = this.el.killfeed;
    kf.prepend(div);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => { div.style.transition = 'opacity .5s'; div.style.opacity = 0; setTimeout(() => div.remove(), 500); }, 5000);
  }
  // ---------------- KILLCAM + KILLED-BY ----------------
  // showKillcam(true) freezes the visible HUD into replay mode; the Game drives
  // timing and calls showKilledBy() when the replay ends. showKillcam(false)
  // hides everything and resumes normal HUD.
  showKillcam(show, killer, wname, suicide) {
    this.el.kc.classList.toggle('hidden', !show);
    this.el.kb.classList.add('hidden');
    this.el.crosshair.style.opacity = show ? 0 : '';
    if (show) {
      const kn = killer ? nameplate(killer) : (suicide ? 'YOURSELF' : '☠ STREAK');
      this.el.kcLabel.innerHTML = `🎬 KILLCAM — <b>${kn}</b>`;
      this.el.kc.onclick = () => { if (this.game) this.game.skipKillcam(); };
    } else {
      this.el.kc.onclick = null;
    }
  }
  showKilledBy(card, wname) {
    this.el.kc.classList.add('hidden');
    this.el.kb.classList.remove('hidden');
    this.el.kbCard.innerHTML = cardHTML(card, 'mini');
    this.el.kbWeapon.textContent = `KILLED BY ${card.name.toUpperCase()} — ${String(wname || '').toUpperCase()}`;
  }
  banner(text, dur = 2.2) {
    this.el.banner.textContent = text;
    this.el.banner.style.opacity = 1;
    this._bannerT = dur;
  }
  hint(text, dur = 2.5) {
    this.el.hint.textContent = text;
    this.el.hint.style.opacity = 1;
    this._hintT = dur;
  }
  checkCamoUnlock(weaponId, unlockedList) {
    for (const id of unlockedList) {
      const key = weaponId + ':' + id;
      if (!this._seenCamos.has(key) && id !== 'default') {
        this._seenCamos.add(key);
        const camo = CAMOS.find(c => c.id === id);
        const w = weaponById(weaponId);
        this.banner(`🎨 CAMO UNLOCKED: ${camo.name} — ${w.name}`);
        import('./audio.js').then(m => m.audio.streakReady());
      }
    }
  }
  flashStreaks() { /* visual pulse handled in updateStreaks */ }
  updateStreaks(p) {
    const bar = this.el.streakBar;
    bar.innerHTML = '';
    const loadout = this.game.streakLoadout;
    loadout.slots.forEach((id, i) => {
      const s = STREAKS[id];
      const inv = p.streakInv.find(x => x.id === id);
      const ready = inv && inv.ready;
      const d = document.createElement('div');
      d.className = 'streak-slot' + (ready ? ' ready' : '');
      d.innerHTML = `<b>${s.icon}</b><span>[${i + 3}] ${s.name}</span>`;
      bar.appendChild(d);
    });
  }

  updatePlayer(p, dt) {
    this.el.healthFill.style.width = `${clamp(p.health, 0, 100)}%`;
    this.el.healthFill.style.background = p.health > 50 ? 'linear-gradient(90deg,#37c871,#a8e05f)' : p.health > 25 ? 'linear-gradient(90deg,#c8a037,#e0c85f)' : 'linear-gradient(90deg,#c83737,#e05f5f)';
    this.el.healthNum.textContent = Math.ceil(clamp(p.health, 0, 100));
    const w = p.weapon;
    this.el.weaponName.textContent = w.def.name.toUpperCase();
    this.el.ammoMag.textContent = w.reloading ? '--' : w.magAmmo;
    this.el.ammoRes.textContent = '/ ' + w.reserveAmmo;
    this.el.lethalPip.textContent = `💣 ${p.lethalCount} [G]`;
    this.el.tacPip.textContent = `✨ ${p.tacCount} [Q]`;
    this.el.crosshair.classList.toggle('ads', w.adsK > 0.6);
    // custom optic reticle when ADS with an optic/sniper scope
    const hasOptic = w.def.cls === 'Sniper' || (w.stats.attachIds && w.stats.attachIds.optic && w.stats.attachIds.optic !== 'none');
    if (w.adsK > 0.6 && hasOptic) {
      const key = gunStyle.reticle + '|' + gunStyle.reticleColor;
      if (key !== this._retKey) { this.el.reticle.innerHTML = reticleHTML(); this._retKey = key; }
      this.el.reticle.style.display = '';
      this.el.crosshair.style.opacity = 0;
    } else {
      this.el.reticle.style.display = 'none';
      this.el.crosshair.style.opacity = '';
    }
    // crosshair gap relaxes toward hip baseline
    const cur = parseFloat(this.el.crosshair.style.getPropertyValue('--gap')) || 8;
    if (Math.abs(cur - 8) > 0.5) this.el.crosshair.style.setProperty('--gap', `${lerp(cur, 8, clamp(dt * 6, 0, 1))}px`);
    if (!p.alive) {
      this.el.respawn.classList.remove('hidden');
      if (this.game.mode === 'snd') this.el.respawnTimer.textContent = 'ELIMINATED — WAITING FOR NEXT ROUND';
      else this.el.respawnTimer.textContent = `RESPAWN IN ${Math.max(0, p.respawnT).toFixed(1)}`;
    } else this.el.respawn.classList.add('hidden');
    this.el.flash.style.opacity = clamp(p.flashT, 0, 1) * 0.92;
  }

  updateObjective(game) {
    const p = game.localPlayer, o = this.el;
    let prompt = '', showBar = false, frac = 0;
    if (game.mode === 'snd' && game.snd && game.snd.phase === 'live' && p && p.alive) {
      const s = game.snd, b = s.bomb;
      if (b.state === 'carried' && b.carrier === p && p.sndSite && p.pos.distanceTo(p.sndSite.pos) <= 3.4) {
        prompt = 'HOLD [E] TO PLANT'; showBar = true; frac = p.actionT || 0;
      } else if (b.state === 'carried' && b.carrier === p && p.sndSite) {
        prompt = `TAKE THE BOMB TO SITE ${p.sndSite.id}`;
      } else if (b.state === 'dropped' && p.team === s.atk) {
        prompt = 'RECOVER THE BOMB';
      } else if (b.state === 'planted' && p.team === s.def && p.pos.distanceTo(b.pos) <= 2.8) {
        prompt = 'HOLD [E] TO DEFUSE'; showBar = true; frac = p.actionT || 0;
      } else if (b.state === 'planted' && p.team === s.def) {
        prompt = 'DEFUSE THE BOMB';
      } else if (b.state === 'planted' && p.team === s.atk) {
        prompt = 'DEFEND THE BOMB';
      }
    } else if (game.mode === 'ctf' && game.ctf && p && p.alive) {
      const foe = p.team === 'alpha' ? 'bravo' : 'alpha';
      const foeFlag = game.ctf.flags[foe];
      if (foeFlag.state === 'carried' && foeFlag.carrier === p) prompt = 'RETURN TO YOUR BASE TO CAPTURE';
      else if (foeFlag.state === 'carried') prompt = 'ESCORT YOUR FLAG CARRIER';
      else prompt = 'CAPTURE THE ENEMY FLAG';
    } else if (game.mode === 'kc' && p && p.alive) {
      const enemy = game.tags.filter(t => t.team !== p.team).length;
      prompt = enemy ? `COLLECT ${enemy} ENEMY TAG${enemy > 1 ? 'S' : ''} — DENY YOURS` : 'KILL ENEMIES · COLLECT THEIR TAGS';
    }
    o.objPrompt.textContent = prompt;
    o.objFill.style.width = `${Math.round(frac * 100)}%`;
    o.obj.style.display = prompt ? '' : 'none';
    o.obj.querySelector('#obj-bar').style.display = showBar ? '' : 'none';
  }

  update(game, dt) {
    const p = game.localPlayer;
    // score
    const mi = MODE_INFO[game.mode];
    if (game.mode === 'ffa') {
      this.el.scoreA.style.display = 'none'; this.el.scoreB.style.display = 'none';
      const lead = Math.max(...game.combatants.map(c => c.kills));
      this.el.scoreMid.textContent = `FIRST TO ${mi.target} · LEADER ${lead}`;
    } else if (game.mode === 'snd') {
      this.el.scoreA.style.display = ''; this.el.scoreB.style.display = '';
      this.el.scoreA.textContent = game.roundWins.alpha;
      this.el.scoreB.textContent = game.roundWins.bravo;
      let mid = `ROUND ${game.sndRound} · FIRST TO ${mi.target}`;
      if (game.snd) {
        if (game.snd.phase === 'live') {
          const b = game.snd.bomb;
          if (b.state === 'planted') mid = `💣 ${Math.ceil(b.explodeT)}s`;
          else mid = `${Math.floor(game.snd.roundTime / 60)}:${String(Math.floor(game.snd.roundTime % 60)).padStart(2, '0')} · ${game.snd.atk === game.localTeam ? 'ATTACK' : 'DEFEND'}`;
        } else if (game.snd.phase === 'freeze') mid = `ROUND ${game.sndRound} — GET READY`;
      }
      this.el.scoreMid.textContent = mid;
    } else if (game.mode === 'ctf') {
      this.el.scoreA.style.display = ''; this.el.scoreB.style.display = '';
      this.el.scoreA.textContent = game.ctfScore.alpha;
      this.el.scoreB.textContent = game.ctfScore.bravo;
      const mm = Math.floor(game.timeLeft / 60), ss = Math.floor(game.timeLeft % 60);
      this.el.scoreMid.textContent = `${mm}:${String(ss).padStart(2, '0')} · FIRST TO ${mi.target}`;
    } else {
      this.el.scoreA.style.display = ''; this.el.scoreB.style.display = '';
      this.el.scoreA.textContent = game.scores.alpha;
      this.el.scoreB.textContent = game.scores.bravo;
      const mm = Math.floor(game.timeLeft / 60), ss = Math.floor(game.timeLeft % 60);
      this.el.scoreMid.textContent = `${mm}:${String(ss).padStart(2, '0')} · FIRST TO ${mi.target}`;
    }
    // SND/CTF objective prompt + progress
    this.updateObjective(game);
    // domination flags
    if (game.mode === 'dom') {
      this.el.flags.innerHTML = game.map.flags.map(f => {
        const cls = f.owner === 'alpha' ? 'A' : f.owner === 'bravo' ? 'C' : '';
        const prog = f.capturing && f.owner !== f.capturing ? ` ${Math.round(f.progress * 100)}%` : '';
        return `<span class="flag ${cls}">${f.id}${prog}</span>`;
      }).join('');
    } else this.el.flags.innerHTML = '';
    // fades
    if (this._bannerT > 0) { this._bannerT -= dt; if (this._bannerT <= 0) this.el.banner.style.opacity = 0; }
    if (this._hintT > 0) { this._hintT -= dt; if (this._hintT <= 0) this.el.hint.style.opacity = 0; }
    if (this._dmgT > 0) { this._dmgT = Math.max(0, this._dmgT - dt * 1.8); }
    this.el.dmgVig.style.opacity = this._dmgT * 0.9 + (p && p.health < 35 && p.alive ? 0.25 + Math.sin(performance.now() / 300) * 0.1 : 0);
    // fps
    this._fpsT = (this._fpsT || 0) + dt;
    if (this._fpsT > 0.5) { this._fpsT = 0; this.el.fps.textContent = `${game.engine.fps} FPS`; }
    // minimap @ ~12Hz
    this._mmT -= dt;
    if (this._mmT <= 0) { this._mmT = 0.08; this.drawMinimap(game); }
  }

  drawMinimap(game) {
    const c = this.mm, S = 150, half = 70;
    const px = x => (x + half) / (half * 2) * S;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(10,16,22,0.85)'; c.fillRect(0, 0, S, S);
    c.strokeStyle = '#2b4256'; c.strokeRect(1, 1, S - 2, S - 2);
    const p = game.localPlayer;
    const uavUp = p && game.uav[p.team] > 0;
    // flags
    for (const f of game.map.flags) {
      c.fillStyle = f.owner === 'alpha' ? '#4da3ff' : f.owner === 'bravo' ? '#ff5a4d' : '#888';
      c.font = 'bold 9px Arial'; c.textAlign = 'center';
      c.fillText(f.id, px(f.pos.x), px(f.pos.z) + 3);
    }
    const dot = (x, z, col, r = 2.5) => { c.fillStyle = col; c.beginPath(); c.arc(px(x), px(z), r, 0, 7); c.fill(); };
    // recent enemy fire
    for (const s of game.recentShots) {
      if (!p || s.team === p.team) continue;
      dot(s.x, s.z, 'rgba(255,80,60,0.9)', 2);
    }
    // KC dog tags: gold = enemy (confirm), blue = friendly (deny)
    if (game.mode === 'kc') {
      for (const tag of game.tags) {
        dot(tag.pos.x, tag.pos.z, tag.team === (p && p.team) ? '#4da3ff' : '#ffd24a', 2);
      }
    }
    for (const cb of game.combatants) {
      if (!cb.alive) continue;
      const friendly = game.mode === 'ffa' ? cb === p : cb.team === (p ? p.team : 'alpha');
      if (cb === p) continue;
      if (friendly) dot(cb.pos.x, cb.pos.z, '#4da3ff');
      else if (uavUp && !cb.perks?.has('coldblooded')) dot(cb.pos.x, cb.pos.z, '#ff5a4d');
    }
    // sentries & helis
    for (const s of game.sentries) if (s.hp > 0) dot(s.pos.x, s.pos.z, s.team === (p && p.team) ? '#4da3ff' : '#ff5a4d', 2);
    for (const h of game.helis) if (h.hp > 0) dot(h.pos.x, h.pos.z, '#ffb300', 3);
    // player arrow
    if (p && p.alive) {
      const x = px(p.pos.x), y = px(p.pos.z);
      c.save(); c.translate(x, y); c.rotate(Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)) * 0 + (-p.yaw));
      c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
      c.restore();
    }
    // uav indicator
    if (uavUp) { c.fillStyle = '#ffb300'; c.font = 'bold 9px Arial'; c.textAlign = 'left'; c.fillText('UAV', 4, 12); }
  }

  // MW2-style per-mode scoreboard: POS · LVL · PLAYER · SPM · K · D · mode stats · PING
  // Mode stats: KC = CONF/DENY, SND = PLT/DEF, CTF = CAP/RET.
  scoreColumns() {
    const cols = [
      { k: 'pos', t: 'POS', n: true },
      { k: 'level', t: 'LVL', n: true },
      { k: 'name', t: 'PLAYER' },
      { k: 'spm', t: 'SPM', n: true },
      { k: 'kills', t: 'K', n: true },
      { k: 'deaths', t: 'D', n: true },
    ];
    const m = this.game.mode;
    if (m === 'kc') cols.push({ k: 'confirms', t: 'CONF', n: true }, { k: 'denies', t: 'DENY', n: true });
    else if (m === 'snd') cols.push({ k: 'plants', t: 'PLT', n: true }, { k: 'defuses', t: 'DEF', n: true });
    else if (m === 'ctf') cols.push({ k: 'captures', t: 'CAP', n: true }, { k: 'returns', t: 'RET', n: true });
    cols.push({ k: 'ping', t: 'PING', n: true });
    return cols;
  }
  rowStats(c) {
    const game = this.game;
    return {
      level: (c.card && c.card.level) || c.level || 1,
      spm: game.time > 10 ? Math.round(c.score / (game.time / 60)) : 0,
      kills: c.kills, deaths: c.deaths,
      confirms: c.confirms || 0, denies: c.denies || 0,
      plants: c.plants || 0, defuses: c.defuses || 0,
      captures: c.captures || 0, returns: c.returns || 0,
      ping: c.ping != null ? c.ping : 50,
    };
  }
  teamScoreHeader() {
    const game = this.game, mi = MODE_INFO[game.mode];
    if (game.mode === 'snd') return `ROUND ${game.sndRound} · ALPHA ${game.roundWins.alpha} — ${game.roundWins.bravo} BRAVO · FIRST TO ${mi.target}`;
    if (game.mode === 'ctf') return `ALPHA ${game.ctfScore.alpha} — ${game.ctfScore.bravo} BRAVO · FIRST TO ${mi.target}`;
    if (game.mode === 'ffa') return `FIRST TO ${mi.target}`;
    return `ALPHA ${game.scores.alpha} — ${game.scores.bravo} BRAVO · FIRST TO ${mi.target}`;
  }
  showScoreboard(show, isEnd) {
    this.el.sb.classList.toggle('hidden', !show);
    if (!show) return;
    const game = this.game;
    $('btn-sb-close').classList.toggle('hidden', isEnd);
    $('btn-sb-menu').classList.toggle('hidden', !isEnd);
    $('btn-sb-again').classList.toggle('hidden', !isEnd);
    $('btn-sb-lobby').classList.toggle('hidden', !isEnd);
    this.el.sbTitle.textContent = isEnd ? 'MATCH COMPLETE' : MODE_INFO[game.mode].name.toUpperCase();
    const w = game.winner;
    const result = isEnd
      ? (w === 'draw' ? 'DRAW' :
        typeof w === 'string' ? (w === game.localTeam ? 'VICTORY' : 'DEFEAT') :
        (game.mode === 'ffa' ? (w === game.localPlayer ? 'VICTORY' : 'DEFEAT') : ''))
      : '';
    this.el.sbWinner.innerHTML = (result ? `<span class="sb-result">${result}</span> · ` : '') +
      `<span class="sb-teams">${esc(this.teamScoreHeader())}</span>`;
    const cols = this.scoreColumns();
    const rows = [...game.combatants].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    let html = '<table><tr>' + cols.map(c => `<th${c.n ? ' class="num"' : ''}>${c.t}</th>`).join('') + '</tr>';
    rows.forEach((c, i) => {
      const st = this.rowStats(c);
      const me = c === game.localPlayer ? ' class="me"' : '';
      const tc = game.mode === 'ffa' ? '#9db4c6' : c.team === 'alpha' ? '#4da3ff' : '#ff5a4d';
      const cells = cols.map(col => {
        if (col.k === 'pos') return `<td class="num">${i + 1}</td>`;
        if (col.k === 'name') {
          const cardLine = c.card ? `<div class="sb-cardline">${rowCardHTML(c.card)}</div>` : '';
          return `<td><div class="sb-name" style="color:${tc}">${nameplate(c, true)}</div>${cardLine}</td>`;
        }
        return `<td class="num">${st[col.k]}</td>`;
      }).join('');
      html += `<tr${me}>${cells}</tr>`;
    });
    this.el.sbTable.innerHTML = html + '</table>';
  }
  destroy() { this.el.hud.classList.add('hidden'); }
}

function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
