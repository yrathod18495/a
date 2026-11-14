// Admin -> Characters: upload a character ZIP (made by scripts/character-zip.mjs), look at every animation (Prev / Next) and press Done.
// Done makes a small looping GIF of every animation (low quality, for the studio's animation list), then stores everything:
// small JSON in the database, pictures in R2 (src/cloud-characters.js -> api/studio-assets.js -> server/characters-api.js). Delete removes a character and its files.
import JSZip from 'jszip';
import { encodeFrames } from './gifEncode.js';
import { canEncodePreview, encodeMp4 } from './previewVideo.js';
import { h, logo } from './dom.js';
import { Stage } from './db/stage.js';
import { rigInfo } from './db/info.js';
import { checkManifest, gifName, CHARACTER_GROUPS, groupOf } from '../shared/character-package.js';
import { listCloudCharacters, storeCharacter, deleteCloudCharacter, updateCloudCharacter, pictureUrl, characterSales, grantCharacter } from './cloud-characters.js';
import { cleanStore, cleanViewStore, isPaid, hasStore, viewStoreOf, timeLeft, leftText, MAX_PRICE, STORE_DAYS } from '../shared/character-store.js';
import { friendlyError } from '../shared/hinglish-errors.js';

const GIF = { size: 128, fps: 8, maxSeconds: 4, colors: 32 };     // the small one: it only shows what the animation does
/** preview quality the admin can pick: size in pixels (the picture is square), frames per second, colours (a GIF has 256 at most). Bigger = sharper, but heavier to store and to show. */
export const GIF_QUALITY = { low: { label: 'Small · 128 px (lightest)', ...GIF, bitrate: 60_000 }, 480: { label: 'Good · 480 px (recommended)', size: 480, fps: 12, maxSeconds: 4, colors: 256, bitrate: 200_000 }, 720: { label: 'Best · 720 px', size: 720, fps: 12, maxSeconds: 4, colors: 256, bitrate: 420_000 } };
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
let videoOk = new Map();
/** can this browser make the small preview video at this size? (checked once per size) */
const videoSupported = (q) => { if (!videoOk.has(q.size)) videoOk.set(q.size, canEncodePreview(q.size, q.fps, q.bitrate)); return videoOk.get(q.size); };
/** the preview file for these frames (ArrayBuffers of RGBA pixels): { bytes, kind } with kind 'mp4' (a tiny video) or 'gif'; made in a worker when possible, here otherwise */
async function encodePreview(frames, opts) {
  const kind = (await videoSupported(opts)) ? 'mp4' : 'gif', pool = gifWorkers();
  if (!pool.length) {
    const bytes = kind === 'mp4' ? await encodeMp4(frames, opts) : encodeFrames(frames, opts);
    return { bytes: bytes.slice().buffer, kind };
  }
  const w = pool.reduce((best, x) => (x.pending.size < best.pending.size ? x : best)), id = ++gifJobs;
  const bytes = await new Promise((resolve, reject) => { w.pending.set(id, { resolve, reject }); w.postMessage({ id, kind, frames, size: opts.size, fps: opts.fps, colors: opts.colors, bitrate: opts.bitrate }, frames); });
  return { bytes, kind };
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
/** a promise of the preview Blob for these frames: an MP4 video (type video/mp4) or, where the browser cannot make one, a GIF (type image/gif) */
export const encodeGifBlob = async (pictures, opts = GIF) => { const { bytes, kind } = await encodePreview(pictures, opts); return new Blob([bytes], { type: kind === 'mp4' ? 'video/mp4' : 'image/gif' }); };
/** one looping preview of an animation, start to finish */
export async function animationGif(stage, def, name, anim, length, opts = GIF) { return encodeGifBlob(await renderGifFrames(stage, def, name, anim, length, opts), opts); }

export async function charactersView({ back, home, toast }) {
  const root = h('div', { class: 'sh admin-characters' });
  const content = h('main', { class: 'admin-characters-main' });
  const st = { list: [], pkg: null, view: 0, index: 0, playing: true, busy: false, defs: new Map(), anims: new Map(), withAnimations: true, time: 0, gifQuality: '480', name: '', group: 'male', sell: false, price: 500, sales: null };
  const stage = new Stage({ maxTex: 2048 }); stage.setSize('1:1', PREVIEW); stage.fullView = false;          // the preview is small: 2048 px pages use a quarter of the GPU memory of 4096 px pages
  let raf = 0, last = 0, loadJob = 0, lastDraw = 0, dirty = true, drawError = '';
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
      const known = st.list.find((c) => c.id === pkg.manifest?.character?.id);
      st.name = known?.name || pkg.manifest?.character?.name || '';           // the admin can change the name and the group before Done
      st.group = groupOf(known || { category: pkg.manifest?.category?.id, name: pkg.manifest?.character?.name }, pkg.manifest?.category?.name);
      st.sell = !!known?.store; st.price = known?.store?.price || 500;          // a character that is already for sale keeps its price unless it is changed here
      status.textContent = pkg.errors.length ? '' : `${pkg.fileName} is ready. Look at the animations, then press Done.`;
      draw(); if (!pkg.errors.length) await show();
    } catch (e) { status.textContent = `This ZIP could not be read: ${friendlyError(e)}`; st.pkg = null; draw(); }
  }
  const views = () => st.pkg?.manifest?.views || [];
  const current = () => { const v = views()[st.view]; return { v, a: v?.animations[st.index] || null }; };
  async function show() {
    const job = ++loadJob, { v, a } = current();
    if (!v) return;
    drawInfo(); drawError = '';                               // Prev / Next answer at once; the picture follows as soon as the animation is ready
    try {
      for (const [id, other] of st.defs) if (id !== v.id) { stage.unload(other.id); st.defs.delete(id); }          // only the view on screen stays on the GPU (a character can have 4 big pictures per view)
      let def = st.defs.get(v.id);
      if (!def) { def = await viewDef(st.pkg, v); if (job !== loadJob) return; st.defs.set(v.id, def); await stage.loadCharacter(def); }
      if (job !== loadJob) return;
      const key = `${v.id}/${a?.name}`;
      if (a && !st.anims.has(key)) st.anims.set(key, await animOf(st.pkg, a));
      if (job !== loadJob) return;
      stage.setLayers([layerFor(def, a?.name, a ? st.anims.get(key) : null, a?.length || 1)]);
      st.time = 0; dirty = true; drawInfo();
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    } catch (e) { status.textContent = `This animation could not be shown: ${friendlyError(e)}`; }
  }
  function tick(now) {
    if (!root.isConnected) { stop(); return; }                  // another admin section was opened: stop drawing
    raf = requestAnimationFrame(tick);
    if (!st.playing && !dirty) { last = now; return; }          // paused and nothing changed: the GPU rests
    if (now - lastDraw < 30) return;                            // about 30 pictures a second are plenty for a preview
    lastDraw = now;
    const { a } = current(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (st.playing && a) st.time = (st.time + dt) % a.length;
    try { stage.render(st.time, st.playing ? dt : 0, [], []); dirty = false; }
    catch (e) { dirty = false; const key = `${st.view}/${st.index}`; if (drawError !== key) { drawError = key; status.textContent = `This animation could not be drawn: ${friendlyError(e)}`; } }
  }
  const step = (d) => { const n = current().v?.animations.length || 0; if (!n) return; st.index = (st.index + d + n) % n; drawInfo(); show(); };
  const info = h('div', { class: 'admin-characters-anim', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'btn', type: 'button', onclick: () => { st.playing = !st.playing; dirty = true; last = performance.now(); drawInfo(); } });
  function drawInfo() {
    const { v, a } = current();
    playBtn.textContent = st.playing ? '❚❚ Pause' : '▶ Play';
    info.replaceChildren(a ? h('b', {}, a.label || a.name) : h('b', {}, 'No animations'), h('small', {}, a ? `${a.group} · ${a.layer === 'hand' ? 'arms only (plays on top of a body animation)' : 'whole body'} · ${a.length.toFixed(1)} s · ${st.index + 1} / ${v.animations.length} · preview file ${gifName(a.name, st.pkg.manifest.category.id)}` : ''));
  }

  async function done() {
    const pkg = st.pkg; if (!pkg || pkg.errors.length || st.busy) return;
    let priced = null;
    if (st.sell) { try { priced = cleanStore({ price: st.price, enabled: st.list.find((c) => c.id === pkg.manifest.character.id)?.store?.enabled !== false }); } catch (e) { status.textContent = e.message; return; } }
    const replacing = st.list.some((c) => c.id === pkg.manifest.character.id);
    if (replacing && !(await confirmBox({ title: 'Replace this character?', text: `A character called "${pkg.manifest.character.id}" already exists. Done will replace it with this ZIP; its old files are removed.`, confirm: 'Replace' }))) return;
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
      const stored = storeCharacter({ manifest: pkg.manifest, files: pkg.files, name: st.name.trim() || pkg.manifest.character.name, group: st.group, store: priced, gifs, gifsDone, thumb, thumbs, withAnimations: st.withAnimations, progress: (text, d, t) => { uploading = text; report(); if (!total) bar.value = t ? d / t : 1; } });
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

  async function rename(c) {
    const name = prompt('New name for this character (1 to 60 characters):', c.name);
    if (name === null || name.trim() === c.name) return;
    try { await updateCloudCharacter(c.id, { name }); toast(`Renamed to "${name.trim()}".`); await refresh(); }
    catch (e) { toast(`Could not rename ${c.name}: ${friendlyError(e)}`); }
  }
  async function regroup(c, select) {
    select.disabled = true;
    try { await updateCloudCharacter(c.id, { group: select.value }); toast(`${c.name} is now in "${CHARACTER_GROUPS.find(([id]) => id === select.value)?.[1]}".`); c.group = select.value; }
    catch (e) { select.value = groupOf(c, c.categoryName); toast(`Could not change the group: ${friendlyError(e)}`); }
    finally { select.disabled = false; }
  }
  function card(c) {
    const img = h('img', { alt: '', loading: 'lazy' });
    if (c.thumb) pictureUrl(c.thumb).then((u) => { img.src = u; }).catch(() => {});
    const views = Object.values(c.views || {}).map((v) => v.label).join(', '), anims = Object.values(c.animations || {}).reduce((n, v) => n + (v.animations?.length || 0), 0);
    return h('article', { class: 'admin-character-card' }, h('div', { class: 'admin-character-thumb' }, img),
      h('div', { class: 'admin-character-copy' }, h('b', {}, c.name), h('small', {}, `Category: ${c.categoryName}`), h('small', {}, `${views} · ${anims} animations`),
        h('small', { class: `admin-character-store ${hasStore(c) ? 'paid' : ''}` }, storeSummary(c)),
        h('select', { class: 'admin-character-group', 'aria-label': `Group of ${c.name}`, title: 'The group the creators find this character in', disabled: st.busy, onchange: (e) => regroup(c, e.target) },
          CHARACTER_GROUPS.map(([id, label]) => h('option', { value: id, selected: groupOf(c, c.categoryName) === id }, label)))),
      h('div', { class: 'admin-character-actions' },
        h('button', { class: 'btn sm', type: 'button', disabled: st.busy, onclick: () => rename(c) }, 'Rename'),
        h('button', { class: 'btn sm', type: 'button', disabled: st.busy, onclick: () => storeSettings(c) }, 'Store'),
        h('button', { class: 'btn sm danger', type: 'button', disabled: st.busy, onclick: () => remove(c) }, 'Delete')));
  }
  const storeSummary = (c) => {
    const parts = [];
    if (isPaid(c)) parts.push(`Whole character: ${c.store.price.toLocaleString('en-IN')} Coins${c.store.enabled === false ? ' · off sale' : ''}`);
    const poses = Object.keys(c.views || {}).filter((v) => viewStoreOf(c, v)).map((v) => `${c.views[v].label || v} ${c.viewStore[v].price.toLocaleString('en-IN')}${c.viewStore[v].enabled === false ? ' (off)' : ''}`);
    if (poses.length) parts.push(`Paid poses: ${poses.join(', ')}`);
    return parts.length ? `Store · ${parts.join(' · ')}` : 'Free for everyone';
  };
  /** price and sale of a saved character: free for everyone, or sold for Coins (30 days); it can be taken off sale without making it free */
  function storeSettings(c) {
    const paid = isPaid(c), dlg = h('dialog', { class: 'admin-store-dialog', 'aria-label': `Store settings of ${c.name}` });
    const sell = h('input', { type: 'checkbox', checked: paid, 'aria-label': 'Sell the whole character' }), price = h('input', { type: 'number', min: 1, max: MAX_PRICE, step: 1, value: c.store?.price || 500, 'aria-label': 'Price of the whole character in Coins' });
    const onSale = h('input', { type: 'checkbox', checked: c.store?.enabled !== false, 'aria-label': 'Whole character on sale' }), msg = h('p', { class: 'admin-store-msg', role: 'status' }, '');
    const rows = h('div', { class: 'admin-store-rows' }, h('label', {}, price, h('span', {}, 'Price (Coins)')), h('label', { class: 'inline' }, onSale, h('span', {}, 'On sale (people can buy it now)')));
    const sync = () => { rows.hidden = !sell.checked; }; sell.addEventListener('change', sync); sync();
    // every pose (view) can have its own price: the free ones stay free
    const poses = Object.entries(c.views || {}).map(([id, v]) => {
      const own = viewStoreOf(c, id), on = h('input', { type: 'checkbox', checked: !!own, 'aria-label': `${v.label || id} is paid` }), pr = h('input', { type: 'number', min: 1, max: MAX_PRICE, step: 1, value: own?.price || 100, 'aria-label': `Price of ${v.label || id} in Coins` }), sale = h('input', { type: 'checkbox', checked: own?.enabled !== false, 'aria-label': `${v.label || id} on sale` });
      const detail = h('span', { class: 'admin-pose-detail' }, pr, h('label', { class: 'inline' }, sale, h('span', {}, 'On sale')));
      const upd = () => { detail.hidden = !on.checked; }; on.addEventListener('change', upd); upd();
      return { id, on, pr, sale, node: h('div', { class: 'admin-pose-row' }, h('label', { class: 'inline' }, on, h('span', {}, `${v.label || id} is paid`)), detail) };
    });
    const close = () => dlg.close();
    const save = h('button', { type: 'button', class: 'btn pri', onclick: async () => {
      let store = null, viewStore = null;
      try {
        store = sell.checked ? cleanStore({ price: price.value, enabled: onSale.checked }) : null;
        viewStore = cleanViewStore(Object.fromEntries(poses.filter((x) => x.on.checked).map((x) => [x.id, { price: x.pr.value, enabled: x.sale.checked }])), poses.map((x) => x.id));
      } catch (e) { msg.textContent = e.message; return; }
      save.disabled = true; msg.textContent = 'Saving…';
      try { await updateCloudCharacter(c.id, { store, viewStore }); toast(store || viewStore ? `${c.name}: the store settings are saved.` : `${c.name} is free for everyone.`); close(); await refresh(); }
      catch (e) { msg.textContent = `Could not save: ${friendlyError(e)}`; save.disabled = false; }
    } }, 'Save');
    dlg.append(h('h2', {}, c.name), h('label', { class: 'inline' }, sell, h('span', {}, `Sell the whole character (all poses, ${STORE_DAYS} days per purchase)`)), rows,
      poses.length ? h('div', { class: 'admin-pose-box' }, h('b', {}, 'Poses'), h('small', {}, 'Mark single poses as paid. Poses you leave unticked stay free for everyone (unless the whole character is sold).'), ...poses.map((x) => x.node)) : null,
      h('p', { class: 'admin-store-note' }, 'People who already bought something keep it until their time ends, even if you take it off sale or change the price. Untick everything to make the character free for everyone.'), msg,
      h('div', { class: 'admin-store-foot' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), save));
    dlg.addEventListener('close', () => dlg.remove()); dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    document.body.append(dlg); dlg.showModal();
  }
  /** the Character Store's sales and gifts (the newest 100); loaded only when the admin asks, so the page stays light */
  function salesSection() {
    const box = h('section', { class: 'admin-panel-card admin-characters-sales' });
    const body = h('div', { class: 'admin-sales-body' });
    const load = async (button) => {
      if (button) button.disabled = true; body.replaceChildren(h('p', { class: 'admin-empty', role: 'status' }, 'Loading sales…'));
      try {
        const r = await characterSales(), now = r.serverNow, rows = r.sales;
        const active = rows.filter((x) => timeLeft(x.expiresAt, now) > 0), earned = rows.reduce((n, x) => n + (x.source === 'coins' ? Number(x.price) || 0 : 0), 0);
        const when = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        body.replaceChildren(
          h('p', { class: 'admin-sales-sum' }, `Newest ${rows.length} sales · ${earned.toLocaleString('en-IN')} Coins received · ${active.length} still active`),
          rows.length ? h('div', { class: 'admin-sales-list', role: 'table' }, ...rows.map((x) => h('div', { class: 'admin-sales-row', role: 'row' },
            h('div', { class: 'who' }, h('b', {}, x.email || x.uid), h('small', {}, x.viewLabel ? `${x.characterName} · ${x.viewLabel}` : x.characterName)),
            h('div', { class: 'what' }, h('b', {}, x.source === 'admin' ? 'Gift' : `${Number(x.price).toLocaleString('en-IN')} Coins`), h('small', {}, when(x.purchasedAt))),
            h('div', { class: `until ${timeLeft(x.expiresAt, now) > 0 ? 'on' : ''}` }, h('b', {}, leftText(timeLeft(x.expiresAt, now))), h('small', {}, `until ${when(x.expiresAt)}`))))) : h('p', { class: 'admin-empty' }, 'No sales yet.'));
      } catch (e) { body.replaceChildren(h('p', { class: 'admin-empty', role: 'alert' }, `Could not load the sales: ${friendlyError(e)}`)); }
      finally { if (button) button.disabled = false; }
    };
    const email = h('input', { type: 'email', placeholder: 'user@email.com', 'aria-label': 'Email of the account to give a character to' }), pick = h('select', { 'aria-label': 'Character to give' });
    const giveMsg = h('p', { class: 'admin-store-msg', role: 'status' }, '');
    const give = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!email.value.trim()) { giveMsg.textContent = 'Please enter the email address of the account.'; return; }
      give.disabled = true; giveMsg.textContent = 'Giving…';
      try { const [gid, gview] = pick.value.split('|'); const r = await grantCharacter({ id: gid, view: gview || null, email: email.value.trim() }); giveMsg.textContent = `Done: ${r.email} has the character for ${STORE_DAYS} more days (until ${new Date(r.expiresAt).toLocaleDateString()}).`; email.value = ''; }
      catch (e) { giveMsg.textContent = `Could not give it: ${friendlyError(e)}`; }
      finally { give.disabled = !pick.options.length; }
    } }, `Give ${STORE_DAYS} days`);
    box.fill = () => {
      const keep = pick.value, options = [];
      for (const c of st.list) { if (isPaid(c)) options.push(h('option', { value: c.id }, c.name)); for (const v of Object.keys(c.views || {})) if (viewStoreOf(c, v)) options.push(h('option', { value: `${c.id}|${v}` }, `${c.name} · ${c.views[v].label || v}`)); }
      pick.replaceChildren(...options); if (keep) pick.value = keep; give.disabled = !pick.options.length;
    };
    const show = h('button', { class: 'btn', type: 'button', onclick: (e) => load(e.currentTarget) }, 'Show sales');
    box.append(h('div', { class: 'admin-sales-head' }, h('h2', {}, 'Character Store sales'), show),
      h('div', { class: 'admin-sales-give' }, h('b', {}, 'Give a character to an account'), h('div', { class: 'row' }, email, pick, give), giveMsg),
      body);
    return box;
  }
  let salesEl = null;                          // built once: the loaded sales stay while the page is drawn again
  function previewSection() {
    const pkg = st.pkg; if (!pkg) return null;
    const m = pkg.manifest || {}, totalAnims = views().reduce((n, v) => n + v.animations.length, 0);
    if (pkg.errors.length) return h('section', { class: 'admin-panel-card admin-characters-preview' }, h('h2', {}, 'This ZIP cannot be used'), h('ul', { class: 'admin-characters-errors' }, ...pkg.errors.map((e) => h('li', {}, e))), h('button', { class: 'btn', type: 'button', onclick: () => { st.pkg = null; draw(); } }, 'Choose another ZIP'));
    const catExists = st.list.some((c) => c.category === m.category.id), charExists = st.list.some((c) => c.id === m.character.id);
    const choice = (value, label, note) => h('label', { class: 'admin-characters-choice' }, h('input', { type: 'radio', name: 'anims', checked: st.withAnimations === value, disabled: st.busy, onchange: () => { st.withAnimations = value; } }), h('span', {}, h('b', {}, label), h('small', {}, note)));
    return h('section', { class: 'admin-panel-card admin-characters-preview' },
      h('div', { class: 'admin-characters-head' }, h('div', {}, h('h2', {}, m.character.name), h('small', {}, `Category: ${m.category.name} · ${views().length} views · ${totalAnims} animations · ${mb(pkg.bytes)}`))),
      h('div', { class: 'admin-characters-meta' },
        h('label', {}, h('span', {}, 'Name shown to creators'), h('input', { type: 'text', maxlength: 60, value: st.name, disabled: st.busy, 'aria-label': 'Character name', oninput: (e) => { st.name = e.target.value; } })),
        h('label', {}, h('span', {}, 'Group'), h('select', { 'aria-label': 'Character group', disabled: st.busy, onchange: (e) => { st.group = e.target.value; } }, CHARACTER_GROUPS.map(([id, label]) => h('option', { value: id, selected: st.group === id }, label))))),
      h('div', { class: 'admin-characters-store' },
        h('label', { class: 'admin-characters-choice' }, h('input', { type: 'checkbox', checked: st.sell, disabled: st.busy, 'aria-label': 'Sell this character in the Character Store', onchange: (e) => { st.sell = e.target.checked; draw(); } }),
          h('span', {}, h('b', {}, 'Sell in the Character Store'), h('small', {}, `Creators pay Coins and get the character for ${STORE_DAYS} days (counted on the server). Leave this off to make it free for everyone.`))),
        st.sell ? h('label', { class: 'admin-characters-price' }, h('span', {}, 'Price (Coins)'), h('input', { type: 'number', min: 1, max: MAX_PRICE, step: 1, value: st.price, disabled: st.busy, 'aria-label': 'Price in Coins', oninput: (e) => { st.price = e.target.value; } })) : null),
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
      (salesEl ||= salesSection(), salesEl.fill(), salesEl),
      h('button', { class: 'btn admin-back', type: 'button', onclick: back }, '← Back to Admin'));
    drawInfo();
  }

  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Characters'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: back }, 'Back to Admin')), content);
  draw();
  refresh();                                   // the page is shown at once; the saved characters fill in when the server answers
  return root;
}
