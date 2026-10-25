import {assetAddress} from '../shared/library-url.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import { AssetCache } from '../src/asset-cache.js';
import {testerAnimationAllowed,changeTesterAnimation} from '../src/tester-animation-policy.js';
const maps=()=>({grants:new Map([['*',new Set(['walk','talk','run'])]]),blocked:{}});
test('character None overrides global grants and allow restores only the selected character',()=>{
 const {grants,blocked}=maps();
 for(const id of ['walk','talk','run'])changeTesterAnimation(grants,blocked,'neha',id,false);
 for(const id of ['walk','talk','run']){assert.equal(testerAnimationAllowed(grants,blocked,'neha',id),false);assert.equal(testerAnimationAllowed(grants,blocked,'mybaby',id),true);}
 changeTesterAnimation(grants,blocked,'neha','talk',true);
 assert.equal(testerAnimationAllowed(grants,blocked,'neha','talk'),true);
 assert.equal(testerAnimationAllowed(grants,blocked,'neha','walk'),false);
});
test('global None removes character grants too; global Allow clears character exclusions',()=>{
 const {grants,blocked}=maps();grants.set('neha',new Set(['talk']));
 changeTesterAnimation(grants,blocked,'*','talk',false);
 assert.equal(testerAnimationAllowed(grants,blocked,'neha','talk'),false);
 assert.equal(changeTesterAnimation(grants,blocked,'neha','talk',true),true);
 assert.equal(testerAnimationAllowed(grants,blocked,'neha','talk'),true);
 assert.equal(testerAnimationAllowed(grants,blocked,'mybaby','talk'),false);
 changeTesterAnimation(grants,blocked,'neha','walk',false);
 changeTesterAnimation(grants,blocked,'*','walk',true);
 assert.equal(testerAnimationAllowed(grants,blocked,'neha','walk'),true);
});
test('actual tester category filtering respects character exclusions, limits, and verified admin preview',async()=>{
 let source=await readFile(new URL('../src/catalog.js',import.meta.url),'utf8');
 source=source.replace(/^import .*;\r?$/gm,'').replace('import.meta.env.BASE_URL',"'/'").replace('import.meta.env.VITE_LIBRARY_URL',"''").replace(/export (const|async function|function)/g,'$1');
 source+='\nglobalThis.api={setTesterRules,categoriesFor};';
 const sandbox={testerAnimationAllowed,AssetCache,assetAddress};vm.runInNewContext(source,sandbox);
 const rig={toonChar:'neha',animDir:'/',animList:['walk','run','talk'].map(name=>({name,file:name,length:1}))};
 sandbox.api.setTesterRules({anims:{'*':['walk','run','talk']},blockedAnims:{neha:['walk','run','talk']}});
 assert.equal(sandbox.api.categoriesFor(rig,{tester:true}).length,0);
 sandbox.api.setTesterRules({anims:{'*':['walk','run','talk']},blockedAnims:{neha:['talk']},limit:1});
 assert.equal(sandbox.api.categoriesFor(rig,{tester:true}).flatMap(c=>c.animations).length,1);
 sandbox.api.setTesterRules({anims:{neha:['talk']},blockedAnims:{'*':['walk','run','talk']}});
 assert.equal(sandbox.api.categoriesFor(rig,{tester:true}).flatMap(c=>c.animations).length,1);
 assert.equal(sandbox.api.categoriesFor(rig,{tester:true}).flatMap(c=>c.animations)[0].ref.id,'talk');
 sandbox.api.setTesterRules({admin:true,anims:{},blockedAnims:{'*':['walk','run','talk']}});
 assert.equal(sandbox.api.categoriesFor(rig,{tester:true}).flatMap(c=>c.animations).length,3);
});
test('live subscription delivers exclusion-only updates and stops cleanly',async()=>{
 const cloud=await readFile(new URL('../src/cloud.js',import.meta.url),'utf8');
 const source=cloud.slice(cloud.indexOf('export function watchTesterConfig'),cloud.indexOf('export async function loadTesterConfig')).replace('export function','function')+'\nglobalThis.watch=watchTesterConfig;';
 let config={admin:false,anims:{'*':['walk']},limit:0,blockedAnims:{}},pending,stopped=false;
 const seen=[],sandbox={auth:{currentUser:{uid:'tester'}},document:{hidden:false,addEventListener(){},removeEventListener(){}},localStorage:{setItem(){}},TESTER_KEY:'test',apiCall:async()=>structuredClone(config),setTimeout:fn=>{pending=fn;return 1;},clearTimeout:()=>{},JSON};
 vm.runInNewContext(source,sandbox);const stop=sandbox.watch(c=>seen.push(c));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(seen.length,1);
 config.blockedAnims={neha:['walk']};await pending();
 assert.equal(seen.length,2);assert.deepEqual(seen[1].blockedAnims,{neha:['walk']});
 stop();await pending();assert.equal(seen.length,2);
});

test('live permission callback clears a revoked body/overlay clip and mouth preview before redrawing',async()=>{
 const source=await readFile(new URL('../src/charstudio.js',import.meta.url),'utf8');
 const start=source.indexOf('watchTesterConfig(config => {')+'watchTesterConfig('.length;
 const end=source.indexOf('}, e =>',start)+1;
 assert.ok(start>0 && end>start);
 const st={def:{rig:{}},anim:{key:'a9000'},over:{key:'a9100'},mouth:true,permissionsError:'old'};
 const calls=[],sandbox={st,setTesterRules:()=>calls.push('rules'),categoriesFor:()=>[],rebuild:()=>calls.push('rebuild'),draw:()=>calls.push('draw'),drawAnimBar:()=>calls.push('bar')};
 vm.runInNewContext('globalThis.update='+source.slice(start,end),sandbox);
 sandbox.update({anims:{},blockedAnims:{neha:['9000']}});
 assert.equal(st.anim,null);assert.equal(st.over,null);assert.equal(st.mouth,false);
 assert.deepEqual(calls,['rules','rebuild','draw','bar']);
});

test('category Allow after global None enables that character; repeated None/Allow remains reversible',()=>{
 const {grants,blocked}=maps();
 for(const id of ['walk','run','talk'])changeTesterAnimation(grants,blocked,'*',id,false);
 for(let round=0;round<5;round++){
   for(const id of ['walk','run','talk'])changeTesterAnimation(grants,blocked,'neha',id,true);
   for(const id of ['walk','run','talk']){
     assert.equal(testerAnimationAllowed(grants,blocked,'neha',id),true);
     assert.equal(testerAnimationAllowed(grants,blocked,'mybaby',id),false);
   }
   for(const id of ['walk','run','talk'])changeTesterAnimation(grants,blocked,'neha',id,false);
   for(const id of ['walk','run','talk'])assert.equal(testerAnimationAllowed(grants,blocked,'neha',id),false);
 }
});
