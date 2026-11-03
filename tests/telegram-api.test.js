import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'111:TOKEN',TELEGRAM_CHAT_ID:'-1009',TELEGRAM_WEBHOOK_SECRET:'secret_secret_secret_1234'});
const db=memoryFirestore();
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db})}});
const {default:webhook}=await import('../api/telegram.js');
const user='telegram_user_1234567890',sentToTelegram=[];
globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.telegram.org/'))sentToTelegram.push(JSON.parse(init.body));return {ok:true,status:200};};
db.data.set('supportChats/'+user,{uid:user,email:'rahul@example.com',displayName:'Rahul',lastMessage:'Help',lastSender:'user',unreadAdmin:true});
async function call(body,{secret='secret_secret_secret_1234',method='POST'}={}){const res=response();await webhook({method,headers:secret===null?{}:{'x-telegram-bot-api-secret-token':secret},body},res);return res;}
const reply=(text,over={})=>({message:{message_id:50,chat:{id:-1009},from:{id:7,is_bot:false},text,reply_to_message:{message_id:49,from:{is_bot:true},text:`Hi\nchat:${user}`},...over}});
const messages=()=>[...db.data.entries()].filter(([k])=>k.startsWith('supportChats/'+user+'/messages/')).map(([,v])=>v);

test('only Telegram, with the right secret, can use the webhook',async()=>{
 assert.equal((await call(reply('x'),{secret:null})).statusCode,401);
 assert.equal((await call(reply('x'),{secret:'wrong'})).statusCode,401);
 assert.equal((await call(reply('x'),{method:'GET'})).statusCode,405);
 assert.equal(messages().length,0);
 const saved=process.env.TELEGRAM_WEBHOOK_SECRET;delete process.env.TELEGRAM_WEBHOOK_SECRET;
 assert.equal((await call(reply('x'))).statusCode,503);process.env.TELEGRAM_WEBHOOK_SECRET=saved;      // not set up: refused, never open to everyone
});
test('a Reply in the owner\'s Telegram chat becomes the admin reply in that user\'s live chat, and the owner gets a confirmation',async()=>{
 const r=await call(reply('Hi Rahul, we are checking this.'));
 assert.equal(r.statusCode,200);
 assert.deepEqual(messages().map(m=>[m.sender,m.message]),[['admin','Hi Rahul, we are checking this.']]);
 const chat=db.data.get('supportChats/'+user);
 assert.equal(chat.unreadUser,true);assert.equal(chat.lastSender,'admin');assert.equal(chat.lastMessage,'Hi Rahul, we are checking this.');assert.equal(chat.unreadAdmin,false);
 const confirm=sentToTelegram.at(-1);
 assert.equal(confirm.chat_id,'-1009');assert.equal(confirm.reply_to_message_id,50);assert.match(confirm.text,/✅ Sent to Rahul/);
});
test('messages from other chats or from bots are ignored, and a Reply to something that is not a live-chat message says nothing wrong',async()=>{
 const before=messages().length,sent=sentToTelegram.length;
 assert.equal((await call(reply('x',{chat:{id:-5}}))).statusCode,200);
 assert.equal((await call(reply('x',{from:{id:1,is_bot:true}}))).statusCode,200);
 assert.equal((await call({edited_message:{text:'x'}})).statusCode,200);assert.equal((await call({})).statusCode,200);
 assert.equal(messages().length,before);assert.equal(sentToTelegram.length,sent);
 await call(reply('hello',{reply_to_message:undefined}));                                              // plain message: a hint on how to reply
 assert.match(sentToTelegram.at(-1).text,/use <b>Reply<\/b>/);assert.equal(messages().length,before);
 await call(reply('hello',{reply_to_message:{message_id:3,from:{is_bot:true},text:'a project notification, no chat tag'}}));
 assert.equal(messages().length,before);
});
test('a text that cannot be sent is explained: empty (a photo), too long, or a chat that no longer exists',async()=>{
 const before=messages().length;
 await call(reply(undefined,{text:undefined,photo:[{}]}));assert.match(sentToTelegram.at(-1).text,/Only text replies/);
 await call(reply('x'.repeat(2001)));assert.match(sentToTelegram.at(-1).text,/too long/);
 await call(reply('hi',{reply_to_message:{message_id:3,from:{is_bot:true},text:'Hi\nchat:gone_user_1234567890'}}));assert.match(sentToTelegram.at(-1).text,/no longer exists/);
 assert.equal(messages().length,before);
});
test('the answer always reaches the user it was meant for, even if the user typed another chat id in their message',async()=>{
 const before=messages().length;
 await call(reply('Answer',{reply_to_message:{message_id:49,from:{is_bot:true},text:`Hi chat:victim_user_1234567890 sneaky\n\nReply to this message to answer.\nchat:${user}`}}));
 assert.equal(messages().length,before+1);assert.equal(messages().at(-1).message,'Answer');
 assert.equal(db.data.has('supportChats/victim_user_1234567890'),false);
});
