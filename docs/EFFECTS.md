# Effects (permanent notes)

An **Effect** is a look (Night, Ghost, Blurry, Neon glow ...) that sits on the timeline as its own layer ("FX" row). It has a start and an end, fades in and out (`ramp`), and a **target**:

| target | meaning | how it is drawn |
| --- | --- | --- |
| `scene` | the whole scene: background, characters, props | merged into the scene grade pass (`Stage.render` -> `r.target(...)`), so **characters are coloured too** (Night must not leave white characters on a dark background) |
| `char:<key>` | one character | its draw list goes into an own texture (`itemBegin` / `itemEnd` in `src/db/renderer.js`), the effect pass runs on that texture, the result is laid over the scene |
| `prop:<id>` | one prop / object | same as a character |
| `bg` | the background only | same as a character |

## Files
- `shared/fx.js` - the model: controls (`FX_CONTROLS`), the 19 templates (`FX_TEMPLATES`), `fxAt(list, t)`, `mergeFx`, `scaleFx`, `cleanFx`. **Add a new look here** (one object with `params`); nothing else is needed for it to appear in the tab, the preview and the export.
- `src/db/renderer.js` - one shader (`GFS`) for the scene pass, the item pass and the previews (`fxThumb`). New numeric controls need: `FX_EXTRA` in `shared/fx.js`, a uniform in `fxPass`, the maths in `GFS`.
- `src/db/stage.js` - `stage.fx` (list), merging with the Colour tab grade, per-item passes, `boundsOf` (crop of the previews).
- `src/main.js` - section "Effects": `tabFx` (tab with previews made from the real picture of the target), `openFxDock` (every number, edited on the stage), `addFx`, timeline rows, selection kind `fx` (`S.fxSel`), lock key `fx:<id>`, save/load (`sceneDoc().fx`), export job (`exportJob().fx`).
- Old projects: a Night / Evening / Dawn / Gloomy on a background clip (`bgClip.fx`) is turned into a scene effect on load (`migrateBgEffects`). The background tile no longer has effect chips.
- The old sticker-style effects (admin published fire, rain ...) are now called **Overlays** (tab key `effects`, More tools -> Look).

## Rules
- The preview in the tab must come from the real picture of the target and the very same shader as the stage (`fxThumb`), never from CSS filters.
- An effect works only inside its time range; `ramp` fades it in and out.
- Several effects on one target are merged (`mergeFx`): brightness, saturation, gamma and opacity multiply, everything else adds.
- Tests: `tests/browser/effects.spec.js` (tab, scene vs item, time range, save, export job, migration).
