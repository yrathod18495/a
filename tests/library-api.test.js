import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startFakeS3 } from './fake-s3-server.js';
Object.assign(process.env, { CLOUDFLARE_R2_ACCOUNT_ID: 'acc', CLOUDFLARE_R2_ACCESS_KEY_ID: 'key', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret', CLOUDFLARE_R2_BUCKET_NAME: '12toons' });
const { default: handler } = await import('../api/library.js');
const { resetClient } = await import('../server/r2-storage.js');
const call = async (req) => { const headers = {}, res = { statusCode: 0, setHeader(k, v) { headers[k] = v; }, end(body) { this.body = body; } }; await handler(req, res); return { res, headers }; };

test('/12toons/<path> redirects to a signed R2 link inside the lib folder, cached for days, and refuses everything else', async () => {
  const { res, headers } = await call({ method: 'GET', url: '/api/library?path=chars%2Fneha%2Ffront_ske.json', query: { path: 'chars/neha/front_ske.json' } });
  assert.equal(res.statusCode, 302);
  const location = new URL(headers.Location);
  assert.equal(location.host, 'acc.r2.cloudflarestorage.com'); assert.equal(location.pathname, '/12toons/lib/v1/12toons/chars/neha/front_ske.json');
  assert.equal(location.searchParams.get('X-Amz-Expires'), String(7 * 24 * 3600)); assert.ok(location.searchParams.get('X-Amz-Signature'));
  assert.match(headers['Cache-Control'], /s-maxage=432000/); assert.match(headers['Cache-Control'], /max-age=432000/);
  // a nested path may arrive as an array (Vercel splits :path*)
  assert.equal((await call({ method: 'GET', query: { path: ['pose', 'neha-front.webp'] } })).res.statusCode, 302);
  assert.equal((await call({ method: 'GET', query: { path: '../u/someone/a/ab/abc' } })).res.statusCode, 400);
  assert.equal((await call({ method: 'GET', query: { path: 'chars/x.exe' } })).res.statusCode, 400);
  assert.equal((await call({ method: 'POST', query: { path: 'a.json' } })).res.statusCode, 405);
  process.env.LIBRARY_PREFIX = 'lib/v2';
  assert.match(new URL((await call({ method: 'GET', query: { path: 'animations.json' } })).headers.Location).pathname, /\/12toons\/lib\/v2\/12toons\/animations\.json$/);
  delete process.env.LIBRARY_PREFIX;
});
test('vercel.json sends /12toons/* to the library function (files that are really in public/ are served first by Vercel)', () => {
  const rewrite = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).rewrites.find((r) => r.source === '/12toons/:path*');
  assert.equal(rewrite.destination, '/api/library?path=:path*');
});

test('end to end: upload script keys, the redirect, and a browser-style fetch that follows it get the same bytes', async () => {
  const s3 = await startFakeS3();
  try {
    process.env.CLOUDFLARE_R2_ENDPOINT = s3.url; resetClient();
    s3.objects.set('lib/v1/12toons/chars/neha/front_ske.json', Buffer.from('{"armature":[]}'));          // where scripts/upload-library.mjs puts it (bucket name is the first path part)
    const { res, headers } = await call({ method: 'GET', query: { path: 'chars/neha/front_ske.json' } });
    assert.equal(res.statusCode, 302);
    const file = await fetch(headers.Location);
    assert.equal(file.status, 200); assert.equal(await file.text(), '{"armature":[]}');
    assert.equal((await fetch((await call({ method: 'GET', query: { path: 'chars/neha/missing.json' } })).headers.Location)).status, 404);
  } finally { delete process.env.CLOUDFLARE_R2_ENDPOINT; resetClient(); await s3.close(); }
});
