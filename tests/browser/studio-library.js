// A stand-in for the admin's character library, so the studio tests can add a real character the way a creator does (Add character -> pick it -> pick a pose).
// The server side (database + R2) is the same fake used by admin-add-animations.spec.js (the real server logic is tested in tests/characters-api.test.js); the character is the Dayan
// ZIP made smaller (one 3/4 view, a few dozen animations) and stored with the app's own `storeCharacter`, under the name the old tests knew ("Neha").
import { existsSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
export const ZIP = process.env.CHARACTER_ZIP || '/home/user/a/deliver/dayan-plus.zip';
export const haveZip = () => existsSync(ZIP);
export function fakeServer(page) {
  const s = { db: new Map(), r2: new Map(), characters: new Map(), categories: new Map(), assets: [] };
  page.route('**/api/studio-assets', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'list') return route.fulfill({ json: { assets: s.assets } });
    if (body.action === 'get') { const a = s.assets.find((x) => x.id === body.id); return a ? route.fulfill({ json: { url: `https://r2.fake/get/${a.key.slice(7)}` } }) : route.fulfill({ status: 404, json: { error: 'missing' } }); }
    if (!String(body.action).startsWith('character:')) return route.fulfill({ json: { assets: [] } });
    const b = { ...body, action: body.action.slice(10) };
    if (b.action === 'list') return route.fulfill({ json: { characters: [...s.characters.values()].map((c) => ({ ...c, categoryName: s.categories.get(c.category)?.name, animations: s.categories.get(c.category)?.views || {} })), serverNow: Date.now() } });
    if (b.action === 'putFile') { s.db.set(b.sha, b.gz); return route.fulfill({ json: { ok: true } }); }
    if (b.action === 'haveFiles') return route.fulfill({ json: { have: [] } });
    if (b.action === 'files') return route.fulfill({ json: { db: Object.fromEntries(b.refs.filter((r) => r.db).map((r) => [r.db, s.db.get(r.db)])), r2: Object.fromEntries(b.refs.filter((r) => r.r2).map((r) => [r.r2, `https://r2.fake/get/${r.r2}`])) } });
    if (b.action === 'commit') { if (b.category.views) s.categories.set(b.category.id, b.category); s.characters.set(b.character.id, { ...b.character, category: b.category.id }); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ status: 400, json: { error: 'unknown' } });
  });
  page.route('**/api/r2', async (route) => {
    const b = route.request().postDataJSON();
    return route.fulfill({ json: { upload: Object.fromEntries((b.items || []).filter((i) => !s.r2.has(i.hash)).map((i) => [i.hash, { url: `https://r2.fake/put/${i.hash}` }])), have: (b.items || []).filter((i) => s.r2.has(i.hash)).map((i) => i.hash) } });
  });
  page.context().route('https://r2.fake/**', async (route) => {
    const url = new URL(route.request().url()), [, kind, hash] = url.pathname.split('/');
    if (kind === 'put') { s.r2.set(hash, route.request().postDataBuffer()); return route.fulfill({ status: 200, body: '' }); }
    return route.fulfill({ status: 200, body: s.r2.get(hash) || Buffer.alloc(0), headers: { 'access-control-allow-origin': '*' } });
  });
  return s;
}
/** a small ZIP: one 3/4 view, the first `count` body animations + the hand / face ones needed to try layers */
async function smallZip(count) {
  const src = await JSZip.loadAsync(readFileSync(ZIP)), manifest = JSON.parse(await src.file('manifest.json').async('string')), view = manifest.views.find((v) => v.id === 'f34') || manifest.views[0];
  const want = (n) => /^(Idle|stand|walk|Talk|Pointing|Happy_Face|Sad_Face)/i.test(n);
  const body = view.animations.filter((a) => a.layer === 'body'), pick = [...body.filter((a) => want(a.name)), ...body.filter((a) => !want(a.name))].slice(0, count);
  const hands = view.animations.filter((a) => a.layer === 'hand').slice(0, 3), faces = view.animations.filter((a) => a.layer === 'face').slice(0, 3);
  const animations = [...pick, ...hands, ...faces], m = { ...manifest, views: [{ ...view, animations }] };
  const z = new JSZip(); z.file('manifest.json', JSON.stringify(m));
  for (const [path, f] of Object.entries(src.files)) if (!f.dir && path.startsWith(`views/${view.id}/`) && !path.includes('/animations/')) z.file(path, await f.async('nodebuffer'));
  for (const a of animations) z.file(a.file, await src.file(a.file).async('nodebuffer'));
  return z.generateAsync({ type: 'nodebuffer' });
}
/** call before the test opens the studio: the library then holds one character (default name "Neha") */
export async function installLibrary(page, { name = 'Neha', count = 24 } = {}) {
  const server = fakeServer(page), bytes = await smallZip(count);
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/hub');
  await page.evaluate(async ([arr, nm]) => {
    const m = await import('/src/admin-characters.js'), c = await import('/src/cloud-characters.js');
    const pkg = await m.readCharacterZip(new File([new Uint8Array(arr)], 'c.zip'));
    await c.storeCharacter({ manifest: pkg.manifest, files: pkg.files, name: nm });
  }, [Array.from(bytes), name]);
  return server;
}

/** a new project open in the studio (library installed first when asked); `chr` adds the character the way a creator does */
export async function openStudio(page, { viewport = { width: 1366, height: 768 }, library = true, chr = false, workers = 0, name = 'Audit' } = {}) {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(viewport);
  if (library) await installLibrary(page); else await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => (library ? r.fallback() : r.fulfill({ json: { configured: false } })));
  await page.goto(`/?debug&workers=${workers}#/toons`);
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill(name); await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready); await page.waitForTimeout(800);
  if (chr) await addCharacter(page);
  return errors;
}
export async function addCharacter(page) {
  const wide = (page.viewportSize()?.width || 1366) > 860;
  if (wide) await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click();
  else { await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).click(); await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click(); }          // phone: the timeline row picks the bottom bar, its first button opens the panel
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).first().click(); await page.locator('.cp-poses .pose').first().click();
  await page.waitForFunction(() => window.__toon.stage.layers.length >= 1, null, { timeout: 30000 }); await page.waitForTimeout(600);
}

/** a prop (default) or an effect picture in the shared library: a red 48 x 48 square */
export async function addLibraryProp(server, { name = 'Red box', type = 'prop', access = 'free', group = 'general' } = {}) {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAZElEQVR4nO3PMQ0AIBDAQOS8fz14AREMF5IO3a9rz5yfWxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWjAaxdEY4QeHlpSAAAAAABJRU5ErkJggg==', 'base64');
  const { createHash } = await import('node:crypto'), hash = createHash('sha256').update(bytes).digest('hex');
  server.r2.set(hash, bytes);
  const asset = { id: `asset_${type}_${server.assets.length + 1}_abcdef`, type, name, key: `assets/${hash}`, size: bytes.length, mime: 'image/png', enabled: true, access, ...(type === 'prop' ? { group } : { blend: 'normal', opacity: 1, placement: 'sticker' }), category: 'Test', thumb: 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==' };
  server.assets.push(asset); return asset;
}

/** open a studio tool from the desktop rail (the "More tools" list is opened first, so Move / Camera / Mask / Colour ... are reachable); a tool that is already open stays open */
export async function tool(page, name) {
  await page.evaluate(() => document.querySelectorAll('.advanced-tools,.rail-more').forEach((e) => { e.open = true; }));
  const btn = page.locator('#app .tabs.big').getByRole('button', { name, exact: true });
  if (await btn.getAttribute('aria-pressed') !== 'true') await btn.click();
}
