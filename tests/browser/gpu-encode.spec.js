import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The cloud worker can hand the render page's frames to ffmpeg (NVENC on a GPU machine). Here libx264 stands in for NVENC, so the whole path — frames over the
// local WebSocket, one ffmpeg per slice, slices joined without a second encode, audio added, the MP4 sent back — is tested without a GPU.
const here = path.dirname(fileURLToPath(import.meta.url));
const wav = (seconds) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2); return b; };

test('GPU encoder path: frames go to ffmpeg and a valid H.264 + AAC video comes back', async ({ page }) => {
  test.setTimeout(150000);
  let server; let info;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { test.skip(true, 'ffmpeg is not installed'); }
  server = spawn('python3', [path.join(here, 'gpu-encode-server.py')], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    info = await new Promise((resolve, reject) => { let text = ''; server.stdout.on('data', (d) => { text += String(d); const m = text.match(/^(\d+ \S+|UNAVAILABLE)$/m); if (m) resolve(m[1]); }); server.on('exit', () => reject(Error('encoder server exited'))); setTimeout(() => reject(Error('encoder server did not start')), 20000); });
  } catch (e) { server.kill(); test.skip(true, String(e.message)); }
  if (info.startsWith('UNAVAILABLE')) { server.kill(); test.skip(true, 'the encoder server could not start (websockets / ffmpeg missing)'); }
  const [port, token] = info.split(/\s+/);
  const errors = []; let connected = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {  if (/GPU encoder connected/.test(m.text())) connected = true; if (/parallel export failed|GPU encoder not available/.test(m.text())) errors.push(m.text()); });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto(`/?debug&workers=2&gpuenc=${port}.${token}#/toons`);
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Gpu');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(4) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  await page.evaluate(() => { const T = window.__toon; T.S.fps = 40; T.S.quality = 480; });
  const downloadReady = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#app .hdr-tools').getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.exp-pop-go').click();
  const download = await downloadReady;
  const file = await download.path(); expect((await readFile(file)).length).toBeGreaterThan(2000);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,nb_frames,duration', '-of', 'json', file], { encoding: 'utf8' })).streams;
  const video = probe.find((s) => s.codec_type === 'video'), audio = probe.find((s) => s.codec_type === 'audio');
  server.kill();
  expect(connected).toBe(true);
  expect(video.codec_name).toBe('h264'); expect(+video.height).toBe(480);
  expect(+video.duration).toBeGreaterThan(4.3); expect(+video.duration).toBeLessThan(6);          // ~5 s: 4 s of voice + lead / tail
  expect(audio.codec_name).toBe('aac'); expect(+audio.duration).toBeGreaterThan(4.3);
  expect(errors).toEqual([]);
});
