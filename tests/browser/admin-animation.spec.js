import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { installLibrary, ZIP, haveZip } from './studio-library.js';

test('published admin clips appear for their pose; users have no animation import, admin form publishes scoped metadata',async({page})=>{
  test.skip(!haveZip(), 'needs the character ZIP');
  test.setTimeout(120000);
  // a real walk of the character ZIP: the admin "publishes" it for the library character's pose (ch-<character id>-<view>)
  const zip=await JSZip.loadAsync(readFileSync(ZIP)),manifest=JSON.parse(await zip.file('manifest.json').async('string')),view=manifest.views.find(v=>v.id==='f34')||manifest.views[0];
  const walk=view.animations.find(a=>a.layer==='body'&&/walk/i.test(a.name))||view.animations.find(a=>a.layer==='body');
  const raw=JSON.parse(await zip.file(walk.file).async('string'));
  const motion=raw.bone?raw:Object.values(raw)[0];motion._sourceFrameRate=30;
  const server=await installLibrary(page);          // "Neha" comes from the admin's character library (no character is bundled)
  const target=`ch-${[...server.characters.keys()][0]}-${view.id}`;
  const asset={id:'admin_motion_review_1234',type:'animation',name:'Admin test walk',target,layer:'body',frameRate:30,length:motion.duration/30,size:100,mime:'application/json',updatedAt:new Date().toISOString()};
  await page.route('**/src/studio-assets.js*',route=>route.fulfill({contentType:'text/javascript',body:`
    const assets=[${JSON.stringify(asset)}];
    export const listStudioAssets=async()=>assets;
    export const loadStudioAnimation=async()=>(${JSON.stringify(motion)});
    export const saveStudioAsset=async()=>{},deleteStudioAsset=async()=>{},downloadStudioAsset=async()=>{},setPropGroup=async()=>{},setAssetAccess=async()=>{},makeThumb=async()=>null;
    export const saveStudioAnimation=async(name,file,values)=>{window.__publishedAnimation={name,file:file.name,...values};assets.push({...assets[0],id:'new_animation_review_123',name,...values});return assets.at(-1)};
  `}));
  await page.goto('/?debug#/toons');await page.getByRole('button',{name:'Create New Project',exact:true}).click();await page.getByRole('textbox',{name:'Create a project'}).fill('Admin clips');await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.locator('#app .tabs.big').getByRole('button',{name:'Characters',exact:true}).click();await page.locator('.cp-card').filter({hasText:/^Neha$/}).click();await page.locator('.cp-poses .pose').first().click();
  await expect.poll(()=>page.evaluate(()=>window.__toon.stage.layers.length)).toBe(1);
  await page.locator('#app .tabs.big').getByRole('button',{name:'Animations',exact:true}).click();await page.locator('.anim-cat[data-cat="managed:body"]').click();
  await page.getByTitle('Apply Admin test walk',{exact:true}).click();await expect(page.locator('.animation-apply[aria-pressed=true]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'+ Import',exact:true})).toHaveCount(0);
  await page.goto('/?debug#/hub');
  await page.evaluate(async()=>{const {assetsView}=await import('/src/admin-assets.js');document.querySelector('#shell').replaceChildren(await assetsView({user:{uid:'admin-review'},home:()=>{},back:()=>{},toast:message=>{window.__adminToast=message;}}));});
  await page.getByRole('tab',{name:'Add Animation'}).click();
  await page.getByLabel('Animation name',{exact:true}).fill('Published wave');await page.getByLabel('Character and pose').selectOption(target);await page.getByLabel('Animation layer').selectOption('hand');await page.getByLabel('Source frame rate').fill('30');
  await page.getByLabel('Animation JSON').setInputFiles({name:'wave.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(motion))});
  await page.getByRole('button',{name:'Publish animation',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__publishedAnimation)).toEqual({name:'Published wave',file:'wave.json',target,layer:'hand',frameRate:30});
  await expect(page.locator('.admin-animation-record').filter({hasText:'Published wave'})).toBeVisible();
});
