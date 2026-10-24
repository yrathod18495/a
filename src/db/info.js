// What the app needs to know about a DragonBones character without touching the runtime: bone / slot / outfit names, and how a character
// is assembled from files (DragonBones skeleton json + texture atlas jsons + the pictures).

export const dirOf = (u) => u.slice(0, u.lastIndexOf('/') + 1);
export const baseOf = (p) => p.split('/').pop();

/** { bones:[{name}], slots:[{name}], skins:[{name}], ...extra }: the "rig" the animation catalog looks at */
export function rigInfo(ske, extra = {}) {
  const arm = ske.armature[0];
  return { bones: arm.bone.map((b) => ({ name: b.name })), slots: arm.slot.map((s) => ({ name: s.name })), skins: (arm.skin || []).map((k) => ({ name: k.name })), ...extra };
}

/** is this json a DragonBones skeleton file? */
export const isSke = (j) => !!(j && Array.isArray(j.armature) && j.armature[0] && Array.isArray(j.armature[0].bone));
/** is this json a DragonBones texture atlas? */
export const isTex = (j) => !!(j && Array.isArray(j.SubTexture) && j.imagePath);

/**
 * Pairs a skeleton with its texture atlases: tex = [{ json, image }] in the order of the skeleton's own `_tex` list (our converter) or by name.
 * `pictures` = { fileName: Blob }.
 */
export function assembleDef({ ske, texJsons, pictures, id, name, extra = {} }) {
  const tex = texJsons.map((json) => ({ json, image: pictures[baseOf(json.imagePath)] || Object.values(pictures)[0] }));
  return { id, name, ske, tex, anims: [], rig: rigInfo(ske, extra), ...extra.def };
}
