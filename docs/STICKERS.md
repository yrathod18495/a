# Stickers (scars, blood marks, stitches, patches)

**What:** a creator puts a picture on one body part of a character in the Character Editor (Create tab → Stickers). It is drawn right above that layer, on the same bone, so it moves with the body.

**Where the files live (reads are cheap):**
- The admin uploads stickers in Admin → Add Assets → **Add Stickers** (PNG, WebP or SVG; an SVG is drawn once into a see-through PNG, at most 1024 px). The file goes to **R2** under its SHA-256 (the same file is never stored twice).
- One small record per sticker (name, category, size, who may use it, and a tiny WebP thumbnail inside it) is in the **Realtime Database** (`studioAssets`, type `sticker`). It is the same library as props / effects: one cached list (server memory, and 5 minutes in the browser tab) shows every thumbnail without any R2 read.
- The full picture is downloaded only when a creator taps a sticker, then kept in the browser (Cache Storage). After that: no server call, no R2 read.
- Free / paid works as for props: no setting = paid accounts only; the admin can mark a sticker free. Everybody sees every sticker; a paid one shows a lock.

**How it is saved with a character:** the pictures of all stickers on a character are packed into one page `stickers.png` (kept in `pages`, like other edited pictures) and the placements are in `profile.stickers` + `profile.stickerAtlas`. The character is self-contained (no later R2 reads for its stickers). Drafts keep them too.

**Code:** `src/rigedit.js` (`addStickers`, `STICKER_PAGE`), `src/charstudio.js` (panel, packing, library grid), `src/catalog.js` (`hydrateCharacter` adds the sticker page and slots), `src/admin-props-effects.js` + `src/sticker-image.js` (admin), `api/studio-assets.js` (type `sticker`).

**Tests:** `tests/rigedit-stickers.test.js`, `tests/studio-sticker-api.test.js`, `tests/browser/character-stickers.spec.js`, `tests/browser/admin-stickers.spec.js`, `tests/browser/sticker.spec.js` (needs a character ZIP).

**Cut at the edge:** by default a sticker is cut to the shape of its body part (the part's picture, flat or bent mesh, is drawn in the bone's space and the sticker keeps only what lies on it); the original is stored beside the cut picture (`_src`) so it can be edited again. Turn it off in the panel to let it stick out.

**Known limits:** the cut follows the part in the set-up pose (it does not bend with the part), a very bendy joint stretches it a little; up to 12 stickers per character; the sticker is placed in the pose the creator is editing.
