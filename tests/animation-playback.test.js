import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLFactory } from '../src/db/glslot.js';
import { prepareArmature, assemble } from '../src/db/prep.js';
import { Stage } from '../src/db/stage.js';
const read = file => JSON.parse(readFileSync(new URL('../public/'+file, import.meta.url),'utf8'));
const unwrap = j => j.bone ? j : Object.values(j)[0];
const chars = read('12toons/characters.json').characters;
const catalog = read('12toons/animations.json');
const cases = [];
for (const character of chars) {
 const pose = character.poses.find(p => p.pose === 'front-side');
 const clips = pose.own ? read(pose.animIndex).map(a => ({...a,file:pose.animDir+a.file+'.json'})) : catalog.poses[pose.pose].PRIMARY;
 for (const action of ['walk','run','talk']) {
  const clip = clips.find(a => new RegExp(action === 'talk' ? 'talk|speak' : action,'i').test(a.name));
  assert.ok(clip, character.name+' has no '+action+' fixture');
  cases.push({label:character.name+' '+action,pose,clip});
 }
}
for (const {label,pose,clip} of cases) test(label+' advances the actual rig through a full animation cycle',t=>{
 const skeleton=read(pose.ske),prep=prepareArmature(skeleton,pose.defaultSkin?['default',pose.defaultSkin]:['default','Saree']);
 const animation=unwrap(read(clip.file));
 const f=new GLFactory(),name='playback-check';f.parseDragonBonesData(assemble(prep,{check:animation}),name);
 for(const tex of pose.tex||[]) f.parseTextureAtlasData(read(tex),null,name);
 const arm=f.buildArmature(prep.arm.name,name,'all',name);assert.ok(arm);
 try {
  const layer={arm,states:[]},duration=arm.armatureData.getAnimation('check').duration;
  assert.ok(duration>0.1,'runtime duration must be seconds');
  const samples=[],drawSamples=[];
  for(const fraction of [0,.13,.27,.41,.59,.73,.89]) {
   const t=duration*fraction;Stage.prototype.setStates.call({},layer,[{name:'check',time:t,weight:1}]);arm.advanceTime(0);
   assert.ok(Math.abs(layer.states[0].currentTime-t)<1e-5,`time ${layer.states[0].currentTime} must equal ${t}`);
   const draw=new Map();for(const slot of arm.getSlots()){const parts=[];slot.collect(parts);if(parts.length)draw.set(slot.name,Array.from(parts[0].verts));}drawSamples.push(draw);
   samples.push(arm.getBones().map(b=>{const m=b.globalTransformMatrix;return [m.tx,m.ty,m.a,m.b,m.c,m.d];}));
  }
  let moving=0;for(let b=0;b<samples[0].length;b++){if(samples.slice(1).some(s=>s[b].some((v,k)=>Math.abs(v-samples[0][b][k])>.01)))moving++;}
  let movingSlots=0;for(const [slot,verts] of drawSamples[0]){if(drawSamples.slice(1).some(draw=>draw.has(slot)&&draw.get(slot).length===verts.length&&draw.get(slot).some((v,k)=>Math.abs(v-verts[k])>.01)))movingSlots++;}
  assert.ok(movingSlots>=2,`${label}: rendered sprite geometry did not move`);
  t.diagnostic(`${moving} moving bones, ${movingSlots} moving artwork slots`);
  assert.ok(moving>=2,`${label}: only ${moving} bones changed pose`);
  const wrapped=duration*.41;Stage.prototype.setStates.call({},layer,[{name:'check',time:duration*3+wrapped,weight:1}]);arm.advanceTime(0);
  assert.ok(Math.abs(layer.states[0].currentTime-wrapped)<1e-5,'loop must use the full duration');
 } finally {arm.dispose();f.removeDragonBonesData(name,true);f.removeTextureAtlasData(name,true);}
});

