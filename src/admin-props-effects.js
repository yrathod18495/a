// Admin tab "Props & Effects": admins upload props and effects once; every creator sees them in the studio's Props / Effects tabs.
// Data: studioAssets collection (type 'prop' | 'effect'), files in R2, a tiny thumbnail stored with each record (see shared/studio-effects.js).
import { h, logo } from './dom.js';
import { deleteStudioAsset, listStudioAssets, saveStudioAsset } from './studio-assets.js';
import { cleanAssetMeta } from '../shared/studio-effects.js';
import { friendlyError } from '../shared/hinglish-errors.js';

const KINDS = [['prop', '🧸 Props'], ['effect', '💫 Effects']];
const BLEND_LABEL = { normal: 'Normal', add: 'Glow (add)', screen: 'Screen' };

export async function propsEffectsView({ back, home, toast }) {
  const root = h('div', { class: 'sh admin-assets admin-props-effects' });
  const tabs = h('div', { class: 'admin-assets-tabs', role: 'tablist', 'aria-label': 'Props aur effects' });
  const content = h('main', { class: 'admin-assets-content' });
  const state = { kind: 'prop', assets: [], loading: false, filter: 'all', sheet: false };

  const records = () => state.assets.filter((asset) => asset.type === state.kind);
  const categories = () => [...new Set(records().map((asset) => asset.category).filter(Boolean))].sort();
  async function refresh() {
    state.loading = true; draw();
    try { state.assets = await listStudioAssets({ fresh: true }); }
    catch (e) { toast(`Library load nahi ho payi: ${friendlyError(e)}`); }
    state.loading = false; draw();
  }
  async function remove(asset) {
    if (!confirm(`"${asset.name}" ko library se hatayein? Jin projects me ye pehle se laga hai, wahan bacha rahega.`)) return;
    try { await deleteStudioAsset(asset.id); state.assets = state.assets.filter((a) => a.id !== asset.id); draw(); toast(`${asset.name} library se hata diya.`); }
    catch (e) { toast(`Hata nahi paya: ${friendlyError(e)}`); }
  }

  function form() {
    const effect = state.kind === 'effect';
    const file = h('input', { type: 'file', accept: 'image/*', multiple: !effect, required: true, 'aria-label': 'Image file' });
    const name = h('input', { type: 'text', maxlength: 100, placeholder: 'Khali chhodein to file ka naam use hoga', 'aria-label': 'Naam' });
    const category = h('input', { type: 'text', maxlength: 40, list: 'asset-categories', placeholder: effect ? 'jaise Weather, Light, Magic' : 'jaise Furniture, Food, Nature', 'aria-label': 'Category' });
    const datalist = h('datalist', { id: 'asset-categories' }, categories().map((value) => h('option', { value })));
    const field = (label, input, wide = false) => h('label', { class: 'admin-animation-field', style: wide ? 'grid-column:1/-1' : '' }, h('span', {}, label), input);
    const blend = h('select', { 'aria-label': 'Blend mode' }, Object.entries(BLEND_LABEL).map(([value, label]) => h('option', { value }, label)));
    const opacity = h('input', { type: 'number', min: 0.05, max: 1, step: 0.05, value: 1, 'aria-label': 'Opacity' });
    const placement = h('select', { 'aria-label': 'Placement' }, [['full', 'Poori frame par'], ['sticker', 'Chhote sticker ki tarah']].map(([value, label]) => h('option', { value }, label)));
    const sheetOn = h('input', { type: 'checkbox', checked: state.sheet, onchange: (e) => { state.sheet = e.target.checked; draw(); } });
    const cols = h('input', { type: 'number', min: 1, max: 16, value: 4, 'aria-label': 'Sprite sheet columns' }), rows = h('input', { type: 'number', min: 1, max: 16, value: 4, 'aria-label': 'Sprite sheet rows' }), fps = h('input', { type: 'number', min: 1, max: 60, value: 12, 'aria-label': 'Sprite sheet fps' });
    const submit = h('button', { class: 'btn pri', type: 'submit', disabled: state.loading }, effect ? 'Effect publish karein' : 'Prop publish karein');
    return h('form', { class: 'admin-animation-form', onsubmit: async (event) => {
      event.preventDefault();
      const files = [...(file.files || [])];
      if (!files.length) { toast('Pehle image file chunein.'); return; }
      const meta = { category: category.value.trim() };
      if (effect) Object.assign(meta, { blend: blend.value, opacity: Number(opacity.value), placement: placement.value, ...(state.sheet ? { sheet: { cols: Number(cols.value), rows: Number(rows.value), fps: Number(fps.value) } } : {}) });
      try { cleanAssetMeta(state.kind, meta); } catch (error) { toast(error.message); return; }
      submit.disabled = true; state.loading = true;
      try {
        for (const picture of files) await saveStudioAsset(state.kind, name.value.trim() || picture.name.replace(/\.[^.]+$/, ''), picture, meta);
        toast(`${files.length > 1 ? `${files.length} props` : effect ? 'Effect' : 'Prop'} publish ho gaya. Creators ko studio me dikhega.`);
        await refresh();
      } catch (e) { toast(`Publish nahi ho paya: ${friendlyError(e)}`); }
      finally { state.loading = false; submit.disabled = false; }
    } },
      field(effect ? 'Effect image / sprite sheet (up to 40 MB)' : 'Prop image(s) (PNG / WebP, up to 40 MB each)', file, true),
      field('Naam', name), field('Category', category), datalist,
      ...(effect ? [field('Blend mode', blend), field('Opacity (0.05 – 1)', opacity), field('Kahan lage', placement),
        h('label', { class: 'admin-animation-field' }, h('span', {}, 'Ye sprite sheet hai (frames wali animation)'), sheetOn),
        ...(state.sheet ? [field('Columns', cols), field('Rows', rows), field('Frames per second', fps)] : [])] : []),
      submit);
  }

  function card(asset) {
    const detail = asset.type === 'effect'
      ? `${asset.sheet ? `Animated ${asset.sheet.cols}×${asset.sheet.rows} · ${asset.sheet.fps} fps` : 'Still'} · ${BLEND_LABEL[asset.blend] || 'Normal'} · ${Math.round((asset.opacity ?? 1) * 100)}%`
      : `${(asset.size / 1024).toFixed(0)} KB`;
    return h('article', { class: 'admin-asset-card' }, asset.thumb ? h('img', { src: asset.thumb, alt: asset.name, loading: 'lazy' }) : h('div', { class: 'admin-asset-placeholder' }, '◌'),
      h('div', { class: 'admin-asset-copy' }, h('b', {}, asset.name), h('small', {}, `${asset.category || 'Bina category'} · ${detail}`)),
      h('button', { class: 'btn sm', type: 'button', title: `${asset.name} hatayein`, onclick: () => remove(asset) }, 'Hatayein'));
  }

  function draw() {
    tabs.replaceChildren(...KINDS.map(([key, label]) => h('button', { class: `admin-assets-tab ${state.kind === key ? 'active' : ''}`, role: 'tab', 'aria-selected': state.kind === key, onclick: () => { state.kind = key; state.filter = 'all'; draw(); } }, label)));
    const effect = state.kind === 'effect', list = records(), cats = categories();
    const shown = list.filter((asset) => state.filter === 'all' || (asset.category || '') === state.filter);
    content.replaceChildren(
      h('section', { class: 'admin-assets-intro' }, h('span', { class: 'admin-eyebrow' }, 'SHARED STUDIO LIBRARY'), h('h1', {}, effect ? 'Effects' : 'Props'),
        h('p', {}, effect ? 'Rain, sparkle, light leak jaise effects yahan se upload karein. Creators inhe studio ke Effects tab me dekhte aur scene par lagate hain. Sprite sheet dene par effect animate hota hai.' : 'Props yahan se upload karein. Creators inhe studio ke Props tab me category ke hisaab se dekhte aur scene me lagate hain.')),
      form(),
      cats.length ? h('div', { class: 'admin-assets-tabs', style: 'padding-left:0' }, [['all', 'All'], ...cats.map((c) => [c, c])].map(([value, label]) => h('button', { class: `admin-assets-tab ${state.filter === value ? 'active' : ''}`, type: 'button', onclick: () => { state.filter = value; draw(); } }, label))) : null,
      state.loading && !list.length ? h('p', { class: 'admin-assets-empty' }, 'Library load ho rahi hai…')
        : shown.length ? h('div', { class: 'admin-assets-grid' }, shown.map(card))
          : h('div', { class: 'admin-assets-empty' }, h('span', {}, effect ? '💫' : '🧸'), h('b', {}, `Abhi koi ${effect ? 'effect' : 'prop'} nahi hai`), h('p', {}, 'Upar se pehla upload karein; wo creators ko turant dikhega.')),
      h('button', { class: 'btn', type: 'button', onclick: back }, '← Back to Admin'));
  }

  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Props & Effects'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: back }, 'Back to Admin')), tabs, content);
  await refresh();
  return root;
}
