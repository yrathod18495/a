# 12toons — rules for every coding session

## DragonBones only (permanent rule)

**The Spine runtime/library is NOT to be used. All rigs and all animation data in 12toons are DragonBones.**

- Every character rig and every animation (Deepak/SVG Multi, Village Boy, Neha, My Baby and every future character) is stored and played as **DragonBones data** (`*_ske.json` + `*_tex.json` + `*_tex.png`).
- Code must use **only the DragonBones runtime** for loading, posing, playing, rendering and exporting. Do not import `@esotericsoftware/spine-*`, do not add Spine JSON/atlas readers, do not write new Spine-only features (Spine physics, Spine skins, Spine constraints).
- Spine files may exist **only as conversion input** (`scripts/` converters run offline, e.g. `spine_to_dragonbones.py`). They are never loaded by the app.
- New features (proportions, physics, lip-sync, retargeting, PSD import/export, exports) are written against DragonBones data and the DragonBones runtime, for every character the same way.
- If something is missing in DragonBones (e.g. Spine-style physics), implement it in our own code on top of DragonBones bones — do not bring Spine back.

When in doubt: DragonBones. This rule applies to every future change, by anyone (human or AI).
