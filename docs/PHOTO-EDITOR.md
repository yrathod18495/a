# Layer picture editor (mini photo editor)

Character Editor → Create tab → the pencil button on a layer row opens `src/photo-editor.js` over the page. It edits that layer's picture (the upright box of the layer, `cropOf`) and `onApply` puts the result back as the layer's picture (`paintLayer` in `src/charstudio.js`), like an upload.

- Tools: 14 brush looks (soft, hard, pencil, ink, marker, airbrush, watercolour, chalk, spray, hatching, shadow, light, burn, dodge), eraser, smudge, blur, clone, fill (bucket), gradient, colour picker, rectangle / ellipse / freehand / magic selection (new / add / take away / overlap, soft edge, tolerance), move pixels, pan.
- Selection actions: all, none, invert, grow, shrink, soften, fill colour, delete. Adjust tab: brightness / contrast, hue / colourfulness / lightness, blur, sharpen, invert, black & white, edge shadow, flip.
- "Keep transparent areas" (on by default) paints only where the picture already has pixels, so nothing spills outside the body part.
- Undo / redo (memory-limited), Start again, zoom / pan, mouse + pen + touch (one finger paints, two fingers zoom and move).
- Pure pixel maths (wand flood fill, blur, adjustments, edge shadow, masks) is in `src/photo-tools.js` and is tested in Node: `tests/photo-tools.test.js`. Browser tests: `tests/browser/photo-editor.spec.js` (every tool on the small fixture), `photo-editor-real.spec.js` (a real big layer).
- The editor is plain English; it has no network calls.

## Tracing (Trace tab, Pen, Dot-to-dot select)

- Reference picture: add a drawing or use the picture you started with; it shows faintly under (or over) your lines, can be moved, resized, turned, flipped, locked and is never saved into the layer. "My picture opacity" only changes how your drawing looks while you work. Adding a reference turns "Keep transparent areas" off so you can draw on an empty layer.
- Pen: tap dots, drag while tapping to curve, tap the first dot to close; drag dots or handles to fix; Stroke line / Fill shape / Make selection / Round corners (smooth curves through the dots) / Undo dot / Clear. Pen strokes and fills ignore "Keep transparent areas".
- Dot-to-dot select: tap corners, tap the first dot / Enter / double-tap to finish. Selection → "Draw outline" draws a line along its edge.
- Brush and eraser have a Smoothing slider (a steadier line, like a stabiliser).
- Test: `tests/browser/photo-editor-trace.spec.js`.
