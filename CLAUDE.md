# 12toons — rules for every coding session

## DragonBones only (permanent rule)

**The Spine runtime/library is NOT to be used. All rigs and all animation data in 12toons are DragonBones.**

- Every character rig and every animation (Deepak/SVG Multi, Village Boy, Neha, My Baby and every future character) is stored and played as **DragonBones data** (`*_ske.json` + `*_tex.json` + `*_tex.png`).
- Code must use **only the DragonBones runtime** for loading, posing, playing, rendering and exporting. Do not import `@esotericsoftware/spine-*`, do not add Spine JSON/atlas readers, do not write new Spine-only features (Spine physics, Spine skins, Spine constraints).
- Spine files may exist **only as conversion input** (`scripts/` converters run offline, e.g. `spine_to_dragonbones.py`). They are never loaded by the app.
- New features (proportions, physics, lip-sync, retargeting, PSD import/export, exports) are written against DragonBones data and the DragonBones runtime, for every character the same way.
- If something is missing in DragonBones (e.g. Spine-style physics), implement it in our own code on top of DragonBones bones — do not bring Spine back.

When in doubt: DragonBones. This rule applies to every future change, by anyone (human or AI).

## Error messages are user-friendly Hinglish (permanent rule)

Every error a user can see — toasts, form errors, failed/empty states and API error responses — must be written in **simple Hinglish** (Roman-script Hindi with common English tech words), never raw English or raw library text.

- Write our own messages in Hinglish where they are thrown: what happened + what to do next, polite ("aap", "karein", "dobara try karein"). Example: `'Pehle verified account se sign in karein.'`
- Raw errors from Firebase, Firestore rules (`permission-denied`, `Missing or insufficient permissions`), auth, network, quota or the browser go through `friendlyError(e)` / `hinglishify(text)` from `shared/hinglish-errors.js`. `toast()` already applies it as a safety net.
- Keep error `code` values, logs, field names and HTTP statuses in English; never compare against message text, use `code` / `status`.
- `tests/hinglish-errors.test.js` fails if `api/` or `server/` contain English error messages.
- Full style guide, examples and checklist: `docs/ERROR-MESSAGES.md`.

