#!/usr/bin/env node
// Renames a word inside a finished character ZIP (picture names, slot names, animation names, file names), e.g. the name of the
// artist's original character that is still written in the part names ("hair_william_short_hair"):
//
//   node scripts/rename-character-zip.mjs in.zip out.zip --from william --to rohan
//
// Every JSON file's text and every file path inside the ZIP is changed the same way, so all references stay consistent.
// Pictures (webp/png) are copied as they are. Run scripts/check-character-zip.mjs on the result.
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
const [, , input, output, ...rest] = process.argv;
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : null; };
const from = opt('from'), to = opt('to');
if (!input || !output || !from || !to) { console.error('Usage: node scripts/rename-character-zip.mjs in.zip out.zip --from william --to rohan'); process.exit(1); }
const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
const same = (match) => (match === match.toUpperCase() ? to.toUpperCase() : match[0] === match[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
const swap = (text) => text.replace(re, same);
const src = await JSZip.loadAsync(readFileSync(input)), out = new JSZip();
let files = 0, hits = 0;
for (const [path, entry] of Object.entries(src.files)) {
  if (entry.dir) continue;
  const name = swap(path);
  if (/\.json$/i.test(path)) { const text = await entry.async('string'); const next = swap(text); hits += (text.match(re) || []).length; out.file(name, next); }
  else out.file(name, await entry.async('nodebuffer'));
  files++; if (name !== path) hits++;
}
writeFileSync(output, await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
console.log(`${output}: ${files} files, "${from}" changed ${hits} time(s)`);
