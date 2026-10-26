// With VITE_LIBRARY_URL set, every character file (rig, atlas, pictures, animations, thumbnails) is fetched from the library bucket, not from the site.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';

const TYPES = { '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp4': 'video/mp4' };
let bucket, bucketUrl, vite, siteUrl; const served = [];
test.beforeAll(async () => {
  bucket = http.createServer(async (req, res) => {          // a stand-in for the public R2 bucket: /v1/12toons/... -> public/12toons/..., with CORS
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!path.startsWith('/v1/12toons/') || path.includes('..')) { res.writeHead(404); return res.end(); }
    try { const body = await readFile(join('public', path.replace('/v1/', '/')), {}); served.push(path); res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => bucket.listen(0, '127.0.0.1', r)); bucketUrl = `http://127.0.0.1:${bucket.address().port}/v1`;
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { env: { ...process.env, VITE_LIBRARY_URL: bucketUrl }, stdio: 'pipe' });
  siteUrl = 'http://127.0.0.1:5183';
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('vite did not start')), 60000); vite.stdout.on('data', (d) => { if (String(d).includes('5183')) { clearTimeout(t); resolve(); } }); vite.on('exit', () => reject(new Error('vite exited'))); });
});
test.afterAll(async () => { vite?.kill(); await new Promise((r) => bucket?.close(r)); });

test('characters are listed and loaded from the library bucket; the site serves none of their files', async ({ page }) => {
  const errors = [], fromSite = [], fromBucket = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { const u = r.url(); if (u.includes('/12toons/')) (u.startsWith(bucketUrl) ? fromBucket : fromSite).push(u); });
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto(`${siteUrl}/?debug&workers=0#/toons`);
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Library');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const chars = page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true });
  if (await chars.getAttribute('aria-pressed') !== 'true') await chars.click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^My Baby$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  expect(fromBucket.some((u) => u.endsWith('/12toons/characters.json'))).toBe(true);
  expect(fromBucket.some((u) => /\/12toons\/chars\/mybaby\/.*_ske\.json$/.test(u))).toBe(true);
  expect(fromBucket.some((u) => /\/12toons\/chars\/mybaby\/.*\.webp$/.test(u))).toBe(true);
  expect(fromBucket.some((u) => /\/12toons\/pose\/.*\.webp$/.test(u))).toBe(true);
  expect(fromSite).toEqual([]);
  expect(served.length).toBeGreaterThan(4);
  expect(errors).toEqual([]);
});
