import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),tokens=new Map(),uid='reload_user_12345678901';
const auth={verifyIdToken:async token=>{if(!tokens.has(token))throw Error('bad token');return tokens.get(token);},createCustomToken:async(u,claims)=>JSON.stringify({uid:u,...claims}),setCustomUserClaims:async()=>{}};
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth})}});
const {default:security}=await import('../api/security.js');
tokens.set('g',{uid,email:uid+'@gmail.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}});
const acquire={action:'acquire',deviceId:'device_reload_123456',secret:'secret_reload_123456'};
async function call(body){const res=response();await security({method:'POST',headers:{authorization:'Bearer g'},body},res);return res;}
const writes=()=>[...db.data.keys()].length+JSON.stringify([...db.data.values()]).length;

test('a new login writes the session, the account, the device and one event; reloading the page on the same browser writes nothing',async()=>{
 assert.equal((await call(acquire)).statusCode,200);
 const events=()=>[...db.data.keys()].filter(k=>k.startsWith('securityEvents/')).length;
 assert.equal(events(),1);
 const before=writes(),first=JSON.parse(JSON.stringify(db.data.get('securitySessions/'+uid)));
 for(let i=0;i<5;i++){const again=await call(acquire);assert.equal(again.statusCode,200);assert.equal(JSON.parse(again.body.token).sid,first.sid);}
 assert.equal(events(),1);assert.equal(writes(),before);                                   // five reloads, no write at all
 assert.equal(writes(),before);                                                            // sessions never expire, so there is nothing to renew
 assert.equal(events(),1);
 assert.equal((await call({...acquire,secret:'secret_other_1234567'})).statusCode,409);      // another browser is still refused
});
