import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initParts, claimPart, beatParts, finishPart, partsSummary, partsPath } from '../../server/cloud-export-store.js';
// One video rendered by TWO browser pages that share one job (the shared slice list is the real server code on an in-memory database, the storage is faked):
// each claims slices, the helper uploads its slices, the leader downloads them, joins everything with the sound and returns one video.
test.use({ viewport: { width: 1000, height: 700 } });
const wav = (seconds) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2); return b; };
const makeStore = () => { const data = new Map(); return { data, transact: async (p, fn) => {
  const real = data.has(p) ? structuredClone(data.get(p)) : null; let next = fn(null);
  if (next === undefined) return { committed: false, value: real };
  if (real !== null) { next = fn(real); if (next === undefined) return { committed: false, value: real }; }
  if (next === null) data.delete(p); else data.set(p, structuredClone(next));
  return { committed: true, value: next }; } }; };

async function open(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=1#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Dist');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(14) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
}
const run = (page) => page.evaluate(async () => {
  const T = window.__toon, ex = await import('/src/exporter.js'); Object.assign(T.S, { fps: 40, quality: 360 });
  await T.applyLayers(); T.stage.setSize(T.S.aspect, T.S.quality);
  const job = await T.exportJob(T.stage.W, T.stage.H), who = Math.random().toString(36).slice(2), call = async (action, extra = {}) => (await fetch('/api/export', { method: 'POST', body: JSON.stringify({ action, who, ...extra }) })).json();
  const api = { initParts: (plan) => call('cloudInitParts', plan), claim: async () => (await call('cloudClaimPart')).part, beat: (parts) => call('cloudPartBeat', { parts }), parts: async () => (await call('cloudParts')).parts,
    presign: (part, size) => call('cloudPartPresign', { part, size }), done: (part, extra) => call('cloudPartDone', { part, ...extra }), urls: async (ids) => (await call('cloudPartUrls', { parts: ids })).urls };
  let role = null;
  const res = await ex.exportDistributed({ job, clips: T.player.clips, total: T.player.total, music: T.musicForExport?.() || [], onProgress() {}, cancelled: () => false, workers: 1, api, onRole: (r) => { role = r; } });
  if (res.helper) return { role, helper: true };
  const bytes = new Uint8Array(await res.blob.arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { role, info: res.info, base64: btoa(bin) };
});

test('two browser pages render one video together: slices claimed, uploaded, joined, with the sound', async ({ browser }) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } }), a = await context.newPage(), b = await context.newPage();
  const store = makeStore(), uid = 'u', id = 'j', objects = new Map(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await context.route('**/api/export', async (route) => {
    const q = JSON.parse(route.request().postData()), json = (o) => route.fulfill({ json: o });
    if (q.action === 'cloudInitParts') return json(await initParts(store, uid, id, { frames: q.frames, fps: q.fps, slices: q.slices }));
    if (q.action === 'cloudClaimPart') { await sleep(250); return json({ part: await claimPart(store, uid, id, q.who) }); }
    if (q.action === 'cloudPartBeat') { await beatParts(store, uid, id, q.who, q.parts); return json({ ok: true }); }
    if (q.action === 'cloudParts') return json({ parts: partsSummary(store.data.get(partsPath(uid, id))) });
    if (q.action === 'cloudPartPresign') return json({ upload: { url: `https://r2.test/part-${q.part}`, headers: { 'Content-Type': 'application/octet-stream' } } });
    if (q.action === 'cloudPartDone') return json(await finishPart(store, uid, id, q.who, { part: q.part, size: q.size, local: q.local === true }));
    if (q.action === 'cloudPartUrls') return json({ urls: Object.fromEntries(q.parts.map((n) => [n, `https://r2.test/part-${n}`])) });
    return json({ error: 'unexpected' });
  });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
  await context.route('https://r2.test/**', async (route) => {
    const req = route.request(), key = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'PUT') { objects.set(key, req.postDataBuffer()); return route.fulfill({ status: 200, headers: cors, body: '' }); }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' }, body: objects.get(key) });
  });
  await open(a); await open(b);
  const [ra, rb] = await Promise.all([run(a), run(b)]);
  const leader = [ra, rb].find((r) => r.role === 'leader'), helper = [ra, rb].find((r) => r.role === 'helper');
  expect(leader && helper).toBeTruthy(); expect(helper.helper).toBe(true);          // exactly one leader, one helper
  const items = partsSummary(store.data.get(partsPath(uid, id))).items;
  expect(Object.values(items).every((i) => i.st === 'done')).toBe(true);
  expect(Object.values(items).some((i) => !i.local)).toBe(true);                    // the helper really rendered at least one slice
  expect(leader.info).toMatch(/from other machines/);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'dist-')), 'out.mp4'); writeFileSync(file, Buffer.from(leader.base64, 'base64'));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,codec_type,nb_read_frames,duration', '-of', 'json', file], { encoding: 'utf8' })).streams;
  const video = probe.find((s) => s.codec_type === 'video'), audio = probe.find((s) => s.codec_type === 'audio');
  expect(video.codec_name).toBe('h264'); expect(['aac', 'opus']).toContain(audio.codec_name);          // this Chromium has no AAC encoder and falls back to Opus
  const total = Object.values(items).reduce((n, i) => n + (i.to - i.from), 0);
  expect(+video.nb_read_frames).toBe(total);                                          // every frame of every slice, none twice, none missing
  expect(+video.duration).toBeGreaterThan(14); expect(+video.duration).toBeLessThan(16.5);
});
