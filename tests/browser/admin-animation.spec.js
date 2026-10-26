import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('published admin clips appear for their pose; users have no animation import, admin form publishes scoped metadata',async({page})=>{
  const raw=JSON.parse(await readFile(new URL('../../public/12toons/anims/front-side/9000.json',import.meta.url),'utf8'));
  const motion=raw.bone?raw:Object.values(raw)[0];motion._sourceFrameRate=60;
  const asset={id:'admin_motion_review_1234',type:'animation',name:'Admin test walk',target:'ad-neha-front-side',layer:'body',frameRate:60,length:motion.duration/60,size:100,mime:'application/json',updatedAt:new Date().toISOString()};
  await page.route('**/src/studio-assets.js*',route=>route.fulfill({contentType:'text/javascript',body:`
    const assets=[${JSON.stringify(asset)}];
    export const listStudioAssets=async()=>assets;
    export const loadStudioAnimation=async()=>(${JSON.stringify(motion)});
    export const saveStudioAsset=async()=>{},deleteStudioAsset=async()=>{},downloadStudioAsset=async()=>{};
    export const saveStudioAnimation=async(name,file,values)=>{window.__publishedAnimation={name,file:file.name,...values};assets.push({...assets[0],id:'new_animation_review_123',name,...values});return assets.at(-1)};
  `}));
  await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
  await page.goto('/?debug#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Admin clips');await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.locator('#app .tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.getByRole('button',{name:'Add character',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();
  await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
  await page.locator('#app .tabs.big').getByRole('button',{name:'Animations',exact:true}).click();await page.getByLabel('Animation category').selectOption('managed:body');
  await page.getByTitle('Apply Admin test walk',{exact:true}).click();await expect(page.locator('.animation-apply[aria-pressed=true]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'+ Import',exact:true})).toHaveCount(0);
  await page.goto('/?debug#/hub');
  await page.evaluate(async()=>{const {assetsView}=await import('/src/admin-assets.js');document.querySelector('#shell').replaceChildren(await assetsView({user:{uid:'admin-review'},home:()=>{},back:()=>{},toast:message=>{window.__adminToast=message;}}));});
  await page.getByRole('tab',{name:'🎬 Add Animation'}).click();
  await page.getByLabel('Animation name',{exact:true}).fill('Published wave');await page.getByLabel('Character and pose').selectOption('ad-neha-front');await page.getByLabel('Animation layer').selectOption('hand');await page.getByLabel('Source frame rate').fill('30');
  await page.getByLabel('Animation JSON').setInputFiles({name:'wave.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(motion))});
  await page.getByRole('button',{name:'Publish animation',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__publishedAnimation)).toEqual({name:'Published wave',file:'wave.json',target:'ad-neha-front',layer:'hand',frameRate:30});
  await expect(page.locator('.admin-animation-record').filter({hasText:'Published wave'})).toBeVisible();
});
