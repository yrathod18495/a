#!/usr/bin/env node
// Checks a character ZIP on your computer the way the admin upload will, before you upload it.
//   node scripts/check-character-zip.mjs maya.zip
// Exit code 0 = the upload will accept it (warnings are only advice), 1 = something must be fixed first.
// What it checks: shared/character-package.js (the same function the admin screen runs), then the files themselves (DragonBones skeleton, atlas, pictures,
// animations) and which 12toons features the rig supports (lip-sync, tears, hand layer, physics). Nothing is uploaded and nothing is changed.
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { checkManifest, MAX_VIEWS, MAX_TEXTURES, MAX_ANIMATIONS } from '../shared/character-package.js';

const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/check-character-zip.mjs <character.zip>'); process.exit(2); }
const errors = [], warnings = [], notes = [];
const MAX_FILE = 40 * 1024 * 1024;
const zip = await JSZip.loadAsync(readFileSync(path));
const files = new Map();
for (const e of Object.values(zip.files)) if (!e.dir) files.set(e.name, e);
const text = async (p) => files.get(p).async('string');
const json = async (p, what) => { try { return JSON.parse(await text(p)); } catch { errors.push(`${what} (${p}) is not valid JSON.`); return null; } };

if (!files.has('manifest.json')) { console.error('FAIL: manifest.json is missing from the ZIP root.'); process.exit(1); }
const manifest = await json('manifest.json', 'The manifest');
if (!manifest) { for (const e of errors) console.error('FAIL:', e); process.exit(1); }
errors.push(...checkManifest(manifest, [...files.keys()]));

const LIPS = ['lip_idle', 'lip_a_e_i', 'lip_ee', 'lip_o', 'lip_u', 'lip_b_m_p', 'lip_c_d_g_k_n_s_t_x_y_z', 'lip_ch_sh_j', 'lip_f_v', 'lip_l', 'lip_r', 'lip_th', 'lip_qw'];
for (const v of manifest.views || []) {
  const tag = `View "${v?.id}"`;
  if (typeof v?.skeleton !== 'string' || !files.has(v.skeleton)) continue;
  const ske = await json(v.skeleton, `${tag} skeleton`);
  if (ske) {
    const arm = ske.armature?.[0];
    if (!arm || !Array.isArray(arm.bone) || !arm.bone.length) errors.push(`${tag}: the skeleton is not a DragonBones file (armature[0].bone is missing). Spine files are not accepted.`);
    else {
      if (!Array.isArray(arm.slot) || !arm.slot.length) errors.push(`${tag}: the skeleton has no slots.`);
      if (!Array.isArray(arm.skin) || !arm.skin.length) errors.push(`${tag}: the skeleton has no skin (no pictures are attached to slots).`);
      const names = new Set(arm.bone.map((b) => b.name));
      if (names.size !== arm.bone.length) errors.push(`${tag}: two bones have the same name.`);
      const slotNames = (arm.slot || []).map((s) => s.name), displays = new Set();
      for (const sk of arm.skin || []) for (const sl of sk.slot || []) for (const d of sl.display || []) if (d?.name) displays.add(d.name);
      const lips = slotNames.includes('lips') && LIPS.filter((n) => displays.has(n)).length >= 4, mouthX = [...displays].some((n) => /^Mouth\/[A-X]/.test(n));
      notes.push(`${tag}: ${arm.bone.length} bones, ${arm.slot.length} slots, lip-sync: ${lips ? 'yes (lips slot)' : mouthX ? 'yes (Mouth/ pictures)' : 'NO (no "lips" slot with lip_* pictures and no Mouth/A…X pictures)'}`);
      if (!lips && !mouthX) warnings.push(`${tag}: no lip-sync shapes were found, so the character will not move its mouth when speaking.`);
      const eyes = slotNames.filter((n) => /(?:eye(?!brow|lash)|iris)/i.test(n) && !/acc(?:essor|$|[_\-/])/i.test(n));
      if (eyes.length < 2) warnings.push(`${tag}: fewer than two eye or iris slots were found, so the tears effect cannot find both eyes.`);
      if (!Array.isArray(ske._tex) || ske._tex.length !== (v.textures || []).length) warnings.push(`${tag}: skeleton._tex does not list the same texture files as the manifest (the converter writes it).`);
    }
  }
  for (const t of v.textures || []) {
    if (!files.has(t)) continue;
    const atlas = await json(t, `${tag} atlas`);
    if (!atlas) continue;
    if (!Array.isArray(atlas.SubTexture) || !atlas.SubTexture.length) errors.push(`${tag}: ${t} is not a DragonBones atlas (SubTexture is missing).`);
    const page = t.slice(0, t.lastIndexOf('/') + 1) + atlas.imagePath;
    if (typeof atlas.imagePath !== 'string' || !files.has(page)) errors.push(`${tag}: ${t} points to the picture "${atlas.imagePath}", which is not in the ZIP next to it.`);
    else if (!/\.webp$/i.test(page)) warnings.push(`${tag}: the texture picture ${page} is not WebP (the converter writes WebP; PNG also loads but is much bigger).`);
    if (atlas.width > 4096 || atlas.height > 4096) warnings.push(`${tag}: ${t} is ${atlas.width}×${atlas.height}; pages over 4096 px can fail on phones.`);
  }
  const seen = new Set(); let hand = 0;
  for (const a of v.animations || []) {
    if (!files.has(a.file)) continue;
    const j = await json(a.file, `${tag} animation "${a.name}"`);
    if (!j) continue;
    const data = j.bone || j.slot || j.duration != null ? j : Object.values(j)[0];
    if (!data || typeof data !== 'object' || !(data.bone || data.slot || data.ffd || data.duration != null)) errors.push(`${tag}: animation "${a.name}" has no DragonBones animation data (expected { "${a.name}": { duration, bone, … } }).`);
    if (a.layer === 'hand') hand++;
    if (seen.has(a.file)) errors.push(`${tag}: two animations use the same file ${a.file}.`); seen.add(a.file);
  }
  if ((v.animations || []).length === 0) warnings.push(`${tag}: no animations. Use "Use the saved … animations" in the admin only if this character's category already has them.`);
  notes.push(`${tag}: ${(v.animations || []).length} animations (${hand} arms-only "hand" animations)`);
}
for (const [p, e] of files) { const size = e._data?.uncompressedSize || 0; if (size > MAX_FILE) errors.push(`${p} is ${(size / 1048576).toFixed(1)} MB; one file can be at most 40 MB.`); }
const ids = (s) => /^[a-z0-9][a-z0-9_]{1,59}$/.test(s);
if (manifest.character && !ids(manifest.character.id)) errors.push('character.id must be 2–60 characters: small letters, numbers and _ only.');
if ((manifest.views || []).length > MAX_VIEWS) errors.push(`More than ${MAX_VIEWS} views.`);

console.log(`${path}: ${(readFileSync(path).length / 1048576).toFixed(1)} MB · character "${manifest.character?.id}" · category "${manifest.category?.id}" · ${(manifest.views || []).length} view(s)`);
for (const n of notes) console.log('  ·', n);
for (const w of warnings) console.log('WARN:', w);
for (const e of errors) console.error('FAIL:', e);
console.log(errors.length ? `\n${errors.length} problem(s) must be fixed before uploading.` : '\nOK: the admin upload will accept this ZIP.');
process.exit(errors.length ? 1 : 0);
