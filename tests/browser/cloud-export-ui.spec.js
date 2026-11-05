import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
// Cloud export: a "Start cloud export" button in the Export tab that submits a job and shows its progress (the render itself runs on
// a separate machine, see docs/CLOUD-EXPORT.md — this test only checks the studio side: create, poll, cancel, download link).
test('Cloud export: Start submits a job, progress polling shows it, and Cancel stops it', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let job = null;
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/cloud-export', async (r) => {
    const body = JSON.parse(r.request().postData());
    if (body.action === 'create') { job = { status: 'rendering', progress: 0.1, projectId: body.projectId }; return r.fulfill({ json: { jobId: 'cexp_test1', job } }); }
    if (body.action === 'status') return r.fulfill({ json: { job } });
    if (body.action === 'cancel') { job = { ...job, status: 'cancelled' }; return r.fulfill({ json: { job } }); }
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
  const start = page.getByRole('button', { name: /Start cloud export/ });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByText(/Rendering…/)).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: /Start cloud export/ })).toBeVisible();
  expect(errors).toEqual([]);
});
