#!/usr/bin/env node
// Packs every character in public/catalog/characters.json that has file links into an uploadable zip
// (rig.json + .atlas + texture) under public/characters/. Upload these in the app's "Add character ZIP".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import JSZip from 'jszip';

const CDN = 'https://assets.stpro.app/';
const root = new URL('../public/', import.meta.url).pathname;
const list = JSON.parse(readFileSync(root + 'catalog/characters.json', 'utf8')).characters.filter((c) => c.json && c.atlas);
mkdirSync(root + 'characters', { recursive: true });
const get = async (p) => {
  for (let i = 0; i < 4; i++) { try { const r = await fetch(CDN + p); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch { /* retry */ } await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  throw new Error(`download failed: ${p}`);
};
const safe = (s) => s.replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '');
for (const c of list) {
  const name = safe(`${c.name} ${c.pose}`);
  const atlas = (await get(c.atlas)).toString('utf8');
  const pages = atlas.split(/\r?\n/).filter((l, i, a) => l.trim() && !l.includes(':') && /^size:/.test((a[i + 1] || '').trim()));
  const files = Object.entries(c.images || {});
  const zip = new JSZip();
  zip.file('rig.json', await get(c.json));
  zip.file(`${name}.atlas`, atlas);
  for (const [i, [fileName, path]] of files.entries()) zip.file(pages.includes(fileName) ? fileName : (pages[i] || fileName), await get(path));
  const out = `${root}characters/${name}.zip`;
  writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('✔', name, `(${files.length} texture${files.length === 1 ? '' : 's'})`);
}
