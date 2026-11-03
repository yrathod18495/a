// Admin -> Characters: upload a character ZIP (made by scripts/character-zip.mjs), look at every animation (Prev / Next) and press Done.
// Done makes a small looping GIF of every animation (low quality, for the studio's animation list), then stores everything:
// small JSON in the database, pictures in R2 (src/cloud-characters.js -> api/studio-assets.js -> server/characters-api.js). Delete removes a character and its files.
import JSZip from 'jszip';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { h, logo } from './dom.js';
import { Stage } from './db/stage.js';
import { rigInfo } from './db/info.js';
import { checkManifest, gifName } from '../shared/character-package.js';
import { listCloudCharacters, storeCharacter, deleteCloudCharacter, pictureUrl } from './cloud-characters.js';
import { friendlyError } from '../shared/hinglish-errors.js';

const GIF = { size: 128, fps: 8, maxSeconds: 4, colors: 32 };     // the small one: it only shows what the animation does
/** preview quality the admin can pick: size in pixels (the picture is square), frames per second, colours (a GIF has 256 at most). Bigger = sharper, but heavier to store and to show. */
export const GIF_QUALITY = { low: { label: 'Small · 128 px (light)', ...GIF }, 480: { label: 'Good · 480 px', size: 480, fps: 12, maxSeconds: 4, colors: 256 }, 720: { label: 'Best · 720 px (heaviest)', size: 720, fps: 10, maxSeconds: 4, colors: 256 } };
const PREVIEW = 420;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** the package inside a ZIP: { manifest, files: Map path -> Blob, errors } */
export async function readCharacterZip(file) {
  const zip = await JSZip.loadAsync(file), files = new Map();
  for (const entry of Object.values(zip.files)) if (!entry.dir) files.set(entry.name, await entry.async('blob'));
  let manifest = null;
  try { manifest = JSON.parse(await files.get('manifest.json')?.text()); } catch { /* reported below */ }
  return { manifest, files, errors: checkManifest(manifest, [...files.keys()]), bytes: file.size };
}
/** a DragonBones character the stage can show, for one view of the package */
export async function viewDef(pkg, v) {
  const ske = JSON.parse(await pkg.files.get(v.skeleton).text());
  const tex = await Promise.all(v.textures.map(async (t) => { const json = JSON.parse(await pkg.files.get(t).text()); return { json, image: pkg.files.get(t.slice(0, t.lastIndexOf('/') + 1) + json.imagePath) }; }));
  return { id: `upload-${pkg.manifest.character.id}-${v.id}-${pkg.stamp}`, name: pkg.manifest.character.name, ske, tex, rig: rigInfo(ske), anims: [] };
}
export const animOf = async (pkg, a) => { const j = JSON.parse(await pkg.files.get(a.file).text()); return j && j.bone ? j : Object.values(j)[0]; };
const layerFor = (def, name, anim, length) => ({ key: 'c', charId: def.id, skins: null, swap: null, anims: name ? { [name]: anim } : {}, clips: name ? [{ id: 'a', kind: 'body', name, start: 0, dur: length, off: 0 }] : [], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] });

/**
 * A portrait picture of the character as one view shows it: the character is drawn on its own, found by comparing with the empty
 * background, cut tight (5:8, like the picker cards) and saved as a small WebP.
 */
export async function viewThumbnail(stage, def, { size = 512, width = 200, height = 320 } = {}) {
  stage.setSize('1:1', size);
  const grab = () => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(stage.out, 0, 0, size, size); return { c, data: g.getImageData(0, 0, size, size).data }; };
  stage.setLayers([]); stage.render(0, 0, [], []); const empty = grab();
  stage.setLayers([layerFor(def, null, null, 1)]); stage.render(0, 0, [], []); const full = grab();
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (Math.abs(full.data[i] - empty.data[i]) + Math.abs(full.data[i + 1] - empty.data[i + 1]) + Math.abs(full.data[i + 2] - empty.data[i + 2]) > 36) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = size - 1; y1 = size - 1; }
  const pad = Math.round(size * 0.03); x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let w = x1 - x0 + 1, h2 = y1 - y0 + 1; const ratio = width / height;       // widen or heighten the box to 5:8, around the character's centre
  if (w / h2 < ratio) w = Math.round(h2 * ratio); else h2 = Math.round(w / ratio);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, out = document.createElement('canvas'); out.width = width; out.height = height;
  out.getContext('2d').drawImage(full.c, cx - w / 2, cy - h2 / 2, w, h2, 0, 0, width, height);
  return new Promise((resolve) => out.toBlob(resolve, 'image/webp', 0.82));
}

/* ---- the GIF files are encoded by a few workers at the same time while the main thread draws the next animation ---- */
const GIF_WORKERS = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
let gifPool = null, gifJobs = 0;
function gifWorkers() {
  if (gifPool) return gifPool;
  gifPool = [];
  try { for (let i = 0; i < GIF_WORKERS; i++) { const w = new Worker(new URL('./gifWorker.js', import.meta.url), { type: 'module' }); w.pending = new Map(); w.onmessage = (e) => { const { id, bytes, error } = e.data, job = w.pending.get(id); w.pending.delete(id); if (job) (error ? job.reject(new Error(error)) : job.resolve(bytes)); }; w.onerror = (e) => { for (const j of w.pending.values()) j.reject(new Error(e.message || 'GIF worker failed')); w.pending.clear(); }; gifPool.push(w); } }
  catch { gifPool.forEach((w) => w.terminate()); gifPool = []; }
  return gifPool;
}
export function stopGifWorkers() { gifPool?.forEach((w) => w.terminate()); gifPool = null; }
/** GIF bytes for these frames (ArrayBuffers of RGBA pixels): in a worker when possible, here otherwise */
function encodeGif(frames, opts) {
  const pool = gifWorkers();
  if (!pool.length) {
    const gif = GIFEncoder();
    for (const buffer of frames) { const data = new Uint8ClampedArray(buffer), palette = quantize(data, opts.colors); gif.writeFrame(applyPalette(data, palette), opts.size, opts.size, { palette, delay: Math.round(1000 / opts.fps), repeat: 0 }); }
    gif.finish(); return Promise.resolve(gif.bytes().slice().buffer);
  }
  const w = pool.reduce((best, x) => (x.pending.size < best.pending.size ? x : best)), id = ++gifJobs;
  return new Promise((resolve, reject) => { w.pending.set(id, { resolve, reject }); w.postMessage({ id, frames, size: opts.size, fps: opts.fps, colors: opts.colors }, frames); });
}
/** draws the frames of an animation here (a list of RGBA pixel buffers); the encoding is a separate step so it can run beside the next drawing */
export async function renderGifFrames(stage, def, name, anim, length, opts = GIF) {
  stage.setLayers([layerFor(def, name, anim, length)]);
  const seconds = Math.min(opts.maxSeconds, Math.max(0.5, length)), frames = Math.max(2, Math.round(seconds * opts.fps));
  const c = document.createElement('canvas'); c.width = c.height = opts.size;
  const g = c.getContext('2d', { willReadFrequently: true }), pictures = [];
  for (let i = 0; i < frames; i++) {
    stage.render((i / opts.fps) % length, 1 / opts.fps, [], []);
    g.drawImage(stage.out, 0, 0, opts.size, opts.size);
    pictures.push(g.getImageData(0, 0, opts.size, opts.size).data.buffer);
  }
  return pictures;
}
/** a promise of the GIF Blob for these frames (encoded by a worker) */
export const encodeGifBlob = async (pictures, opts = GIF) => new Blob([await encodeGif(pictures, opts)], { type: 'image/gif' });
/** one looping GIF of an animation, start to finish */
export async function animationGif(stage, def, name, anim, length, opts = GIF) { return encodeGifBlob(await renderGifFrames(stage, def, name, anim, length, opts), opts); }

export async function charactersView({ back, home, toast }) {
  const root = h('div', { class: 'sh admin-characters' });
  const content = h('main', { class: 'admin-characters-main' });
  const st = { list: [], pkg: null, view: 0, index: 0, playing: true, busy: false, defs: new Map(), anims: new Map(), withAnimations: true, time: 0, gifQuality: '480' };
  const stage = new Stage({ maxTex: 4096 }); stage.setSize('1:1', PREVIEW); stage.fullView = false;
  let raf = 0, last = 0, loadJob = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  root.dispose = () => { stop(); for (const id of [...stage.assets.keys()]) stage.unload(id); };

  const fileInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'aria-label': 'Character ZIP', onchange: async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await open(f); } });
  const status = h('p', { class: 'admin-characters-status', role: 'status', 'aria-live': 'polite' });
  const bar = h('progress', { class: 'admin-characters-progress', max: 1, value: 0, hidden: true });

  async function refresh() {
    try { st.list = await listCloudCharacters(); } catch (e) { toast(`Could not load the characters: ${friendlyError(e)}`); }
    draw();
  }
  async function open(file) {
    stop(); for (const id of [...stage.assets.keys()]) stage.unload(id);
    status.textContent = 'Reading the ZIP…';
    try {
      const pkg = await readCharacterZip(file); pkg.stamp = Date.now(); pkg.fileName = file.name;
      Object.assign(st, { pkg, view: 0, index: 0, playing: true, defs: new Map(), anims: new Map(), time: 0 });
      const existing = st.list.find((c) => c.category === pkg.manifest?.category?.id);
      st.withAnimations = !existing;               // a category that is already saved keeps its animations unless the admin chooses to replace them
      status.textContent = pkg.errors.length ? '' : `${pkg.fileName} is ready. Look at the animations, then press Done.`;
      draw(); if (!pkg.errors.length) await show();
    } catch (e) { status.textContent = `This ZIP could not be read: ${friendlyError(e)}`; st.pkg = null; draw(); }
  }
  const views = () => st.pkg?.manifest?.views || [];
  const current = () => { const v = views()[st.view]; return { v, a: v?.animations[st.index] || null }; };
  async function show() {
    const job = ++loadJob, { v, a } = current();
    if (!v) return;
    try {
      let def = st.defs.get(v.id);
      if (!def) { def = await viewDef(st.pkg, v); st.defs.set(v.id, def); await stage.loadCharacter(def); }
      const key = `${v.id}/${a?.name}`;
      if (a && !st.anims.has(key)) st.anims.set(key, await animOf(st.pkg, a));
      if (job !== loadJob) return;
      stage.setLayers([layerFor(def, a?.name, a ? st.anims.get(key) : null, a?.length || 1)]);
      st.time = 0; drawInfo();
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    } catch (e) { status.textContent = `This animation could not be shown: ${friendlyError(e)}`; }
  }
  function tick(now) {
    if (!root.isConnected) { stop(); return; }                  // another admin section was opened: stop drawing
    const { a } = current(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (st.playing && a) st.time = (st.time + dt) % a.length;
    try { stage.render(st.time, st.playing ? dt : 0, [], []); } catch { /* the next frame tries again */ }
    raf = requestAnimationFrame(tick);
  }
  const step = (d) => { const n = current().v?.animations.length || 0; if (!n) return; st.index = (st.index + d + n) % n; show(); };
  const info = h('div', { class: 'admin-characters-anim', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'btn', type: 'button', onclick: () => { st.playing = !st.playing; drawInfo(); } });
  function drawInfo() {
    const { v, a } = current();
    playBtn.textContent = st.playing ? '❚❚ Pause' : '▶ Play';
    info.replaceChildren(a ? h('b', {}, a.label || a.name) : h('b', {}, 'No animations'), h('small', {}, a ? `${a.group} · ${a.layer === 'hand' ? 'arms only (plays on top of a body animation)' : 'whole body'} · ${a.length.toFixed(1)} s · ${st.index + 1} / ${v.animations.length} · preview file ${gifName(a.name, st.pkg.manifest.category.id)}` : ''));
  }

  async function done() {
    const pkg = st.pkg; if (!pkg || pkg.errors.length || st.busy) return;
    const replacing = st.list.some((c) => c.id === pkg.manifest.character.id);
    if (replacing && !confirm(`A character called "${pkg.manifest.character.id}" already exists. Replace it with this ZIP?`)) return;
    st.busy = true; stop(); draw();
    const say = (text, value) => { status.textContent = text; bar.hidden = false; if (value != null) bar.value = value; };
    try {
      const gifs = new Map(), thumbs = new Map();
      let thumb = null;
      const q = GIF_QUALITY[st.gifQuality] || GIF_QUALITY[480], small = new Stage({ maxTex: 2048 }); small.setSize('1:1', q.size); small.fullView = false; let gifBytes = 0;
      const total = views().reduce((n, v) => n + v.animations.length, 0); let made = 0, uploading = '';   // every character gets its own previews, also when it uses a category's saved animations
      const report = () => say(total ? `Making the animation previews ${made} / ${total}${uploading ? ` · ${uploading}` : ''}` : (uploading || 'Saving…'), total ? (made / total) * 0.8 : 0.5);
      // 1) a picture of every view (quick)
      for (const v of views()) {
        const def = await viewDef(pkg, v); await small.loadCharacter(def);
        const picture = await viewThumbnail(small, def); thumbs.set(v.id, picture);          // each view gets its own picture
        if (!thumb || v.id === 'f34') thumb = picture;
        small.unload(def.id);
      }
      // 2) saving starts now: the rig, the animations and the pictures go up while the GIFs are still being made
      let finishGifs, failGifs;
      const gifsDone = new Promise((resolve, reject) => { finishGifs = resolve; failGifs = reject; });
      const stored = storeCharacter({ manifest: pkg.manifest, files: pkg.files, gifs, gifsDone, thumb, thumbs, withAnimations: st.withAnimations, progress: (text, d, t) => { uploading = text; report(); if (!total) bar.value = t ? d / t : 1; } });
      stored.catch(() => {});                                  // a failure is shown below
      // 3) the GIFs: drawn here one after another, encoded by workers side by side
      try {
        const flight = [];
        for (const v of views()) {
          const def = await viewDef(pkg, v); await small.loadCharacter(def); small.setSize('1:1', q.size);
          for (const a of v.animations) {
            made++; report();
            const frames = await renderGifFrames(small, def, a.name, await animOf(pkg, a), a.length, q);
            const job = encodeGifBlob(frames, q).then((blob) => { gifBytes += blob.size; return blob; });
            job.catch(() => {}); gifs.set(`${v.id}/${a.name}`, job); flight.push(job);
            if (flight.length >= GIF_WORKERS * 2) await flight.shift();          // not more than a few animations waiting to be encoded (they are big in memory)
            await new Promise((r) => setTimeout(r, 0));                         // let the page breathe between animations
          }
          small.unload(def.id);
        }
        await Promise.all(flight);
        finishGifs();
      } catch (error) { failGifs(error); throw error; }
      say(`Previews ready (${(gifBytes / 1048576).toFixed(1)} MB in all). Finishing the upload…`, 0.85);
      const result = await stored;
      toast(`${pkg.manifest.character.name} is saved${result.categoryCreated ? ` with a new category "${pkg.manifest.category.name}"` : ''}. Creators can use the character now.`);
      st.pkg = null; status.textContent = 'Saved.'; bar.hidden = true;
      await refresh();
    } catch (e) { status.textContent = `The upload did not finish: ${friendlyError(e)} Nothing was published; you can press Done again.`; bar.hidden = true; }
    finally { stopGifWorkers(); st.busy = false; draw(); if (st.pkg) show(); }
  }
  async function remove(c) {
    const views = Object.keys(c.views || {}).length, anims = Object.values(c.animations || {}).reduce((n, v) => n + (v.animations?.length || 0), 0);
    const last = !st.list.some((x) => x.id !== c.id && x.category === c.category);
    if (!confirm(`Delete ${c.name}? Its rig and pictures (${views} views) are removed from the database and R2.${last ? ` It is the last character of "${c.categoryName}", so its ${anims} animations and their previews are removed too.` : ''} This cannot be undone.`)) return;
    try { const r = await deleteCloudCharacter(c.id); toast(`${c.name} was deleted (${r.removedFiles} files removed).`); await refresh(); }
    catch (e) { toast(`Could not delete ${c.name}: ${friendlyError(e)}`); }
  }

  function card(c) {
    const img = h('img', { alt: '', loading: 'lazy' });
    if (c.thumb) pictureUrl(c.thumb).then((u) => { img.src = u; }).catch(() => {});
    const views = Object.values(c.views || {}).map((v) => v.label).join(', '), anims = Object.values(c.animations || {}).reduce((n, v) => n + (v.animations?.length || 0), 0);
    return h('article', { class: 'admin-character-card' }, h('div', { class: 'admin-character-thumb' }, img),
      h('div', { class: 'admin-character-copy' }, h('b', {}, c.name), h('small', {}, `Category: ${c.categoryName}`), h('small', {}, `${views} · ${anims} animations`)),
      h('button', { class: 'btn sm danger', type: 'button', disabled: st.busy, onclick: () => remove(c) }, 'Delete'));
  }
  function previewSection() {
    const pkg = st.pkg; if (!pkg) return null;
    const m = pkg.manifest || {}, totalAnims = views().reduce((n, v) => n + v.animations.length, 0);
    if (pkg.errors.length) return h('section', { class: 'admin-panel-card admin-characters-preview' }, h('h2', {}, 'This ZIP cannot be used'), h('ul', { class: 'admin-characters-errors' }, ...pkg.errors.map((e) => h('li', {}, e))), h('button', { class: 'btn', type: 'button', onclick: () => { st.pkg = null; draw(); } }, 'Choose another ZIP'));
    const catExists = st.list.some((c) => c.category === m.category.id), charExists = st.list.some((c) => c.id === m.character.id);
    const choice = (value, label, note) => h('label', { class: 'admin-characters-choice' }, h('input', { type: 'radio', name: 'anims', checked: st.withAnimations === value, disabled: st.busy, onchange: () => { st.withAnimations = value; } }), h('span', {}, h('b', {}, label), h('small', {}, note)));
    return h('section', { class: 'admin-panel-card admin-characters-preview' },
      h('div', { class: 'admin-characters-head' }, h('div', {}, h('h2', {}, m.character.name), h('small', {}, `Category: ${m.category.name} · ${views().length} views · ${totalAnims} animations · ${mb(pkg.bytes)}`))),
      charExists ? h('p', { class: 'admin-characters-note' }, `A character with the id "${m.character.id}" already exists. Done will replace it (its old files are removed).`) : null,
      catExists ? h('div', { class: 'admin-characters-choices' }, choice(false, `Use the saved "${m.category.name}" animations`, 'This character uses the same animation files as the others in this category (they are not uploaded again). It still gets its own preview GIFs, made from this character.'), choice(true, 'Replace them with the animations in this ZIP', 'Every character of this category gets the new animations.')) : null,
      h('div', { class: 'admin-characters-views', role: 'group', 'aria-label': 'View' }, ...views().map((v, i) => h('button', { class: `btn sm ${i === st.view ? 'pri' : ''}`, type: 'button', 'aria-pressed': String(i === st.view), disabled: st.busy, onclick: () => { st.view = i; st.index = 0; draw(); show(); } }, v.label || v.id))),
      h('div', { class: 'admin-characters-stage' }, stage.out),
      info,
      h('div', { class: 'admin-characters-controls' }, h('button', { class: 'btn', type: 'button', disabled: st.busy, onclick: () => step(-1) }, '‹ Prev'), playBtn, h('button', { class: 'btn', type: 'button', disabled: st.busy, onclick: () => step(1) }, 'Next ›')),
      h('div', { class: 'admin-characters-actions' }, h('button', { class: 'btn pri', type: 'button', disabled: st.busy, onclick: done }, st.busy ? 'Uploading…' : 'Done — upload'), h('button', { class: 'btn', type: 'button', disabled: st.busy, onclick: () => { stop(); st.pkg = null; status.textContent = ''; draw(); } }, 'Cancel')),
      bar);
  }
  function draw() {
    content.replaceChildren(
      h('section', { class: 'admin-assets-intro' }, h('span', { class: 'admin-eyebrow' }, 'CHARACTER LIBRARY'), h('h1', {}, 'Characters'),
        h('p', {}, 'Upload a character ZIP made with scripts/character-zip.mjs. You can play every animation here before anything is uploaded. Done makes a small preview GIF of each animation and stores the character: the rig and animations in the database, the pictures in R2.')),
      h('section', { class: 'admin-panel-card admin-characters-upload' }, h('button', { class: 'btn pri', type: 'button', disabled: st.busy, onclick: () => fileInput.click() }, '＋ Choose character ZIP'), fileInput,
        h('label', { class: 'admin-gif-quality' }, h('span', {}, 'Animation preview quality'), h('select', { 'aria-label': 'Animation preview quality', disabled: st.busy, onchange: (e) => { st.gifQuality = e.target.value; } }, Object.entries(GIF_QUALITY).map(([k, v]) => h('option', { value: k, selected: st.gifQuality === k }, v.label)))),
        h('small', { class: 'admin-gif-note' }, 'Bigger previews look sharper but are heavier: about 1 MB per animation at 480 px and 2 MB at 720 px (a walk cycle; the small 128 px ones are under 0.1 MB), and they take longer to make. The total is shown before saving.'), status),
      previewSection() || h('span'),
      h('section', { class: 'admin-panel-card admin-characters-list' }, h('h2', {}, `Saved characters (${st.list.length})`),
        st.list.length ? h('div', { class: 'admin-characters-grid' }, ...st.list.map(card)) : h('p', { class: 'admin-empty' }, 'No characters yet. Upload the first ZIP above.')),
      h('button', { class: 'btn', type: 'button', onclick: back }, '← Back to Admin'));
    drawInfo();
  }

  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Characters'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: back }, 'Back to Admin')), content);
  draw();
  refresh();                                   // the page is shown at once; the saved characters fill in when the server answers
  return root;
}
