import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'111:TOKEN',TELEGRAM_CHAT_ID:'-1009',TELEGRAM_WEBHOOK_SECRET:'secret_secret_secret_1234'});
const db=memoryFirestore();
mock.module('../server/firebase-admin.js',{namedExports:{services:()=>({db})}});
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
 assert.equal(String(confirm.chat_id),'-1009');assert.equal(confirm.reply_to_message_id,50);assert.match(confirm.text,/✅ Sent to Rahul/);
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

test('/status and /start tell the owner the webhook works; a stranger or a wrong chat id in the settings is told its own chat id, and nothing else',async()=>{
 const before=messages().length;
 await call(reply('/status',{reply_to_message:undefined}));
 assert.match(sentToTelegram.at(-1).text,/✅ The webhook works/);assert.match(sentToTelegram.at(-1).text,/<code>-1009<\/code>/);assert.equal(sentToTelegram.at(-1).chat_id,-1009);
 await call(reply('/start',{reply_to_message:undefined}));assert.match(sentToTelegram.at(-1).text,/webhook works/);
 // another chat (for example the settings hold a different chat id): it is told the id of ITS OWN chat, never the configured one
 const sent=sentToTelegram.length;
 await call(reply('/status',{chat:{id:555777},reply_to_message:undefined}));
 const stranger=sentToTelegram.at(-1);assert.equal(stranger.chat_id,555777);assert.match(stranger.text,/not allowed/);assert.match(stranger.text,/<code>555777<\/code>/);assert.doesNotMatch(stranger.text,/1009/);
 await call(reply('hello',{chat:{id:555777},reply_to_message:undefined}));assert.equal(sentToTelegram.length,sent+1);   // anything else from a stranger: no answer
 assert.equal(messages().length,before);
});
test('a Reply that carries no live-chat tag is explained instead of being ignored silently',async()=>{
 const before=messages().length;
 await call(reply('hi',{reply_to_message:{message_id:3,from:{is_bot:true},text:'a project notification, no chat tag'}}));
 assert.match(sentToTelegram.at(-1).text,/could not tell which user/);assert.equal(messages().length,before);
});
test('a space or line break pasted after the chat id in the settings does not break the match',async()=>{
 const saved=process.env.TELEGRAM_CHAT_ID,savedSecret=process.env.TELEGRAM_WEBHOOK_SECRET;
 process.env.TELEGRAM_CHAT_ID=' -1009\n';process.env.TELEGRAM_WEBHOOK_SECRET='secret_secret_secret_1234 ';
 try{
  const before=messages().length;
  assert.equal((await call(reply('Works with a space'))).statusCode,200);
  assert.equal(messages().length,before+1);assert.equal(messages().at(-1).message,'Works with a space');
 }finally{process.env.TELEGRAM_CHAT_ID=saved;process.env.TELEGRAM_WEBHOOK_SECRET=savedSecret;}
});

test('several people can answer: a Reply from any listed chat reaches the user, and the others are told who answered',async()=>{
 const saved=process.env.TELEGRAM_CHAT_ID;process.env.TELEGRAM_CHAT_ID='-1009, 4242 ,5151';
 try{
  const before=messages().length,sent=sentToTelegram.length;
  // the second person answers from their own chat
  const answer=reply('This is Priya from support.',{chat:{id:4242},from:{id:8,is_bot:false,first_name:'Priya',username:'priya_s'}});
  assert.equal((await call(answer)).statusCode,200);
  assert.equal(messages().length,before+1);assert.equal(messages().at(-1).message,'This is Priya from support.');
  const out=sentToTelegram.slice(sent);
  const toPriya=out.find(m=>String(m.chat_id)==='4242'),toOthers=out.filter(m=>['-1009','5151'].includes(String(m.chat_id)));
  assert.match(toPriya.text,/✅ Sent to Rahul/);                                             // the confirmation goes to the one who answered
  assert.equal(toOthers.length,2);for(const m of toOthers){assert.match(m.text,/↩️ Priya @priya_s answered Rahul/);assert.match(m.text,/This is Priya from support/);assert.equal(m.reply_to_message_id,undefined);}
  // the first chat still works
  assert.equal((await call(reply('And me too.'))).statusCode,200);assert.equal(messages().at(-1).message,'And me too.');
  // a chat that is not in the list is still refused
  const refused=messages().length;await call(reply('Let me in',{chat:{id:9999}}));assert.equal(messages().length,refused);
 }finally{process.env.TELEGRAM_CHAT_ID=saved;}
});
