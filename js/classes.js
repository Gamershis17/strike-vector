import { WEAPONS, ATTACHMENTS, PERKS, LETHALS, TACTICALS, computeStats, weaponById } from './weapons.js';
import { equippedCamo } from './camos.js';

const CLASS_KEY = 'sv_classes_v1';
const STREAK_KEY = 'sv_streaks_v1';

function defaultSlot(name, primary, secondary, perks, lethal, tactical) {
  return {
    name, primary: { weapon: primary, attachments: { optic: 'none', barrel: 'none', grip: 'none', mag: 'none' } },
    secondary: { weapon: secondary, attachments: { optic: 'none', barrel: 'none', grip: 'none', mag: 'none' } },
    perks: perks.slice(0, 3), lethal, tactical,
  };
}
export const PRESETS = [
  defaultSlot('Assault Preset', 'vk7', 'p9', ['fasthands', 'scavenger', 'dexterity'], 'frag', 'flash'),
  defaultSlot('Rusher Preset', 'hornet', 'p9', ['lightweight', 'fasthands', 'dexterity'], 'frag', 'stun'),
  defaultSlot('Marksman Preset', 'longshot', 'handcannon', ['coldblooded', 'scavenger', 'dexterity'], 'semtex', 'smoke'),
  defaultSlot('Support Preset', 'bulwark', 'p9', ['flakjacket', 'scavenger', 'fasthands'], 'frag', 'flash'),
];

function freshSlots() {
  return [
    defaultSlot('Custom 1', 'vk7', 'p9', ['fasthands', 'scavenger', 'dexterity'], 'frag', 'flash'),
    defaultSlot('Custom 2', 'hornet', 'p9', ['lightweight', 'fasthands', 'dexterity'], 'frag', 'stun'),
    defaultSlot('Custom 3', 'reaver', 'handcannon', ['coldblooded', 'scavenger', 'flakjacket'], 'semtex', 'smoke'),
    defaultSlot('Custom 4', 'longshot', 'p9', ['coldblooded', 'dexterity', 'fasthands'], 'frag', 'flash'),
    defaultSlot('Custom 5', 'bulwark', 'handcannon', ['flakjacket', 'scavenger', 'lightweight'], 'frag', 'stun'),
  ];
}

let slots = null, activeSlot = 0;
try {
  const raw = JSON.parse(localStorage.getItem(CLASS_KEY) || 'null');
  if (raw && Array.isArray(raw.slots) && raw.slots.length === 5) { slots = raw.slots; activeSlot = raw.activeSlot | 0; }
} catch (e) {}
if (!slots) slots = freshSlots();

export function getSlots() { return slots; }
export function getActiveSlot() { return activeSlot; }
export function setActiveSlot(i) { activeSlot = i; save(); }
export function getActiveClass() { return slots[activeSlot]; }
export function resetSlot(i) { slots[i] = freshSlots()[i]; save(); }
export function save() {
  try { localStorage.setItem(CLASS_KEY, JSON.stringify({ slots, activeSlot })); } catch (e) {}
}

// Resolved loadout used by the game: computed weapon stats + camos + equipment
export function resolveLoadout(slot = getActiveClass()) {
  const p = weaponById(slot.primary.weapon), s = weaponById(slot.secondary.weapon);
  return {
    name: slot.name,
    primary: { stats: computeStats(p.id, slot.primary.attachments, slot.perks), camo: equippedCamo(p.id) },
    secondary: { stats: computeStats(s.id, slot.secondary.attachments, slot.perks), camo: equippedCamo(s.id) },
    perks: slot.perks.slice(),
    lethal: slot.lethal, tactical: slot.tactical,
  };
}
// Random preset-ish loadout for bots
export function randomBotLoadout() {
  const primaries = ['vk7', 'reaver', 'hornet', 'wasp', 'bulwark'];
  const p = primaries[Math.floor(Math.random() * primaries.length)];
  const perkPool = ['fasthands', 'scavenger', 'lightweight', 'dexterity', 'flakjacket'];
  const perks = [];
  while (perks.length < 3) { const q = perkPool[Math.floor(Math.random() * perkPool.length)]; if (!perks.includes(q)) perks.push(q); }
  return {
    name: 'Bot',
    primary: { stats: computeStats(p, {}, perks), camo: 'default' },
    secondary: { stats: computeStats('p9', {}, perks), camo: 'default' },
    perks, lethal: 'frag', tactical: 'flash',
  };
}

// ---------- streak loadout ----------
let streakLoadout = null;
try { streakLoadout = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null'); } catch (e) {}
if (!streakLoadout || !Array.isArray(streakLoadout.slots)) streakLoadout = { type: 'kill', slots: ['uav', 'airstrike', 'sentry'] };

export function getStreakLoadout() { return { type: streakLoadout.type, slots: streakLoadout.slots.slice() }; }
export function setStreakLoadout(type, slotsArr) {
  streakLoadout = { type, slots: slotsArr.slice(0, 3) };
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(streakLoadout)); } catch (e) {}
}
