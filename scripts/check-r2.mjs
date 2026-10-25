// R2 ki jaanch: `node scripts/check-r2.mjs [https://aapki-site.vercel.app]`  (4 CLOUDFLARE_R2_* variable chahiye, .env me ya shell me).
// Wahi tareeka chalata hai jo app chalata hai: signed link se upload -> head -> signed link se download -> delete, aur bucket ki CORS setting dekhta hai
// (browser seedha R2 se baat karta hai, isliye CORS zaroori hai). Aapka asli data nahi chhuta (sirf u/_selfcheck/ me kaam karta hai).
import { readFileSync, existsSync } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const need = ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_BUCKET_NAME'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error(`❌ Ye variable set nahi hain: ${missing.join(', ')}\n   Vercel ya .env me daalkar dobara chalayein.`); process.exit(1); }

const site = (process.argv[2] || process.env.SITE_ORIGIN || '').replace(/\/+$/, '');
const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME, Key = `u/_selfcheck/${Date.now()}.txt`, body = Buffer.from(`12toons r2 check ${new Date().toISOString()}`);
const s3 = new S3Client({ region: 'auto', forcePathStyle: true, endpoint: process.env.CLOUDFLARE_R2_ENDPOINT || `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const hint = (e) => /AccessDenied|Forbidden|403/.test(`${e.name} ${e.message}`) ? 'Token ko Object Read & Write permission aur is bucket par access chahiye.' : /NoSuchBucket|404/.test(`${e.name} ${e.message}`) ? 'Bucket ka naam ya Account ID galat lag raha hai.' : /InvalidAccessKeyId|SignatureDoesNotMatch/.test(e.name) ? 'Access Key ID ya Secret galat hai.' : 'Internet ya Account ID check karein.';
const ok = async (r, what) => { if (!r.ok) throw new Error(`${what}: R2 ne ${r.status} diya`); return r; };

const RECOMMENDED = [{ AllowedOrigins: [site || 'https://aapki-site.vercel.app'], AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }];
async function corsStep() {
  let rules;
  try { rules = (await s3.send(new GetBucketCorsCommand({ Bucket }))).CORSRules || []; }
  catch (e) { throw new Error('Bucket par CORS set nahi hai. Cloudflare → R2 → bucket → Settings → CORS policy me ye daalein:\n' + JSON.stringify(RECOMMENDED, null, 2)); }
  const methods = new Set(rules.flatMap((r) => r.AllowedMethods || []));
  if (!['GET', 'PUT'].every((m) => methods.has(m))) throw new Error('CORS me GET aur PUT dono chahiye. Ye daalein:\n' + JSON.stringify(RECOMMENDED, null, 2));
  if (site && !rules.some((r) => (r.AllowedOrigins || []).some((o) => o === '*' || o === site))) throw new Error(`CORS me aapki site (${site}) allowed nahi hai. AllowedOrigins me ye add karein.`);
}
const steps = [
  ['Signed link se upload', async () => { const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType: 'application/octet-stream', ContentLength: body.length }), { expiresIn: 120 }); await ok(await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body }), 'upload'); }],
  ['Head (size)', async () => { const h = await s3.send(new HeadObjectCommand({ Bucket, Key })); if (h.ContentLength !== body.length) throw new Error('size alag hai'); }],
  ['Signed link se download', async () => { const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 120 }); const r = await ok(await fetch(url), 'download'); if (Buffer.from(await r.arrayBuffer()).compare(body) !== 0) throw new Error('data alag hai'); }],
  ['Delete', () => s3.send(new DeleteObjectCommand({ Bucket, Key }))],
  ['CORS (browser ke liye)', corsStep],
];
let failed = false;
for (const [name, run] of steps) {
  try { await run(); console.log(`✅ ${name}`); }
  catch (e) { failed = true; console.error(`❌ ${name}: ${e.message}${name.startsWith('CORS') ? '' : '\n   ' + hint(e)}`); if (!name.startsWith('CORS') && !name.startsWith('Delete')) break; }
}
console.log(failed ? '\nR2 abhi poori tarah sahi nahi hai.' : `\n✅ R2 bilkul sahi chal raha hai (bucket: ${Bucket}).`);
process.exit(failed ? 1 : 0);
