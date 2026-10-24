import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tearConfig,tearDrops} from '../src/tears.js';
import {bindTearEyes,tearEyeFrame,worldTearFrame,drawTears} from '../src/db/tears.js';
test('each eye has independent bounded settings; invalid and legacy configurations stay safe',()=>{
 assert.equal(tearConfig(null).style,0);
 const c=tearConfig({style:5,left:{x:999,size:Infinity},right:{rotation:-999,enabled:false},start:2,end:1});
 assert.equal(c.left.x,300);assert.equal(c.left.size,1);assert.equal(c.right.x,0);assert.equal(c.right.rotation,-180);assert.equal(c.end,2.05);
 c.left.x=0;assert.equal(c.right.x,0);assert.deepEqual(tearDrops(tearConfig(),1),[]);
});
test('PNG animation uses absolute scene time, independent of FPS and render order',()=>{
 const config=tearConfig({style:5,start:1,end:4});const before=tearDrops(config,2.25,'left',.2);
 for(const t of [3.9,1,2.25,1.5])tearDrops(config,t,'left',.2);
 assert.deepEqual(tearDrops(config,2.25,'left',.2),before);assert.notDeepEqual(before,tearDrops(config,2.5,'left',.2));
 assert.deepEqual(tearDrops(config,.9),[]);assert.deepEqual(tearDrops(config,4),[]);
 assert.deepEqual(tearDrops({...config,right:{enabled:false}},2,'right'),[]);
 for(let style=1;style<=5;style++)assert.ok(tearDrops({...config,style},2).every(drop=>drop.alpha>=0&&drop.alpha<=1));
});
function rig(){const head={name:'HEAD',globalTransformMatrix:{a:1,b:0,c:0,d:1,tx:100,ty:50}};const item={slot:'Eyeball_L',verts:new Float32Array([102,52,112,52,112,58,102,58]),alpha:1};const layer={arm:{getSlot:()=>({parent:head}),getBone:()=>head},bones:{head},mat:[2,0,0,2,5,10],tears:tearConfig({style:4}),phase:.1};layer.tearBind=bindTearEyes(layer,[item]);return{layer,head,item};}
test('eyes attach to head motion, scale and character mirroring without editing rig geometry',()=>{
 const {layer,head}=rig(),initial=tearEyeFrame(layer,'left');const original=worldTearFrame(layer,initial);
 head.globalTransformMatrix.tx+=20;const moved=worldTearFrame(layer,tearEyeFrame(layer,'left'));assert.equal(moved.p.x-original.p.x,40);
 layer.tears.left.x=100;const shifted=tearEyeFrame(layer,'left');assert.equal(shifted.p.x-initial.p.x,30);
 layer.mat=[-2,0,0,2,5,10];assert.equal(worldTearFrame(layer,shifted).u.x,-20);
});
test('drawing respects eye visibility and submits PNG quads in the character transform',()=>{
 const {layer,item}=rig(),calls=[];drawTears({add:(...args)=>calls.push(args)}, {},layer,[item],.5);
 assert.ok(calls.length>0);assert.ok(calls[0][2][4]>200);assert.equal(Object.keys(layer.tearAnchors).length,1);
 calls.length=0;drawTears({add:(...args)=>calls.push(args)}, {},layer,[],.5);assert.equal(calls.length,0);
});
test('eye attachments also follow an animated face bone below the main head bone',()=>{
 const {layer,head,item}=rig(),face={name:'HEAD2',globalTransformMatrix:{...head.globalTransformMatrix}};
 layer.arm.getSlot=()=>({parent:{parent:face}});layer.arm.getBone=name=>name==='HEAD2'?face:head;
 layer.tearBind=bindTearEyes(layer,[item]);const before=tearEyeFrame(layer,'left').p;face.globalTransformMatrix.ty+=12;
 const after=tearEyeFrame(layer,'left').p;assert.equal(after.y-before.y,12);assert.equal(head.globalTransformMatrix.ty,50);
});
