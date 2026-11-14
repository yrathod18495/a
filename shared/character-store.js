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

/* ---- poses (views) ----
   A character can be free, sold as a whole (`store`), or free with some paid poses (`viewStore: { <view>: { price, enabled } }`). A pose can be used when it is free,
   or the whole character is bought, or that pose is bought. Whole-character access is stored under the character's id, a pose's under `<id>~<view>`. */
export const accessKey = (characterId, viewId = null) => (viewId ? `${characterId}~${viewId}` : characterId);
/** the price record of one pose, or null */
export const viewStoreOf = (character, viewId) => (Number(character?.viewStore?.[viewId]?.price) > 0 ? character.viewStore[viewId] : null);
/** anything to buy on this character (the whole of it or a pose) */
export const hasStore = (character) => isPaid(character) || Object.keys(character?.viewStore || {}).some((v) => viewStoreOf(character, v));
/** the poses of a character: { viewId: { price, enabled } }, each price a whole number of Coins; unknown poses are dropped; null = every pose is free */
export function cleanViewStore(input, viewIds) {
  if (input == null || input === false) return null;
  if (typeof input !== 'object') throw Object.assign(new Error('The pose prices are not valid.'), { code: 'invalid_price', status: 400 });
  const out = {};
  for (const [id, v] of Object.entries(input)) { if (!viewIds.includes(id) || v == null) continue; out[id] = cleanStore(v); }
  return Object.keys(out).length ? out : null;
}
/** may this account use this pose now? `owned` = Map of access records by key (see accessKey) */
export function viewUsable(character, viewId, owned, now) {
  if (isActive(owned.get(accessKey(character.id)), now)) return true;                           // the whole character was bought
  const own = viewStoreOf(character, viewId);
  if (own) return isActive(owned.get(accessKey(character.id, viewId)), now);
  return !isPaid(character);                                                                     // free pose of a free character
}
/** is this pose (or the whole character, `viewId` null) offered for sale right now? */
export const onSale = (character, viewId = null) => (viewId ? viewStoreOf(character, viewId)?.enabled !== false && !!viewStoreOf(character, viewId) : isPaid(character) && character.store.enabled !== false);

/** the files of one pose of a character, and of the category's animations for that pose */
export function viewFiles(view) {
  const out = [], add = (r) => { if (r && refSha(r)) out.push(r); };
  add(view?.skeleton); add(view?.thumb);
  for (const t of view?.textures || []) { add(t.json); add(t.page); }
  for (const g of Object.values(view?.gifs || {})) add(g);
  return out;
}
export function categoryViewFiles(categoryView) {
  const out = [];
  for (const a of categoryView?.animations || []) for (const r of [a.file, a.gif]) if (r && refSha(r)) out.push(r);
  return out;
}
/** the pictures anybody may see of one pose before buying */
export function viewPreviewFiles(view) {
  const out = [];
  if (view?.thumb && refSha(view.thumb)) out.push(view.thumb);
  for (const g of Object.values(view?.gifs || {})) if (g && refSha(g)) out.push(g);
  return out;
}
/** a pose as a locked card sees it: label, thumbnail, previews and its price */
export const lockedPose = (view, extra = {}) => ({ label: view.label, ...(view.thumb ? { thumb: view.thumb } : {}), ...(view.gifs ? { gifs: view.gifs } : {}), ...(view.previewType ? { previewType: view.previewType } : {}), locked: true, ...extra });

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
