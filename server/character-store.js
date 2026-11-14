// Character Store purchases (server only). A buyer pays Coins and gets the character for 30 days, counted on the server clock.
//   workspaces/{uid}/characterAccess/{characterId}   what this account may use now: { characterId, name, price, purchasedAt, expiresAt, source }
//   characterSales/{uid}_{opId}                      one row per purchase or admin grant (the admin's sales list; also makes a double tap safe)
//   workspaces/{uid}/creditLedger/…                  the Coins spent (shows in the Coin history)
// None of these paths is readable by the browser (firebase/firestore.rules has no rule for them), so only this code reads and writes them.
import { AccessError } from './security-policy.js';
import { STORE_MS, isPaid, isActive, nextExpiry, accessKey, viewStoreOf } from '../shared/character-store.js';

const bad = (code, message, status = 400) => new AccessError(code, message, status);
export const validOpId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
const accessPath = (uid) => `workspaces/${uid}/characterAccess`;

/** every access record of an account: Map characterId -> { expiresAt, … } (expired ones included, so the store can offer "Renew") */
export async function accessOf(db, uid) {
  const snap = await db.collection(accessPath(uid)).get();
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

/** what is being bought: the whole character (`viewId` null) or one pose; returns { item: {price, enabled}, label } or throws */
function itemOf(character, viewId) {
  if (viewId) {
    const view = character?.views?.[viewId], item = viewStoreOf(character, viewId);
    if (!view || !item) throw bad('not_for_sale', 'This pose is not for sale right now.', 409);
    return { item, label: view.label || viewId };
  }
  if (!isPaid(character)) throw bad('not_for_sale', 'This character is not for sale right now.', 409);
  return { item: character.store, label: '' };
}
/** the purchase: Coins are taken, the access is set and the sale is written in ONE transaction. The same `opId` twice charges once. */
export async function buyCharacter({ db, character, viewId = null, uid, email = '', name = '', price, opId, now = Date.now() }) {
  if (!validOpId(opId)) throw bad('invalid_request', 'This purchase request is not valid. Please reload the page and try again.');
  if (!character || character.enabled === false) throw bad('not_for_sale', 'This character is not for sale right now.', 409);
  const { item, label } = itemOf(character, viewId);
  if (item.enabled === false) throw bad('not_for_sale', viewId ? 'This pose is not for sale right now.' : 'This character is not for sale right now.', 409);
  if (Number(price) !== item.price) throw bad('price_changed', 'The price has changed. Please check the new price and try again.', 409);
  const cost = item.price, key = accessKey(character.id, viewId), title = label ? `${character.name} · ${label}` : character.name;
  const wsRef = db.doc(`workspaces/${uid}`), accessRef = db.doc(`${accessPath(uid)}/${key}`), saleRef = db.doc(`characterSales/${uid}_${opId}`);
  const ledgerRef = db.collection(`workspaces/${uid}/creditLedger`).doc();
  return db.runTransaction(async (tx) => {
    const [workspace, current, sale] = await tx.getAll(wsRef, accessRef, saleRef);
    const balance = Number(workspace.data()?.credits || 0);
    if (sale.exists) { const s = sale.data(); return { ok: true, repeated: true, balance, expiresAt: s.expiresAt, serverNow: now, characterId: character.id, viewId }; }
    if (!Number.isSafeInteger(balance) || balance < cost) throw bad('not_enough_coins', `You need ${cost.toLocaleString('en-IN')} Coins for this. Your balance is ${Math.max(0, balance || 0).toLocaleString('en-IN')} Coins.`, 402);
    const expiresAt = nextExpiry(now, current.data()?.expiresAt), left = balance - cost;
    tx.set(wsRef, { credits: left }, { merge: true });
    tx.set(accessRef, { characterId: character.id, ...(viewId ? { viewId } : {}), name: character.name, price: cost, purchasedAt: now, expiresAt, source: 'coins' });
    tx.create(saleRef, { uid, email: String(email).slice(0, 254), userName: String(name).slice(0, 120), characterId: character.id, characterName: character.name, ...(viewId ? { viewId, viewLabel: label } : {}), price: cost, purchasedAt: now, expiresAt, source: 'coins', opId });
    tx.create(ledgerRef, { delta: -cost, balance: left, reason: `Character: ${title} (30 days)`, kind: 'store_purchase', by: 'user', at: now });
    return { ok: true, repeated: false, balance: left, expiresAt, serverNow: now, characterId: character.id, viewId, extended: Number(current.data()?.expiresAt) > now };
  });
}

/** an admin gives 30 days of a paid character (or one paid pose) to an account (no Coins are taken) */
export async function grantCharacter({ db, character, viewId = null, uid, email = '', name = '', by, now = Date.now() }) {
  if (!character) throw bad('not_found', 'This character does not exist any more.', 404);
  const label = viewId ? (character.views?.[viewId]?.label || viewId) : '';
  if (viewId ? !viewStoreOf(character, viewId) : !isPaid(character)) throw bad('not_paid', viewId ? 'This pose is free for everyone, so there is nothing to give.' : 'This character is free for everyone, so there is nothing to give.', 409);
  const accessRef = db.doc(`${accessPath(uid)}/${accessKey(character.id, viewId)}`), saleRef = db.doc(`characterSales/${uid}_grant${now}`);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(accessRef);
    const expiresAt = nextExpiry(now, current.data()?.expiresAt);
    tx.set(accessRef, { characterId: character.id, ...(viewId ? { viewId } : {}), name: character.name, price: 0, purchasedAt: now, expiresAt, source: 'admin' });
    tx.create(saleRef, { uid, email: String(email).slice(0, 254), userName: String(name).slice(0, 120), characterId: character.id, characterName: character.name, ...(viewId ? { viewId, viewLabel: label } : {}), price: 0, purchasedAt: now, expiresAt, source: 'admin', by });
    return { ok: true, expiresAt, serverNow: now };
  });
}

/** the newest sales and gifts, newest first */
export async function recentSales(db, limit = 100) {
  const snap = await db.collection('characterSales').orderBy('purchasedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b.purchasedAt) - Number(a.purchasedAt)).slice(0, limit);
}
export { STORE_MS, isActive };
