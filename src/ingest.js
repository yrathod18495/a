import JSZip from 'jszip';
import { isSke, isTex, rigInfo } from './db/info.js';

const AUDIO = /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm)$/i;
const NARRATOR = /narrat|नैरेटर|नरेटर|सूत्रधार|वाचक|voice\s*-?over/i;
const base = (p) => p.split('/').pop();
const dir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const noExt = (s) => s.replace(/\.[^.]+$/, '');

async function walk(file, out) {
  if (/\.zip$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(file);
    for (const e of Object.values(zip.files)) {
      if (e.dir || /(^|\/)(__MACOSX|\.)/.test(e.name)) continue;
      if (/\.zip$/i.test(e.name)) await walk(new File([await e.async('blob')], base(e.name)), out);
      else out.push({ path: e.name, zip: noExt(file.name), read: () => e.async('arraybuffer') });
    }
  } else out.push({ path: file.name, zip: null, read: () => file.arrayBuffer() });
}

/** Reads zips / loose files and returns characters (DragonBones skeleton + texture atlas + picture) and audio lines. */
const TEXT_KEY = /^(text|dialogue|dialog|dialogues|line|content|transcript|message|speech|caption|sentence|script|hindi|english)$/i;
const ORDER_KEY = /^(index|order|id|no|number|num|line_?no|line_?number|seq|sequence|position)$/i;
const FILE_KEY = /^(file|filename|file_name|audio|audio_file|path|name)$/i;
/** script text in whatever shape the bundle brings it: [..strings..], [{index,text}], {"001": "..."}, nested scenes ... -> [{order?, file?, text}] */
function parseScript(data) {
  const out = [];
  const take = (o) => {
    let text = null, order = null, file = null;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && TEXT_KEY.test(k) && !text) text = v;
      else if ((typeof v === 'number' || /^\d+$/.test(String(v))) && ORDER_KEY.test(k) && order == null) order = +v;
      else if (typeof v === 'string' && FILE_KEY.test(k) && /\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(v)) file = v;
    }
    if (text) { out.push({ order, file, text: text.trim() }); return true; }
    return false;
  };
  const walkJ = (v) => {
    if (typeof v === 'string') { out.push({ text: v.trim() }); return; }
    if (Array.isArray(v)) { v.forEach(walkJ); return; }
    if (v && typeof v === 'object') {
      if (take(v)) return;
      const ents = Object.entries(v);
      if (ents.length && ents.every(([, x]) => typeof x === 'string')) { ents.forEach(([k, x]) => { const m = k.match(/^\s*(\d+)/); out.push({ order: m ? +m[1] : null, file: /\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(k) ? k : null, text: x.trim() }); }); return; }
      ents.forEach(([, x]) => { if (x && typeof x === 'object') walkJ(x); });
    }
  };
  walkJ(data);
  return out.filter((x) => x.text);
}

export async function ingest(files) {
  const entries = [];
  for (const f of files) await walk(f, entries);

  const characters = [], jsonOf = async (e) => { try { return JSON.parse(new TextDecoder().decode(await e.read())); } catch { return null; } };
  for (const e of entries.filter((x) => /\.json$/i.test(x.path) && !/^anim_/i.test(base(x.path)))) {
    const ske = await jsonOf(e);
    if (!isSke(ske)) continue;
    const d = dir(e.path), sibs = entries.filter((x) => dir(x.path) === d && x.zip === e.zip), texJsons = [];
    for (const x of sibs.filter((s2) => /\.json$/i.test(s2.path) && s2 !== e)) { const j = await jsonOf(x); if (isTex(j)) texJsons.push(j); }
    if (!texJsons.length) continue;
    const pictures = {};
    for (const x of sibs.filter((s2) => /\.(png|webp|jpe?g)$/i.test(s2.path)))
      pictures[base(x.path)] = new Blob([await x.read()], { type: /webp/i.test(x.path) ? 'image/webp' : /png/i.test(x.path) ? 'image/png' : 'image/jpeg' });
    if (!texJsons.every((t) => pictures[base(t.imagePath)])) continue;
    // Character uploads provide artwork and a rig; new motion is published by admins.
    const localAnims = {};
    delete ske.armature[0].animation;
    const name = (ske.armature[0].name || noExt(base(e.path)).replace(/_ske$/i, '') || e.zip || 'Character').replace(/_/g, ' ');
    characters.push({ id: 'c' + Math.random().toString(36).slice(2, 8), name, ske, tex: texJsons.map((json) => ({ json, image: pictures[base(json.imagePath)] })), rig: rigInfo(ske), localAnims, anims: Object.keys(localAnims) });
  }

  const audio = entries.filter((x) => AUDIO.test(x.path)).map((e) => {
    const name = noExt(base(e.path));
    const m = name.match(/^\s*(\d+)\s*[-_.)\s]+(.*)$/);
    return { e, order: m ? parseInt(m[1], 10) : Infinity, speaker: (m ? m[2] : name).trim() || 'Speaker', file: base(e.path) };
  }).sort((a, b) => a.order - b.order || a.file.localeCompare(b.file, undefined, { numeric: true }));

  const scripts = [];
  for (const e of entries.filter((x) => /\.(json|txt)$/i.test(x.path) && !/^anim_/i.test(base(x.path)))) {
    try {
      const txt = new TextDecoder().decode(await e.read());
      if (/\.txt$/i.test(e.path)) { scripts.push(...txt.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t) => { const m = t.match(/^(\d+)\s*[-.):]\s*(.*)$/); return m ? { order: +m[1], text: m[2] } : { text: t }; })); continue; }
      const j = JSON.parse(txt);
      if (isSke(j) || isTex(j)) continue;   // a character file
      scripts.push(...parseScript(j));
    } catch { /* not a script */ }
  }
  return { characters, audio, scripts };
}

export const isNarrator = (name) => NARRATOR.test(name);
