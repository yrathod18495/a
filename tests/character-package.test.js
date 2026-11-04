import test from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest, storageOf, gifName, slug, cleanRecord, refsOf, DB_MAX_BYTES, CHARACTER_GROUPS, groupOf, isGroup } from '../shared/character-package.js';

const sha = (c) => c.repeat(64);
const manifest = () => ({ format: '12toons-character', version: 1, character: { id: 'maya', name: 'Maya' }, category: { id: 'female', name: 'Female' },
  views: [{ id: 'f34', label: '3/4 Front', skeleton: 'views/f34/skeleton.json', textures: ['views/f34/texture_0.json'], animations: [{ name: 'walk', file: 'views/f34/animations/walk.json', length: 4.36, group: 'Body', layer: 'body' }] }] });
const files = ['manifest.json', 'views/f34/skeleton.json', 'views/f34/texture_0.json', 'views/f34/texture_0.webp', 'views/f34/animations/walk.json'];

test('a good manifest passes; every missing or wrong part is named in plain English', () => {
  assert.deepEqual(checkManifest(manifest(), files), []);
  assert.match(checkManifest(null)[0], /no manifest\.json/);
  const m = manifest(); m.format = 'spine'; assert.match(checkManifest(m, files)[0], /not a 12toons character package/);
  const m2 = manifest(); m2.character.id = 'Maya Rani!'; assert.match(checkManifest(m2, files).join(' '), /character id/);
  const m3 = manifest(); assert.match(checkManifest(m3, files.filter((f) => !f.endsWith('walk.json'))).join(' '), /animation "walk" is missing from the ZIP/);
  const m4 = manifest(); m4.views[0].animations.push({ ...m4.views[0].animations[0] }); assert.match(checkManifest(m4, files).join(' '), /repeated/);
  const m5 = manifest(); m5.views[0].animations[0].length = 0; assert.match(checkManifest(m5, files).join(' '), /length in seconds/);
  const m6 = manifest(); m6.views = []; assert.match(checkManifest(m6, files).join(' '), /1 to 8 views/);
});
test('where a file is stored: pictures always in R2, small JSON in the database, big JSON in R2', () => {
  assert.equal(storageOf('views/f34/texture_0.webp', 10), 'r2');
  assert.equal(storageOf('walk_female.gif', 10), 'r2');
  assert.equal(storageOf('views/f34/skeleton.json', 99_000), 'db');
  assert.equal(storageOf('views/f34/skeleton.json', DB_MAX_BYTES + 1), 'r2');
});
test('names: ids are small letters and _, GIF previews are named after the animation and the category', () => {
  assert.equal(slug('Both Namaste!'), 'both_namaste'); assert.equal(slug('  Mäya  '), 'maya');
  assert.equal(gifName('walk', 'female'), 'walk_female.gif'); assert.equal(gifName('both namaste', 'Female Adult'), 'both_namaste_female_adult.gif');
});
test('a record is cleaned: only known fields, valid file references, and every file it uses is listed', () => {
  const rec = { character: { id: 'maya', name: 'Maya', views: { f34: { label: '3/4 Front', skeleton: { db: sha('a') }, textures: [{ json: { db: sha('b') }, page: { r2: sha('c'), size: 10 } }] } }, thumb: { r2: sha('d'), size: 5 }, extra: 'dropped' },
    category: { id: 'female', name: 'Female', views: { f34: { animations: [{ name: 'walk', length: 4, file: { db: sha('e') }, gif: { r2: sha('f'), size: 3 }, layer: 'weird' }] } } } };
  const { character, category } = cleanRecord(rec);
  assert.equal(character.extra, undefined); assert.equal(category.views.f34.animations[0].layer, 'body'); assert.equal(category.views.f34.animations[0].gifName, 'walk_female.gif');
  assert.deepEqual(refsOf(character).map((r) => r.where), ['db', 'db', 'r2', 'r2']);
  // a picture for each view is kept and counted as a file of the character (so Delete removes it too)
  const withViewThumb = cleanRecord({ ...rec, character: { ...rec.character, views: { f34: { ...rec.character.views.f34, thumb: { r2: sha('9'), size: 7 } } } } });
  assert.deepEqual(withViewThumb.character.views.f34.thumb, { r2: sha('9'), size: 7 });
  assert.deepEqual(refsOf(withViewThumb.character).filter((r) => r.sha === sha('9')).map((r) => [r.where, r.size]), [['r2', 7]]);
  assert.throws(() => cleanRecord({ ...rec, character: { ...rec.character, views: { f34: { ...rec.character.views.f34, thumb: { r2: 'x' } } } } }), /thumbnail is not a valid file/);
  assert.deepEqual(refsOf(category).map((r) => [r.where, r.size]), [['db', 0], ['r2', 3]]);
  assert.throws(() => cleanRecord({ ...rec, character: { ...rec.character, views: { f34: { ...rec.character.views.f34, skeleton: { db: 'x' } } } } }), /skeleton is not a valid file/);
  assert.throws(() => cleanRecord({ ...rec, character: { ...rec.character, views: { f34: { ...rec.character.views.f34, skeleton: { db: sha('a'), r2: sha('a') } } } } }), /not a valid file/);
  assert.throws(() => cleanRecord({ ...rec, category: { id: 'Bad Id', name: 'x' } }), /category id/);
});
test('the Maya package made by scripts/character-zip.mjs passes the check', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  if (!existsSync('/tmp/maya-manifest.json')) return;                               // made by the converter run, not part of the repository
  const m = JSON.parse(readFileSync('/tmp/maya-manifest.json', 'utf8')), list = readFileSync('/tmp/maya-files.txt', 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(checkManifest(m, list), []);
  assert.deepEqual(m.views.map((v) => v.id), ['f34', 'fr', 'sd', 'bk']);
  assert.equal(m.views.reduce((n, v) => n + v.animations.length, 0), 88);
});

test('preview GIFs belong to each character view (not shared through the category), and are removed with the character', () => {
  const sha = (c) => c.repeat(64), ref = (c) => ({ r2: sha(c), size: 5000 });
  const base = (gifs) => ({ character: { id: 'maya', name: 'Maya', views: { f34: { label: '3/4 Front', skeleton: { db: sha('a') }, textures: [{ json: { db: sha('b') }, page: ref('c') }], ...(gifs ? { gifs } : {}) } } }, category: { id: 'female', name: 'Female' } });
  const { character } = cleanRecord(base({ walk: ref('d'), talk: ref('e') }));
  assert.deepEqual(Object.keys(character.views.f34.gifs), ['walk', 'talk']); assert.equal(character.views.f34.gifs.walk.r2, sha('d'));
  assert.ok(refsOf(character).some((f) => f.sha === sha('d') && f.where === 'r2') && refsOf(character).some((f) => f.sha === sha('e')));       // listed, so deleting the character removes them
  assert.equal(cleanRecord(base(null)).character.views.f34.gifs, undefined);                                                            // older uploads have none here
  assert.throws(() => cleanRecord(base({ walk: { r2: 'nothex', size: 1 } })), /preview of walk is not a valid file/);
  assert.throws(() => cleanRecord(base({ '': ref('d') })), /preview name is not valid/);
});

test('character groups: Male / Female / Boy / Girl, chosen by the admin, guessed for older uploads, kept by the record', () => {
  assert.deepEqual(CHARACTER_GROUPS.map(([id]) => id), ['male', 'female', 'boy', 'girl']);
  assert.equal(isGroup('boy'), true); assert.equal(isGroup('man'), false);
  assert.equal(groupOf({ group: 'girl', category: 'male' }), 'girl');                      // what the admin chose wins
  assert.equal(groupOf({ category: 'female', name: 'Maya' }), 'female');                   // a guess from the category (female contains "male": checked first)
  assert.equal(groupOf({ category: 'male', name: 'Roshan' }), 'male');
  assert.equal(groupOf({ category: 'kid_boy', name: 'Chotu' }), 'boy');
  assert.equal(groupOf({ category: 'girl', name: 'Gudiya' }), 'girl');
  assert.equal(groupOf({ category: 'x', name: 'Y' }), 'male');                             // unknown: Male
  const sha = (c) => c.repeat(64), view = { label: 'Front', skeleton: { db: sha('a') }, textures: [{ json: { db: sha('b') }, page: { r2: sha('c'), size: 9 } }] };
  const base = (group) => ({ character: { id: 'roshan', name: 'Roshan', ...(group ? { group } : {}), views: { fr: view } }, category: { id: 'male', name: 'Male' } });
  assert.equal(cleanRecord(base('boy')).character.group, 'boy');
  assert.equal(cleanRecord(base('robot')).character.group, undefined);                     // not one of the four: dropped
  assert.equal(cleanRecord(base(null)).character.group, undefined);
});
