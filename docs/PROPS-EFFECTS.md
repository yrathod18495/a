# Props and effects

Admins publish **props** (pictures placed on the stage) and **effects** (pictures or sprite sheets that cover the frame in front of the characters: rain, sparkle, light leaks). Creators see them in the studio's **Props** and **Effects** tabs, grouped by category.

## Admin: Admin Dashboard → Props & Effects
- Two sub-tabs, **Props** and **Effects**, each with an upload form, category filter and a list with a *Hatayein* (remove) button.
- Props: image(s), optional name and category.
- Effects: image or sprite sheet, name, category, **blend** (Normal / Glow = add / Screen), **opacity** (0.05–1), **placement** (whole frame or small sticker) and, for an animated effect, the sprite sheet's **columns, rows and fps** (2–144 frames).
- A tiny WebP thumbnail is made in the browser and stored with the record, so grids never download full files.

## Data tree
`studioAssets/{id}` (written only by `api/studio-assets.js`, admin only):

| field | props | effects |
| --- | --- | --- |
| `type` | `'prop'` | `'effect'` |
| `name`, `key` (R2 object `assets/<sha256>`), `size`, `mime`, `ownerUid`, `enabled`, `updatedAt` | yes | yes |
| `category` (≤ 40 chars), `thumb` (`data:image/webp;base64,…`, ≤ 9000 chars) | optional | optional |
| `blend` (`normal` / `add` / `screen`), `opacity`, `placement` (`full` / `sticker`) | – | yes |
| `sheet` `{cols, rows, fps}` | – | optional |

Validation lives in `shared/studio-effects.js` (`cleanAssetMeta`) and runs on the server and in the admin form. The library list is cached for 30 s on the server and 5 min in the browser tab (`listStudioAssets`), so many visitors share one Firestore read; saving or deleting clears both. The *↻ Naya dekhein* button in the studio forces a fresh read.

## In the studio
- Adding an item downloads its file once per tab (`sharedBlobs`) and creates a **scene prop** (`kind: 'prop' | 'effect'`), stored with the scene exactly like earlier props: undo/redo, device save, cloud sync and video export all handle it.
- Effects: whole-frame by default, opacity, blend, sprite-sheet speed, and an optional *Dikhe: shuru / khatam* time range. Props: position, size, rotation, *Character ke peeche rakhein* and the same time range.
- Rendering is in `Stage.drawProps`: props sent behind are drawn before the characters, everything else after them. A sprite sheet shows the frame for `t − start`, so preview and export match.
- A whole-frame effect never catches clicks meant for the canvas.

## Floating menus
The tool menu and side panel can be dragged anywhere (grip on the menu, title bar on the panel); positions are kept in `localStorage` (`12toons.studio.layout`). They slide away after 5 s without use, leaving a round button in place; double-click the grip or title bar to dock them back. Below 861 px wide the old stacked layout is used.
