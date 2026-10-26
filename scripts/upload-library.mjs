// Ready-made characters (rigs, atlases, pictures, animations) -> the 12toons R2 bucket, in its own folder lib/v1/12toons/...
//   node scripts/upload-library.mjs [--prefix lib/v1] [--dry] [--dir public/12toons]
// Needs the usual CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY and CLOUDFLARE_R2_BUCKET_NAME
// (CLOUDFLARE_R2_LIBRARY_BUCKET only if you ever want a separate bucket). See docs/LIBRARY.md.
// Safe to run again: files that are already there with the same size are skipped.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { LIBRARY_CACHE, libraryType } from '../shared/library-url.js';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const args = process.argv.slice(2), flag = (name) => args.includes(name), value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const prefix = String(value('--prefix', 'lib/v1')).replace(/^\/+|\/+$/g, ''), root = value('--dir', 'public/12toons'), dry = flag('--dry');
const bucketName = process.env.CLOUDFLARE_R2_LIBRARY_BUCKET || process.env.CLOUDFLARE_R2_BUCKET_NAME;
const missing = ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'].filter((k) => !process.env[k]).concat(bucketName ? [] : ['CLOUDFLARE_R2_BUCKET_NAME']);
if (missing.length && !dry) { console.error(`❌ Ye variable set nahi hain: ${missing.join(', ')}\n   (wahi R2 variable jo Vercel me hain; docs/LIBRARY.md dekhein)`); process.exit(1); }
if (!existsSync(root)) { console.error(`❌ Folder nahi mila: ${root}`); process.exit(1); }

const files = [];
(function walk(dir) { for (const name of readdirSync(dir).sort()) { const full = join(dir, name), st = statSync(full); if (st.isDirectory()) walk(full); else if (!name.startsWith('.')) files.push({ full, key: `${prefix}/12toons/${relative(root, full).split(sep).join('/')}`, size: st.size }); } })(root);
const total = files.reduce((n, f) => n + f.size, 0);
console.log(`${files.length} files, ${(total / 1048576).toFixed(1)} MB  ->  ${bucketName || '(bucket)'} / ${prefix}/12toons/...${dry ? '   [dry run: kuch upload nahi hoga]' : ''}`);
if (dry) { for (const f of files.slice(0, 8)) console.log('  ', f.key); if (files.length > 8) console.log(`   ... aur ${files.length - 8} files`); process.exit(0); }

const Bucket = bucketName;
const s3 = new S3Client({ region: 'auto', forcePathStyle: true, endpoint: process.env.CLOUDFLARE_R2_ENDPOINT || `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
let done = 0, sent = 0, skipped = 0, failed = [], next = 0;
async function one(f) {
  try { const h = await s3.send(new HeadObjectCommand({ Bucket, Key: f.key })); if (h.ContentLength === f.size) { skipped++; return; } } catch (e) { if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NotFound') throw e; }
  await s3.send(new PutObjectCommand({ Bucket, Key: f.key, Body: readFileSync(f.full), ContentType: libraryType(f.key), CacheControl: LIBRARY_CACHE }));
  sent++;
}
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < files.length) {
    const f = files[next++];
    try { await one(f); } catch (e) { failed.push(`${f.key}: ${e.message}`); }
    if (++done % 100 === 0) console.log(`  ${done}/${files.length}`);
  }
}));
if (!failed.length) {      // the list of files: scripts/pull-library.mjs reads it to download the whole library again (for development and tests)
  const manifest = { version: 1, prefix, files: files.map((f) => ({ path: relative(root, f.full).split(sep).join('/'), size: f.size })) };
  await s3.send(new PutObjectCommand({ Bucket, Key: `${prefix}/12toons/library-manifest.json`, Body: JSON.stringify(manifest), ContentType: 'application/json', CacheControl: 'public, max-age=300' }));
}
console.log(`\n✅ ${sent} upload hui, ${skipped} pehle se thi${failed.length ? `, ❌ ${failed.length} fail` : ''}.`);
for (const f of failed.slice(0, 10)) console.error('  ', f);
if (failed.length) process.exit(1);
console.log(`\nAb kuch aur set karna nahi hai: site /12toons/... ko apne aap R2 ke ${prefix}/12toons/ folder se uthati hai.${prefix === 'lib/v1' ? '' : `\nPrefix default (lib/v1) nahi hai, to Vercel me LIBRARY_PREFIX=${prefix} daalkar Redeploy karein.`}`);
