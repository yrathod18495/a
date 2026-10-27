export const TEAR_STYLES = [
  {id:0,name:'No tears',hint:'Off'}, {id:1,name:'Tear 1',hint:'Gentle'}, {id:2,name:'Tear 2',hint:'Double drops'},
  {id:3,name:'Tear 3',hint:'Flowing'}, {id:4,name:'Tear 4',hint:'Watery eyes'}, {id:5,name:'Tear 5',hint:'Sobbing'},
];
export const TEAR_IMAGE_URL = '/images/tear-drop-v1.png';
// Transparent padding is excluded by UVs; the original generated PNG remains unchanged.
export const TEAR_UV = [389/1254,281/1254,865/1254,1035/1254];
const finite = (value, fallback) => Number.isFinite(Number(value)) && value !== null ? Number(value) : fallback;
const clamp = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, finite(value, fallback)));
export function tearConfig(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const eye = side => ({enabled:value[side]?.enabled !== false,x:clamp(value[side]?.x,-300,300,0),y:clamp(value[side]?.y,-300,500,0),rotation:clamp(value[side]?.rotation,-180,180,0),size:clamp(value[side]?.size,.2,3,1)});
  const start=clamp(value.start,0,86400,0),end=value.end == null ? null : clamp(value.end,start+.05,86400,start+.05);
  return {style:Math.round(clamp(value.style,0,5,0)),start,end,speed:clamp(value.speed,.25,3,1),left:eye('left'),right:eye('right')};
}
const fract = value => value-Math.floor(value);
export function tearDrops(config, time, side = 'left', seed = 0) {
  const c=tearConfig(config);
  if (!c.style || !c[side].enabled || time<c.start || (c.end !== null && time>=c.end)) return [];
  const elapsed=(time-c.start)*c.speed,phase=seed+(side==='right'?.37:0),out=[];
  const drop=(u,x,w,h,travel,alpha=1)=>out.push({x,y:.04+u*travel,w,h,alpha:Math.max(0,Math.min(1,alpha*Math.min(1,u*12,(1-u)*8)))});
  if(c.style===4){out.push({x:0,y:.12,w:.62+.04*Math.sin(elapsed*3),h:.48,alpha:.88});drop(fract(elapsed/2.3+phase),.06,.30,.58,1.4);return out;}
  const count=c.style===1?1:c.style===2?2:3,cycle=c.style===5?.9:c.style===3?1.5:1.9;
  for(let i=0;i<count;i++){
    const u=fract(elapsed/cycle+phase+i/count);
    drop(u,c.style===5?Math.sin(i*2.7+elapsed*4)*.14:c.style===2?(i?-.10:.10):0,c.style===3?.24:.42,c.style===3?1.12:.76,c.style===5?2.1:1.55,c.style===3?.8:1);
  }
  return out;
}
let spriteJob;
export function loadTearSprite() {
  return spriteJob ||= fetch(TEAR_IMAGE_URL).then(response=>{if(!response.ok)throw Error('Could not load the tear artwork. Please try again.');return response.blob();}).catch(error=>{spriteJob=null;throw error;});
}
