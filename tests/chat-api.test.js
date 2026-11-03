import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),tokens=new Map();
const auth={verifyIdToken:async token=>{if(!tokens.has(token))throw Error('invalid');return tokens.get(token);},getUserByEmail:async email=>{const found=[...tokens.values()].find(t=>t.email===email);if(!found)throw Error('not found');return {uid:found.uid,email:found.email,displayName:'Found '+found.uid.slice(0,4)};}};
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

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const person=(name)=>{const uid=('chat_'+name+'_'.repeat(20)).slice(0,24);return {uid,token:session(uid,name+'-session')};};
const settle=()=>new Promise(r=>setTimeout(r,4));
test('paid accounts are marked premium in the inbox',async()=>{
  const a=person('paid'),f=person('free');
  await call(a.token,{action:'send',message:'I paid and need help'});await call(f.token,{action:'send',message:'Free user here'});
  db.data.set(`entitlements/${a.uid}`,{tier:'paid',source:'purchase'});db.data.set(`entitlements/${f.uid}`,{tier:'free',source:'default'});
  assert.equal((await call(a.token,{action:'adminList'})).statusCode,403);
  const rows=Object.fromEntries((await call(adminToken,{action:'adminList'})).body.chats.map(c=>[c.id,c.premium]));
  assert.equal(rows[a.uid],true);assert.equal(rows[f.uid],false);
  // an account with no record yet is worked out once (credits mean it paid) and remembered
  const late=person('late');await call(late.token,{action:'send',message:'hello'});db.data.set(`workspaces/${late.uid}`,{credits:500});
  assert.equal((await call(adminToken,{action:'adminList'})).body.chats.find(c=>c.id===late.uid).premium,true);assert.equal(db.data.get(`entitlements/${late.uid}`).tier,'paid');
});
test('the admin sees when a reply was read, and the chat opens the right way round',async()=>{
  const u=person('reader');await call(u.token,{action:'send',message:'Question'});
  await settle();const reply=await call(adminToken,{action:'adminReply',uid:u.uid,message:'Answer'});
  let view=await call(adminToken,{action:'adminMessages',uid:u.uid});
  assert.equal(view.body.userSeenAt<reply.body.message.createdAt,true);                    // not read yet: one tick
  assert.equal((await call(adminToken,{action:'adminList'})).body.chats.find(c=>c.id===u.uid).unreadAdmin,false);   // the admin opened it
  await call(u.token,{action:'messages'});                                                 // the user opens the chat
  view=await call(adminToken,{action:'adminMessages',uid:u.uid});
  assert.equal(view.body.userSeenAt>=reply.body.message.createdAt,true);                   // read: two ticks
});
test('an admin can edit and delete their own replies, and the user sees the change',async()=>{
  const u=person('editor');await call(u.token,{action:'send',message:'Need help'});
  await settle();await call(adminToken,{action:'adminReply',uid:u.uid,message:'Frist reply'});
  await settle();await call(adminToken,{action:'adminReply',uid:u.uid,message:'Second reply'});
  const all=(await call(u.token,{action:'messages'})).body,ids=Object.fromEntries(all.messages.map(m=>[m.message,m.id])),last=Math.max(...all.messages.map(m=>m.createdAt));
  const edit=(messageId,message,token=adminToken)=>call(token,{action:'adminEditMessage',uid:u.uid,messageId,message});
  assert.equal((await edit(ids['Frist reply'],'First reply',u.token)).statusCode,403);                        // not an admin
  assert.equal((await edit(ids['Need help'],'Changed')).statusCode,403);                                        // a user's words are never altered
  assert.equal((await edit(ids['Frist reply'],'   ')).statusCode,400);assert.equal((await edit('bad id','x')).statusCode,400);assert.equal((await edit('missing12345','x')).statusCode,404);
  assert.equal((await edit(ids['Second reply'],'Second reply, fixed')).body.edited,true);
  assert.equal(db.data.get(`supportChats/${u.uid}`).lastMessage,'Second reply, fixed');                      // the inbox preview follows the newest message
  // the user's browser had everything up to `last`; a changed revision makes the server send the whole chat again
  const refresh=await call(u.token,{action:'messages',since:last,revision:all.revision});
  assert.equal(refresh.body.incremental,false);assert.deepEqual(refresh.body.messages.map(m=>m.message),['Need help','Frist reply','Second reply, fixed']);
  assert.equal(refresh.body.messages.at(-1).editedAt>0,true);
  const quiet=await call(u.token,{action:'messages',since:last,revision:refresh.body.revision});assert.equal(quiet.body.incremental,true);assert.deepEqual(quiet.body.messages,[]);
  // deleting the newest reply moves the preview back to the one before it
  assert.equal((await call(adminToken,{action:'adminDeleteMessage',uid:u.uid,messageId:ids['Need help']})).statusCode,403);
  assert.equal((await call(adminToken,{action:'adminDeleteMessage',uid:u.uid,messageId:ids['Second reply']})).body.deleted,true);
  assert.equal(db.data.get(`supportChats/${u.uid}`).lastMessage,'Frist reply');
  assert.deepEqual((await call(u.token,{action:'messages',since:last,revision:refresh.body.revision})).body.messages.map(m=>m.message),['Need help','Frist reply']);
});
test('an admin can send a small picture, and only a real small picture',async()=>{
  const u=person('picture');await call(u.token,{action:'send',message:'See my problem'});
  const reply=(body)=>call(adminToken,{action:'adminReply',uid:u.uid,...body});
  assert.equal((await reply({})).statusCode,400);                                                              // nothing to send
  assert.equal((await reply({image:'data:text/html;base64,PHNjcmlwdD4='})).body.code,'invalid_image');
  assert.equal((await reply({image:'https://example.com/a.png'})).body.code,'invalid_image');
  assert.equal((await reply({image:'data:image/png;base64,'+'A'.repeat(150000)})).body.code,'invalid_image');   // too big
  await new Promise(r=>setTimeout(r,850));                                                                    // the chat allows one user message per 0.8 s
  assert.equal((await call(u.token,{action:'send',message:'x',image:PNG})).statusCode,200);                    // users cannot attach: the field is ignored
  assert.equal([...db.data].filter(([k,v])=>k.startsWith(`supportChats/${u.uid}/messages/`)&&v.image).length,0);
  const ok=await reply({image:PNG});assert.equal(ok.statusCode,200);assert.equal(ok.body.message.image,PNG);assert.equal(ok.body.message.message,'');
  assert.equal(db.data.get(`supportChats/${u.uid}`).lastMessage,'📷 Photo');
  const withText=await reply({message:'This screen',image:PNG});assert.equal(withText.body.message.message,'This screen');
  assert.equal((await call(u.token,{action:'messages'})).body.messages.filter(m=>m.image).length,2);
});
test('an admin can start a conversation with an account, and delete conversations',async()=>{
  const t=person('target'),spare=person('spare'),other=person('other');
  assert.equal((await call(t.token,{action:'adminNewChat',email:'x@example.test'})).statusCode,403);
  assert.equal((await call(adminToken,{action:'adminNewChat',email:'not an email'})).body.code,'invalid_email');
  assert.equal((await call(adminToken,{action:'adminNewChat',email:'nobody@example.test'})).body.code,'user_not_found');
  const started=await call(adminToken,{action:'adminNewChat',email:t.uid+'@example.test'});
  assert.equal(started.statusCode,200);assert.equal(started.body.existing,false);assert.equal(started.body.chat.id,t.uid);
  assert.equal((await call(adminToken,{action:'adminNewChat',email:t.uid+'@example.test'})).body.existing,true);     // never a second conversation
  assert.equal((await call(adminToken,{action:'adminReply',uid:t.uid,message:'Hello, how can we help?'})).statusCode,200);
  assert.deepEqual((await call(t.token,{action:'messages'})).body.messages.map(m=>m.message),['Hello, how can we help?']);
  // delete: admin only, 1 to 50 valid ids; messages go with the conversation
  await call(spare.token,{action:'send',message:'one'});await call(spare.token,{action:'send',message:'two'});
  assert.equal((await call(t.token,{action:'adminDeleteChats',uids:[spare.uid]})).statusCode,403);
  assert.equal((await call(adminToken,{action:'adminDeleteChats',uids:[]})).statusCode,400);assert.equal((await call(adminToken,{action:'adminDeleteChats',uids:['bad']})).statusCode,400);
  const gone=await call(adminToken,{action:'adminDeleteChats',uids:[spare.uid,t.uid,other.uid]});
  assert.equal(gone.body.deleted,2);                                                                              // `other` never had a chat
  assert.equal(db.data.has(`supportChats/${spare.uid}`),false);assert.equal([...db.data.keys()].some(k=>k.startsWith(`supportChats/${spare.uid}/messages/`)),false);
  assert.equal((await call(adminToken,{action:'adminMessages',uid:spare.uid})).statusCode,404);
  assert.deepEqual((await call(spare.token,{action:'messages'})).body.messages,[]);                                // the user just sees an empty chat
});

test('a live-chat message is also sent to the owner on Telegram, with the chat to answer; if Telegram is down the chat still works',async()=>{
  const toTelegram=[],realFetch=globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN='111:TOKEN';process.env.TELEGRAM_CHAT_ID='-1009';
  globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.telegram.org/'))toTelegram.push(JSON.parse(init.body));return {ok:true,status:200};};
  try{
    db.data.set(`securityUsers/${user}`,{status:'active'});
    await new Promise(r=>setTimeout(r,900));                                                        // the chat's own 0.8 s limit between messages
    const sent=await call(userToken,{action:'send',message:'My export fails'});
    assert.equal(sent.statusCode,200);
    assert.equal(toTelegram.length,1);assert.equal(toTelegram[0].chat_id,'-1009');
    assert.match(toTelegram[0].text,/My export fails/);assert.match(toTelegram[0].text,new RegExp('chat:'+user));assert.match(toTelegram[0].text,/Free/);
    db.data.set(`entitlements/${user}`,{tier:'paid'});
    await new Promise(r=>setTimeout(r,900));
    await call(userToken,{action:'send',message:'Second one'});
    assert.match(toTelegram.at(-1).text,/Paid/);
    globalThis.fetch=async()=>{throw new Error('offline');};
    await new Promise(r=>setTimeout(r,900));
    assert.equal((await call(userToken,{action:'send',message:'Still works'})).statusCode,200);
  }finally{globalThis.fetch=realFetch;delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;}
});
