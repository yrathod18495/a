import {test,expect} from '@playwright/test';
test('latest workspace controls coexist with undo, export presets and themed scene deletion',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1366,height:768});
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await expect(page.locator('.projects-toolbar button')).toHaveText(['Create New Project']);
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Workspace integration');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 const clipped=await page.locator('.prev').evaluate(host=>{const bounds=host.getBoundingClientRect();return [...host.querySelectorAll('.layout-tools button')].filter(button=>{const box=button.getBoundingClientRect();return box.left<bounds.left || box.right>bounds.right+1;}).map(button=>button.title);});expect(clipped).toEqual([]);
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
 const focus=page.getByRole('button',{name:'Focus mode — canvas only (F)',exact:true});await focus.click();await expect(page.locator('.ws')).toHaveAttribute('data-focus','true');
 await page.keyboard.press('Escape');await expect(page.locator('.ws')).toHaveAttribute('data-focus','false');
 await page.locator('.tabs.big').getByRole('button',{name:'Export',exact:true}).click();
 const before=await page.evaluate(()=>{const {quality,fps,format,level}=window.__toon.S;return{quality,fps,format,level};});
 await page.getByRole('button',{name:'Quick draft',exact:false}).click();expect(await page.evaluate(()=>window.__toon.S.quality)).toBe(360);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);
 expect(await page.evaluate(()=>{const {quality,fps,format,level}=window.__toon.S;return{quality,fps,format,level};})).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__toon.S.quality)).toBe(360);
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByLabel('Options for Scene 2',{exact:true}).click();await page.locator('.scene-tab').filter({has:page.getByRole('tab',{name:'Scene 2',exact:true})}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Delete scene?',exact:true})).toBeVisible();await page.keyboard.press('f');await expect(page.locator('.ws')).toHaveAttribute('data-focus','false');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('merged-workspace.png')});expect(errors).toEqual([]);
});
test('animation duration from latest main stays consistent through undo and merged scene export',async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Animation length');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 await page.locator('.tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'Add character',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);await expect(page.locator('.busy')).toHaveCount(0);
 await expect(page.locator('.lane2.audio')).toHaveCount(0);await expect(page.locator('.line-details')).toBeHidden();
 await page.locator('.tabs.big').getByRole('button',{name:'Animations',exact:true}).click();
 const category=page.getByLabel('Animation category');const talking=await category.locator('option').evaluateAll(options=>options.find(option=>/talking/i.test(option.textContent))?.value);expect(talking).toBeTruthy();await category.selectOption(talking);await page.locator('.animation-apply').first().click();await expect(page.locator('.busy')).toHaveCount(0);
 const length=await page.evaluate(()=>Object.values(window.__toon.S.solo)[0].bodyLen);expect(length).toBeGreaterThan(0);expect(length).not.toBe(8);expect(await page.evaluate(()=>window.__toon.player.total)).toBeCloseTo(Math.max(1,length),2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__toon.player.total)).toBe(8);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__toon.player.total)).toBeCloseTo(Math.max(1,length),2);
 await page.evaluate(()=>{window.__toon.S.fps=5;window.__toon.S.quality=360;});await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 const ready=page.waitForEvent('download');await page.locator('.hdr-tools').getByRole('button',{name:'Export',exact:true}).click();const download=await ready;const {readFile}=await import('node:fs/promises');const data=await readFile(await download.path());
 const duration=await page.evaluate(async base64=>{const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'video/webm'})),video=document.createElement('video');video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});const duration=video.duration;URL.revokeObjectURL(url);return duration;},data.toString('base64'));
 expect(Math.abs(duration-(Math.max(1,length)+8))).toBeLessThanOrEqual(.21);
});

test('side menus slide away after 5 s idle and return from the screen edge; timeline is the largest area',async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Dock');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 await expect(page.locator('.prev .hint')).toHaveCount(0);await expect(page.locator('.guides')).toHaveCount(0);
 const ws=page.locator('.ws');await expect(ws).toHaveAttribute('data-dock-rail','in');
 await page.mouse.move(600,200);
 await expect(ws).toHaveAttribute('data-dock-rail','out',{timeout:9000});await expect(ws).toHaveAttribute('data-dock-panel','out');
 const stage=await page.locator('.stagebox').boundingBox(),timeline=await page.locator('.tlwrap').boundingBox();expect(timeline.height).toBeGreaterThan(stage.height*0.85);
 await page.mouse.move(2,200);await expect(ws).toHaveAttribute('data-dock-rail','in');
 await page.mouse.move(1364,200);await expect(ws).toHaveAttribute('data-dock-panel','in');
 await page.mouse.move(600,200);await page.keyboard.press('[');await expect(ws).toHaveAttribute('data-dock-rail','out');
});

test('free accounts cannot export more than 2 minutes, one scene or all scenes joined; the export panel shows no plan card',async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Limit');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 const key=t=>({id:`k${t}`,t,cx:.5,cy:.5,zoom:1,ease:'linear'});
 await page.evaluate(k=>{window.__toon.S.camKeys.push(k);window.__toon.S.dirty=true;},key(130));
 await page.locator('.tabs.big').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.locator('.exp-plan')).toHaveCount(0);await expect(page.getByText(/Paid account|Free account|per export/)).toHaveCount(0);
 await page.locator('.hdr-tools').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.getByText(/free account se ek baar me sirf 2 min/).first()).toBeVisible();
 expect(await page.evaluate(()=>window.__toon.S.exporting)).toBe(false);await expect(page.locator('.busy')).toHaveCount(0);
 // two scenes of 70 s each: 140 s joined is too long
 await page.evaluate(()=>{window.__toon.S.camKeys.length=0;window.__toon.S.camKeys.push({id:'a',t:70,cx:.5,cy:.5,zoom:1,ease:'linear'});window.__toon.S.dirty=true;});
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 await page.evaluate(()=>{window.__toon.S.camKeys.length=0;window.__toon.S.camKeys.push({id:'b',t:70,cx:.5,cy:.5,zoom:1,ease:'linear'});window.__toon.S.dirty=true;});
 await page.locator('.upload-tools>summary').click();await page.locator('.tabs.big').getByRole('button',{name:'Audio',exact:true}).click();await page.locator('.tabs.big').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.locator('.exp-summary')).toContainText('Length · 2 scenes');await expect(page.locator('.exp-summary')).toContainText('141.0 s');
 await page.locator('.hdr-tools').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.getByText(/Aapka video 2 min 21 s lamba hai/).first()).toBeVisible();
 expect(await page.evaluate(()=>window.__toon.S.exporting)).toBe(false);
});

test('preview quality sits in the header, and projects saved before animation-length scenes get the length of their animation',async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Quality');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 await expect(page.locator('.toast').filter({hasText:/khul nahi paya|nahi ho paya/})).toHaveCount(0);
 await expect(page.locator('.hdr-tools').getByLabel('Preview quality')).toBeVisible();await expect(page.locator('.controls').getByLabel('Preview quality')).toHaveCount(0);
 await page.locator('.tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'Add character',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();
 await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
 await page.locator('.tabs.big').getByRole('button',{name:'Animations',exact:true}).click();
 const category=page.getByLabel('Animation category');const arms=await category.locator('option').evaluateAll(o=>o.find(x=>/Hands & arms/i.test(x.textContent))?.value);expect(arms).toBeTruthy();await category.selectOption(arms);
 await page.locator('.animation-apply').first().click();
 const length=await page.evaluate(()=>Object.values(window.__toon.S.solo)[0].bodyLen);expect(length).toBeGreaterThan(0);expect(length).toBeLessThan(8);
 const restored=await page.evaluate(()=>{const {S,fillSoloLengths}=window.__toon;const solo=Object.values(S.solo)[0];delete solo.bodyLen;fillSoloLengths({solo:S.solo,speakers:S.speakers});return solo.bodyLen;});
 expect(restored).toBe(length);
});

test('tool menu and side panel can be dragged anywhere, keep their place after reload, leave a button when idle, and dock back on double click',async({page})=>{
 await page.setViewportSize({width:1366,height:800});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Float');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 const rail=page.locator('#app .tabs.big'),panel=page.locator('#app .panel');
 await rail.getByRole('button',{name:'Export',exact:true}).click();await expect(panel).toBeVisible();
 const drag=async(handle,dx,dy)=>{const box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+Math.min(10,box.height/2));await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+Math.min(10,box.height/2)+dy,{steps:6});await page.mouse.up();};
 const docked=await rail.boundingBox();
 await drag(page.locator('.dock-grip'),380,100);
 const moved=await rail.boundingBox();expect(moved.x).toBeGreaterThan(docked.x+300);expect(moved.y).toBeGreaterThan(docked.y+60);
 await expect(rail).toHaveClass(/free/);
 await drag(page.locator('.sheet-close'),-520,70);
 const panelBox=await panel.boundingBox();expect(panelBox.x).toBeLessThan(900);await expect(panel).toHaveClass(/free/);
 // the menus still work where they were dropped
 await rail.locator('.upload-tools>summary').click();await rail.getByRole('button',{name:'Audio',exact:true}).click();await expect(panel.locator('.sheet-close b')).toContainText('Audio');
 // the position is remembered
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('12toons.studio.layout')));expect(saved.railPos.x).toBeGreaterThan(300);expect(saved.panelPos.w).toBeGreaterThan(200);
 await page.reload();await expect.poll(()=>page.evaluate(()=>window.__toon?.S.ready)).toBe(true);
 await expect(rail).toHaveClass(/free/);expect(Math.abs((await rail.boundingBox()).x-moved.x)).toBeLessThan(3);
 // idle: both menus slide away and leave a small round button where they were
 await page.mouse.move(700,600);
 await expect(page.locator('.dock-pill.show')).toHaveCount(2,{timeout:12000});
 const pillBox=await page.locator('.dock-pill.show').first().boundingBox();await page.mouse.move(pillBox.x+pillBox.width/2,pillBox.y+pillBox.height/2);   // the pill hides itself as soon as the menu is back
 await expect(page.locator('.ws')).toHaveAttribute('data-dock-rail','in');
 // double click docks it back at the edge
 await page.locator('.dock-grip').dblclick();await expect(rail).not.toHaveClass(/free/);
 expect((await rail.boundingBox()).x).toBeLessThan(40);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('12toons.studio.layout')).railPos)).toBe(null);
});
