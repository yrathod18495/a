# Character ZIP guide: how a character must be built, and what is checked before it goes live

Read this before making or changing a character. It is written from the code (`shared/character-package.js`, `src/admin-characters.js`, `src/cloud-characters.js`, `server/characters-api.js`, `src/db/stage.js`, `src/db/tears.js`, `src/db/physics.js`, `scripts/character-zip.mjs`). Everything is **DragonBones only** (see `CLAUDE.md`): never a Spine runtime, never Spine files inside the ZIP.

Quick path: build the ZIP → `node scripts/check-character-zip.mjs my.zip` (must say `OK`) → Admin panel → Characters → choose the ZIP → look at every animation → **Done — upload**.

## 1. What a character is

- A **character** has 1 to 8 **views** (`f34` 3/4 Front, `fr` Front, `sd` Side, `bk` Back). Each view is its own DragonBones rig with its own pictures.
- A character belongs to a **category** (the "rig family", e.g. `female`, `boy`). The category owns the **animations**. Two characters with the **same category id and the same bone names** (new face or clothes, same skeleton) share the category's animations: the second ZIP can leave the animations out and use "Use the saved … animations" in the admin screen.
- The picker group (Male / Female / Boy / Girl) is chosen in the admin screen, not in the ZIP.
- Thumbnails and the small preview of each animation (GIF or MP4) are made by the admin screen when you press Done. Do not put them in the ZIP.

## 2. ZIP layout

```
manifest.json
views/<view>/skeleton.json                 DragonBones skeleton (rig)
views/<view>/texture_0.json                DragonBones atlas for page 0   (texture_1.json … up to 8 pages)
views/<view>/texture_0.webp                the picture of page 0 (the atlas' imagePath must name this file)
views/<view>/animations/<name>.json        one file per animation
```

### manifest.json

```json
{
  "format": "12toons-character", "version": 1,
  "character": { "id": "maya", "name": "Maya" },
  "category": { "id": "female", "name": "Female" },
  "frameRate": 24,
  "views": [{
    "id": "f34", "label": "3/4 Front",
    "skeleton": "views/f34/skeleton.json",
    "textures": ["views/f34/texture_0.json"],
    "animations": [
      { "name": "walk", "label": "Walk", "group": "Body", "layer": "body", "length": 1.2, "file": "views/f34/animations/walk.json" }
    ]
  }]
}
```

- `character.id`, `category.id`, view `id`: 2–60 characters, **small letters, numbers and `_` only**, starting with a letter or number.
- `character.name`, `category.name`: 1–60 characters.
- `animations[].name`: unique inside the view, at most 80 characters. `length` is in **seconds**, more than 0 and under 600. `layer` is `body` (whole body) or `hand` (arms only; it plays on top of a body animation; use group `Left`, `Right` or `Both`). `group` is just a label for the animation list (default `Body`).

### The DragonBones files

- **skeleton.json**: `armature[0]` with `bone[]`, `slot[]` and `skin[]` (the slots' `display` lists name the atlas pictures). Our converter also writes `_tex` (the atlas file names in order), `name` (`<category>_<view>`), and may keep `_physics` and `ik`.
- **texture_N.json**: `SubTexture[]` (the cut-out pictures) and `imagePath` = the name of the picture in the **same folder** (`texture_N.webp`). Keep each page at most 4096 × 4096 px (phones fail on bigger pages); WebP keeps it small.
- **animations/<name>.json**: `{ "<name>": { "duration": <frames>, "bone": [...], "slot": [...], … } }` (the bare animation object also loads). The converter adds `_sourceFrameRate`.
- Every pose in the animation may only use bones and slots that exist in that view's skeleton. A category's animations are shared, so **keep bone names identical** between characters of the same category.

## 3. What the rig should contain so 12toons features work

These are not upload errors, but a feature is missing without them (`check-character-zip.mjs` prints a WARN):

| Feature | What the rig needs |
|---|---|
| **Lip-sync** | A slot named `lips` whose pictures are `lip_idle`, `lip_a_e_i`, `lip_ee`, `lip_o`, `lip_u`, `lip_b_m_p`, `lip_c_d_g_k_n_s_t_x_y_z`, `lip_ch_sh_j`, `lip_f_v`, `lip_l`, `lip_r`, `lip_th`, `lip_qw`. **Or** a slot with pictures `Mouth/A` … `Mouth/X` (the other 12toons style). |
| **Tears** | Eye slots named like `eye …` or `iris …` with a left and a right part. Eyebrows, lashes and accessories (`acc…`) are not eyes. |
| **Hair / cloth physics** | Hanging chains of bones. Bones starting with `Hair` or `Earring` swing softly; bones starting with `Eye`, `Brow`, `Mouth`, `Lip`, `Jaw`, `Nose`, `Tongue` are the face and stay out of the automatic physics. A `_physics` list in the skeleton is used first. |
| **Arm actions** | Animations marked `layer: "hand"` (group Left / Right / Both) are played over a body animation. |
| **Picker preview** | The `f34` view is used for the card picture if it exists. |

## 4. Every check, in the order it happens

**A. In the browser, when the ZIP is chosen** (`checkManifest`, `readCharacterZip`): `manifest.json` exists and is JSON · `format` is `12toons-character` and `version` is 1 · ids and names as above · 1–8 views, each with a unique id · each view has a skeleton, 1–8 textures, at most 200 animations · every file named in the manifest exists in the ZIP · every animation has a unique name, a file and a length in seconds. Any problem is listed in plain English and the **Done** button stays off.

**B. Preview, before Done:** the rig and the pictures must load in the stage and every animation is played with Prev / Next. A broken rig, a missing picture or a bad animation shows up here. Look at every animation and every view.

**C. When you press Done (browser):** a thumbnail is drawn for every view and a small preview (GIF/MP4) for every animation · every file is hashed (SHA-256) · pictures and any JSON over 16 KB go to R2, JSON up to 16 KB go to the database (gzip) · if a character with the same id exists you are asked to confirm the replace.

**D. On the server** (`server/characters-api.js`): only admins can store · a database file must be valid JSON, at most 16 KB, and its content must match its hash · every R2 file must really be in R2 (checked and counted in the admin's storage; one file is at most 40 MB) · R2 must be set up (`storage_unavailable` otherwise) · the **category must exist** or arrive with its animations (`category_missing`) · **every view of the character needs animations in the category** (`view_mismatch`) · ids are valid. If anything fails nothing is published; press Done again.

**E. Afterwards:** the character appears in the studio picker for signed-in creators; files are downloaded only when used and cached by hash in the browser.

## 5. Offline check (use it every time)

```bash
node scripts/check-character-zip.mjs my-character.zip
```

It runs the same manifest check as the admin screen, then opens every file: skeleton is DragonBones (not Spine), has slots and a skin, bone names are unique · atlas has `SubTexture` and its picture is in the ZIP · every animation file has animation data · file sizes · and it reports lip-sync, eyes for tears, hand animations per view. Exit code 0 = accepted, 1 = fix first. Warnings are advice.

## 6. Making the ZIP

- From an old HTML character page: `node scripts/character-zip.mjs maya_1.html maya.zip --character maya --name Maya --category female --category-name Female` (see `docs/CHARACTERS.md`).
- From Spine files: convert **offline** with `scripts/spine_to_dragonbones.py` (read its header for usage), then arrange the output as in section 2 and write the manifest. Spine never goes into the app or the ZIP.
- Keep bone names, slot names and picture names exactly the same across characters of one category.

## 7. Prompt for a local Claude Code session

Paste this into a local session started in this repo:

```
We work in the 12toons repo. Read CLAUDE.md and docs/CHARACTER-ZIP-GUIDE.md first. Everything is DragonBones only (never Spine in the app or in the ZIP).
Goal: build a character ZIP that the admin upload accepts and that has all 12toons features.
My source files are: <describe: HTML page / Spine files / DragonBones files / PSD, and where they are>.
Character id: <small_letters_1>, name: <Name>, category id: <family>, category name: <Family>, views: <f34 / fr / sd / bk>.
Steps: 1) look at my source files and tell me what is missing for the layout and the features in the guide (lip-sync slots, eye slots, hand animations, bone names); 2) convert / arrange the files into the ZIP layout and write manifest.json (offline scripts only: scripts/character-zip.mjs, scripts/spine_to_dragonbones.py); 3) run `node scripts/check-character-zip.mjs <zip>` and fix every FAIL until it prints OK, and tell me each WARN in plain words; 4) do not change app code unless a check is wrong; if a check is wrong, say why before changing it; 5) at the end give me the ZIP path and the admin steps (Characters → choose ZIP → look at every animation → Done).
Keep answers short and in plain English.
```
