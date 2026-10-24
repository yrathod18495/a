import {test,expect} from '@playwright/test';
async function open(page){
 await page.setViewportSize({width:1366,height:768});
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
 await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();
 await page.getByRole('textbox',{name:'Create a project'}).fill('Scenes test');
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Scene 1',exact:true})).toHaveAttribute('aria-selected','true');
}
async function menu(page,name,action){
 await page.getByLabel(`Options for ${name}`,{exact:true}).click();
 await page.locator('.scene-tab').filter({has:page.getByRole('tab',{name,exact:true})}).getByRole('button',{name:action,exact:true}).click();
}
async function addNeha(page){
 const chars=page.locator('#app .tabs.big').getByRole('button',{name:'Characters',exact:true});if(await chars.getAttribute('aria-pressed')!=='true')await chars.click();
 await page.getByRole('button',{name:'＋ Add character',exact:true}).click();
 await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();
 await page.locator('.cp-poses .pose').first().click();
 await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
}
test('scene tabs isolate characters, props, audio and edits; duplicate, order, delete, undo and reload work',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await addNeha(page);
 await page.getByLabel('Selected character name').fill('First actor');
 // Add real audio and prop assets; inactive scene assets must survive a reload.
 await page.evaluate(async()=>{
  const {S,stage}=window.__toon,buffer=stage.out;
  const blob=await new Promise(r=>buffer.toBlob(r));S.props=[{id:'test-prop',name:'Prop',blob,x:.1,y:.1,w:.1,h:.1}];await stage.setProps(S.props);
  const ctx=new AudioContext(),audio=ctx.createBuffer(1,4800,48000);
  const raw=new ArrayBuffer(44+9600),v=new DataView(raw);const text=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  text(0,'RIFF');v.setUint32(4,raw.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,9600,true);
  S.lines=[{id:'voice',order:0,file:'voice.wav',speaker:'Narrator',raw,buffer:audio,visemes:[]}];stage.bg.preset=1;await ctx.close();
 });
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>({speakers:window.__toon.S.speakers.length,lines:window.__toon.S.lines.length,props:window.__toon.S.props.length}))).toEqual({speakers:0,lines:0,props:0});
 await addNeha(page);await page.getByLabel('Selected character name').fill('Second actor');
 await menu(page,'Scene 2','Duplicate');await expect(page.getByRole('tab',{name:'Scene 2 copy',exact:true})).toHaveAttribute('aria-selected','true');
 await page.locator('#app canvas').first().click({position:{x:10,y:10}});
 page.once('dialog',d=>d.accept('Final scene'));await menu(page,'Scene 2 copy','Rename');
 await expect(page.getByRole('tab',{name:'Final scene',exact:true})).toBeVisible();
 await menu(page,'Final scene','Move left');
 expect(await page.getByRole('tablist',{name:'Scenes'}).getByRole('tab').allTextContents()).toEqual(['Scene 1','Final scene','Scene 2']);
 page.once('dialog',d=>d.accept());await menu(page,'Final scene','Delete');
 await expect(page.getByRole('tab',{name:'Final scene',exact:true})).toHaveCount(0);
 await page.getByTitle('Undo (Ctrl+Z)',{exact:true}).click();
 await expect(page.getByRole('tab',{name:'Final scene',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Scene 1',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__toon.S.speakers[0]?.name)).toBe('First actor');
 expect(await page.evaluate(()=>({lines:window.__toon.S.lines.length,props:window.__toon.S.props.length,bg:window.__toon.stage.bg.preset}))).toEqual({lines:1,props:1,bg:1});
 await page.getByRole('tab',{name:'Scene 2',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__toon.S.speakers[0]?.name)).toBe('Second actor');
 await page.waitForTimeout(1300);await page.reload();
 await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Scene 1',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__toon.S.lines.length)).toBe(1);
 expect(await page.evaluate(()=>({duration:window.__toon.player.total,props:window.__toon.S.props.length,blob:window.__toon.S.props[0]?.blob instanceof Blob}))).toEqual({duration:1.1,props:1,blob:true});
 await page.screenshot({path:info.outputPath('scene-tabs-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 const bounds=await page.locator('.scene-tabs').boundingBox();expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);expect(bounds.y+bounds.height).toBeLessThanOrEqual(844);
 await page.screenshot({path:info.outputPath('scene-tabs-mobile.png')});
 expect(errors).toEqual([]);
});
test('all scenes export joins backgrounds in order and preview continues to the next scene',async({page})=>{
 await open(page);
 await page.evaluate(()=>{window.__toon.stage.bg.preset=1;window.__toon.S.dirty=true;});
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 await page.evaluate(()=>{window.__toon.stage.bg.preset=3;window.__toon.S.dirty=true;window.__toon.S.fps=5;window.__toon.S.quality=360;});
 await page.getByRole('tab',{name:'Scene 1',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Scene 1',exact:true})).toHaveAttribute('aria-selected','true');
 await page.evaluate(()=>window.__toon.player.seek(7.9));
 await page.getByRole('button',{name:'▶ Play',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>page.evaluate(()=>window.__toon.player.playing)).toBe(true);
 await page.getByRole('button',{name:'⏸ Pause',exact:true}).click();
 await page.locator('#app .tabs.big').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.getByText('🔇 No audio added — this video will be 16.0 seconds long and silent. Add audio any time.',{exact:true})).toBeVisible();
 await page.getByLabel('Export scenes').selectOption('current');await expect(page.getByRole('button',{name:'⏺ Record live',exact:true})).toBeVisible();
 await page.getByLabel('Export scenes').selectOption('all');await expect(page.getByRole('button',{name:'⏺ Record live',exact:true})).toHaveCount(0);
 const downloadReady=page.waitForEvent('download');await page.locator('#app .hdr-tools').getByRole('button',{name:'⬇ Export',exact:true}).click();
 const download=await downloadReady;const {readFile}=await import('node:fs/promises');const bytes=await readFile(await download.path());
 const video=await page.evaluate(async base64=>{
  const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'video/webm'})),v=document.createElement('video');v.src=url;v.muted=true;
  await new Promise((r,j)=>{v.onloadedmetadata=r;v.onerror=j;});
  const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d');
  const samples=[];for(const t of [1,9]){v.currentTime=t;await new Promise(r=>v.onseeked=r);ctx.drawImage(v,0,0);samples.push([...ctx.getImageData(5,5,1,1).data]);}
  const result={duration:v.duration,size:[v.videoWidth,v.videoHeight],samples};URL.revokeObjectURL(url);return result;
 },bytes.toString('base64'));
 expect(video.duration).toBeCloseTo(16,0);expect(video.size).toEqual([640,360]);expect(video.samples[0]).not.toEqual(video.samples[1]);
 await expect(page.locator('.busy')).toHaveCount(0);
 await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>window.__toon.stage.bg.preset)).toBe(3);
});
test('legacy single scene projects open as Scene 1 and retain existing characters',async({page})=>{
 await open(page);await addNeha(page);await page.getByLabel('Selected character name').fill('Legacy actor');await page.getByLabel('Selected character name').press('Tab');
 await page.waitForTimeout(1300);
 await page.evaluate(async()=>{
  const {get,put}=await import('/src/store.js');const rec=await get('project','current');
  rec.doc=rec.doc.scenes[0].doc;delete rec.doc.lines;delete rec.blobs;await put('project',rec);
 });
 await page.reload();await expect(page.getByRole('tab',{name:'Scene 1',exact:true})).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>page.evaluate(()=>window.__toon.S.speakers[0]?.name)).toBe('Legacy actor');
 await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();
 await page.getByRole('tab',{name:'Scene 1',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__toon.S.speakers[0]?.name)).toBe('Legacy actor');
});
