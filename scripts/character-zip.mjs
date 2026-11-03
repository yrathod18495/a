#!/usr/bin/env node
// Builds the character upload ZIP for the admin panel ("Characters" tab) from a character page made by our older HTML tool.
// Everything inside the ZIP is DragonBones data (CLAUDE.md): the Spine step in between happens only here, offline.
//
//   node scripts/character-zip.mjs <page.html> <out.zip> --character maya --name Maya --category female --category-name "Female"
//
// ZIP layout (format "12toons-character", version 1):
//   manifest.json                                   what is inside (below)
//   views/<view>/skeleton.json                      DragonBones skeleton (bones, slots, skins)
//   views/<view>/texture_<n>.json + texture_<n>.webp  DragonBones texture atlas + its picture
//   views/<view>/animations/<name>.json             one DragonBones animation each, keyed by name
// The animations belong to the CATEGORY (the rig family): another character uploaded later with the same category id and the same
// bone names uses them as they are (same skeleton, a new face / outfit in its own textures).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const here = dirname(fileURLToPath(import.meta.url));
const [, , htmlPath, zipPath, ...rest] = process.argv;
const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
if (!htmlPath || !zipPath) { console.error('Usage: node scripts/character-zip.mjs <page.html> <out.zip> --character maya --name Maya --category female --category-name Female'); process.exit(1); }
const character = opt('character', 'maya'), name = opt('name', character[0].toUpperCase() + character.slice(1));
const category = opt('category', character), categoryName = opt('category-name', name), fps = Number(opt('fps', 30));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const work = mkdtempSync(join(tmpdir(), 'character-zip-'));
try {
  execFileSync('node', [join(here, 'character-html-to-spine.mjs'), htmlPath, join(work, 'spine'), '--character', character], { stdio: 'inherit' });
  const summary = JSON.parse(readFileSync(join(work, 'spine', 'summary.json'), 'utf8'));
  const zip = new JSZip(), views = [];
  for (const v of summary) {
    const src = join(work, 'spine', v.id), out = join(work, 'db', v.id);
    const py = (args) => execFileSync('python3', [join(here, 'spine_to_dragonbones.py'), ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    py(['rig', '--rig', join(src, 'skeleton.json'), '--atlas', join(src, 'skeleton.atlas'), '--pages', join(src, `${v.id}.webp`), '--out', out, '--name', v.id, '--fps', String(fps)]);
    py(['anims', '--rig', join(src, 'skeleton.json'), '--anims', join(src, 'skeleton.json'), '--out', join(out, 'anims.json'), '--fps', String(fps)]);
    const base = `views/${v.view}`;
    const ske = JSON.parse(readFileSync(join(out, `${v.id}_ske.json`), 'utf8'));
    const texFiles = readdirSync(out).filter((f) => /_tex_\d+\.json$/.test(f)).sort();
    const textures = [];
    texFiles.forEach((f, i) => {
      const tex = JSON.parse(readFileSync(join(out, f), 'utf8')), page = `texture_${i}.webp`;
      zip.file(`${base}/${page}`, readFileSync(join(out, tex.imagePath)));
      tex.imagePath = page;
      zip.file(`${base}/texture_${i}.json`, JSON.stringify(tex));
      textures.push(`${base}/texture_${i}.json`);
    });
    ske._tex = textures.map((t) => t.split('/').pop());
    ske.name = `${slug(category)}_${v.view}`;
    zip.file(`${base}/skeleton.json`, JSON.stringify(ske));
    const anims = JSON.parse(readFileSync(join(out, 'anims.json'), 'utf8')), meta = JSON.parse(readFileSync(join(src, 'animations.json'), 'utf8'));
    const list = [];
    for (const [animName, data] of Object.entries(anims)) {
      const m = meta[animName] || {}, file = `${base}/animations/${slug(animName)}.json`;
      zip.file(file, JSON.stringify({ [animName]: { ...data, _sourceFrameRate: fps } }));
      // Body = a whole-body animation; Left / Right / Both = arm actions that play on top of a body animation (the "hand" layer)
      const layer = /^(left|right|both)$/i.test(m.group || '') ? 'hand' : 'body';
      list.push({ name: animName, label: (m.label || animName).replace(/_/g, ' '), group: m.group || 'Body', layer, length: +(m.length || data.duration / fps).toFixed(3), file });
    }
    views.push({ id: v.view, label: v.label, skeleton: `${base}/skeleton.json`, textures, animations: list });
    console.log(`${v.view}: ${ske.armature[0].bone.length} bones, ${textures.length} texture page(s), ${list.length} animations`);
  }
  const manifest = { format: '12toons-character', version: 1, character: { id: slug(character), name }, category: { id: slug(category), name: categoryName }, frameRate: fps, views, createdAt: new Date().toISOString(), source: htmlPath.split('/').pop() };
  zip.file('manifest.json', JSON.stringify(manifest, null, 1));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  writeFileSync(zipPath, buf);
  console.log(`\n${zipPath}: ${(buf.length / 1048576).toFixed(1)} MB, ${views.length} views, ${views.reduce((n, v) => n + v.animations.length, 0)} animations`);
} finally { rmSync(work, { recursive: true, force: true }); }
