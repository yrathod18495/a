import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { ingest } from '../src/ingest.js';
test('user character ZIP imports do not register embedded or loose motion clips',async()=>{
  const zip=new JSZip(),clip={name:'walk',duration:24,bone:[{name:'root',translateFrame:[{duration:24,x:1}]}]};
  zip.file('Rig_ske.json',JSON.stringify({frameRate:24,armature:[{name:'Rig',bone:[{name:'root'}],slot:[],skin:[],animation:[clip]}]}));
  zip.file('Rig_tex.json',JSON.stringify({imagePath:'texture.png',width:1,height:1,SubTexture:[]}));
  zip.file('texture.png',new Uint8Array([1]));zip.file('anim_walk.json',JSON.stringify(clip));
  const result=await ingest([new File([await zip.generateAsync({type:'uint8array'})],'Rig.zip')]);
  assert.equal(result.characters.length,1);assert.deepEqual(result.characters[0].anims,[]);assert.deepEqual(result.characters[0].localAnims,{});
  assert.equal(result.characters[0].ske.armature[0].animation,undefined);
});
