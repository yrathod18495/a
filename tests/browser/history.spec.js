import {test,expect} from '@playwright/test';
async function open(page){
 await page.setViewportSize({width:1366,height:768});
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
 await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();
 await page.getByRole('textbox',{name:'Create a project'}).fill('History test');
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
}
async function tool(page,name){
 if(['Audio','Background','Props'].includes(name))await page.locator('.upload-tools>summary').click();
 if(['Move','Camera','Mask','AI'].includes(name))await page.locator('.advanced-tools').evaluate(el=>{el.open=true;});
 const btn=page.locator('#app .tabs.big').getByRole('button',{name,exact:true});
 if(await btn.getAttribute('aria-pressed')!=='true')await btn.click();
}
async function add(page){await tool(page,'Characters');await page.getByRole('button',{name:'Add character',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);await expect(page.locator('.busy')).toHaveCount(0);}
async function undo(page){await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);}
async function redo(page){await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);}
const manual=page=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__toon.S.manual)));
const keys=page=>page.evaluate(()=>Object.values(window.__toon.S.charKeys).flat());
test('immediate undo/redo covers character addition and rapid timeline actions; one long drag is one step',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await add(page);
 await undo(page);expect(await page.evaluate(()=>window.__toon.S.speakers.length)).toBe(0);await redo(page);expect(await page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
 const hit=await page.evaluate(()=>{const stage=window.__toon.stage,box=stage.layers[0].box,r=stage.out.getBoundingClientRect();return{x:(box.x0+box.x1)/2/stage.W*r.width,y:(box.y0+box.y1)/2/stage.H*r.height};});await page.locator('#app .stagebox canvas').click({position:hit});const originalSize=await page.evaluate(()=>window.__toon.stage.layers[0].mul);
 await page.getByLabel('Size',{exact:true}).fill('140');await undo(page);expect(await page.evaluate(()=>window.__toon.stage.layers[0].mul)).toBe(originalSize);await redo(page);expect(await page.evaluate(()=>window.__toon.stage.layers[0].mul)).toBe(1.4);
 await page.getByTitle('Add an animation for Character 1 at the playhead',{exact:true}).click();
 await page.locator('.modal .animation-apply').first().click();await expect(page.locator('.busy')).toHaveCount(0);
 const one=await manual(page);expect(Object.values(one).flat().length).toBe(1);
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();const two=await manual(page);expect(Object.values(two).flat().length).toBe(2);
 await undo(page);expect(await manual(page)).toEqual(one);await redo(page);expect(await manual(page)).toEqual(two);
 const clip=page.locator('.tclip.mine').first(),bounds=await clip.boundingBox();
 await page.mouse.move(bounds.x+10,bounds.y+12);await page.mouse.down();await page.mouse.move(bounds.x+30,bounds.y+12,{steps:4});await page.waitForTimeout(1150);await page.mouse.move(bounds.x+70,bounds.y+12,{steps:4});await page.mouse.up();
 const moved=await manual(page);expect(moved).not.toEqual(two);await undo(page);expect(await manual(page)).toEqual(two);await redo(page);expect(await manual(page)).toEqual(moved);
 await page.locator('.tclip.mine').first().click();await page.getByRole('button',{name:'Delete',exact:true}).click();await undo(page);expect(await manual(page)).toEqual(moved);
 expect(errors).toEqual([]);
});
test('character keyframes and camera keys undo immediately; shortcuts preserve playhead and new edits clear redo',async({page})=>{
 await open(page);await add(page);await tool(page,'Move');
 await page.evaluate(()=>window.__toon.player.seek(1));await page.getByRole('button',{name:'Keyframe here',exact:true}).click();
 const first=await keys(page);expect(first.length).toBe(1);
 await page.locator('.cs-sl').filter({hasText:'Left ↔ right'}).locator('input').fill('0.7');
 expect((await keys(page))[0].x).toBe(.7);await undo(page);expect(await keys(page)).toEqual(first);await redo(page);expect((await keys(page))[0].x).toBe(.7);
 const beforeDrag=await keys(page);const diamond=page.locator('.kf.mv').first();await page.waitForTimeout(60);await diamond.evaluate(el=>el.scrollIntoView({block:'nearest'}));const bounds=await diamond.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+65,bounds.y+bounds.height/2,{steps:6});await page.mouse.up();
 const afterDrag=await keys(page);expect(afterDrag[0].t).not.toBe(beforeDrag[0].t);await undo(page);expect(await keys(page)).toEqual(beforeDrag);await redo(page);expect(await keys(page)).toEqual(afterDrag);
 await page.evaluate(()=>window.__toon.player.seek(3));await page.getByRole('button',{name:'Keyframe here',exact:true}).click();
 expect((await keys(page)).length).toBe(2);
 await page.getByRole('button',{name:'Delete',exact:true}).click();expect((await keys(page)).length).toBe(1);
 await page.locator('#app .stagebox').click({position:{x:160,y:8}});await page.keyboard.press('Control+z');await expect.poll(async()=> (await keys(page)).length).toBe(2);
 expect(await page.evaluate(()=>window.__toon.player.time)).toBe(3);
 await page.keyboard.press('Control+Shift+z');await expect.poll(async()=> (await keys(page)).length).toBe(1);
 await page.getByRole('button',{name:'Keyframe here',exact:true}).click();await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeDisabled();
 await tool(page,'Camera');await page.getByRole('button',{name:'Keyframe here',exact:true}).click();const cam=await page.evaluate(()=>window.__toon.S.camKeys);
 expect(cam.length).toBe(1);await undo(page);expect(await page.evaluate(()=>window.__toon.S.camKeys)).toEqual([]);await redo(page);expect(await page.evaluate(()=>window.__toon.S.camKeys)).toEqual(cam);
 await page.waitForTimeout(1200);await page.reload();await expect.poll(()=>page.evaluate(()=>window.__toon?.S.camKeys.length)).toBe(1);
 expect((await keys(page)).length).toBe(2);
});
test('uploaded backgrounds survive undo of removal and restore, in both history and saved projects',async({page})=>{
 await open(page);await tool(page,'Background');
 const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,16,16);return canvas.toDataURL().split(',')[1];}),'base64');
 await page.locator('.panel input[type=file]').setInputFiles({name:'red.png',mimeType:'image/png',buffer:png});
 await expect.poll(()=>page.evaluate(()=>window.__toon.S.myBgs.length)).toBe(1);
 const id=await page.evaluate(()=>window.__toon.S.bgId);
 await undo(page);expect(await page.evaluate(()=>window.__toon.S.myBgs.length)).toBe(0);await redo(page);expect(await page.evaluate(()=>window.__toon.S.bgId)).toBe(id);
 await page.locator('.bggrid .bgc .x').click();await expect.poll(()=>page.evaluate(()=>window.__toon.S.myBgs.length)).toBe(0);await expect(page.locator('.bggrid .bgc .x')).toHaveCount(0);await undo(page);
 expect(await page.evaluate(()=>window.__toon.S.myBgs[0]?.blob instanceof Blob)).toBe(true);
 await page.waitForTimeout(1200);await page.reload();await expect.poll(()=>page.evaluate(()=>window.__toon?.S.myBgs.length)).toBe(1);
 expect(await page.evaluate(()=>window.__toon.S.bgId)).toBe(id);
});
test('opening tools does not consume history; masks and imported audio restore without losing redo',async({page})=>{
 await open(page);await add(page);await tool(page,'Mask');
 await page.getByRole('checkbox',{name:'Enable mask',exact:true}).check();
 await undo(page);await expect(page.getByRole('checkbox',{name:'Enable mask',exact:true})).not.toBeChecked();
 await redo(page);await expect(page.getByRole('checkbox',{name:'Enable mask',exact:true})).toBeChecked();
 await tool(page,'Audio');
 const wav=Buffer.alloc(44+9600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(9600,40);
 await page.locator('.panel input[type=file]').setInputFiles({name:'001-Narrator.wav',mimeType:'audio/wav',buffer:wav});
 await expect.poll(()=>page.evaluate(()=>window.__toon.player.clips.length)).toBe(1);await expect(page.locator('.busy')).toHaveCount(0);
 await undo(page);expect(await page.evaluate(()=>window.__toon.player.clips.length)).toBe(0);
 await redo(page);expect(await page.evaluate(()=>window.__toon.player.clips.length)).toBe(1);
 expect(await page.evaluate(()=>window.__toon.S.lines[0].raw instanceof ArrayBuffer)).toBe(true);
});
