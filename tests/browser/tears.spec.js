import {test,expect} from '@playwright/test';
async function open(page,workers=0){
 await page.setViewportSize({width:1366,height:768});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto(`/?debug&workers=${workers}#/toons`);await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Tears');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 await page.locator('.tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'Add character',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);await expect(page.locator('.busy')).toHaveCount(0);
 await page.locator('.tabs.big').getByRole('button',{name:'Tears',exact:true}).click();
}
const config=page=>page.evaluate(()=>window.__toon.S.speakers[0].tears);
async function seek(page,time){await page.evaluate(time=>{window.__toon.player.seek(time);window.__toon.S.dirty=true;},time);await expect.poll(()=>page.evaluate(()=>window.__toon.metrics.framePending)).toBe(false);}
test('PNG tears render on eyes; controls are independent, draggable and saved with scenes and undo',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await page.waitForTimeout(1200);await page.reload();await expect(page.getByRole('button',{name:'Tear 4',exact:true})).toBeVisible();await seek(page,.5);const before=await page.evaluate(()=>{const {stage,player}=window.__toon;stage.render(player.time,0,player.clips,[]);return stage.out.toDataURL();});
 await page.getByRole('button',{name:'Tear 4',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);await seek(page,.5);
 const after=await page.evaluate(()=>{const {stage,player}=window.__toon;stage.render(player.time,0,player.clips,[]);return stage.out.toDataURL();});expect(after!==before).toBe(true);
 const anchors=await page.evaluate(()=>window.__toon.stage.layers[0].tearAnchors);expect(Object.keys(anchors).sort()).toEqual(['left','right']);
 await page.getByLabel('Left / right',{exact:true}).fill('50');await page.getByLabel('Tear rotation',{exact:true}).fill('25');await page.getByLabel('Tear size',{exact:true}).fill('1.5');
 await page.getByRole('button',{name:'Right Eye',exact:true}).click();await page.getByLabel('Up / down',{exact:true}).fill('35');
 let current=await config(page);expect(current.left.x).toBe(50);expect(current.left.rotation).toBe(25);expect(current.left.size).toBe(1.5);expect(current.right.x).toBe(0);expect(current.right.y).toBe(35);
 await page.getByRole('button',{name:'Adjust Tear Placement',exact:true}).click();const handle=page.getByRole('button',{name:'Move tears for right eye',exact:true});await expect(handle).toBeVisible();
 const bounds=await handle.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+6,bounds.y+bounds.height/2+3,{steps:4});await page.mouse.up();
 const dragged=await config(page);expect(dragged.right.x).not.toBe(current.right.x);expect(dragged.left).toEqual(current.left);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);expect(await config(page)).toEqual(current);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);expect(await config(page)).toEqual(dragged);
 await page.screenshot({path:info.outputPath('tears-controls.png')});
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>window.__toon.stage.tearTex)).toBeNull();
 await page.getByRole('tab',{name:'Scene 1',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 1',exact:true})).toHaveAttribute('aria-selected','true');expect(await config(page)).toEqual(dragged);
 await page.waitForTimeout(1200);await page.reload();await expect.poll(()=>page.evaluate(()=>window.__toon?.S.speakers[0]?.tears?.style)).toBe(4);expect(await config(page)).toEqual(dragged);
 await page.getByRole('button',{name:'No tears',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);expect(await page.evaluate(()=>window.__toon.stage.tearTex)).toBeNull();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);expect((await config(page)).style).toBe(4);expect(errors).toEqual([]);
});
for(const workers of [0,2])test(`tear PNG and animation survive video export with ${workers ? 'parallel workers' : 'one renderer'}`,async({page},info)=>{
 await open(page,workers);await page.getByRole('button',{name:'Tear 4',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);
 await page.getByLabel('Tear size',{exact:true}).fill('2.5');await page.getByRole('button',{name:'Right Eye',exact:true}).click();await page.getByLabel('Tear size',{exact:true}).fill('2.5');
 await seek(page,.5);
 const anchor=await page.evaluate(()=>{const {stage}=window.__toon;stage.render(.5,0,[],[]);const f=stage.layers[0].tearAnchors.left;return{x:f.p.x/stage.W,y:f.p.y/stage.H,unit:Math.hypot(f.u.x,f.u.y)/stage.W};});
 await page.getByLabel('Preview quality',{exact:true}).selectOption('low');await expect(page.getByLabel('Preview quality',{exact:true})).toBeEnabled();
 await page.evaluate(()=>{window.__toon.S.quality=720;window.__toon.S.fps=5;});
 if(!workers){await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');}
 const ready=page.waitForEvent('download');await page.locator('.hdr-tools').getByRole('button',{name:'Export',exact:true}).click();const download=await ready;const {readFile}=await import('node:fs/promises');const bytes=await readFile(await download.path());
 const result=await page.evaluate(async({base64,anchor})=>{
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'video/webm'})),video=document.createElement('video');video.src=url;video.muted=true;await new Promise((r,j)=>{video.onloadedmetadata=r;video.onerror=j;});video.currentTime=.6;await new Promise(r=>video.onseeked=r);
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);
  const x=Math.max(0,Math.floor(anchor.x*canvas.width-anchor.unit*canvas.width*2)),y=Math.max(0,Math.floor(anchor.y*canvas.height-anchor.unit*canvas.width*.5)),w=Math.min(canvas.width-x,Math.max(8,Math.ceil(anchor.unit*canvas.width*4))),h=Math.min(canvas.height-y,Math.max(12,Math.ceil(anchor.unit*canvas.width*5)));
  const pixels=ctx.getImageData(x,y,w,h).data;let cyan=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>130 && pixels[i+2]>150 && pixels[i+2]>pixels[i]+20 && pixels[i+1]>pixels[i]+10)cyan++;
  const result={size:[canvas.width,canvas.height],cyan,duration:video.duration,frame:canvas.toDataURL(),region:{x,y,w,h}};URL.revokeObjectURL(url);return result;
 },{base64:bytes.toString('base64'),anchor});
 const {writeFile}=await import('node:fs/promises');await writeFile(info.outputPath('tear-export-frame.png'),Buffer.from(result.frame.split(',')[1],'base64'));
 expect(result.size).toEqual([1280,720]);expect(result.cyan).toBeGreaterThan(0);expect(result.duration).toBeCloseTo(workers?8:16,0);await expect(page.locator('.busy')).toHaveCount(0);expect(await page.evaluate(()=>window.__toon.stage.H)).toBe(180);
 if(!workers){await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');await page.getByRole('tab',{name:'Scene 1',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 1',exact:true})).toHaveAttribute('aria-selected','true');}
 expect((await config(page)).style).toBe(4);
});
test('all tear styles follow head motion, retain placement across preview modes and respect timing',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Tear 1',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);await seek(page,.4);
 const first=await page.evaluate(()=>{const {stage}=window.__toon;stage.render(.4,0,[],[]);return stage.layers[0].tearAnchors.left.p;});
 await seek(page,1.4);const next=await page.evaluate(()=>window.__toon.stage.layers[0].tearAnchors.left.p);expect(next).not.toEqual(first);
 for(const style of [2,3,4,5]){await page.getByRole('button',{name:`Tear ${style}`,exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);await seek(page,.5);expect((await config(page)).style).toBe(style);}
 const positions=[];for(const mode of ['low','medium','high']){await page.getByLabel('Preview quality',{exact:true}).selectOption(mode);await expect(page.getByLabel('Preview quality',{exact:true})).toBeEnabled();await seek(page,.5);positions.push(await page.evaluate(()=>{const {stage}=window.__toon;stage.render(.5,0,[],[]);const p=stage.layers[0].tearAnchors.left.p;return{x:p.x/stage.W,y:p.y/stage.H};}));}
 expect(positions[0].x).toBeCloseTo(positions[2].x,3);expect(positions[0].y).toBeCloseTo(positions[2].y,3);
 await page.getByLabel('Tears start',{exact:true}).fill('1');await page.getByLabel('Tears start',{exact:true}).press('Tab');await page.getByLabel('Tears end',{exact:true}).fill('2');await page.getByLabel('Tears end',{exact:true}).press('Tab');
 const samples=await page.evaluate(()=>{const {stage}=window.__toon,c=stage.layers[0].tears;const render=(time)=>{stage.render(time,0,[],[]);return stage.out.toDataURL();};c.style=0;const off=render(.5);c.style=5;const outside=render(.5);c.style=0;const offInside=render(1.5);c.style=5;const inside=render(1.5);return{outsideSame:off===outside,insideDifferent:offInside!==inside};});
 expect(samples).toEqual({outsideSame:true,insideDifferent:true});
});
test('tear attachment works for all six characters, a side pose and hides on back poses',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Tear 4',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);
 const choose=async(name,pose)=>{
  await page.locator('.tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.getByTitle('Change character',{exact:true}).click();
  const card=page.locator('.cp-card').filter({hasText:new RegExp(`^${name}$`)});if(!(await card.getAttribute('class')).split(' ').includes('open'))await card.click();
  const choices=page.locator('.cp-poses .pose');if(pose)await choices.filter({hasText:new RegExp(`^${pose}$`)}).click();else await choices.first().click();
  await expect(page.locator('.modal')).toHaveCount(0);await expect(page.locator('.busy')).toHaveCount(0);await seek(page,.5);
  return page.evaluate(()=>Object.keys(window.__toon.stage.layers[0].tearAnchors));
 };
 for(const name of ['My Baby','Village Boy','SVG Multi','Sadhu Baba','Chudel']){
  // Only change tabs when needed: the character list stays open after replacement.
  const chars=page.locator('.tabs.big').getByRole('button',{name:'Characters',exact:true});if(await chars.getAttribute('aria-pressed')==='true')await page.locator('.tabs.big').getByRole('button',{name:'Tears',exact:true}).click();
  expect((await choose(name)).sort()).toEqual(['left','right']);
 }
 await page.locator('.tabs.big').getByRole('button',{name:'Tears',exact:true}).click();expect(await choose('Neha','Side')).toEqual(['left']);
 await page.locator('.tabs.big').getByRole('button',{name:'Tears',exact:true}).click();expect(await choose('Neha','Back')).toEqual([]);
});
