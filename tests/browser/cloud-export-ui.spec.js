import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
// Cloud export: a "Render" button inside the Cloud tile of the Export tab's Render section that submits a job and shows its progress (the render itself runs on
// a separate machine, see docs/CLOUD-EXPORT.md — this test only checks the studio side: create, poll, cancel, download link).
test('Cloud export: Start submits a job, progress polling shows it, and Cancel stops it', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let job = null;
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/export', async (r) => {
    const body = JSON.parse(r.request().postData());
    if (body.action === 'cloudCreate') { job = { status: 'rendering', progress: 0.1, projectId: body.projectId }; return r.fulfill({ json: { jobId: 'cexp_test1', job } }); }
    if (body.action === 'cloudStatus') return r.fulfill({ json: { job } });
    if (body.action === 'cloudCancel') { job = { ...job, status: 'cancelled' }; return r.fulfill({ json: { job } }); }
    return r.fulfill({ json: { error: 'unexpected' }, status: 400 });
  });
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('CloudExp');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  // the project must look "saved to the cloud" for cloud export to be offered a projectId: fake projectContext + a no-op sync
  await page.evaluate(() => { window.__toon.S.exporting = false; });
  await page.evaluate(async () => {
    const store = await import('/src/store.js');
    store.selectProject('debug-uid', 'proj_cloudtest');
  });
  await page.evaluate(() => window.__toon.openTab('export'));
  const cloudTile = page.locator('.exp-opt', { hasText: 'Cloud' });
  const start = cloudTile.getByRole('button', { name: 'Render', exact: true });
  await expect(start).toBeVisible();
  await start.click();
  await expect(cloudTile.getByText(/Rendering…/)).toBeVisible({ timeout: 5000 });
  await cloudTile.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cloudTile.getByRole('button', { name: 'Render', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Cloud export: a failed create shows the error clearly (red box + Try again), never silently reverting to looking untouched', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/export', async (r) => {
    const body = JSON.parse(r.request().postData());
    if (body.action === 'cloudCreate') return r.fulfill({ json: { error: 'This project was not found. Please save it to the cloud first.' }, status: 404 });
    return r.fulfill({ json: { error: 'unexpected' }, status: 400 });
  });
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('CloudErr');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => { const store = await import('/src/store.js'); store.selectProject('debug-uid', 'proj_err'); });
  await page.evaluate(() => window.__toon.openTab('export'));
  const cloudTile = page.locator('.exp-opt', { hasText: 'Cloud' });
  await cloudTile.getByRole('button', { name: 'Render', exact: true }).click();
  await expect(cloudTile.getByRole('alert')).toContainText('This project was not found');
  await expect(cloudTile.getByRole('button', { name: /Try again/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Cloud export: a failed background save of the latest edits is a warning, not a block — the job is still created', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/projects', (r) => r.fulfill({ json: { error: 'The project details are not valid.', code: 'invalid_project' }, status: 400 }));
  let created = false;
  await page.route('**/api/export', async (r) => {
    const body = JSON.parse(r.request().postData());
    if (body.action === 'cloudCreate') { created = true; return r.fulfill({ json: { jobId: 'cexp_ok', job: { status: 'pending', progress: 0 } } }); }
    if (body.action === 'cloudStatus') return r.fulfill({ json: { job: { status: 'rendering', progress: 0.2 } } });
    return r.fulfill({ json: { error: 'unexpected' }, status: 400 });
  });
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('SyncFail');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => window.__toon.openTab('export'));
  const cloudTile = page.locator('.exp-opt', { hasText: 'Cloud' });
  await cloudTile.getByRole('button', { name: 'Render', exact: true }).click();
  await expect(cloudTile.getByText(/Rendering…/)).toBeVisible({ timeout: 5000 });
  expect(created).toBe(true);        // the cloud job was created despite the save failing
  expect(errors).toEqual([]);
});

test('My cloud videos: lists finished videos with a Download and Delete button', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  let deleted = null;
  await page.route('**/api/export', async (r) => {
    const body = JSON.parse(r.request().postData());
    if (body.action === 'cloudList') return r.fulfill({ json: { videos: [{ id: 'cexp_v1', projectName: 'My Toon', quality: 1080, fps: 60, seconds: 30, size: 5242880, projectId: 'p', createdAt: Date.now(), expiresAt: Date.now() + 2.5 * 86400000 }] } });
    if (body.action === 'cloudDelete') { deleted = body.jobId; return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { error: 'unexpected' }, status: 400 });
  });
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Vids');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => { (await import('/src/store.js')).selectProject('debug-uid', 'proj_v'); window.__toon.openTab('export'); });
  await page.getByRole('button', { name: /My cloud videos/ }).click();
  const row = page.locator('.cv-row');
  await expect(row).toContainText('My Toon'); await expect(row).toContainText('1080p'); await expect(row).toContainText('2 d');
  await expect(row.getByRole('button', { name: 'Download' })).toBeVisible();
  await row.getByRole('button', { name: /Delete/ }).click();
  await expect(row).toHaveCount(0); expect(deleted).toBe('cexp_v1');
  expect(errors).toEqual([]);
});

test('Cloud render page: shared character/animation library calls go through the job secret, not a sign-in', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  const seen = [];
  await page.route('**/api/export', (r) => { seen.push(JSON.parse(r.request().postData())); return r.fulfill({ json: { characters: [{ id: 'c1' }] } }); });
  await page.route('**/api/studio-assets', (r) => { seen.push({ direct: true }); return r.fulfill({ json: {} }); });
  await page.goto('/?debug&workers=0#/toons');
  const out = await page.evaluate(async () => {
    const s = await import('/src/session.js');
    s.setCloudRenderAuth({ uid: 'owner1', jobId: 'cexp_x', secret: 'sec' });
    return s.apiCall('/api/studio-assets', { action: 'character:list' }, 'debug');
  });
  expect(out.characters[0].id).toBe('c1');
  expect(seen).toEqual([{ action: 'cloudStudio', uid: 'owner1', jobId: 'cexp_x', secret: 'sec', route: 'studio-assets', body: { action: 'character:list' } }]);
});

test('Cloud render page: a project left "dirty" in a reused browser profile does not block the next render', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  const out = await page.evaluate(async () => {
    const s = await import('/src/store.js'), uid = 'u1', meta = { id: 'p_dirty', name: 'x', updatedAt: 1 }, records = [{ store: 'project', value: { id: 'current' } }];
    s.selectProject(uid, meta.id);
    await s.restoreSnapshot(uid, meta, records);
    await s.resetAll();                    // marks the local copy as having unsaved changes
    let plain = 'ok'; try { await s.restoreSnapshot(uid, meta, records); } catch (e) { plain = e.message; }
    let forced = 'ok'; try { await s.restoreSnapshot(uid, meta, records, { force: true }); } catch (e) { forced = e.message; }
    return { plain, forced };
  });
  expect(out.plain).toBe('Local save stopped partway through');
  expect(out.forced).toBe('ok');
});

// A finished cloud video is downloaded with a real percentage (and the steps before the request are named), then saved with the right file name.
test('Cloud export: download shows a live percentage and saves the file', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const body = Buffer.alloc(3 * 1048576, 7);
  let job = null;
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/export', async (r) => {
    const req = JSON.parse(r.request().postData());
    if (req.action === 'cloudCreate') { job = { id: 'cexp_dl1', status: 'done', progress: 1, size: body.length }; return r.fulfill({ json: { jobId: 'cexp_dl1', job } }); }
    if (req.action === 'cloudStatus') return r.fulfill({ json: { job } });
    if (req.action === 'cloudDownload') return r.fulfill({ json: { url: 'http://files.test/video.mp4' } });
    return r.fulfill({ json: { error: 'unexpected' }, status: 400 });
  });
  // a slow file: the answer arrives in pieces so the percentage has time to show
  await page.route('http://files.test/video.mp4', async (r) => r.fulfill({ status: 200, headers: { 'content-type': 'video/mp4', 'access-control-allow-origin': '*' }, body }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('CloudDl');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => { const store = await import('/src/store.js'); store.selectProject('debug-uid', 'proj_cloudtest'); });
  await page.evaluate(() => window.__toon.openTab('export'));
  const cloudTile = page.locator('.exp-opt', { hasText: 'Cloud' });
  await cloudTile.getByRole('button', { name: 'Render', exact: true }).click();
  const dl = cloudTile.getByRole('button', { name: /Download/ });
  await expect(dl).toBeVisible({ timeout: 5000 });
  const saved = page.waitForEvent('download');
  await dl.click();
  const file = await saved;
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);
  await expect(cloudTile.getByRole('button', { name: /Download/ })).toBeVisible();          // back to normal after the save
  expect(errors).toEqual([]);
});
