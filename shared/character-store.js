// The Character Store: an admin can sell a character for Coins. A purchase gives the buyer the character for 30 days, counted on the SERVER clock
// (30 × 24 hours exactly, whatever the length of the month; never the phone's clock). Used by the server (server/character-store.js,
// server/characters-api.js), the store page (src/character-store.js) and the admin screen (src/admin-characters.js).
import { refSha } from './character-package.js';

export const STORE_DAYS = 30;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
export const STORE_MS = STORE_DAYS * DAY;                 // 30 days = 720 hours, never "one calendar month"
export const MAX_STACK_MS = 3 * STORE_MS;                 // buying again while it is still active adds 30 days, but never more than 90 days ahead
export const MAX_PRICE = 100000;

/** the price record of a character: { price: Coins (1…100000), enabled: on sale or not }; null = free for everyone. Throws a plain-English error for a bad price. */
export function cleanStore(input) {
  if (input == null || input === false) return null;
  const price = Math.floor(Number(input?.price));
  if (!input || typeof input !== 'object' || !Number.isFinite(price) || price < 1 || price > MAX_PRICE) {
    throw Object.assign(new Error(`The price must be a whole number of Coins from 1 to ${MAX_PRICE.toLocaleString('en-IN')}.`), { code: 'invalid_price', status: 400 });
  }
  return { price, enabled: input.enabled !== false };
}
/** a character that must be bought */
export const isPaid = (character) => Number(character?.store?.price) > 0;
/** is this access record (a purchase) still running at `now` (server time, ms)? */
export const isActive = (access, now) => Number(access?.expiresAt) > now;
/** the end of a purchase made at `now`: 30 days from now, or 30 days after the current end when it is still running (never more than 90 days ahead) */
export function nextExpiry(now, currentExpiresAt = 0) {
  const from = Number(currentExpiresAt) > now ? Number(currentExpiresAt) : now;
  return Math.min(from + STORE_MS, now + MAX_STACK_MS);
}
/** milliseconds left (never negative) */
export const timeLeft = (expiresAt, now) => Math.max(0, Number(expiresAt || 0) - now);
/** "23 days left" (a part of a day counts as a day, so a purchase made now reads "30 days left"), "1 day 5 h left", "5 h left", "12 min left", "Ended" */
export function leftText(ms) {
  if (!(ms > 0)) return 'Ended';
  if (ms >= 2 * DAY) return `${Math.ceil(ms / DAY)} days left`;
  if (ms >= DAY) return `1 day ${Math.floor((ms - DAY) / HOUR)} h left`;
  const hours = Math.floor(ms / HOUR);
  if (hours >= 1) return `${hours} h left`;
  return `${Math.max(1, Math.ceil(ms / 60000))} min left`;
}

/** the pictures anybody may see before buying: the thumbnails and the animation previews (never the rig, the texture pages or the animation files) */
export function previewRefs(character) {
  const out = [], add = (r) => { if (r && refSha(r)) out.push(r); };
  add(character?.thumb);
  for (const v of Object.values(character?.views || {})) { add(v.thumb); for (const g of Object.values(v.gifs || {})) add(g); }
  return out;
}
/** what a person who has not bought the character gets to see: name, group, price, pictures and previews, and `locked: true` */
export function lockedView(character, categoryName = '') {
  const { owner, ...c } = character;
  const views = {};
  for (const [id, v] of Object.entries(c.views || {})) views[id] = { label: v.label, ...(v.thumb ? { thumb: v.thumb } : {}), ...(v.gifs ? { gifs: v.gifs } : {}), ...(v.previewType ? { previewType: v.previewType } : {}) };
  return { ...c, views, locked: true, categoryName, animations: {} };
}
