# 12toons (formerly Toon Studio) — handoff notes (for a fresh session)

> **Rule: DragonBones only.** The Spine library is not used. All rigs and animation data are DragonBones, and all code uses only the DragonBones runtime. See `CLAUDE.md`.

Client-side only (Vite + vanilla JS + DragonBones runtime, our own WebGL renderer). Deployed from `main` on Vercel. Everything saves to IndexedDB.

## Flow
1. **Upload ZIP** – audio lines `001-Name.wav` (speaker = text after the number). Several zips allowed.
3. **Studio** – audio lines are the main timeline; tap a line → its characters appear below:
   speaker = *Speaker mode* (mix of Talk anims), others = *Listener mode* (hands-held poses), both layered over Idle so head/chest move.
   Per line: in-frame switch, animation override (Animations tab), 🎥 shot (Wide / Medium / Close-up + focus), swap image 🖼.

## Code map (src/)
- `main.js` – UI, state `S`, autosave/undo/redo (`docOf`, `tick`, `stepHistory`), line logic (`resolveLine`, `layerPlan`, `expandBody`).
- `db/stage.js` – the stage on DragonBones (GL only, also runs in a Worker): layered clips as DragonBones animation states + cross-fade, life motion, camera shots, textures (2048 + mipmaps, premultiplied). `db/dragonBones.js` = vendored DragonBones core (MIT), `db/glslot.js` = our platform layer (slots / factory), `db/renderer.js` = WebGL renderer, `db/prep.js` = outfit merge + animation binding, `db/motion.js` + `db/physics.js` = body proportions, hair / cloth physics, transform constraints, `db/info.js` = character file helpers.
- `lipsync.js` – offline lip-sync (LPC formants, noise, closures); deliberately calm: ~4 shape changes/s, few teeth shapes.
- `exporter.js` / `exportWorker.js` – frame-by-frame export, parallel workers, WebM (VP9/Opus, default) or MP4 (H.264/AAC); `?workers=N` / `?workers=0` to tune.

## Testing tips
Playwright + `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with `--use-gl=swiftshader --enable-unsafe-swiftshader`; add `?debug` to the URL to get `window.__toon`.
The proxy port changes between sessions (`$HTTPS_PROXY`); localhost needs `--proxy-bypass-list`.

## Known gaps / ideas
- Never verified on a real phone: parallel export speed, H.264 path, live-record fallback.
- Possible next: more shot types / manual camera, props & scenes tabs, phoneme-based lip-sync via an AI model.


## 12toons shell, login, cloud, Character Studio (added later)
- `index.html` has `#shell` (landing / login / hub / Character Studio) and `#app` (the animation studio, hidden until `#/toons`).
  `src/shell.js` routes by hash; `main.js` is lazy-loaded and exports `openStudio/closeStudio/setHome`. `?debug` skips the login.
- Theme: light — CSS variables at the top of `style.css` (`--acc` blue, `--ink` black buttons). Shell/Character Studio CSS is at the end of the file.
- Firebase (`src/firebase.js`): Google login + Firestore (`workspaces/{uid}` profile). Rules proposal in `firebase/firestore.rules`.
- Cloud sync (`src/cloud.js` + `api/r2.js`): mirrors every IndexedDB store to R2 (`u/<uid>/sync/<store>/<id>/…`) + manifest in Firestore.
  Needs Vercel env vars (see README). Not verified against a real R2 bucket yet.
- Character Studio (`src/charstudio.js`): per-region recolour (HSL), replace image inside the region box, hide slots, outfit = skins
  (`category/item`), save to IndexedDB `characters` (shows up in the 12toons character step) or ZIP. Stage takes `skins` + `hide` in `setLayers` specs.
- AI director (`src/ai.js`, AI tab in the studio): OpenRouter, previous/current/next line context, timed animations (`cast[line][char].seq`).
- Rig data from other platforms must not be committed or shipped without written permission.

## Auto-direct with any AI (brief → file → import)
- `src/brief.js`: `buildBrief` writes `12toons-brief.txt` (instructions, characters, every library animation with length + how it moves via `describeMotion`, the script with line numbers + output JSON format); `extractJson` pulls the AI's JSON out of whatever file comes back.
- `main.js`: `autoDirectCard()` (shown at the bottom of step 2 and at the top of the AI tab), `makeBriefFile()`, `importDirectionFile()` -> `applyDirection({id,speaker,dur}, entry, libs)` per line (writes `cast[line][char].seq` / `.face` / `.in`, `S.shots`).
- Script text comes from a script json/txt inside the uploaded bundle (`ingest.js`), the AI tab (editable / OpenRouter transcription) — otherwise the brief tells the AI to judge from speaker + neighbouring lines.

## Workbench (replaces the 3-step wizard)
- `#/toons` opens the studio directly; there are no steps any more. Audio is optional: `tabAudio()` adds ZIP / audio files at any time (`onFiles` -> `afterAudioChange`), characters can be added without a voice (`addManualCharacter`, `speaker.manual`).
- No audio = 8 s empty scene, characters stand in a calm listener loop (`layerPlan` solo branch, `present: null`). Export asks for audio first.
- Layout: top bar (logo/home · saved · undo/redo · reset · Export), left tool rail (Audio, Characters, Animations, AI, Background, Export — bottom tab bar on phones), stage + timeline in the middle, tool panel on the right. CSS block "workbench" at the end of `style.css`.

## Saved characters (Character Studio)
A saved character is small: `{ id, name, pose, base: 'lib:<template id>', profile, pages: {imagePath: Blob}, thumb }` (`profile` = face, nudges, outfit, hidden slots, proportions `fit`).
`catalog.js hydrateCharacter()` puts it together again: template skeleton + `rigedit.bakeSke(profile)` + the user's own picture pages. Cloud: pages -> R2 `characters/<id>/page_<n>`, the rest -> Firestore `workspaces/<uid>/characters/<id>`.
Limits (`src/limits.js`, also checked by `api/r2.js`): 20 characters, 15 MB per page, 40 MB per character, 300 MB per user.
The **Create** tab (Start tab -> "Create my own character") lists the parts to draw, makes the 12toons part-template sheet, and fits uploaded art to the original outline.
