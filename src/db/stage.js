// The animation stage on DragonBones: layered clips (body + legs / hand / face layers) with cross-fades, shots / camera, lip-sync, free camera.
// Characters are DragonBones armatures (src/db/glslot.js) drawn by our WebGL renderer (src/db/renderer.js).
import { GLFactory } from './glslot.js';
import { prepareArmature, assemble } from './prep.js';
import { GLRenderer } from './renderer.js';
import { Motion, limbsFromArmature } from './motion.js';
import { HOP, visemeName } from '../lipsync.js';

export const ASPECTS = {
  '9:16': { w: 9, h: 16, label: 'Portrait 9:16' },
  '16:9': { w: 16, h: 9, label: 'Landscape 16:9' },
  '1:1': { w: 1, h: 1, label: 'Square 1:1' },
  '4:5': { w: 4, h: 5, label: 'Portrait 4:5' },
  '3:4': { w: 3, h: 4, label: 'Portrait 3:4' },
  '4:3': { w: 4, h: 3, label: 'Landscape 4:3' },
  '21:9': { w: 21, h: 9, label: 'Cinema 21:9' },
};
/** a known aspect, or any "w:h" the user typed (e.g. "2:1"); anything else falls back to 16:9 */
export function aspectOf(a) {
  if (ASPECTS[a]) return ASPECTS[a];
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(a || ''));
  if (m && +m[1] > 0 && +m[2] > 0 && +m[1] / +m[2] <= 8 && +m[2] / +m[1] <= 8) return { w: +m[1], h: +m[2], label: `Custom ${a}` };
  return ASPECTS['16:9'];
}
export const BACKGROUNDS = [
  { name: 'Midnight', a: '#1b1f4b', b: '#6a3cbc' },
  { name: 'Sunrise', a: '#ff9966', b: '#ff5e62' },
  { name: 'Sky', a: '#4facfe', b: '#c2e9fb' },
  { name: 'Forest', a: '#134e5e', b: '#71b280' },
  { name: 'Paper', a: '#f4efe6', b: '#f4efe6' },
  { name: 'Chroma', a: '#00b140', b: '#00b140' },
];

// Works on the page and inside a Web Worker (used by the parallel video export).
const makeCanvas = (w = 1, h = 1) => {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};
/** decodes an image once and (optionally) shrinks it so huge character sheets use less memory */
async function loadImage(blob, maxSide, knownSize) {
  const opts = { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };   // premultiplied = no dark edges when the sheet is filtered / shrunk
  if (knownSize && maxSide && Math.max(knownSize.w, knownSize.h) > maxSide) {
    const k = maxSide / Math.max(knownSize.w, knownSize.h);
    return createImageBitmap(blob, { ...opts, resizeWidth: Math.round(knownSize.w * k), resizeHeight: Math.round(knownSize.h * k), resizeQuality: 'high' });
  }
  const bmp = await createImageBitmap(blob, opts);
  if (maxSide && Math.max(bmp.width, bmp.height) > maxSide) {
    const k = maxSide / Math.max(bmp.width, bmp.height);
    const small = await createImageBitmap(bmp, { ...opts, resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close(); return small;
  }
  return bmp;
}

/** how the mouth shapes are called in this rig: our own `lips` slot (lip_*) or Autodraft's `Mouth-X` slot (Mouth/A … Mouth/X) */
const AD_MOUTH = { lip_idle: 'Mouth/X', lip_a_e_i: 'Mouth/D', lip_ee: 'Mouth/B', lip_o: 'Mouth/C', lip_u: 'Mouth/F', lip_b_m_p: 'Mouth/A', lip_c_d_g_k_n_s_t_x_y_z: 'Mouth/B', lip_ch_sh_j: 'Mouth/E', lip_f_v: 'Mouth/A_B', lip_l: 'Mouth/C', lip_r: 'Mouth/E', lip_th: 'Mouth/B', lip_qw: 'Mouth/F' };
function lipSetup(prep) {
  if (prep.disp.has('lips')) return { slot: 'lips', map: null };
  for (const [slot, names] of prep.disp) if (names.has('Mouth/X') || names.has('Mouth/A')) return { slot, map: AD_MOUTH };      // Autodraft: slot Mouth-X or Mouth/X, pictures Mouth/A ... Mouth/X
  return null;
}
const FADE = 0.35; // seconds of cross-fade between two animations
const CAM_ZOOM = { wide: 1, medium: 1.8, close: 3.2 }, CAM_MOVE = 0.6; // camera zoom per shot type, seconds to glide between shots
const ease = (k) => k * k * (3 - 2 * k);

export class Stage {
  /** maxTex: largest texture side to keep on the GPU (character sheets are usually 4096) */
  constructor({ maxTex = 2048 } = {}) {
    this.maxTex = maxTex;
    this.out = makeCanvas(2, 2);                           // the only canvas: shown to the user and recorded
    this.r = new GLRenderer(this.out);
    this.gl = this.r.gl;
    this.assets = new Map();  // charId -> { def, pages: Map(imagePath -> GLTex) }
    this.swapTex = new Map(); // Blob / key -> GLTex
    this.propTex = new Map(); // shared image props by project prop id
    this.props = [];
    this.layers = [];         // back -> front draw order
    this.bg = { preset: 0, image: null };
    this.camKeys = [];        // camera keyframes [{t, cx, cy, zoom, ease}] (cx, cy = 0..1 of the canvas); empty = automatic shots
    this.userCam = null;      // Character Studio: free zoom / pan {zoom, cx, cy} in canvas pixels (zoom below 1 = out, nothing is clamped)
    this.fullView = false;    // editing: show the whole canvas instead of what the camera sees
    this.bgKey = ''; this.bgVer = 0; this.bgTex = null;
    this.prepCache = new Map(); this.uid = 0;
    this.setSize('16:9', 720);
  }

  setSize(aspect, short) {
    const { w, h } = aspectOf(aspect);
    const k = short / Math.min(w, h);
    this.aspect = aspect; this.W = Math.round((w * k) / 2) * 2; this.H = Math.round((h * k) / 2) * 2;
    this.out.width = this.W; this.out.height = this.H;
    this.layout();
  }

  /** def = { id, ske (DragonBones armature json), tex: [{ json (texture atlas json), image (Blob) }] } */
  async loadCharacter(def) {
    if (this.assets.has(def.id)) return;
    const pages = new Map();
    for (const t of def.tex) pages.set(t.json.imagePath, this.r.texture(await loadImage(t.image, this.maxTex, { w: t.json.width, h: t.json.height })));
    this.assets.set(def.id, { def, pages });
  }
  /** forget a loaded character (its pictures changed) */
  unload(charId) { const a = this.assets.get(charId); if (a) { a.pages.forEach((t) => t.dispose()); this.assets.delete(charId); } for (const k of [...this.prepCache.keys()]) if (k.startsWith(`${charId}|`)) this.prepCache.delete(k); }
  /** swap the armature data of a loaded character (Character Studio edits) without reloading its textures */
  setRig(charId, ske) { const a = this.assets.get(charId); if (a) { a.def = { ...a.def, ske }; this.prepCache.delete(charId); } }
  pageNames(def) { return def.tex.map((t) => t.json.imagePath); }
  /** a user-supplied replacement picture (same layout as the original texture page) */
  async loadSwapCanvas(key, canvas) {
    const k = Math.min(1, this.maxTex / Math.max(canvas.width, canvas.height));
    const opts = { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };
    const bmp = await createImageBitmap(canvas, k < 1 ? { ...opts, resizeWidth: Math.round(canvas.width * k), resizeHeight: Math.round(canvas.height * k), resizeQuality: 'medium' } : opts);
    this.swapTex.set(key, this.r.texture(bmp));
  }
  dropSwap(key) { const t = this.swapTex.get(key); if (t) { t.dispose(); this.swapTex.delete(key); } }
  async loadSwap(blob) { if (!this.swapTex.has(blob)) this.swapTex.set(blob, this.r.texture(await loadImage(blob, this.maxTex))); }

  /** merged-outfit armature data of a character (cached) */
  prepOf(charId, skins) {
    const key = `${charId}|${skins ? [...skins].sort().join(',') : '*'}`;
    let p = this.prepCache.get(key);
    if (!p) { const { def } = this.assets.get(charId); p = prepareArmature(def.ske, skins); this.prepCache.set(key, p); }
    return p;
  }
  /** a posed (setup) armature of a character, e.g. for the PSD export or limb detection */
  armatureFor(charId, skins, anims = {}) {
    const p = this.prepOf(charId, skins), f = new GLFactory(), name = `T${++this.uid}`, { def } = this.assets.get(charId);
    f.parseDragonBonesData(assemble(p, anims), name);
    for (const t of def.tex) f.parseTextureAtlasData(t.json, null, name);
    const arm = f.buildArmature(p.arm.name, name, 'all', name); arm.advanceTime(0);
    return { arm, factory: f, name, prep: p };
  }
  disposeTemp(t) { try { t.arm.dispose(); t.factory.removeDragonBonesData(t.name, true); t.factory.removeTextureAtlasData(t.name, true); } catch { /* already gone */ } }
  /** the limbs of a character (found from the skeleton's shape), cached */
  limbsOf(charId, skins = null) {
    const prep = this.prepOf(charId, skins);
    this.limbCache = this.limbCache || new WeakMap();
    if (!this.limbCache.has(prep)) { const t = this.armatureFor(charId, skins), out = limbsFromArmature(t.arm, prep); this.disposeTemp(t); this.limbCache.set(prep, out); }
    return this.limbCache.get(prep);
  }
  dispose(layer) {
    try { layer.arm.dispose(); layer.factory.removeDragonBonesData(layer.dbName, true); layer.factory.removeTextureAtlasData(layer.dbName, true); } catch { /* already gone */ }
  }

  /**
   * speakers: [{key, charId, swap, anims:{name: dragonBonesAnimation}, clips:[{id, kind:'body'|'face', name, start, dur, off}], flip, slot, visible, xf, fit, skins, hide}]
   * in back->front order. Returns the keys of layers that could not be built.
   */
  setLayers(speakers) {
    const failed = [];
    for (const l of this.layers) this.dispose(l);
    this.layers = speakers.filter((s) => s.charId && this.assets.has(s.charId)).map((s) => {
      const a = this.assets.get(s.charId), prep = this.prepOf(s.charId, s.skins || null), f = new GLFactory(), dbName = `L${++this.uid}`;
      f.parseDragonBonesData(assemble(prep, s.anims || {}), dbName);
      for (const t of a.def.tex) f.parseTextureAtlasData(t.json, null, dbName);
      const arm = f.buildArmature(prep.arm.name, dbName, 'all', dbName); arm.advanceTime(0);
      const tex = new Map(a.pages);
      for (const [page, key] of Object.entries(s.swap || {})) { const t = this.swapTex.get(key); if (t) tex.set(page, t); }
      const bone = (...names) => names.map((n) => arm.getBone(n)).find(Boolean) || null;
      const layer = { key: s.key, flip: s.flip, slot: s.slot, visible: s.visible, mask: s.mask || null, maskKeys: s.maskKeys || [], maskFollow: s.maskFollow || '', mul: s.xf?.mul ?? 1, axf: s.xf?.axf ?? null, ayf: s.xf?.ayf ?? null, charId: s.charId,
        hide: new Set(s.hide || []), arm, factory: f, dbName, prep, tex, anim: new Set(arm.armatureData.animationNames), clips: [], present: s.present || null, shown: true, bounds: null, lipOk: new Map(),
        bones: { head: bone('head', 'HEAD'), neck: bone('neck', 'NECK'), upper_body3: bone('upper_body3', 'TORSO3'), upper_body4: bone('upper_body4', 'TORSO2') }, lip: lipSetup(prep), states: [], mat: [1, 0, 0, 1, 0, 0],
        phase: [...s.key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000, 7) / 159 };
      layer.motion = new Motion(arm, prep, s.fit, limbsFromArmature(arm, prep));
      layer.keys = (s.keys || []).slice().sort((x, y) => x.t - y.t);
      layer.base = { flip: !!s.flip, mul: s.xf?.mul ?? 1, axf: s.xf?.axf ?? null, ayf: s.xf?.ayf ?? null };
      this.setClips(layer, s.clips);
      const bodyNames = [...new Set(layer.clips.filter((c) => c.kind === 'body').flatMap((c) => [c.base, c.name]).filter(Boolean))].slice(0, 8);
      layer.bounds = this.measure(layer, bodyNames);
      return layer;
    });
    this.layout();
    return failed;
  }

  /** replace a layer's animation clips (keeps the armature, so moving/splitting clips is instant) */
  setClips(layerOrKey, clips, present) {
    const l = typeof layerOrKey === 'string' ? this.layers.find((x) => x.key === layerOrKey) : layerOrKey;
    if (!l) return;
    if (present !== undefined) l.present = present;
    l.clips = (clips || []).filter((c) => l.anim.has(c.name)).map((c) => ({ ...c, base: c.base && l.anim.has(c.base) ? c.base : undefined }));
  }

  /** movement keyframes of one character: [{t, x, y, mul, flip, ease}] (x, y = anchor as a fraction of the canvas, y from the bottom; mul = size). Empty = back to its fixed place. */
  setLayerKeys(key, keys) {
    const l = this.layers.find((x) => x.key === key);
    if (!l) return;
    l.keys = (keys || []).slice().sort((a, b) => a.t - b.t);
    if (!l.keys.length && l.base) { l.flip = l.base.flip; l.mul = l.base.mul; l.axf = l.base.axf; l.ayf = l.base.ayf; this.layout(); }
  }
  keyChar(ks, t) {
    const at = (k) => ({ axf: k.x, ayf: k.y, mul: Math.max(0.05, k.mul), flip: !!k.flip });
    if (t <= ks[0].t) return at(ks[0]);
    const last = ks[ks.length - 1];
    if (t >= last.t) return at(last);
    const i = ks.findIndex((k, j) => t >= k.t && t < ks[j + 1].t), a = ks[i], b = ks[i + 1];
    let u = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const e = a.ease || 'smooth';
    u = e === 'hold' ? 0 : e === 'linear' ? u : e === 'in' ? u * u : e === 'out' ? 1 - (1 - u) * (1 - u) : ease(u);
    const A = at(a), B = at(b);
    return { axf: A.axf + (B.axf - A.axf) * u, ayf: A.ayf + (B.ayf - A.ayf) * u, mul: Math.exp(Math.log(A.mul) + (Math.log(B.mul) - Math.log(A.mul)) * u), flip: A.flip };
  }

  /** change draw order without rebuilding armatures (keys are back -> front) */
  reorder(keys) { this.layers.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key)); }

  /** draw list of a layer (armature coordinates, y down) */
  collect(l, list = []) {
    for (const s of l.arm.getSlots()) { if (l.hide.has(s.name)) continue; s.collect(list); }
    return list;
  }
  /** union of the armature bounds over every animation the layer uses, so scaling is stable */
  measure(l, animNames) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const grow = () => {
      l.arm.advanceTime(0);
      for (const it of this.collect(l)) for (let i = 0; i < it.verts.length; i += 2) {
        const x = it.verts[i], y = it.verts[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    };
    const names = (animNames || []).filter((n) => l.anim.has(n));
    if (!names.length) grow();
    for (const n of names) {
      const dur = l.arm.armatureData.getAnimation(n).duration;
      for (let i = 0; i <= 10; i++) { this.setStates(l, [{ name: n, time: (dur * i) / 10, weight: 1 }]); grow(); }
    }
    this.setStates(l, []); l.arm.advanceTime(0);
    if (x1 < x0) return { x: -200, y: -800, w: 400, h: 800 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  layout() {
    const n = this.layers.length, W = this.W, H = this.H;
    const slotW = W / Math.max(n, 1);
    // one shared auto scale, so characters keep their real relative size (like on the original platform)
    const fit = (l) => Math.min((slotW * 0.96) / l.bounds.w, (H * 0.9) / l.bounds.h);
    const auto = Math.min(...this.layers.map(fit));
    this.layers.forEach((l, i) => {
      const b = l.bounds, S = auto * (l.mul ?? 1), dir = l.flip ? -1 : 1;
      // anchor = bottom-centre of the character; auto-placed in its slot unless the user moved it
      const ax = l.axf != null ? l.axf * W : slotW * ((l.slot ?? i) + 0.5);
      const ay = l.ayf != null ? l.ayf * H : H * 0.07;
      const c = b.x + b.w / 2, ayD = H - ay;
      l.mat = [S * dir, 0, 0, S, ax - c * S * dir, ayD - (b.y + b.h) * S];
      // selection box in canvas pixels (y down)
      l.box = { x0: ax - (b.w / 2) * S, x1: ax + (b.w / 2) * S, y0: ayD - b.h * S, y1: ayD };
      l.anchor = { x: ax, y: ayD };
    });
  }

  async setBackgroundImage(file) {
    this.bg.image = file ? await loadImage(file) : null;
    this.bgVer++;
  }

  async setProps(props = []) {
    const next = new Set(props.map((p) => p.id));
    for (const [id, tex] of this.propTex) if (!next.has(id)) { tex.dispose(); this.propTex.delete(id); }
    for (const prop of props) if (prop.blob && !this.propTex.has(prop.id)) this.propTex.set(prop.id, this.r.texture(await loadImage(prop.blob, this.maxTex)));
    this.props = props.filter((p) => this.propTex.has(p.id));
  }

  /** the background (gradient and/or image) is painted once into a texture and drawn as one quad per frame */
  ensureBackground() {
    const key = `${this.bg.preset}|${this.bgVer}|${this.W}x${this.H}`;
    if (key === this.bgKey) return;
    const { W, H } = this, c = makeCanvas(W, H), g = c.getContext('2d');
    const p = BACKGROUNDS[this.bg.preset] || BACKGROUNDS[0];
    const grad = g.createLinearGradient(0, 0, W * 0.3, H); grad.addColorStop(0, p.a); grad.addColorStop(1, p.b);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const im = this.bg.image;
    if (im) {
      const k = Math.max(W / im.width, H / im.height);
      g.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k);
    }
    this.bgTex?.dispose();
    this.bgTex = this.r.texture(c, false);
    this.bgKey = key;
  }

  /**
   * DragonBones animation states of a layer: state number i is DragonBones layer i; a higher layer takes `weight` of the pose from the ones below
   * (the same "replace" mixing the Spine stage used), bones it does not animate keep what lower layers say.
   */
  setStates(l, want) {
    const anim = l.arm.animation;
    want.forEach((w, i) => {
      let s = l.states[i];
      if (!s || s.name !== w.name) {
        if (s) s.fadeOut(0);
        s = anim.fadeIn(w.name, 0, -1, i); s.autoFadeOutTime = -1; l.states[i] = s;
      }
      // DragonBones converts frame counts to seconds when parsing the JSON.
      const dur = l.arm.armatureData.getAnimation(w.name).duration;
      s.currentTime = dur > 0 ? ((w.time % dur) + dur) % dur : 0; s.weight = w.weight;
    });
    for (let i = want.length; i < l.states.length; i++) if (l.states[i]) l.states[i].fadeOut(0);
    l.states.length = want.length;
  }
  /** apply a clip's animation(s): an optional idle base (head / body motion) with the gesture layered on top */
  stack(want, c, t, alpha) {
    const off = t - c.start + (c.off || 0);
    if (c.base) want.push({ name: c.base, time: Math.max(0, t), weight: alpha });
    want.push({ name: c.name, time: Math.max(0, off), weight: alpha });
  }
  pose(l, t) {
    const want = [], body = l.clips.filter((c) => c.kind === 'body'), i = body.findIndex((c) => t >= c.start && t < c.start + c.dur);
    if (i >= 0) {
      const c = body[i], prev = body[i - 1], age = t - c.start;
      if (prev && age < FADE && Math.abs(prev.start + prev.dur - c.start) < 0.02 && (prev.name !== c.name || prev.base !== c.base)) {
        this.stack(want, prev, t, 1);          // the previous pose keeps running while we fade into the next one
        this.stack(want, c, t, age / FADE);
      } else this.stack(want, c, t, 1);
    }
    for (const kind of ['legs', 'hand', 'face']) {            // layers on top of the body animation
      const c = l.clips.find((x) => x.kind === kind && t >= x.start && t < x.start + x.dur);
      if (c) this.stack(want, c, t, 1);
    }
    this.setStates(l, want);
  }

  /** where the camera looks for one audio line: {zoom, cx, cy} (cx, cy in canvas pixels, y down) */
  shotCam(line) {
    const wide = { zoom: 1, cx: this.W / 2, cy: this.H / 2 }, z = CAM_ZOOM[line?.type || 'wide'] || 1;
    if (z <= 1.001) return wide;
    const lay = this.layers.find((l) => l.key === (line.focus && line.focus !== 'auto' ? line.focus : line.speaker)) || this.layers[0];
    if (!lay?.box) return wide;
    const b = lay.box, h = b.y1 - b.y0;
    return { zoom: z, cx: (b.x0 + b.x1) / 2, cy: b.y0 + h * (line.type === 'close' ? 0.17 : 0.32) };
  }
  /** camera between the user's keyframes (zoom is blended in log space so zooming feels even) */
  keyCam(t) {
    const ks = this.camKeys, { W, H } = this, at = (k) => ({ zoom: Math.max(1, k.zoom), cx: k.cx * W, cy: k.cy * H });
    if (t <= ks[0].t) return at(ks[0]);
    const last = ks[ks.length - 1];
    if (t >= last.t) return at(last);
    const i = ks.findIndex((k, j) => t >= k.t && t < ks[j + 1].t), a = ks[i], b = ks[i + 1];
    let u = (t - a.t) / Math.max(1e-6, b.t - a.t);
    const e = a.ease || 'smooth';
    u = e === 'hold' ? 0 : e === 'linear' ? u : e === 'in' ? u * u : e === 'out' ? 1 - (1 - u) * (1 - u) : ease(u);
    const A = at(a), B = at(b);
    return { zoom: Math.exp(Math.log(A.zoom) + (Math.log(B.zoom) - Math.log(A.zoom)) * u), cx: A.cx + (B.cx - A.cx) * u, cy: A.cy + (B.cy - A.cy) * u };
  }
  /** the frame the camera shows at time t in canvas pixels (what the editor draws as the camera rectangle) */
  frameAt(plan, t) {
    const cam = this.cameraAt(plan, t, true), { W, H } = this, vw = W / cam.zoom, vh = H / cam.zoom;
    const cx = Math.min(W - vw / 2, Math.max(vw / 2, cam.cx)), cy = Math.min(H - vh / 2, Math.max(vh / 2, cam.cy));
    return { x0: cx - vw / 2, x1: cx + vw / 2, y0: cy - vh / 2, y1: cy + vh / 2, cx, cy, zoom: cam.zoom };
  }
  /** camera for time t: the user's keyframes if there are any, else the shot of the current audio line (it glides to the next line's shot just before that line starts) */
  cameraAt(plan, t, real = false) {
    if (this.userCam) return this.userCam;
    if (this.fullView && !real) return { zoom: 1, cx: this.W / 2, cy: this.H / 2 };
    if (this.camKeys?.length) return this.keyCam(t);
    if (!plan?.length) return this.shotCam(null);
    let i = plan.findIndex((l, k) => t >= l.start && (k === plan.length - 1 || t < plan[k + 1].start));
    if (i < 0) i = 0;
    const cur = this.shotCam(plan[i]), nx = plan[i + 1];
    if (nx && t > nx.start - CAM_MOVE) {
      const to = this.shotCam(nx), k = ease(Math.min(1, Math.max(0, (t - (nx.start - CAM_MOVE)) / CAM_MOVE)));
      return { zoom: cur.zoom + (to.zoom - cur.zoom) * k, cx: cur.cx + (to.cx - cur.cx) * k, cy: cur.cy + (to.cy - cur.cy) * k };
    }
    return cur;
  }

  /**
   * Draw one frame. t = timeline seconds, dt = real seconds advanced (0 when scrubbing).
   * clips: timeline clips; active clip drives the speaker's mouth.
   */
  render(t, dt, clips, plan) {
    const { r, W, H } = this;
    let moved = false;
    for (const l of this.layers) if (l.keys?.length) {
      const v = this.keyChar(l.keys, t);
      if (v.axf !== l.axf || v.ayf !== l.ayf || v.mul !== l.mul || v.flip !== l.flip) { l.axf = v.axf; l.ayf = v.ayf; l.mul = v.mul; l.flip = v.flip; moved = true; }
    }
    if (moved) this.layout();
    for (const l of this.layers) {
      l.shown = !l.present || l.present.some((x) => t >= x.start && t < x.end);
      l.motion.reset();                                   // offsets of the last frame (physics, life, proportions) are removed before the pose is evaluated
      this.pose(l, t);
      this.life(l, t);
      l.motion.fitting();                                 // proportions: leg / arm / hand length
      l.arm.advanceTime(0);
      const clip = clips.find((c) => c.speaker === l.key && t >= c.start && t < c.end);
      if (clip && l.lip) {
        const f = Math.floor((t - clip.start) / HOP);
        const viseme = visemeName(clip.visemes[Math.min(f, clip.visemes.length - 1)]), want = l.lip.map ? l.lip.map[viseme] : viseme;
        const idx = want != null ? l.prep.disp.get(l.lip.slot)?.get(want) : undefined;
        if (idx != null) l.arm.getSlot(l.lip.slot).displayIndex = idx;
      }
      if (l.motion.constrain()) l.arm.advanceTime(0);     // transform constraints of the source rig
      l.motion.simulate(dt);                              // hair / cloth physics
      l.arm.advanceTime(0);
    }
    for (const l of this.layers) if (l.mask && l.maskKeys?.length) {
      const ks=l.maskKeys, a=[...ks].reverse().find(k=>k.t<=t)||ks[0], b=ks.find(k=>k.t>t);
      if(b){const u=Math.max(0,Math.min(1,(t-a.t)/Math.max(.001,b.t-a.t)));l.mask={...l.mask,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,w:a.w+(b.w-a.w)*u,h:a.h+(b.h-a.h)*u};}
      else l.mask={...l.mask,x:a.x,y:a.y,w:a.w,h:a.h};
      if(l.maskFollow){const bone=l.arm.getBone(l.maskFollow);if(bone){const m=bone.globalTransformMatrix, p={x:l.mat[0]*m.tx+l.mat[2]*m.ty+l.mat[4],y:l.mat[1]*m.tx+l.mat[3]*m.ty+l.mat[5]};l.mask={...l.mask,x:(p.x-l.mask.w*this.W/2)/this.W,y:(p.y-l.mask.h*this.H/2)/this.H};}}
    }
    this.ensureBackground();
    r.clear(...(this.userCam ? [0.93, 0.95, 0.97] : [0, 0, 0]));
    const cam = this.cameraAt(plan, t), vw = W / cam.zoom, vh = H / cam.zoom;
    this.camZoom = cam.zoom;
    const free = this.userCam === cam, cx = free ? cam.cx : Math.min(W - vw / 2, Math.max(vw / 2, cam.cx)), cy = free ? cam.cy : Math.min(H - vh / 2, Math.max(vh / 2, cam.cy));
    r.begin(W, H, { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh });
    r.setMask(null, W, H);
    r.quad(this.bgTex, 0, 0, W, H);
    const list = [];
    for (const l of this.layers) if (l.visible !== false && l.shown !== false) {
      r.setMask(l.mask, W, H);
      list.length = 0; this.collect(l, list);
      for (const it of list) r.add(it, l.tex.get(it.atlas.imagePath) || this.assets.get(l.charId).pages.get(it.atlas.imagePath), l.mat);
    }
    r.setMask(null, W, H);
    for (const prop of this.props) {
      const tex = this.propTex.get(prop.id); if (!tex || prop.visible === false) continue;
      const w = Math.max(8, (prop.w || 0.18) * W), h = Math.max(8, (prop.h || 0.18) * H);
      const x = (prop.x ?? 0.5) * W - w / 2, y = (prop.y ?? 0.65) * H - h / 2, a = (prop.rotation || 0) * Math.PI / 180;
      const c = Math.cos(a), s = Math.sin(a), cx = x + w / 2, cy = y + h / 2;
      const m = [c, s, -s, c, cx - c * w / 2 + s * h / 2, cy - s * w / 2 - c * h / 2];
      r.add({ verts: new Float32Array([0, 0, w, 0, w, h, 0, h]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]), alpha: 1, r: 1, g: 1, b: 1, blend: 0 }, tex, m);
    }
    r.end();
    this.onFrame?.();
  }

  /** tiny always-on movement (neck nods forward / back a little, chest breathes) so nobody looks frozen */
  life(l, t) {
    const w = Math.PI * 2, { head, neck, upper_body3: chest, upper_body4: back } = l.bones, p = l.phase, d = Math.PI / 180, add = (b, deg) => { if (b) { b.offset.rotation += deg * d; b.invalidUpdate(); } };
    // the neck sways a little on its own (slower than the head), so a standing character never looks frozen
    add(neck, 1.7 * Math.sin((w * t) / 5.3 + p * 0.6) + 0.8 * Math.sin((w * t) / 2.9 + p * 1.3) + 0.4 * Math.sin((w * t) / 1.3 + p));
    add(head, 1.2 * Math.sin((w * t) / 4.3 + p) + 0.5 * Math.sin((w * t) / 2.1 + p * 1.7));
    add(back, 0.4 * Math.sin((w * t) / 4.3 + p - 0.7));
    if (chest) { chest.offset.scaleY *= 1 + 0.004 * Math.sin((w * t) / 3.2 + p); chest.invalidUpdate(); }
  }
}


