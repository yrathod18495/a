# Layer picture editor (mini photo editor)

Character Editor → Create tab → the pencil button on a layer row opens `src/photo-editor.js` over the page. It edits that layer's picture (the upright box of the layer, `cropOf`) and `onApply` puts the result back as the layer's picture (`paintLayer` in `src/charstudio.js`), like an upload.

- Tools: 14 brush looks (soft, hard, pencil, ink, marker, airbrush, watercolour, chalk, spray, hatching, shadow, light, burn, dodge), eraser, smudge, blur, clone, fill (bucket), gradient, colour picker, rectangle / ellipse / freehand / magic selection (new / add / take away / overlap, soft edge, tolerance), move pixels, pan.
- Selection actions: all, none, invert, grow, shrink, soften, fill colour, delete. Adjust tab: brightness / contrast, hue / colourfulness / lightness, blur, sharpen, invert, black & white, edge shadow, flip.
- "Keep transparent areas" (on by default) paints only where the picture already has pixels, so nothing spills outside the body part.
- Undo / redo (memory-limited), Start again, zoom / pan, mouse + pen + touch (one finger paints, two fingers zoom and move).
- Pure pixel maths (wand flood fill, blur, adjustments, edge shadow, masks) is in `src/photo-tools.js` and is tested in Node: `tests/photo-tools.test.js`. Browser tests: `tests/browser/photo-editor.spec.js` (every tool on the small fixture), `photo-editor-real.spec.js` (a real big layer).
- The editor is plain English; it has no network calls.
