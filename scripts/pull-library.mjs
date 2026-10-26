// The character library lives in the 12toons R2 bucket (docs/LIBRARY.md); the repository no longer carries it.
// For development and the browser tests, download it into public/12toons (ignored by git) from the live site:
//   LIBRARY_SITE=https://your-site.vercel.app node scripts/pull-library.mjs [--dir public/12toons]
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const args = process.argv.slice(2), dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'public/12toons';
const base = String(process.env.LIBRARY_SITE || process.env.VITE_LIBRARY_URL || '').replace(/\/+$/, '');
if (!base) { console.error('❌ LIBRARY_SITE set nahi hai (aapki live site ka address, jaise https://aapki-site.vercel.app). .env me ya shell me daalein.'); process.exit(1); }
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r; };
let manifest;
try { manifest = await (await get(`${base}/12toons/library-manifest.json`)).json(); }
catch (e) { console.error(`❌ Library ki list nahi mili (${e.message}). Pehle scripts/upload-library.mjs chalayein.`); process.exit(1); }
const files = manifest.files.filter((f) => typeof f.path === 'string' && !f.path.includes('..') && !f.path.startsWith('/'));
console.log(`${files.length} files, ${(files.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(1)} MB  ->  ${dir}`);
let next = 0, got = 0, skipped = 0; const failed = [];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < files.length) {
    const f = files[next++], target = join(dir, f.path);
    try {
      if (existsSync(target) && statSync(target).size === f.size) { skipped++; continue; }
      const body = Buffer.from(await (await get(`${base}/12toons/${f.path.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer());
      if (body.length !== f.size) throw new Error('size alag aaya');
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, body); got++;
    } catch (e) { failed.push(`${f.path}: ${e.message}`); }
  }
}));
console.log(`${failed.length ? '❌' : '✅'} ${got} download hui, ${skipped} pehle se thi${failed.length ? `, ${failed.length} fail` : ''}.`);
for (const f of failed.slice(0, 10)) console.error('  ', f);
process.exit(failed.length ? 1 : 0);
