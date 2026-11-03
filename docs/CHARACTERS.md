# Characters uploaded by the admin

Admin panel → **Characters**. A character arrives as one ZIP; the admin plays every animation, presses **Done**, and creators can use the character in the Animator Studio right away. Everything is DragonBones (see `CLAUDE.md`).

## 1. Make the ZIP (on your computer)

From a character page made by our older HTML tool (the rig, pictures and animations are inside the HTML):

```bash
node scripts/character-zip.mjs maya_1.html maya.zip --character maya --name Maya --category female --category-name Female
```

- Needs Node and Python 3 with Pillow (`pip install pillow`).
- What it does: reads the page's data (no page code runs except its two animation-finishing functions, in a sandbox), writes a temporary Spine skeleton + atlas per view, converts them with `scripts/spine_to_dragonbones.py`, and packs only DragonBones files into the ZIP. The Spine files are deleted afterwards.
- `--category` is the rig family. A second character with the **same category id and the same bone names** (new face / outfit, same skeleton) uses the category's animations and GIF previews: in the admin screen choose "Use the saved … animations".

ZIP layout (`manifest.json` says what is inside; checked by `shared/character-package.js`):

```
manifest.json
views/<view>/skeleton.json
views/<view>/texture_0.json + texture_0.webp
views/<view>/animations/<name>.json
```

## 2. Upload (admin panel → Characters)

1. **Choose character ZIP** — the ZIP is checked; problems are listed in plain English.
2. Look at it: view buttons (3/4 Front, Front, Side, Back), **Prev / Next** through every animation, Play / Pause.
3. **Done — upload**: a small looping GIF of each animation is made in the browser (128 px, 8 fps, up to 4 s, named like `walk_female.gif`), then the files are stored.

## 3. Where the files go

| What | Where | Why |
|---|---|---|
| rig (`skeleton.json`), atlas `.json`, every animation | Realtime Database, gzip-compressed (`characterFiles/<sha256>`) | small; one read each |
| texture pictures, GIF previews, thumbnail | R2 (`assets/<sha256>`, counted in the admin's storage) | no download fee; cached by the browser |
| any JSON bigger than 192 KB | R2 | database stays small |
| the character record / the category record | Realtime Database (`characters/<id>`, `characterCategories/<id>`) | the list the studio reads |

Every file is named by the SHA-256 of its content: the same file is stored once, the server checks the content against the name, and a browser downloads a file only once (Cache API). Animations are downloaded only when a creator uses or previews them; GIFs only when the list is shown.

The API lives in `server/characters-api.js` and is served by `api/studio-assets.js` (actions `character:list|files|putFile|commit|delete`) so the site stays within the 12 serverless functions of a Vercel Hobby plan.

## 4. Delete

**Delete** on a character removes its record and every file nobody else uses — from the database and from R2 (and from the storage count). The last character of a category takes the category's animations and GIFs with it. Database files of uploads that never finished are removed once they are more than 6 hours old.

## 5. How safe are the files?

- Only signed-in accounts can list characters or read their files; R2 files are given as links that expire after 15 minutes; files have no meaningful names and cannot be listed.
- What a browser shows, it has downloaded. A determined person with the browser's developer tools can still save the rig and pictures; no website can fully prevent that. What protects the work in the end is the account system (only signed-in users, the tamper alerts in `src/shield.js`) and the terms of use.

## 6. What the conversion does not carry over (Maya page)

The page also had its own runtime tricks that are not part of the rig data: the lip-sync and eyebrow kits, the expression mixer, the hand-contact solver, the elbow patch, the recolouring and the hem clipping. The ZIP has the skeleton, the pictures and the animations (with the page's "new style" and the limp walk). The `char1` and `william` rigs in the page have no pictures inside it, so they are not converted.
