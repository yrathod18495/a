// Admin → Add Assets → Add Props / Add Effects (also usable as a page of its own): admins upload props and effects once; every creator sees them in the studio's Props / Effects tabs.
// Data: studioAssets collection (type 'prop' | 'effect'), files in R2, a tiny thumbnail stored with each record (see shared/studio-effects.js).
import { h, logo } from './dom.js';
import { deleteStudioAsset, listStudioAssets, saveStudioAsset, setPropGroup, setAssetAccess } from './studio-assets.js';
import { cleanAssetMeta } from '../shared/studio-effects.js';
import { friendlyError } from '../shared/hinglish-errors.js';

const KINDS = [['prop', '🧸 Props'], ['effect', '💫 Effects']];
const ACCESS_LABEL = { paid: 'Paid accounts only', free: 'Free for everyone' };
const GROUP_LABEL = { general: 'General (Props tab)', hand: 'Hand (character toolbox)' };
const BLEND_LABEL = { normal: 'Normal', add: 'Glow (add)', screen: 'Screen' };

/** `only` ('prop' | 'effect'): the same screen for one kind, without its own header, tabs or back button (used inside Admin → Add Assets). Returns the content element then. */
export async function propsEffectsView({ back, home, toast, only = null }) {
  const root = h('div', { class: 'sh admin-assets admin-props-effects' });
  const tabs = h('div', { class: 'admin-assets-tabs', role: 'tablist', 'aria-label': 'Props aur effects' });
  const content = h('main', { class: 'admin-assets-content' });
  const state = { kind: only || 'prop', assets: [], loading: false, filter: 'all', sheet: false };

  const records = () => state.assets.filter((asset) => asset.type === state.kind);
  const categories = () => [...new Set(records().map((asset) => asset.category).filter(Boolean))].sort();
  async function refresh() {
    state.loading = true; draw();
    try { state.assets = await listStudioAssets({ fresh: true }); }
    catch (e) { toast(`Could not load the library: ${friendlyError(e)}`); }
    state.loading = false; draw();
  }
  async function remove(asset) {
    if (!confirm(`Remove "${asset.name}" from the library? It will remain in projects that already use it.`)) return;
    try { await deleteStudioAsset(asset.id); state.assets = state.assets.filter((a) => a.id !== asset.id); draw(); toast(`${asset.name} removed from the library.`); }
    catch (e) { toast(`Could not remove it: ${friendlyError(e)}`); }
  }

  async function changeAccess(asset, access, select) {
    select.disabled = true;
    try {
      const saved = await setAssetAccess(asset.id, access);
      state.assets = state.assets.map((a) => { if (a.id !== asset.id) return a; const { access: _x, ...rest } = a; return saved.access ? { ...rest, access: saved.access } : rest; });
      toast(`${asset.name} is now ${access === 'free' ? 'free for everyone' : 'for paid accounts only'}.`);
    } catch (e) { select.value = asset.access === 'free' ? 'free' : 'paid'; toast(`Could not change who can use it: ${friendlyError(e)}`); }
    finally { select.disabled = false; }
  }
  async function changeGroup(asset, group, select) {
    select.disabled = true;
    try {
      const saved = await setPropGroup(asset.id, group);
      state.assets = state.assets.map((a) => (a.id === asset.id ? { ...a, ...saved } : a));
      toast(`${asset.name} is now a ${group === 'hand' ? 'hand' : 'general'} prop.`);
    } catch (e) { select.value = asset.group === 'hand' ? 'hand' : 'general'; toast(`Could not change the prop type: ${friendlyError(e)}`); }
    finally { select.disabled = false; }
  }

  function form() {
    const effect = state.kind === 'effect';
    const file = h('input', { type: 'file', accept: 'image/*', multiple: !effect, required: true, 'aria-label': 'Image file' });
    const name = h('input', { type: 'text', maxlength: 100, placeholder: 'Leave blank to use the file name', 'aria-label': 'Name' });
    const category = h('input', { type: 'text', maxlength: 40, list: 'asset-categories', placeholder: effect ? 'e.g. Weather, Light, Magic' : 'e.g. Furniture, Food, Nature', 'aria-label': 'Category' });
    const group = h('select', { 'aria-label': 'Prop type' }, Object.entries(GROUP_LABEL).map(([value, label]) => h('option', { value }, label)));
    const access = h('select', { 'aria-label': 'Who can use it' }, Object.entries(ACCESS_LABEL).map(([value, label]) => h('option', { value }, label)));
    const datalist = h('datalist', { id: 'asset-categories' }, categories().map((value) => h('option', { value })));
    const field = (label, input, wide = false) => h('label', { class: 'admin-animation-field', style: wide ? 'grid-column:1/-1' : '' }, h('span', {}, label), input);
    const blend = h('select', { 'aria-label': 'Blend mode' }, Object.entries(BLEND_LABEL).map(([value, label]) => h('option', { value }, label)));
    const opacity = h('input', { type: 'number', min: 0.05, max: 1, step: 0.05, value: 1, 'aria-label': 'Opacity' });
    const placement = h('select', { 'aria-label': 'Placement' }, [['full', 'Full frame'], ['sticker', 'Small sticker']].map(([value, label]) => h('option', { value }, label)));
    const sheetOn = h('input', { type: 'checkbox', checked: state.sheet, onchange: (e) => { state.sheet = e.target.checked; draw(); } });
    const cols = h('input', { type: 'number', min: 1, max: 16, value: 4, 'aria-label': 'Sprite sheet columns' }), rows = h('input', { type: 'number', min: 1, max: 16, value: 4, 'aria-label': 'Sprite sheet rows' }), fps = h('input', { type: 'number', min: 1, max: 60, value: 12, 'aria-label': 'Sprite sheet fps' });
    const submit = h('button', { class: 'btn pri', type: 'submit', disabled: state.loading }, effect ? 'Publish effect' : 'Publish prop');
    return h('form', { class: 'admin-animation-form', onsubmit: async (event) => {
      event.preventDefault();
      const files = [...(file.files || [])];
      if (!files.length) { toast('Please choose an image file first.'); return; }
      const meta = { category: category.value.trim(), access: access.value };
      if (!effect) meta.group = group.value;
      if (effect) Object.assign(meta, { blend: blend.value, opacity: Number(opacity.value), placement: placement.value, ...(state.sheet ? { sheet: { cols: Number(cols.value), rows: Number(rows.value), fps: Number(fps.value) } } : {}) });
      try { cleanAssetMeta(state.kind, meta); } catch (error) { toast(error.message); return; }
      submit.disabled = true; state.loading = true;
      try {
        for (const picture of files) await saveStudioAsset(state.kind, name.value.trim() || picture.name.replace(/\.[^.]+$/, ''), picture, meta);
        toast(`${files.length > 1 ? `${files.length} props` : effect ? 'Effect' : 'Prop'} published. Creators will see it in the studio.`);
        await refresh();
      } catch (e) { toast(`Could not publish: ${friendlyError(e)}`); }
      finally { state.loading = false; submit.disabled = false; }
    } },
      field(effect ? 'Effect image / sprite sheet (up to 40 MB)' : 'Prop image(s) (PNG / WebP, up to 40 MB each)', file, true),
      field('Name', name), field('Category', category), datalist,
      ...(effect ? [] : [field('Prop type', group)]), field('Who can use it', access),
      ...(effect ? [field('Blend mode', blend), field('Opacity (0.05 – 1)', opacity), field('Placement', placement),
        h('label', { class: 'admin-animation-field' }, h('span', {}, 'This is a sprite sheet (frame-based animation)'), sheetOn),
        ...(state.sheet ? [field('Columns', cols), field('Rows', rows), field('Frames per second', fps)] : [])] : []),
      submit);
  }

  function card(asset) {
    const detail = asset.type === 'effect'
      ? `${asset.sheet ? `Animated ${asset.sheet.cols}×${asset.sheet.rows} · ${asset.sheet.fps} fps` : 'Still'} · ${BLEND_LABEL[asset.blend] || 'Normal'} · ${Math.round((asset.opacity ?? 1) * 100)}%`
      : `${(asset.size / 1024).toFixed(0)} KB`;
    return h('article', { class: 'admin-asset-card' }, asset.thumb ? h('img', { src: asset.thumb, alt: asset.name, loading: 'lazy' }) : h('div', { class: 'admin-asset-placeholder' }, '◌'),
      h('div', { class: 'admin-asset-copy' }, h('b', {}, asset.name), h('small', {}, `${asset.category || 'No category'} · ${detail}`),
        h('select', { class: 'prop-group asset-access', 'aria-label': `Who can use ${asset.name}`, title: 'Everyone sees every item. Free accounts can only add the ones marked free.', onchange: (e) => changeAccess(asset, e.target.value, e.target) },
          Object.entries(ACCESS_LABEL).map(([value, label]) => h('option', { value, selected: (asset.access === 'free' ? 'free' : 'paid') === value }, label))),
        asset.type === 'prop' ? h('select', { class: 'prop-group', 'aria-label': `Prop type for ${asset.name}`, title: 'General props show in the Props tab. Hand props show in the toolbox of a selected character.', onchange: (e) => changeGroup(asset, e.target.value, e.target) },
          Object.entries(GROUP_LABEL).map(([value, label]) => h('option', { value, selected: (asset.group === 'hand' ? 'hand' : 'general') === value }, label))) : null),
      h('button', { class: 'btn sm', type: 'button', title: `Remove ${asset.name}`, onclick: () => remove(asset) }, 'Remove'));
  }

  function draw() {
    if (!only) tabs.replaceChildren(...KINDS.map(([key, label]) => h('button', { class: `admin-assets-tab ${state.kind === key ? 'active' : ''}`, role: 'tab', 'aria-selected': state.kind === key, onclick: () => { state.kind = key; state.filter = 'all'; draw(); } }, label)));
    const effect = state.kind === 'effect', list = records(), cats = categories();
    const shown = list.filter((asset) => state.filter === 'all' || (asset.category || '') === state.filter);
    content.replaceChildren(...[
      h('section', { class: 'admin-assets-intro' }, h('span', { class: 'admin-eyebrow' }, 'SHARED STUDIO LIBRARY'), h('h1', {}, effect ? 'Effects' : 'Props'),
        h('p', {}, effect ? 'Upload effects like rain, sparkle, light leak here. Creators see them in the studio\'s Effects tab and apply them to the scene. The effect animates when a sprite sheet is provided.' : 'Upload props here. Creators see them by category in the studio\'s Props tab and place them in the scene.')),
      form(),
      cats.length ? h('div', { class: 'admin-assets-tabs', style: 'padding-left:0' }, [['all', 'All'], ...cats.map((c) => [c, c])].map(([value, label]) => h('button', { class: `admin-assets-tab ${state.filter === value ? 'active' : ''}`, type: 'button', onclick: () => { state.filter = value; draw(); } }, label))) : null,
      state.loading && !list.length ? h('p', { class: 'admin-assets-empty' }, 'Loading library…')
        : shown.length ? h('div', { class: 'admin-assets-grid' }, shown.map(card))
          : h('div', { class: 'admin-assets-empty' }, h('span', {}, effect ? '💫' : '🧸'), h('b', {}, `No ${effect ? 'effect' : 'prop'} yet`), h('p', {}, 'Upload the first one above; it will show up for creators right away.')),
      only ? null : h('button', { class: 'btn', type: 'button', onclick: back }, '← Back to Admin'),
    ].filter(Boolean));
  }

  if (only) content.classList.add('admin-embedded');
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Props & Effects'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: back }, 'Back to Admin')), tabs, content);
  await refresh();
  return only ? content : root;
}
