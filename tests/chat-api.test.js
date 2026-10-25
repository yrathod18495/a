import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),tokens=new Map();
const auth={verifyIdToken:async token=>{if(!tokens.has(token))throw Error('invalid');return tokens.get(token);}};
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth})}});
const {default:chat}=await import('../api/chat.js');
const user='chat_user_12345678901',admin='chat_admin_1234567890';
function session(uid,sid){
  db.data.set(`securitySessions/${uid}`,{sid,expiresAt:Date.now()+120000,revoked:false});
  const token=uid+'-token';tokens.set(token,{uid,sid,email:uid+'@example.test',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}});return token;
}
const userToken=session(user,'user-session'),adminToken=session(admin,'admin-session');
db.data.set(`securityAdmins/${admin}`,{enabled:true});
async function call(token,body){const res=response();await chat({method:'POST',headers:{authorization:'Bearer '+token},body},res);return res;}
test('live chat is private to its user and admins can read and reply',async()=>{
  const sent=await call(userToken,{action:'send',message:'Could I get help?'});
  assert.equal(sent.statusCode,200);assert.equal(sent.body.message.sender,'user');
  assert.equal((await call(userToken,{action:'adminList'})).statusCode,403);
  assert.equal((await call(userToken,{action:'adminMessages',uid:user})).statusCode,403);
  assert.equal((await call(userToken,{action:'messages',uid:admin})).statusCode,200);
  const inbox=await call(adminToken,{action:'adminList'});
  assert.equal(inbox.statusCode,200);assert.equal(inbox.body.chats[0].id,user);assert.equal(inbox.body.chats[0].unreadAdmin,true);
  const reply=await call(adminToken,{action:'adminReply',uid:user,message:'Yes, we can help.'});
  assert.equal(reply.statusCode,200);assert.equal(reply.body.message.sender,'admin');
  assert.equal(db.data.get('supportChats/'+user).unreadUser,true);
  const history=await call(userToken,{action:'messages'});
  assert.deepEqual(history.body.messages.map(m=>m.message),['Could I get help?','Yes, we can help.']);
  assert.equal(history.body.unreadUser,true);
  assert.equal(history.body.messages[1].sender,'admin');
  assert.equal(db.data.get('supportChats/'+user).unreadUser,false);
  assert.equal((await call(userToken,{action:'send',message:'   '})).statusCode,400);
  assert.equal((await call(adminToken,{action:'adminReply',uid:'missing_user_123456',message:'reply'})).statusCode,404);
});
test('after the first load the chat only returns messages newer than the last one the browser has',async()=>{
  const first=await call(userToken,{action:'messages'});
  const last=Math.max(...first.body.messages.map(m=>m.createdAt));
  const quiet=await call(userToken,{action:'messages',since:last});
  assert.equal(quiet.statusCode,200);assert.equal(quiet.body.incremental,true);assert.deepEqual(quiet.body.messages,[]);
  await new Promise(r=>setTimeout(r,5));
  await call(adminToken,{action:'adminReply',uid:user,message:'One more thing.'});
  const fresh=await call(userToken,{action:'messages',since:last});
  assert.deepEqual(fresh.body.messages.map(m=>m.message),['One more thing.']);
  assert.equal((await call(adminToken,{action:'adminMessages',uid:user,since:last})).body.messages.length,1);
  assert.equal((await call(userToken,{action:'messages'})).body.incremental,false);                    // no since: the whole conversation again
});
