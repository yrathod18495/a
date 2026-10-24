import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene, sceneDuration, sequencePlan, uniqueSceneName } from '../src/scenes.js';
test('new scenes are independent and silent timelines include late motion', () => {
 const a=emptyScene(),b=emptyScene('9:16');a.manual.hero=[{start:9,dur:3}];
 assert.equal(sceneDuration(a,new Map()),12);assert.equal(sceneDuration(b,new Map()),8);assert.equal(b.aspect,'9:16');assert.deepEqual(b.manual,{});
 b.camKeys=[{t:15}];assert.equal(sceneDuration(b,new Map()),15.5);
});
test('sequence offsets preserve per-scene audio lead, gaps and tails, skipping unavailable files', () => {
 const audio=new Map([['one',{buffer:{duration:2}}],['two',{buffer:{duration:3}}]]);
 const a={id:'a',doc:{...emptyScene(),lines:[{id:'one'},{id:'missing'},{id:'two'}]}};
 const b={id:'b',doc:emptyScene()};const plan=sequencePlan([a,b],audio);
 assert.equal(plan[0].start,0);assert.equal(plan[0].end,6.4);assert.equal(plan[1].start,6.4);assert.equal(plan[1].end,14.4);
 assert.equal(sequencePlan([b,a],audio)[1].start,8);
});

test('new and duplicated scenes receive unused names after deletion or repeated copying', () => {
 const scenes=['Scene 1','Scene 3','Scene 1 copy','Scene 1 copy 2'].map(name=>({name}));
 assert.equal(uniqueSceneName(scenes),'Scene 2');assert.equal(uniqueSceneName(scenes,'Scene 1 copy'),'Scene 1 copy 3');
});
