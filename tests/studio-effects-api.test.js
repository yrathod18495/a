import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
import { memoryRtdb } from './fake-rtdb.js';

process.env.MAINTENANCE_MODE = 'false';
const rtdb = memoryRtdb(), db = memoryFirestore(), admin = 'effects_admin_123456', visitor = 'effects_visitor_123456', objects = new Map();
let current = admin;
for (const uid of [admin, visitor]) { db.data.set('securityUsers/' + uid, { status: 'active' }); db.data.set('securitySessions/' + uid, { sid: 'ok', expiresAt: Date.now() + 100000, revoked: false }); }
db.data.set('securityAdmins/' + admin, { enabled: true });
mock.module('../server/firebase-admin.js', {namedExports: { services: () => ({ db, rtdb, auth: { verifyIdToken: async () => ({ uid: current, email_verified: true, sid: 'ok' }) } }) } });
mock.module('../server/r2-storage.js', {namedExports: { configured: () => true, assetKey: (uid, hash) => `u/${uid}/a/${hash}`, deleteKey: async () => {}, signDownloads: async () => ({}), readAssetText: async (_, hash) => String(objects.get('assets/' + hash)), confirmAssets: async (_, __, items) => { for (const it of items) { const o = objects.get('assets/' + it.hash); if (!o || o.length !== it.size) { const e = Error('The upload did not finish.'); e.status = 409; e.code = 'incomplete_upload'; throw e; } } return { added: items.length }; } } });
const { default: handler } = await import('../api/studio-assets.js');
async function call(body, as = admin) { current = as; const res = response(); await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body }, res); return res; }
const key = 'assets/' + 'b'.repeat(64);
objects.set(key, Buffer.from('png-bytes'));
const base = { action: 'save', id: 'effect_rain_123456', type: 'effect', name: 'Rain', key, size: 9, mime: 'image/webp' };

test('only admins publish effects, and their settings are validated on the server', async () => {
  assert.equal((await call(base, visitor)).statusCode, 403);
  assert.equal((await call({ ...base, blend: 'sparkle' })).statusCode, 400);
  assert.equal((await call({ ...base, sheet: { cols: 1, rows: 1, fps: 8 } })).statusCode, 400);
  assert.equal((await call({ ...base, thumb: 'data:text/html;base64,AAAA' })).statusCode, 400);
  const saved = await call({ ...base, blend: 'screen', opacity: 0.7, category: 'Weather', sheet: { cols: 4, rows: 4, fps: 12 }, thumb: 'data:image/webp;base64,AAAA' });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual([saved.body.asset.type, saved.body.asset.blend, saved.body.asset.opacity, saved.body.asset.category], ['effect', 'screen', 0.7, 'Weather']);
  assert.deepEqual(saved.body.asset.sheet, { cols: 4, rows: 4, fps: 12 });
});
test('every signed-in user sees published effects and props with their thumbnails, newest list after a change', async () => {
  const prop = await call({ ...base, id: 'prop_chair_1234567', type: 'prop', name: 'Chair', category: 'Furniture', thumb: 'data:image/webp;base64,BBBB' });
  assert.equal(prop.statusCode, 200); assert.equal(prop.body.asset.blend, undefined);
  const list = await call({ action: 'list' }, visitor);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.assets.map((a) => [a.type, a.name]).sort(), [['effect', 'Rain'], ['prop', 'Chair']]);
  assert.equal(list.body.assets.find((a) => a.type === 'prop').thumb, 'data:image/webp;base64,BBBB');
  assert.equal((await call({ action: 'delete', id: 'effect_rain_123456' })).statusCode, 200);
  assert.deepEqual((await call({ action: 'list' }, visitor)).body.assets.map((a) => a.name), ['Chair']);
  assert.equal((await call({ action: 'delete', id: 'prop_chair_1234567' }, visitor)).statusCode, 403);
});

test('an admin marks a prop as a hand prop after uploading it, and can change it back; visitors cannot', async () => {
  const id = 'prop_cup_1234567';
  assert.equal((await call({ ...base, id, type: 'prop', name: 'Cup', category: 'Kitchen' })).body.asset.group, undefined);
  assert.equal((await call({ action: 'update', id, group: 'hand' }, visitor)).statusCode, 403);
  assert.equal((await call({ action: 'update', id, group: 'foot' })).statusCode, 400);
  const hand = await call({ action: 'update', id, group: 'hand' });
  assert.equal(hand.statusCode, 200); assert.equal(hand.body.asset.group, 'hand'); assert.equal(hand.body.asset.category, 'Kitchen');
  assert.equal((await call({ action: 'list' }, visitor)).body.assets.find((a) => a.id === id).group, 'hand');
  const back = await call({ action: 'update', id, group: 'general' });
  assert.equal(back.body.asset.group, undefined);
  assert.equal((await call({ action: 'list' }, visitor)).body.assets.find((a) => a.id === id).group, undefined);
  assert.equal((await call({ action: 'update', id: 'effect_rain_123456', group: 'hand' })).statusCode, 404);
  const published = await call({ ...base, id: 'prop_hammer_123456', type: 'prop', name: 'Hammer', group: 'hand' });
  assert.equal(published.body.asset.group, 'hand');
});

test('library items are for paid accounts by default; an admin can mark single items free; everybody sees the list but a free account cannot download a paid-only file',async()=>{
  const id='prop_paid_only_12345',freeId='prop_free_for_all_123';
  // the visitor account: a normal free user
  const free='free_visitor_123456789';
  db.data.set('securityUsers/'+free,{status:'active'});db.data.set('securitySessions/'+free,{sid:'ok',expiresAt:Date.now()+100000,revoked:false});
  const paid='paid_visitor_123456789';
  db.data.set('securityUsers/'+paid,{status:'active'});db.data.set('securitySessions/'+paid,{sid:'ok',expiresAt:Date.now()+100000,revoked:false});
  db.data.set('entitlements/'+paid,{tier:'paid',source:'purchase'});db.data.set('entitlements/'+free,{tier:'free',source:'default'});
  const asCurrent=async(uid,body)=>{ current=uid; const res=response(); await handler({method:'POST',headers:{authorization:'Bearer test'},body},res); return res; };
  assert.equal((await call({...base,id,type:'prop',name:'Crown',thumb:'data:image/webp;base64,AAAA'})).body.asset.access,undefined);          // default: nothing stored = paid only
  assert.equal((await call({...base,id:freeId,type:'prop',name:'Stick',access:'free'})).body.asset.access,'free');                            // marked free when uploaded
  assert.equal((await call({...base,id:'prop_bad_access_12345',type:'prop',name:'x',access:'everyone'})).statusCode,400);
  // everybody sees both items, with their pictures
  const list=await asCurrent(free,{action:'list'});
  assert.deepEqual(list.body.assets.filter(a=>[id,freeId].includes(a.id)).map(a=>[a.id,a.access??'paid']).sort(),[[freeId,'free'],[id,'paid']]);
  assert.equal(list.body.assets.find(a=>a.id===id).thumb,'data:image/webp;base64,AAAA');
  // downloading: free account -> only the free item; paid account and admin -> both
  const denied=await asCurrent(free,{action:'get',id});assert.equal(denied.statusCode,403);assert.equal(denied.body.code,'paid_only');assert.match(denied.body.error,/paid accounts/);
  assert.equal((await asCurrent(free,{action:'get',id:freeId})).statusCode,200);
  assert.equal((await asCurrent(paid,{action:'get',id})).statusCode,200);
  assert.equal((await asCurrent(admin,{action:'get',id})).statusCode,200);
  // the admin changes it later
  assert.equal((await asCurrent(free,{action:'update',id,access:'free'})).statusCode,403);                                                     // a normal account cannot
  assert.equal((await asCurrent(admin,{action:'update',id,access:'free'})).body.asset.access,'free');
  assert.equal((await asCurrent(free,{action:'get',id})).statusCode,200);
  assert.equal((await asCurrent(admin,{action:'update',id,access:'paid'})).body.asset.access,undefined);
  assert.equal((await asCurrent(free,{action:'get',id})).statusCode,403);
  assert.equal((await asCurrent(admin,{action:'update',id,access:'maybe'})).statusCode,400);
  assert.equal((await asCurrent(admin,{action:'update',id})).statusCode,400);
  assert.equal((await asCurrent(admin,{action:'update',id,group:'hand'})).body.asset.group,'hand');                                            // the prop type still works, and keeps the access
  assert.equal(db.data.has('x'),false);
  assert.equal((await asCurrent(admin,{action:'get',id})).statusCode,200);
});
