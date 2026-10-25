# Timeline editing, motion paths, colour grading and Gold Coins

## Timeline editing (`shared/timeline-edit.js`, `src/main.js`)
- Every item on the timeline can be moved and resized by dragging: animation clips (head and tail), background clips, props / effects (start / end) and voice lines (trim).
- Dragging the **left** edge of an animation clip trims its head (`off` grows), so an 8 s animation can be made 5 s. A voice line trims with `trimStart` / `trimEnd` (seconds cut from head / tail); double-click it to restore.
- The scene is as long as the end of its last clip (`contentLength`); an empty scene is 8 s; camera / movement keys can only stretch it. Voice lines decide the length when there is audio (`lineLength` in `src/scenes.js`).
- Backgrounds: `S.bgClips = [{id, bgId|null, preset, start, dur}]`. The Background tab has "Poori scene" / "Timeline par" modes; the stage picks the active clip at time `t` (`Stage.setBackgroundClips`, also used by the export worker).
- Automatic clips (made from the voice, or the animation picked without audio) turn into the user's own clips the first time they are dragged (`takeAutoClip` / `takeSoloBody`).
- Copy / paste: select a clip, Ctrl+C, move the playhead, Ctrl+V (or the Copy / Paste buttons in the clip bar).

## Motion path (`shared/motion-path.js`)
Move tab → "Pen se path banayein": draw a line on the stage; it becomes movement keyframes (`pathKey: true`) so playback / export need nothing new. Start, length, "turn to the walking direction" and "slow start / end" are editable. Works at any camera zoom (`Stage.view` maps the pen through the camera). "Points badlein" simplifies the line to at most 14 points that can be dragged; double-click the line adds a point, double-click a point removes it.

## Colour grading (`shared/color-grade.js`, `src/db/renderer.js`)
Colour tab: 15 controls + 10 looks, applied to the whole scene in one full-screen WebGL pass (preview and export share it). A neutral grade skips the pass. Stored per scene (`doc.grade`), sent to the export worker as `job.grade`. The grade can also change over time: `doc.gradeKeys = [{t, grade}]` (purple diamonds on the timeline) glide with `gradeAt()`; with keys, the sliders edit the key at the playhead. Exported as `job.gradeKeys`.

## Gold Coins (`src/coin.js`)
Wherever the site used to say "credits" it now says **Gold Coins**, with a coin drawn in SVG ("12TOONS" in the centre). Only visible text changed: database fields (`credits`, `creditPayments`) and the `#/credits` route keep their names.

## Not done on purpose
Gold Coins are bought and shown but not spent anywhere yet: the AI tools run on the user's own OpenRouter key, so charging coins for them would double-charge. Decide a price per feature before wiring a spend step on the server.
