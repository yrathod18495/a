# Autodraft data (Neha + My Baby, 5 poses each, front-side animation library) — DragonBones

**All data is DragonBones.** The original Spine exports (rigs, atlases, animation json) are kept only as *sources* in `sources/spine/` (not served by the app).
`python3 scripts/build-db-data.py` turns them into what the app loads (`scripts/spine_to_dragonbones.py` is the converter, needs Pillow):
- `public/autodraft/chars/<char>/<pose>_ske.json` + `<pose>_tex_<n>.json/.webp` – DragonBones skeleton + texture atlases (un-rotated, re-packed <= 4096 px pages),
- `public/autodraft/anims/<pose>/<id>.json`, `public/animations/<id>.json` – animations, one file each, stored by bone / slot / picture *name* (`src/db/prep.js` binds them to the armature that plays them),
- rigs with their own animations (Village Boy, SVG Multi): `anims.json` (index) + `anims/<name>.json`,
- `public/autodraft/characters.json`, `public/catalog/characters.json` – the library lists (`ske`, `tex`, `animIndex`, `animDir`).
Physics / transform constraints of the source rigs are kept as extra data (`_physics`, `_transform`) and run by our own code (`src/db/physics.js`, `src/db/motion.js`).

Notes below describe how the Spine *sources* were produced (they are not loaded by the app). `import-autodraft.py` / `convert-spine38.py` are the original source-preparation tools: their outputs belong in `sources/spine/` (the `public/` paths in their text are the old layout); then run `build-db-data.py`.

# Autodraft data (Neha + My Baby, 5 poses each, front-side animation library)

Included with the written permission of Autodraft (stated by the project owner). Everything under `public/autodraft/` is generated:

1. Download the files listed in `scripts/autodraft-links.txt` (character rigs: json / atlas / webp|png per pose) into `<dir>/files/` as
   `<char>__<pose>__json|atlas|webp|png` (char = `neha` | `mybaby`, pose = `front-side|front|back|back-2|side`), plus the character thumbnails as `<char>__thumb`.
   Preview GIFs of the front-side animations go to `<dir>/thumbs/<TRACK>__<id>.gif` (links come from the animation catalog JSON).
   Do this slowly (a few requests at a time): the CDN answers 403 to bursts.
2. `python3 scripts/import-autodraft.py <dir> <animation-catalog.json>`
   - strips the animations out of each rig (they are saved one file per animation under `public/autodraft/anims/<pose>/`),
   - writes `characters.json`, `animations.json` (tracks: Body / Hands / Legs / Face), `groups.json` (layer groups of the template),
   - shrinks previews to 96 px animated WebP.
Numbers below 2 keep 5 decimals (UVs / weights), larger ones 2 — do not round more, it tears the meshes.

Spine 3.8 files (`village_man_2`, `human_front-side_skeleton_ik.json`) are first converted to 4.2 source files (see Village Boy), then to DragonBones.


## Animations (replaced)
The original Autodraft animations and their preview GIFs were removed. The animation library of the Autodraft characters is now built by
`python3 scripts/convert-stpro-anims.py` from the bundled 3/4-front animation set (`public/animations`): rotations are copied, translations are re-sampled,
the IK legs are driven through their foot targets, hand / eyelid / mouth pictures are mapped onto the Autodraft pictures, and every animation has its own
name. `import-autodraft.py` therefore only imports the characters now (the animation part needs `--with-old-animations`).


## Village Boy (own animations, Spine 3.8 -> 4.2)
`public/autodraft/chars/villageboy/` is the Autodraft "Village_Boy2" 3/4-front rig (HAR capture: rig json + atlas + webp). It is a Spine 3.8 export, so it is
converted with `python3 scripts/convert-spine38.py rig38.json atlas38.atlas out_dir Village_Boy2.png` (bone `transform` -> `inherit`, rotate `angle` -> `value`,
bezier curves re-expressed as absolute control points, atlas to the `bounds:` format). Unlike Neha / My Baby it keeps its own 407 animations in the rig:
`catalog.js` `embeddedCategories()` lists them (Talking / Idle / Walk-run-dance / Body, plus Hand-part, Leg-part and Face layers that run on top of a body animation).
Catalog entry: `characters.json` pose with `"own": true`.


## SVG Multi (Deepak, multi-outfit, Spine 4.2)
`public/autodraft/chars/svgmulti/` = Autodraft "SVG Multi" 3/4-front rig (HAR capture): 78 bones, 6 outfits as skins (Deepak pant + t-shirt, Kurta, Kurta2, Kurta3, Kurta4, Lungi), 3 atlas pages
(`images` map in `characters.json`, `defaultSkin: "Deepak"`) and 722 animations inside the rig (listed by `embeddedCategories()`). No physics constraints in the file (Lungi / Kurta chains exist as bones only).
