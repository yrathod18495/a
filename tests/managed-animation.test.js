import test from 'node:test';
import assert from 'node:assert/strict';
import { animationData, animationTarget, retimeAnimation } from '../src/managed-animation.js';
const motion = { duration:24,bone:[{name:'root',translateFrame:[{duration:24,x:1,y:2}]}] };
test('animation import accepts DragonBones wrappers and rejects invalid or foreign formats',()=>{
  assert.equal(animationData(motion),motion);
  assert.equal(animationData({walk:motion}),motion);
  assert.equal(animationData({armature:[{animation:[motion]}]}),motion);
  for(const bad of [{}, {duration:0,bone:[{}]}, {skeleton:{spine:'3.8'},animations:{}}, {duration:Infinity,slot:[{}]}]) assert.throws(()=>animationData(bad));
});
test('animation target must name an actual character pose',()=>{
  const manifest={characters:[{id:'neha',poses:[{pose:'front-side'}]}]};
  assert.equal(animationTarget('ad-neha-front-side',manifest),true);
  assert.equal(animationTarget('ad-neha-back',manifest),false);
});

test('source FPS conversion keeps timeline lengths and cumulative keyframe timing',()=>{
 const original={duration:24,_sourceFrameRate:24,bone:[{name:'root',translateFrame:Array.from({length:24},()=>({duration:1,x:1}))}]};
 const converted=retimeAnimation(original,60);
 assert.equal(converted.duration,60);assert.equal(converted.bone[0].translateFrame.reduce((sum,f)=>sum+f.duration,0),60);
 assert.equal(original.duration,24);assert.equal(retimeAnimation(converted,60),converted);
 assert.equal(retimeAnimation(original,24),original);
});
