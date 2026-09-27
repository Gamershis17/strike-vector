import { WEAPONS, ATTACHMENTS, ATTACH_SLOTS, PERKS, LETHALS, TACTICALS, computeStats, weaponById } from './weapons.js';
import { getSlots, getActiveSlot, setActiveSlot, resetSlot, save as saveClasses, getStreakLoadout, setStreakLoadout } from './classes.js';
import { CAMOS, getUnlocked, getProgress, equipCamo, equippedCamo, challengeText, paintCamoPreview } from './camos.js';
import { STREAKS, STREAK_IDS } from './streaks.js';
import { audio } from './audio.js';
import * as THREE from 'three';
import { identity, isDevUnlocked, devEmblemSVG, setPlayerName, setClanTag, tryUnlockDev, saveIdentity } from './identity.js';
import { gunStyle, saveGunStyle, CHARMS, STICKERS, RETICLES, RETICLE_COLORS, applyGunStyleToViewmodel } from './gunstyle.js';
import { applyOperatorToViewmodel, operator, saveOperator, UNIFORMS, HEADGEAR, GLOVES, buildOperatorModel } from './operator.js';
import { buildViewmodel } from './weapons.js';
import { QUALITY_LEVELS } from './quality.js';
import {
  buildPlayerCard, cardHTML, xpProgress, MAX_LEVEL,
  TITLES, EMBLEMS, BANNERS, bannerById, emblemById, titleById,
  getUnlockedTitles, getUnlockedEmblems, setCardSelection, getCardSelection, getStats,
} from './progression.js';

const $ = id => document.getElementById(id);
const SCREENS = ['screen-menu', 'screen-class', 'screen-streaks', 'screen-camos', 'screen-operator', 'screen-gunstyle', 'screen-settings', 'screen-pause', 'screen-scoreboard', 'screen-lobby', 'screen-vs', 'screen-card', 'screen-titles'];

// Last-match snapshot for the lobby leaderboard (pre/post-match). Persisted so
// the board survives a reload; refreshed from live game data on match end.
const LOBBY_KEY = 'sv_lobby_v1';
export let lobbyData = null;
try { lobbyData = JSON.parse(localStorage.getItem(LOBBY_KEY) || 'null'); } catch (e) {}
export function setLobbyData(d) {
  lobbyData = d;
  try { localStorage.setItem(LOBBY_KEY, JSON.stringify(d)); } catch (e) {}
}

const SET_KEY = 'sv_settings_v1';
export let settings = { sens: 1.0, fov: 80, vol: 0.8, mus: 0.4, invertY: false, hitmarkerSound: true, botCount: 7, teamSize: 6, difficulty: 'regular', quality: 'medium' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) {}
export function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }

export class Menus {
  constructor(callbacks) {
    this.cb = callbacks;
    this.show('screen-menu');
    this.buildClassEditor();
    this.buildStreakPicker();
    this.buildCamos();
    this.buildSettings();
    this.buildIdentity();
    this.wireMain();
    this.refreshMenuCard();
  }
  show(id) {
    for (const s of SCREENS) $(s).classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
    this.current = id;
    this.stopPreview();
    this.clearVsTimer();
    if (id === 'screen-operator') this.startOperatorPreview();
    if (id === 'screen-gunstyle') this.startGunStylePreview();
    if (id === 'screen-menu') this.refreshMenuCard();
  }
  hideAll() { this.show(null); }

  wireMain() {
    document.querySelectorAll('.mode-card').forEach(b => b.addEventListener('click', () => {
      audio.init(); audio.uiClick();
      settings.botCount = parseInt($('opt-botcount').value) || 7;
      settings.teamSize = Math.min(6, Math.max(2, parseInt($('opt-teamsize').value) || 6));
      settings.difficulty = $('opt-difficulty').value;
      saveSettings();
      this.cb.onDeploy(b.dataset.mode);
    }));
    $('opt-botcount').value = settings.botCount;
    $('opt-teamsize').value = settings.teamSize;
    $('opt-difficulty').value = settings.difficulty;
    $('btn-loadout').onclick = () => { audio.uiClick(); this.refreshClassEditor(); this.show('screen-class'); };
    $('btn-streaks').onclick = () => { audio.uiClick(); this.refreshStreakPicker(); this.show('screen-streaks'); };
    $('btn-camos').onclick = () => { audio.uiClick(); this.refreshCamos(); this.show('screen-camos'); };
    $('btn-operator').onclick = () => { audio.uiClick(); this.refreshOperator(); this.show('screen-operator'); };
    $('btn-gunstyle').onclick = () => { audio.uiClick(); this.refreshGunStyle(); this.show('screen-gunstyle'); };
    $('btn-operator-back').onclick = () => { audio.uiClick(); this.show('screen-menu'); };
    $('btn-gunstyle-back').onclick = () => { audio.uiClick(); this.show('screen-menu'); };
    $('btn-settings').onclick = () => { audio.uiClick(); this.refreshSettings(); this.show('screen-settings'); };
    $('btn-class-back').onclick = () => { audio.uiClick(); saveClasses(); this.show('screen-menu'); };
    $('btn-class-reset').onclick = () => { audio.uiClick(); resetSlot(getActiveSlot()); this.refreshClassEditor(); };
    $('btn-streaks-back').onclick = () => { audio.uiClick(); this.show('screen-menu'); };
    $('btn-camos-back').onclick = () => { audio.uiClick(); this.show('screen-menu'); };
    $('btn-settings-back').onclick = () => { audio.uiClick(); saveSettings(); this.show(this._settingsFrom || 'screen-menu'); };
    $('btn-resume').onclick = () => { audio.uiClick(); this.cb.onResume(); };
    $('btn-restart').onclick = () => { audio.uiClick(); this.cb.onRestart(); };
    $('btn-quit').onclick = () => { audio.uiClick(); this.cb.onQuitToMenu(); };
    $('btn-sb-menu').onclick = () => { audio.uiClick(); this.cb.onQuitToMenu(); };
    $('btn-sb-again').onclick = () => { audio.uiClick(); this.cb.onRestart(); };
    $('btn-sb-close').onclick = () => this.cb.onCloseScoreboard();
    $('btn-sb-lobby').onclick = () => { audio.uiClick(); this.cb.onLobbyBoard(); };
    $('btn-lobby').onclick = () => { audio.uiClick(); this.openLobby('screen-menu'); };
    $('btn-lobby-back').onclick = () => { audio.uiClick(); this.show(this._lobbyFrom || 'screen-menu'); };
    $('btn-card').onclick = () => { audio.uiClick(); this.refreshCard(); this.show('screen-card'); };
    $('btn-titles').onclick = () => { audio.uiClick(); this.refreshTitles(); this.show('screen-titles'); };
    $('btn-card-back').onclick = () => { audio.uiClick(); this.show('screen-menu'); };
    $('btn-titles-back').onclick = () => { audio.uiClick(); this.show('screen-menu'); };
    $('btn-vs-deploy').onclick = () => { audio.uiClick(); this.launchVs(); };
  }

  // ---------------- PLAYER CARD (menu) ----------------
  refreshMenuCard() {
    const el = $('menu-card');
    if (!el) return;
    const card = buildPlayerCard();
    const pr = xpProgress();
    el.innerHTML = cardHTML(card, 'full') +
      `<div class="xp-bar"><i style="width:${Math.round(pr.frac * 100)}%"></i></div>` +
      `<div class="xp-label">${pr.level >= MAX_LEVEL ? 'MAX LEVEL' : `${pr.xp.toLocaleString()} / ${pr.need.toLocaleString()} XP`}</div>`;
  }

  // ---------------- VS / DEPLOY SCREEN ----------------
  clearVsTimer() { if (this._vsTimer) { clearInterval(this._vsTimer); this._vsTimer = null; } }
  showVs(game, mode, onLaunch) {
    this._vsLaunch = onLaunch;
    const modeName = ({ tdm: 'TEAM DEATHMATCH', ffa: 'FREE-FOR-ALL', dom: 'DOMINATION', snd: 'SEARCH & DESTROY', ctf: 'CAPTURE THE FLAG', kc: 'KILL CONFIRMED' })[mode] || mode.toUpperCase();
    $('vs-mode').textContent = modeName;
    const mkCol = (team, label) => {
      const list = game.combatants
        .filter(c => mode === 'ffa' ? true : c.team === team)
        .slice(0, mode === 'ffa' ? 8 : 6);
      $(team === 'alpha' || mode === 'ffa' ? 'vs-team-a' : 'vs-team-b').innerHTML =
        `<div class="vs-team-label ${team === 'alpha' ? 'A' : team === 'bravo' ? 'C' : ''}">${label}</div>` +
        list.map(c => `<div class="vs-card${c === game.localPlayer ? ' you' : ''}">${cardHTML(c.card || buildPlayerCard(), 'mini')}${c === game.localPlayer ? '<span class="vs-you">YOU</span>' : ''}</div>`).join('');
    };
    if (mode === 'ffa') {
      mkCol('alpha', 'COMBATANTS');
      $('vs-team-b').innerHTML = '';
      $('vs-mid').textContent = 'EVERY OPERATOR FOR THEMSELVES';
    } else {
      mkCol('alpha', 'ALPHA TEAM');
      mkCol('bravo', 'BRAVO TEAM');
      $('vs-mid').textContent = '⚔';
    }
    $('vs-map').textContent = 'STRIKE ZONE · NIGHT';
    this.show('screen-vs');
    // auto-deploy countdown (skippable via DEPLOY)
    let n = 6;
    const tick = () => {
      $('btn-vs-deploy').innerHTML = `DEPLOY <b>${n}</b>`;
      if (n <= 0) { this.launchVs(); return; }
      n--;
    };
    tick();
    this.clearVsTimer();
    this._vsTimer = setInterval(tick, 1000);
  }
  launchVs() {
    this.clearVsTimer();
    const f = this._vsLaunch; this._vsLaunch = null;
    if (f) f();
  }

  // ---------------- LOBBY LEADERBOARD ----------------
  // MW2-lobby-style sortable board over the last match snapshot.
  openLobby(from) {
    this._lobbyFrom = from;
    this._lobbySort = this._lobbySort || { key: 'score', dir: -1 };
    this.refreshLobby();
    this.show('screen-lobby');
  }
  lobbyColumns(mode) {
    const cols = [
      { k: 'pos', t: 'POS' }, { k: 'level', t: 'LVL' }, { k: 'name', t: 'PLAYER' },
      { k: 'spm', t: 'SPM' }, { k: 'kills', t: 'K' }, { k: 'deaths', t: 'D' },
    ];
    if (mode === 'kc') cols.push({ k: 'confirms', t: 'CONF' }, { k: 'denies', t: 'DENY' });
    else if (mode === 'snd') cols.push({ k: 'plants', t: 'PLT' }, { k: 'defuses', t: 'DEF' });
    else if (mode === 'ctf') cols.push({ k: 'captures', t: 'CAP' }, { k: 'returns', t: 'RET' });
    cols.push({ k: 'ping', t: 'PING' }, { k: 'score', t: 'SCORE' });
    return cols;
  }
  refreshLobby() {
    const sub = $('lobby-sub'), tbl = $('lobby-table');
    const d = lobbyData;
    if (!d || !d.players || !d.players.length) {
      sub.textContent = 'NO RECENT MATCH ON RECORD';
      tbl.innerHTML = '<div class="lobby-empty">PLAY A MATCH TO POPULATE THE BOARD</div>';
      return;
    }
    const modeName = ({ tdm: 'TEAM DEATHMATCH', ffa: 'FREE-FOR-ALL', dom: 'DOMINATION', snd: 'SEARCH & DESTROY', ctf: 'CAPTURE THE FLAG', kc: 'KILL CONFIRMED' })[d.mode] || d.mode.toUpperCase();
    let teams;
    if (d.mode === 'snd') teams = `ALPHA ${d.roundWins.alpha} — ${d.roundWins.bravo} BRAVO`;
    else if (d.mode === 'ctf') teams = `ALPHA ${d.ctfScore.alpha} — ${d.ctfScore.bravo} BRAVO`;
    else if (d.mode === 'ffa') teams = 'EVERYONE FOR THEMSELVES';
    else teams = `ALPHA ${d.scores.alpha} — ${d.scores.bravo} BRAVO`;
    const win = d.winner ? (d.winner === 'draw' ? 'DRAW' : `${String(d.winner).toUpperCase()} WINS`) : '';
    sub.textContent = `${modeName} · ${teams}${win ? ' · ' + win : ''} · ${d.at || ''}`;
    const cols = this.lobbyColumns(d.mode);
    const { key, dir } = this._lobbySort;
    const rows = [...d.players].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'string') return dir * String(av).localeCompare(String(bv));
      return dir * ((av || 0) - (bv || 0)) || dir * ((b.score || 0) - (a.score || 0));
    });
    const arrow = k => k === key ? (dir < 0 ? ' ▼' : ' ▲') : '';
    let html = '<table><tr>' + cols.map(c =>
      `<th data-k="${c.k}" class="${c.k === 'name' ? '' : 'num'}${c.k === key ? ' sorted' : ''}">${c.t}${arrow(c.k)}</th>`
    ).join('') + '</tr>';
    rows.forEach((r, i) => {
      const tc = d.mode === 'ffa' ? '#9db4c6' : r.team === 'alpha' ? '#4da3ff' : '#ff5a4d';
      const cells = cols.map(c => {
        if (c.k === 'pos') return `<td class="num">${i + 1}</td>`;
        if (c.k === 'name') return `<td style="color:${tc}">${r.name}</td>`;
        return `<td class="num">${r[c.k] != null ? r[c.k] : 0}</td>`;
      }).join('');
      html += `<tr>${cells}</tr>`;
    });
    tbl.innerHTML = html + '</table>';
    tbl.querySelectorAll('th').forEach(th => {
      th.style.cursor = 'pointer';
      th.onclick = () => {
        const k = th.dataset.k;
        if (k === 'pos') return;
        if (this._lobbySort.key === k) this._lobbySort.dir *= -1;
        else this._lobbySort = { key: k, dir: k === 'name' ? 1 : -1 };
        this.refreshLobby();
      };
    });
  }

  // ---------------- PLAYER CARD EDITOR ----------------
  refreshCard() {
    const sel = getCardSelection();
    $('card-preview').innerHTML = cardHTML(buildPlayerCard(), 'full');
    // banners
    const bg = $('card-banners'); bg.innerHTML = '';
    for (const b of BANNERS) {
      const un = b.test(getStats(), xpProgress().level);
      const d = document.createElement('button');
      d.className = 'banner-pick' + (sel.banner === b.id ? ' sel' : '') + (un ? '' : ' locked');
      d.style.background = b.css;
      d.innerHTML = `<b>${b.name}</b><i>${un ? b.unlock : '🔒 ' + b.unlock}</i>`;
      if (un) d.onclick = () => { audio.uiClick(); setCardSelection({ banner: b.id }); this.refreshCard(); this.refreshMenuCard(); };
      bg.appendChild(d);
    }
    // emblems
    const eg = $('card-emblems'); eg.innerHTML = '';
    const unE = getUnlockedEmblems();
    for (const e of EMBLEMS) {
      const un = unE.includes(e.id);
      const d = document.createElement('button');
      d.className = 'emblem-pick' + (sel.emblem === e.id ? ' sel' : '') + (un ? '' : ' locked');
      d.innerHTML = `${e.svg(40)}<b>${e.name}</b><i>${un ? 'UNLOCKED' : '🔒 ' + e.challenge}</i>`;
      if (un) d.onclick = () => { audio.uiClick(); setCardSelection({ emblem: e.id }); this.refreshCard(); this.refreshMenuCard(); };
      eg.appendChild(d);
    }
    // titles
    const tg = $('card-titles'); tg.innerHTML = '';
    const unT = getUnlockedTitles();
    for (const t of TITLES) {
      const un = unT.includes(t.id);
      const d = document.createElement('button');
      d.className = 'title-pick' + (sel.title === t.id ? ' sel' : '') + (un ? '' : ' locked');
      d.innerHTML = `<b>"${t.name}"</b><i>${un ? t.challenge : '🔒 ' + t.challenge}</i>`;
      if (un) d.onclick = () => { audio.uiClick(); setCardSelection({ title: t.id }); this.refreshCard(); this.refreshMenuCard(); };
      tg.appendChild(d);
    }
  }

  // ---------------- TITLES & EMBLEMS BROWSER ----------------
  refreshTitles() {
    const st = getStats(), lvl = xpProgress().level;
    const unT = getUnlockedTitles(), unE = getUnlockedEmblems();
    $('titles-count').textContent = `${unT.length}/${TITLES.length} TITLES · ${unE.length}/${EMBLEMS.length} EMBLEMS`;
    const tg = $('titles-grid'); tg.innerHTML = '';
    for (const t of TITLES) {
      const un = unT.includes(t.id);
      const d = document.createElement('div');
      d.className = 'title-card' + (un ? '' : ' locked');
      d.innerHTML = `<b>"${t.name}"</b><i>${un ? '✓ ' + t.challenge : '🔒 ' + t.challenge}</i>`;
      tg.appendChild(d);
    }
    const eg = $('emblems-grid'); eg.innerHTML = '';
    for (const e of EMBLEMS) {
      const un = unE.includes(e.id);
      const d = document.createElement('div');
      d.className = 'emblem-card' + (un ? '' : ' locked');
      d.innerHTML = `${e.svg(52)}<b>${e.name}</b><i>${un ? '✓ ' + e.challenge : '🔒 ' + e.challenge}</i>`;
      eg.appendChild(d);
    }
    const sg = $('titles-stats'); sg.innerHTML = '';
    const rows = [
      ['Kills', st.kills], ['Headshots', st.headshots], ['Wins', st.wins], ['Matches', st.matches],
      ['Best streak', st.bestStreak], ['Confirms', st.confirms], ['Denies', st.denies],
      ['Plants', st.plants], ['Defuses', st.defuses], ['Captures', st.captures], ['Returns', st.returns],
    ];
    for (const [n, v] of rows) {
      const d = document.createElement('div');
      d.className = 'stat-pill';
      d.innerHTML = `<b>${v}</b><i>${n}</i>`;
      sg.appendChild(d);
    }
  }

  // ---------------- CLASS EDITOR ----------------
  buildClassEditor() {
    const tabs = $('class-tabs');
    tabs.innerHTML = '';
    getSlots().forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = s.name.toUpperCase();
      b.onclick = () => { audio.uiClick(); setActiveSlot(i); this.refreshClassEditor(); };
      tabs.appendChild(b);
    });
    // primary grouped by class
    const prim = $('ed-primary');
    prim.innerHTML = '';
    for (const cls of ['AR', 'SMG', 'LMG', 'Sniper', 'Shotgun']) {
      const og = document.createElement('optgroup'); og.label = cls;
      WEAPONS.filter(w => w.cls === cls).forEach(w => {
        const o = document.createElement('option'); o.value = w.id; o.textContent = w.name; og.appendChild(o);
      });
      prim.appendChild(og);
    }
    const sec = $('ed-secondary');
    sec.innerHTML = '';
    WEAPONS.filter(w => w.cls === 'Pistol').forEach(w => {
      const o = document.createElement('option'); o.value = w.id; o.textContent = w.name; sec.appendChild(o);
    });
    for (const slot of ATTACH_SLOTS) {
      const sel = $('att-' + slot);
      sel.innerHTML = '';
      ATTACHMENTS[slot].forEach(a => {
        const o = document.createElement('option'); o.value = a.id;
        o.textContent = a.name + (a.desc ? ' — ' + a.desc : ''); sel.appendChild(o);
      });
      sel.onchange = () => { this.currentSlot().primary.attachments[slot] = sel.value; saveClasses(); this.refreshClassStats(); audio.uiClick(); };
    }
    prim.onchange = () => { this.currentSlot().primary.weapon = prim.value; saveClasses(); this.refreshClassStats(); audio.uiClick(); };
    sec.onchange = () => { this.currentSlot().secondary.weapon = sec.value; saveClasses(); audio.uiClick(); };
    for (let i = 1; i <= 3; i++) {
      const sel = $('perk-' + i);
      sel.innerHTML = '';
      Object.entries(PERKS).forEach(([id, p]) => {
        const o = document.createElement('option'); o.value = id; o.textContent = `${p.name} — ${p.desc}`; sel.appendChild(o);
      });
      sel.onchange = () => { this.currentSlot().perks[i - 1] = sel.value; saveClasses(); this.refreshClassStats(); audio.uiClick(); };
    }
    const leth = $('ed-lethal'); leth.innerHTML = '';
    Object.entries(LETHALS).forEach(([id, l]) => { const o = document.createElement('option'); o.value = id; o.textContent = `${l.name} — ${l.desc}`; leth.appendChild(o); });
    leth.onchange = () => { this.currentSlot().lethal = leth.value; saveClasses(); audio.uiClick(); };
    const tac = $('ed-tactical'); tac.innerHTML = '';
    Object.entries(TACTICALS).forEach(([id, t]) => { const o = document.createElement('option'); o.value = id; o.textContent = `${t.name} — ${t.desc}`; tac.appendChild(o); });
    tac.onchange = () => { this.currentSlot().tactical = tac.value; saveClasses(); audio.uiClick(); };
  }
  currentSlot() { return getSlots()[getActiveSlot()]; }
  refreshClassEditor() {
    const s = this.currentSlot();
    [...$('class-tabs').children].forEach((b, i) => b.classList.toggle('active', i === getActiveSlot()));
    $('ed-primary').value = s.primary.weapon;
    $('ed-secondary').value = s.secondary.weapon;
    for (const slot of ATTACH_SLOTS) $('att-' + slot).value = s.primary.attachments[slot] || 'none';
    for (let i = 1; i <= 3; i++) $('perk-' + i).value = s.perks[i - 1];
    $('ed-lethal').value = s.lethal;
    $('ed-tactical').value = s.tactical;
    this.refreshClassStats();
  }
  refreshClassStats() {
    const s = this.currentSlot();
    const st = computeStats(s.primary.weapon, s.primary.attachments, s.perks);
    const w = weaponById(s.primary.weapon);
    const bars = [
      ['Damage', st.dmg / 130], ['Fire Rate', st.rpm / 860], ['Range', st.range / 120],
      ['Control', 1 - (st.recP / 2.6)], ['Mobility', st.moveMult], ['Mag Size', st.mag / 75],
    ];
    $('class-statbars').innerHTML = bars.map(([n, v]) =>
      `<div class="statbar"><b style="width:70px;text-align:left">${n}</b><div class="bar"><i style="width:${Math.round(Math.min(1, Math.max(0.03, v)) * 100)}%"></i></div></div>`).join('');
    const attNames = ATTACH_SLOTS.map(sl => ATTACHMENTS[sl].find(a => a.id === s.primary.attachments[sl])?.name).filter(n => n && n !== 'None');
    $('class-desc').innerHTML =
      `<b style="color:#e8f0f6">${w.name}</b> · ${w.cls}<br>` +
      (attNames.length ? `Attachments: ${attNames.join(', ')}<br>` : 'No attachments<br>') +
      `Perks: ${s.perks.map(p => PERKS[p].name).join(', ')}<br>` +
      `${LETHALS[s.lethal].name} / ${TACTICALS[s.tactical].name}`;
  }

  // ---------------- STREAK PICKER ----------------
  buildStreakPicker() {
    const mk = (id) => {
      const sel = $(id); sel.innerHTML = '';
      STREAK_IDS.forEach(sid => {
        const s = STREAKS[sid];
        const o = document.createElement('option'); o.value = sid;
        o.textContent = `${s.icon} ${s.name}`;
        sel.appendChild(o);
      });
      sel.onchange = () => this.streakChanged();
    };
    ['streak-1', 'streak-2', 'streak-3'].forEach(mk);
    $('streak-type-kill').onclick = () => { audio.uiClick(); this.setStreakType('kill'); };
    $('streak-type-score').onclick = () => { audio.uiClick(); this.setStreakType('score'); };
    $('streak-list').innerHTML = STREAK_IDS.map(sid => {
      const s = STREAKS[sid];
      return `<div class="streak-card"><b>${s.icon} ${s.name.toUpperCase()}</b><i>${s.desc}</i><i>Killstreak: ${s.killReq} kills · Scorestreak: ${s.scoreReq} pts</i></div>`;
    }).join('');
  }
  setStreakType(t) {
    const cur = getStreakLoadout();
    setStreakLoadout(t, cur.slots);
    this.refreshStreakPicker();
  }
  streakChanged() {
    const vals = ['streak-1', 'streak-2', 'streak-3'].map(id => $(id).value);
    // enforce uniqueness
    const seen = new Set();
    for (let i = 0; i < vals.length; i++) {
      if (seen.has(vals[i])) vals[i] = STREAK_IDS.find(s => !seen.has(s));
      seen.add(vals[i]);
    }
    const cur = getStreakLoadout();
    setStreakLoadout(cur.type, vals);
    this.refreshStreakPicker();
    audio.uiClick();
  }
  refreshStreakPicker() {
    const cur = getStreakLoadout();
    $('streak-type-kill').classList.toggle('active', cur.type === 'kill');
    $('streak-type-score').classList.toggle('active', cur.type === 'score');
    ['streak-1', 'streak-2', 'streak-3'].forEach((id, i) => $(id).value = cur.slots[i]);
  }

  // ---------------- CAMOS ----------------
  buildCamos() {
    const sel = $('camo-weapon');
    sel.innerHTML = '';
    WEAPONS.forEach(w => {
      const o = document.createElement('option'); o.value = w.id; o.textContent = `${w.name} (${w.cls})`; sel.appendChild(o);
    });
    sel.onchange = () => { audio.uiClick(); this.refreshCamos(); };
  }
  refreshCamos() {
    const wid = $('camo-weapon').value || 'vk7';
    const unlocked = getUnlocked(wid);
    const equipped = equippedCamo(wid);
    const grid = $('camo-grid');
    grid.innerHTML = '';
    CAMOS.forEach(c => {
      const isUn = unlocked.includes(c.id);
      const card = document.createElement('div');
      card.className = 'camo-card' + (isUn ? '' : ' locked') + (equipped === c.id ? ' equipped' : '');
      const cv = document.createElement('canvas'); cv.width = 150; cv.height = 64;
      paintCamoPreview(cv, c.id);
      const b = document.createElement('b'); b.textContent = c.name;
      const i = document.createElement('i');
      i.textContent = isUn ? (equipped === c.id ? 'EQUIPPED ✓' : c.desc + ' — click to equip') : '🔒 ' + challengeText(c, wid);
      card.append(cv, b, i);
      if (isUn) card.onclick = () => { audio.uiClick(); equipCamo(wid, c.id); this.refreshCamos(); };
      grid.appendChild(card);
    });
  }

  // ---------------- SETTINGS ----------------
  buildSettings() {
    const bind = (id, key, fmt) => {
      const el = $(id);
      el.addEventListener('input', () => {
        settings[key] = parseFloat(el.value);
        $(id + '-v').textContent = fmt(settings[key]);
        audio.setVolumes(settings.vol, settings.mus);
        saveSettings();
      });
    };
    bind('set-sens', 'sens', v => v.toFixed(1));
    bind('set-fov', 'fov', v => Math.round(v));
    bind('set-vol', 'vol', v => Math.round(v * 100) + '%');
    bind('set-mus', 'mus', v => Math.round(v * 100) + '%');
    $('set-invert').addEventListener('change', e => { settings.invertY = e.target.checked; saveSettings(); });
    $('set-hitmarker-sound').addEventListener('change', e => { settings.hitmarkerSound = e.target.checked; saveSettings(); });
    // Graphics quality: applies at the start of the next match (AA needs a fresh renderer).
    const qbtns = document.querySelectorAll('#set-quality button');
    const paintQ = () => qbtns.forEach(b => b.classList.toggle('on', b.dataset.q === settings.quality));
    qbtns.forEach(b => b.addEventListener('click', () => {
      settings.quality = b.dataset.q; saveSettings(); paintQ();
      $('set-quality-note').textContent = 'Quality saved — applies when your next match starts.';
    }));
    this._paintQuality = paintQ;
  }
  // ---------------- IDENTITY (name + clan tag) ----------------
  buildIdentity() {
    const msg = $('set-identity-msg');
    const say = (t, ok) => { msg.textContent = t; msg.className = 'set-msg ' + (ok ? 'ok' : 'err'); };
    $('set-name').addEventListener('change', e => {
      const r = setPlayerName(e.target.value);
      say(r.ok ? `Name set to "${identity.name}".` : r.error, r.ok);
      e.target.value = identity.name;
    });
    $('set-clantag').addEventListener('change', e => {
      const r = setClanTag(e.target.value);
      say(r.ok ? (identity.clanTag ? `Clan tag set to [${identity.clanTag}].` : 'Clan tag cleared.') : r.error, r.ok);
      e.target.value = identity.clanTag;
    });
    // Hidden dev gesture: click the version label 5 times within 3s.
    // This is the ONLY path to the dev-code prompt — no button, no menu entry.
    let taps = 0, tapT = 0;
    $('game-version').addEventListener('click', () => {
      const now = performance.now();
      taps = (now - tapT < 3000) ? taps + 1 : 1;
      tapT = now;
      if (taps >= 5) { taps = 0; this.showDevModal(); }
    });
    $('btn-dev-cancel').onclick = () => { audio.uiClick(); this.hideDevModal(); };
    $('btn-dev-unlock').onclick = async () => {
      audio.uiClick();
      const code = $('dev-code').value;
      const ok = await tryUnlockDev(code);
      const dm = $('dev-msg');
      if (ok) {
        dm.textContent = 'Developer access unlocked. [DEV] badge, Dev Ops skin and emblem active.';
        dm.className = 'set-msg ok';
        setTimeout(() => { this.hideDevModal(); if (this.current === 'screen-operator') this.refreshOperator(); }, 1200);
      } else {
        dm.textContent = 'Invalid code.';
        dm.className = 'set-msg err';
      }
      $('dev-code').value = '';
    };
  }
  showDevModal() { $('dev-code').value = ''; $('dev-msg').textContent = ''; $('dev-modal').classList.remove('hidden'); $('dev-code').focus(); }
  hideDevModal() { $('dev-modal').classList.add('hidden'); }
  refreshSettings(from) {
    this._settingsFrom = from || 'screen-menu';
    $('set-sens').value = settings.sens; $('set-sens-v').textContent = settings.sens.toFixed(1);
    $('set-fov').value = settings.fov; $('set-fov-v').textContent = Math.round(settings.fov);
    $('set-vol').value = settings.vol; $('set-vol-v').textContent = Math.round(settings.vol * 100) + '%';
    $('set-mus').value = settings.mus; $('set-mus-v').textContent = Math.round(settings.mus * 100) + '%';
    $('set-invert').checked = settings.invertY;
    $('set-hitmarker-sound').checked = settings.hitmarkerSound;
    if (!QUALITY_LEVELS[settings.quality]) settings.quality = 'medium';
    if (this._paintQuality) this._paintQuality();
    $('set-quality-note').textContent = '';
    $('set-name').value = identity.name;
    $('set-clantag').value = identity.clanTag;
    $('set-identity-msg').textContent = '';
  }

  // ---------------- OPERATOR ----------------
  stopPreview() {
    if (this._previewRAF) cancelAnimationFrame(this._previewRAF);
    this._previewRAF = null;
    if (this._previewRenderer) { this._previewRenderer.dispose(); this._previewRenderer = null; }
    this._previewScene = null; this._previewModel = null;
  }
  _makePreview(canvasId, w, h) {
    const canvas = $(canvasId);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(w, h, false);
    const scene = new THREE.Scene();
    scene.fog = null;
    const cam = new THREE.PerspectiveCamera(38, w / h, 0.1, 60);
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a2030, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x4da3ff, 0.5);
    rim.position.set(-4, 3, -3); scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40),
      new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 1 }));
    disc.rotation.x = -Math.PI / 2; scene.add(disc);
    return { renderer, scene, cam };
  }
  startOperatorPreview() {
    const { renderer, scene, cam } = this._makePreview('op-canvas', 460, 540);
    this._previewRenderer = renderer; this._previewScene = scene;
    cam.position.set(0, 1.35, 3.1); cam.lookAt(0, 0.95, 0);
    this._rebuildOperatorModel();
    let t = 0;
    const loop = () => {
      this._previewRAF = requestAnimationFrame(loop);
      t += 0.016;
      if (this._previewModel) this._previewModel.rotation.y = t * 0.55;
      renderer.render(scene, cam);
    };
    loop();
  }
  _rebuildOperatorModel() {
    if (!this._previewScene) return;
    if (this._previewModel) { this._previewScene.remove(this._previewModel); }
    this._previewModel = buildOperatorModel(operator);
    this._previewScene.add(this._previewModel);
  }
  refreshOperator() {
    const uni = $('op-uniforms'); uni.innerHTML = '';
    const dev = isDevUnlocked();
    for (const u of UNIFORMS) {
      if (u.devOnly && !dev) continue; // dev skin stays invisible until unlocked
      const b = document.createElement('button');
      b.className = 'swatch' + (operator.uniform === u.id ? ' sel' : '');
      b.title = `${u.name} — ${u.desc}`;
      const swColor = { woodland: '#4a5d23', desert: '#c2a878', urban: '#6b6f75', night: '#232a3a', dev: '#f5b301' }[u.id];
      b.innerHTML = `<span class="sw" style="background:${swColor}"></span><i>${u.name}</i>`;
      b.onclick = () => { audio.uiClick(); operator.uniform = u.id; saveOperator(); this._rebuildOperatorModel(); this.refreshOperator(); };
      uni.appendChild(b);
    }
    const hg = $('op-headgear'); hg.innerHTML = '';
    for (const h of HEADGEAR) {
      const b = document.createElement('button');
      b.className = 'pick' + (operator.headgear === h.id ? ' sel' : '');
      b.innerHTML = `<b>${h.name}</b><i>${h.desc}</i>`;
      b.onclick = () => { audio.uiClick(); operator.headgear = h.id; saveOperator(); this._rebuildOperatorModel(); this.refreshOperator(); };
      hg.appendChild(b);
    }
    const gl = $('op-gloves'); gl.innerHTML = '';
    for (const g of GLOVES) {
      const b = document.createElement('button');
      b.className = 'swatch' + (operator.gloves === g.id ? ' sel' : '');
      b.title = g.name;
      b.innerHTML = `<span class="sw" style="background:${g.color}"></span><i>${g.name}</i>`;
      b.onclick = () => { audio.uiClick(); operator.gloves = g.id; saveOperator(); this._rebuildOperatorModel(); this.refreshOperator(); };
      gl.appendChild(b);
    }
  }

  // ---------------- GUN STYLE ----------------
  startGunStylePreview() {
    const { renderer, scene, cam } = this._makePreview('gs-canvas', 520, 380);
    this._previewRenderer = renderer; this._previewScene = scene;
    cam.position.set(0.55, 0.28, 1.05); cam.lookAt(0, -0.02, -0.25);
    const view = buildViewmodel({ len: 0.78, cls: 'AR' }, 'default');
    applyOperatorToViewmodel(view);
    applyGunStyleToViewmodel(view);
    this._previewScene.add(view.group);
    this._previewGunView = view;
    let t = 0;
    const loop = () => {
      this._previewRAF = requestAnimationFrame(loop);
      t += 0.016;
      view.group.rotation.y = Math.sin(t * 0.5) * 0.55;
      view.group.rotation.x = Math.sin(t * 0.33) * 0.08;
      if (view.charmAnchor) {
        view.charmAnchor.rotation.x = Math.sin(t * 2.3) * 0.28;
        view.charmAnchor.rotation.z = Math.cos(t * 1.8) * 0.28;
      }
      renderer.render(scene, cam);
    };
    loop();
  }
  refreshGunStyle() {
    const mk = (elId, list, cur, cb, fmt) => {
      const el = $(elId); el.innerHTML = '';
      for (const it of list) {
        const b = document.createElement('button');
        b.className = 'pick' + (cur === it.id ? ' sel' : '');
        b.innerHTML = fmt(it);
        b.onclick = () => { audio.uiClick(); cb(it.id); };
        el.appendChild(b);
      }
    };
    const reapply = () => {
      if (this._previewGunView) { applyOperatorToViewmodel(this._previewGunView); applyGunStyleToViewmodel(this._previewGunView); }
    };
    mk('gs-charms', CHARMS, gunStyle.charm, id => { gunStyle.charm = id; saveGunStyle(); reapply(); this.refreshGunStyle(); },
      it => `<b>${it.name}</b>${it.desc ? `<i>${it.desc}</i>` : ''}`);
    mk('gs-stickers', STICKERS, gunStyle.sticker, id => { gunStyle.sticker = id; saveGunStyle(); reapply(); this.refreshGunStyle(); },
      it => `<b>${it.name}</b>`);
    mk('gs-reticles', RETICLES, gunStyle.reticle, id => { gunStyle.reticle = id; saveGunStyle(); this.refreshGunStyle(); },
      it => `<b>${it.name}</b>`);
    const rc = $('gs-retcolors'); rc.innerHTML = '';
    for (const c of RETICLE_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (gunStyle.reticleColor === c.id ? ' sel' : '');
      b.title = c.name;
      b.innerHTML = `<span class="sw" style="background:${c.id}"></span><i>${c.name}</i>`;
      b.onclick = () => { audio.uiClick(); gunStyle.reticleColor = c.id; saveGunStyle(); this.refreshGunStyle(); };
      rc.appendChild(b);
    }
  }
}
