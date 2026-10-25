// R2 ki jaanch: `node scripts/check-r2.mjs` (4 CLOUDFLARE_R2_* variable chahiye, .env me ya shell me).
// Ek chhoti test file upload karta hai, padhta hai, list me dhoondhta hai aur hata deta hai. Aapka asli data nahi chhuta (key: u/_selfcheck/...).
import { readFileSync, existsSync } from 'node:fs';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const need = ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_BUCKET_NAME'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error(`❌ Ye variable set nahi hain: ${missing.join(', ')}\n   Vercel ya .env me daalkar dobara chalayein.`); process.exit(1); }

const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME, Key = `u/_selfcheck/${Date.now()}.txt`, body = Buffer.from(`12toons r2 check ${new Date().toISOString()}`);
const s3 = new S3Client({ region: 'auto', endpoint: process.env.CLOUDFLARE_R2_ENDPOINT || `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const hint = (e) => /AccessDenied|Forbidden|403/.test(`${e.name} ${e.message}`) ? 'Token ko Object Read & Write permission aur is bucket par access chahiye.' : /NoSuchBucket|404/.test(`${e.name} ${e.message}`) ? 'Bucket ka naam ya Account ID galat lag raha hai.' : /InvalidAccessKeyId|SignatureDoesNotMatch/.test(e.name) ? 'Access Key ID ya Secret galat hai.' : 'Internet ya Account ID check karein.';
const steps = [
  ['Upload', () => s3.send(new PutObjectCommand({ Bucket, Key, Body: body, ContentType: 'text/plain' }))],
  ['Head (size)', async () => { const h = await s3.send(new HeadObjectCommand({ Bucket, Key })); if (h.ContentLength !== body.length) throw new Error('size alag hai'); }],
  ['Download', async () => { const o = await s3.send(new GetObjectCommand({ Bucket, Key })); if (Buffer.from(await o.Body.transformToByteArray()).compare(body) !== 0) throw new Error('data alag hai'); }],
  ['List', async () => { const l = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'u/_selfcheck/' })); if (!(l.Contents || []).some((o) => o.Key === Key)) throw new Error('list me file nahi mili'); }],
  ['Delete', () => s3.send(new DeleteObjectCommand({ Bucket, Key }))],
];
let failed = false;
for (const [name, run] of steps) {
  try { await run(); console.log(`✅ ${name}`); }
  catch (e) { failed = true; console.error(`❌ ${name}: ${e.message}\n   ${hint(e)}`); break; }
}
console.log(failed ? '\nR2 abhi sahi nahi chal raha.' : `\n✅ R2 bilkul sahi chal raha hai (bucket: ${Bucket}).`);
process.exit(failed ? 1 : 0);
