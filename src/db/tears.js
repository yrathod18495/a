import { tearConfig, tearDrops, TEAR_UV } from '../tears.js';
const point = (m,x,y) => ({x:m.a*x+m.c*y+m.tx,y:m.b*x+m.d*y+m.ty});
const vector = (m,x,y) => ({x:m.a*x+m.c*y,y:m.b*x+m.d*y});
const sideOf = name => /eye(?!brow|lash)/i.test(name) ? /(?:^|[_\-/])(l|left)(?:$|[_\-/])/i.test(name) ? 'left' : /(?:^|[_\-/])(r|right)(?:$|[_\-/])/i.test(name) ? 'right' : null : null;
export function bindTearEyes(layer, items) {
  const eyes={};
  for(const item of items){
    const side=sideOf(item.slot);if(!side || eyes[side])continue;
    const slot=layer.arm.getSlot(item.slot),bone=slot?.parent?.parent||layer.bones.head||slot?.parent;if(!bone)continue;
    const m=bone.globalTransformMatrix,det=m.a*m.d-m.b*m.c;if(Math.abs(det)<1e-8)continue;
    const xs=[],ys=[];for(let i=0;i<item.verts.length;i+=2){xs.push(item.verts[i]);ys.push(item.verts[i+1]);}
    const width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);if(width<.01)continue;
    const x=(Math.min(...xs)+Math.max(...xs))/2-m.tx,y=Math.max(...ys)-height*.12-m.ty;
    eyes[side]={slot:item.slot,bone:bone.name,x:(m.d*x-m.c*y)/det,y:(-m.b*x+m.a*y)/det,ux:m.d*width/det,uy:-m.b*width/det,vx:-m.c*width/det,vy:m.a*width/det};
  }
  return eyes;
}
export function tearEyeFrame(layer, side) {
  const bind=layer.tearBind?.[side],c=tearConfig(layer.tears)[side];if(!bind || !c.enabled)return null;
  const m=layer.arm.getBone(bind.bone)?.globalTransformMatrix;if(!m)return null;
  const p=point(m,bind.x+bind.ux*c.x/100+bind.vx*c.y/100,bind.y+bind.uy*c.x/100+bind.vy*c.y/100),u=vector(m,bind.ux,bind.uy),v=vector(m,bind.vx,bind.vy);
  return {p,u,v,rotation:c.rotation*Math.PI/180,size:c.size,slot:bind.slot};
}
export function worldTearFrame(layer, frame) {
  const [a,b,c,d,tx,ty]=layer.mat,m={a,b,c,d,tx,ty};return {p:point(m,frame.p.x,frame.p.y),u:vector(m,frame.u.x,frame.u.y),v:vector(m,frame.v.x,frame.v.y)};
}
const idx=new Uint16Array([0,1,2,0,2,3]);
const [u0,v0,u1,v1]=TEAR_UV,uvs=new Float32Array([u0,v0,u1,v0,u1,v1,u0,v1]);
export function drawTears(renderer, texture, layer, items, time) {
  layer.tearAnchors={};if(!texture || !layer.tears?.style)return;
  const visible=new Set(items.filter(item=>item.alpha>.01).map(item=>item.slot));
  for(const side of ['left','right']){
    const f=tearEyeFrame(layer,side);if(!f || !visible.has(f.slot))continue;
    const world=worldTearFrame(layer,f);layer.tearAnchors[side]=world;
    const cos=Math.cos(f.rotation)*f.size,sin=Math.sin(f.rotation)*f.size;
    const a=world.u.x*cos+world.v.x*sin,b=world.u.y*cos+world.v.y*sin,c=-world.u.x*sin+world.v.x*cos,d=-world.u.y*sin+world.v.y*cos;
    for(const drop of tearDrops(layer.tears,time,side,layer.phase||0)){
      const x=drop.x-drop.w/2,y=drop.y;
      renderer.add({verts:new Float32Array([x,y,x+drop.w,y,x+drop.w,y+drop.h,x,y+drop.h]),uvs,idx,alpha:drop.alpha,r:1,g:1,b:1,blend:0},texture,[a,b,c,d,world.p.x,world.p.y]);
    }
  }
}
