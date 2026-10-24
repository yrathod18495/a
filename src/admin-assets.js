import { h, logo } from './dom.js';
import { loadCatalog, libraryCharacters, cdn } from './catalog.js';
import { deleteStudioAsset, listStudioAssets, saveStudioAsset } from './studio-assets.js';

export async function assetsView({ user, home, back, toast }) {
  const root = h('div', { class: 'sh admin-assets' });
  const tabs = h('div', { class: 'admin-assets-tabs', role: 'tablist', 'aria-label': 'Studio asset types' });
  const content = h('main', { class: 'admin-assets-content' });
  const state = { type: 'character', assets: [], chars: [], previews: new Map(), loading: false };
  let fileInput;
  const assetType = () => state.type === 'background' ? 'background' : 'prop';
  const refresh = async () => {
    state.loading = true; draw();
    try { state.assets = await listStudioAssets(); }
    catch (e) { toast(`Could not load the studio library: ${e.message}`); }
    state.loading = false; draw();
  };
  const openUpload = () => fileInput.click();

  function drawTabs() {
    tabs.replaceChildren(...[
      ['character', '🎭 Add Character'], ['background', '🖼 Add Background'], ['prop', '🧸 Add Props'],
    ].map(([key, label]) => h('button', { class: `admin-assets-tab ${state.type === key ? 'active' : ''}`, role: 'tab', 'aria-selected': state.type === key, onclick: () => { state.type = key; draw(); } }, label)));
  }
  function draw() {
    drawTabs();
    if (state.type === 'character') {
      content.replaceChildren(
        h('section', { class: 'admin-assets-intro' }, h('span', { class: 'admin-eyebrow' }, 'CHARACTER LIBRARY'), h('h1', {}, 'Add Character'), h('p', {}, 'These are the characters available to Animation Studio and Character Studio. Use Studio Controls to adjust their animations and layers.')),
        state.chars.length ? h('div', { class: 'admin-assets-grid' }, state.chars.map((c) => h('article', { class: 'admin-asset-card' }, c.thumb ? h('img', { src: cdn(c.thumb), alt: c.name, loading: 'lazy' }) : h('div', { class: 'admin-asset-placeholder' }, '🎭'), h('div', { class: 'admin-asset-copy' }, h('b', {}, c.name), h('small', {}, `${c.poses.length} poses · available in both studios`))))) : h('p', { class: 'admin-assets-empty' }, 'Loading the character catalog…'),
        h('button', { class: 'btn', type: 'button', onclick: back }, '← Back to Admin'));
      return;
    }
    const kind = assetType(), label = kind === 'background' ? 'Backgrounds' : 'Props';
    const records = state.assets.filter((a) => a.type === kind);
    content.replaceChildren(
      h('section', { class: 'admin-assets-intro' }, h('span', { class: 'admin-eyebrow' }, 'SHARED STUDIO LIBRARY'), h('h1', {}, `Add ${label}`), h('p', {}, kind === 'background' ? 'Upload scene images once. Creators can preview and apply them from Animation Studio → Background.' : 'Upload transparent PNG or WebP objects. Creators can add them to the stage, drag them into place, resize and rotate them.')),
      h('section', { class: 'admin-assets-upload' }, h('div', {}, h('b', {}, `Upload a ${kind}`), h('small', {}, 'Image files · up to 40 MB · available to signed-in creators')), h('button', { class: 'btn pri', type: 'button', disabled: state.loading, onclick: openUpload }, '＋ Choose image'), fileInput),
      state.loading && !records.length ? h('p', { class: 'admin-assets-empty' }, 'Loading assets…') : records.length ? h('div', { class: 'admin-assets-grid' }, records.map((asset) => {
        const preview = state.previews.get(asset.id);
        if (!preview) previewAsset(asset).catch((e) => console.warn('Asset preview failed:', e.message));
        return h('article', { class: 'admin-asset-card' }, preview ? h('img', { src: preview, alt: asset.name, loading: 'lazy' }) : h('div', { class: 'admin-asset-placeholder' }, '◌'), h('div', { class: 'admin-asset-copy' }, h('b', {}, asset.name), h('small', {}, `${(asset.size / 1024 / 1024).toFixed(1)} MB · ${new Date(asset.updatedAt).toLocaleDateString()}`)), h('button', { class: 'btn sm', type: 'button', title: `Remove ${asset.name}`, onclick: () => remove(asset) }, 'Remove'));
      })) : h('div', { class: 'admin-assets-empty' }, h('span', {}, kind === 'background' ? '🖼' : '🧸'), h('b', {}, `No ${label.toLowerCase()} yet`), h('p', {}, 'Upload the first image and it will appear in the Animation Studio library.')),
      h('button', { class: 'btn', type: 'button', onclick: back }, '← Back to Admin'));
  }
  async function previewAsset(asset) {
    const { downloadStudioAsset } = await import('./studio-assets.js');
    const blob = await downloadStudioAsset(asset), url = URL.createObjectURL(blob);
    state.previews.set(asset.id, url);
    if (root.isConnected && state.type === assetType()) draw();
  }
  async function remove(asset) {
    if (!confirm(`Remove “${asset.name}” from the studio library? Existing project copies stay saved.`)) return;
    try { await deleteStudioAsset(asset.id); const preview = state.previews.get(asset.id); if (preview) URL.revokeObjectURL(preview); state.previews.delete(asset.id); state.assets = state.assets.filter((a) => a.id !== asset.id); draw(); toast('Asset removed from the library.'); }
    catch (e) { toast(`Could not remove asset: ${e.message}`); }
  }
  fileInput = h('input', { class: 'admin-assets-file', type: 'file', accept: 'image/*', onchange: async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
    try {
      state.loading = true; draw();
      await saveStudioAsset(assetType(), name, file);
      state.assets = await listStudioAssets();
      toast(`${name} added to the Animation Studio library.`);
    } catch (error) { toast(`Could not add image: ${error.message}`); }
    finally { state.loading = false; draw(); }
  } });
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Studio Assets'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: back }, 'Back to Admin')), tabs, content);
  try {
    await loadCatalog();
    const entries = libraryCharacters().filter((e) => e.template);
    state.chars = [...new Map(entries.map((e) => [e.charBase, { name: e.name, thumb: e.thumbnail, poses: entries.filter((x) => x.charBase === e.charBase) }])).values()];
    state.assets = await listStudioAssets();
  } catch (error) { toast(`Could not load the studio library: ${error.message}`); }
  state.loading = false; draw();
  root.dispose = () => state.previews.forEach((url) => URL.revokeObjectURL(url));
  return root;
}
