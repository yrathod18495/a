#!/usr/bin/env node
// Downloads every animation listed in public/catalog/animations.json into public/animations/
// (json + preview video + poster image) and rewrites the catalog to point at those local copies,
// so the app never needs the network. Safe to re-run after sync-catalog.mjs: only new files are fetched.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CDN = 'https://assets.stpro.app/';
const root = new URL('../public/', import.meta.url).pathname;
const catPath = root + 'catalog/animations.json';
const cat = JSON.parse(readFileSync(catPath, 'utf8'));
mkdirSync(root + 'animations', { recursive: true });
const get = async (u) => { const r = await fetch(/^https?:/.test(u) ? u : CDN + u); if (!r.ok) throw new Error(`${r.status} ${u}`); return Buffer.from(await r.arrayBuffer()); };
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const all = Object.entries(cat.patterns).flatMap(([p, v]) => v.categories.flatMap((c) => c.animations.map((a) => [p, a])));
let done = 0;
const queue = [...all];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const [, a] = queue.shift();
    try {
      const jsonLocal = `animations/${a.id}.json`, vidLocal = `animations/${a.id}.webm`, posterLocal = `animations/${a.id}.jpg`;
      if (!existsSync(root + jsonLocal)) writeFileSync(root + jsonLocal, await get(a.file.startsWith('animations/') ? a.file : a.file));
      if (a.preview && !existsSync(root + vidLocal)) writeFileSync(root + vidLocal, await get(a.preview));
      if (a.preview && hasFfmpeg && !existsSync(root + posterLocal)) {
        for (const ss of ['0.4', '0']) { // some previews are shorter than 0.4 s
          try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', ss, '-i', root + vidLocal, '-frames:v', '1', '-vf', 'scale=220:-2', '-q:v', '6', root + posterLocal]); if (existsSync(root + posterLocal)) break; } catch { /* try next */ }
        }
      }
      a.file = jsonLocal; if (a.preview) { a.preview = vidLocal; a.poster = existsSync(root + posterLocal) ? posterLocal : null; }
    } catch (e) { console.warn('skip', a.id, e.message); }
    if (++done % 20 === 0) console.log(`${done}/${all.length}`);
  }
}));

// which bones does each pattern's animation set drive? (lets the app pick the matching set for any rig)
for (const [p, v] of Object.entries(cat.patterns)) {
  const bones = new Set();
  for (const c of v.categories) for (const a of c.animations) {
    try { Object.keys(JSON.parse(readFileSync(root + a.file, 'utf8')).bones || {}).forEach((b) => bones.add(b)); } catch { /* not local yet */ }
  }
  v.bones = [...bones].sort();
}
cat.base = null; // fully local
writeFileSync(catPath, JSON.stringify(cat));
console.log(`bundled ${done} animations`);
