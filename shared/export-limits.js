// How long one exported video may be. Used by the server (api/export.js, the source of truth) and by the studio (to explain the limit).
// One export = every scene joined together, or a single scene: both are measured as the finished video's length.
export const EXPORT_LIMIT_SECONDS = Object.freeze({ free: 2 * 60, paid: 10 * 60 });
export const TIERS = Object.freeze(['free', 'paid']);
const TOLERANCE = 0.05;   // timelines are rounded to hundredths; never refuse a video for float noise

export const normalizeTier = (tier) => (tier === 'paid' ? 'paid' : 'free');
export const limitFor = (tier) => EXPORT_LIMIT_SECONDS[normalizeTier(tier)];
export const withinLimit = (seconds, tier) => Number.isFinite(+seconds) && +seconds > 0 && +seconds <= limitFor(tier) + TOLERANCE;
export function fmtLimit(seconds) {
  const s = Math.round(+seconds || 0), m = Math.floor(s / 60), r = s % 60;
  return m ? (r ? `${m} min ${r} s` : `${m} min`) : `${r} s`;
}
export function limitMessage(seconds, tier) {
  const paid = normalizeTier(tier) === 'paid', limit = limitFor(tier);
  const over = `Aapka video ${fmtLimit(seconds)} lamba hai, lekin ${paid ? 'paid' : 'free'} account se ek baar me sirf ${fmtLimit(limit)} tak ka video export ho sakta hai.`;
  return paid ? `${over} Video chhota karein ya use hisso me export karein.` : `${over} Video chhota karein, ya credits kharidkar ${fmtLimit(EXPORT_LIMIT_SECONDS.paid)} tak export karein.`;
}
