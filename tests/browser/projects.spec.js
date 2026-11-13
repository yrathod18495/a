import {test,expect} from '@playwright/test';
async function setup(page){
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
 await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 // These UI tests exercise local storage only; missing bundled catalogs use empty fixtures.
 await page.route('**/12toons/*.json',r=>r.fulfill({json:r.request().url().endsWith('/groups.json')?[]:{characters:[]}}));
 await page.goto('/?debug#/toons');
 await expect(page.getByRole("heading",{name:"Animator Studio Projects"})).toBeVisible();
}
test('maintenance never blocks signing in: anonymous visitors reach the login page for private routes and direct admin URLs',async({page})=>{
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:true}}));
 await page.goto('/#/admin');
 await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 await page.goto('/#/hub');
 await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 await page.goto('/admin');
 await expect(page).toHaveURL(/#\/login$/);
 await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
});
test('expanded FAQ and complete legal pages are linked and render by direct URL',async({page})=>{
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
 await page.goto('/?debug#/');
 await expect(page.locator('.lp-faq details')).toHaveCount(8);
 await expect(page.locator('.lp-editor,.lp-gallery-grid,#examples,.lp-hero-visual')).toHaveCount(0);
 await expect(page.locator('.lp-hero img,video')).toHaveCount(1);   // the export medallion picture became a drawn gold coin
 await page.getByRole('link',{name:'Terms of Use'}).click();
 await expect(page.getByRole('heading',{name:'Terms of Use'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Your projects and uploaded material'})).toBeVisible();
 await page.getByRole('link',{name:'Website Licence'}).first().click();
 await expect(page.getByRole('heading',{name:'Website Licence'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Third-party software and services'})).toBeVisible();
 await page.goto('/website-license');
 await expect(page).toHaveURL(/#\/website-license$/);
 await expect(page.getByRole('heading',{name:'Website Licence'})).toBeVisible();
});
test('brightness preference persist across landing, legal and studios',async({page})=>{
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
 await page.route('**/api/r2',r=>r.fulfill({json:{configured:false}}));
 await page.addInitScript(()=>{if(!localStorage.getItem('12toons-theme'))localStorage.setItem('12toons-theme','day');});
 await page.goto('/?debug#/');
 expect(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
 await page.locator('.sh-avatar').click();
 await page.getByRole('button',{name:/Switch to night mode/}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','night');
 await page.getByRole('link',{name:'Terms of Use'}).first().click();
 await expect(page.getByRole('heading',{name:'Terms of Use'})).toBeVisible();
 await page.goto('/?debug#/toons');
 await expect(page.getByRole("heading",{name:"Animator Studio Projects"})).toBeVisible();
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();
 await page.getByRole('button',{name:'Cancel'}).click();
 await page.goto('/?debug#/characters');
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();
 await page.getByRole('textbox',{name:'Create a project'}).fill('Royal Character');
 await page.getByRole('button',{name:'Create project'}).click();
 await expect(page.locator('.cs-stage')).toBeVisible();
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','night');
 await expect(page.locator('.cs-stage')).toBeVisible();
 await page.goto('/?debug#/');
 await page.locator('.sh-avatar').click();
 await page.getByRole('button',{name:/Switch to day mode/}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','day');
 expect(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
 await page.locator('.sh-avatar').click();
 await expect(page.getByRole('button',{name:/Switch to night mode/})).toBeVisible();
});
test('affiliate partner form explains data use and confirms successful submission',async({page})=>{
 await page.route('**/api/security',r=>r.fulfill({json:{maintenance:false}}));
 await page.route('**/api/affiliates',async r=>{const body=r.request().postDataJSON();if(body.action==='submit'&&body.consent)await r.fulfill({status:201,json:{submitted:true,id:'affiliate-fixture'}});else await r.fulfill({status:400,json:{error:'Invalid submission'}});});
 await page.goto('/affiliate-partners');
 await expect(page).toHaveURL(/#\/affiliates$/);
 await expect(page.getByRole('heading',{name:'Become an Affiliate Partner'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Terms of Use'})).toBeVisible();
 await page.getByLabel('Your name').fill('Asha Creator');
 await page.getByLabel('Email address').fill('asha@example.com');
 await page.getByLabel('Phone or WhatsApp number').fill('+91 98765 43210');
 await page.getByLabel('Company or creator brand').fill('Asha Studio');
 await page.getByLabel('Platform').selectOption('YouTube');
 await page.getByLabel('Channel or profile link').fill('https://youtube.com/@asha');
 await page.getByLabel(/I agree that 12toons/).check();
 await page.getByRole('button',{name:'Submit partnership request'}).click();
 await expect(page.getByRole('status')).toContainText('your partnership request has been sent');
});
// the studio logo now leaves for the home page, so the picker is opened by its address
async function openProjects(page){
 await page.evaluate(()=>{location.hash='#/toons';});
 await expect(page.getByRole("heading",{name:"Animator Studio Projects"})).toBeVisible();
}
async function create(page,name){
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Create a project'})).toBeVisible();
 await page.getByRole('textbox',{name:'Create a project'}).fill(name);
 await page.getByRole('button',{name:'Create project'}).click();
 await expect(page.locator('#app')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>!!window.__toon?.S.ready)).toBe(true);
}
test('project picker, rename, reopen, delete, independent camera data',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 await create(page,'First');
 const first=page.url();
 await page.evaluate(()=>{window.__toon.S.aspect='4:5';window.__toon.S.camKeys=[{id:'camera1',t:0,zoom:2,cx:100,cy:200}];});
 await page.waitForTimeout(1200);
 await openProjects(page);
 await create(page,'Second');
 expect(await page.evaluate(()=>window.__toon.S.camKeys)).toEqual([]);
 await page.goto(first);
 await page.waitForFunction(()=>window.__toon?.S.ready&&window.__toon.S.camKeys.length===1);
 expect(await page.evaluate(()=>window.__toon.S.aspect)).toBe('4:5');
 await openProjects(page);
 const card=page.locator('.project-card').filter({has:page.getByText('First',{exact:true})});
 await card.getByRole('button',{name:'Rename'}).click();
 await expect(page.getByRole('dialog',{name:'Rename project'})).toBeVisible();
 await page.getByRole('textbox',{name:'Rename project'}).fill('First renamed');
 await page.getByRole('button',{name:'Save name'}).click();
 await expect(page.getByText('First renamed',{exact:true})).toBeVisible();
 const second=page.locator('.project-card').filter({has:page.getByText('Second',{exact:true})});
 await second.getByRole('button',{name:'Delete'}).click();
 await expect(page.getByRole('dialog',{name:'Delete this project?'})).toBeVisible();
 await page.getByRole('button',{name:'Delete project'}).click();
 await expect(page.getByText('Second',{exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('DragonBones character draft with image and colour edit restores and remains editable',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 const id=await page.evaluate(async()=>{
  const s=await import('/src/store.js'),{rigInfo}=await import('/src/db/info.js'),{faceDefaults}=await import('/src/rigedit.js');
  const p=await s.createProject('debug','character','Rig draft');s.selectProject('debug',p.id);
  const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);
  const image=await new Promise(r=>c.toBlob(r,'image/png'));
  const ske={version:'5.5',compatibleVersion:'5.5',name:'Fixture',frameRate:24,armature:[{name:'Fixture',type:'Armature',frameRate:24,bone:[{name:'root',transform:{}}],slot:[{name:'body',parent:'root',displayIndex:0}],skin:[{name:'default',slot:[{name:'body',display:[{name:'body',path:'body',type:'image',transform:{}}]}]}],animation:[]}]};
  const def={id:'draft-fixture',name:'Fixture',ske,rig:rigInfo(ske),tex:[{json:{name:'Fixture',imagePath:'texture.png',width:32,height:32,SubTexture:[{name:'body',x:0,y:0,width:32,height:32}]},image}],anims:[]};
  await s.put('draft',{id:'current',def,state:{hide:[],locked:[],xf:{},attach:{},face:faceDefaults(),skins:null,name:'My draft',tab:'layers',zoom:'wide'},edits:[['body',{hue:25,sat:1,light:0,img:null,removed:false,fill:false}]]});
  return p.id;
 });
 await page.goto('/?debug#/characters/'+id);await page.reload();
 await expect(page.locator('.cs-panel')).toBeVisible();
 // creators only get Start / Create / Save: a draft saved on the old 'layers' tab opens on Start instead of a tab that no longer exists
 await expect(page.locator('.cs-tabs button')).toHaveText(['Start','Create','Save']);await expect(page.locator('.cs-tabs button.on')).toHaveText('Start');
 for(const gone of ['Layers','Face','Animations','Body','Outfit'])await expect(page.locator('.cs-tabs').getByRole('button',{name:gone,exact:true})).toHaveCount(0);
 await expect(page.getByText('Edit a template')).toHaveCount(0);
 await page.waitForTimeout(1600);
 const saved=await page.evaluate(async()=>{const s=await import('/src/store.js');return (await s.get('draft','current')).state.fit;});
 await page.reload();await expect(page.locator('.cs-panel')).toBeVisible();
 const restored=await page.evaluate(async()=>{const s=await import('/src/store.js');const d=await s.get('draft','current');return {fit:d.state.fit,hue:d.edits[0][1].hue,bytes:d.def.tex[0].image.size};});
 expect(restored.fit).toEqual(saved);expect(restored.hue).toBe(25);expect(restored.bytes).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});
test('character projects show picker and empty drafts reopen without errors',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
 await page.goto('/?debug#/characters');
 await page.getByRole('button',{name:'Create New Project',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Create a project'})).toBeVisible();
 await page.getByRole('textbox',{name:'Create a project'}).fill('Character draft');
 await page.getByRole('button',{name:'Create project'}).click();
 await expect(page.locator('.cs-panel')).toBeVisible();await page.reload();
 await expect(page.locator('.cs-panel')).toBeVisible();
 expect(errors).toEqual([]);
});
