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
 // another browser logs in: it is let in, and the first browser's session is replaced (and signalled)
 const signalBefore=JSON.stringify(db.data.get('sessionSignals/'+uid));
 const other=await call({...acquire,deviceId:'device_other_1234567',secret:'secret_other_1234567'});
 assert.equal(other.statusCode,200);
 const newSid=JSON.parse(other.body.token).sid;
 assert.notEqual(newSid,first.sid);
 assert.equal(db.data.get('securitySessions/'+uid).sid,newSid);
 assert.equal(db.data.get('sessionSignals/'+uid).sid,newSid);assert.notEqual(JSON.stringify(db.data.get('sessionSignals/'+uid)),signalBefore);
 assert.equal(Object.keys(db.data.get('sessionSignals/'+uid)).sort().join(),'at,sid');        // nothing secret in the signal
});

test('the very first sign-in of an account tells the owner on Telegram, once; later sign-ins and reloads say nothing',async()=>{
 const toTelegram=[],real=globalThis.fetch;
 process.env.TELEGRAM_BOT_TOKEN='111:TOKEN';process.env.TELEGRAM_CHAT_ID='-1009';
 globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.telegram.org/'))toTelegram.push(JSON.parse(init.body));return {ok:true,status:200};};
 try{
  const fresh='brand_new_user_1234567890';
  tokens.set('n',{uid:fresh,name:'Asha Verma',email:'asha@example.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}});
  const first=response();await security({method:'POST',headers:{authorization:'Bearer n'},body:{action:'acquire',deviceId:'device_new_user_123456',secret:'secret_new_user_123456'}},first);
  assert.equal(first.statusCode,200);
  assert.equal(toTelegram.length,1);assert.match(toTelegram[0].text,/New sign-up/);assert.match(toTelegram[0].text,/Asha Verma/);assert.match(toTelegram[0].text,/asha@example\.com/);
  // reload (same browser) and a login from another browser: not a sign-up any more
  for(const secret of ['secret_new_user_123456','secret_new_user_123456','secret_other_browser_1']){
   const again=response();await security({method:'POST',headers:{authorization:'Bearer n'},body:{action:'acquire',deviceId:'device_new_user_123456',secret}},again);assert.equal(again.statusCode,200);
  }
  assert.equal(toTelegram.length,1);
  // Telegram down: the sign-in still works
  tokens.set('m',{uid:'another_new_user_1234567',name:'B',email:'b@example.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}});
  globalThis.fetch=async()=>{throw new Error('offline');};
  const ok=response();await security({method:'POST',headers:{authorization:'Bearer m'},body:{action:'acquire',deviceId:'device_second_123456',secret:'secret_second_123456'}},ok);assert.equal(ok.statusCode,200);
 }finally{globalThis.fetch=real;delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;}
});
