# Timeline rules (permanent)

These rules were asked for repeatedly by the owner. Do not break them in any change.

0. **The layers are sorted into groups and the timeline shows ONE group at a time** (owner's request: not everything stacked together). Groups: Audio (voices, music), Characters (character rows, "◆ move", Camera), Background, Props (props, objects, shadows), Effects (effect rows, overlays, Colour). The open section (tab) picks the group (`TAB_CAT` in `src/main.js`: Upload → Audio, Characters / Animations → Characters, Background, Props / Objects / Shadow → Props, Effects / Overlays / Colour → Effects); the chips above the timeline switch it by hand (`S.tlCat`); selecting an item (a clip, a prop, an audio line, a character) opens its own group. A group with no layer shows a short hint instead of an empty box. Every row is tagged `data-cat` where it is created in `drawTimeline()`: **a new kind of row must get a `data-cat`**. Tests that look for a row must first show its group (`S.tlCat = '…'`).
1. **Every layer of the shown group must stay visible, however short the timeline is.**
   When the timeline box is shorter than its rows, all rows shrink together (`fitRows()` in `src/main.js`, class `squeezed` on `.tl2`, CSS at the end of `src/studio-icons.css`). No layer row (audio, background, props, shadows, characters, "◆ move", colour, camera) may be pushed below the visible area or hidden under the scroll bar.
   - The ruler row keeps its height; the other rows never go below `MIN_ROW`.
   - A new kind of row must be added to `labels` / `lanes` in `drawTimeline()` with an inline `height:Npx` so `fitRows()` can shrink it. Rows are paired by index (label i = lane i).
   - Test: `tests/browser/timeline-fit.spec.js`. Run it after any timeline change.
   - The timeline box also **grows** by itself when it is too short to hold the ruler plus every row at `MIN_ROW` (up to 60 % of the screen), so the user cannot make it so small that a layer (e.g. "◆ move") cannot be edited.
   - **No scroll bar under the timeline** (the owner asked for it to be removed). The user moves sideways with the playhead (drag the ruler near an edge), the mouse wheel, or a swipe. Do not bring the bar back.
2. **The "◆ move" lane of a character is collapsible.** It is open while that character is selected, shut otherwise; a lane the user opened by hand stays open until the user shuts it (`S.moveOpen`, `moveLaneOpen()`).
3. **The phone bottom bar shows full labels** (no text cut off): rules for `.tabs-scroll > button` in `src/studio-icons.css`.
4. **The preview must survive the phone going to the background**: `Stage` handles `webglcontextlost` / `restored` and replaces a dead canvas (`src/db/stage.js`, test `tests/browser/context-restore.spec.js`).
5. **Effect rows (FX)** are normal layer rows (height 38, label + lock) and are shrunk by `fitRows()` like every other row. See `docs/EFFECTS.md`.

## Phone bottom bar follows the timeline group
On a phone the bottom bar shows tools for the open timeline group (`phoneNav()` in `src/main.js`): Audio (Voices, Music, Edit voice, Upload), Characters (Characters, Animations, Move, Camera, More), Background (Pick, Upload, Edit, Filter, Colour), Props (Hand props, Objects, Hold, Shadow), Effects (Effects, Overlays, Colour). Wide screens keep the rail. The Hold tool (`openHoldTool`) sets a prop's character, hand, place (joystick), size, turn and front/behind layer; the renderer only supports in front of / behind the whole character. Test: `tests/browser/phone-nav-hold.spec.js`.

## Layer overview lives on the five layer buttons

There is no separate overview line above the timeline any more. Each of the five layer buttons (Audio, Characters, Background, Props, Effects) carries a tiny map of its own group (`.tl-mini`: where its layers start and end over the whole scene, in the group's colour) and a tick for the playhead, so groups are compared right where they are chosen, next to the timeline. Code: `drawOverview` / `moveMiniHeads` in `src/main.js`. Test: `tests/browser/layer-minimap.spec.js`.

## Split

Every timeline clip can be cut at the playhead: animation clips, backgrounds, objects, audio lines and now effects / skills (`splitSelected` in `src/main.js`; both pieces keep the same look). The Split button is in the bottom navigation (clip bar); there is no extra scissors on the timeline. Shadows cannot be cut (they follow their character or object).

## Where the scene (and the player) ends

The background is the root (`contentLength` in `shared/timeline-edit.js`): when a scene has background clips it ends where the last background clip ends, and the player stops there (`time >= total`). Stretch or move a background clip and the scene gets longer or shorter. Anything else (character clips, objects, effects, skills, camera, colour, movement keys) that runs past that point is cut. Without background clips the scene ends where its voices / animation clips / objects end; a scene with nothing at all is 8 s and only then can effects or the camera stretch it. Tests: `tests/timeline-edit.test.js`, `tests/browser/timeline-grows.spec.js`.
