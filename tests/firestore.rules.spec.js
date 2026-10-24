import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
test('Firestore rules enforce owner/session/moderation/admin and immutable security state',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-12toons',firestore:{host:'127.0.0.1',port:8089,rules:await readFile('firebase/firestore.rules','utf8')}});
 try {
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   for(const [uid,status] of [['alice','active'],['blocked','blocked'],['restricted','restricted'],['admin','active']]){
    await setDoc(doc(db,'securityUsers',uid),{status});
    await setDoc(doc(db,'securitySessions',uid),{sid:'session-'+uid,expiresAt:Date.now()+600000,revoked:false});
    await setDoc(doc(db,'workspaces',uid,'characters','char'),{name:'Saved'});
   }
   await setDoc(doc(db,'securityAdmins','admin'),{enabled:true});
   await setDoc(doc(db,'config','maintenance'),{enabled:false});
  });
  const db=uid=>env.authenticatedContext(uid,{sid:'session-'+uid,email_verified:true}).firestore();
  await assertSucceeds(getDoc(doc(db('alice'),'workspaces','alice','characters','char')));
  await assertFails(getDoc(doc(db('alice'),'workspaces','blocked','characters','char')));
  await assertFails(getDoc(doc(db('blocked'),'workspaces','blocked','characters','char')));
  await assertFails(setDoc(doc(db('restricted'),'workspaces','restricted','characters','char'),{name:'Overwrite'}));
  await assertSucceeds(getDoc(doc(db('restricted'),'workspaces','restricted','characters','char')));
  await assertFails(setDoc(doc(db('alice'),'securityUsers','alice'),{status:'active'}));
  await assertFails(setDoc(doc(db('alice'),'securityAdmins','alice'),{enabled:true}));
  await assertFails(setDoc(doc(db('alice'),'workspaces','alice','projects','p'),{revision:99}));
  await assertFails(setDoc(doc(db('alice'),'config','animations'),{hidden:'{}'}));
  await assertSucceeds(setDoc(doc(db('admin'),'config','animations'),{hidden:'{}'}));
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'config','maintenance'),{enabled:true}));
  await assertFails(getDoc(doc(db('alice'),'workspaces','alice','characters','char')));
  await assertSucceeds(getDoc(doc(db('admin'),'workspaces','admin','characters','char')));
  await assertSucceeds(setDoc(doc(db('admin'),'config','animations'),{hidden:'{"all":[]}'}));
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'config','maintenance'),{enabled:false}));
  const stale=env.authenticatedContext('alice',{sid:'old',email_verified:true}).firestore();
  await assertFails(getDoc(doc(stale,'workspaces','alice','characters','char')));
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'securitySessions','alice'),{sid:'session-alice',expiresAt:Date.now()+600000,revoked:true}));
  await assertFails(getDoc(doc(db('alice'),'workspaces','alice','characters','char')));
 } finally {await env.cleanup();}
});
