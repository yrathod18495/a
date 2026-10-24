import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/firebase.js',import.meta.url),'utf8');
function fixture(status='none') {
 const calls=[],states=[],storage=new Map(),auth={currentUser:null};let listener;
 const google={uid:'tester',getIdTokenResult:async()=>({claims:{}})};
 const session={stopSession(){},apiCall:async(url,b)=>{calls.push(b.action);if(b.action==='testerStatus')return {status};if(b.action==='testerApply'){status='pending';return {status};}},acquireSession:async scope=>{calls.push('acquire:'+scope);return {token:'secure'};},validateSession:async()=>{calls.push('validate');}};
 const sandbox={auth,session,initializeApp:()=>({}),getAuth:()=>auth,initializeFirestore:()=>({}),GoogleAuthProvider:class{setCustomParameters(){}},onAuthStateChanged:(a,fn)=>{listener=fn;return ()=>{};},signInWithCustomToken:async()=>{auth.currentUser={...google,getIdTokenResult:async()=>({claims:{sid:'secure'}})};return {user:auth.currentUser};},signOut:async()=>{calls.push('signOut');auth.currentUser=null;},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{getItem:()=>null},navigator:{onLine:true},location:{hash:'#/tester'},window:{addEventListener(){},dispatchEvent(){calls.push('error-toast');}}};
 let code=source.replace(/^import .*;\r?$/gm,'').replace('const env = import.meta.env;','const env = {};').replace(/await import\('\.\/session.js'\)/g,'globalThis.session').replace(/export (const|async function|function)/g,'$1').replace(/^export \{.*;\r?$/gm,'');
 code+='\nglobalThis.api={onUser,refreshUser};';
 vm.runInNewContext(code,sandbox);sandbox.api.onUser((u,state)=>states.push({u,state}));
 return {calls,states,google,auth,storage,api:sandbox.api,loggedOut:()=>listener(null),login:()=>{auth.currentUser=google;return listener(google);},approve:()=>{status='approved';}};
}
test('tester Google sign-in auto submits a request and stays signed in pending without acquiring session',async()=>{
 const f=fixture();await f.login();assert.deepEqual(f.calls,['testerStatus','testerApply']);
 assert.equal(f.states.at(-1).state.testerStatus,'pending');assert.equal(f.auth.currentUser.uid,'tester');
 assert.ok(!f.calls.includes('signOut'));assert.ok(!f.calls.includes('error-toast'));
 await f.api.refreshUser();assert.equal(f.calls.filter(c=>c==='testerApply').length,1);
});
test('approval refresh establishes a scoped secure session without requiring sign-out',async()=>{
 const f=fixture('pending');await f.login();f.approve();await f.api.refreshUser();
 assert.ok(f.calls.includes('acquire:tester'));assert.ok(f.calls.includes('validate'));
 assert.equal(f.states.at(-1).state,undefined);assert.equal(f.auth.currentUser.uid,'tester');
});
test('same-account repeated refresh coalesces in-flight request processing',async()=>{
 const f=fixture();f.auth.currentUser=f.google;await Promise.all([f.api.refreshUser(),f.api.refreshUser()]);
 assert.equal(f.calls.filter(c=>c==='testerApply').length,1);
});


test('fresh browser without a signed-in account completes initial auth and can then log in',async()=>{
 const f=fixture();
 await f.loggedOut();
 assert.equal(f.states.length,1);
 assert.equal(f.states[0].u,null);
 assert.equal(f.calls.length,0);
 await f.loggedOut();
 assert.equal(f.states.length,2);
 await f.login();
 assert.equal(f.states.at(-1).state.testerStatus,'pending');
});
