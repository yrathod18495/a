import { test, expect } from '@playwright/test';
async function openStudio(page) {
  await page.setViewportSize({width:1366,height:768});
  await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
  await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button',{name:'Create New Project',exact:true}).click();
  await page.getByRole('textbox',{name:'Create a project'}).fill('Preview quality');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
}
async function addNeha(page) {
  await page.locator('#app .tabs.big').getByRole('button',{name:'Characters',exact:true}).click();
  await page.getByRole('button',{name:'＋ Add character',exact:true}).click();
  await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
}
test('preview modes alter canvas, GPU budgets and playback cadence without changing scene or export settings',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openStudio(page);await addNeha(page);
  const original=await page.evaluate(()=>({quality:window.__toon.S.quality,fps:window.__toon.S.fps,xf:window.__toon.S.speakers[0].xf||null,cam:window.__toon.S.camKeys}));
  for(const [mode,short,maxTex,fps] of [['low',180,512,12],['medium',480,1024,24],['high',1080,4096,60]]){
    await page.getByLabel('Preview quality').selectOption(mode);
    await expect(page.getByLabel('Preview quality')).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>window.__toon.stage.H)).toBe(short);
    const sizes=await page.evaluate(()=>[...window.__toon.stage.assets.values()].flatMap(asset=>[...asset.pages.values()].map(t=>Math.max(t.w,t.h))));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(maxTex);
    await page.getByTitle('Back to start').click();await page.getByRole('button',{name:'▶ Play',exact:true}).click();
    const start=await page.evaluate(()=>({n:window.__toon.metrics.renderCount,t:performance.now(),position:window.__toon.player.time}));
    await page.waitForTimeout(1050);
    const end=await page.evaluate(()=>({n:window.__toon.metrics.renderCount,t:performance.now(),position:window.__toon.player.time}));
    expect(end.n-start.n).toBeGreaterThan(1);expect(end.n-start.n).toBeLessThanOrEqual(fps*(end.t-start.t)/1000+3);
    expect(end.position-start.position).toBeGreaterThan(.7);
    await page.getByRole('button',{name:'⏸ Pause',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath(`preview-${mode}.png`)});
  }
  expect(await page.evaluate(()=>({quality:window.__toon.S.quality,fps:window.__toon.S.fps,xf:window.__toon.S.speakers[0].xf||null,cam:window.__toon.S.camKeys}))).toEqual(original);
  await page.getByLabel('Preview quality').selectOption('low');await expect(page.getByLabel('Preview quality')).toBeEnabled();
  await page.waitForTimeout(1200);await page.reload();await expect(page.getByLabel('Preview quality')).toHaveValue('low');
  await expect.poll(()=>page.evaluate(()=>window.__toon?.stage?.H)).toBe(180);
  await page.locator('#app .tabs.big').getByRole('button',{name:'Animations',exact:true}).click();
  await expect(page.getByRole('button',{name:'+ Import',exact:true})).toHaveCount(0);
  await expect(page.locator('.animation-filters input[type=file]')).toHaveCount(0);
  expect(await page.getByLabel('Animation category').locator('option').allTextContents()).not.toContain('Custom');
  await page.setViewportSize({width:390,height:844});
  const timeline=await page.locator('#app .tlwrap').boundingBox();expect(timeline.y+timeline.height).toBeLessThanOrEqual(844);
  expect(errors).toEqual([]);
});

test('low preview exports at selected video size, then restores the low GPU budget; failed upgrades roll back',async({page})=>{
  page.on('console',message=>{if(message.type()==='error')console.log('Export console:',message.text());});
  await openStudio(page);await addNeha(page);
  await page.getByLabel('Preview quality').selectOption('low');await expect(page.getByLabel('Preview quality')).toBeEnabled();
  await page.evaluate(()=>{window.__toon.S.fps=5;});
  const downloadReady=page.waitForEvent('download');
  await page.locator('#app .hdr-tools').getByRole('button',{name:'⬇ Export',exact:true}).click();
  const download=await downloadReady;
  const {readFile}=await import('node:fs/promises');const bytes=await readFile(await download.path());
  const dimensions=await page.evaluate(async base64=>{
    const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'video/webm'});
    const url=URL.createObjectURL(blob),video=document.createElement('video');video.src=url;
    await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});
    const size=[video.videoWidth,video.videoHeight];URL.revokeObjectURL(url);return size;
  },bytes.toString('base64'));
  expect(dimensions).toEqual([1280,720]);await expect(page.locator('.busy')).toHaveCount(0);
  expect(await page.evaluate(()=>[window.__toon.stage.H,window.__toon.stage.maxTex])).toEqual([180,512]);
  await page.evaluate(()=>{
    window.__bitmapBackup=window.createImageBitmap;let calls=0;
    window.createImageBitmap=(...args)=>{if(++calls===2)return Promise.reject(Error('Simulated graphics memory failure'));return window.__bitmapBackup(...args);};
  });
  await page.getByLabel('Preview quality').selectOption('high');await expect(page.getByLabel('Preview quality')).toBeEnabled();
  await expect(page.getByLabel('Preview quality')).toHaveValue('low');
  expect(await page.evaluate(()=>[window.__toon.stage.H,window.__toon.stage.maxTex])).toEqual([180,512]);
  await expect(page.locator('.toast').filter({hasText:/Preview quality badal nahi payi/})).toBeVisible();
  await page.evaluate(()=>{window.createImageBitmap=window.__bitmapBackup;});
});
