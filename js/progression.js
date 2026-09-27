// ================= PLAYER PROGRESSION: XP/levels, titles, emblems, banners, player cards =================
// All original procedural art (inline SVG / CSS gradients) — no external assets,
// no COD-copied names. Persists in localStorage under sv_xp_v1.
import { identity, isDevUnlocked, devEmblemSVG } from './identity.js';
import { BOT_NAMES } from './util.js';

const XP_KEY = 'sv_xp_v1';
export const MAX_LEVEL = 50;

const DEFAULTS = () => ({
  xp: 0, level: 1,
  banner: 'midnight', emblem: 'chevron', title: 'rookie',
  unlockedTitles: ['rookie'], unlockedEmblems: ['chevron'],
  stats: {
    kills: 0, headshots: 0, wins: 0, matches: 0,
    confirms: 0, denies: 0, plants: 0, defuses: 0,
    captures: 0, returns: 0, bestStreak: 0,
  },
});
let store = DEFAULTS();
try { const s = JSON.parse(localStorage.getItem(XP_KEY) || 'null'); if (s) { store = { ...DEFAULTS(), ...s, stats: { ...DEFAULTS().stats, ...(s.stats || {}) } }; } } catch (e) {}
function save() { try { localStorage.setItem(XP_KEY, JSON.stringify(store)); } catch (e) {} }

// XP needed to advance FROM `level` TO `level+1`.
export function xpForLevel(level) {
  return Math.round(600 * Math.pow(Math.max(1, level), 1.32));
}
export function getLevel() { return store.level; }
export function getXP() { return store.xp; }
export function xpProgress() {
  const need = xpForLevel(store.level);
  return { level: store.level, xp: store.xp, need, frac: Math.min(1, store.xp / need) };
}
// Add XP. Returns { leveled, level } — caller (modes.js) shows the toast.
export function gainXP(n) {
  if (store.level >= MAX_LEVEL) return { leveled: false, level: store.level };
  store.xp += Math.max(0, Math.round(n));
  let leveled = false;
  while (store.level < MAX_LEVEL && store.xp >= xpForLevel(store.level)) {
    store.xp -= xpForLevel(store.level);
    store.level++;
    leveled = true;
  }
  if (store.level >= MAX_LEVEL) store.xp = 0;
  if (leveled) checkChallenges();
  save();
  return { leveled, level: store.level };
}
// Bump a lifetime stat; returns newly unlocked { titles, emblems }.
export function bumpStat(key, n = 1) {
  if (store.stats[key] == null) return { titles: [], emblems: [] };
  store.stats[key] += n;
  const r = checkChallenges();
  save();
  return r;
}
export function getStats() { return { ...store.stats }; }
// Directly raise bestStreak (called from onKill for the local player).
export function setBestStreak(n) {
  if (n > store.stats.bestStreak) {
    store.stats.bestStreak = n;
    const r = checkChallenges();
    save();
    return r;
  }
  return { titles: [], emblems: [] };
}

// ---------------- TITLES (all original names) ----------------
export const TITLES = [
  { id: 'rookie',       name: 'Rookie',        challenge: 'Awarded on enlistment',            test: () => true },
  { id: 'firstblood',   name: 'First Blood',   challenge: 'Score 1 kill',                     test: s => s.kills >= 1 },
  { id: 'sharpshooter', name: 'Sharpshooter',  challenge: '25 headshots',                     test: s => s.headshots >= 25 },
  { id: 'gunfighter',   name: 'Gunfighter',    challenge: '100 kills',                        test: s => s.kills >= 100 },
  { id: 'warmachine',   name: 'War Machine',   challenge: '500 kills',                        test: s => s.kills >= 500 },
  { id: 'streaker',     name: 'Streaker',      challenge: 'A 5-kill streak',                  test: s => s.bestStreak >= 5 },
  { id: 'unstoppable',  name: 'Unstoppable',   challenge: 'A 10-kill streak',                 test: s => s.bestStreak >= 10 },
  { id: 'taghound',     name: 'Tag Hound',     challenge: '25 tag confirms',                  test: s => s.confirms >= 25 },
  { id: 'gatekeeper',   name: 'Gatekeeper',    challenge: '25 tag denies',                    test: s => s.denies >= 25 },
  { id: 'sapper',       name: 'Sapper',        challenge: 'Plant the bomb 10 times',          test: s => s.plants >= 10 },
  { id: 'bombwarden',   name: 'Bomb Warden',   challenge: 'Defuse the bomb 10 times',         test: s => s.defuses >= 10 },
  { id: 'flagrunner',   name: 'Flag Runner',   challenge: 'Capture the flag 10 times',        test: s => s.captures >= 10 },
  { id: 'lastline',     name: 'Last Line',     challenge: 'Return your flag 10 times',        test: s => s.returns >= 10 },
  { id: 'victor',       name: 'Victor',        challenge: 'Win 10 matches',                   test: s => s.wins >= 10 },
  { id: 'campaigner',   name: 'Campaigner',    challenge: 'Play 25 matches',                  test: s => s.matches >= 25 },
  { id: 'veteran',      name: 'Veteran',       challenge: 'Play 100 matches',                 test: s => s.matches >= 100 },
  { id: 'strikeace',    name: 'Strike Ace',    challenge: 'Reach level 30',                   test: (s, lvl) => lvl >= 30 },
  { id: 'legend',       name: 'Living Legend', challenge: 'Reach level 50',                   test: (s, lvl) => lvl >= 50 },
];
export const titleById = id => TITLES.find(t => t.id === id) || TITLES[0];

// ---------------- EMBLEMS (original procedural SVG) ----------------
let _uid = 0;
const svgOpen = (size, label) => `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-label="${label}" class="emblem-svg">`;
function emblemDefs() {
  return [
    { id: 'chevron', name: 'Chevron', challenge: 'Awarded on enlistment', test: () => true,
      svg: s => `${svgOpen(s, 'Chevron')}<path d="M8 14 L24 26 L40 14 L40 22 L24 34 L8 22 Z" fill="#8fa3b8"/><path d="M8 26 L24 38 L40 26 L40 32 L24 44 L8 32 Z" fill="#4da3ff"/></svg>` },
    { id: 'ironstar', name: 'Iron Star', challenge: '10 kills', test: st => st.kills >= 10,
      svg: s => `${svgOpen(s, 'Iron Star')}<polygon points="24,6 28.5,18.5 41,18.5 31,26.5 34.5,39 24,31.5 13.5,39 17,26.5 7,18.5 19.5,18.5" fill="#c8ccd4" stroke="#5a6270" stroke-width="2"/></svg>` },
    { id: 'bolt', name: 'Live Wire', challenge: '5 headshots', test: st => st.headshots >= 5,
      svg: s => `${svgOpen(s, 'Live Wire')}<polygon points="28,4 12,28 22,28 18,44 36,20 25,20" fill="#ffd24a" stroke="#8a6500" stroke-width="1.5"/></svg>` },
    { id: 'aegis', name: 'Aegis', challenge: 'Win 5 matches', test: st => st.wins >= 5,
      svg: s => `${svgOpen(s, 'Aegis')}<path d="M24 4 L40 12 V26 C40 36 32 42 24 44 C16 42 8 36 8 26 V12 Z" fill="#2e6fd8" stroke="#9fc4ff" stroke-width="2"/><path d="M24 12 L32 16 V26 C32 31 28 35 24 36 C20 35 16 31 16 26 V16 Z" fill="#0e1622"/></svg>` },
    { id: 'reaper', name: 'Reaper', challenge: '100 kills', test: st => st.kills >= 100,
      svg: s => `${svgOpen(s, 'Reaper')}<rect x="12" y="10" width="24" height="22" rx="9" fill="#dfe3ea"/><rect x="17" y="18" width="5" height="7" fill="#14161a"/><rect x="26" y="18" width="5" height="7" fill="#14161a"/><polygon points="24,26 21,31 27,31" fill="#14161a"/><rect x="17" y="34" width="14" height="6" fill="#dfe3ea"/><rect x="19" y="34" width="2" height="6" fill="#14161a"/><rect x="23" y="34" width="2" height="6" fill="#14161a"/><rect x="27" y="34" width="2" height="6" fill="#14161a"/></svg>` },
    { id: 'crosshair', name: 'Dead Center', challenge: '25 headshots', test: st => st.headshots >= 25,
      svg: s => `${svgOpen(s, 'Dead Center')}<circle cx="24" cy="24" r="14" fill="none" stroke="#ff5a4d" stroke-width="3"/><circle cx="24" cy="24" r="4" fill="#ff5a4d"/><path d="M24 4 V14 M24 34 V44 M4 24 H14 M34 24 H44" stroke="#ff5a4d" stroke-width="3"/></svg>` },
    { id: 'talon', name: 'Talon', challenge: '10 tag confirms', test: st => st.confirms >= 10,
      svg: s => `${svgOpen(s, 'Talon')}<polygon points="6,36 24,6 26,30" fill="#8fa3b8"/><polygon points="14,38 30,12 30,34" fill="#4da3ff"/><polygon points="24,40 38,18 36,36" fill="#c8ccd4"/></svg>` },
    { id: 'crown', name: 'Warlord', challenge: 'Win 25 matches', test: st => st.wins >= 25,
      svg: s => `${svgOpen(s, 'Warlord')}<polygon points="8,36 8,18 16,26 24,10 32,26 40,18 40,36" fill="#f5b301" stroke="#8a6500" stroke-width="1.5"/><rect x="8" y="36" width="32" height="5" fill="#8a6500"/><circle cx="24" cy="28" r="3" fill="#a3121f"/></svg>` },
    { id: 'nova', name: 'Nova', challenge: 'A 10-kill streak', test: st => st.bestStreak >= 10,
      svg: s => { const id = 'nv' + (_uid++); return `${svgOpen(s, 'Nova')}<defs><radialGradient id="${id}"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#ffb300"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient></defs><circle cx="24" cy="24" r="20" fill="url(#${id})"/><circle cx="24" cy="24" r="6" fill="#fff2c0"/></svg>`; } },
    { id: 'ghost', name: 'Ghost', challenge: '10 bomb defuses', test: st => st.defuses >= 10,
      svg: s => `${svgOpen(s, 'Ghost')}<path d="M12 42 V22 C12 12 18 8 24 8 C30 8 36 12 36 22 V42 L31 37 L27 42 L23 37 L19 42 L15 37 Z" fill="#cfe0ee" opacity="0.92"/><circle cx="19" cy="22" r="2.6" fill="#14161a"/><circle cx="29" cy="22" r="2.6" fill="#14161a"/></svg>` },
    { id: 'viper', name: 'Viper', challenge: '50 kills', test: st => st.kills >= 50,
      svg: s => `${svgOpen(s, 'Viper')}<polygon points="6,30 16,14 24,26 32,10 42,30 36,32 32,22 24,34 16,22 12,32" fill="#37c871" stroke="#0d5c2f" stroke-width="1.5"/></svg>` },
    { id: 'eclipse', name: 'Eclipse', challenge: 'Reach level 25', test: (st, lvl) => lvl >= 25,
      svg: s => `${svgOpen(s, 'Eclipse')}<circle cx="24" cy="24" r="16" fill="#0e1622" stroke="#8fa3b8" stroke-width="2"/><circle cx="30" cy="19" r="12" fill="#4da3ff" opacity="0.85"/></svg>` },
    { id: 'aurum', name: 'Aurum', challenge: 'Reach level 50', test: (st, lvl) => lvl >= 50,
      svg: s => { const id = 'au' + (_uid++); return `${svgOpen(s, 'Aurum')}<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".5" stop-color="#f5b301"/><stop offset="1" stop-color="#b97e00"/></linearGradient></defs><path d="M6 16 L24 28 L42 16 L42 24 L24 36 L6 24 Z" fill="url(#${id})"/><path d="M6 28 L24 40 L42 28 L42 34 L24 46 L6 34 Z" fill="url(#${id})" opacity="0.75"/></svg>`; } },
  ];
}
const _emblems = emblemDefs();
export const EMBLEMS = _emblems;
export const emblemById = id => _emblems.find(e => e.id === id) || _emblems[0];

// ---------------- BANNERS (procedural CSS gradients) ----------------
export const BANNERS = [
  { id: 'midnight', name: 'Midnight Ops',  unlock: 'Default',            test: () => true,        css: 'linear-gradient(135deg,#0e1622 0%,#1b2b45 55%,#0e1622 100%)' },
  { id: 'crimson',  name: 'Crimson',       unlock: 'Reach level 5',      test: (s, l) => l >= 5,  css: 'linear-gradient(135deg,#2a0d12 0%,#a3121f 55%,#2a0d12 100%)' },
  { id: 'desert',   name: 'Desert Storm',  unlock: 'Reach level 10',     test: (s, l) => l >= 10, css: 'linear-gradient(135deg,#3a2c14 0%,#c2a878 55%,#3a2c14 100%)' },
  { id: 'arctic',   name: 'Arctic',        unlock: 'Reach level 15',     test: (s, l) => l >= 15, css: 'linear-gradient(135deg,#0f2233 0%,#9fc4e8 55%,#0f2233 100%)' },
  { id: 'toxic',    name: 'Toxic',         unlock: 'Reach level 20',     test: (s, l) => l >= 20, css: 'linear-gradient(135deg,#0d2413 0%,#37c871 55%,#0d2413 100%)' },
  { id: 'royal',    name: 'Royal',         unlock: 'Reach level 30',     test: (s, l) => l >= 30, css: 'linear-gradient(135deg,#1c0f33 0%,#7a4de0 55%,#1c0f33 100%)' },
  { id: 'ember',    name: 'Ember',         unlock: 'Reach level 40',     test: (s, l) => l >= 40, css: 'linear-gradient(135deg,#2a1206 0%,#ff7a1f 55%,#2a1206 100%)' },
  { id: 'aurum',    name: 'Aurum Foil',    unlock: 'Reach level 50',     test: (s, l) => l >= 50, css: 'linear-gradient(135deg,#3a2c05 0%,#f5b301 45%,#ffe9a3 55%,#f5b301 65%,#3a2c05 100%)' },
];
export const bannerById = id => BANNERS.find(b => b.id === id) || BANNERS[0];

// Scan challenges; unlock anything earned. Returns { titles, emblems } newly unlocked.
export function checkChallenges() {
  const out = { titles: [], emblems: [] };
  for (const t of TITLES) {
    if (!store.unlockedTitles.includes(t.id) && t.test(store.stats, store.level)) {
      store.unlockedTitles.push(t.id); out.titles.push(t);
    }
  }
  for (const e of EMBLEMS) {
    if (!store.unlockedEmblems.includes(e.id) && e.test(store.stats, store.level)) {
      store.unlockedEmblems.push(e.id); out.emblems.push(e);
    }
  }
  if (out.titles.length || out.emblems.length) save();
  return out;
}
export function getUnlockedTitles() { return store.unlockedTitles.slice(); }
export function getUnlockedEmblems() { return store.unlockedEmblems.slice(); }
export function setCardSelection({ banner, emblem, title }) {
  if (banner && BANNERS.some(b => b.id === banner)) store.banner = banner;
  if (emblem && store.unlockedEmblems.includes(emblem)) store.emblem = emblem;
  if (title && store.unlockedTitles.includes(title)) store.title = title;
  save();
}
export function getCardSelection() { return { banner: store.banner, emblem: store.emblem, title: store.title }; }

// ---------------- PLAYER CARD ----------------
// card = { name, clanTag, devTag, level, title, emblem, banner }
export function buildPlayerCard() {
  const t = titleById(store.title);
  return {
    name: identity.name || 'YOU', clanTag: identity.clanTag || '', devTag: isDevUnlocked(),
    level: store.level, title: t.name, titleId: t.id,
    emblem: store.emblem, banner: store.banner,
  };
}
// Flavor card for bots (random unlocked-for-flavor title/emblem/banner).
export function botCard(name, level) {
  const t = TITLES[(name.length * 7 + level) % TITLES.length];
  const e = EMBLEMS[(name.length * 3 + level * 5) % EMBLEMS.length];
  const b = BANNERS[(level + name.length) % BANNERS.length];
  return { name, clanTag: '', devTag: false, level, title: t.name, titleId: t.id, emblem: e.id, banner: b.id };
}
export function randomBotCard() {
  const name = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0];
  return botCard(name, 4 + ((Math.random() * 47) | 0));
}

function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

// Shared card component. size: 'full' (menu), 'mini' (scoreboard/VS/killcam rows).
export function cardHTML(card, size = 'mini') {
  const banner = bannerById(card.banner);
  const embSVG = card.devTag ? devEmblemSVG(size === 'full' ? 64 : 20) : emblemById(card.emblem).svg(size === 'full' ? 64 : 20);
  const tag = card.devTag
    ? `<span class="dev-tag">[DEV]</span>`
    : card.clanTag ? `<span class="clan-tag">[${esc(card.clanTag)}]</span>` : '';
  const nameCls = card.devTag ? 'dev-name' : '';
  return `<div class="pcard pcard-${size}" style="background:${banner.css}">` +
    `<div class="pcard-emblem">${embSVG}</div>` +
    `<div class="pcard-info">` +
    `<div class="pcard-title">${esc(card.title || '')}</div>` +
    `<div class="pcard-name ${nameCls}">${tag}${esc(card.name)}<span class="pcard-level">LVL ${card.level || 1}</span></div>` +
    `</div></div>`;
}
// Compact emblem+title for scoreboard rows.
export function rowCardHTML(card) {
  const emb = card.devTag ? devEmblemSVG(15) : emblemById(card.emblem).svg(15);
  return `<span class="sb-emblem">${emb}</span><span class="sb-title">${esc(card.title || '')}</span>`;
}
