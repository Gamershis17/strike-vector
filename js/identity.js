// ================= PLAYER IDENTITY: name, clan tag, dev tag =================
// Profile: display name, 2-4 char clan tag, dev-unlock flag. Persists in localStorage.
//
// NOTE ON THE DEV CODE (honest assessment, please read):
// This is a client-side-only browser game with no server. The "secret" dev code
// is therefore obfuscation, not real security: anyone who reads this file can
// extract the SHA-256 hash and brute-force the short code offline, or simply
// flip `devUnlocked` in localStorage. That is acceptable here because the dev
// tag unlocks only cosmetic flair (badge styling, a skin, an emblem) — nothing
// gameplay-relevant — and there is no server to enforce anything against.
// Storing only the hash (never the plaintext code) keeps it out of casual
// view / screenshots. Do not rely on this pattern for anything that matters.
const IDENT_KEY = 'sv_identity_v1';
export let identity = { name: 'YOU', clanTag: '', devUnlocked: false, playerId: null };
try { Object.assign(identity, JSON.parse(localStorage.getItem(IDENT_KEY) || '{}')); } catch (e) {}
// PHASE 2 (P2P PvP) HOOK: stable player id. Mute lists, report tickets, and lobby
// rosters must key off this — never off the display name, which the player can
// change at will. Generated once, persisted, never shown in normal UI.
if (!identity.playerId) {
  identity.playerId = (crypto.randomUUID ? crypto.randomUUID() : 'sv-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36));
}
export function saveIdentity() { try { localStorage.setItem(IDENT_KEY, JSON.stringify(identity)); } catch (e) {} }
saveIdentity();

// SHA-256 hex of the dev unlock code. The plaintext code is NOT stored anywhere
// in this repository; it was generated once and handed to the user privately.
// The code-entry UI is deliberately hidden (no menu button; secret gesture only)
// so normal players never see dev access exists — but note this is still just
// obscurity: the hash lives in this client file and there is no server to
// enforce anything against. See the longer note on tryUnlockDev below.
const DEV_CODE_HASH = 'e3f56ab6b4f86a4632c60a46c0931210fede844218e1a2354551d68e84fa95e9';

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str.trim().toUpperCase()));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Attempt a dev-code unlock. Returns true on success.
export async function tryUnlockDev(code) {
  try {
    const h = await sha256hex(code);
    // compare in a way that doesn't short-circuit on first mismatch
    if (h.length !== DEV_CODE_HASH.length) return false;
    let diff = 0;
    for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ DEV_CODE_HASH.charCodeAt(i);
    if (diff === 0) {
      identity.devUnlocked = true;
      saveIdentity();
      return true;
    }
  } catch (e) {}
  return false;
}
export function isDevUnlocked() { return !!identity.devUnlocked || isOwnerName(); }

// Owner recognition: when the saved profile name matches the owner's handle
// (case-insensitive), dev unlocks automatically — no code entry needed. This is
// checked live rather than persisted, so renaming away removes the grant; the
// hidden code entry remains as a second path. The handle is intentionally never
// surfaced in UI text — recognition just silently works.
// (Deliberately weak, like the dev code itself: dev unlocks cosmetic flair only,
// and anyone can type any display name. That's the owner's explicit choice.)
const OWNER_HANDLE = 'gamershis17';
function isOwnerName() {
  return String(identity.name || '').trim().toLowerCase() === OWNER_HANDLE;
}

export function setPlayerName(name) {
  const n = String(name || '').trim().slice(0, 16);
  if (!n) return { ok: false, error: 'Name cannot be empty.' };
  identity.name = n;
  saveIdentity();
  return { ok: true };
}

// Reserved tags: staff-impersonation protection (case-insensitive; we store uppercase).
const RESERVED_TAGS = new Set([
  'DEV', 'ADMIN', 'MOD', 'MODS', 'OWNER', 'STAFF', 'SYS', 'SYSTEM',
  'BOT', 'BOTS', 'SERVER', 'OFFICIAL', 'SUP', 'SUPPORT', 'GM',
]);
// Basic profanity blocklist for tags. Exact or substring match, case-insensitive.
// Kept short and obvious; this is a client-side courtesy filter, not moderation.
const PROFANE_TAGS = [
  'FUCK', 'SHIT', 'BITCH', 'CUNT', 'DICK', 'PUSSY', 'NIGG', 'FAGG', 'FAG',
  'KYS', 'KKK', 'NAZI', 'HITLER', 'PORN', 'SEX', 'XXX',
];

// 2-4 chars, letters/digits only, stored uppercase. Empty string clears it.
export function setClanTag(tag) {
  const t = String(tag || '').trim().toUpperCase();
  if (!t) { identity.clanTag = ''; saveIdentity(); return { ok: true }; }
  if (!/^[A-Z0-9]{2,4}$/.test(t)) return { ok: false, error: 'Tag must be 2–4 letters or numbers.' };
  if (RESERVED_TAGS.has(t)) return { ok: false, error: `"${t}" is reserved — pick another tag.` };
  if (PROFANE_TAGS.some(p => t.includes(p))) return { ok: false, error: 'That tag is not allowed — pick another.' };
  identity.clanTag = t;
  saveIdentity();
  return { ok: true };
}

function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

// HTML nameplate for killfeed / scoreboard / player card / killcam.
// Bots never show tags. Dev badge takes precedence over a clan tag.
export function nameplate(c, withEmblem = false) {
  const name = esc(c.name);
  if (c.isBot) return name;
  if (c.devTag) return `<span class="dev-tag">[DEV]</span>${withEmblem ? devEmblemSVG(18) : ''} <span class="dev-name">${name}</span>`;
  if (c.clanTag) return `<span class="clan-tag">[${esc(c.clanTag)}]</span>${name}`;
  return name;
}

// Plain-text variant for non-HTML contexts (e.g. canvas).
export function plainTagName(c) {
  if (c.isBot) return c.name;
  if (c.devTag) return `[DEV]${c.name}`;
  if (c.clanTag) return `[${c.clanTag}]${c.name}`;
  return c.name;
}

// Copy the player's current identity onto a combatant (called for the local player).
// Carries the stable playerId so phase-2 mute/report systems can key off combatants.
export function applyIdentityTo(c) {
  c.name = identity.name || 'YOU';
  c.clanTag = identity.clanTag || '';
  c.devTag = isDevUnlocked();
  c.playerId = identity.playerId;
}

// Exclusive dev emblem: original procedural gold badge (inline SVG, zero assets).
export function devEmblemSVG(size = 28) {
  return `<svg class="dev-emblem" width="${size}" height="${size}" viewBox="0 0 32 32" aria-label="Developer emblem">` +
    `<defs><linearGradient id="dvg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#ffe9a3"/><stop offset=".5" stop-color="#f5b301"/><stop offset="1" stop-color="#b97e00"/>` +
    `</linearGradient></defs>` +
    `<polygon points="16,2 28,9 28,21 16,30 4,21 4,9" fill="url(#dvg)" stroke="#fff2c0" stroke-width="1.5"/>` +
    `<polygon points="16,8 20.5,13.5 19,21 13,21 11.5,13.5" fill="#1a1405"/>` +
    `<circle cx="16" cy="15" r="2.2" fill="url(#dvg)"/></svg>`;
}
