import test from 'node:test';
import assert from 'node:assert/strict';
import { testerAnimations } from '../server/tester-animations.js';
import { testerGroupVisible, testerLayerDownloadable, testerCanSave, setPartRulesEnforced } from '../src/tester-parts.js';
setPartRulesEnforced(true);
const face={slot:'head',key:'face',group:'Face'},hair={slot:'hair',key:'front',group:'Hair'};
test('hidden groups apply globally or per character without changing other groups',()=>{
 const rules={verified:true,hiddenGroups:{'*':['Hair'],neha:['Face']}};
 assert.equal(testerGroupVisible(rules,'neha','Hair'),false);
 assert.equal(testerGroupVisible(rules,'neha','Face'),false);
 assert.equal(testerGroupVisible(rules,'villageboy','Face'),true);
 assert.equal(testerGroupVisible(rules,'neha','Nose'),true);
});
test('download filtering excludes hidden groups and denied layers; verified admins retain all controls',()=>{
 const rules={verified:true,hiddenGroups:{'*':['Hair']},blockedDownloads:{neha:['head|face']}};
 assert.equal(testerLayerDownloadable(rules,'neha',hair),false);
 assert.equal(testerLayerDownloadable(rules,'neha',face),false);
 assert.equal(testerLayerDownloadable(rules,'villageboy',face),true);
 assert.equal(testerCanSave(rules),false);
 const admin={...rules,admin:true};assert.equal(testerLayerDownloadable(admin,'neha',face),true);
 assert.equal(testerGroupVisible(admin,'neha','Hair'),true);assert.equal(testerCanSave(admin),true);
 assert.equal(testerLayerDownloadable(null,'neha',face),false);assert.equal(testerCanSave(null),false);
});
test('legacy configs retain existing part visibility and downloads; server validates and normalizes part rules',()=>{
 const old=testerAnimations({anims:'{}',limit:0});
 assert.deepEqual({...old.hiddenGroups},{});assert.deepEqual({...old.blockedDownloads},{});
 assert.equal(testerLayerDownloadable({...old,verified:true},'neha',face),true);
 const rules=testerAnimations({hiddenGroups:JSON.stringify({'*':['Face','Face']}),blockedDownloads:{neha:['head|face']}});
 assert.deepEqual({...rules.hiddenGroups},{'*':['Face']});assert.deepEqual({...rules.blockedDownloads},{neha:['head|face']});
 for(const value of [[],false,{'*':'all'},{'../scope':['Face']},{'*':[123]}])assert.throws(()=>testerAnimations({hiddenGroups:value}),e=>e.code==='invalid_parts');
});

test('while enforcement is paused every group and part is open to testers',()=>{
 setPartRulesEnforced(false);
 const rules={verified:true,hiddenGroups:{'*':['Hair']},blockedDownloads:{neha:['head|face']}};
 assert.equal(testerGroupVisible(rules,'neha','Hair'),true);assert.equal(testerLayerDownloadable(null,'neha',face),true);
 setPartRulesEnforced(true);
});
