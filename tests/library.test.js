import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetAddress, isLibraryPath, libraryType, LIBRARY_CACHE } from '../shared/library-url.js';
import { startFakeS3 } from './fake-s3-server.js';
const run = promisify(execFile);

test('library files come from the R2 bucket once it is configured; everything else stays on the site', () => {
  const site = { siteBase: '/' };
  assert.equal(assetAddress('12toons/chars/neha/front_ske.json', site), '/12toons/chars/neha/front_ske.json');                    // not configured yet: bundled copy
  const lib = { siteBase: '/', libraryBase: 'https://pub-abc.r2.dev/v1/' };
  assert.equal(assetAddress('12toons/chars/neha/front_ske.json', lib), 'https://pub-abc.r2.dev/v1/12toons/chars/neha/front_ske.json');
  assert.equal(assetAddress('12toons/pose/neha-front.webp', lib), 'https://pub-abc.r2.dev/v1/12toons/pose/neha-front.webp');
  assert.equal(assetAddress('favicon.svg', lib), '/favicon.svg');
  assert.equal(assetAddress('https://x.test/a.png', lib), 'https://x.test/a.png');
  assert.equal(assetAddress('blob:abc', lib), 'blob:abc'); assert.equal(assetAddress('', lib), null);
  assert.equal(isLibraryPath('12toons/../secret'), false);
  assert.equal(libraryType('a/b.JSON'), 'application/json'); assert.equal(libraryType('x.webp'), 'image/webp'); assert.match(LIBRARY_CACHE, /immutable/);
});

test('upload-library puts every file under <prefix>/12toons/ and skips files that are already there', async () => {
  const s3 = await startFakeS3(), dir = mkdtempSync(join(tmpdir(), 'lib-'));
  mkdirSync(join(dir, 'chars/neha'), { recursive: true }); mkdirSync(join(dir, 'pose'));
  writeFileSync(join(dir, 'characters.json'), '{"characters":[]}'); writeFileSync(join(dir, 'chars/neha/front_ske.json'), '{"a":1}'); writeFileSync(join(dir, 'pose/neha-front.webp'), 'webp-bytes'); writeFileSync(join(dir, '.DS_Store'), 'junk');
  const env = { ...process.env, CLOUDFLARE_R2_ACCOUNT_ID: 'a', CLOUDFLARE_R2_ACCESS_KEY_ID: 'k', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 's', CLOUDFLARE_R2_LIBRARY_BUCKET: 'lib', CLOUDFLARE_R2_ENDPOINT: s3.url };
  try {
    const first = await run('node', ['scripts/upload-library.mjs', '--dir', dir, '--prefix', 'v7'], { env });
    assert.match(first.stdout, /3 upload hui, 0 pehle se thi/); assert.match(first.stdout, /VITE_LIBRARY_URL=.*\/v7/);
    assert.deepEqual([...s3.objects.keys()].sort(), ['v7/12toons/characters.json', 'v7/12toons/chars/neha/front_ske.json', 'v7/12toons/pose/neha-front.webp']);
    const again = await run('node', ['scripts/upload-library.mjs', '--dir', dir, '--prefix', 'v7'], { env });
    assert.match(again.stdout, /0 upload hui, 3 pehle se thi/);
    await assert.rejects(run('node', ['scripts/upload-library.mjs', '--dir', dir], { env: { ...env, CLOUDFLARE_R2_LIBRARY_BUCKET: '' } }), /variable set nahi hain/);
  } finally { await s3.close(); }
});
