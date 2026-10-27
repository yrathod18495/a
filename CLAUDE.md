# 12toons — rules for every coding session

## DragonBones only (permanent rule)

**The Spine runtime/library is NOT to be used. All rigs and all animation data in 12toons are DragonBones.**

- Every character rig and every animation (Deepak/SVG Multi, Village Boy, Neha, My Baby and every future character) is stored and played as **DragonBones data** (`*_ske.json` + `*_tex.json` + `*_tex.png`).
- Code must use **only the DragonBones runtime** for loading, posing, playing, rendering and exporting. Do not import `@esotericsoftware/spine-*`, do not add Spine JSON/atlas readers, do not write new Spine-only features (Spine physics, Spine skins, Spine constraints).
- Spine files may exist **only as conversion input** (`scripts/` converters run offline, e.g. `spine_to_dragonbones.py`). They are never loaded by the app.
- New features (proportions, physics, lip-sync, retargeting, PSD import/export, exports) are written against DragonBones data and the DragonBones runtime, for every character the same way.
- If something is missing in DragonBones (e.g. Spine-style physics), implement it in our own code on top of DragonBones bones — do not bring Spine back.

When in doubt: DragonBones. This rule applies to every future change, by anyone (human or AI).

## Error messages and all app text are plain, professional English (permanent rule)

Every error a user can see — toasts, form errors, failed/empty states and API error responses — and every other piece of user-facing copy in the app must be written in **plain, professional English**, never Hinglish/Hindi and never raw library text.

- Write our own messages in clear English where they are thrown: what happened + what to do next, polite ("please", "try again"). Example: `'Please sign in with a verified account.'`
- Raw errors from Firebase, Firestore rules (`permission-denied`, `Missing or insufficient permissions`), auth, network, quota or the browser go through `friendlyError(e)` / `hinglishify(text)` from `shared/hinglish-errors.js` (these now produce English, despite the file/function names — do not rename them mid-refactor without checking every import). `toast()` already applies it as a safety net.
- Keep error `code` values, logs, field names and HTTP statuses in English as before; never compare against message text, use `code` / `status`.
- `tests/hinglish-errors.test.js` enforces this — it fails if `api/` or `server/` contain Hinglish/Hindi error messages.
- Full style guide, examples and checklist: `docs/ERROR-MESSAGES.md`.

This also applies to how Claude talks to the user in chat for this project: reply in English, not Hinglish.

