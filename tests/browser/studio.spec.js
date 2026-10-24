import { test, expect } from '@playwright/test';

async function studio(page, { width = 1366, height = 768, mode = 'day' } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(mode => localStorage.setItem('12toons-theme', mode), mode);
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Optimized studio');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
}
async function addCharacter(page) {
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: '＋ Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  await expect(page.getByLabel('Selected character name')).toBeVisible();
}
for (const mode of ['day', 'night']) for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`optimized studio stays within viewport: ${mode} ${viewport.width}`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await studio(page, { ...viewport, mode });
    const timeline = page.locator('#app .tlwrap');
    await expect(timeline).toBeVisible();
    const bounds = await timeline.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height + 1);
    await expect(page.locator('.advanced-tools-list')).toBeHidden();
    await page.locator('.advanced-tools summary').click();
    await page.locator('.advanced-tools-list').getByRole('button', { name: 'Camera', exact: true }).click();
    await expect(page.locator('.panel')).toContainText('Canvas size');
    await expect(page.locator('.advanced-tools-list')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`optimized-${mode}-${viewport.width}.png`) });
    expect(errors).toEqual([]);
  });
}
test('animation rows are virtualized; selection, playback, editor zoom and reset preserve scene data', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page); await addCharacter(page);
  await expect(page.getByTitle(/swap.*image/i)).toHaveCount(0);
  await page.getByLabel('Selected character name').fill('Rani'); await page.getByLabel('Selected character name').press('Tab');
  await expect.poll(() => page.evaluate(() => window.__toon.S.speakers[0].name)).toBe('Rani');
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Animations', exact: true }).click();
  const category = page.getByLabel('Animation category');
  const largest = await category.locator('option').evaluateAll(options => options.map(o => ({ value: o.value, n: Number(o.textContent.match(/\((\d+)\)$/)?.[1] || 0) })).sort((a, b) => b.n - a.n)[0]);
  await category.selectOption(largest.value);
  await expect(page.locator('.animation-row').first()).toBeVisible();
  expect(largest.n).toBeGreaterThan(20);
  expect(await page.locator('.animation-row').count()).toBeLessThan(largest.n);
  const list = page.getByLabel('Animation results'); const filterY = (await category.boundingBox()).y;
  await list.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect.poll(() => page.locator('.animation-row').last().evaluate(e => parseFloat(e.style.top))).toBe((largest.n - 1) * 64);
  expect((await category.boundingBox()).y).toBe(filterY);
  await page.getByLabel('Search animations').fill('walk');
  await page.locator('.animation-apply').first().click();
  await expect(page.locator('.animation-apply[aria-pressed=true]')).toHaveCount(1);
  await expect(page.locator('.busy')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__toon.metrics.framePending)).toBe(false);
  const count = await page.evaluate(() => window.__toon.metrics.renderCount);
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => window.__toon.metrics.renderCount)).toBe(count);
  const original = await page.evaluate(() => ({ W: window.__toon.stage.W, H: window.__toon.stage.H, cam: JSON.stringify(window.__toon.stage.camKeys), png: window.__toon.stage.out.toDataURL() }));
  await page.getByTitle('Zoom in editor').click();
  await expect(page.getByLabel('Editor zoom')).toHaveText('125%');
  await page.getByTitle('Fit scene in editor').click();
  await expect(page.getByLabel('Editor zoom')).toHaveText('100%');
  const after = await page.evaluate(() => ({ W: window.__toon.stage.W, H: window.__toon.stage.H, cam: JSON.stringify(window.__toon.stage.camKeys), png: window.__toon.stage.out.toDataURL() }));
  expect(after).toEqual(original);
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.metrics.renderCount)).toBeGreaterThan(count + 1);
  await page.getByRole('button', { name: '⏸ Pause', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.metrics.framePending)).toBe(false);
  await expect(page.getByRole('button', { name: 'Reset this project…' })).toBeHidden();
  await page.getByLabel('More studio actions').click();
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Reset this project…' }).click();
  expect(await page.evaluate(() => window.__toon.S.speakers[0].name)).toBe('Rani');
  await page.screenshot({ path: testInfo.outputPath('optimized-character.png') });
  await page.waitForTimeout(1200); await page.reload();
  await expect.poll(() => page.evaluate(() => window.__toon?.stage?.layers.length)).toBe(1);
  expect(await page.evaluate(() => window.__toon.S.speakers[0].name)).toBe('Rani');
  expect(errors).toEqual([]);
});

test('unused saved templates stay unloaded and CSS zoom leaves encoded video dimensions intact', async ({ page }) => {
  const rigs = [];
  page.on('request', request => { if (request.url().includes('_ske.json')) rigs.push(request.url()); });
  await studio(page);
  await page.evaluate(async () => {
    const store = await import('/src/store.js');
    await store.put('characters', { id: 'unused-save', name: 'Unused character', base: 'lib:ad-mybaby-front-side', profile: {}, pages: {} });
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
  expect(rigs).toEqual([]);
  await addCharacter(page);
  expect(rigs.filter(url => url.includes('/mybaby/'))).toEqual([]);
  await page.getByTitle('Zoom in editor').click();
  const result = await page.evaluate(async () => {
    const { stage } = window.__toon;
    const original = { W: stage.W, H: stage.H, zoom: window.__toon.S.editorZoom };
    const { exportOffline, canExportOffline } = await import('/src/exporter.js');
    if (!await canExportOffline(320, 180, 5, 'webm', true)) return { supported: false };
    stage.setSize('16:9', 180);
    try {
      const result = await exportOffline({ stage, clips: [], plan: [], total: .6, fps: 5, level: 'low', format: 'webm', onProgress: () => {}, cancelled: () => false });
      const video = document.createElement('video'); video.src = URL.createObjectURL(result.blob);
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
      const dimensions = { w: video.videoWidth, h: video.videoHeight };
      URL.revokeObjectURL(video.src);
      return { supported: true, bytes: result.blob.size, ...dimensions, editorZoom: window.__toon.S.editorZoom, original };
    } finally { stage.setSize('16:9', window.__toon.S.preview); window.__toon.S.dirty = true; }
  });
  expect(result.supported).toBe(true);
  expect(result.bytes).toBeGreaterThan(100); expect(result.w).toBe(320); expect(result.h).toBe(180);
  expect(result.editorZoom).toBe(1.25);
});

test('sync errors explain the cause, retain local work and offer retry only when useful', async ({ page }) => {
  await page.route('**/src/project-sync.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
    const listeners=new Set();
    export const syncStatus={text:'Saved locally',error:'',issue:null};
    export const onSyncStatus=fn=>{listeners.add(fn);fn(syncStatus);return()=>listeners.delete(fn)};
    window.__syncReview=state=>{Object.assign(syncStatus,state);listeners.forEach(fn=>fn(syncStatus))};
    export const syncCurrent=async()=>{window.__retryCount=(window.__retryCount||0)+1;window.__syncReview({text:'Saved to Cloud',issue:null,error:''})};
    export const syncAll=async()=>{},refreshProjects=async()=>{},syncProject=async()=>{},resolveConflict=async()=>{};
  ` }));
  await studio(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__syncReview({ text: 'Sync Failed', error: 'Upload timeout', issue: { message: 'Check your connection and retry.', detail: 'Upload timeout', retryable: true } }));
  await expect(page.locator('.save-label')).toHaveText('Saved locally · sync needs attention');
  await page.locator('.save-status>summary').click();
  await expect(page.locator('.save-popover')).toContainText('Check your connection and retry.');
  await page.getByRole('button', { name: 'Retry sync', exact: true }).click();
  await expect(page.locator('.save-label')).toHaveText('Saved to cloud');
  expect(await page.evaluate(() => window.__retryCount)).toBe(1);
  await page.evaluate(() => window.__syncReview({ text: 'Sync Failed', error: 'Session expired', issue: { message: 'Sign in again before syncing.', detail: 'Session expired', retryable: false } }));
  await expect(page.locator('.save-popover')).toContainText('Sign in again');
  await expect(page.getByRole('button', { name: 'Retry sync', exact: true })).toHaveCount(0);
  const stored = await page.evaluate(async () => { const store = await import('/src/store.js'); return store.get('project', 'current'); });
  expect(stored.doc).toBeTruthy();
});

test('aspect changes and reopening the workspace keep fitting the editor without background rendering', async ({ page }) => {
  await studio(page); const projectUrl = page.url();
  await page.locator('.advanced-tools summary').click();
  await page.locator('.advanced-tools-list').getByRole('button', { name: 'Camera', exact: true }).click();
  await page.locator('.panel').getByRole('button', { name: '9:16', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.W / window.__toon.stage.H)).toBeCloseTo(9 / 16, 2);
  const ratio = await page.locator('.stagewrap').evaluate(e => e.clientWidth / e.clientHeight);
  expect(ratio).toBeCloseTo(9 / 16, 2);
  await page.evaluate(() => { location.hash = '#/hub'; });
  await expect(page.locator('.sh-hub')).toBeVisible();
  const before = await page.evaluate(() => window.__toon.metrics.renderCount);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__toon.metrics.renderCount)).toBe(before);
  await page.goto(projectUrl);
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect.poll(() => page.evaluate(() => window.__toon?.metrics.framePending)).toBe(false);
  const bounds = await page.locator('#app .tlwrap').boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  expect(await page.locator('.stagewrap').evaluate(e => e.clientWidth / e.clientHeight)).toBeCloseTo(9 / 16, 2);
});
