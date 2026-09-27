// Graphics quality: resolution scale + anti-aliasing. Stored on the shared
// settings key (sv_settings_v1) as `quality`. Applied by Engine at match
// start so toggling AA (which needs a fresh WebGL context) never interrupts
// a live match.
const SET_KEY = 'sv_settings_v1';

export const QUALITY_LEVELS = {
  low:    { pr: 0.66, aa: false, label: 'LOW' },
  medium: { pr: 1,    aa: true,  label: 'MEDIUM' },
  high:   { pr: 2,    aa: true,  label: 'HIGH' },
};

export function getQuality() {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
    if (s && QUALITY_LEVELS[s.quality]) return s.quality;
  } catch (e) {}
  return 'medium';
}

// Effective pixel ratio for a quality level (high respects devicePixelRatio).
export function qualityPixelRatio(q) {
  const lvl = QUALITY_LEVELS[q] || QUALITY_LEVELS.medium;
  return Math.min(lvl.pr, window.devicePixelRatio || 1);
}

export function qualityAA(q) {
  const lvl = QUALITY_LEVELS[q] || QUALITY_LEVELS.medium;
  return lvl.aa;
}
