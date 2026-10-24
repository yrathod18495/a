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
 await page.locator('.tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'＋ Add character',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);await expect(page.locator('.busy')).toHaveCount(0);
 await expect(page.locator('.lane2.audio')).toHaveCount(0);await expect(page.locator('.line-details')).toBeHidden();
 await page.locator('.tabs.big').getByRole('button',{name:'Animations',exact:true}).click();
 const category=page.getByLabel('Animation category');const talking=await category.locator('option').evaluateAll(options=>options.find(option=>/talking/i.test(option.textContent))?.value);expect(talking).toBeTruthy();await category.selectOption(talking);await page.locator('.animation-apply').first().click();await expect(page.locator('.busy')).toHaveCount(0);
 const length=await page.evaluate(()=>Object.values(window.__toon.S.solo)[0].bodyLen);expect(length).toBeGreaterThan(0);expect(length).not.toBe(8);expect(await page.evaluate(()=>window.__toon.player.total)).toBeCloseTo(Math.max(1,length),2);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__toon.player.total)).toBe(8);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__toon.player.total)).toBeCloseTo(Math.max(1,length),2);
 await page.evaluate(()=>{window.__toon.S.fps=5;window.__toon.S.quality=360;});await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 const ready=page.waitForEvent('download');await page.locator('.hdr-tools').getByRole('button',{name:'⬇ Export',exact:true}).click();const download=await ready;const {readFile}=await import('node:fs/promises');const data=await readFile(await download.path());
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
 const stage=await page.locator('.stagebox').boundingBox(),timeline=await page.locator('.tlwrap').boundingBox();expect(timeline.height).toBeGreaterThan(stage.height*0.9);
 await page.mouse.move(2,200);await expect(ws).toHaveAttribute('data-dock-rail','in');
 await page.mouse.move(1364,200);await expect(ws).toHaveAttribute('data-dock-panel','in');
 await page.mouse.move(600,200);await page.keyboard.press('[');await expect(ws).toHaveAttribute('data-dock-rail','out');
});

test('free accounts cannot export more than 2 minutes, one scene or all scenes joined, and the export panel explains why',async({page})=>{
 await page.setViewportSize({width:1366,height:768});await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.goto('/?debug&workers=0#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Limit');await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.locator('#app .stagebox canvas')).toBeVisible();
 const key=t=>({id:`k${t}`,t,cx:.5,cy:.5,zoom:1,ease:'linear'});
 // one 130 s scene
 await page.evaluate(k=>{window.__toon.S.camKeys.push(k);window.__toon.S.dirty=true;},key(130));
 await page.locator('.tabs.big').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.locator('.exp-plan')).toContainText('Free account');await expect(page.locator('.exp-plan')).toContainText('up to 2 min');
 await expect(page.locator('.exp-plan.over')).toContainText('free accounts can export up to 2 min');
 await page.locator('.hdr-tools').getByRole('button',{name:'⬇ Export',exact:true}).click();
 await expect(page.getByText(/free accounts can export up to 2 min/).first()).toBeVisible();
 expect(await page.evaluate(()=>window.__toon.S.exporting)).toBe(false);await expect(page.locator('.busy')).toHaveCount(0);
 // two scenes of 70 s each: fine one by one, too long joined
 await page.evaluate(()=>{window.__toon.S.camKeys.length=0;window.__toon.S.camKeys.push({id:'a',t:70,cx:.5,cy:.5,zoom:1,ease:'linear'});window.__toon.S.dirty=true;});
 await page.getByRole('button',{name:'+ New Scene',exact:true}).click();await expect(page.getByRole('tab',{name:'Scene 2',exact:true})).toHaveAttribute('aria-selected','true');
 await page.evaluate(()=>{window.__toon.S.camKeys.length=0;window.__toon.S.camKeys.push({id:'b',t:70,cx:.5,cy:.5,zoom:1,ease:'linear'});window.__toon.S.dirty=true;});
 await page.locator('.tabs.big').getByRole('button',{name:'Audio',exact:true}).click();await page.locator('.tabs.big').getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.locator('.exp-plan.over')).toBeVisible();
 await page.locator('.exp-group select[aria-label="Export scenes"]').selectOption('current');await expect(page.locator('.exp-plan.over')).toHaveCount(0);
 await page.locator('.exp-group select[aria-label="Export scenes"]').selectOption('all');await expect(page.locator('.exp-plan.over')).toBeVisible();
});
