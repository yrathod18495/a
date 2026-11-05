# Timeline rules (permanent)

These rules were asked for repeatedly by the owner. Do not break them in any change.

1. **Every layer must stay visible, however short the timeline is.**
   When the timeline box is shorter than its rows, all rows shrink together (`fitRows()` in `src/main.js`, class `squeezed` on `.tl2`, CSS at the end of `src/studio-icons.css`). No layer row (audio, background, props, shadows, characters, "◆ move", colour, camera) may be pushed below the visible area or hidden under the scroll bar.
   - The ruler row keeps its height; the other rows never go below `MIN_ROW`.
   - A new kind of row must be added to `labels` / `lanes` in `drawTimeline()` with an inline `height:Npx` so `fitRows()` can shrink it. Rows are paired by index (label i = lane i).
   - Test: `tests/browser/timeline-fit.spec.js`. Run it after any timeline change.
   - The timeline box also **grows** by itself when it is too short to hold the ruler plus every row at `MIN_ROW` (up to 60 % of the screen), so the user cannot make it so small that a layer (e.g. "◆ move") cannot be edited.
   - **No scroll bar under the timeline** (the owner asked for it to be removed). The user moves sideways with the playhead (drag the ruler near an edge), the mouse wheel, or a swipe. Do not bring the bar back.
2. **The "◆ move" lane of a character is collapsible.** It is open while that character is selected, shut otherwise; a lane the user opened by hand stays open until the user shuts it (`S.moveOpen`, `moveLaneOpen()`).
3. **The phone bottom bar shows full labels** (no text cut off): rules for `.tabs-scroll > button` in `src/studio-icons.css`.
4. **The preview must survive the phone going to the background**: `Stage` handles `webglcontextlost` / `restored` and replaces a dead canvas (`src/db/stage.js`, test `tests/browser/context-restore.spec.js`).
