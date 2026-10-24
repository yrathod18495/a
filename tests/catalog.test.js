import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { AssetCache } from '../src/asset-cache.js';
import { testerAnimationAllowed } from '../src/tester-animation-policy.js';

async function catalog() {
  let source = await readFile(new URL('../src/catalog.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\r?$/gm, '')
    .replace('import.meta.env.BASE_URL', "'/'")
    .replace(/export (const|async function|function)/g, '$1');
  source += '\nglobalThis.api = { loadCatalog, libraryCharacters, fetchLibraryCharacter, categoriesFor };';
  const requests = [];
  const sandbox = {
    testerAnimationAllowed, AssetCache,
    listStudioAssets: async () => [],
    cachedRules: () => null,
    loadAnimRules: async () => null,
    setTimeout: () => 0,
    console: { warn() {} },
    dirOf: path => path.slice(0, path.lastIndexOf('/') + 1),
    rigInfo: (ske, extra) => ({ bones: ske.armature[0].bone, ...extra }),
    fetch: async path => {
      requests.push(path);
      assert.ok(path.startsWith('/12toons/'), 'Only retained local catalog assets should be fetched');
      const data = await readFile(new URL('../public' + path, import.meta.url));
      return { ok: true, json: async () => JSON.parse(data), blob: async () => new Blob([data]) };
    },
  };
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.api, sandbox, requests };
}

test('retained character catalog loads every character and its front-side rig locally', async () => {
  const { api, requests } = await catalog();
  await api.loadCatalog();
  const entries = api.libraryCharacters();
  assert.deepEqual([...new Set(entries.map(e => e.charBase))].sort(),
    ['chudel', 'mybaby', 'neha', 'sadhubaba', 'svgmulti', 'villageboy']);
  for (const entry of entries.filter(e => e.template.pose === 'front-side')) {
    const character = await api.fetchLibraryCharacter(entry);
    assert.ok(character.ske.armature[0].bone.length > 0, entry.name);
    assert.ok(character.tex.every(t => t.json.SubTexture.length && t.image.size), entry.name);
    assert.ok(api.categoriesFor(character.rig).some(c => c.animations.length), entry.name);
  }
  assert.ok(requests.length > entries.length);
});

test('catalog reload failure clears previously loaded character templates', async () => {
  const { api, sandbox } = await catalog();
  await api.loadCatalog();
  assert.ok(api.libraryCharacters().length);
  sandbox.fetch = async () => { throw new Error('offline'); };
  await api.loadCatalog();
  assert.equal(api.libraryCharacters().length, 0);
});

test('uploaded rigs keep their own animations without a bundled pattern fallback', async () => {
  const { api } = await catalog();
  const cats = api.categoriesFor({ animList: [{ name: 'walk', file: 'walk', length: 2 }], animDir: 'custom/' });
  assert.equal(cats.flatMap(c => c.animations).length, 1);
  assert.equal(cats[0].animations[0].ref.file, 'custom/walk.json');
  assert.equal(api.categoriesFor({ bones: [{ name: 'root' }] }).length, 0);
  await assert.rejects(api.fetchLibraryCharacter({ id: 122 }), /ab available nahi hai/);
});
